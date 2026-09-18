const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "..", "SidebarMathJaxShared.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

let mathJax;
test.before(async () => {
  mathJax = (await import("mathjax")).default;
  await mathJax.init({
    loader: { load: ["input/tex", "output/svg", "[tex]/color", "[tex]/upgreek", "[tex]/gensymb", "[tex]/boldsymbol"] },
    tex: { packages: { "[+]": ["color", "upgreek", "gensymb", "boldsymbol"] }, macros: { bm: ["\\boldsymbol{#1}", 1] } },
    svg: { fontCache: "none" },
  });
});

// Exercise the production renderer with real MathJax typesetting. Only adapt
// liteDOM's SVG lookup to the browser API and stop at the layout/canvas boundary;
// these tests do not pretend to verify Apps Script insertion or PNG pixels.
async function captureSelectedSvg(equation, inline = true, extraFragment = false) {
  const adaptor = mathJax.startup.adaptor;
  const reachedLayout = new Error("reached layout boundary");
  let selectedXml;
  let fragmentCount;
  const runtime = {
    window: {
      setTimeout, clearTimeout,
      MathJax: {
        svgStylesheet: () => ({}),
        tex2svgPromise: async (input, options) => {
          const result = await mathJax.tex2svgPromise(input, options);
          const fragments = adaptor.tags(result, "svg");
          if (extraFragment) fragments.push(fragments[0]);
          fragmentCount = fragments.length;
          const wrap = svg => ({
            xml: adaptor.serializeXML(svg),
            querySelector: () => null,
            classList: { add() {} },
            style: {},
          });
          return {
            querySelector: () => fragments.length ? wrap(fragments[0]) : null,
            querySelectorAll: () => fragments.map(wrap),
          };
        },
      },
    },
    document: { body: { appendChild(svg) {
      selectedXml = svg.xml;
      throw reachedLayout;
    } } },
  };
  vm.createContext(runtime);
  vm.runInContext(compiled, runtime, { filename: "production-mathjax.js" });
  try {
    await runtime.renderEquationPngWithMathJax({ equation, inline, size: 11, r: 0, g: 0, b: 0 });
    assert.fail("renderer unexpectedly bypassed layout");
  } catch (error) {
    if (error !== reachedLayout) throw error;
  }
  return { selectedXml, fragmentCount };
}

test("inline operator equation exports all terms in one SVG", async () => {
  const { selectedXml, fragmentCount } = await captureSelectedSvg("1+1=2");
  assert.match(selectedXml, /data-c="2B"/, "selected SVG must contain plus, not only the first 1");
  assert.match(selectedXml, /data-c="3D"/, "selected SVG must contain equals");
  assert.match(selectedXml, /data-c="32"/, "selected SVG must contain the final 2");
  assert.equal(fragmentCount, 1);
});

test("inline text followed by a relation exports its right-hand side", async () => {
  const { selectedXml, fragmentCount } = await captureSelectedSvg("\\text{Work} = F \\times d");
  assert.match(selectedXml, /data-c="3D"/);
  assert.match(selectedXml, /data-c="D7"/);
  assert.equal(fragmentCount, 1);
});

test("display equations, fractions and explicit multiline environments stay intact", async () => {
  for (const [equation, inline] of [
    ["1+1=2", false],
    ["\\frac{1+1}{2}", true],
    ["\\begin{aligned}a&=b\\\\c&=d\\end{aligned}", true],
    ["\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}", true],
    ["1+1=2 % trailing comment", true],
  ]) {
    const { selectedXml, fragmentCount } = await captureSelectedSvg(equation, inline);
    assert.equal(fragmentCount, 1, equation);
    assert.doesNotMatch(selectedXml, /data-mjx-error=/, equation);
  }
});

test("unexpected fragmented output fails visibly before rasterization", async () => {
  await assert.rejects(captureSelectedSvg("12", true, true), /2 SVG fragments/);
});
