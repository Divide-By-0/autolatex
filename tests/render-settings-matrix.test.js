const assert = require('node:assert/strict');
const test = require('node:test');
const { cases, runCase, options, modes, renderers, delimiters } = require('./helpers/render-matrix');

test('matrix covers every shipped renderer and delimiter with Auto/Inline sizes', () => {
  // NOTE: derived, not a literal. The count moved 100 -> 80 when Sciweavers was retired, and a
  // hard-coded total only tells you the number changed, never which selector changed.
  assert.equal(cases.length, 2 * renderers.length * delimiters.length * modes.length);
  assert.ok(renderers.length >= 4 && delimiters.length >= 5, 'selectors still cover the shipped options');
  for (const app of ['Docs', 'Slides']) {
    assert.deepEqual(options(app, 'renderer'), renderers);
    assert.deepEqual(options(app, 'delimit'), delimiters);
    for (const mode of modes) assert.ok(options(app, 'size').includes(mode));
  }
});
for (const c of cases) {
  test(`${c.app}: renderer=${c.renderer} delimiter=${c.delimiter} size=${c.mode}`, () => {
    runCase(c);
    runCase(c, String.raw`\frac{1+1}{2}=1`);
  });
}
