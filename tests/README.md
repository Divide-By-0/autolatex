# Regression tests

Run `npm ci --ignore-scripts` and `npm test` from a clean checkout. GitHub
Actions runs the same commands for pull requests and pushes to master on Node 22.
Use `npm run test:docs` or `npm run test:slides` for the app-specific suites.

Coverage includes Docs delimiter pairing and image-insertion failure safety,
Slides delimiter pairing and MathJax background selection, shared MathJax
startup/render deadlines, and Workspace single-dollar rendering.

Slides de-render regressions exercise both public server actions with compiled
Common code (no runtime `DerenderResult` export), multiple/legacy images and
selection errors. Sidebar tests invoke both buttons through a failing RPC and
check that the real error is escaped, displayed, and the button re-enabled.
CI also builds the Slides sidebar. To replay against read-only downloads of an
Apps Script project and its pinned Common version, set `ALE_SLIDES_JS` and
`ALE_COMMON_JS` to their absolute `Code.js` paths and run
`node --test tests/slides-derender.test.js`.

The September de-render failure reproduced against remote Slides project HEAD
and Common v8: `Common.DerenderResult` was undefined at the selected-image
breakpoint despite one IMAGE in a PAGE_ELEMENT selection. The v7 deployment
inlines constants correctly, so this reproduction does not establish the
reporter's installed version. Keep the local Slides enum aligned with the
sidebar's `AutoLatexCommon.DerenderResult` values; full-program TypeScript builds
and isolated transpilation must both work.

These are local Node tests with Apps Script contract doubles, not live Google
Docs/Slides integration tests. They do not prove image appearance, authorization,
or actual Google range behavior. Some older tests inspect source structure or
simulate round-trips; do not describe those as full render/de-render coverage.
Docs pairing and matrix tests compile tracked TypeScript through `helpers/compile-script.js`;
the older image-placement safety test still reads committed `Docs/Code.js`.
The Slides delimiter and Workspace tests also compile tracked TypeScript in memory.

For interactive debugging, run, for example:

```sh
node inspect --port=19348 tests/workspace-dollar-pairing.test.js
```

Set a breakpoint with `sb(lineNumber)`, continue with `cont`, and inspect values
with `exec expression`. Use an unused port and exit the debugger when finished.

The initial clean-checkout run on `f26d04d` passed 29 tests and failed two:
the Workspace harness read ignored `Workspace/Docs.js`. A breakpoint at its
file read confirmed `exists: false` for input `$1$`. Compiling `Workspace/Docs.ts`
in memory fixes the harness dependency; both existing regression tests then pass.


## Renderer × delimiter × size matrix (PR #71)

`npm run test:matrix` exercises the public `replaceEquations` entry point in
Docs and Slides for **5 renderers × 5 delimiter selections × 2 sizes × 2 apps =
100 combinations**, with both `1+1=2` and `\frac{1+1}{2}=1`.
Options come from the shipped sidebar selectors; additions fail the inventory
assertion until coverage is reviewed. Renderer Automatic and size Automatic
are separate axes. The delimiter `All` input contains all four delimiter forms
in the same paragraph/text box, with surrounding prose.

The harness uses real Common/Docs/Slides parsing, source encoding, font/inline
selection, preference persistence, renderer ordering and request URL generation.
It asserts no network request for Automatic/MathJax, complete equation payloads,
correct delimiter IDs, server inline styling and prose preservation. It doubles
Apps Script document/slide objects, HTTP responses, and the final image placement
boundary. It is **not** a Google insertion, layout, or round-trip integration test.

```sh
npx playwright install chromium
npm run test:render-browser
```

The separate Chromium suite takes all **40 Automatic/MathJax combinations**
through the actual shared renderer, using the build's MathJax configuration and
locked local MathJax/font packages. Four sample equations (operators, text plus
relation, fraction, sum) produce **256 real SVG-to-canvas-to-PNG renders**,
including every member of `All`. Checks cover one SVG, required final glyphs,
no TeX errors, visible PNG ink, compact Inline fraction/sum layout, and identical
PNG hashes across delimiter/renderer selections for the same equation and size.
It generates `test-results/render-matrix/{docs,slides}-auto-inline.png` and a
JSON report with the revision, renderer source hash, dimensions, and PNG hashes.
The PR CI browser job runs it and uploads fresh evidence for each commit.
These screenshots show the real PNG output in a local gallery, **not a deployed
Google Docs or Slides page**. Host font samples are 11px/18px, shown at 2× zoom.

Regression control: write pre-fix `SidebarMathJaxShared.ts` to a temporary file,
then run `ALE_RENDERER_TS=/absolute/before.ts npm run test:render-browser`.
The pre-fix implementation fails on Docs / Automatic renderer / `$$` / Inline
because it returns three SVG fragments instead of one. The fixed source passes.

```sh
npm run test:render-services
```

This optional live smoke suite covers **every external-renderer combination the
sidebars still offer** (40 since Sciweavers was retired) with the two generic
equations. Identical URLs across apps/delimiters reuse the same response: 8
distinct requests instead of 160 duplicate image requests.
Requests have deadlines and three workers. It saves returned images, an
Auto/Inline screenshot, and explicit per-combination results under
`test-results/render-services/`. It exits nonzero for unavailable services and
never substitutes MathJax output or silently skips an unavailable renderer.
Decoded bytes alone cannot distinguish valid equations from provider error
artwork: inspect the saved screenshot. It tests the preferred endpoint, not all
provider fallback URLs. It is intentionally outside deterministic PR CI.

On 2026-09-17, Codecogs and Texrendr returned complete sample equations in both
size modes; Sciweavers returned **HTTP 404** for all four distinct sample requests.
This external-service failure is independent of the MathJax Inline fix.
See [review screenshots](evidence/pr71/README.md).

That 404 was not transient. sciweavers.org is still up, but it retired
`tex2img.php` — the GET image endpoint every Sciweavers renderer entry was built
on — so the renderer was removed from the sidebars and from the render order,
while staying available for de-rendering old equations. The probe has run clean
since: on 2026-09-18, 8 distinct requests, 0 unavailable. See
[what was verified](evidence/sciweavers-retired/README.md).
