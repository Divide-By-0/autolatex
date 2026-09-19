const assert = require('node:assert/strict');
const test = require('node:test');
const { commonHarness } = require('./helpers/render-matrix');
const { loadSheetsCode } = require('./helpers/sheets-harness');

// Sheets had no test coverage at all before this file, which is why its behaviour was
// only ever checked by hand in a live spreadsheet. These run the real Sheets/Code.ts
// against the real Common library; only the SpreadsheetApp boundary is doubled.

function setup(grid) {
  const harness = commonHarness();
  const doc = loadSheetsCode(grid, harness.common);
  return { ...harness, ...doc };
}

test('server renderer replaces a whole-cell equation with an anchored image', () => {
  const { context, sheet, urls } = setup([['$$1+1=2$$'], ['plain text']]);
  const result = context.replaceEquations('smart', '$$', 'codecogs');

  assert.equal(result.successCount, 1, 'exactly the one equation cell renders');
  assert.equal(result.failureCount, 0);
  assert.equal(sheet.getImages().length, 1, 'one image inserted');
  assert.ok(urls.some(u => u.includes('codecogs')), 'explicit renderer choice is honoured');
  // Anchored to the originating cell, not left at absolute pixel coordinates.
  const image = sheet.getImages()[0];
  assert.equal(image.getAnchorCell().getRow(), 1);
  assert.equal(image.getAnchorCell().getColumn(), 1);
});

test('the original cell text is recoverable from the image alt text', () => {
  const source = '$$\\frac{a}{b}$$';
  const { context, sheet } = setup([[source]]);
  context.replaceEquations('smart', '$$', 'codecogs');

  const alt = sheet.getImages()[0].getAltTextDescription();
  assert.match(alt, /^ALE-Latex:/, 'alt text carries the round-trip prefix');
  const decoded = Buffer.from(alt.replace(/^ALE-Latex:/, ''), 'base64').toString('utf8');
  assert.equal(decoded, source, 'base64 payload reconstructs the exact authored cell');
});

test('de-render restores the authored text and removes the image', () => {
  const source = '$$x^2$$';
  const { context, sheet, rows } = setup([[source]]);
  context.replaceEquations('smart', '$$', 'codecogs');
  assert.equal(sheet.getImages().length, 1);

  const restored = context.removeAll('$$');
  assert.equal(restored, 1, 'one equation de-rendered');
  assert.equal(sheet.getImages().length, 0, 'image removed');
  assert.equal(rows()[0][0], source, 'cell text restored character for character');
});

test('a cell mixing prose with an equation is left alone', () => {
  // Documented Sheets limitation: equations are whole-cell only.
  const { context, sheet, rows } = setup([['before $$x^2$$ after']]);
  const result = context.replaceEquations('smart', '$$', 'codecogs');

  assert.equal(result.successCount, 0, 'partial-cell equations are not rendered');
  assert.equal(sheet.getImages().length, 0);
  assert.equal(rows()[0][0], 'before $$x^2$$ after', 'the cell is untouched');
});

test('Automatic and MathJax hand equations to the client instead of fetching', () => {
  for (const renderer of ['auto', 'mathjax']) {
    const { context, urls, sheet } = setup([['$$1+1=2$$']]);
    const result = context.replaceEquations('smart', '$$', renderer);

    assert.equal(urls.length, 0, `${renderer} must not hit a server renderer`);
    assert.equal(sheet.getImages().length, 0, `${renderer} defers image placement to the client`);
    assert.equal(result.clientEquations.length, 1, `${renderer} returns the equation to the sidebar`);
    assert.equal(decodeURIComponent(result.clientEquations[0].equationLinkEncoded ?? '1+1=2'), '1+1=2');
  }
});

test('the retired Sciweavers renderer is unreachable from Sheets', () => {
  const { context, urls } = setup([['$$1+1=2$$']]);
  context.replaceEquations('smart', '$$', 'codecogs');
  for (const url of urls) {
    assert.ok(!url.includes('sciweavers.org'), `must not request sciweavers: ${url}`);
  }
});

test('every equation cell in a multi-row sheet renders once', () => {
  const { context, sheet } = setup([['$$a$$'], ['$$b$$'], [''], ['$$c$$']]);
  const result = context.replaceEquations('smart', '$$', 'codecogs');

  assert.equal(result.successCount, 3, 'three equation cells, blank row skipped');
  assert.equal(sheet.getImages().length, 3);
  const anchoredRows = sheet.getImages().map(i => i.getAnchorCell().getRow()).sort();
  assert.deepEqual(anchoredRows, [1, 2, 4], 'each image anchors to its own source row');
});
