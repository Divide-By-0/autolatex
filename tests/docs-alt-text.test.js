const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const docsCodePath = path.join(__dirname, "..", "Docs", "Code.js");
const sidebarHtmlPath = path.join(__dirname, "..", "Docs", "Sidebar.html");
const sidebarTsPath = path.join(__dirname, "..", "Docs", "Sidebar.ts");

function loadDocsCode(overrides = {}) {
  const context = {
    Common: {
      DerenderResult: {
        EmptyEquation: 2,
        InvalidUrl: 0,
        NullUrl: 1,
        Success: 5,
      },
      debugLog: () => {},
      getClientEquation: equation => decodeURIComponent(equation),
      invalidEquationHashCodecogsFirst50: "never-matches",
      reportDeltaTime: () => {},
      sizeImage: () => {},
    },
    DocumentApp: {
      ElementType: {
        BODY_SECTION: "BODY_SECTION",
        TEXT: "TEXT",
      },
      getActiveDocument: () => ({ getBody: () => ({}) }),
      getUi: () => ({}),
    },
    Set,
    console: { error: () => {}, log: () => {}, warn: () => {} },
    decodeURIComponent,
    encodeURIComponent,
    escape,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(docsCodePath, "utf8"), context, {
    filename: docsCodePath,
  });
  return context;
}

function makeEndElement(text, closingDelimiterEnd) {
  const textElement = {
    asText: () => textElement,
    getText: () => text,
  };
  return {
    getElement: () => textElement,
    getEndOffsetInclusive: () => closingDelimiterEnd,
  };
}

test("custom alt-text suffix parsing supports balanced prose and rejects unsafe forms", () => {
  const context = loadDocsCode();

  const nested = context.getAccessibleAltTextSuffix(
    makeEndElement("$$x$$_{x squared (for {real} x)} trailing", 4),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(nested)),
    { description: "x squared (for {real} x)", endOffsetInclusive: 31 },
  );

  assert.equal(
    context.getAccessibleAltTextSuffix(makeEndElement("$$x$$_{}", 4)),
    null,
    "empty descriptions must remain ordinary document text",
  );
  assert.equal(
    context.getAccessibleAltTextSuffix(makeEndElement("$$x$$_{unfinished", 4)),
    null,
    "an unclosed suffix must never be consumed",
  );
  assert.equal(
    context.getAccessibleAltTextSuffix(makeEndElement("$$x$$ _{not adjacent}", 4)),
    null,
    "the opt-in syntax must be immediately adjacent",
  );
});

function makeImageHarness({ altSetterThrows = false } = {}) {
  const state = { altDescription: null, linkUrl: null };
  const image = {
    asInlineImage: () => image,
    getHeight: () => 100,
    getWidth: () => 200,
    setAltDescription(description) {
      if (altSetterThrows) throw new Error("alt metadata too large");
      state.altDescription = description;
      return image;
    },
    setLinkUrl(url) {
      state.linkUrl = url;
      return image;
    },
  };
  const paragraph = {
    getChild: () => image,
  };
  return { image, paragraph, state };
}

const mathJaxRenderer = [0, "", "https://example.test/equation?latex=", "", "", "MathJax"];
const doubleDollar = ["$$", "$$", "", "", 2, 1, 0];
const fakePng = { getDataAsString: () => "png" };

test("every rendered Docs equation receives raw LaTeX alt text without changing its link", () => {
  const context = loadDocsCode();
  const { paragraph, state } = makeImageHarness();

  const result = context.repairImage(
    paragraph,
    0,
    11,
    mathJaxRenderer,
    doubleDollar,
    fakePng,
    encodeURIComponent("\\frac{1}{2}"),
  );

  assert.equal(result.status, 8);
  assert.equal(state.altDescription, "\\frac{1}{2}");
  assert.equal(state.linkUrl, "https://example.test/equation?latex=%5Cfrac%7B1%7D%7B2%7D#0");
});

test("raw alt-text metadata failures never fail an otherwise valid render", () => {
  const context = loadDocsCode();
  const { paragraph, state } = makeImageHarness({ altSetterThrows: true });

  assert.doesNotThrow(() => context.repairImage(
    paragraph,
    0,
    11,
    mathJaxRenderer,
    doubleDollar,
    fakePng,
    encodeURIComponent("x"),
  ));
  assert.equal(state.linkUrl, "https://example.test/equation?latex=x#0");
});

test("custom suffix text becomes alt text and is marked for exact de-rendering", () => {
  const context = loadDocsCode();
  const { paragraph, state } = makeImageHarness();

  context.repairImage(
    paragraph,
    0,
    11,
    mathJaxRenderer,
    doubleDollar,
    fakePng,
    encodeURIComponent("x^2"),
    "x squared",
  );

  assert.equal(state.altDescription, "x squared");
  assert.equal(state.linkUrl, "https://example.test/equation?latex=x%5E2#0&ale_custom_alt=1");
});

test("custom alt-text metadata failures abort before authored suffix text can be removed", () => {
  const context = loadDocsCode();
  const { paragraph } = makeImageHarness({ altSetterThrows: true });

  assert.throws(
    () => context.repairImage(
      paragraph,
      0,
      11,
      mathJaxRenderer,
      doubleDollar,
      fakePng,
      encodeURIComponent("x^2"),
      "x squared",
    ),
    /alt metadata too large/,
  );
});

test("placeImage rolls back the image and preserves source text when custom alt text cannot be stored", () => {
  const context = loadDocsCode({ Utilities: { sleep: () => {} } });
  const source = "Before $$x$$_{x squared} after";
  const state = { imageRemoved: false };
  let text;
  const image = {
    asInlineImage: () => image,
    removeFromParent: () => {
      state.imageRemoved = true;
    },
    setAltDescription: () => {
      throw new Error("alt metadata rejected");
    },
    setLinkUrl: () => image,
  };
  const paragraph = {
    getChild: () => image,
    getChildIndex: child => child === text ? 0 : -1,
    getParent: () => null,
    insertInlineImage: () => image,
  };
  text = {
    asText: () => text,
    copy: () => ({
      asText() { return this; },
      editAsText() { return this; },
      deleteText() { return this; },
      getText: () => " after",
    }),
    editAsText: () => text,
    getParent: () => paragraph,
    getText: () => source,
    deleteText: () => {
      throw new Error("source text must not be deleted");
    },
  };
  const span = {
    getElement: () => text,
    getStartOffset: () => 7,
    getEndOffsetInclusive: () => 23,
  };

  assert.throws(
    () => context.placeImage(span, fakePng, mathJaxRenderer, encodeURIComponent("x"), 11, doubleDollar, "x squared"),
    /alt metadata rejected/,
  );
  assert.equal(text.getText(), source);
  assert.equal(state.imageRemoved, true);
});

function makeDerenderHarness({ linkUrl, altDescription }) {
  const state = { insertedText: null, removed: false };
  const parent = {
    getChildIndex: () => 0,
    insertText: (_index, text) => {
      state.insertedText = text;
    },
  };
  const image = {
    getAltDescription: () => altDescription,
    getLinkUrl: () => linkUrl,
    getParent: () => parent,
    removeFromParent: () => {
      state.removed = true;
    },
  };
  return { image, state };
}

test("de-render restores explicit custom suffixes but does not duplicate raw fallback alt text", () => {
  const context = loadDocsCode();
  context.Common.derenderEquation = url => {
    assert.equal(url, "https://example.test/equation?latex=x%5E2#0", "Docs marker must be stripped before Common decodes the URL");
    return { delim: doubleDollar, origEq: "x^2" };
  };

  const custom = makeDerenderHarness({
    linkUrl: "https://example.test/equation?latex=x%5E2#0&ale_custom_alt=1",
    altDescription: "x squared",
  });
  assert.equal(context.derenderInlineImage(custom.image, doubleDollar), 5);
  assert.equal(custom.state.insertedText, "$$x^2$$_{x squared}");
  assert.equal(custom.state.removed, true);

  const raw = makeDerenderHarness({
    linkUrl: "https://example.test/equation?latex=x%5E2#0",
    altDescription: "x^2",
  });
  assert.equal(context.derenderInlineImage(raw.image, doubleDollar), 5);
  assert.equal(raw.state.insertedText, "$$x^2$$");
});

test("De-render All also restores explicit custom suffixes", () => {
  const context = loadDocsCode();
  const custom = makeDerenderHarness({
    linkUrl: "https://example.test/equation?latex=x%5E2#0&ale_custom_alt=1",
    altDescription: "x squared",
  });
  const body = {
    getImages: () => [custom.image],
    getType: () => "BODY_SECTION",
  };
  const documentRoot = {
    getChild: () => body,
    getNumChildren: () => 1,
  };
  body.getParent = () => documentRoot;
  const document = { getBody: () => body };
  context.DocumentApp.getActiveDocument = () => document;
  context.Common.assert = condition => assert.equal(condition, true);
  context.Common.getDelimiters = () => doubleDollar;
  context.Common.derenderEquation = url => {
    assert.equal(url, "https://example.test/equation?latex=x%5E2#0");
    return { delim: doubleDollar, origEq: "x^2" };
  };

  assert.equal(context.removeAll("$$"), 1);
  assert.equal(custom.state.insertedText, "$$x^2$$_{x squared}");
  assert.equal(custom.state.removed, true);
});

test("the advanced Docs option is opt-in and is sent on every render batch", () => {
  const html = fs.readFileSync(sidebarHtmlPath, "utf8");
  const source = fs.readFileSync(sidebarTsPath, "utf8");

  assert.match(html, /id="divDelimiters"[\s\S]*id="custom-alt-text"/);
  assert.match(html, /\$\$x\^2\$\$_\{x squared\}/);
  assert.match(html, /raw LaTeX is used as alt text/);
  assert.match(source, /choicePrefs\.customAltText === true/);
  assert.equal(
    [...source.matchAll(/\.replaceEquations\(sizeRaw, delimiter, renderer, customAltText\)/g)].length,
    2,
    "both the initial request and chained MathJax batches must keep the option",
  );
});
