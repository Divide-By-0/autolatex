# Regression tests

Run `npm ci --ignore-scripts` and `npm test` from a clean checkout. GitHub
Actions runs the same commands for pull requests and pushes to master on Node 22.
Use `npm run test:docs` or `npm run test:slides` for the app-specific suites.

Coverage includes Docs delimiter pairing and image-insertion failure safety,
Slides delimiter pairing and MathJax background selection, shared MathJax
startup/render deadlines, and Workspace single-dollar rendering.

These are local Node tests with Apps Script contract doubles, not live Google
Docs/Slides integration tests. They do not prove image appearance, authorization,
or actual Google range behavior. Some older tests inspect source structure or
simulate round-trips; do not describe those as full render/de-render coverage.
Docs tests currently load the committed `Docs/Code.js`; keep it synchronized
with TypeScript changes. The Slides delimiter and Workspace tests compile tracked
TypeScript in memory through `helpers/compile-script.js`.

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
