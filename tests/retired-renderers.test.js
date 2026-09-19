const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { commonHarness, options } = require('./helpers/render-matrix');
const root = path.join(__dirname, '..');

// sciweavers.org retired tex2img.php, the GET endpoint all four Sciweavers renderer entries
// are built on. The site still loads and its editor still renders, which is exactly why this
// is easy to "fix" back to broken: someone checks the homepage, sees it up, and re-enables the
// renderer. These tests pin the two halves of the decision separately - dead for rendering,
// alive for de-rendering - so neither half can be undone by accident.
const RETIRED_HOSTS = ['sciweavers.org'];
const LEGACY_SCIWEAVERS_INDICES = [5, 7, 8, 11];
const stubApp = { newlineCharacter: '\n' };

function renderedUrls(prefs) {
  const harness = commonHarness();
  if (prefs) harness.common.savePrefs('smart', '$$', prefs);
  const delim = harness.common.getDelimiters('$$');
  harness.common.renderEquation('x%5E2', { ...harness.common.getDefaultRenderOptions(delim), delim });
  return harness.urls;
}

test('retired renderer families are excluded from the render order', () => {
  const { common } = commonHarness();
  const order = common.getRendererOrder();
  for (const worked of order) {
    assert.ok(!common.isRetiredRendererFamily(common.getRenderer(worked)[5]),
      `renderer ${worked} (${common.getRenderer(worked)[5]}) must not be attempted for rendering`);
  }
  // NOTE: Array.from, because these arrays are built inside the vm realm and deepStrictEqual
  // compares prototypes - a bare deepEqual against a host-realm literal fails on identical data.
  assert.deepEqual(Array.from(order), [1, 2, 3, 4, 6], 'Codecogs and Texrendr entries only');
  assert.deepEqual(Array.from(common.retiredRendererFamilies), ['Sciweavers', 'Sciweavers_old']);
});

test('rendering never requests a retired host', () => {
  for (const prefs of [undefined, 'auto', 'codecogs', 'texrendr', 'sciweavers']) {
    const harness = commonHarness();
    if (prefs) harness.common.savePrefs('smart', '$$', prefs);
    // Every URL the whole fallback chain could reach, not just the first renderer that
    // answers. The happy path stops at Codecogs, so a live render alone would pass even if
    // Sciweavers were still queued up behind it.
    const reachable = Array.from(harness.common.getRendererOrder())
      .flatMap(worked => [harness.common.getRenderer(worked)[1], harness.common.getRenderer(worked)[2]]);
    assert.ok(reachable.length > 0, `renderer=${prefs} must still have live renderers`);
    for (const url of reachable.concat(renderedUrls(prefs))) {
      for (const host of RETIRED_HOSTS) {
        assert.ok(!url.includes(host), `renderer=${prefs} could request ${host}: ${url}`);
      }
    }
  }
});

test('a saved Sciweavers preference is migrated to Automatic instead of failing', () => {
  const harness = commonHarness();
  harness.common.savePrefs('smart', '$$', 'sciweavers');
  // The dead value must not survive the round trip, or the next session reads it back.
  assert.equal(harness.prefs.renderer, 'auto');
  assert.equal(harness.common.getPreferredRenderer(), 'auto');
  assert.equal(harness.common.getPreferredRendererFamily('sciweavers'), '',
    'a retired family must never become the prioritized family');
});

test('equations rendered before the shutdown still de-render', () => {
  const { common } = commonHarness();
  for (const worked of LEGACY_SCIWEAVERS_INDICES) {
    const renderer = common.getRenderer(worked);
    assert.ok(common.isRetiredRendererFamily(renderer[5]), `renderer ${worked} is a retired family`);
    // %0 is the trailing delimiter marker a rendered equation link carries.
    const result = common.derenderEquation(`${renderer[2]}x%5E2%2B1%0`, stubApp);
    assert.equal(result.origEq, 'x^2+1', `renderer ${worked} must stay de-renderable`);
  }
  assert.ok(LEGACY_SCIWEAVERS_INDICES.every(worked => worked <= common.capableDerenderers));
});

test('no sidebar offers a retired renderer', () => {
  for (const app of ['Docs', 'Slides', 'Sheets']) {
    const renderers = options(app, 'renderer');
    assert.deepEqual(renderers.filter(r => r === 'sciweavers'), [], `${app} renderer selector`);
    assert.ok(renderers.includes('auto') && renderers.includes('texrendr'), `${app} keeps live renderers`);
    const sidebar = fs.readFileSync(path.join(root, app, 'Sidebar.ts'), 'utf8');
    // The selector no longer has a sciweavers <option>, so a saved value must be mapped to a
    // real one - otherwise jQuery .val() leaves the box blank and posts the dead choice back.
    assert.match(sidebar, /retiredOrDeprioritized[\s\S]{0,200}"sciweavers"/,
      `${app}/Sidebar.ts must map a saved sciweavers preference to Automatic`);
  }
});
