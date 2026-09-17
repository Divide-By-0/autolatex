const assert = require("node:assert/strict");
const test = require("node:test");
const { loadDocsCode } = require("./helpers/docs-scan");

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
