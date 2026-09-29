const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const path = require('node:path');
const { compileScript } = require('./helpers/compile-script');
const source = compileScript(path.join(__dirname, '../SidebarMathJaxShared.ts'));

// Only SVG layout and browser bitmap APIs are doubled. Browser CI additionally
// checks actual PNG pixels; this harness exercises limits and protocol variants.
async function raster(width, height, supportsRasterScale = true, fail = false) {
  const options = { equation: 'x+1', inline: false, size: 11, r: 0, g: 0, b: 0,
    ...(supportsRasterScale ? { supportsRasterScale: true } : {}) };
  let dimensions;
  const svg = { tagName: 'svg', querySelector: () => null, classList: { add() {} },
    style: {}, clientWidth: width, clientHeight: height, remove() {}, setAttribute() {} };
  const blob = new Blob(['PNG'], { type: 'image/png' });
  const runtime = vm.createContext({ Blob, console,
    window: { setTimeout, clearTimeout, MathJax: {
      tex2svgPromise: async () => ({ children: [svg] }), svgStylesheet: () => ({ outerHTML: '' }),
    } },
    document: { body: { appendChild() {} } },
    XMLSerializer: class { serializeToString() { return '<svg></svg>'; } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Image: class { set src(value) { queueMicrotask(() => this.onload()); } },
    OffscreenCanvas: class {
      constructor(w, h) { dimensions = [w, h]; }
      getContext() { return { drawImage() {}, fillRect() {} }; }
      async convertToBlob() { if (fail) throw new Error('export failed'); return blob; }
    },
  });
  vm.runInContext(source, runtime, { filename: 'production-raster.js' });
  const output = await runtime.renderEquationPngWithMathJax(options);
  return { dimensions, options, output };
}

test('normal equations get 12x pixels and report their actual scale', async () => {
  const { dimensions, options } = await raster(100, 20);
  assert.deepEqual(dimensions, [1200, 240]);
  assert.equal(options.rasterScale, 12);
});

test('large equations stay within canvas area and dimension budgets', async () => {
  for (const [w, h] of [[800, 500], [10000, 10], [10, 10000]]) {
    const { dimensions: [width, height], options } = await raster(w, h);
    assert.ok(width <= 4096 && height <= 4096);
    assert.ok(width * height <= 8000000);
    assert.ok(width > 0 && height > 0);
    assert.ok(Math.abs(width / options.rasterScale - w) <= 1 / options.rasterScale);
    assert.ok(Math.abs(height / options.rasterScale - h) <= 1 / options.rasterScale);
  }
});

test('new sidebar talking to an old server retains 5x rendering', async () => {
  const { dimensions, options } = await raster(100, 20, false);
  assert.deepEqual(dimensions, [500, 100]);
  assert.equal(options.rasterScale ?? 5, 5);
});

test('empty equations and failed exports still reject', async () => {
  await assert.rejects(raster(0, 0), /Empty equation/);
  await assert.rejects(raster(100, 20, true, true), /export failed/);
});

function server(app, extras = {}) {
  const runtime = vm.createContext({ console: { log() {}, warn() {}, error() {} }, escape, ...extras });
  vm.runInContext(compileScript(path.join(__dirname, `../${app}/Code.ts`)), runtime);
  return runtime;
}

test('both app scan paths advertise support but leave response scale unset', () => {
  const { runCase } = require('./helpers/render-matrix');
  for (const app of ['Docs', 'Slides']) for (const renderer of ['auto', 'mathjax']) {
    const { payloads } = runCase({ app, renderer, delimiter: '$$', mode: 'smart' });
    assert.ok(payloads.length);
    for (const options of payloads) {
      assert.equal(options.supportsRasterScale, true);
      assert.equal(options.rasterScale, undefined, 'old sidebar must not echo a requested scale as actual');
    }
  }
});

test('Docs completion forwards actual raster scale to image placement', () => {
  let placed;
  const span = { getElement: () => ({ getType: () => 'TEXT' }) };
  const context = server('Docs', {
    Common: { rendererIds: { MATHJAX: 0 }, getRenderer: () => [] },
    DocumentApp: { ElementType: { TEXT: 'TEXT' } },
    Utilities: { base64Decode: () => [], newBlob: () => ({}) },
  });
  context.getDocsApp = () => ({ getActive: () => ({ getNamedRangeById: () => ({
    getRange: () => ({ getRangeElements: () => [span] }), remove() {},
  }) }) });
  context.placeImage = (...args) => { placed = args; return { status: 8 }; };
  context.clientRenderComplete([{ options: { rangeId: 'range', rasterScale: 12 }, renderedEquationB64: '' }]);
  assert.equal(placed[7], 12);
});

test('Docs sizes high-resolution and legacy PNGs identically', () => {
  for (const scale of [undefined, 12, 2.5]) {
    const actualScale = scale ?? 5;
    let sized;
    const image = { asInlineImage: () => image, setLinkUrl() {}, setAltDescription() {},
      getWidth: () => 100 * actualScale, getHeight: () => 20 * actualScale };
    const context = server('Docs', { Common: { reportDeltaTime() {}, debugLog() {},
      getClientEquation: () => 'x', sizeImage: (...args) => { sized = args.slice(3); } } });
    context.getDocsApp = () => ({});
    context.repairImage({ getChild: () => image }, 0, 11, [0, '', '', '', '', 'MathJax'],
      ['$$', '$$', '', '', 2, 1, 0], { getDataAsString: () => 'PNG' }, 'x', undefined, scale);
    assert.deepEqual(sized, [25, 126]);
  }
});

test('Slides keeps image size and text spacing stable across raster scales', () => {
  const results = [];
  for (const scale of [undefined, 12, 2.5]) {
    let width = 100 * (scale ?? 5), spaces;
    const image = { getWidth: () => width, setTitle() {} };
    const context = server('Slides', { Common: { rendererIds: { MATHJAX: 0 }, getRenderer: () => [0, '', 'url'] } });
    context.resize = (_image, factor) => { width *= factor; };
    const textRange = { insertText(_offset, value) { spaces = value; } };
    const range = { getParagraphs: () => [{ getRange: () => ({ getParagraphStyle: () => ({ getParagraphAlignment: () => 'START' }) }) }], clear() {} };
    const result = context.placeImageAndFillSpaces({ slide: { insertImage: () => image },
      textElement: { getContentAlignment: () => 'TOP' }, textRange },
      { rasterScale: scale, size: 11, delim: ['$$', '$$', '', '', 2, 1, 0] }, {}, range, 0, {}, {});
    results.push([result.imageWidth, spaces.length]);
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
  assert.equal(results[0][0], 126);
});
