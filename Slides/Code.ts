/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)

/* exported onOpen, showSidebar, replaceEquations */

/* global Common, SlidesApp */

type PageElement = GoogleAppsScript.Slides.Shape | GoogleAppsScript.Slides.TableCell;

interface DerenderData {
  red: number,
  green: number,
  blue: number,
  origURL: string,
  size: number,
  width: number,
  height: number
}

interface SlidesClientRenderOptions {
  size: number;
  inline: boolean;
  r: number;
  g: number;
  b: number;
  bgR?: number;
  bgG?: number;
  bgB?: number;
  delim: AutoLatexCommon.Delimiter;
  equation: string;
  equationLinkEncoded: string;
  slideId: string;
  pageElementId: string;
  tableRow?: number;
  tableColumn?: number;
  rangeStart: number;
  rangeEnd: number;
  // Estimated position of the equation inside its text box, in points from the box's top-left.
  // Computed at scan time (drift-free) so placement can put each image roughly where its source
  // text was instead of stacking them all in the box corner. See estimateInBoxOffset.
  posDx?: number;
  posDy?: number;
}

interface SlidesClientRenderPayload {
  options: SlidesClientRenderOptions;
  renderedEquationB64: string;
}

const enum SlidesEquationRenderStatus {
  AllRenderersFailed,
  ClientRender,
  NoPresentation,
  Success,
  // REASON: Distinguish UrlFetchApp authorization errors from generic renderer failure
  // so the sidebar can show a "reinstall and click Select all" message instead of the
  // misleading "an equation is incorrect" copy. Must be appended; const enum order is
  // load-bearing because SlidesClientRenderStatus in Sidebar.ts must produce the same
  // numeric values when both files are compiled independently.
  AuthorizationFailed,
}

interface SlidesEquationRenderResult {
  lastStatus: SlidesEquationRenderStatus;
  successCount: number;
  clientEquations?: SlidesClientRenderOptions[];
}

const IntegratedApp = {
  getUi: function () {
    return SlidesApp.getUi();
  },
  getBody: function () {
    return SlidesApp.getActivePresentation().getSlides();
  },
  getActive: function () {
    return SlidesApp.getActivePresentation();
  },
  getPageWidth: function () {
    return SlidesApp.getActivePresentation().getPageWidth();
  },
  // Shift-enter in slides produces \x0B, or \v
  newlineCharacter: "%0B"
} satisfies AutoLatexCommon.IntegratedApp;


/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param _e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(_e: object) {
  IntegratedApp.getUi().createAddonMenu().addItem("Start", "showSidebar").addToUi();
}

/**
 * Runs when the add-on is installed.
 *
 * @param e The event parameter for a simple onInstall trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode. (In practice, onInstall triggers always
 *     run in AuthMode.FULL, but onOpen triggers may be AuthMode.LIMITED or
 *     AuthMode.NONE.)
 */
function onInstall(e: object) {
  onOpen(e);
}

/**
 * Opens a sidebar in the document containing the add-on's user interface.
 */
function showSidebar() {
  const ui = HtmlService.createTemplateFromFile("Sidebar").evaluate().setTitle("Auto-LaTeX Equations").setSandboxMode(HtmlService.SandboxMode.IFRAME); // choose mode IFRAME which is fastest option
  IntegratedApp.getUi().showSidebar(ui);
}

/**
 * @public
 */
function getPrefs() {
  return Common.getPrefs();
}

/**
 * @public
 */
function logMathJaxClientError(payloadJson: string) {
  console.error("MathJax client error:", payloadJson);
}

/**
 * @public
 */
function getKey() {
  return Common.getKey();
}

/**
 * Find the position of a delimeter from a starting point.
 */

function findTextOffsetInSlide(str: string, search: string, offset = 0) {
  Common.debugLog("str: " + str.substring(offset) + " search: " + search);
  return str.substring(offset).indexOf(search) + offset;
}

function isTable(element: GoogleAppsScript.Slides.Table | GoogleAppsScript.Slides.Shape | GoogleAppsScript.Slides.Group): element is GoogleAppsScript.Slides.Table {
  return element.getPageElementType() === SlidesApp.PageElementType.TABLE;
}

function isTableCell(element: PageElement): element is GoogleAppsScript.Slides.TableCell {
  return "getParentTable" in element;
}


/**
 * Constantly keep replacing latex till all are finished
 * @public
 */
function replaceEquations(sizeRaw: string, delimiter: string, renderer: string = "auto") {
  const quality = 900;
  const clientRender = renderer === "mathjax";
  // REASON: In auto mode, start with MathJax on the client (never Codecogs first —
  // both because a Codecogs outage can hang UrlFetchApp long enough for
  // google.script.run to surface the generic "reload" error, and because it avoids
  // sending equation contents to external renderer APIs unless MathJax hard-fails;
  // PR #61 wanted no server fallback at all, but keeping Texrendr/Sciweavers as the
  // sidebar-invoked fallback preserves rendering when MathJax can't load).
  const autoFallback = renderer === "auto";
  let size = Common.getSize(sizeRaw);
  let isInline = false;
  if (size < 0) {
    isInline = true;
    size = 0;
  }
  Common.reportDeltaTime(140);
  const delimiterSet = Common.getDelimiterSet(delimiter);
  Common.savePrefs(sizeRaw, delimiter, renderer);
  let c = 0; //counter
  const defaultSize = 11;
  Common.reportDeltaTime(146);

  // base render options common to all equations rendered
  const renderOptions: AutoLatexCommon.RenderOptions = {
    r: 0, g: 0, b: 0,
    delim: delimiterSet[0],
    defaultSize,
    size,
    inline: isInline,
    clientRender
  };

  // this can error if there are ungranted permissions
  try {
    IntegratedApp.getActive();
  } catch (error) {
    console.error(error);
    if (clientRender || autoFallback) {
      return {
        lastStatus: SlidesEquationRenderStatus.NoPresentation,
        successCount: 0
      };
    }
    return Common.encodeFlag(-1, 0);
  }

  if (clientRender) {
    const clientEquation = findClientRenderEquationForDelimiters(renderOptions, delimiterSet);
    if (!clientEquation) {
      return {
        lastStatus: SlidesEquationRenderStatus.Success,
        successCount: 0
      };
    }
    return {
      lastStatus: SlidesEquationRenderStatus.ClientRender,
      successCount: 0,
      clientEquations: [clientEquation]
    };
  }

  // REASON: Auto mode sends all equations to client MathJax first. The old
  // Codecogs-first phase could block the entire action during a Codecogs outage,
  // preventing the MathJax fallback from ever running.
  if (autoFallback) {
    const clientEquations = findAllClientRenderEquationsForDelimiters(renderOptions, delimiterSet);
    if (clientEquations.length === 0) {
      return {
        lastStatus: SlidesEquationRenderStatus.Success,
        successCount: c
      };
    }
    return {
      lastStatus: SlidesEquationRenderStatus.ClientRender,
      successCount: c,
      clientEquations
    };
  }

  for (const delim of delimiterSet) {
    const slides = IntegratedApp.getBody();
    const childCount = slides.length;
    for (let slideNum = 0; slideNum < childCount; slideNum++) {
      const elements = slides[slideNum].getPageElements();
      Common.debugLog("Slide Num: " + slideNum + " Num of shapes: " + elements.length);
      for (const element of elements) {
        const castedElement = castElement(element);
        // if we don't recognize this element
        if (castedElement === null) continue;

        c += renderElement(slideNum, castedElement, {
          ...renderOptions,
          delim
        });
      }
    }
  }
  return Common.encodeFlag(0, c);
}

function findClientRenderEquationForDelimiters(
  renderOptions: AutoLatexCommon.RenderOptions,
  delimiterSet: AutoLatexCommon.Delimiter[]
): SlidesClientRenderOptions | null {
  for (const delim of delimiterSet) {
    const clientEquation = findClientRenderEquation({
      ...renderOptions,
      delim
    });
    if (clientEquation) {
      return clientEquation;
    }
  }
  return null;
}

function findClientRenderEquation(renderOptions: AutoLatexCommon.RenderOptions): SlidesClientRenderOptions | null {
  const slides = IntegratedApp.getBody();
  for (let slideNum = 0; slideNum < slides.length; slideNum++) {
    const slide = slides[slideNum];
    for (const element of slide.getPageElements()) {
      const castedElement = castElement(element);
      if (!castedElement) {
        continue;
      }
      const clientEquation = findClientRenderEquationInElement(slideNum, slide, castedElement, renderOptions);
      if (clientEquation) {
        return clientEquation;
      }
    }
  }
  return null;
}

/**
 * Find ALL equations in the presentation that need client-side rendering.
 * Unlike findClientRenderEquation which returns the first one, this collects all of them
 * for batch processing (parallel MathJax rendering).
 */
function findAllClientRenderEquations(renderOptions: AutoLatexCommon.RenderOptions): SlidesClientRenderOptions[] {
  const results: SlidesClientRenderOptions[] = [];
  const slides = IntegratedApp.getBody();
  for (let slideNum = 0; slideNum < slides.length; slideNum++) {
    const slide = slides[slideNum];
    for (const element of slide.getPageElements()) {
      const castedElement = castElement(element);
      if (!castedElement) continue;
      findAllClientRenderEquationsInElement(slideNum, slide, castedElement, renderOptions, results);
    }
  }
  return results;
}

function findAllClientRenderEquationsForDelimiters(
  renderOptions: AutoLatexCommon.RenderOptions,
  delimiterSet: AutoLatexCommon.Delimiter[]
): SlidesClientRenderOptions[] {
  const results: SlidesClientRenderOptions[] = [];
  for (const delim of delimiterSet) {
    results.push(...findAllClientRenderEquations({
      ...renderOptions,
      delim
    }));
  }
  return results;
}

function findAllClientRenderEquationsInElement(
  slideNum: number,
  slide: GoogleAppsScript.Slides.Slide,
  element: GoogleAppsScript.Slides.Group | GoogleAppsScript.Slides.Table | GoogleAppsScript.Slides.Shape,
  renderOptions: AutoLatexCommon.RenderOptions,
  results: SlidesClientRenderOptions[]
) {
  if ("ungroup" in element) {
    for (const childElement of element.getChildren()) {
      const castedPageElement = castElement(childElement);
      if (!castedPageElement) continue;
      findAllClientRenderEquationsInElement(slideNum, slide, castedPageElement, renderOptions, results);
    }
    return;
  }

  if (isTable(element)) {
    for (let row = 0; row < element.getNumRows(); row++) {
      for (let column = 0; column < element.getNumColumns(); column++) {
        const cell = element.getCell(row, column);
        if (cell.getMergeState() === SlidesApp.CellMergeState.MERGED) continue;
        findAllClientRenderEquationsInTextElement(slideNum, slide, cell, renderOptions, results);
      }
    }
    return;
  }

  findAllClientRenderEquationsInTextElement(slideNum, slide, element, renderOptions, results);
}

function findAllClientRenderEquationsInTextElement(
  slideNum: number,
  slide: GoogleAppsScript.Slides.Slide,
  textElement: PageElement,
  renderOptions: AutoLatexCommon.RenderOptions,
  results: SlidesClientRenderOptions[]
) {
  const textRange = unwrapEQ(textElement);
  if (!textRange) return;

  const renderedText = textRange.asRenderedString();
  let searchOffset = 0;

  while (searchOffset < renderedText.length) {
    const equationOffsets = findNextEquationOffsetsInSlide(renderedText, renderOptions.delim, searchOffset);
    if (!equationOffsets) break;

    const endOffset = Math.min(textRange.getLength(), equationOffsets.end + renderOptions.delim[4]);
    const equationRange = textRange.getRange(equationOffsets.start, endOffset);
    const equationOriginal = getEquation(equationRange, renderOptions.delim);
    // REASON: skip empty AND whitespace-only equations (e.g. a lone line break). They typeset
    // to a 0x0 SVG and would crash the shared client canvas renderer. Mirrors the Docs findPos
    // guard so no surface sends a blank equation to MathJax.
    if (!equationOriginal || equationOriginal.trim() === "") {
      searchOffset = equationOffsets.end + renderOptions.delim[4];
      continue;
    }

    const size = getSlideTextSize(renderOptions.size, renderOptions.defaultSize, equationRange);
    const colorRangeEnd = Math.max(equationOffsets.start + renderOptions.delim[4], equationOffsets.end);
    const textColor = getRgbColor(textRange.getRange(equationOffsets.start + renderOptions.delim[4], colorRangeEnd), slideNum);
    const bgColor = getBgRgbColor(textRange.getRange(equationOffsets.start + renderOptions.delim[4], colorRangeEnd), slideNum) || getShapeFillRgbColor(textElement, slideNum);
    // REASON: collapse the encoded four-backslash newline marker in ENCODED space
    // (like the Codecogs path); the old decoded-space `.replace(/\\\\/g, "\\")`
    // halved every backslash pair and broke "\\\hline" in tables ("Misplaced
    // \hline" after a derender round-trip) and align/matrix row breaks.
    const clientEquation = Common.getClientEquation(equationOriginal, IntegratedApp);
    const eqOffset = estimateInBoxOffset(renderedText.substring(0, equationOffsets.start), size, getBounds(textElement).width);

    results.push({
      size,
      inline: renderOptions.inline,
      r: textColor[0],
      g: textColor[1],
      b: textColor[2],
      ...(bgColor ? { bgR: bgColor[0], bgG: bgColor[1], bgB: bgColor[2] } : {}),
      delim: renderOptions.delim,
      equation: clientEquation,
      equationLinkEncoded: encodeURIComponent(clientEquation),
      slideId: slide.getObjectId(),
      pageElementId: getTargetObjectId(textElement),
      tableRow: isTableCell(textElement) ? textElement.getRowIndex() : undefined,
      tableColumn: isTableCell(textElement) ? textElement.getColumnIndex() : undefined,
      rangeStart: equationOffsets.start,
      rangeEnd: endOffset,
      posDx: eqOffset.dx,
      posDy: eqOffset.dy
    });

    searchOffset = equationOffsets.end + renderOptions.delim[4];
  }
}

function castElement(element: GoogleAppsScript.Slides.PageElement) {
  let elementType: GoogleAppsScript.Slides.PageElementType;
  try {
    // type = element.getPageElementType();
    elementType = element.getPageElementType();
    Common.debugLog("Element Type is:" + elementType + " object ID is:" + element.getObjectId());
  } catch {
    Common.debugLog("Not of type shape");
    return null;
  }
  
  if (elementType === SlidesApp.PageElementType.SHAPE) {
    // handles alternating footers etc.
    return element.asShape();
  } else if (elementType === SlidesApp.PageElementType.TABLE) {
    return element.asTable();
  } else if (elementType === SlidesApp.PageElementType.GROUP) {
    return element.asGroup();
  }
  return null;
}

function findClientRenderEquationInElement(
  slideNum: number,
  slide: GoogleAppsScript.Slides.Slide,
  element: GoogleAppsScript.Slides.Group | GoogleAppsScript.Slides.Table | GoogleAppsScript.Slides.Shape,
  renderOptions: AutoLatexCommon.RenderOptions
) {
  if ("ungroup" in element) {
    for (const childElement of element.getChildren()) {
      const castedPageElement = castElement(childElement);
      if (!castedPageElement) {
        continue;
      }
      const clientEquation = findClientRenderEquationInElement(slideNum, slide, castedPageElement, renderOptions);
      if (clientEquation) {
        return clientEquation;
      }
    }
    return null;
  }

  if (isTable(element)) {
    for (let row = 0; row < element.getNumRows(); row++) {
      for (let column = 0; column < element.getNumColumns(); column++) {
        const cell = element.getCell(row, column);
        if (cell.getMergeState() === SlidesApp.CellMergeState.MERGED) {
          continue;
        }
        const clientEquation = findClientRenderEquationInTextElement(slideNum, slide, cell, renderOptions);
        if (clientEquation) {
          return clientEquation;
        }
      }
    }
    return null;
  }

  return findClientRenderEquationInTextElement(slideNum, slide, element, renderOptions);
}

/**
 * This reverses the findpos return logic from docs to make it more accurate
 * @param element Element to search for equations
 * @returns Count of equations successfully rendered
 */
function renderElement(slideNum: number, element: GoogleAppsScript.Slides.Group | GoogleAppsScript.Slides.Table | GoogleAppsScript.Slides.Shape, renderOptions: AutoLatexCommon.RenderOptions) {
  if ("ungroup" in element) {
    // recursively process all elements in this group
    let c = 0;
    for (const childElement of element.getChildren()) {
      // returns null if we don't recognize the type
      const castedPageElement = castElement(childElement);
      if (castedPageElement) {
        c += renderElement(slideNum, castedPageElement, renderOptions);
      }
    }
    return c;
  } else if (isTable(element)) {
    // table
    let c = 0;
    for (let i = 0; i < element.getNumRows(); i++) {
      for (let j = 0; j < element.getNumColumns(); j++) {
        const cell = element.getCell(i, j);
        // ignore merged cells (the head cells of merged cells will still be counted)
        if (cell.getMergeState() === SlidesApp.CellMergeState.MERGED) continue;
        
        let parsedEquations = findPos(slideNum, cell, renderOptions); //or: "\\\$\\\$", "\\\$\\\$"
        c += parsedEquations.filter(([, imagesPlaced]) => imagesPlaced).length;
      }
    }
    return c;
  } else {
    // single shape
    let parsedEquations = findPos(slideNum, element, renderOptions); //or: "\\\$\\\$", "\\\$\\\$"
    return parsedEquations.filter(([, imagesPlaced]) => imagesPlaced).length;
  }
}

function isEscapedSingleDollarInSlide(text: string, offset: number) {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text.charAt(index) === "\\"; index--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function findNextSingleDollarInSlide(text: string, offset = 0) {
  let candidate = text.indexOf("$", offset);
  while (candidate !== -1) {
    if (
      !isEscapedSingleDollarInSlide(text, candidate) &&
      (candidate === 0 || text.charAt(candidate - 1) !== "$") &&
      (candidate + 1 >= text.length || text.charAt(candidate + 1) !== "$")
    ) {
      return candidate;
    }
    candidate = text.indexOf("$", candidate + 1);
  }
  return -1;
}

function findNextDelimiterOffsetInSlide(text: string, delimiters: AutoLatexCommon.Delimiter, offset = 0, useEndDelimiter = false) {
  if (delimiters[6] === 2) {
    return findNextSingleDollarInSlide(text, offset);
  }
  return text.indexOf(useEndDelimiter ? delimiters[1] : delimiters[0], offset);
}

function findNextEquationOffsetsInSlide(text: string, delimiters: AutoLatexCommon.Delimiter, offset = 0) {
  const placeHolderStart = findNextDelimiterOffsetInSlide(text, delimiters, offset);
  if (placeHolderStart === -1) {
    return null;
  }
  const placeHolderEnd = findNextDelimiterOffsetInSlide(text, delimiters, placeHolderStart + delimiters[4], true);
  if (placeHolderEnd === -1) {
    return null;
  }
  return {
    start: placeHolderStart,
    end: placeHolderEnd
  };
}

// slideNum and slideObjectNum are integers
/**
 * get the R, G, B values of a textrange text
 */
function getRgbColor(textRange: GoogleAppsScript.Slides.TextRange, slideNum: number): [number, number, number] {
  const doc = IntegratedApp.getBody();
  const slide = doc[slideNum];
  let foregroundColor = textRange.getTextStyle().getForegroundColor();
  if (foregroundColor == null) {
    return [0, 0, 0];
  }
  const foregroundColorType = foregroundColor.getColorType();
  if (foregroundColorType === SlidesApp.ColorType.RGB) {
    Common.debugLog("textColor :" + typeof foregroundColor);
  } else {
    foregroundColor = slide.getColorScheme().getConcreteColor(foregroundColor.asThemeColor().getThemeColorType());
    console.log("equation color: " + foregroundColor.asRgbColor().asHexString());
  }

  const red = foregroundColor.asRgbColor().getRed();
  const green = foregroundColor.asRgbColor().getGreen();
  const blue = foregroundColor.asRgbColor().getBlue();
  Common.debugLog("RGB: " + red + ", " + green + ", " + blue);
  return [red, green, blue];
}

// REASON: equations inside highlighted text render as transparent PNGs, which show
// the slide/shape background through the highlight band and made light-colored
// equations invisible (user report). Sample the text's highlight color so the
// shared canvas renderer bakes it into the image; null (no highlight) keeps the
// image transparent, which composites correctly over shape fills.
function getBgRgbColor(textRange: GoogleAppsScript.Slides.TextRange, slideNum: number): [number, number, number] | null {
  let backgroundColor = textRange.getTextStyle().getBackgroundColor();
  if (backgroundColor == null) {
    return null;
  }
  if (backgroundColor.getColorType() !== SlidesApp.ColorType.RGB) {
    const slide = IntegratedApp.getBody()[slideNum];
    backgroundColor = slide.getColorScheme().getConcreteColor(backgroundColor.asThemeColor().getThemeColorType());
  }
  return [
    backgroundColor.asRgbColor().getRed(),
    backgroundColor.asRgbColor().getGreen(),
    backgroundColor.asRgbColor().getBlue(),
  ];
}

// REASON: rendering deletes the equation's text box when the equation was its only
// content — taking the box's fill with it — and oversized equations overflow the
// box anyway (user report: image doesn't fit, box gone, background lost). Bake the
// box/cell SOLID fill into the image when the text has no explicit highlight.
// Gradient/image fills can't be represented by one color; those stay transparent.
function getShapeFillRgbColor(element: PageElement, slideNum: number): [number, number, number] | null {
  try {
    const fill = element.getFill();
    if (!fill) return null;
    const solid = fill.getSolidFill();
    if (!solid) return null;
    let color = solid.getColor();
    if (color.getColorType() !== SlidesApp.ColorType.RGB) {
      const slide = IntegratedApp.getBody()[slideNum];
      color = slide.getColorScheme().getConcreteColor(color.asThemeColor().getThemeColorType());
    }
    return [
      color.asRgbColor().getRed(),
      color.asRgbColor().getGreen(),
      color.asRgbColor().getBlue(),
    ];
  } catch (err) {
    // elements without a fill API (or transparent fills) simply stay transparent
    console.log("getShapeFillRgbColor: no usable fill; keeping transparent.", String(err));
    return null;
  }
}

function unwrapEQ(element: PageElement) {
  let textValue: GoogleAppsScript.Slides.TextRange | null = null;
  // test if it's a text box (table cells work)
  try {
    textValue = element.getText(); // TextRange
    Common.debugLog("TextBox Text: " + textValue);
  } catch {
    Common.debugLog("not a text box");
  }

  return textValue; // returns TextRange or null
}

/**
 * Get position of insertion then place the image there.
 * @param {string}  delim[6]     The text delimiters and regex delimiters for start and end in that order. E.g. ["\\[", "\\]", "\\\\\\[", "\\\\\\]", 2, 1, 1]

 returns: [gotSize, isEmpty]
				gotSize:
					-100000 -> none of the renderers work
					0 => failure finding delimiters, probably means last equation rendered
					nonzero positive size => size to render equations at by default. also when there is a blank equation
				isEmpty:
					1 if eqn is "" and 0 if not. Assume we close on 4 consecutive empty ones.
*/

function findPos(slideNum: number, element: PageElement, renderOptions: AutoLatexCommon.RenderOptions) {
  let imagesPlaced = [];
  if (!element)
    imagesPlaced.push([0, 0]);
  else {
    // REASON: Track search offset so that when a renderer fails (text unchanged),
    // we skip past the failed equation instead of re-finding it in an infinite loop.
    let searchOffset = 0;
    for (let i = 0; i < 100; i++) { // Parse a maximum of 100 equations per TextRange
      // Get the text of the shape.
      // var elementText = shape.getText(); // TextRange
      const elementText = unwrapEQ(element); // TextRange
      if(elementText == null) {
        imagesPlaced.push([0, 0]);
        continue;
      }
      const equationOffsets = findNextEquationOffsetsInSlide(elementText.asRenderedString(), renderOptions.delim, searchOffset);
      if (!equationOffsets) {
        imagesPlaced.push([0, 0]); // didn't find first delimiter
        break;
      }

      const placeHolderStart = equationOffsets.start;
      const placeHolderEnd = equationOffsets.end;

      Common.debugLog("Start and End of equation: " + placeHolderStart + " " + placeHolderEnd);
      // debugLog("Isolating Equation Textrange: " + element.getText().getRange(placeHolderStart, placeHolderEnd).asRenderedString());

      const textColor = getRgbColor(element.getText().getRange(placeHolderStart + 1, placeHolderEnd), slideNum);

      Common.debugLog(`RGB: ${textColor.join()}`);

      // include the ending delimiter as well
      const endOffset = Math.min(elementText.getLength(), placeHolderEnd + renderOptions.delim[4]);
      const equationRange = elementText.getRange(placeHolderStart, endOffset);

      if (placeHolderEnd - placeHolderStart === renderOptions.delim[4]) {
        // empty equation
        Common.debugLog("Empty equation!");
        equationRange.clear();
        imagesPlaced.push([renderOptions.defaultSize, 0]); // default behavior of placeImage
        // REASON: Text was modified (cleared), reset offset to search from beginning.
        searchOffset = 0;
        continue;
      }

      const result = placeImage(slideNum, element, equationRange, {
        // add color to renderOptions
        ...renderOptions,
        r: textColor[0],
        g: textColor[1],
        b: textColor[2]
      });
      imagesPlaced.push(result);

      if (result === -100000) {
        // REASON: Rendering failed, text is unchanged. Advance past this equation
        // to avoid finding it again on the next iteration.
        searchOffset = placeHolderEnd + renderOptions.delim[4];
      } else {
        // REASON: Rendering succeeded, text was cleared and image was inserted.
        // Reset offset since the text content changed.
        searchOffset = 0;
      }
    }
  }
  return imagesPlaced;
}

function getSlideTextSize(size: number, defaultSize: number, equationRange: GoogleAppsScript.Slides.TextRange) {
  if (size !== 0) {
    return size;
  }
  const textSize = equationRange.getTextStyle().getFontSize();
  if (textSize === null || textSize <= 0) {
    return defaultSize;
  }
  return textSize;
}

function getTargetObjectId(textElement: PageElement) {
  return isTableCell(textElement)
    ? textElement.getParentTable().getObjectId()
    : textElement.getObjectId();
}

function findClientRenderEquationInTextElement(
  slideNum: number,
  slide: GoogleAppsScript.Slides.Slide,
  textElement: PageElement,
  renderOptions: AutoLatexCommon.RenderOptions
) {
  const textRange = unwrapEQ(textElement);
  if (!textRange) {
    return null;
  }

  const renderedText = textRange.asRenderedString();
  let searchOffset = 0;

  while (searchOffset < renderedText.length) {
    const equationOffsets = findNextEquationOffsetsInSlide(renderedText, renderOptions.delim, searchOffset);
    if (!equationOffsets) {
      return null;
    }

    const endOffset = Math.min(textRange.getLength(), equationOffsets.end + renderOptions.delim[4]);
    const equationRange = textRange.getRange(equationOffsets.start, endOffset);
    const equationOriginal = getEquation(equationRange, renderOptions.delim);
    // REASON: skip empty AND whitespace-only equations (e.g. a lone line break). They typeset
    // to a 0x0 SVG and would crash the shared client canvas renderer. Mirrors the Docs findPos
    // guard so no surface sends a blank equation to MathJax.
    if (!equationOriginal || equationOriginal.trim() === "") {
      searchOffset = equationOffsets.end + renderOptions.delim[4];
      continue;
    }

    const size = getSlideTextSize(renderOptions.size, renderOptions.defaultSize, equationRange);
    const colorRangeEnd = Math.max(equationOffsets.start + renderOptions.delim[4], equationOffsets.end);
    const textColor = getRgbColor(textRange.getRange(equationOffsets.start + renderOptions.delim[4], colorRangeEnd), slideNum);
    const bgColor = getBgRgbColor(textRange.getRange(equationOffsets.start + renderOptions.delim[4], colorRangeEnd), slideNum) || getShapeFillRgbColor(textElement, slideNum);
    // REASON: collapse the encoded four-backslash newline marker in ENCODED space
    // (like the Codecogs path); the old decoded-space `.replace(/\\\\/g, "\\")`
    // halved every backslash pair and broke "\\\hline" in tables ("Misplaced
    // \hline" after a derender round-trip) and align/matrix row breaks.
    const clientEquation = Common.getClientEquation(equationOriginal, IntegratedApp);
    const eqOffset = estimateInBoxOffset(renderedText.substring(0, equationOffsets.start), size, getBounds(textElement).width);

    return {
      size,
      inline: renderOptions.inline,
      r: textColor[0],
      g: textColor[1],
      b: textColor[2],
      ...(bgColor ? { bgR: bgColor[0], bgG: bgColor[1], bgB: bgColor[2] } : {}),
      delim: renderOptions.delim,
      equation: clientEquation,
      equationLinkEncoded: encodeURIComponent(clientEquation),
      slideId: slide.getObjectId(),
      pageElementId: getTargetObjectId(textElement),
      tableRow: isTableCell(textElement) ? textElement.getRowIndex() : undefined,
      tableColumn: isTableCell(textElement) ? textElement.getColumnIndex() : undefined,
      rangeStart: equationOffsets.start,
      rangeEnd: endOffset,
      posDx: eqOffset.dx,
      posDy: eqOffset.dy
    };
  }

  return null;
}

function getEquation(textRange: GoogleAppsScript.Slides.TextRange, delimiters: AutoLatexCommon.Delimiter) {
  // remove delimiters from range
  const equation = textRange.asRenderedString().substring(delimiters[4], textRange.getLength() - delimiters[4]);
  const checkForEquation = textRange.asRenderedString();
  Common.debugLog("getEquation- " + equation.length);
  Common.debugLog("checkForEquation- " + checkForEquation.length);

  // encode/escape equation
  return Common.reEncode(equation, IntegratedApp);
}

/**
 * Get the coordinates of the top-left corner of this element, as well as the width and the height
 */
function getBounds(textElement: PageElement) {
  if (isTableCell(textElement)) {
    const targetRow = textElement.getRowIndex();
    const targetCol = textElement.getColumnIndex();
    const row = textElement.getParentRow();
    const col = textElement.getParentColumn();
    const table = textElement.getParentTable();
    
    let x = table.getLeft();
    let y = table.getTop();
    
    // iterate through cells before to find position
    for (let rowIdx = 0; rowIdx < targetRow; rowIdx++) {
      y += table.getRow(rowIdx).getMinimumHeight();
    }
    for (let colIdx = 0; colIdx < targetCol; colIdx++) {
      x += table.getColumn(colIdx).getWidth();
    }
    
    return {
      x,
      y,
      width: col.getWidth(),
      height: row.getMinimumHeight()
    };
  } else {
    // simple - just call the respective methods
    return {
      x: textElement.getLeft(),
      y: textElement.getTop(),
      width: textElement.getWidth(),
      height: textElement.getHeight()
    };
  }
}

// REASON: Slides exposes no geometry for a substring inside a text box, so estimate where an
// equation sits from the text that PRECEDES it, returning an (dx, dy) offset in points from the
// box's top-left. Heuristic: average glyph advance ~= 0.5 * fontSize and line height ~= 1.2 *
// fontSize, with a soft wrap when a visual line exceeds the box width. Graceful degradation
// matching the requested fallback chain:
//   - full inline: font size + box width known -> real column (dx) and wrapped line (dy)
//   - line-aware:  no font metrics -> dx pinned to 0 (box edge), dy counts explicit breaks only
//   - side-by-side/corner: empty prefix -> (0, 0); the placement step keeps alignment there and
//     the slide-edge clamp guarantees nothing lands off-page (overlap is acceptable, off-slide is
//     not).
const GLYPH_ADVANCE_RATIO = 0.5; // avg glyph advance as a fraction of the font size (proportional)
const LINE_HEIGHT_RATIO = 1.2;   // line height as a fraction of the font size
function estimateInBoxOffset(textBefore: string, fontSizePt: number, boxWidthPt: number) {
  const hasMetrics = typeof fontSizePt === "number" && fontSizePt > 0;
  const fontPt = hasMetrics ? fontSizePt : 12;
  const glyphW = Math.max(1, fontPt * GLYPH_ADVANCE_RATIO);
  const lineH = Math.max(1, fontPt * LINE_HEIGHT_RATIO);
  const charsPerLine = hasMetrics && boxWidthPt > 0 ? Math.max(1, Math.floor(boxWidthPt / glyphW)) : Infinity;

  let line = 0;
  let column = 0;
  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore.charAt(i);
    // \n \r \v are all in-text line breaks across Docs/Slides.
    if (ch === "\n" || ch === "\r" || ch === "\v") {
      line++;
      column = 0;
      continue;
    }
    column++;
    if (column >= charsPerLine) {
      line++;
      column = 0;
    }
  }
  return { dx: hasMetrics ? column * glyphW : 0, dy: line * lineH };
}

function resize(eqnImage: GoogleAppsScript.Slides.Image, scale: number, horizontalAlignment: GoogleAppsScript.Slides.ParagraphAlignment, verticalAlignment: GoogleAppsScript.Slides.ContentAlignment, bounds: ReturnType<typeof getBounds>, posOffset?: { dx: number; dy: number }) {
  const width = eqnImage.getWidth() * scale;
  const height = eqnImage.getHeight() * scale;

  eqnImage.setWidth(width);
  eqnImage.setHeight(height);

  let left: number;
  let top: number;
  // Primary: the estimated inline position, but only when the equation actually has preceding
  // content (dx>0 or dy>0). An equation at the very start of the box keeps the alignment-based
  // placement below, which is correct for a single centered/right-aligned equation.
  if (posOffset && (posOffset.dx > 0 || posOffset.dy > 0)) {
    left = bounds.x + posOffset.dx;
    top = bounds.y + posOffset.dy;
  } else {
    // horizontal: match the text alignment (box-edge / line-aware fallback)
    if (horizontalAlignment === SlidesApp.ParagraphAlignment.END)
      left = bounds.x + bounds.width - width; // subtracting the image width emulates "setRight"
    else if (horizontalAlignment === SlidesApp.ParagraphAlignment.CENTER)
      left = bounds.x + bounds.width / 2 - width / 2;
    else
      left = bounds.x;

    // match the vertical alignment
    if (verticalAlignment === SlidesApp.ContentAlignment.TOP)
      top = bounds.y;
    else if (verticalAlignment === SlidesApp.ContentAlignment.BOTTOM)
      top = bounds.y + bounds.height - height; // emulating "setBottom"
    else
      top = bounds.y + bounds.height / 2 - height / 2;
  }

  // REASON: never let the image run off the right/bottom edge of the slide. Clamp to the page;
  // overlapping another element is acceptable, disappearing off-slide is not (user spec).
  const presentation = SlidesApp.getActivePresentation();
  const slideWidth = presentation.getPageWidth();
  const slideHeight = presentation.getPageHeight();
  left = Math.max(0, Math.min(left, slideWidth - width));
  top = Math.max(0, Math.min(top, slideHeight - height));

  eqnImage.setLeft(left);
  eqnImage.setTop(top);
}

/**
 * Given the locations of the delimiters, run code to get font size, get equation, remove equation, encode/style equation, insert/style image.
 */
function placeImage(slideNum: number, textElement: PageElement, text: GoogleAppsScript.Slides.TextRange, renderOptions: AutoLatexCommon.RenderOptions) {
  Common.debugLog("placeImage- EquationOriginal: " + textElement + ", type: " + typeof textElement);
  
  const equationRange = text.getRange(1, text.getLength());

  let size = renderOptions.size;

  // if the user selected automatic (or inline), use the size of the text
  if (size === 0) {
    const textSize = equationRange
      .getTextStyle()
      .getFontSize();
    if (textSize === null || textSize <= 0) {
      // size of the previous element
      size = renderOptions.defaultSize;
    } else {
      size = textSize;
    }
  }
  Common.debugLog("My Text Size is: ", size);
  
  
  // Gets the horizontal alignment of the equation. If it somehow spans multiple paragraphs, this will return the alignment of the first one
  const textHorizontalAlignment = equationRange
    .getParagraphs()[0]
    .getRange()
    .getParagraphStyle()
    .getParagraphAlignment();
      
  const textVerticalAlignment = textElement.getContentAlignment();

  const equationOriginal = getEquation(text, renderOptions.delim);
  Common.debugLog("placeImage- EquationOriginal: " + equationOriginal);

  if (equationOriginal == "") {
    console.log("No equation but undetected start and end as ", text.getStartIndex(), " ", text.getEndIndex());
    return [renderOptions.defaultSize, 1];
  }

  const { renderer, rendererType, worked, authorizationError } = Common.renderEquation(equationOriginal, renderOptions);
  // REASON: -100001 marks an auth-permission failure so callers (clientRenderFailed) can
  // surface a "reinstall and grant external_request" message instead of treating it as a
  // generic renderer-down error. -100000 stays the generic-failure sentinel.
  if (worked > Common.capableRenderers) return authorizationError ? -100001 : -100000;
  var doc = IntegratedApp.getBody();
  var body = doc[slideNum];

  // console.log("title alt text: " + renderer[2] + equationOriginal + "#" + delim[6])
  
  // This is a relatively expensive call for tables, so we store it in a variable
  const bounds = getBounds(textElement);

  const origURL = renderer[2] + equationOriginal + "#" + renderOptions.delim[6];
  const derenderData: DerenderData = {
    red: renderOptions.r,
    green: renderOptions.g,
    blue: renderOptions.b,
    origURL,
    size,
    width: bounds.width,
    height: bounds.height
  };
  
  text.clear();

  // textElement.setLeft(textElement.getLeft() + image.getWidth() * 1.1);

  // CodeCogs, other
  let scale = (1 / 100.0);
  if (rendererType.valueOf() === "Texrendr".valueOf())
    //TexRendr
    scale = (1 / 42.0);
  else if (rendererType.valueOf() === "Roger's renderer".valueOf())
    //Rogers renderer
    scale = (1 / 200.0);
  else if (rendererType.valueOf() === "Sciweavers".valueOf())
    //Scieweavers
    scale = (1 / 98.0);
  else if (rendererType.valueOf() === "Sciweavers_old".valueOf())
    //C [75.4, 79.6] on width and height ratio
    scale = (1 / 76.0) ;

  scale *= size;

  var image = body.insertImage(renderer[1]);

  resize(image, scale, textHorizontalAlignment, textVerticalAlignment, bounds);
  
  // remove empty textboxes
  if (
    !isTableCell(textElement) &&
    textElement.getShapeType() === SlidesApp.ShapeType.TEXT_BOX &&
    textElement.getText().asRenderedString().length <= 1
  ) {
    textElement.remove();
  }
  image.setTitle(JSON.stringify(derenderData));
  return [renderOptions.size, 1];
}

function findPageElementById(elements: GoogleAppsScript.Slides.PageElement[], pageElementId: string): GoogleAppsScript.Slides.PageElement | null {
  for (const element of elements) {
    if (element.getObjectId() === pageElementId) {
      return element;
    }
    if (element.getPageElementType() === SlidesApp.PageElementType.GROUP) {
      const groupMatch = findPageElementById(element.asGroup().getChildren(), pageElementId);
      if (groupMatch) {
        return groupMatch;
      }
    }
  }
  return null;
}

function resolveClientRenderTarget(options: SlidesClientRenderOptions) {
  const slide = IntegratedApp.getBody().find(currentSlide => currentSlide.getObjectId() === options.slideId);
  if (!slide) {
    return null;
  }

  const pageElement = findPageElementById(slide.getPageElements(), options.pageElementId);
  if (!pageElement) {
    return null;
  }

  if (options.tableRow != null && options.tableColumn != null) {
    if (pageElement.getPageElementType() !== SlidesApp.PageElementType.TABLE) {
      return null;
    }
    const tableCell = pageElement.asTable().getCell(options.tableRow, options.tableColumn);
    return {
      slide,
      textElement: tableCell,
      textRange: tableCell.getText()
    };
  }

  if (pageElement.getPageElementType() !== SlidesApp.PageElementType.SHAPE) {
    return null;
  }

  const shape = pageElement.asShape();
  return {
    slide,
    textElement: shape,
    textRange: shape.getText()
  };
}

function placeClientRenderedImage(
  slide: GoogleAppsScript.Slides.Slide,
  textElement: PageElement,
  text: GoogleAppsScript.Slides.TextRange,
  renderOptions: SlidesClientRenderOptions,
  renderedEquation: GoogleAppsScript.Base.Blob
) {
  const equationRange = text.getRange(1, text.getLength());
  const textHorizontalAlignment = equationRange
    .getParagraphs()[0]
    .getRange()
    .getParagraphStyle()
    .getParagraphAlignment();
  const textVerticalAlignment = textElement.getContentAlignment();
  const bounds = getBounds(textElement);
  const mathJaxRenderer = Common.getRenderer(Common.rendererIds.MATHJAX);
  const derenderData: DerenderData = {
    red: renderOptions.r,
    green: renderOptions.g,
    blue: renderOptions.b,
    origURL: mathJaxRenderer[2] + renderOptions.equationLinkEncoded + "#" + renderOptions.delim[6],
    size: renderOptions.size,
    width: bounds.width,
    height: bounds.height
  };

  text.clear();

  const image = slide.insertImage(renderedEquation);
  // Place the image at its estimated inline position within the box (computed at scan time from
  // the preceding text); resize() falls back to alignment-based placement when there is no offset
  // and always clamps to the slide edges.
  resize(image, 1.26 / 5, textHorizontalAlignment, textVerticalAlignment, bounds, {
    dx: renderOptions.posDx || 0,
    dy: renderOptions.posDy || 0
  });

  if (
    !isTableCell(textElement) &&
    textElement.getShapeType() === SlidesApp.ShapeType.TEXT_BOX &&
    textElement.getText().asRenderedString().length <= 1
  ) {
    textElement.remove();
  }

  image.setTitle(JSON.stringify(derenderData));
}

function clientRenderComplete(equations: SlidesClientRenderPayload[]): SlidesEquationRenderResult {
  let successCount = 0;

  for (const equation of equations) {
    try {
      const target = resolveClientRenderTarget(equation.options);
      if (!target) {
        console.warn("MathJax Slides target disappeared before completion:", equation.options.pageElementId);
        continue;
      }

      const safeEnd = Math.min(target.textRange.getLength(), equation.options.rangeEnd);
      if (equation.options.rangeStart >= safeEnd) {
        continue;
      }

      const equationRange = target.textRange.getRange(equation.options.rangeStart, safeEnd);
      const equationBlob = Utilities.newBlob(Utilities.base64Decode(equation.renderedEquationB64), "image/png");
      placeClientRenderedImage(target.slide, target.textElement, equationRange, equation.options, equationBlob);
      successCount++;
    } catch (error) {
      console.error("MathJax Slides client render completion failed.", error);
    }
  }

  return {
    lastStatus: successCount > 0 ? SlidesEquationRenderStatus.Success : SlidesEquationRenderStatus.AllRenderersFailed,
    successCount
  };
}

/**
 * Called by the client when MathJax rendering fails in auto mode.
 * Tries remaining server-side renderers (Texrendr, Sciweavers) for the failed equations.
 * @public
 */
function clientRenderFailed(equations: { options: SlidesClientRenderOptions }[]): SlidesEquationRenderResult {
  let successCount = 0;
  let authorizationFailure = false;

  for (const equation of equations) {
    try {
      const target = resolveClientRenderTarget(equation.options);
      if (!target) {
        console.warn("Slides server fallback: target disappeared:", equation.options.pageElementId);
        continue;
      }

      const safeEnd = Math.min(target.textRange.getLength(), equation.options.rangeEnd);
      if (equation.options.rangeStart >= safeEnd) continue;

      const equationRange = target.textRange.getRange(equation.options.rangeStart, safeEnd);
      const slideNum = IntegratedApp.getBody().findIndex(s => s.getObjectId() === equation.options.slideId);

      // REASON: Try non-Codecogs server renderers only. MathJax has already failed, and
      // retrying Codecogs here can reintroduce the outage hang auto mode is avoiding.
      const result = placeImage(slideNum, target.textElement, equationRange, {
        size: equation.options.size,
        defaultSize: equation.options.size,
        inline: equation.options.inline,
        delim: equation.options.delim,
        clientRender: false,
        r: equation.options.r,
        g: equation.options.g,
        b: equation.options.b,
        allowedServerFamilies: ["Texrendr", "Sciweavers", "Sciweavers_old", "Roger's renderer", "Number empire"]
      });

      if (Array.isArray(result) && result[1] === 1) {
        successCount++;
      } else if (result === -100001) {
        // REASON: placeImage signals UrlFetchApp auth failure with -100001 so we can
        // distinguish it from a generic renderer outage for the sidebar's error copy.
        authorizationFailure = true;
      }
    } catch (error) {
      console.error("Slides server fallback render failed.", error);
    }
  }

  return {
    lastStatus: successCount > 0
      ? SlidesEquationRenderStatus.Success
      : authorizationFailure
        ? SlidesEquationRenderStatus.AuthorizationFailed
        : SlidesEquationRenderStatus.AllRenderersFailed,
    successCount
  };
}

/**
 * De-encode all equations
 * @public
 */
function removeAll(defaultDelimRaw: string) {
  let counter = 0;
  const defaultDelim = Common.getDelimiters(defaultDelimRaw);
  for (const slide of IntegratedApp.getBody()) {
    for (const image of slide.getImages()) {
      if (derenderImage(image, defaultDelim, slide) === Common.DerenderResult.Success) counter++;
    }
  }
  return counter;
}

function derenderImage(image: GoogleAppsScript.Slides.Image, defaultDelim: AutoLatexCommon.Delimiter, slide: GoogleAppsScript.Slides.Page | GoogleAppsScript.Slides.Slide) {
  const positionX = image.getLeft(); // returns horizontal position in points measured from upper-left of the page
  // debugLog("Left: " + positionX)
  const positionY = image.getTop(); // returns vertical position
  
  // REASON: image.getTitle() is empty for images that weren't placed by Auto-LaTeX
  // (e.g. user-pasted screenshots, charts, other add-ons' images). JSON.parse("") throws
  // SyntaxError: Unexpected end of JSON input — we used to surface that to the user as a
  // raw crash from removeAll. Treat empty / unparseable titles as "not our image" and
  // bail out cleanly so the iteration in removeAll just skips this one.
  const rawTitle = image.getTitle();
  if (!rawTitle || !rawTitle.trim()) {
    return Common.DerenderResult.InvalidUrl;
  }
  let derenderData: DerenderData | [number, number, number, string, number];
  try {
    derenderData = JSON.parse(rawTitle);
  } catch (err) {
    console.log("derenderImage: image title is not Auto-LaTeX JSON; skipping.", rawTitle, err);
    return Common.DerenderResult.InvalidUrl;
  }
  
  if (Array.isArray(derenderData)) { 
    // backwards-compatibility - we use an object now
    const [red, green, blue, origURL, size] = derenderData;
    derenderData = {
      red,
      green,
      blue,
      origURL,
      // size may be undefined for older versions
      size,
      width: image.getWidth(),
      height: image.getHeight()
    };
  }
  // deconstruct
  const { red, green, blue, origURL, size, width, height } = derenderData;
  
  // these _should_ be numbers already, but I'm leaving this here in case it's needed for backwards compatibility
  const colors = [red, green, blue].map((x: string | number) => Number(x)) as [number, number, number];

  image.remove();

  Common.debugLog("image description is: " + origURL);

  if (!origURL) return Common.DerenderResult.NullUrl;

  Common.debugLog("Original URL from image", origURL);
  // REASON: same escape()-era %uXXXX guard as Docs — decodeURIComponent rejects those
  // legacy URLs (URIError) and an uncaught throw crashed the whole derender pass.
  let result: ReturnType<typeof Common.derenderEquation>;
  try {
    result = Common.derenderEquation(origURL, IntegratedApp);
  } catch (err) {
    console.error("derenderImage: failed to decode equation URL; skipping image.", String(err), " url=", String(origURL).substring(0, 500));
    return Common.DerenderResult.InvalidUrl;
  }
  if (!result) return Common.DerenderResult.InvalidUrl;
  const { delim: newDelim, origEq } = result;
  const delim = newDelim || defaultDelim;

  if (origEq.length <= 0) {
    console.log("Empty equation derender.");
    return Common.DerenderResult.EmptyEquation;
  }

  // insert textbox
  const shape = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, positionX, positionY, width, height);
  const textRange = shape.getText();

  const textStyle = textRange
    .insertText(0, delim[0] + origEq + delim[1])
    .getTextStyle()
    .setForegroundColor(...colors);

  if (size) {
    textStyle.setFontSize(size);
  }
  
  Common.debugLog("textRange: " + textRange + "type: " + typeof textRange);
  
  return Common.DerenderResult.Success;
}

/**
 * Given a size and a cursor right before an equation, call function to undo the image within delimeters. Returns success indicator.
 * See DerenderResult in Common for more info on return values
 *
 * @param {string} sizeRaw     Sidebar-selected size.
 * @public
 */
function editEquations(sizeRaw: string, delimiter: string, renderer: string = "auto") {
  const defaultDelim = Common.getDelimiters(delimiter);
  Common.savePrefs(sizeRaw, delimiter, renderer);
  // var cursor = IntegratedApp.getActive().getCursor(); // * no cursor for slides => replace with highlighted textbox
  //* 1. check if selected element is image
  //* 2. get position of element
  //* 3. render selected element by using element.getChild.asInlineImage(); then
  const selection = SlidesApp.getActivePresentation().getSelection();
  Common.debugLog("The Slides App is:" + selection);
  const currentPage = selection.getCurrentPage();
  // debugLog("current slide number is: " + pageNum + "pageNum is: " + pageNum)
  const selectionType = selection.getSelectionType();
  Common.debugLog("selection Type is: " + selectionType);

  if (selectionType == SlidesApp.SelectionType.PAGE_ELEMENT) {
    // REASON: derender EVERY selected image, not just the first — shift-clicking
    // several equations and hitting De-render only restored one (user report).
    // Non-ALE images (no parseable title JSON) are skipped by derenderImage.
    const images = selection.getPageElementRange().getPageElements()
      .filter(el => el.getPageElementType() === SlidesApp.PageElementType.IMAGE)
      .map(el => el.asImage());
    if (images.length === 0) {
      return { result: Common.DerenderResult.NonExistentElement, successCount: 0 };
    }
    let successCount = 0;
    let lastFailureResult = Common.DerenderResult.InvalidUrl;
    for (const image of images) {
      const result = derenderImage(image, defaultDelim, currentPage);
      if (result === Common.DerenderResult.Success) {
        successCount++;
      } else {
        lastFailureResult = result;
      }
    }
    return successCount > 0
      ? { result: Common.DerenderResult.Success, successCount }
      : { result: lastFailureResult, successCount: 0 };
  } else {
    return { result: Common.DerenderResult.CursorNotFound, successCount: 0 };
  }
}
