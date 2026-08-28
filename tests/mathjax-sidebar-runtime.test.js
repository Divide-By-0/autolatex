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
const docsSidebarSource = fs.readFileSync(
  path.join(__dirname, "..", "Docs", "Sidebar.ts"),
  "utf8"
);

function loadSharedMathJaxRuntime(context = {}) {
  const transpiled = ts.transpileModule(sharedMathJaxSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  context.window ||= {
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(transpiled, context);
  return context;
}

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

test("a permanently pending MathJax startup is rejected and can be retried", async () => {
  const runtime = loadSharedMathJaxRuntime({
    window: {
      setTimeout,
      clearTimeout,
      MathJax: {
        startup: { promise: new Promise(() => {}) },
        tex2svgPromise: async () => ({}),
        svgStylesheet: () => ({}),
      },
    },
  });

  await assert.rejects(
    vm.runInContext("waitForMathJaxStartup(20)", runtime),
    error => error?.name === "MathJaxTimeoutError" && /while starting/.test(error.message)
  );

  runtime.window.MathJax = {
    tex2svgPromise: async () => ({}),
    svgStylesheet: () => ({}),
  };
  assert.equal(
    await vm.runInContext("waitForMathJaxStartup(20)", runtime),
    runtime.window.MathJax,
    "the rejected cached startup wait must not poison a retry"
  );
});

test("a slow but healthy MathJax startup completes before its deadline", async () => {
  let finishStartup;
  const startupPromise = new Promise(resolve => {
    finishStartup = resolve;
  });
  const runtime = loadSharedMathJaxRuntime({
    window: {
      setTimeout,
      clearTimeout,
      MathJax: {
        startup: { promise: startupPromise },
        tex2svgPromise: async () => ({}),
        svgStylesheet: () => ({}),
      },
    },
  });

  setTimeout(finishStartup, 30);
  assert.equal(
    await vm.runInContext("waitForMathJaxStartup(200)", runtime),
    runtime.window.MathJax
  );
});

test("a stalled render stage rejects instead of remaining pending", async () => {
  const runtime = loadSharedMathJaxRuntime();
  runtime.neverSettles = new Promise(() => {});

  await assert.rejects(
    vm.runInContext(
      "withMathJaxTimeout(neverSettles, 20, 'typesetting an equation')",
      runtime
    ),
    error => error?.name === "MathJaxTimeoutError" && /typesetting an equation/.test(error.message)
  );
});

test("slow successful work still resolves before its deadline", async () => {
  const runtime = loadSharedMathJaxRuntime();
  runtime.slowSuccess = new Promise(resolve => setTimeout(() => resolve("rendered"), 30));

  assert.equal(
    await vm.runInContext(
      "withMathJaxTimeout(slowSuccess, 200, 'typesetting an equation')",
      runtime
    ),
    "rendered"
  );
});

test("large equations receive a substantially larger render budget", () => {
  const runtime = loadSharedMathJaxRuntime();
  assert.equal(vm.runInContext("getMathJaxEquationTimeoutMs(0)", runtime), 120000);
  assert.equal(vm.runInContext("getMathJaxEquationTimeoutMs(1000)", runtime), 370000);
  assert.equal(vm.runInContext("getMathJaxEquationTimeoutMs(100000)", runtime), 900000);
});

test("typesetting, SVG loading, and PNG export all use the equation deadline", () => {
  assert.match(
    sharedMathJaxSource,
    /withMathJaxTimeout\(\s*mathJaxGlobal\.tex2svgPromise\(/,
    "MathJax typesetting should not be able to hang forever"
  );
  assert.match(
    sharedMathJaxSource,
    /withMathJaxTimeout\(imageLoad, equationTimeoutMs/,
    "SVG image decoding should not be able to hang forever"
  );
  assert.match(
    sharedMathJaxSource,
    /withMathJaxTimeout\(pngExport, equationTimeoutMs/,
    "canvas PNG export should not be able to hang forever"
  );
});

test("Docs falls back in Automatic mode and surfaces explicit MathJax timeout details", () => {
  assert.match(
    docsSidebarSource,
    /renderer === "auto"[\s\S]*?\.clientRenderFailed\(failed\)/,
    "Automatic mode should continue sending timed-out equations to Texrendr fallback"
  );
  assert.match(
    docsSidebarSource,
    /timeoutErrorMessage \|\| `MathJax failed to render/,
    "explicit MathJax mode should show the stage-specific timeout message"
  );
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
