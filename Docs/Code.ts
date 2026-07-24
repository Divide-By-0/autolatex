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
  // REASON: In auto mode, start with MathJax on the client (never Codecogs first —
  // both because a Codecogs outage can hang UrlFetchApp long enough for
  // google.script.run to surface the generic "reload" error, and because it avoids
  // sending equation contents to external renderer APIs unless MathJax hard-fails;
  // PR #61 wanted no server fallback at all, but keeping Texrendr/Sciweavers as the
  // sidebar-invoked fallback preserves rendering when MathJax can't load).
  const autoFallbackToClient = renderer === "auto";
  if (clientRender || autoFallbackToClient) {
    console.log("MathJax render requested.", JSON.stringify({ sizeRaw, delimiter }));
  }
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
    delim: delimiterSet[0],
    
    clientRender,
    autoFallbackToClient,

    // TODO: color support for Docs
    r: 0,
    g: 0,
    b: 0
  };
  
  // REASON: Collect equations that need client-side MathJax rendering instead of returning
  // on the first one. This allows the server scan to finish across the document, then send
  // ALL MathJax work to the client for parallel rendering.
  const clientRenderBatch: AutoLatexCommon.ClientRenderOptions[] = [];

  const childCount = body.getBody().getParent().getNumChildren();
  Common.reportDeltaTime(156);
  for (let index = 0; index < childCount; index++) {
    for (const delim of delimiterSet) {
      let failedStartElemIfIsEmpty = null;
      let allEmpty = 0;
      const renderOptions = {
        ...baseRenderOptions,
        delim
      };
      while (true) {
        // prevFailedStartElemIfIsEmpty is here so when $$$$ fails again and again, it doesn't get stuck there and moves on.
        const findPosResult = findPos(index, renderOptions, failedStartElemIfIsEmpty); //or: "\\\$\\\$", "\\\$\\\$"
        const {
          status,
          equationSize,
          nextStartElement,
          clientRenderOptions,
          failureDetail
        } = findPosResult;

        if (nextStartElement) failedStartElemIfIsEmpty = nextStartElement;
        // if we found an actual equation, update the default size
        if (equationSize) {
          baseRenderOptions.defaultSize = equationSize;
          renderOptions.defaultSize = equationSize;
        }

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
          // This lets MathJax handle all equations in parallel after the server scan finishes.
          clientRenderBatch.push(clientRenderOptions);
          continue;
        }

        // could not find next equation
        // move to next delimiter/section
        if (status == DocsEquationRenderStatus.NoStartDelimiter || status == DocsEquationRenderStatus.NoEndDelimiter) {
          break;
        }

        if (status != DocsEquationRenderStatus.EmptyEquation) {
          c++;
        }
        console.log("Rendered equations: " + c);
      }
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
  docBody: GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection | GoogleAppsScript.Document.FooterSection | GoogleAppsScript.Document.FootnoteSection,
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
  body: GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection | GoogleAppsScript.Document.FooterSection | GoogleAppsScript.Document.FootnoteSection
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
  body: GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection | GoogleAppsScript.Document.FooterSection | GoogleAppsScript.Document.FootnoteSection,
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
    // REASON: Docs forbids deleting the final paragraph of a section — removeFromParent()
    // throws "Can't remove the last paragraph in a document section" (seen in prod when an
    // equation spans into the section's last paragraph). Its text is already merged into
    // startPara, so when nextPara is that final paragraph, empty it in place instead of
    // removing it; a trailing empty paragraph is harmless and the scan re-runs from scratch.
    if (startParaIdx + 1 >= body.getNumChildren() - 1) {
      nextPara.clear();
    } else {
      nextPara.removeFromParent();
    }
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
    // REASON: an unrecognized section type means "nothing to scan here", not "the
    // document failed to load". Returning NoDocument here aborted the whole render
    // with a misleading auth error for any doc containing such a section (silently —
    // this path logged nothing, which is why user reports were undiagnosable).
    return {
      status: DocsEquationRenderStatus.NoStartDelimiter
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
  // REASON: an empty equation contains only its opening and closing delimiters, so its
  // inclusive span is exactly 2 * delimiter length. The legacy hard-coded `== 2` treated
  // every one-character single-dollar equation (`$1$`, `$x$`) as empty, while failing to
  // recognize actually-empty `$$$$`, `\[\]`, and `\(\)` pairs.
  const isEmptyEquation = placeHolderEnd - placeHolderStart + 1 === 2 * renderOptions.delim[4];
  if (isEmptyEquation) {
    // empty equation
    console.log("Empty equation! In index " + index + " and offset " + placeHolderStart);

    return {
      // start from the end element next time to avoid an infinite loop
      nextStartElement: endElement,
      status: DocsEquationRenderStatus.EmptyEquation
    };
  }

  // REASON: an equation whose content is only whitespace (most commonly a lone "\r" from an
  // empty `$...$` that straddled a paragraph break and got auto-merged with a line break) is
  // not a real equation. The old `== 2` empty check happened to skip it because its content was
  // one character; the delimiter-length check above intentionally no longer does, so it now
  // slips through to MathJax, which renders a 0x0 SVG and crashes convertToBlob with
  // "OffscreenCanvas ... size is zero" (seen in prod as "MathJax failed to render 1 equation").
  // Skip it exactly like an empty equation, resuming past the closing delimiter (endElement) so
  // the scan can't re-pair the closing delimiter with the next equation. Only when start and end
  // share a Text element (the common case); cross-element spans fall through to the logic below.
  if (startElement.getElement() === endElement.getElement()) {
    const between = startElement.getElement().asText().getText()
      .substring(placeHolderStart + renderOptions.delim[4], placeHolderEnd - renderOptions.delim[4] + 1);
    if (between.trim() === "") {
      console.log("Whitespace-only equation skipped. In index " + index + " and offset " + placeHolderStart);
      return {
        nextStartElement: endElement,
        status: DocsEquationRenderStatus.EmptyEquation
      };
    }
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

  // REASON: pass endElement (the closing-delimiter findText result) so the deferred MathJax path
  // can resume the scan strictly after this equation. Resuming from the equation span instead
  // (which starts at the opening delimiter) makes findText re-find this equation's own closing
  // `$` and pair it forward — see buildClientRenderResponse.
  return findEquationAndPlaceImage(range.getRangeElements()[0], renderOptions, endElement);
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
      Common.debugLog("Null size! Assigned " + defaultSize);
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
  let alreadyRenderedCount = 0;
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

      // REASON: if the range element is no longer Text (most commonly it's already an
      // INLINE_IMAGE from a double-click render or an overlapping batch), placeImage's
      // asText() threw a locale-dependent cast error — thousands of ERROR lines/day for
      // what is a benign "already done" state. Skip quietly instead.
      if (rangeElements[0].getElement().getType() !== DocumentApp.ElementType.TEXT) {
        alreadyRenderedCount++;
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
  
  if (alreadyRenderedCount > 0) {
    console.log("MathJax client render completion skipped already-rendered ranges:", alreadyRenderedCount);
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

function findEquationAndPlaceImage(startElement: GoogleAppsScript.Document.RangeElement,  renderOptions: AutoLatexCommon.RenderOptions, endElement?: GoogleAppsScript.Document.RangeElement): DocsEquationRenderResult {
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

  // REASON: users build dark documents by highlighting text with a dark background
  // color; the transparent equation PNG then shows the white page through the
  // highlight band, making light-colored equations invisible. Sample the text's
  // background color so the client bakes it into the image. No highlight (null)
  // keeps the image transparent, exactly as before.
  const bgHex = textElement.getBackgroundColor(startElement.getStartOffset());
  const bgColor = bgHex ? getRgbFromHex(bgHex) : null;

  // add color info to render options
  const coloredRenderOptions = {
    ...renderOptions,
    r, g, b,
    ...(bgColor ? { bgR: bgColor[0], bgG: bgColor[1], bgB: bgColor[2] } : {}),
  };
  
  // REASON: Explicit MathJax and Automatic both render on the client first.
  // Automatic falls back to server renderers from the sidebar only if MathJax fails.
  if (renderOptions.clientRender || renderOptions.autoFallbackToClient) {
    return buildClientRenderResponse(textElement, startElement, equationOriginal, coloredRenderOptions, size, endElement);
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
  size: number,
  endElement?: GoogleAppsScript.Document.RangeElement
): DocsEquationRenderResult {
  // REASON: reEncode turns each in-equation newline into an encoded four-backslash
  // marker ("%5C%5C%5C%5C%20"), which must collapse back to a "\\ " row break for the
  // client renderer. Collapse it in ENCODED space (exactly like the Codecogs path in
  // Common.getStyle) — a three-backslash run in real LaTeX (e.g. "\\\hline" = row
  // break + \hline in tables) encodes to three %5C tokens and cannot false-match.
  // The previous decoded-space `.replace(/\\\\/g, "\\")` halved EVERY backslash pair,
  // silently merging align/matrix rows and degrading "\\\hline" -> "\\hline" ->
  // (after a derender round-trip) a bare "\hline", which MathJax rejects as
  // "Misplaced \hline".
  const clientEquation = Common.getClientEquation(equationOriginal, getDocsApp());
  const doc = DocumentApp.getActiveDocument();
  const range = doc.newRange()
    .addElement(textElement, startElement.getStartOffset(), startElement.getEndOffsetInclusive())
    .build();
  // save this range for later (used by clientRenderComplete to place the image)
  const namedRange = doc.addNamedRange("ale-equation-range", range);
  // REASON: resume the scan from the CLOSING-delimiter findText result (endElement), NOT from a
  // range derived from the equation span. findText(pattern, from) continues from `from`'s
  // position; for single-`$` the opening and closing delimiter are the same character, so if we
  // resume from anything anchored at the OPENING delimiter (the whole-equation range, the
  // named-range span — both start at the opening `$`), findText re-finds this equation's own
  // CLOSING `$` and pairs it forward with the next equation's opening `$`, rendering the prose
  // between (and crossing paragraph breaks -> spurious "multi-paragraph" merges). endElement is a
  // genuine findText result positioned at the closing delimiter, so the next search lands strictly
  // after it on the following equation's opening delimiter. This mirrors the empty-equation path,
  // which already resumes from endElement. (A previous fix re-read the named range's span here and
  // passed the unit tests, but that span still starts at the opening `$`, so it mis-paired in
  // production — confirmed via the Cloud Logging trace for a live user.)
  const nextStartElement = endElement || namedRange.getRange().getRangeElements().slice(-1)[0];
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
    nextStartElement
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

      // REASON: Try non-Codecogs server renderers only. MathJax has already failed, and
      // retrying Codecogs here can reintroduce the outage hang auto mode is avoiding.
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

// REASON: a doc with several unplaceable equations logged the same failure for every
// equation on every retry (observed: one stuck user emitted ~2300 ERROR lines/day).
// Log each distinct container type once per execution; the thrown error still carries
// the message for the per-equation failure details.
const reportedPlaceImageFailureTypes = new Set<string>();

function placeImage(startElement: GoogleAppsScript.Document.RangeElement, renderedEquation: GoogleAppsScript.Base.Blob, renderer: AutoLatexCommon.Renderer, equation: string, size: number, delim: AutoLatexCommon.Delimiter) {
  // GET VARIABLES
  let textElement = startElement.getElement().asText();
  const startOffset = startElement.getStartOffset();
  const endOffsetInclusive = startElement.getEndOffsetInclusive();
  let ancestor = findInsertableAncestor(textElement);
  if (!ancestor) {
    // REASON: prod logs show Text elements living DIRECTLY under a section
    // (directParentType=BODY_SECTION) — no Paragraph wrapper, so no ancestor exposes
    // insertInlineImage and rendering hard-failed for those docs. Sections do expose
    // insertParagraph, so wrap the text in a fresh Paragraph at the same position and
    // continue normally. The equations themselves are valid; only the container is odd.
    const directParent = textElement.getParent();
    const sectionLike = directParent as unknown as {
      insertParagraph?: (index: number, text: string) => GoogleAppsScript.Document.Paragraph;
      getChildIndex?: (child: GoogleAppsScript.Document.Element) => number;
      removeChild?: (child: GoogleAppsScript.Document.Element) => unknown;
    };
    if (directParent && typeof sectionLike.insertParagraph === "function" &&
        typeof sectionLike.getChildIndex === "function" && typeof sectionLike.removeChild === "function") {
      const idx = sectionLike.getChildIndex(textElement);
      const wrapper = sectionLike.insertParagraph(idx, "");
      const movedText = wrapper.appendText(textElement.getText());
      sectionLike.removeChild(textElement);
      textElement = movedText;
      ancestor = { container: wrapper as unknown as GoogleAppsScript.Document.ContainerElement, directChild: movedText as unknown as GoogleAppsScript.Document.Element };
      console.log("placeImage: wrapped section-level text in a paragraph to place the equation.");
    }
  }
  if (!ancestor) {
    const directParent = textElement.getParent();
    const parentType = directParent && typeof directParent.getType === "function" ? String(directParent.getType()) : "<unknown>";
    if (!reportedPlaceImageFailureTypes.has(parentType)) {
      reportedPlaceImageFailureTypes.add(parentType);
      console.error("placeImage: no ancestor within 6 levels supports insertInlineImage. directParentType=", parentType, " equation=", equation);
    }
    throw new Error(`Cannot place image: equation is in an unsupported container (direct parent type ${parentType}). Inline images can't be inserted here.`);
  }
  const text = textElement.getText();
  // REASON: TypeScript's union of insertable containers (Body, TableCell, FootnoteSection,
  // Paragraph, ListItem, ...) is wide; the methods we actually call (insertInlineImage,
  // insertText, getChild, getChildIndex) exist on all of them at runtime. Cast to the
  // existing ListItem|Paragraph signature so the rest of the function and repairImage
  // continue to compile unchanged.
  const paragraph = ancestor.container as unknown as GoogleAppsScript.Document.ListItem | GoogleAppsScript.Document.Paragraph;
  const childIndex = paragraph.getChildIndex(ancestor.directChild as GoogleAppsScript.Document.Element); //gets index of found text (or its containing wrapper) in the insertable ancestor
  const textCopy = textElement.asText().copy();
  let endLimit = endOffsetInclusive;
  if (text.length - 1 < endLimit) endLimit = text.length - 1;
  textCopy.asText().editAsText().deleteText(0, endLimit); // the copy only has the stuff after the equation
  Common.reportDeltaTime(522);
  textElement.editAsText().deleteText(startOffset, text.length - 1); // from the original, yeet the equation and all the remaining text so its possible to insert the equation (try moving after the equation insertion?)
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
  Common.debugLog("Pre-fixing size, width, height: " + size + ", " + width + ", " + height); //only a '1' is rendered as a 100 height (as of 10/20/19, now it is fetched as 90 height). putting an equationrendertime here just doesnt work

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
  // REASON: FOOTNOTE_SECTION included — academic docs commonly have footnotes, and
  // before 2026-07 hitting one aborted the entire render with a misleading
  // "conflicting authorizations" error (the section walker returned null and findPos
  // mapped null to NoDocument). Footnote equations render fine: FootnoteSection
  // supports findText/getImages, and placeImage already walks up to it.
  if (type === DocumentApp.ElementType.BODY_SECTION ||
      type === DocumentApp.ElementType.HEADER_SECTION ||
      type === DocumentApp.ElementType.FOOTER_SECTION ||
      type === DocumentApp.ElementType.FOOTNOTE_SECTION) {
    // handles alternating footers etc.
    return body as GoogleAppsScript.Document.Body | GoogleAppsScript.Document.HeaderSection | GoogleAppsScript.Document.FooterSection;
  }
  console.log("Skipping non-scannable document section", index, String(type));
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
    // REASON: FootnoteSection has findText (so rendering works there) but no
    // getImages; De-render All just skips footnote sections.
    const img = body && "getImages" in body ? body.getImages() : undefined; //places all InlineImages from the active document into the array img
    for (let i = 0; i < (img?.length || 0); i++) {
      const image = img![i];
      let origURL = new String(image.getLinkUrl()).toString(); //becomes "null", not null, if no equation link
      if (image.getLinkUrl() === null) {
        continue;
      }
      // console.log("Current origURL " + origURL, origURL == "null", origURL === null, typeof origURL, Object.is(origURL, null), null instanceof Object, origURL instanceof Object, origURL instanceof String, !origURL)
      // console.log("Current origURL " + image.getLinkUrl(), image.getLinkUrl() === null, typeof image.getLinkUrl(), Object.is(image.getLinkUrl(), null), !image.getLinkUrl())
      // REASON: same escape()-era %uXXXX guard as derenderInlineImage — one ancient
      // image must not crash De-render All for the whole document.
      let result: ReturnType<typeof Common.derenderEquation>;
      try {
        result = Common.derenderEquation(origURL, getDocsApp());
      } catch (err) {
        console.error("removeAll: failed to decode equation URL; skipping image.", String(err), " url=", String(origURL).substring(0, 500));
        continue;
      }
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

// Derender one equation image in place: insert the recovered LaTeX text at the
// image's position in its parent and remove the image.
function derenderInlineImage(
  image: GoogleAppsScript.Document.InlineImage,
  defaultDelim: AutoLatexCommon.Delimiter
) {
  const origURL = image.getLinkUrl();
  if (!origURL) {
    return Common.DerenderResult.NullUrl;
  }
  // REASON: images rendered in the escape()-encoding era carry %uXXXX sequences that
  // decodeURIComponent rejects (URIError: URI malformed). Uncaught, one ancient image
  // crashed the whole De-render run. Log WITH the URL so the offending encoding is
  // visible, and skip just this image.
  let result: ReturnType<typeof Common.derenderEquation>;
  try {
    result = Common.derenderEquation(origURL, getDocsApp());
  } catch (err) {
    console.error("derenderInlineImage: failed to decode equation URL; skipping image.", String(err), " url=", String(origURL).substring(0, 500));
    return Common.DerenderResult.InvalidUrl;
  }
  if (!result) return Common.DerenderResult.InvalidUrl;
  const { delim: newDelim, origEq } = result;
  const delim = newDelim || defaultDelim;
  if (origEq.length <= 0) {
    console.log("Empty equation derender.");
    return Common.DerenderResult.EmptyEquation;
  }
  const parent = image.getParent() as GoogleAppsScript.Document.ListItem | GoogleAppsScript.Document.Paragraph;
  const imageIndex = parent.getChildIndex(image);
  parent.insertText(imageIndex, delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
  image.removeFromParent();
  return Common.DerenderResult.Success;
}

// Collect equation-candidate inline images from the user's selection, in document
// order. Handles both a directly selected image and selections that span
// paragraphs/list items containing images.
function collectSelectedInlineImages(selection: GoogleAppsScript.Document.Range) {
  const images: GoogleAppsScript.Document.InlineImage[] = [];
  for (const rangeElement of selection.getRangeElements()) {
    const el = rangeElement.getElement();
    const elType = el.getType();
    if (elType === DocumentApp.ElementType.INLINE_IMAGE) {
      images.push(el.asInlineImage());
    } else if (elType === DocumentApp.ElementType.PARAGRAPH || elType === DocumentApp.ElementType.LIST_ITEM) {
      const container = el as GoogleAppsScript.Document.Paragraph | GoogleAppsScript.Document.ListItem;
      for (let i = 0; i < container.getNumChildren(); i++) {
        const child = container.getChild(i);
        if (child.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
          images.push(child.asInlineImage());
        }
      }
    }
  }
  return images;
}

function editEquations(sizeRaw: string, delimiter: string, renderer: string = "auto") {
  const defaultDelim = Common.getDelimiters(delimiter);
  Common.savePrefs(sizeRaw, delimiter, renderer);

  // REASON: users naturally click/select the equation image itself and hit
  // De-render; the cursor-only flow returned CursorNotFound for that (a selection
  // means there is no cursor). Derender every equation image in the selection —
  // in reverse document order so earlier removals can't shift later indices.
  const selection = DocumentApp.getActiveDocument().getSelection();
  if (selection) {
    const images = collectSelectedInlineImages(selection);
    if (images.length === 0) {
      return { result: Common.DerenderResult.NonExistentElement, successCount: 0 };
    }
    let successCount = 0;
    let lastFailureResult = Common.DerenderResult.InvalidUrl;
    for (const image of images.reverse()) {
      const result = derenderInlineImage(image, defaultDelim);
      if (result === Common.DerenderResult.Success) {
        successCount++;
      } else {
        lastFailureResult = result;
      }
    }
    return successCount > 0
      ? { result: Common.DerenderResult.Success, successCount }
      : { result: lastFailureResult, successCount: 0 };
  }

  const cursor = DocumentApp.getActiveDocument().getCursor();
  if (!cursor) {
    return { result: Common.DerenderResult.CursorNotFound, successCount: 0 };
  }

  const elementRaw = cursor.getElement();
  if (!elementRaw) {
    return { result: Common.DerenderResult.NonExistentElement, successCount: 0 };
  }

  // REASON: Cursor.getElement() can return any Element subtype (Table, TableOfContents,
  // FootnoteSection, etc.) - not just Paragraph/ListItem. The previous code did an unchecked
  // `as ListItem | Paragraph` cast and then called .getNumChildren(), which crashed with
  // "TypeError: element.getNumChildren is not a function" for users whose cursor was inside
  // a table cell or footnote. Validate the element type up front.
  const elementType = elementRaw.getType();
  if (elementType !== DocumentApp.ElementType.PARAGRAPH && elementType !== DocumentApp.ElementType.LIST_ITEM) {
    console.log("editEquations: cursor is in unsupported element type", elementType);
    return { result: Common.DerenderResult.NonExistentElement, successCount: 0 };
  }

  const element = elementRaw as GoogleAppsScript.Document.ListItem | GoogleAppsScript.Document.Paragraph;
  console.log("Valid cursor.");

  const position = cursor.getOffset(); //offset
  if (position >= element.getNumChildren()) {
    return { result: Common.DerenderResult.CursorNotFound, successCount: 0 };
  }

  // REASON: getChild(position).asInlineImage() throws "TEXT can't be cast to INLINE_IMAGE"
  // when the user's cursor is on text instead of an equation image. Check the child type
  // first and return a precise status so the sidebar can tell them to click the image.
  const childAtCursor = element.getChild(position);
  if (childAtCursor.getType() !== DocumentApp.ElementType.INLINE_IMAGE) {
    console.log("editEquations: child at cursor is not an inline image", childAtCursor.getType());
    return { result: Common.DerenderResult.NonExistentElement, successCount: 0 };
  }

  const image = childAtCursor.asInlineImage();
  Common.debugLog("Image height", image.getHeight());
  const cursorResult = derenderInlineImage(image, defaultDelim);
  return {
    result: cursorResult,
    successCount: cursorResult === Common.DerenderResult.Success ? 1 : 0
  };
}
