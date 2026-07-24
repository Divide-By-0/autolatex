const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const docsCodePath = process.env.AUTOLATEX_DOCS_CODE_PATH ||
  path.join(__dirname, "..", "Docs", "Code.js");

// REASON: fromFind distinguishes a genuine findText() result from a range built by
// newRange().addElement() or read back from a NamedRange. Real Docs continues findText(pattern,
// from) STRICTLY AFTER a findText result's match, but from the START of a constructed range. That
// difference is the whole bug: for single-`$` a constructed whole-equation range starts at the
// opening delimiter, so the next search re-finds the equation's own closing `$` and pairs it
// forward. Only resuming from the closing-delimiter findText result advances correctly.
function createRangeElement(element, startOffset, endOffsetInclusive = startOffset, generation = 0, fromFind = false) {
  return {
    generation,
    fromFind,
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
      // Real Docs: continue AFTER a findText result's match, but from the START of a range that
      // was constructed (newRange / NamedRange). +1 in both cases because the search is exclusive
      // of the anchor position itself.
      offset = fromRange.fromFind
        ? fromRange.getEndOffsetInclusive() + 1
        : fromRange.getStartOffset() + 1;
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
          documentGeneration,
          true // this is a genuine findText result
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
  // REASON: record the document-order span each rendered equation occupies so a test can
  // reconstruct the de-render round-trip. De-render replaces every image with
  // delimiter+equation+delimiter, so the reconstructed text must equal the original. The
  // pairing bug renders the prose between two equations as its own image whose span abuts
  // its neighbours, so de-rendering collides their delimiters into "$$".
  const renderedSpans = [];
  const document = {
    addNamedRange: (_name, range) => {
      documentGeneration++;
      const stored = range.getRangeElements()[0];
      renderedSpans.push({
        paragraphIndex: stored.getElement().paragraphIndex,
        start: stored.getStartOffset(),
        end: stored.getEndOffsetInclusive(),
      });
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
    renderedSpans,
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

    // EmptyEquation (3): truly-empty or whitespace-only span. replaceEquations() skips it and
    // moves on; mirror that so these never appear in the rendered set.
    if (result.status === 3) {
      assert.ok(result.nextStartElement, "empty-equation skip must advance the cursor");
      cursor = result.nextStartElement;
      continue;
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

// REASON: reproduce the exact user-visible de-render symptom, not just the render pairing.
// Render each equation, then de-render every image the way removeAll() does — replace the
// image with delimiter[0] + storedEquation + delimiter[1], keeping the un-rendered text
// between images. The reconstructed document must equal the original. Under the pairing
// bug the prose between two equations is itself rendered, and its image span abuts both
// neighbours, so de-rendering collapses their delimiters together:
//   "Render $10000$ don't render $2000$"  ->  "Render $10000$$ don't render $$2000$"
//   "$1$ and $2$"                          ->  "$1$$ and $$2$"
function renderThenDerender(paragraphTexts, delimiter = delimiters.singleDollar) {
  const { context, renderedSpans } = loadDocsCode(paragraphTexts, delimiter);
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

  const rendered = [];
  let cursor = null;
  for (let iteration = 0; iteration < 20; iteration++) {
    const result = context.findPos(0, renderOptions, cursor);
    if (result.status === 7 || result.status === 6) break;
    if (result.status === 3) {
      // EmptyEquation: not rendered, no image placed - skip it in the reconstruction too.
      cursor = result.nextStartElement;
      continue;
    }
    assert.equal(result.status, 2, "expected a MathJax client-render result");
    // renderedSpans grows by exactly one entry per rendered equation, in call order.
    rendered.push({
      ...renderedSpans[renderedSpans.length - 1],
      eq: result.clientRenderOptions.equation,
    });
    cursor = result.nextStartElement;
    if (rendered.length > 40) assert.fail("delimiter scan did not terminate");
  }

  // Reconstruct each paragraph: walk left to right, emitting the un-rendered text before
  // each image, then delimiter+equation+delimiter for the image itself. slice() (not
  // substring) so an abutting/overlapping image span yields "" rather than swapping args.
  return paragraphTexts
    .map((text, paragraphIndex) => {
      const images = rendered
        .filter(image => image.paragraphIndex === paragraphIndex)
        .sort((a, b) => a.start - b.start);
      let out = "";
      let position = 0;
      for (const image of images) {
        out += text.slice(position, image.start);
        out += delimiter[0] + image.eq + delimiter[1];
        position = image.end + 1;
      }
      out += text.slice(position);
      return out;
    })
    .join("\n");
}

test("render then de-render round-trips currency-looking equations unchanged", () => {
  const original = "Render $10000$ don't render $2000$";
  assert.equal(renderThenDerender([original]), original);
});

test("render then de-render round-trips $1$ and $2$ unchanged", () => {
  const original = "$1$ and $2$";
  assert.equal(renderThenDerender([original]), original);
});

test("render then de-render round-trips the two-paragraph test document unchanged", () => {
  const paragraphs = ["Render $10000$ don't render $2000$", "$1$ and $2$"];
  assert.equal(renderThenDerender(paragraphs), paragraphs.join("\n"));
});

// REASON: a $...$ whose content is only whitespace typesets to a 0x0 SVG and crashes the
// client canvas (convertToBlob "OffscreenCanvas size is zero" -> "MathJax failed to render 1
// equation"). It must be skipped like an empty equation, not queued for rendering. Real inputs:
// a lone "\r" from an empty equation auto-merged across a paragraph break, or a "$ $" typo.
test("whitespace-only single-dollar equations are skipped, not rendered", () => {
  assert.deepEqual(collectClientEquations(["$1$ and $ $"]), ["1"]);
});

test("a carriage-return-only equation is skipped and does not break neighbours", () => {
  assert.deepEqual(collectClientEquations(["before $\r$ after"]), []);
  assert.deepEqual(collectClientEquations(["$x$ then $\r$ then $y$"]), ["x", "y"]);
});
