const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const buildSidebarSource = fs.readFileSync(
  path.join(__dirname, "..", "BuildSidebarJS.js"),
  "utf8"
);
const sharedMathJaxSource = fs.readFileSync(
  path.join(__dirname, "..", "SidebarMathJaxShared.ts"),
  "utf8"
);

function prepareEquationForMathJax(equation) {
  const transpiled = ts.transpileModule(sharedMathJaxSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const context = {};
  vm.createContext(context);
  vm.runInContext(transpiled, context);
  context.rawEquationForTest = equation;
  return vm.runInContext(
    "prepareEquationForMathJax(rawEquationForTest)",
    context
  );
}

test("Docs and Slides sidebars use the MathJax release that fixes the Package getter crash", () => {
  assert.match(
    buildSidebarSource,
    /https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax@4\.1\.2\/tex-svg\.js/
  );
  assert.doesNotMatch(buildSidebarSource, /mathjax@3\/es5\/tex-svg\.js/);
});

test("the combined tex-svg component is not recursively loaded during startup", () => {
  assert.doesNotMatch(buildSidebarSource, /load:\s*\[[^\]]*['"]tex-svg['"]/);
});

test("small symbol packages are preloaded and bm delegates to boldsymbol", () => {
  assert.ok(
    buildSidebarSource.includes(
      "loader: { load: ['[tex]/color', '[tex]/upgreek', '[tex]/gensymb', '[tex]/boldsymbol'] }"
    ),
    "the MathJax loader should preload the supported symbol extensions"
  );
  assert.ok(
    buildSidebarSource.includes(
      "packages: { '[+]': ['color', 'upgreek', 'gensymb', 'boldsymbol'] }"
    ),
    "the TeX package list should match the explicitly loaded extensions"
  );
  assert.doesNotMatch(buildSidebarSource, /autoload:\s*\{/);
  assert.ok(
    buildSidebarSource.includes("bm: ['\\\\\\\\boldsymbol{#1}', 1]"),
    "\\bm should delegate to MathJax's boldsymbol implementation"
  );
});

test("Unicode Greek emitted by Common is normalized to MathJax's upright base command", () => {
  assert.equal(
    prepareEquationForMathJax("\\mupalpha + \\mupvarepsilon + \\mupOmega"),
    "\\mathup{α} + \\mathup{ε} + \\mathup{Ω}"
  );
  assert.equal(
    prepareEquationForMathJax("\\mupNotARealSymbol"),
    "\\mupNotARealSymbol"
  );
});
