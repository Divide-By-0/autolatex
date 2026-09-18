const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { compileScript } = require("./compile-script");
const docsCodePath = process.env.AUTOLATEX_DOCS_CODE_PATH || path.join(__dirname, "../..", "Docs/Code.ts");

// REASON: fromFind distinguishes a genuine findText() result from a range built by
// newRange().addElement() or read back from a NamedRange. Real Docs continues findText(pattern,
// from) STRICTLY AFTER a findText result's match, but from the START of a constructed range. That
// difference is the whole bug: for single-`$` a constructed whole-equation range starts at the
// opening delimiter, so the next search re-finds the equation's own closing `$` and pairs it
// forward. Only resuming from the closing-delimiter findText result advances correctly.
function createRangeElement(element, startOffset, endOffsetInclusive = startOffset, fromFind = false) {
  return {
    fromFind,
    getElement: () => element,
    getStartOffset: () => startOffset,
    getEndOffsetInclusive: () => endOffsetInclusive,
  };
}

function loadDocsCode(paragraphTexts, delimiter, common) {
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
      value: text,
      getText: () => textElement.value,
      deleteText(start, end) { textElement.value = textElement.value.slice(0, start) + textElement.value.slice(end + 1); },
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

  body.findText = (pattern, fromRange) => {
    const regex = new RegExp(pattern, "g");
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
      regex.lastIndex = searchFrom;
      const match = regex.exec(text);
      if (match) {
        const matchOffset = match.index;
        return createRangeElement(
          paragraphs[index].textElement,
          matchOffset,
          matchOffset + match[0].length - 1,
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
      const stored = range.getRangeElements()[0];
      renderedSpans.push({
        paragraphIndex: stored.getElement().paragraphIndex,
        start: stored.getStartOffset(),
        end: stored.getEndOffsetInclusive(),
      });
      const currentRangeElement = createRangeElement(
        stored.getElement(),
        stored.getStartOffset(),
        stored.getEndOffsetInclusive()
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
            endOffsetInclusive
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
    Common: common || {
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
  vm.runInContext(process.env.AUTOLATEX_DOCS_CODE_PATH
    ? fs.readFileSync(docsCodePath, "utf8") : compileScript(docsCodePath), context, {
    filename: docsCodePath,
  });

  return {
    context,
    delimiter,
    renderedSpans,
    paragraphs,
  };
}

module.exports = { loadDocsCode };
