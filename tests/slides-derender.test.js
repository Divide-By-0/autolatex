const assert = require('node:assert/strict');
const test = require('node:test');
const { harness, equationTitle } = require('./helpers/slides-derender-harness');

for (const action of ['all', 'selection']) {
  test(`Slides de-render ${action} restores an equation with no Common enum export`, () => {
    const h = harness([equationTitle()]);
    assert.equal(h.common.DerenderResult, undefined);
    const result = action === 'all' ? h.runtime.removeAll('$$') : h.runtime.editEquations('14', '$$');
    assert.equal(action === 'all' ? result : result.successCount, 1);
    assert.deepEqual(h.restored, ['$$x+1$$']);
    assert.equal(h.images[0].removed, true);
  });
}

for (const action of ['all', 'selection']) {
  test(`Slides de-render ${action} skips ordinary images and restores multiple equations`, () => {
    const h = harness(['', equationTitle(), equationTitle()]);
    const result = action === 'all' ? h.runtime.removeAll('$$') : h.runtime.editEquations('14', '$$');
    assert.equal(action === 'all' ? result : result.successCount, 2);
    assert.deepEqual(h.restored, ['$$x+1$$', '$$x+1$$']);
    assert.deepEqual(h.images.map(image => image.removed), [false, true, true]);
  });
}

test('Slides distinguishes missing selection, non-image selection, and unrecognized images', () => {
  assert.equal(harness([], 'NONE').runtime.editEquations('14', '$$').result, 0);
  assert.equal(harness([]).runtime.editEquations('14', '$$').result, 3);
  const h = harness(['']);
  assert.equal(h.runtime.editEquations('14', '$$').result, 2);
  assert.equal(h.images[0].removed, false);
  assert.equal(h.runtime.removeAll('$$'), 0);
});

test('Slides restores legacy array metadata with the original delimiter', () => {
  const metadata = JSON.parse(equationTitle());
  const h = harness([JSON.stringify([0, 0, 0, metadata.origURL.replace('#0', '#2'), 14])]);
  assert.equal(h.runtime.removeAll('$$'), 1);
  assert.deepEqual(h.restored, ['$x+1$']);
});
