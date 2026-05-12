/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)

/* exported onOpen, showSidebar, replaceEquations */

var DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information

/**
 * enums should be alphabetical in order to work with clasp-types
 * @public
 */
const enum DocsEquationRenderStatus {
  AllRenderersFailed,
  AuthorizationFailed,
  ClientRender,
  EmptyEquation,
  MultiElementEquation,
  NoDocument,
  NoEndDelimiter,
  NoStartDelimiter,
  Success,
}

// REASON: Carries human-actionable info about a single equation that we couldn't render or
// auto-fix. The sidebar uses these to tell the user *which* equation broke and *why*, instead
// of the legacy generic "an equation is incorrect" message.
interface EquationFailureDetail {
  reason: string; // short machine-style tag, e.g. "multi-paragraph", "multi-element", "stale-offset"
  snippet: string; // up to ~80 chars of the equation start so the user can locate it in their doc
  hint: string;    // user-facing remediation suggestion
}

interface DocsEquationRenderResult {
  status: DocsEquationRenderStatus,
  equationSize?: number,
  nextStartElement?: GoogleAppsScript.Document.RangeElement,
  clientRenderOptions?: AutoLatexCommon.ClientRenderOptions,
  failureDetail?: EquationFailureDetail
}

interface DocsIntegratedApp extends AutoLatexCommon.IntegratedApp {
  getActive(): GoogleAppsScript.Document.Document;
  getBody(): GoogleAppsScript.Document.Body;
}

function getDocsApp(): DocsIntegratedApp {
  return {
    getUi: function(){
      let activeUi = DocumentApp.getUi();
      return activeUi;
    },
    getBody: function(){
      let activeBody = DocumentApp.getActiveDocument().getBody();
      return activeBody;
    },
    getActive: function(){
      let activeDoc = DocumentApp.getActiveDocument();
      return activeDoc;
    },
    getPageWidth: function() {
      let activeWidth = DocumentApp.getActiveDocument().getBody().getPageWidth();
      return activeWidth;
    },
    // A \n in Docs represents a paragraph break, while a \r (\x0D) represents a break within a paragraph
    newlineCharacter: "%0D"
  };
}


/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} _e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(_e: object) {
  try {
    DocumentApp.getUi().createAddonMenu().addItem("Start", "showSidebar").addToUi();
  } catch (error) {
    // Manual runs from the Apps Script editor do not have a document UI context.
    console.warn("Skipping onOpen outside a Docs UI context.", error);
  }
}

/**
 * Runs when the add-on is installed.
 *
 * @param {object} e The event parameter for a simple onInstall trigger. To
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
  const ui = HtmlService.createTemplateFromFile("Sidebar").evaluate()
    .setTitle("Auto-LaTeX Equations")
    .setSandboxMode(HtmlService.SandboxMode.IFRAME) // choose mode IFRAME which is fastest option
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // allow third party Docs clients
  DocumentApp.getUi().showSidebar(ui);
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
function getKey() {
  return Common.getKey();
}

/**
 * @public
 */
function logMathJaxClientError(payloadJson: string) {
  console.error("MathJax client error:", payloadJson);
}

/**
 * Returns the OAuth consent URL the user needs to visit to grant any
 * still-missing scopes, or null if everything is already authorized.
 *
 * REASON: Prod logs show a steady drip of `You do not have permission to call
 * DocumentApp.getActiveDocument` (and the equivalent in 10+ languages) — users
 * landing in the sidebar before they've granted documents.currentonly. Rather
 * than throwing a scary stack trace at them, the sidebar can call this helper
 * and present a clean "Click here to authorize" link that opens the consent
 * screen in a new tab.
 *
 * @public
 */
function getAuthorizationUrl(): string | null {
  const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    return info.getAuthorizationUrl();
  }
  return null;
}

function getRgbFromHex(colorHex: string | null): [number, number, number] {
  if (!colorHex || !/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
    return [0, 0, 0];
  }

  const channels = [1, 3, 5].map(index => parseInt(colorHex.slice(index, index + 2), 16));
  if (channels.some(channel => isNaN(channel))) {
    return [0, 0, 0];
  }

  return channels as [number, number, number];
}

function renderEquationWithCompatibility(equationOriginal: string, renderOptions: AutoLatexCommon.RenderOptions) {
  const compatibleRenderEquation = Common.renderEquation as unknown as {
    (equationOriginal: string, renderOptions: AutoLatexCommon.RenderOptions): ReturnType<typeof Common.renderEquation>;
    (equationOriginal: string, quality: number, delim: AutoLatexCommon.Delimiter, isInline: boolean, red: number, green: number, blue: number): ReturnType<typeof Common.renderEquation>;
  };

  if (compatibleRenderEquation.length >= 7) {
    return compatibleRenderEquation(
      equationOriginal,
      900,
      renderOptions.delim,
      renderOptions.inline,
      renderOptions.r,
      renderOptions.g,
      renderOptions.b
    );
  }

  return compatibleRenderEquation(equationOriginal, renderOptions);
}

/**
 * Constantly keep replacing latex till all are finished
 * @public
 */
function replaceEquations(sizeRaw: string, delimiter: string, renderer: string = "auto") {
  const quality = 900;
  const clientRender = renderer === "mathjax";
  // REASON: In auto mode, try Codecogs server-side first, then MathJax on client, then Texrendr/Sciweavers.
  const autoFallbackToClient = renderer === "auto";
  if (clientRender) {
    console.log("MathJax render requested.", JSON.stringify({ sizeRaw, delimiter }));
  }
  let size = Common.getSize(sizeRaw);
  let isInline = false;
  if (size < 0) {
    isInline = true;
    size = 0;
  }
  Common.reportDeltaTime(140);
  const delim = Common.getDelimiters(delimiter);
  Common.savePrefs(sizeRaw, delimiter, renderer);
  let c = 0; //counter
  let allEmpty = 0;
  Common.reportDeltaTime(146);
  let body: GoogleAppsScript.Document.Document;
  try {
    body = DocumentApp.getActiveDocument();
  } catch (error) {
    console.error(error);

    return {
      lastStatus: DocsEquationRenderStatus.NoDocument,
      successCount: 0,
      autoFixedCount: 0,
      failureDetails: [] as EquationFailureDetail[]
    };
  }

  // REASON: Collect every equation we couldn't render so we can return them all to the sidebar
  // in a single response, instead of dying on the first error and hiding the rest from the user.
  const failureDetails: EquationFailureDetail[] = [];
  // REASON: Count of equations we silently auto-recovered (e.g. merged paragraph-split equations).
  // Surfaced in the sidebar so the user knows we changed their doc on their behalf.
  let autoFixedCount = 0;
  
  const baseRenderOptions: AutoLatexCommon.RenderOptions = {
    size,
    defaultSize: 11,
    inline: isInline,
    delim,
    
    clientRender,
    autoFallbackToClient,

    // TODO: color support for Docs
    r: 0,
    g: 0,
    b: 0
  };
  
  // REASON: Collect equations that need client-side MathJax rendering instead of returning
  // on the first one. This allows Codecogs to batch-process all equations it can handle,
  // then send ALL remaining failures to the client for parallel MathJax rendering.
  const clientRenderBatch: AutoLatexCommon.ClientRenderOptions[] = [];

  const childCount = body.getBody().getParent().getNumChildren();
  Common.reportDeltaTime(156);
  for (let index = 0; index < childCount; index++) {
    let failedStartElemIfIsEmpty = null;
    while (true) {
      // prevFailedStartElemIfIsEmpty is here so when $$$$ fails again and again, it doesn't get stuck there and moves on.
      const findPosResult = findPos(index, baseRenderOptions, failedStartElemIfIsEmpty); //or: "\\\$\\\$", "\\\$\\\$"
      const {
        status,
        equationSize,
        nextStartElement,
        clientRenderOptions,
        failureDetail
      } = findPosResult;

      if (nextStartElement) failedStartElemIfIsEmpty = nextStartElement;
      // if we found an actual equation, update the default size
      if (equationSize) baseRenderOptions.defaultSize = equationSize;

      // REASON: findPos signals an auto-fix by setting equationSize === -1 in addition to the
      // regular status. We bump the count and re-run the same index from scratch since the doc
      // structure changed (paragraphs merged) and any cached RangeElement is now stale.
      if (status === DocsEquationRenderStatus.Success && equationSize === -1) {
        autoFixedCount++;
        failedStartElemIfIsEmpty = null;
        continue;
      }

      // count consecutive empty equations
      if (status == DocsEquationRenderStatus.EmptyEquation) {
        allEmpty++;
      } else {
        allEmpty = 0;
      }

      if (allEmpty > 10) break; //Assume we quit on 10 consecutive empty equations.

      // quit if all renderers failed or if document failed to load (conflicting authorizations)
      if (status == DocsEquationRenderStatus.AllRenderersFailed ||
          status == DocsEquationRenderStatus.AuthorizationFailed ||
          status == DocsEquationRenderStatus.NoDocument) {
        return {
          lastStatus: status,
          successCount: c,
          autoFixedCount,
          failureDetails
        };
      }

      // REASON: Cross-element / cross-paragraph equations we couldn't auto-fix. Record for the
      // sidebar and skip past so we don't infinite-loop on the same broken equation.
      if (status === DocsEquationRenderStatus.MultiElementEquation) {
        if (failureDetail) failureDetails.push(failureDetail);
        // failedStartElemIfIsEmpty was set above to nextStartElement (the end delimiter),
        // so the next findPos call will search after this broken equation.
        continue;
      }

      if (status === DocsEquationRenderStatus.ClientRender && clientRenderOptions) {
        // REASON: Collect for batch instead of returning immediately.
        // This lets Codecogs process all equations it can first, then MathJax handles the rest in parallel.
        clientRenderBatch.push(clientRenderOptions);
        continue;
      }

      // could not find next equation
      // move to next section
      if (status == DocsEquationRenderStatus.NoStartDelimiter || status == DocsEquationRenderStatus.NoEndDelimiter) {
        break;
      }

      if (status != DocsEquationRenderStatus.EmptyEquation) {
        c++;
      }
      console.log("Rendered equations: " + c);
    }
  }

  // If any equations need client-side MathJax rendering, send them all at once
  if (clientRenderBatch.length > 0) {
    console.log("MathJax queued", clientRenderBatch.length, "equations for parallel client rendering.");
    return {
      lastStatus: DocsEquationRenderStatus.ClientRender,
      clientEquations: clientRenderBatch,
      successCount: c,
      autoFixedCount,
      failureDetails
    };
  }

  return {
    lastStatus: DocsEquationRenderStatus.Success,
    successCount: c,
    autoFixedCount,
    failureDetails
  };
}

function hasEscapedSingleDollar(text: string, offset: number) {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text.charAt(index) === "\\"; index--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function isSingleDollarDelimiter(rangeElement: GoogleAppsScript.Document.RangeElement) {
  const text = rangeElement.getElement().asText().getText();
  const offset = rangeElement.getStartOffset();

  if (offset < 0 || text.charAt(offset) !== "$") {
    return false;
  }

  if (hasEscapedSingleDollar(text, offset)) {
    return false;
  }

  if (offset > 0 && text.charAt(offset - 1) === "$") {
    return false;
  }

  if (offset + 1 < text.length && text.charAt(offset + 1) === "$") {
    return false;
  }

  return true;
}

// REASON: delimIdx picks delim[2] (start regex) vs delim[3] (end regex).
// For asymmetric delimiters like `\[ ... \]` and `\( ... \)` the start and end patterns differ,
// so using delim[2] for both (the original bug) caused the end-search to look for another `\[`
// instead of `\]`, find none, and report "no equations found." For `$ ... $` the two are the
// same regex so either index works; isSingleDollarDelimiter still filters out `$$` / `\$` cases.
function findNextDelimiter(
  docBody: GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection | GoogleAppsScript.Document.FooterSection,
  renderOptions: AutoLatexCommon.RenderOptions,
  fromRange: GoogleAppsScript.Document.RangeElement | null = null,
  delimIdx: 2 | 3 = 2
) {
  if (renderOptions.delim[6] !== 2) {
    return fromRange == null
      ? docBody.findText(renderOptions.delim[delimIdx])
      : docBody.findText(renderOptions.delim[delimIdx], fromRange);
  }

  let candidate = fromRange == null ? docBody.findText("\\$") : docBody.findText("\\$", fromRange);
  while (candidate != null) {
    if (isSingleDollarDelimiter(candidate)) {
      return candidate;
    }
    candidate = docBody.findText("\\$", candidate);
  }

  return null;
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

// REASON: Walk up the parent chain to find the containing top-level body child (Paragraph or
// ListItem) for a Text element. We need this to detect equations that cross paragraph boundaries
// (the Enter-instead-of-Shift+Enter case) so we can auto-fix them.
function getContainingTopLevelChild(
  element: GoogleAppsScript.Document.Element,
  body: GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection | GoogleAppsScript.Document.FooterSection
): { topLevelChild: GoogleAppsScript.Document.Element, indexInBody: number } | null {
  let current: GoogleAppsScript.Document.Element | null = element;
  while (current != null) {
    const parent = current.getParent();
    if (parent == null) {
      return null;
    }
    const parentType = parent.getType();
    if (parentType === DocumentApp.ElementType.BODY_SECTION ||
        parentType === DocumentApp.ElementType.HEADER_SECTION ||
        parentType === DocumentApp.ElementType.FOOTER_SECTION) {
      try {
        // ContainerElement already exposes getChildIndex, so no cast needed.
        const idx = parent.getChildIndex(current);
        return { topLevelChild: current, indexInBody: idx };
      } catch (err) {
        // Stale or detached element
        return null;
      }
    }
    current = parent;
  }
  return null;
}

// REASON: When findText returns delimiters in different paragraphs, the user almost always
// pressed Enter instead of Shift+Enter inside a multiline equation. We auto-fix by merging
// every paragraph from start to end into the start paragraph, joining them with `\r` (the
// in-paragraph soft line break character that Docs uses for Shift+Enter). The original
// rendering loop then re-runs findPos and the equation now lives in a single Text element.
//
// What breaks if removed: every multiline equation entered with Enter raises a "End index N
// must be >= start index M" exception in findPos and the user gets a useless generic error.
//
// Limitations: rich formatting inside paragraphs that are moved during this auto-fix is not
// preserved because appendText only takes a string. Formatting is not the failure condition;
// the paragraph break is.
function tryAutoMergeMultiParagraphEquation(
  body: GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection | GoogleAppsScript.Document.FooterSection,
  startParaIdx: number,
  endParaIdx: number
): { success: boolean, reason: string } {
  if (endParaIdx <= startParaIdx) {
    return { success: false, reason: "Paragraph indices out of order" };
  }

  // Verify every paragraph in the span is a plain Paragraph containing only Text children.
  // If there are tables, inline images, drawings, etc., merging would either fail outright or
  // silently destroy user content - safer to bail and show a precise error.
  for (let i = startParaIdx; i <= endParaIdx; i++) {
    const child = body.getChild(i);
    const childType = child.getType();
    if (childType !== DocumentApp.ElementType.PARAGRAPH) {
      return { success: false, reason: "Cross-paragraph equation includes a " + childType + " block" };
    }
    const para = child.asParagraph();
    for (let j = 0; j < para.getNumChildren(); j++) {
      const innerType = para.getChild(j).getType();
      if (innerType !== DocumentApp.ElementType.TEXT) {
        return { success: false, reason: "Cross-paragraph equation contains a non-text element (" + innerType + ")" };
      }
    }
  }

  const startPara = body.getChild(startParaIdx).asParagraph();
  const numToMerge = endParaIdx - startParaIdx;

  // REASON: Forward loop, always grabbing the paragraph immediately after startPara.
  // After each removeFromParent the indices above startParaIdx all shift down by one, so
  // (startParaIdx + 1) consistently points at the next paragraph to merge.
  for (let i = 0; i < numToMerge; i++) {
    const nextPara = body.getChild(startParaIdx + 1).asParagraph();
    const text = nextPara.getText();
    // \r (\u000D) is the in-text representation of a Shift+Enter line break in Docs.
    // See newlineCharacter comment near top of this file.
    startPara.editAsText().appendText("\r" + text);
    nextPara.removeFromParent();
  }

  return { success: true, reason: "Merged " + numToMerge + " paragraph(s) with line breaks" };
}

// REASON: Build a short snippet of the equation start that the user can ctrl-F for in their
// document. We grab from the start delimiter forward, capping at 80 chars and stopping at the
// first paragraph break so the snippet stays on one line in the sidebar.
function buildEquationSnippet(startElement: GoogleAppsScript.Document.RangeElement): string {
  try {
    const text = startElement.getElement().asText().getText();
    const startOffset = startElement.getStartOffset();
    if (startOffset < 0 || startOffset >= text.length) {
      return "";
    }
    const tail = text.substring(startOffset, Math.min(text.length, startOffset + 80));
    // Strip line break characters so it renders cleanly in the sidebar
    return tail.replace(/[\r\n]/g, " ").trim();
  } catch (err) {
    return "";
  }
}

function findPos(index: number, renderOptions: AutoLatexCommon.RenderOptions, prevFailedStartElemIfIsEmpty = null): DocsEquationRenderResult {
  Common.debugLog("Checking document section index # ", index);
  Common.reportDeltaTime(195);
  const docBody = getBodyFromIndex(index);
  if (docBody == null) {
    return {
      status: DocsEquationRenderStatus.NoDocument
    };
  }
  const startElement = findNextDelimiter(docBody, renderOptions, prevFailedStartElemIfIsEmpty, 2);
  if (startElement == null) {
    return {
      status: DocsEquationRenderStatus.NoStartDelimiter
    };
  }
  const placeHolderStart = startElement.getStartOffset(); //position of image insertion

  const endElement = findNextDelimiter(docBody, renderOptions, startElement, 3);
  // could not find the ending delimiter after the start
  if (endElement == null) {
    return {
      status: DocsEquationRenderStatus.NoEndDelimiter
    };
  }
  const placeHolderEnd = endElement.getEndOffsetInclusive(); //text between placeHolderStart and placeHolderEnd will be permanently deleted
  Common.debugLog(renderOptions.delim[2], " single escaped delimiters ", placeHolderEnd - placeHolderStart, " characters long");

  Common.reportDeltaTime(214);
  if (placeHolderEnd - placeHolderStart == 2.0) {
    // empty equation
    console.log("Empty equation! In index " + index + " and offset " + placeHolderStart);

    return {
      // start from the end element next time to avoid an infinite loop
      nextStartElement: endElement,
      status: DocsEquationRenderStatus.EmptyEquation
    };
  }

  // REASON: The legacy assumption was "start and end delimiters live in the same Text element."
  // That breaks in two real-world cases:
  //   1. Multi-paragraph equations: user pressed Enter (paragraph break) inside the equation
  //      instead of Shift+Enter. start and end live in different paragraphs entirely.
  //   2. Multi-element equations: even within a single paragraph, an inline image or formatting
  //      change between the delimiters can split the paragraph into multiple Text children.
  //
  // Both cases used to throw an uncaught "End index (N) must be >= start index (M)" exception
  // from addElement, which bubbled up to the sidebar as a generic error.
  //
  // Now we detect both cases preemptively, auto-fix case 1 by merging the paragraphs, and
  // return a precise MultiElementEquation status with a snippet+hint for case 2.
  const startContainer = getContainingTopLevelChild(startElement.getElement(), docBody);
  const endContainer = getContainingTopLevelChild(endElement.getElement(), docBody);

  if (startContainer && endContainer && startContainer.indexInBody !== endContainer.indexInBody) {
    // Cross-paragraph case (1). Try to auto-merge.
    const snippet = buildEquationSnippet(startElement);
    console.log("Detected multi-paragraph equation:", JSON.stringify({
      startParaIdx: startContainer.indexInBody,
      endParaIdx: endContainer.indexInBody,
      snippet
    }));
    const merge = tryAutoMergeMultiParagraphEquation(docBody, startContainer.indexInBody, endContainer.indexInBody);
    if (merge.success) {
      console.log("Auto-fixed multi-paragraph equation:", merge.reason);
      // REASON: Signal an auto-fix to the caller via equationSize === -1 so the loop
      // increments autoFixedCount and re-runs findPos against the fresh document state.
      // We can't recurse here because the caller's `failedStartElemIfIsEmpty` would be stale.
      return {
        status: DocsEquationRenderStatus.Success,
        equationSize: -1
      };
    }
    return {
      status: DocsEquationRenderStatus.MultiElementEquation,
      // Skip past the broken end delimiter so we don't loop on it forever
      nextStartElement: endElement,
      failureDetail: {
        reason: "multi-paragraph",
        snippet: snippet || "(unknown)",
        hint: "This equation appears to span multiple paragraphs. Inside an equation, use Shift+Enter (line break) instead of Enter (paragraph break). " + merge.reason + "."
      }
    };
  }

  // Same top-level container but possibly different Text children. Detect by trying
  // the addElement build under a try/catch
  // so we don't have to fragile-compare element references.
  // REASON: We deliberately wrap *only* the range build in try/catch, not the downstream
  // findEquationAndPlaceImage call. Catching findEquationAndPlaceImage failures here would
  // hide unrelated bugs (network/render failures) behind a generic "multi-element" message.
  let range: GoogleAppsScript.Document.Range;
  try {
    range = getDocsApp().getActive().newRange()
      .addElement(startElement.getElement().asText(), startElement.getStartOffset(), endElement.getEndOffsetInclusive())
      .build();
  } catch (rangeErr) {
    const snippet = buildEquationSnippet(startElement);
    console.warn("Could not build equation range:", JSON.stringify({
      error: String(rangeErr),
      startOffset: startElement.getStartOffset(),
      endOffset: endElement.getEndOffsetInclusive(),
      snippet
    }));
    // REASON: Distinguish "stale offsets after a prior mutation" from "real cross-element"
    // by inspecting the error message. Stale-offset errors look like "Index (N) must be less
    // than the content length (M)" — these happen when an earlier render moved text under us
    // and the user can usually fix them just by re-running the renderer. Cross-element errors
    // look like "End index (N) must be greater or equal to start index (M)" — these need a
    // structural fix in the doc.
    const errMsg = String(rangeErr || "");
    const isStaleOffset = /Index \([0-9]+\) must be less than/.test(errMsg) || /less than the content length/.test(errMsg);
    return {
      status: DocsEquationRenderStatus.MultiElementEquation,
      nextStartElement: endElement,
      failureDetail: {
        reason: isStaleOffset ? "stale-offset" : "multi-element",
        snippet: snippet || "(unknown)",
        hint: isStaleOffset
          ? "This equation could not be located after a prior render. Try clicking 'Render Equations' again — it usually works on the second try."
          : "This equation appears to contain a paragraph break inside the delimiters. Use Shift+Enter instead of Enter for line breaks inside an equation."
      }
    };
  }

  return findEquationAndPlaceImage(range.getRangeElements()[0], renderOptions);
}


function getEquation(rangeElement: GoogleAppsScript.Document.RangeElement, delimiters: AutoLatexCommon.Delimiter) {
  const textElement = rangeElement.getElement().asText();
  Common.reportDeltaTime(284);
  Common.debugLog("See text", textElement.getText(), textElement.getText().length);
  const equation = textElement
    .getText()
    .substring(
      rangeElement.getStartOffset() + delimiters[4], rangeElement.getEndOffsetInclusive() - delimiters[4] + 1
    );
  Common.debugLog("See equation", equation);
  const equationStringEncoded = Common.reEncode(equation, getDocsApp()); //escape deprecated
  Common.reportDeltaTime(290);
  //console.log("Encoded: " + equationStringEncoded);
  return equationStringEncoded;
}

//retrieve size from text
function getSize(size: number, defaultSize: number, rangeElement: GoogleAppsScript.Document.RangeElement) {
  const textElement = rangeElement.getElement().asText();
  
  //GET SIZE
  let newSize = size;
  if (size == 0) {
    try {
      newSize = textElement
        .getFontSize(rangeElement.getStartOffset() + 3); //Fix later: Change from 3 to 1
    } catch (err) {
      newSize = textElement
        .getFontSize(rangeElement.getStartOffset() + 1); //Fix later: Change from 3 to 1
    }
    // size = paragraph.getChild(childIndex).editAsText().getFontSize(start+1);//Fix later: Change from 3 to 1
    // console.log("New size is " + size); //Causes: Index (3) must be less than the content length (2).
    if (newSize == null || newSize <= 0) {
      console.log("Null size! Assigned " + defaultSize);
      newSize = defaultSize;
    }
  }
  //console.log("Found Size In Doc As " + size);
  return newSize;
}

/**
* Given a list of rendered equations, place these onto the page 
*
* @param equations The rendered equations
* @public
*/
function clientRenderComplete(equations: { options: AutoLatexCommon.ClientRenderOptions, renderedEquationB64: string }[]) {
  const mathjaxRenderer = Common.getRenderer(Common.rendererIds.MATHJAX);
  let c = 0;
  console.log("MathJax client render completion received equations:", equations.length);
  
  // Go backwards so that the named ranges for multiple equations in the same paragraph don't get removed
  equations.reverse();
  
  for (const equation of equations) {
    let namedRange: GoogleAppsScript.Document.NamedRange | null = null;
    try {
      namedRange = getDocsApp().getActive().getNamedRangeById(equation.options.rangeId);
      if (!namedRange) {
        console.warn("MathJax client render range disappeared before completion:", equation.options.rangeId);
        continue;
      }

      const rangeElements = namedRange.getRange().getRangeElements();
      if (rangeElements.length === 0) {
        console.warn("MathJax client render range is empty:", equation.options.rangeId);
        continue;
      }

      const equationBlob = Utilities.newBlob(Utilities.base64Decode(equation.renderedEquationB64), "image/png");
      const result = placeImage(rangeElements[0], equationBlob, mathjaxRenderer, equation.options.equationLinkEncoded, equation.options.size, equation.options.delim);

      if (result.status === DocsEquationRenderStatus.Success) {
        c++;
      }
    } catch (error) {
      console.error("MathJax client render completion failed.", error);
    } finally {
      namedRange?.remove();
    }
  }
  
  return {
    lastStatus: DocsEquationRenderStatus.Success,
    successCount: c
  };
  
  // clean up - remove all of our ranges
  //DocsApp.getActive().getNamedRanges("ale-equation-range").forEach(range => range.remove());
}

/**
 * Given the locations of the delimiters, run code to get font size, get equation, remove equation, encode/style equation, insert/style image.
 *
 * @param {element} startElement The paragraph which the child is in.
 * @param {integer} start        The offset in the childIndex where the equation delimiters start.
 * @param {integer} end          The offset in the childIndex where the equation delimiters end.
 * @param {integer} quality      The dpi quality to be rendered in (default 900).
 * @param {integer} size         The size of the text, whose neg/pos indicated whether the equation is inline or not.
 * @param {integer} defaultSize  The default/previous size of the text, in case size is null.
 * @param {string}  delim[6]     The text delimiters and regex delimiters for start and end in that order, and offset from front and back.
 */

function findEquationAndPlaceImage(startElement: GoogleAppsScript.Document.RangeElement,  renderOptions: AutoLatexCommon.RenderOptions): DocsEquationRenderResult {
  Common.reportDeltaTime(411);
  Common.reportDeltaTime(413);
  // GET VARIABLES
  const textElement = startElement.getElement().asText();
  const size = getSize(renderOptions.size, renderOptions.defaultSize, startElement);
  const equationOriginal = getEquation(startElement, renderOptions.delim);

  if (equationOriginal == "") {
    console.log("No equation but undetected start and end as ", startElement.getStartOffset(), " ", startElement.getEndOffsetInclusive());
    
    return {
      status: DocsEquationRenderStatus.EmptyEquation,
      // TODO: this _should_ be impossible - empty equations should be detected in findPos()
      nextStartElement: startElement
    };
  }
  
  // get font color
  const colorHex = textElement.getForegroundColor(startElement.getStartOffset());
  // Docs can return null or malformed colors in some edge cases. Fall back to black.
  const [r, g, b] = getRgbFromHex(colorHex);
  
  // add color info to render options
  const coloredRenderOptions = {
    ...renderOptions,
    r, g, b,
  };
  
  // send info to the client for rendering (explicit MathJax mode)
  if (renderOptions.clientRender) {
    return buildClientRenderResponse(textElement, startElement, equationOriginal, coloredRenderOptions, size);
  }

  // REASON: In auto mode, try Codecogs first. If Codecogs fails, fall back to MathJax on the client.
  // If MathJax also fails, the client calls clientRenderFailed to try Texrendr/Sciweavers.
  if (renderOptions.autoFallbackToClient) {
    const codecogsResult = renderEquationWithCompatibility(equationOriginal, {
      ...coloredRenderOptions,
      allowedServerFamilies: ["Codecogs"]
    });

    if (codecogsResult.worked <= Common.capableRenderers && codecogsResult.resp && codecogsResult.renderer) {
      // Codecogs succeeded
      if (escape(codecogsResult.resp.getBlob().getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50) {
        codecogsResult.renderer = Common.getRenderer(Common.rendererIds.CODECOGS);
      }
      return placeImage(startElement, codecogsResult.resp.getBlob(), codecogsResult.renderer, equationOriginal, size, renderOptions.delim);
    }

    // Codecogs failed - fall back to MathJax on client
    return buildClientRenderResponse(textElement, startElement, equationOriginal, coloredRenderOptions, size);
  }

  let { resp, renderer, worked, authorizationError } = renderEquationWithCompatibility(equationOriginal, coloredRenderOptions);
  if (worked > Common.capableRenderers || !resp || !renderer) return {
    status: authorizationError ? DocsEquationRenderStatus.AuthorizationFailed : DocsEquationRenderStatus.AllRenderersFailed
  };
  // SAVING FORMATTING
  Common.reportDeltaTime(511);
  if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50) {
    renderer = Common.getRenderer(Common.rendererIds.CODECOGS);
  }
  Common.reportDeltaTime(517);
  
  return placeImage(startElement, resp.getBlob(), renderer, equationOriginal, size, renderOptions.delim);
}
  
function buildClientRenderResponse(
  textElement: GoogleAppsScript.Document.Text,
  startElement: GoogleAppsScript.Document.RangeElement,
  equationOriginal: string,
  coloredRenderOptions: AutoLatexCommon.RenderOptions & { r: number; g: number; b: number },
  size: number
): DocsEquationRenderResult {
  // we don't need URL encoding or double escaping for client renderers
  const clientEquation = decodeURIComponent(equationOriginal).replace(/\\\\/g, "\\");
  const doc = DocumentApp.getActiveDocument();
  const range = doc.newRange()
    .addElement(textElement, startElement.getStartOffset(), startElement.getEndOffsetInclusive())
    .build();
  // save this range for later
  const namedRange = doc.addNamedRange("ale-equation-range", range);
  const clientRenderOptions: AutoLatexCommon.ClientRenderOptions = {
    ...coloredRenderOptions,
    size,
    rangeId: namedRange.getId(),
    equation: clientEquation,
    equationLinkEncoded: encodeURIComponent(clientEquation)
  };
  return {
    status: DocsEquationRenderStatus.ClientRender,
    equationSize: size,
    clientRenderOptions,
    nextStartElement: startElement
  };
}

/**
 * Called by the client when MathJax rendering fails in auto mode.
 * Tries remaining server-side renderers (Texrendr, Sciweavers) for the failed equations.
 * @public
 */
function clientRenderFailed(equations: { options: AutoLatexCommon.ClientRenderOptions }[]) {
  let c = 0;
  let authorizationFailure = false;
  console.log("MathJax client render failed, trying server fallback for", equations.length, "equations");

  // Go backwards so that the named ranges for multiple equations in the same paragraph don't get removed
  equations.reverse();

  for (const equation of equations) {
    let namedRange: GoogleAppsScript.Document.NamedRange | null = null;
    try {
      namedRange = getDocsApp().getActive().getNamedRangeById(equation.options.rangeId);
      if (!namedRange) {
        console.warn("Server fallback: range disappeared:", equation.options.rangeId);
        continue;
      }

      const rangeElements = namedRange.getRange().getRangeElements();
      if (rangeElements.length === 0) {
        console.warn("Server fallback: range is empty:", equation.options.rangeId);
        continue;
      }

      const equationOriginal = Common.reEncode(equation.options.equation, getDocsApp());

      // REASON: Try Texrendr and Sciweavers only - Codecogs already failed, MathJax already failed.
      const fallbackResult = renderEquationWithCompatibility(equationOriginal, {
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

      if (fallbackResult.worked > Common.capableRenderers || !fallbackResult.resp || !fallbackResult.renderer) {
        if (fallbackResult.authorizationError) {
          authorizationFailure = true;
        }
        continue;
      }

      const equationBlob = fallbackResult.resp.getBlob();
      const result = placeImage(rangeElements[0], equationBlob, fallbackResult.renderer, equationOriginal, equation.options.size, equation.options.delim);

      if (result.status === DocsEquationRenderStatus.Success) {
        c++;
      }
    } catch (error) {
      console.error("Server fallback render failed.", error);
    } finally {
      namedRange?.remove();
    }
  }

  return {
    lastStatus: c > 0
      ? DocsEquationRenderStatus.Success
      : authorizationFailure
        ? DocsEquationRenderStatus.AuthorizationFailed
        : DocsEquationRenderStatus.AllRenderersFailed,
    successCount: c
  };
}

// REASON: The Text element's direct parent is normally a Paragraph or ListItem (both
// have insertInlineImage). But equations can also live inside structures whose direct
// parent doesn't expose insertInlineImage — e.g. smart-chip wrappers, rich-link
// containers, equations dragged inside a Drawing's text frame, certain
// programmatically-inserted templates. Rather than crashing with
// `paragraph.insertInlineImage is not a function`, walk up the ancestor chain to find a
// container that does support it (TableCell, Body, FootnoteSection, etc. all do). The
// caller inserts at childIndex of the *direct descendant* of that container that
// contains the equation, which keeps the image visually adjacent to the source text.
// Caps at 6 levels of ancestor traversal so we never spin on a malformed tree.
function findInsertableAncestor(element: GoogleAppsScript.Document.Element) {
  let current = element.getParent();
  let direct: GoogleAppsScript.Document.Element = element;
  for (let steps = 0; current && steps < 6; steps++) {
    if (typeof (current as unknown as { insertInlineImage?: unknown }).insertInlineImage === "function") {
      return { container: current, directChild: direct };
    }
    direct = current;
    current = current.getParent();
  }
  return null;
}

function placeImage(startElement: GoogleAppsScript.Document.RangeElement, renderedEquation: GoogleAppsScript.Base.Blob, renderer: AutoLatexCommon.Renderer, equation: string, size: number, delim: AutoLatexCommon.Delimiter) {
  // GET VARIABLES
  const textElement = startElement.getElement().asText();
  const text = textElement.getText();
  const ancestor = findInsertableAncestor(textElement);
  if (!ancestor) {
    const directParent = textElement.getParent();
    const parentType = directParent && typeof directParent.getType === "function" ? String(directParent.getType()) : "<unknown>";
    console.error("placeImage: no ancestor within 6 levels supports insertInlineImage. directParentType=", parentType, " equation=", equation);
    throw new Error(`Cannot place image: equation is in an unsupported container (direct parent type ${parentType}). Inline images can't be inserted here.`);
  }
  // REASON: TypeScript's union of insertable containers (Body, TableCell, FootnoteSection,
  // Paragraph, ListItem, ...) is wide; the methods we actually call (insertInlineImage,
  // insertText, getChild, getChildIndex) exist on all of them at runtime. Cast to the
  // existing ListItem|Paragraph signature so the rest of the function and repairImage
  // continue to compile unchanged.
  const paragraph = ancestor.container as unknown as GoogleAppsScript.Document.ListItem | GoogleAppsScript.Document.Paragraph;
  const childIndex = paragraph.getChildIndex(ancestor.directChild as GoogleAppsScript.Document.Element); //gets index of found text (or its containing wrapper) in the insertable ancestor
  const textCopy = textElement.asText().copy();
  let endLimit = startElement.getEndOffsetInclusive();
  if (text.length - 1 < endLimit) endLimit = text.length - 1;
  textCopy.asText().editAsText().deleteText(0, endLimit); // the copy only has the stuff after the equation
  Common.reportDeltaTime(522);
  textElement.editAsText().deleteText(startElement.getStartOffset(), text.length - 1); // from the original, yeet the equation and all the remaining text so its possible to insert the equation (try moving after the equation insertion?)
  Common.reportDeltaTime(526);
  
  // try inserting twice
  for (let tryNum = 1; tryNum <= 2; tryNum++) {
    try {
      paragraph.insertInlineImage(childIndex + 1, renderedEquation); // TODO ISSUE: sometimes fails because it times out and yeets
      return repairImage(paragraph, childIndex, size, renderer, delim, textCopy, renderedEquation, equation);
    } catch (err) {
      console.log(`Could not insert image try ${tryNum}`);
      console.error(err);
      
      Utilities.sleep(1000);
    }
  }

  throw new Error("Could not insert image at childindex!");
}

function repairImage(paragraph: GoogleAppsScript.Document.ListItem | GoogleAppsScript.Document.Paragraph, childIndex: number, size:  number, renderer: AutoLatexCommon.Renderer, delim: AutoLatexCommon.Delimiter, textCopy: GoogleAppsScript.Document.Text, resp: GoogleAppsScript.Base.Blob, equationOriginal: string): DocsEquationRenderResult {
  let attemptsToSetImageUrl = 3;
  Common.reportDeltaTime(552); // 3 seconds!! inserting an inline image takes time
  while (attemptsToSetImageUrl > 0) {
    try {
      paragraph.getChild(childIndex + 1).asInlineImage().setLinkUrl(renderer[2] + equationOriginal + "#" + delim[6]); //added % delim 6 to keep track of which delimiter was used to render
      break;
    } catch (err) {
      console.log("Couldn't insert child index!");
      console.log("Next child not found!");
      --attemptsToSetImageUrl;
    }
  }
  if (attemptsToSetImageUrl < 3) {
    console.log("At ", attemptsToSetImageUrl, " attemptsToSetImageUrls of failing to get child and link , ", equationOriginal);
    if (attemptsToSetImageUrl == 0) {
      throw new Error("Couldn't get equation child!"); // of image immediately after inserting
    }
  }

  Common.reportDeltaTime(570);
  if (textCopy.getText() != "") paragraph.insertText(childIndex + 2, textCopy); // reinsert deleted text after the image, with all the formatting
  const height = paragraph.getChild(childIndex + 1).asInlineImage().getHeight();
  const width = paragraph.getChild(childIndex + 1).asInlineImage().getWidth();
  console.log("Pre-fixing size, width, height: " + size + ", " + width + ", " + height); //only a '1' is rendered as a 100 height (as of 10/20/19, now it is fetched as 90 height). putting an equationrendertime here just doesnt work

  //SET PROPERTIES OF IMAGE (Height, Width)
  const oldSize = size; // why use oldsize instead of new size

  if (escape(resp.getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50 || (size > 10 && width == 126 && height == 24)) {
    size *= 5; // make codecogs errors readable, size constraint just in case some small equation is 126x24 as well
  }
  // console.log(rendererType, rendererType.valueOf(), "Texrendr".valueOf(), rendererType.valueOf() === "Codecogs".valueOf(), rendererType.valueOf() == "Codecogs".valueOf(), rendererType === "Codecogs", rendererType.valueOf() === "Texrendr".valueOf(), rendererType.valueOf() == "Texrendr".valueOf(), rendererType === "Texrendr")
  // note that valueOf here is not needed, and neither is === => removing both keeps trues true and falses false in V8.

  // if(rendererType.valueOf() === "Texrendr".valueOf())  //Old TexRendr
  // 	size = Math.round(size * height / 174);
  let multiple = size / 100.0;
  if (renderer[5] === "Texrendr")
    //TexRendr
    multiple = size / 42.0;
  else if (renderer[5] === "Roger's renderer")
    //Rogers renderer
    multiple = size / 200.0;
  else if (renderer[5] === "Codecogs")
    //CodeCogs, other
    multiple = size / 100.0;
  else if (renderer[5] === "Sciweavers")
    //Scieweavers
    multiple = size / 98.0;
  else if (renderer[5] === "Sciweavers_old")
    //C [75.4, 79.6] on width and height ratio
    multiple = size / 76.0;
  else if (renderer[5] === "MathJax")
    // The MathJax renderer returns scaled equations. We scale down by 5 (resolution), and 1.26 is just for consistency with other renderers.
    // TODO: When MathJax supports changing font, switch to a font that's more similar to CodeCogs
    multiple = 1.26 / 5;

  Common.reportDeltaTime(595);
  Common.sizeImage(getDocsApp(), paragraph, childIndex + 1, Math.round(height * multiple), Math.round(width * multiple));
  
  return {
    status: DocsEquationRenderStatus.Success,
    equationSize: oldSize
  };
}

function getBodyFromIndex(index: number) {
  const doc = getDocsApp().getActive();
  const p = doc.getBody().getParent();
  const all = p.getNumChildren();
  Common.assert(index < all, "index < all");
  const body = p.getChild(index);
  const type = body.getType();
  if (type === DocumentApp.ElementType.BODY_SECTION || type === DocumentApp.ElementType.HEADER_SECTION || type === DocumentApp.ElementType.FOOTER_SECTION) {
    // handles alternating footers etc.
    return body as GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection | GoogleAppsScript.Document.FooterSection;
  }
  return null;
}

/**
 * Given a cursor right before an equation, de-encode URL and replace image with raw equation between delimiters.
 * @public
 */
function removeAll(defaultDelimRaw: string) {
  let counter = 0;
  const defaultDelim = Common.getDelimiters(defaultDelimRaw);
  
  for (var index = 0; index < getDocsApp().getBody().getParent().getNumChildren(); index++) {
    const body = getBodyFromIndex(index);
    const img = body?.getImages(); //places all InlineImages from the active document into the array img
    for (let i = 0; i < (img?.length || 0); i++) {
      const image = img![i];
      let origURL = new String(image.getLinkUrl()).toString(); //becomes "null", not null, if no equation link
      if (image.getLinkUrl() === null) {
        continue;
      }
      // console.log("Current origURL " + origURL, origURL == "null", origURL === null, typeof origURL, Object.is(origURL, null), null instanceof Object, origURL instanceof Object, origURL instanceof String, !origURL)
      // console.log("Current origURL " + image.getLinkUrl(), image.getLinkUrl() === null, typeof image.getLinkUrl(), Object.is(image.getLinkUrl(), null), !image.getLinkUrl())
      const result = Common.derenderEquation(origURL, getDocsApp());
      if (!result) continue;
      const { origEq, delim: newDelim } = result;
      const delim = newDelim || defaultDelim;
      const imageIndex = image.getParent().getChildIndex(image);
      if (origEq.length <= 0) {
        console.log("Empty. at " + imageIndex + " fold " + image.getParent().getText());
        image.removeFromParent();
        continue;
      }
      const parent = image.getParent() as GoogleAppsScript.Document.ListItem | GoogleAppsScript.Document.Paragraph;
      parent.insertText(imageIndex, delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
      image.removeFromParent();
      counter += 1;
    }
  }
  return counter;
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
  const cursor = DocumentApp.getActiveDocument().getCursor();
  if (!cursor) {
    return Common.DerenderResult.CursorNotFound;
  }

  const elementRaw = cursor.getElement();
  if (!elementRaw) {
    return Common.DerenderResult.NonExistentElement;
  }

  // REASON: Cursor.getElement() can return any Element subtype (Table, TableOfContents,
  // FootnoteSection, etc.) - not just Paragraph/ListItem. The previous code did an unchecked
  // `as ListItem | Paragraph` cast and then called .getNumChildren(), which crashed with
  // "TypeError: element.getNumChildren is not a function" for users whose cursor was inside
  // a table cell or footnote. Validate the element type up front.
  const elementType = elementRaw.getType();
  if (elementType !== DocumentApp.ElementType.PARAGRAPH && elementType !== DocumentApp.ElementType.LIST_ITEM) {
    console.log("editEquations: cursor is in unsupported element type", elementType);
    return Common.DerenderResult.NonExistentElement;
  }

  const element = elementRaw as GoogleAppsScript.Document.ListItem | GoogleAppsScript.Document.Paragraph;
  console.log("Valid cursor.");

  const position = cursor.getOffset(); //offset
  if (position >= element.getNumChildren()) {
    return Common.DerenderResult.CursorNotFound;
  }

  // REASON: getChild(position).asInlineImage() throws "TEXT can't be cast to INLINE_IMAGE"
  // when the user's cursor is on text instead of an equation image. Check the child type
  // first and return a precise status so the sidebar can tell them to click the image.
  const childAtCursor = element.getChild(position);
  if (childAtCursor.getType() !== DocumentApp.ElementType.INLINE_IMAGE) {
    console.log("editEquations: child at cursor is not an inline image", childAtCursor.getType());
    return Common.DerenderResult.NonExistentElement;
  }

  const image = childAtCursor.asInlineImage();
  Common.debugLog("Image height", image.getHeight());
  const origURL = image.getLinkUrl();
  if (!origURL) {
    return Common.DerenderResult.NullUrl;
  }
  Common.debugLog("Original URL from image", origURL);
  const result = Common.derenderEquation(origURL, getDocsApp());
  if (!result) return Common.DerenderResult.InvalidUrl;
  const { delim: newDelim, origEq } = result;
  const delim = newDelim || defaultDelim;
  if (origEq.length <= 0) {
    console.log("Empty equation derender.");
    return Common.DerenderResult.EmptyEquation;
  }
  cursor.insertText(delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
  element.getChild(position + 1).removeFromParent();
  return Common.DerenderResult.Success;
}
