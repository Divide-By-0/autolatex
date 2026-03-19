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
            lastStatus: 3 /* DocsEquationRenderStatus.NoDocument */,
            successCount: 0
        };
    }
    var baseRenderOptions = {
        size: size,
        defaultSize: 11,
        inline: isInline,
        delim: delim,
        clientRender: clientRender,
        // TODO: color support for Docs
        r: 0,
        g: 0,
        b: 0
    };
    var childCount = body.getBody().getParent().getNumChildren();
    Common.reportDeltaTime(156);
    for (var index = 0; index < childCount; index++) {
        var failedStartElemIfIsEmpty = null;
        while (true) {
            // prevFailedStartElemIfIsEmpty is here so when $$$$ fails again and again, it doesn't get stuck there and moves on.
            var _a = findPos(index, baseRenderOptions, failedStartElemIfIsEmpty), status_1 = _a.status, equationSize = _a.equationSize, nextStartElement = _a.nextStartElement, clientRenderOptions = _a.clientRenderOptions; //or: "\\\$\\\$", "\\\$\\\$"
            if (nextStartElement)
                failedStartElemIfIsEmpty = nextStartElement;
            // if we found an actual equation, update the default size
            if (equationSize)
                baseRenderOptions.defaultSize = equationSize;
            // count consecutive empty equations
            if (status_1 == 2 /* DocsEquationRenderStatus.EmptyEquation */) {
                allEmpty++;
            }
            else {
                allEmpty = 0;
            }
            if (allEmpty > 10)
                break; //Assume we quit on 10 consecutive empty equations.
            // quit if all renderers failed or if document failed to load (conflicting authorizations)
            if (status_1 == 0 /* DocsEquationRenderStatus.AllRenderersFailed */ || status_1 == 3 /* DocsEquationRenderStatus.NoDocument */) {
                return {
                    lastStatus: status_1,
                    successCount: c
                };
            }
            if (status_1 === 1 /* DocsEquationRenderStatus.ClientRender */ && clientRenderOptions) {
                console.log("MathJax queued next equation for client rendering.");
                return {
                    lastStatus: 1 /* DocsEquationRenderStatus.ClientRender */,
                    clientEquations: [clientRenderOptions],
                    successCount: 0
                };
            }
            // could not find next equation
            // move to next section
            if (status_1 == 5 /* DocsEquationRenderStatus.NoStartDelimiter */ || status_1 == 4 /* DocsEquationRenderStatus.NoEndDelimiter */) {
                break;
            }
            if (status_1 != 2 /* DocsEquationRenderStatus.EmptyEquation */) {
                c++;
            }
            console.log("Rendered equations: " + c);
        }
    }
    return {
        lastStatus: 6 /* DocsEquationRenderStatus.Success */,
        successCount: c
    };
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
function findPos(index, renderOptions, prevFailedStartElemIfIsEmpty) {
    if (prevFailedStartElemIfIsEmpty === void 0) { prevFailedStartElemIfIsEmpty = null; }
    Common.debugLog("Checking document section index # ", index);
    Common.reportDeltaTime(195);
    var docBody = getBodyFromIndex(index);
    if (docBody == null) {
        return {
            status: 3 /* DocsEquationRenderStatus.NoDocument */
        };
    }
    var startElement = docBody.findText(renderOptions.delim[2]);
    if (prevFailedStartElemIfIsEmpty) {
        startElement = docBody.findText(renderOptions.delim[2], prevFailedStartElemIfIsEmpty);
    }
    if (startElement == null) {
        return {
            status: 5 /* DocsEquationRenderStatus.NoStartDelimiter */
        };
    }
    var placeHolderStart = startElement.getStartOffset(); //position of image insertion
    var endElement = docBody.findText(renderOptions.delim[3], startElement);
    // could not find the ending delimiter after the start
    if (endElement == null) {
        return {
            status: 4 /* DocsEquationRenderStatus.NoEndDelimiter */
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
            status: 2 /* DocsEquationRenderStatus.EmptyEquation */
        };
    }
    // build the RangeElement for this equation
    // we make the assumption that the entire equation is contained within one TextElement
    var range = DocsApp.getActive().newRange()
        .addElement(startElement.getElement().asText(), startElement.getStartOffset(), endElement.getEndOffsetInclusive())
        .build();
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
            var result = placeImage(rangeElements[0], equationBlob, mathjaxRenderer, equation.options.equation, equation.options.size, equation.options.delim);
            if (result.status === 6 /* DocsEquationRenderStatus.Success */) {
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
        lastStatus: 6 /* DocsEquationRenderStatus.Success */,
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
            status: 2 /* DocsEquationRenderStatus.EmptyEquation */,
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
    // send info to the client for rendering
    if (renderOptions.clientRender) {
        // we don't need URL encoding or double escaping for client renderers
        var clientEquation = decodeURIComponent(equationOriginal).replace(/\\\\/g, "\\");
        var doc = DocumentApp.getActiveDocument();
        var range = doc.newRange()
            .addElement(textElement, startElement.getStartOffset(), startElement.getEndOffsetInclusive())
            .build();
        // save this range for later
        var namedRange = doc.addNamedRange("ale-equation-range", range);
        var clientRenderOptions = __assign(__assign({}, coloredRenderOptions), { size: size, rangeId: namedRange.getId(), equation: clientEquation });
        // make sure we can retrieve this element later
        return {
            status: 1 /* DocsEquationRenderStatus.ClientRender */,
            equationSize: size,
            clientRenderOptions: clientRenderOptions,
            nextStartElement: startElement
        };
    }
    var _b = renderEquationWithCompatibility(equationOriginal, coloredRenderOptions), resp = _b.resp, renderer = _b.renderer, worked = _b.worked;
    if (worked > Common.capableRenderers || !resp || !renderer)
        return {
            status: 0 /* DocsEquationRenderStatus.AllRenderersFailed */
        };
    // SAVING FORMATTING
    Common.reportDeltaTime(511);
    if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50) {
        renderer = Common.getRenderer(Common.rendererIds.CODECOGS);
    }
    Common.reportDeltaTime(517);
    return placeImage(startElement, resp.getBlob(), renderer, equationOriginal, size, renderOptions.delim);
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
        status: 6 /* DocsEquationRenderStatus.Success */,
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
            var parent_1 = image.getParent();
            parent_1.insertText(imageIndex, delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
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
    if (cursor) {
        // Attempt to insert text at the cursor position. If the insertion returns null, the cursor's
        // containing element doesn't allow insertions, so show the user an error message.
        var element = cursor.getElement(); //startElement
        if (element) {
            console.log("Valid cursor.");
            var position = cursor.getOffset(); //offset
            if (position >= element.getNumChildren()) {
                return 0 /* Common.DerenderResult.CursorNotFound */;
            }
            //element.getChild(position).removeFromParent();  //SUCCESSFULLY REMOVES IMAGE FROM PARAGRAPH
            // console.log(element.getAllContent(), element.type())
            var image = element.getChild(position).asInlineImage();
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
        else {
            return 3 /* Common.DerenderResult.NonExistentElement */;
        }
    }
    else {
        return 0 /* Common.DerenderResult.CursorNotFound */;
    }
}
