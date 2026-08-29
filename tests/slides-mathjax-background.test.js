const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const slidesTypeScriptSource = fs.readFileSync(
  path.join(__dirname, "..", "Slides", "Code.ts"),
  "utf8"
);
const slidesSource = ts.transpileModule(slidesTypeScriptSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function extractFunction(name) {
  const start = slidesSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name} in compiled Slides code`);
  const bodyStart = slidesSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < slidesSource.length; index++) {
    if (slidesSource[index] === "{") depth++;
    if (slidesSource[index] === "}") depth--;
    if (depth === 0) return slidesSource.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name} function`);
}

function createRuntime() {
  const context = {
    console,
    IntegratedApp: {
      getBody() {
        throw new Error("theme-color resolution is not used by these RGB fixtures");
      },
    },
    SlidesApp: {
      ColorType: { RGB: "RGB" },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    [
      "getBgRgbColor",
      "getShapeFillRgbColor",
      "isNearWhite",
      "getMathJaxBackgroundOptions",
    ].map(extractFunction).join("\n"),
    context
  );
  return context;
}

function rgbColor(red, green, blue) {
  return {
    getColorType: () => "RGB",
    asRgbColor: () => ({
      getRed: () => red,
      getGreen: () => green,
      getBlue: () => blue,
    }),
  };
}

function textRange(backgroundColor) {
  return {
    getTextStyle: () => ({
      getBackgroundColor: () => backgroundColor,
    }),
  };
}

function pageElement(fill) {
  return { getFill: () => fill };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Slides MathJax omits background fields for a box with no visible fill", () => {
  const runtime = createRuntime();
  const noFill = {
    isVisible: () => false,
    getSolidFill: () => {
      throw new Error("an invisible fill must not be sampled as white");
    },
  };

  const options = runtime.getMathJaxBackgroundOptions(
    textRange(null),
    pageElement(noFill),
    0
  );

  assert.deepEqual(plain(options), {});
  assert.equal(Object.hasOwn(options, "bgR"), false);
  assert.equal(Object.hasOwn(options, "bgG"), false);
  assert.equal(Object.hasOwn(options, "bgB"), false);
});

test("Slides MathJax omits background fields for an alpha-zero solid fill", () => {
  const runtime = createRuntime();
  const transparentSolid = {
    isVisible: () => true,
    getSolidFill: () => ({
      getAlpha: () => 0,
      getColor: () => rgbColor(20, 40, 60),
    }),
  };

  const options = runtime.getMathJaxBackgroundOptions(
    textRange(null),
    pageElement(transparentSolid),
    0
  );

  assert.deepEqual(plain(options), {});
});

test("Slides MathJax still bakes a genuinely colored opaque background", () => {
  const runtime = createRuntime();
  const coloredSolid = {
    isVisible: () => true,
    getSolidFill: () => ({
      getAlpha: () => 1,
      getColor: () => rgbColor(20, 40, 60),
    }),
  };

  const options = runtime.getMathJaxBackgroundOptions(
    textRange(null),
    pageElement(coloredSolid),
    0
  );

  assert.deepEqual(plain(options), { bgR: 20, bgG: 40, bgB: 60 });
});

test("both Slides MathJax extraction paths use the background-options gate", () => {
  assert.equal(
    (slidesTypeScriptSource.match(/const backgroundOptions = getMathJaxBackgroundOptions\(/g) || []).length,
    2
  );
  assert.equal((slidesTypeScriptSource.match(/\.\.\.backgroundOptions/g) || []).length, 2);
});
