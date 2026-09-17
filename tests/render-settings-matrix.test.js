const assert = require('node:assert/strict');
const test = require('node:test');
const { cases, runCase, options, modes, renderers, delimiters } = require('./helpers/render-matrix');

test('matrix covers every shipped renderer and delimiter with Auto/Inline sizes', () => {
  assert.equal(cases.length, 100);
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
