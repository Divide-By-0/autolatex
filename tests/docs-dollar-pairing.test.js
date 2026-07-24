const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const docsCodePath = process.env.AUTOLATEX_DOCS_CODE_PATH ||
  path.join(__dirname, "..", "Docs", "Code.js");

function createRangeElement(element, startOffset, endOffsetInclusive = startOffset, generation = 0) {
  return {
    generation,
    getElement: () => element,
    getStartOffset: () => startOffset,
    getEndOffsetInclusive: () => endOffsetInclusive,
  };
}

function loadDocsCode(paragraphTexts, delimiter) {
  const elementTypes = {
    BODY_SECTION: "BODY_SECTION",
    FOOTER_SECTION: "FOOTER_SECTION",
    FOOTNOTE_SECTION: "FOOTNOTE_SECTION",
    HEADER_SECTION: "HEADER_SECTION",
    PARAGRAPH: "PARAGRAPH",
    TEXT: "TEXT",
  };

  const body = {
    getType: () => elementTypes.BODY_SECTION,
  };
  const paragraphs = paragraphTexts.map((text, paragraphIndex) => {
    const paragraph = {
      getParent: () => body,
      getType: () => elementTypes.PARAGRAPH,
    };
    const textElement = {
      asText: () => textElement,
      getBackgroundColor: () => null,
      getFontSize: () => 11,
      getForegroundColor: () => "#000000",
      getParent: () => paragraph,
      getText: () => text,
      getType: () => elementTypes.TEXT,
      paragraphIndex,
    };
    paragraph.getNumChildren = () => 1;
    paragraph.getChild = () => textElement;
    paragraph.textElement = textElement;
    return paragraph;
  });

  body.getChildIndex = paragraph => paragraphs.indexOf(paragraph);
  body.getParent = () => sectionRoot;

  // REASON: adding a named range can invalidate RangeElement search results that were
  // obtained before the document mutation. The production failure presents as an
  // inclusive resume from that stale result: the just-used closing "$" is returned
  // again and becomes the next opening delimiter. A current RangeElement resumes
  // after its inclusive end, matching the findText(..., from) "next result" contract.
  let documentGeneration = 0;
  body.findText = (pattern, fromRange) => {
    const token = pattern === delimiter[3] ? delimiter[1] : delimiter[0];
    let paragraphIndex = 0;
    let offset = 0;
    if (fromRange) {
      paragraphIndex = fromRange.getElement().paragraphIndex;
      offset = fromRange.generation < documentGeneration
        ? fromRange.getStartOffset()
        : fromRange.getEndOffsetInclusive() + 1;
    }

    for (let index = paragraphIndex; index < paragraphs.length; index++) {
      const text = paragraphs[index].textElement.getText();
      const searchFrom = index === paragraphIndex ? offset : 0;
      const matchOffset = text.indexOf(token, searchFrom);
      if (matchOffset >= 0) {
        return createRangeElement(
          paragraphs[index].textElement,
          matchOffset,
          matchOffset + token.length - 1,
          documentGeneration
        );
      }
    }
    return null;
  };

  const sectionRoot = {
    getChild: index => index === 0 ? body : null,
    getNumChildren: () => 1,
  };

  let namedRangeId = 0;
  const document = {
    addNamedRange: (_name, range) => {
      documentGeneration++;
      const stored = range.getRangeElements()[0];
      const currentRangeElement = createRangeElement(
        stored.getElement(),
        stored.getStartOffset(),
        stored.getEndOffsetInclusive(),
        documentGeneration
      );
      return {
        getId: () => `range-${++namedRangeId}`,
        getRange: () => ({
          getRangeElements: () => [currentRangeElement],
        }),
      };
    },
    getBody: () => body,
    newRange: () => {
      let rangeElement;
      return {
        addElement: (element, startOffset, endOffsetInclusive) => {
          rangeElement = createRangeElement(
            element,
            startOffset,
            endOffsetInclusive,
            documentGeneration
          );
          return {
            build: () => ({
              getRangeElements: () => [rangeElement],
            }),
          };
        },
      };
    },
  };

  const context = {
    Common: {
      assert: (condition, message) => assert.ok(condition, message),
      debugLog: () => {},
      getClientEquation: equation => decodeURIComponent(equation),
      reEncode: equation => encodeURIComponent(equation),
      reportDeltaTime: () => {},
    },
    DocumentApp: {
      ElementType: elementTypes,
      getActiveDocument: () => document,
    },
    console: {
      error: () => {},
      log: () => {},
      warn: () => {},
    },
    decodeURIComponent,
    encodeURIComponent,
    escape,
    Set,
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(docsCodePath, "utf8"), context, {
    filename: docsCodePath,
  });

  return {
    context,
    delimiter,
  };
}

const delimiters = {
  doubleDollar: ["$$", "$$", "\\$\\$", "\\$\\$", 2, 1, 0],
  brackets: ["\\[", "\\]", "\\\\\\[", "\\\\\\]", 2, 1, 1],
  singleDollar: ["$", "$", "\\$", "\\$", 1, 0, 2],
  parentheses: ["\\(", "\\)", "\\\\\\(", "\\\\\\)", 2, 1, 3],
};

function collectClientEquations(paragraphTexts, delimiter = delimiters.singleDollar) {
  const { context } = loadDocsCode(paragraphTexts, delimiter);
  const renderOptions = {
    size: 11,
    defaultSize: 11,
    inline: false,
    delim: delimiter,
    clientRender: true,
    autoFallbackToClient: false,
    r: 0,
    g: 0,
    b: 0,
  };

  const equations = [];
  let cursor = null;
  for (let iteration = 0; iteration < 20; iteration++) {
    const result = context.findPos(0, renderOptions, cursor);
    if (result.status === 7 || result.status === 6) {
      return equations;
    }

    assert.equal(result.status, 2, "expected a MathJax client-render result");
    assert.ok(result.nextStartElement, "the batch scan must advance its cursor");
    equations.push(result.clientRenderOptions.equation);
    cursor = result.nextStartElement;
  }

  assert.fail("delimiter scan did not terminate");
}

test("MathJax batch keeps adjacent inline equations paired", () => {
  assert.deepEqual(
    collectClientEquations(["$1$ and $2$"]),
    ["1", "2"],
  );
});

test("single-dollar scanning does not consume double-dollar delimiters", () => {
  assert.deepEqual(
    collectClientEquations(["$$block$$ and $inline$"]),
    ["inline"],
  );
});

test("the cursor fix preserves double-dollar equation pairing", () => {
  assert.deepEqual(
    collectClientEquations(
      ["Before $$a+b$$ between $$c$$ after"],
      delimiters.doubleDollar,
    ),
    ["a+b", "c"],
  );
});

test("the cursor fix preserves bracket-delimited equation pairing", () => {
  assert.deepEqual(
    collectClientEquations(
      ["Before \\[a+b\\] between \\[c\\] after"],
      delimiters.brackets,
    ),
    ["a+b", "c"],
  );
});

test("the cursor fix preserves parenthesis-delimited equation pairing", () => {
  assert.deepEqual(
    collectClientEquations(
      ["Before \\(a+b\\) between \\(c\\) after"],
      delimiters.parentheses,
    ),
    ["a+b", "c"],
  );
});

test("MathJax batch does not pair prose between currency-looking equations", () => {
  assert.deepEqual(
    collectClientEquations(["Render $10000$ don't render $2000$"]),
    ["10000", "2000"],
  );
});

test("MathJax batch preserves pairing across the two test-document paragraphs", () => {
  assert.deepEqual(
    collectClientEquations([
      "Render $10000$ don't render $2000$",
      "$1$ and $2$",
    ]),
    ["10000", "2000", "1", "2"],
  );
});
