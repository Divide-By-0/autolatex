/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
/* exported onOpen, showSidebar, replaceEquations */
var DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information
var DocsApp = {
    getUi: function () {
        var activeUi = DocumentApp.getUi();
        return activeUi;
    },
    getBody: function () {
        var activeBody = DocumentApp.getActiveDocument().getBody();
        return activeBody;
    },
    getActive: function () {
        var activeDoc = DocumentApp.getActiveDocument();
        return activeDoc;
    },
    getPageWidth: function () {
        var activeWidth = DocumentApp.getActiveDocument().getBody().getPageWidth();
        return activeWidth;
    },
    // A \n in Docs represents a paragraph break, while a \r (\x0D) represents a break within a paragraph
    newlineCharacter: "%0D"
};
/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} _e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(_e) {
    try {
        DocsApp.getUi().createAddonMenu().addItem("Start", "showSidebar").addToUi();
    }
    catch (error) {
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
function onInstall(e) {
    onOpen(e);
}
/**
 * Opens a sidebar in the document containing the add-on's user interface.
 */
function showSidebar() {
    var ui = HtmlService.createTemplateFromFile("Sidebar").evaluate()
        .setTitle("Auto-LaTeX Equations")
        .setSandboxMode(HtmlService.SandboxMode.IFRAME) // choose mode IFRAME which is fastest option
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // allow third party Docs clients
    DocsApp.getUi().showSidebar(ui);
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
function logMathJaxClientError(payloadJson) {
    console.error("MathJax client error:", payloadJson);
}
function getRgbFromHex(colorHex) {
    if (!colorHex || !/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
        return [0, 0, 0];
    }
    var channels = [1, 3, 5].map(function (index) { return parseInt(colorHex.slice(index, index + 2), 16); });
    if (channels.some(function (channel) { return isNaN(channel); })) {
        return [0, 0, 0];
    }
    return channels;
}
function renderEquationWithCompatibility(equationOriginal, renderOptions) {
    var compatibleRenderEquation = Common.renderEquation;
    if (compatibleRenderEquation.length >= 7) {
        return compatibleRenderEquation(equationOriginal, 900, renderOptions.delim, renderOptions.inline, renderOptions.r, renderOptions.g, renderOptions.b);
    }
    return compatibleRenderEquation(equationOriginal, renderOptions);
}
/**
 * Constantly keep replacing latex till all are finished
 * @public
 */
function replaceEquations(sizeRaw, delimiter, renderer) {
    if (renderer === void 0) { renderer = "auto"; }
    var quality = 900;
    var clientRender = renderer === "mathjax";
    // REASON: In auto mode, try Codecogs server-side first, then MathJax on client, then Texrendr/Sciweavers.
    var autoFallbackToClient = renderer === "auto";
    if (clientRender) {
        console.log("MathJax render requested.", JSON.stringify({ sizeRaw: sizeRaw, delimiter: delimiter }));
    }
    var size = Common.getSize(sizeRaw);
    var isInline = false;
    if (size < 0) {
        isInline = true;
        size = 0;
    }
    Common.reportDeltaTime(140);
    var delim = Common.getDelimiters(delimiter);
    Common.savePrefs(sizeRaw, delimiter, renderer);
    var c = 0; //counter
    var allEmpty = 0;
    Common.reportDeltaTime(146);
    var body;
    try {
        body = DocumentApp.getActiveDocument();
    }
    catch (error) {
        console.error(error);
        return {
            lastStatus: 5 /* DocsEquationRenderStatus.NoDocument */,
            successCount: 0,
            autoFixedCount: 0,
            failureDetails: []
        };
    }
    // REASON: Collect every equation we couldn't render so we can return them all to the sidebar
    // in a single response, instead of dying on the first error and hiding the rest from the user.
    var failureDetails = [];
    // REASON: Count of equations we silently auto-recovered (e.g. merged paragraph-split equations).
    // Surfaced in the sidebar so the user knows we changed their doc on their behalf.
    var autoFixedCount = 0;
    var baseRenderOptions = {
        size: size,
        defaultSize: 11,
        inline: isInline,
        delim: delim,
        clientRender: clientRender,
        autoFallbackToClient: autoFallbackToClient,
        // TODO: color support for Docs
        r: 0,
        g: 0,
        b: 0
    };
    // REASON: Collect equations that need client-side MathJax rendering instead of returning
    // on the first one. This allows Codecogs to batch-process all equations it can handle,
    // then send ALL remaining failures to the client for parallel MathJax rendering.
    var clientRenderBatch = [];
    var childCount = body.getBody().getParent().getNumChildren();
    Common.reportDeltaTime(156);
    for (var index = 0; index < childCount; index++) {
        var failedStartElemIfIsEmpty = null;
        while (true) {
            // prevFailedStartElemIfIsEmpty is here so when $$$$ fails again and again, it doesn't get stuck there and moves on.
            var findPosResult = findPos(index, baseRenderOptions, failedStartElemIfIsEmpty); //or: "\\\$\\\$", "\\\$\\\$"
            var status_1 = findPosResult.status, equationSize = findPosResult.equationSize, nextStartElement = findPosResult.nextStartElement, clientRenderOptions = findPosResult.clientRenderOptions, failureDetail = findPosResult.failureDetail;
            if (nextStartElement)
                failedStartElemIfIsEmpty = nextStartElement;
            // if we found an actual equation, update the default size
            if (equationSize)
                baseRenderOptions.defaultSize = equationSize;
            // REASON: findPos signals an auto-fix by setting equationSize === -1 in addition to the
            // regular status. We bump the count and re-run the same index from scratch since the doc
            // structure changed (paragraphs merged) and any cached RangeElement is now stale.
            if (status_1 === 8 /* DocsEquationRenderStatus.Success */ && equationSize === -1) {
                autoFixedCount++;
                failedStartElemIfIsEmpty = null;
                continue;
            }
            // count consecutive empty equations
            if (status_1 == 3 /* DocsEquationRenderStatus.EmptyEquation */) {
                allEmpty++;
            }
            else {
                allEmpty = 0;
            }
            if (allEmpty > 10)
                break; //Assume we quit on 10 consecutive empty equations.
            // quit if all renderers failed or if document failed to load (conflicting authorizations)
            if (status_1 == 0 /* DocsEquationRenderStatus.AllRenderersFailed */ ||
                status_1 == 1 /* DocsEquationRenderStatus.AuthorizationFailed */ ||
                status_1 == 5 /* DocsEquationRenderStatus.NoDocument */) {
                return {
                    lastStatus: status_1,
                    successCount: c,
                    autoFixedCount: autoFixedCount,
                    failureDetails: failureDetails
                };
            }
            // REASON: Cross-element / cross-paragraph equations we couldn't auto-fix. Record for the
            // sidebar and skip past so we don't infinite-loop on the same broken equation.
            if (status_1 === 4 /* DocsEquationRenderStatus.MultiElementEquation */) {
                if (failureDetail)
                    failureDetails.push(failureDetail);
                // failedStartElemIfIsEmpty was set above to nextStartElement (the end delimiter),
                // so the next findPos call will search after this broken equation.
                continue;
            }
            if (status_1 === 2 /* DocsEquationRenderStatus.ClientRender */ && clientRenderOptions) {
                // REASON: Collect for batch instead of returning immediately.
                // This lets Codecogs process all equations it can first, then MathJax handles the rest in parallel.
                clientRenderBatch.push(clientRenderOptions);
                continue;
            }
            // could not find next equation
            // move to next section
            if (status_1 == 7 /* DocsEquationRenderStatus.NoStartDelimiter */ || status_1 == 6 /* DocsEquationRenderStatus.NoEndDelimiter */) {
                break;
            }
            if (status_1 != 3 /* DocsEquationRenderStatus.EmptyEquation */) {
                c++;
            }
            console.log("Rendered equations: " + c);
        }
    }
    // If any equations need client-side MathJax rendering, send them all at once
    if (clientRenderBatch.length > 0) {
        console.log("MathJax queued", clientRenderBatch.length, "equations for parallel client rendering.");
        return {
            lastStatus: 2 /* DocsEquationRenderStatus.ClientRender */,
            clientEquations: clientRenderBatch,
            successCount: c,
            autoFixedCount: autoFixedCount,
            failureDetails: failureDetails
        };
    }
    return {
        lastStatus: 8 /* DocsEquationRenderStatus.Success */,
        successCount: c,
        autoFixedCount: autoFixedCount,
        failureDetails: failureDetails
    };
}
function hasEscapedSingleDollar(text, offset) {
    var slashCount = 0;
    for (var index = offset - 1; index >= 0 && text.charAt(index) === "\\"; index--) {
        slashCount++;
    }
    return slashCount % 2 === 1;
}
function isSingleDollarDelimiter(rangeElement) {
    var text = rangeElement.getElement().asText().getText();
    var offset = rangeElement.getStartOffset();
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
function findNextDelimiter(docBody, renderOptions, fromRange, delimIdx) {
    if (fromRange === void 0) { fromRange = null; }
    if (delimIdx === void 0) { delimIdx = 2; }
    if (renderOptions.delim[6] !== 2) {
        return fromRange == null
            ? docBody.findText(renderOptions.delim[delimIdx])
            : docBody.findText(renderOptions.delim[delimIdx], fromRange);
    }
    var candidate = fromRange == null ? docBody.findText("\\$") : docBody.findText("\\$", fromRange);
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
function getContainingTopLevelChild(element, body) {
    var current = element;
    while (current != null) {
        var parent_1 = current.getParent();
        if (parent_1 == null) {
            return null;
        }
        var parentType = parent_1.getType();
        if (parentType === DocumentApp.ElementType.BODY_SECTION ||
            parentType === DocumentApp.ElementType.HEADER_SECTION ||
            parentType === DocumentApp.ElementType.FOOTER_SECTION) {
            try {
                // ContainerElement already exposes getChildIndex, so no cast needed.
                var idx = parent_1.getChildIndex(current);
                return { topLevelChild: current, indexInBody: idx };
            }
            catch (err) {
                // Stale or detached element
                return null;
            }
        }
        current = parent_1;
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
function tryAutoMergeMultiParagraphEquation(body, startParaIdx, endParaIdx) {
    if (endParaIdx <= startParaIdx) {
        return { success: false, reason: "Paragraph indices out of order" };
    }
    // Verify every paragraph in the span is a plain Paragraph containing only Text children.
    // If there are tables, inline images, drawings, etc., merging would either fail outright or
    // silently destroy user content - safer to bail and show a precise error.
    for (var i = startParaIdx; i <= endParaIdx; i++) {
        var child = body.getChild(i);
        var childType = child.getType();
        if (childType !== DocumentApp.ElementType.PARAGRAPH) {
            return { success: false, reason: "Cross-paragraph equation includes a " + childType + " block" };
        }
        var para = child.asParagraph();
        for (var j = 0; j < para.getNumChildren(); j++) {
            var innerType = para.getChild(j).getType();
            if (innerType !== DocumentApp.ElementType.TEXT) {
                return { success: false, reason: "Cross-paragraph equation contains a non-text element (" + innerType + ")" };
            }
        }
    }
    var startPara = body.getChild(startParaIdx).asParagraph();
    var numToMerge = endParaIdx - startParaIdx;
    // REASON: Forward loop, always grabbing the paragraph immediately after startPara.
    // After each removeFromParent the indices above startParaIdx all shift down by one, so
    // (startParaIdx + 1) consistently points at the next paragraph to merge.
    for (var i = 0; i < numToMerge; i++) {
        var nextPara = body.getChild(startParaIdx + 1).asParagraph();
        var text = nextPara.getText();
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
function buildEquationSnippet(startElement) {
    try {
        var text = startElement.getElement().asText().getText();
        var startOffset = startElement.getStartOffset();
        if (startOffset < 0 || startOffset >= text.length) {
            return "";
        }
        var tail = text.substring(startOffset, Math.min(text.length, startOffset + 80));
        // Strip line break characters so it renders cleanly in the sidebar
        return tail.replace(/[\r\n]/g, " ").trim();
    }
    catch (err) {
        return "";
    }
}
function findPos(index, renderOptions, prevFailedStartElemIfIsEmpty) {
    if (prevFailedStartElemIfIsEmpty === void 0) { prevFailedStartElemIfIsEmpty = null; }
    Common.debugLog("Checking document section index # ", index);
    Common.reportDeltaTime(195);
    var docBody = getBodyFromIndex(index);
    if (docBody == null) {
        return {
            status: 5 /* DocsEquationRenderStatus.NoDocument */
        };
    }
    var startElement = findNextDelimiter(docBody, renderOptions, prevFailedStartElemIfIsEmpty, 2);
    if (startElement == null) {
        return {
            status: 7 /* DocsEquationRenderStatus.NoStartDelimiter */
        };
    }
    var placeHolderStart = startElement.getStartOffset(); //position of image insertion
    var endElement = findNextDelimiter(docBody, renderOptions, startElement, 3);
    // could not find the ending delimiter after the start
    if (endElement == null) {
        return {
            status: 6 /* DocsEquationRenderStatus.NoEndDelimiter */
        };
    }
    var placeHolderEnd = endElement.getEndOffsetInclusive(); //text between placeHolderStart and placeHolderEnd will be permanently deleted
    Common.debugLog(renderOptions.delim[2], " single escaped delimiters ", placeHolderEnd - placeHolderStart, " characters long");
    Common.reportDeltaTime(214);
    if (placeHolderEnd - placeHolderStart == 2.0) {
        // empty equation
        console.log("Empty equation! In index " + index + " and offset " + placeHolderStart);
        return {
            // start from the end element next time to avoid an infinite loop
            nextStartElement: endElement,
            status: 3 /* DocsEquationRenderStatus.EmptyEquation */
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
    var startContainer = getContainingTopLevelChild(startElement.getElement(), docBody);
    var endContainer = getContainingTopLevelChild(endElement.getElement(), docBody);
    if (startContainer && endContainer && startContainer.indexInBody !== endContainer.indexInBody) {
        // Cross-paragraph case (1). Try to auto-merge.
        var snippet = buildEquationSnippet(startElement);
        console.log("Detected multi-paragraph equation:", JSON.stringify({
            startParaIdx: startContainer.indexInBody,
            endParaIdx: endContainer.indexInBody,
            snippet: snippet
        }));
        var merge = tryAutoMergeMultiParagraphEquation(docBody, startContainer.indexInBody, endContainer.indexInBody);
        if (merge.success) {
            console.log("Auto-fixed multi-paragraph equation:", merge.reason);
            // REASON: Signal an auto-fix to the caller via equationSize === -1 so the loop
            // increments autoFixedCount and re-runs findPos against the fresh document state.
            // We can't recurse here because the caller's `failedStartElemIfIsEmpty` would be stale.
            return {
                status: 8 /* DocsEquationRenderStatus.Success */,
                equationSize: -1
            };
        }
        return {
            status: 4 /* DocsEquationRenderStatus.MultiElementEquation */,
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
    var range;
    try {
        range = DocsApp.getActive().newRange()
            .addElement(startElement.getElement().asText(), startElement.getStartOffset(), endElement.getEndOffsetInclusive())
            .build();
    }
    catch (rangeErr) {
        var snippet = buildEquationSnippet(startElement);
        console.warn("Could not build equation range:", JSON.stringify({
            error: String(rangeErr),
            startOffset: startElement.getStartOffset(),
            endOffset: endElement.getEndOffsetInclusive(),
            snippet: snippet
        }));
        // REASON: Distinguish "stale offsets after a prior mutation" from "real cross-element"
        // by inspecting the error message. Stale-offset errors look like "Index (N) must be less
        // than the content length (M)" — these happen when an earlier render moved text under us
        // and the user can usually fix them just by re-running the renderer. Cross-element errors
        // look like "End index (N) must be greater or equal to start index (M)" — these need a
        // structural fix in the doc.
        var errMsg = String(rangeErr || "");
        var isStaleOffset = /Index \([0-9]+\) must be less than/.test(errMsg) || /less than the content length/.test(errMsg);
        return {
            status: 4 /* DocsEquationRenderStatus.MultiElementEquation */,
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
function getEquation(rangeElement, delimiters) {
    var textElement = rangeElement.getElement().asText();
    Common.reportDeltaTime(284);
    Common.debugLog("See text", textElement.getText(), textElement.getText().length);
    var equation = textElement
        .getText()
        .substring(rangeElement.getStartOffset() + delimiters[4], rangeElement.getEndOffsetInclusive() - delimiters[4] + 1);
    Common.debugLog("See equation", equation);
    var equationStringEncoded = Common.reEncode(equation, DocsApp); //escape deprecated
    Common.reportDeltaTime(290);
    //console.log("Encoded: " + equationStringEncoded);
    return equationStringEncoded;
}
//retrieve size from text
function getSize(size, defaultSize, rangeElement) {
    var textElement = rangeElement.getElement().asText();
    //GET SIZE
    var newSize = size;
    if (size == 0) {
        try {
            newSize = textElement
                .getFontSize(rangeElement.getStartOffset() + 3); //Fix later: Change from 3 to 1
        }
        catch (err) {
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
function clientRenderComplete(equations) {
    var mathjaxRenderer = Common.getRenderer(Common.rendererIds.MATHJAX);
    var c = 0;
    console.log("MathJax client render completion received equations:", equations.length);
    // Go backwards so that the named ranges for multiple equations in the same paragraph don't get removed
    equations.reverse();
    for (var _i = 0, equations_1 = equations; _i < equations_1.length; _i++) {
        var equation = equations_1[_i];
        var namedRange = null;
        try {
            namedRange = DocsApp.getActive().getNamedRangeById(equation.options.rangeId);
            if (!namedRange) {
                console.warn("MathJax client render range disappeared before completion:", equation.options.rangeId);
                continue;
            }
            var rangeElements = namedRange.getRange().getRangeElements();
            if (rangeElements.length === 0) {
                console.warn("MathJax client render range is empty:", equation.options.rangeId);
                continue;
            }
            var equationBlob = Utilities.newBlob(Utilities.base64Decode(equation.renderedEquationB64), "image/png");
            var result = placeImage(rangeElements[0], equationBlob, mathjaxRenderer, equation.options.equationLinkEncoded, equation.options.size, equation.options.delim);
            if (result.status === 8 /* DocsEquationRenderStatus.Success */) {
                c++;
            }
        }
        catch (error) {
            console.error("MathJax client render completion failed.", error);
        }
        finally {
            namedRange === null || namedRange === void 0 ? void 0 : namedRange.remove();
        }
    }
    return {
        lastStatus: 8 /* DocsEquationRenderStatus.Success */,
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
function findEquationAndPlaceImage(startElement, renderOptions) {
    Common.reportDeltaTime(411);
    Common.reportDeltaTime(413);
    // GET VARIABLES
    var textElement = startElement.getElement().asText();
    var size = getSize(renderOptions.size, renderOptions.defaultSize, startElement);
    var equationOriginal = getEquation(startElement, renderOptions.delim);
    if (equationOriginal == "") {
        console.log("No equation but undetected start and end as ", startElement.getStartOffset(), " ", startElement.getEndOffsetInclusive());
        return {
            status: 3 /* DocsEquationRenderStatus.EmptyEquation */,
            // TODO: this _should_ be impossible - empty equations should be detected in findPos()
            nextStartElement: startElement
        };
    }
    // get font color
    var colorHex = textElement.getForegroundColor(startElement.getStartOffset());
    // Docs can return null or malformed colors in some edge cases. Fall back to black.
    var _a = getRgbFromHex(colorHex), r = _a[0], g = _a[1], b = _a[2];
    // add color info to render options
    var coloredRenderOptions = __assign(__assign({}, renderOptions), { r: r, g: g, b: b });
    // send info to the client for rendering (explicit MathJax mode)
    if (renderOptions.clientRender) {
        return buildClientRenderResponse(textElement, startElement, equationOriginal, coloredRenderOptions, size);
    }
    // REASON: In auto mode, try Codecogs first. If Codecogs fails, fall back to MathJax on the client.
    // If MathJax also fails, the client calls clientRenderFailed to try Texrendr/Sciweavers.
    if (renderOptions.autoFallbackToClient) {
        var codecogsResult = renderEquationWithCompatibility(equationOriginal, __assign(__assign({}, coloredRenderOptions), { allowedServerFamilies: ["Codecogs"] }));
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
    var _b = renderEquationWithCompatibility(equationOriginal, coloredRenderOptions), resp = _b.resp, renderer = _b.renderer, worked = _b.worked, authorizationError = _b.authorizationError;
    if (worked > Common.capableRenderers || !resp || !renderer)
        return {
            status: authorizationError ? 1 /* DocsEquationRenderStatus.AuthorizationFailed */ : 0 /* DocsEquationRenderStatus.AllRenderersFailed */
        };
    // SAVING FORMATTING
    Common.reportDeltaTime(511);
    if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50) {
        renderer = Common.getRenderer(Common.rendererIds.CODECOGS);
    }
    Common.reportDeltaTime(517);
    return placeImage(startElement, resp.getBlob(), renderer, equationOriginal, size, renderOptions.delim);
}
function buildClientRenderResponse(textElement, startElement, equationOriginal, coloredRenderOptions, size) {
    // we don't need URL encoding or double escaping for client renderers
    var clientEquation = decodeURIComponent(equationOriginal).replace(/\\\\/g, "\\");
    var doc = DocumentApp.getActiveDocument();
    var range = doc.newRange()
        .addElement(textElement, startElement.getStartOffset(), startElement.getEndOffsetInclusive())
        .build();
    // save this range for later
    var namedRange = doc.addNamedRange("ale-equation-range", range);
    var clientRenderOptions = __assign(__assign({}, coloredRenderOptions), { size: size, rangeId: namedRange.getId(), equation: clientEquation, equationLinkEncoded: encodeURIComponent(clientEquation) });
    return {
        status: 2 /* DocsEquationRenderStatus.ClientRender */,
        equationSize: size,
        clientRenderOptions: clientRenderOptions,
        nextStartElement: startElement
    };
}
/**
 * Called by the client when MathJax rendering fails in auto mode.
 * Tries remaining server-side renderers (Texrendr, Sciweavers) for the failed equations.
 * @public
 */
function clientRenderFailed(equations) {
    var c = 0;
    var authorizationFailure = false;
    console.log("MathJax client render failed, trying server fallback for", equations.length, "equations");
    // Go backwards so that the named ranges for multiple equations in the same paragraph don't get removed
    equations.reverse();
    for (var _i = 0, equations_2 = equations; _i < equations_2.length; _i++) {
        var equation = equations_2[_i];
        var namedRange = null;
        try {
            namedRange = DocsApp.getActive().getNamedRangeById(equation.options.rangeId);
            if (!namedRange) {
                console.warn("Server fallback: range disappeared:", equation.options.rangeId);
                continue;
            }
            var rangeElements = namedRange.getRange().getRangeElements();
            if (rangeElements.length === 0) {
                console.warn("Server fallback: range is empty:", equation.options.rangeId);
                continue;
            }
            var equationOriginal = Common.reEncode(equation.options.equation, DocsApp);
            // REASON: Try Texrendr and Sciweavers only - Codecogs already failed, MathJax already failed.
            var fallbackResult = renderEquationWithCompatibility(equationOriginal, {
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
            var equationBlob = fallbackResult.resp.getBlob();
            var result = placeImage(rangeElements[0], equationBlob, fallbackResult.renderer, equationOriginal, equation.options.size, equation.options.delim);
            if (result.status === 8 /* DocsEquationRenderStatus.Success */) {
                c++;
            }
        }
        catch (error) {
            console.error("Server fallback render failed.", error);
        }
        finally {
            namedRange === null || namedRange === void 0 ? void 0 : namedRange.remove();
        }
    }
    return {
        lastStatus: c > 0
            ? 8 /* DocsEquationRenderStatus.Success */
            : authorizationFailure
                ? 1 /* DocsEquationRenderStatus.AuthorizationFailed */
                : 0 /* DocsEquationRenderStatus.AllRenderersFailed */,
        successCount: c
    };
}
function placeImage(startElement, renderedEquation, renderer, equation, size, delim) {
    // GET VARIABLES
    var textElement = startElement.getElement().asText();
    var text = textElement.getText();
    var paragraph = textElement.getParent();
    var childIndex = paragraph.getChildIndex(textElement); //gets index of found text in paragaph
    var textCopy = textElement.asText().copy();
    var endLimit = startElement.getEndOffsetInclusive();
    if (text.length - 1 < endLimit)
        endLimit = text.length - 1;
    textCopy.asText().editAsText().deleteText(0, endLimit); // the copy only has the stuff after the equation
    Common.reportDeltaTime(522);
    textElement.editAsText().deleteText(startElement.getStartOffset(), text.length - 1); // from the original, yeet the equation and all the remaining text so its possible to insert the equation (try moving after the equation insertion?)
    Common.reportDeltaTime(526);
    // try inserting twice
    for (var tryNum = 1; tryNum <= 2; tryNum++) {
        try {
            paragraph.insertInlineImage(childIndex + 1, renderedEquation); // TODO ISSUE: sometimes fails because it times out and yeets
            return repairImage(paragraph, childIndex, size, renderer, delim, textCopy, renderedEquation, equation);
        }
        catch (err) {
            console.log("Could not insert image try ".concat(tryNum));
            console.error(err);
            Utilities.sleep(1000);
        }
    }
    throw new Error("Could not insert image at childindex!");
}
function repairImage(paragraph, childIndex, size, renderer, delim, textCopy, resp, equationOriginal) {
    var attemptsToSetImageUrl = 3;
    Common.reportDeltaTime(552); // 3 seconds!! inserting an inline image takes time
    while (attemptsToSetImageUrl > 0) {
        try {
            paragraph.getChild(childIndex + 1).asInlineImage().setLinkUrl(renderer[2] + equationOriginal + "#" + delim[6]); //added % delim 6 to keep track of which delimiter was used to render
            break;
        }
        catch (err) {
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
    if (textCopy.getText() != "")
        paragraph.insertText(childIndex + 2, textCopy); // reinsert deleted text after the image, with all the formatting
    var height = paragraph.getChild(childIndex + 1).asInlineImage().getHeight();
    var width = paragraph.getChild(childIndex + 1).asInlineImage().getWidth();
    console.log("Pre-fixing size, width, height: " + size + ", " + width + ", " + height); //only a '1' is rendered as a 100 height (as of 10/20/19, now it is fetched as 90 height). putting an equationrendertime here just doesnt work
    //SET PROPERTIES OF IMAGE (Height, Width)
    var oldSize = size; // why use oldsize instead of new size
    if (escape(resp.getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50 || (size > 10 && width == 126 && height == 24)) {
        size *= 5; // make codecogs errors readable, size constraint just in case some small equation is 126x24 as well
    }
    // console.log(rendererType, rendererType.valueOf(), "Texrendr".valueOf(), rendererType.valueOf() === "Codecogs".valueOf(), rendererType.valueOf() == "Codecogs".valueOf(), rendererType === "Codecogs", rendererType.valueOf() === "Texrendr".valueOf(), rendererType.valueOf() == "Texrendr".valueOf(), rendererType === "Texrendr")
    // note that valueOf here is not needed, and neither is === => removing both keeps trues true and falses false in V8.
    // if(rendererType.valueOf() === "Texrendr".valueOf())  //Old TexRendr
    // 	size = Math.round(size * height / 174);
    var multiple = size / 100.0;
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
    Common.sizeImage(DocsApp, paragraph, childIndex + 1, Math.round(height * multiple), Math.round(width * multiple));
    return {
        status: 8 /* DocsEquationRenderStatus.Success */,
        equationSize: oldSize
    };
}
function getBodyFromIndex(index) {
    var doc = DocsApp.getActive();
    var p = doc.getBody().getParent();
    var all = p.getNumChildren();
    Common.assert(index < all, "index < all");
    var body = p.getChild(index);
    var type = body.getType();
    if (type === DocumentApp.ElementType.BODY_SECTION || type === DocumentApp.ElementType.HEADER_SECTION || type === DocumentApp.ElementType.FOOTER_SECTION) {
        // handles alternating footers etc.
        return body;
    }
    return null;
}
/**
 * Given a cursor right before an equation, de-encode URL and replace image with raw equation between delimiters.
 * @public
 */
function removeAll(defaultDelimRaw) {
    var counter = 0;
    var defaultDelim = Common.getDelimiters(defaultDelimRaw);
    for (var index = 0; index < DocsApp.getBody().getParent().getNumChildren(); index++) {
        var body = getBodyFromIndex(index);
        var img = body === null || body === void 0 ? void 0 : body.getImages(); //places all InlineImages from the active document into the array img
        for (var i = 0; i < ((img === null || img === void 0 ? void 0 : img.length) || 0); i++) {
            var image = img[i];
            var origURL = new String(image.getLinkUrl()).toString(); //becomes "null", not null, if no equation link
            if (image.getLinkUrl() === null) {
                continue;
            }
            // console.log("Current origURL " + origURL, origURL == "null", origURL === null, typeof origURL, Object.is(origURL, null), null instanceof Object, origURL instanceof Object, origURL instanceof String, !origURL)
            // console.log("Current origURL " + image.getLinkUrl(), image.getLinkUrl() === null, typeof image.getLinkUrl(), Object.is(image.getLinkUrl(), null), !image.getLinkUrl())
            var result = Common.derenderEquation(origURL, DocsApp);
            if (!result)
                continue;
            var origEq = result.origEq, newDelim = result.delim;
            var delim = newDelim || defaultDelim;
            var imageIndex = image.getParent().getChildIndex(image);
            if (origEq.length <= 0) {
                console.log("Empty. at " + imageIndex + " fold " + image.getParent().getText());
                image.removeFromParent();
                continue;
            }
            var parent_2 = image.getParent();
            parent_2.insertText(imageIndex, delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
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
function editEquations(sizeRaw, delimiter, renderer) {
    if (renderer === void 0) { renderer = "auto"; }
    var defaultDelim = Common.getDelimiters(delimiter);
    Common.savePrefs(sizeRaw, delimiter, renderer);
    var cursor = DocumentApp.getActiveDocument().getCursor();
    if (!cursor) {
        return 0 /* Common.DerenderResult.CursorNotFound */;
    }
    var elementRaw = cursor.getElement();
    if (!elementRaw) {
        return 3 /* Common.DerenderResult.NonExistentElement */;
    }
    // REASON: Cursor.getElement() can return any Element subtype (Table, TableOfContents,
    // FootnoteSection, etc.) - not just Paragraph/ListItem. The previous code did an unchecked
    // `as ListItem | Paragraph` cast and then called .getNumChildren(), which crashed with
    // "TypeError: element.getNumChildren is not a function" for users whose cursor was inside
    // a table cell or footnote. Validate the element type up front.
    var elementType = elementRaw.getType();
    if (elementType !== DocumentApp.ElementType.PARAGRAPH && elementType !== DocumentApp.ElementType.LIST_ITEM) {
        console.log("editEquations: cursor is in unsupported element type", elementType);
        return 3 /* Common.DerenderResult.NonExistentElement */;
    }
    var element = elementRaw;
    console.log("Valid cursor.");
    var position = cursor.getOffset(); //offset
    if (position >= element.getNumChildren()) {
        return 0 /* Common.DerenderResult.CursorNotFound */;
    }
    // REASON: getChild(position).asInlineImage() throws "TEXT can't be cast to INLINE_IMAGE"
    // when the user's cursor is on text instead of an equation image. Check the child type
    // first and return a precise status so the sidebar can tell them to click the image.
    var childAtCursor = element.getChild(position);
    if (childAtCursor.getType() !== DocumentApp.ElementType.INLINE_IMAGE) {
        console.log("editEquations: child at cursor is not an inline image", childAtCursor.getType());
        return 3 /* Common.DerenderResult.NonExistentElement */;
    }
    var image = childAtCursor.asInlineImage();
    Common.debugLog("Image height", image.getHeight());
    var origURL = image.getLinkUrl();
    if (!origURL) {
        return 4 /* Common.DerenderResult.NullUrl */;
    }
    Common.debugLog("Original URL from image", origURL);
    var result = Common.derenderEquation(origURL, DocsApp);
    if (!result)
        return 2 /* Common.DerenderResult.InvalidUrl */;
    var newDelim = result.delim, origEq = result.origEq;
    var delim = newDelim || defaultDelim;
    if (origEq.length <= 0) {
        console.log("Empty equation derender.");
        return 1 /* Common.DerenderResult.EmptyEquation */;
    }
    cursor.insertText(delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
    element.getChild(position + 1).removeFromParent();
    return 5 /* Common.DerenderResult.Success */;
}
