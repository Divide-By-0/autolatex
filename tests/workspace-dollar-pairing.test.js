const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const workspaceDocsPath = path.join(__dirname, "..", "Workspace", "Docs.js");
const singleDollarDelimiter = ["$", "$", "\\$", "\\$", 1, 0, 2];

function exerciseWorkspaceFindPos(text) {
  const textElement = { getText: () => text };
  const rangeElement = offset => ({
    getElement: () => textElement,
    getStartOffset: () => offset,
    getEndOffsetInclusive: () => offset,
  });
  const body = {
    findText: (_pattern, fromRange) => {
      const offset = text.indexOf("$", fromRange ? fromRange.getStartOffset() + 1 : 0);
      return offset < 0 ? null : rangeElement(offset);
    },
  };
  const context = {
    Common: {
      debugLog: () => {},
      reportDeltaTime: () => {},
    },
    console: {
      error: () => {},
      log: () => {},
      warn: () => {},
    },
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(workspaceDocsPath, "utf8"), context, {
    filename: workspaceDocsPath,
  });

  let placement;
  context.getBodyFromIndex = () => body;
  context.placeImage = (_startElement, start, end) => {
    placement = { start, end };
    return [11, null];
  };

  const result = context.findPos(0, singleDollarDelimiter, 900, 11, 11, true, null);
  return { placement, result };
}

test("Workspace Card path sends one-character dollar equations to the renderer", () => {
  assert.deepEqual(exerciseWorkspaceFindPos("$1$").placement, { start: 0, end: 2 });
  assert.deepEqual(exerciseWorkspaceFindPos("$2$").placement, { start: 0, end: 2 });
});

test("Workspace Card path still skips a genuinely empty dollar equation", () => {
  const { placement, result } = exerciseWorkspaceFindPos("$$");
  assert.equal(placement, undefined);
  assert.equal(result[0], 11);
  assert.ok(result[1], "the scan should advance past the empty equation");
});
