const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const docsCodePath = path.join(__dirname, "..", "Docs", "Code.js");

function makeText(initialText, parent) {
  const text = {
    value: initialText,
    asText: () => text,
    copy: () => makeText(text.value, null),
    editAsText: () => text,
    getParent: () => parent,
    getText: () => text.value,
    deleteText(start, endInclusive) {
      text.value = text.value.slice(0, start) + text.value.slice(endInclusive + 1);
      return text;
    },
  };
  return text;
}

test("placeImage preserves LaTeX when Google Docs rejects image insertion", () => {
  const source = "Before $$x$$ after";
  let deleteCalls = 0;
  const paragraph = {
    getChildIndex: child => child === text ? 0 : -1,
    getParent: () => null,
    insertInlineImage() {
      throw new Error("Service unavailable: Documents");
    },
  };
  const text = makeText(source, paragraph);
  const originalDeleteText = text.deleteText;
  text.deleteText = (start, endInclusive) => {
    deleteCalls++;
    return originalDeleteText(start, endInclusive);
  };

  const context = {
    Common: { reportDeltaTime: () => {} },
    Set,
    Utilities: { sleep: () => {} },
    console: { error: () => {}, log: () => {}, warn: () => {} },
    escape,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(docsCodePath, "utf8"), context, {
    filename: docsCodePath,
  });

  const span = {
    getElement: () => text,
    getStartOffset: () => 7,
    getEndOffsetInclusive: () => 11,
  };

  assert.throws(
    () => context.placeImage(span, {}, [0, "", "", "", "", "MathJax"], "x", 11, ["$$", "$$", "", "", 2, 1, 0]),
    /original LaTeX was preserved/,
  );
  assert.equal(text.getText(), source);
  assert.equal(deleteCalls, 0);
});
