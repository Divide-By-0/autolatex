const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { compileScript } = require("./helpers/compile-script");

const filename = path.join(__dirname, "..", "Slides", "Code.ts");
const runtime = vm.createContext({});
vm.runInContext(compileScript(filename), runtime, { filename });

const single = ["$", "$", "\\$", "\\$", 1, 0, 2];
const double = ["$$", "$$", "\\$\\$", "\\$\\$", 2, 1, 0];

function equations(text, delimiter) {
  const result = [];
  let offset = 0;
  while (offset < text.length) {
    const span = runtime.findNextEquationOffsetsInSlide(text, delimiter, offset);
    if (!span) break;
    assert.ok(span.end + delimiter[4] > offset, "scanner must advance");
    result.push(text.slice(span.start + delimiter[4], span.end));
    offset = span.end + delimiter[4];
  }
  return result;
}

test("Slides preserves adjacent single-dollar equations and skips double dollars", () => {
  assert.deepEqual(equations("$1$ and $2$; $$x+y$$; $z$", single), ["1", "2", "z"]);
});

test("Slides ignores escaped dollars but accepts dollars after paired backslashes", () => {
  assert.deepEqual(equations(String.raw`cost \$5; $x$; \\$y$`, single), ["x", "y"]);
});

test("Slides stops at an unmatched opening delimiter", () => {
  assert.deepEqual(equations("$x$ then $unfinished", single), ["x"]);
});

test("Slides keeps double-dollar and asymmetric delimiter pairing", () => {
  assert.deepEqual(equations("$$a$$ and $$b$$", double), ["a", "b"]);
  const brackets = ["\\[", "\\]", "", "", 2, 1, 1];
  assert.deepEqual(equations(String.raw`before \[a+b\] after \[c\]`, brackets), ["a+b", "c"]);
});
