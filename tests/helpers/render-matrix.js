const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { compileScript } = require('./compile-script');
const { loadDocsCode } = require('./docs-scan');
const root = path.join(__dirname, '../..');
const commonSource = ['Common/Unicode.ts', 'Common/Code.ts'].map(f => compileScript(path.join(root, f))).join('\n');
const slidesSource = compileScript(path.join(root, 'Slides/Code.ts'));
const quiet = { log() {}, error() {}, warn() {} };

// Read the shipped selectors, not a second hand-maintained list of options.
function options(app, id) {
  const html = fs.readFileSync(path.join(root, app, 'Sidebar.html'), 'utf8');
  const select = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(select, `${app} ${id} selector`);
  return [...select[1].matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
}
const modes = ['smart', 'inline'];
const renderers = options('Docs', 'renderer');
const delimiters = options('Docs', 'delimit');
const cases = ['Docs', 'Slides'].flatMap(app => options(app, 'renderer').flatMap(renderer =>
  options(app, 'delimit').flatMap(delimiter => modes.map(mode => ({ app, renderer, delimiter, mode })))));

function commonHarness() {
  const urls = [], renders = [], prefs = {};
  const common = vm.createContext({ console: quiet, escape, unescape,
    PropertiesService: { getUserProperties: () => ({
      setProperty: (k, v) => { prefs[k] = v; }, getProperty: k => prefs[k] || null,
    }) },
    Utilities: { sleep() {} },
    // Only the network boundary is doubled. Renderer choice, encoding, styling,
    // URL construction, response validation and fallback are production Common.
    UrlFetchApp: { fetch(url) {
      urls.push(url);
      return { getBlob: () => ({ getDataAsString: () => 'valid image fixture' }) };
    } },
  });
  vm.runInContext(commonSource, common, { filename: 'Common.matrix.js' });
  // Apps Script libraries expose top-level values; VM lexical consts need an adapter.
  for (const name of ['capableRenderers', 'capableDerenderers', 'retiredRendererFamilies',
    'rendererIds', 'invalidEquationHashCodecogsFirst50']) {
    common[name] = vm.runInContext(name, common);
  }
  const render = common.renderEquation;
  common.renderEquation = (...args) => {
    const result = render(...args);
    renders.push({ input: args[0], options: args[1], result });
    return result;
  };
  return { common, urls, renders, prefs };
}

function slidesHarness(source, common) {
  const state = { text: source };
  const style = { getFontSize: () => 18, getFontFamily: () => 'Arial',
    getForegroundColor: () => null, getBackgroundColor: () => null };
  function range(start = 0, end) {
    const stop = () => end === undefined ? state.text.length : end;
    return {
      asRenderedString: () => state.text.slice(start, stop()),
      asString: () => state.text.slice(start, stop()),
      getLength: () => stop() - start,
      getRange: (a, b) => range(start + a, start + b),
      getTextStyle: () => style,
      clear() { state.text = state.text.slice(0, start) + state.text.slice(stop()); },
    };
  }
  const shape = { getPageElementType: () => 'SHAPE', asShape: () => shape,
    getText: () => range(), getObjectId: () => 'shape', getLeft: () => 0, getTop: () => 0,
    getWidth: () => 600, getHeight: () => 100, getFill: () => ({ isVisible: () => false }) };
  const slide = { getPageElements: () => [shape], getObjectId: () => 'slide' };
  const context = vm.createContext({ Common: common, console: quiet,
    SlidesApp: { PageElementType: { SHAPE: 'SHAPE', TABLE: 'TABLE', GROUP: 'GROUP' },
      getActivePresentation: () => ({ getSlides: () => [slide] }) } });
  vm.runInContext(slidesSource, context, { filename: 'Slides.matrix.js' });
  // Stop at image insertion. The scan/encoding/render routing remain real;
  // this suite does not simulate Slides layout or claim a live insertion test.
  context.placeImage = (_slide, _element, text, renderOptions) => {
    const equation = context.getEquation(text, renderOptions.delim);
    const result = common.renderEquation(equation, renderOptions);
    assert.ok(result.resp, 'server renderer must succeed');
    text.clear();
    return [18, 1];
  };
  return { context, consumeClient(eq) {
    state.text = state.text.slice(0, eq.rangeStart) + state.text.slice(eq.rangeEnd);
  }, remaining: () => state.text };
}

function runCase({ app, renderer, delimiter, mode }, equation = '1+1=2') {
  const harness = commonHarness();
  const { common } = harness;
  const delimiterSet = Array.from(common.getDelimiterSet(delimiter));
  // All means an actual mixed-delimiter document, not four isolated selectors.
  const source = delimiterSet.map(d => `before ${d[0]}${equation}${d[1]} after`).join(' | ');
  let doc;
  if (app === 'Docs') {
    const { context, paragraphs } = loadDocsCode([source], delimiterSet[0], common);
    context.placeImage = (span, _blob, _renderer, _equation, size) => {
      span.getElement().deleteText(span.getStartOffset(), span.getEndOffsetInclusive());
      return { status: context.DocsEquationRenderStatus.Success, equationSize: size };
    };
    doc = { context, remaining: () => paragraphs[0].textElement.getText() };
  } else {
    doc = slidesHarness(source, common);
  }
  const payloads = [];
  let result = doc.context.replaceEquations(mode, delimiter, renderer);
  payloads.push(...(result.clientEquations || []));
  // Explicit MathJax in Slides is intentionally one-at-a-time; exercise its
  // repeated scan after each consumed span, including the All selector.
  if (app === 'Slides' && renderer === 'mathjax') {
    for (let i = 0; result.clientEquations?.length; i++) {
      assert.ok(i < delimiterSet.length, 'scan terminates without duplicate equations');
      doc.consumeClient(result.clientEquations[0]);
      result = doc.context.replaceEquations(mode, delimiter, renderer);
      payloads.push(...(result.clientEquations || []));
    }
  }
  const client = renderer === 'auto' || renderer === 'mathjax';
  assert.equal(client ? payloads.length : harness.renders.length, delimiterSet.length);
  assert.deepEqual(harness.prefs, { size: mode, delim: delimiter, renderer });
  const expectedIds = delimiterSet.map(d => d[6]).sort();
  if (client) {
    assert.equal(harness.urls.length, 0, 'Auto and MathJax must start locally');
    for (const p of payloads) {
      assert.equal(p.equation, equation, 'complete source survives extraction');
      assert.equal(p.inline, mode === 'inline');
      assert.equal(p.size, app === 'Docs' ? 11 : 18, 'size inherits source font');
      assert.equal(decodeURIComponent(p.equationLinkEncoded), equation);
    }
    assert.deepEqual(payloads.map(p => p.delim[6]).sort(), expectedIds);
  } else {
    if (app === 'Docs') {
      assert.equal(result.lastStatus, doc.context.DocsEquationRenderStatus.Success);
      assert.equal(result.successCount, delimiterSet.length);
    }
    const family = { codecogs: 'Codecogs', texrendr: 'Texrendr', sciweavers: 'Sciweavers' }[renderer];
    for (const call of harness.renders) {
      assert.equal(decodeURIComponent(call.input), equation);
      assert.equal(call.options.inline, mode === 'inline');
      assert.equal(call.result.rendererType, family, 'explicit preferred family used');
      const url = decodeURIComponent(call.result.renderer[1]);
      assert.ok(url.includes(equation), 'server request includes every term');
      assert.equal(/\\(?:inline|textstyle)/.test(url), mode === 'inline', 'server style matches selected size');
    }
    assert.deepEqual(harness.renders.map(p => p.options.delim[6]).sort(), expectedIds);
    assert.equal(doc.remaining(), delimiterSet.map(() => 'before  after').join(' | '), 'prose preserved');
  }
  return { ...harness, payloads, source };
}
module.exports = { cases, runCase, options, modes, renderers, delimiters, commonHarness };
