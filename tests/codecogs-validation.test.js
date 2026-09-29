const assert = require('node:assert/strict');
const test = require('node:test');
const { commonHarness } = require('./helpers/render-matrix');
const valid = require('./fixtures/codecogs/valid.json');
const invalid = require('./fixtures/codecogs/invalid-dpi.json');

// Real CodeCogs responses captured 2026-09-29 for generic x+1, with
// \\dpi{900} (valid) and \\dpi900 (unknown command). The latter reproduces
// the visible symptom, not the historical upstream trigger for a valid prefix.
function render(payload, failFirst = false) {
  const { common } = commonHarness();
  const urls = [];
  common.Utilities.base64Decode = value => Array.from(Buffer.from(value, 'base64'));
  common.Utilities.newBlob = (bytes, type) => ({
    getDataAsString: () => Buffer.from(bytes).toString('latin1'),
    getContentType: () => type,
    getBytes: () => bytes,
  });
  common.UrlFetchApp.fetch = url => {
    urls.push(url);
    if (failFirst && urls.length === 1) throw new Error('first endpoint unavailable');
    return {
      getContentText: () => JSON.stringify(payload),
      getBlob: () => common.Utilities.newBlob(Buffer.from(payload?.latex?.base64 || invalid.latex.base64, 'base64'), 'image/png'),
    };
  };
  const delim = common.getDelimiters('$$');
  const result = common.renderEquation('x%2B1', {
    ...common.getDefaultRenderOptions(delim), allowedServerFamilies: ['Codecogs'],
  });
  return { common, urls, result };
}

test('HTTP 200 error artwork must not become a successful equation', () => {
  const { common, result } = render(invalid);
  assert.ok(result.worked > common.capableRenderers, 'unknown dpi command must fail rendering');
});

test('malformed or unvalidated CodeCogs responses fail closed', () => {
  for (const payload of [{}, { latex: { ...valid.latex, valid: undefined } },
    { latex: { ...valid.latex, errors: ['render error'] } },
    { latex: { ...valid.latex, base64: 'bm90IGEgcG5n' } },
    { latex: { ...valid.latex, equation: String.raw`\dpi{900}x+1` } }]) {
    const { common, result } = render(payload);
    assert.ok(result.worked > common.capableRenderers);
  }
});

test('validated PNG is returned unchanged and dpi stays out of round-trip source', () => {
  const { result } = render(valid);
  assert.equal(result.rendererType, 'Codecogs');
  assert.deepEqual(Buffer.from(result.resp.getBlob().getBytes()), Buffer.from(valid.latex.base64, 'base64'));
  assert.equal(result.resp.getBlob().getContentType(), 'image/png');
  assert.equal(result.equation.includes('dpi'), false);
  assert.equal(result.renderer[2].includes('dpi'), false);
});

test('fallback never silently drops PNG quality or calls retired staging', () => {
  const { urls } = render(valid, true);
  assert.ok(urls.length > 1, 'exercise fallback');
  assert.ok(urls.every(url => !url.includes('gif.') && !url.includes('easygenerator')));
  assert.ok(urls.every(url => url.includes('/png.json?')));
});

test('invalid CodeCogs artwork preserves Docs and Sheets source', () => {
  const { loadDocsCode } = require('./helpers/docs-scan');
  const { loadSheetsCode } = require('./helpers/sheets-harness');
  const source = '$$x+1$$';
  const { common } = render(invalid);
  const fetch = common.UrlFetchApp.fetch;
  common.UrlFetchApp.fetch = url => {
    if (!url.includes('codecogs.com')) throw new Error('other renderer unavailable');
    return fetch(url);
  };
  const doc = loadDocsCode([source], common.getDelimiters('$$'), common);
  doc.context.placeImage = () => assert.fail('invalid artwork must not be inserted');
  doc.context.replaceEquations('smart', '$$', 'codecogs');
  assert.equal(doc.paragraphs[0].textElement.getText(), source);
  const sheet = loadSheetsCode([[source]], common);
  const result = sheet.context.replaceEquations('smart', '$$', 'codecogs');
  assert.equal(result.successCount, 0);
  assert.equal(sheet.sheet.getImages().length, 0);
  assert.equal(sheet.rows()[0][0], source);
});

test('Slides inserts validated bytes and preserves source on validation failure', () => {
  const vm = require('node:vm');
  const { compileScript } = require('./helpers/compile-script');
  for (const payload of [valid, invalid]) {
    const { common } = render(payload);
    let source = '$$x+1$$', inserted, title;
    const body = { insertImage(blob) { inserted = blob; return { setTitle(value) { title = value; } }; } };
    const text = {
      getRange: () => text, getLength: () => source.length, asRenderedString: () => source,
      getParagraphs: () => [{ getRange: () => ({ getParagraphStyle: () => ({ getParagraphAlignment: () => 'START' }) }) }],
      clear() { source = ''; },
    };
    const context = vm.createContext({ Common: common, console: { log() {} },
      IntegratedApp: { getBody: () => [body], newlineCharacter: '\n' },
      SlidesApp: { ShapeType: { TEXT_BOX: 'TEXT_BOX' }, getActivePresentation: () => ({ getSlides: () => [body] }) },
    });
    vm.runInContext(compileScript(require('node:path').join(__dirname, '../Slides/Code.ts')), context);
    context.getBounds = () => ({ width: 500, height: 100 });
    context.resize = () => {};
    const result = context.placeImage(0, { getContentAlignment: () => 'TOP', getShapeType: () => 'RECTANGLE' }, text,
      { ...common.getDefaultRenderOptions(common.getDelimiters('$$')), size: 12, allowedServerFamilies: ['Codecogs'] });
    if (payload === invalid) {
      assert.equal(result, -100000);
      assert.equal(source, '$$x+1$$');
      assert.equal(inserted, undefined);
    } else {
      assert.equal(typeof inserted, 'object', 'insert blob, not an unvalidated URL refetch');
      assert.deepEqual(Buffer.from(inserted.getBytes()), Buffer.from(valid.latex.base64, 'base64'));
      assert.equal(source, '');
      assert.equal(JSON.parse(title).origURL.includes('dpi'), false);
    }
  }
});
