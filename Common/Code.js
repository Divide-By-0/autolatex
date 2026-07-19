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
// REASON: DEBUG gates all per-equation diagnostic console.logs (debugLog()). Left on, every render by every
// user worldwide ingests ~15-25 log lines into Cloud Logging, which quadrupled ingestion (~3.5->14 GB/day,
// ~$25->$185/mo) after the 2026-05-12 deploy. Keep false in prod; flip to true + redeploy only when actively
// debugging. Errors and metric-feeding logs (reportDeltaTime, "Worked with renderer") stay on raw console.log.
var DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information
var TIMING_DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information
var previousTime = 0;
var previousLine = 0;
var equationRenderingTime = 0;
var codecogsSlow = 0;
var texrendrDown = 0;
/**
 * @public
 */
var capableRenderers = 8;
/**
 * @public
 */
var capableDerenderers = 13;
/**
 * Renderer ID constants for retreiving info about specific renderers
 * @public
*/
var rendererIds = {
    CODECOGS: 1,
    MATHJAX: 13
};
var MATHJAX_VIEWER_URL = "https://saxarona.github.io/mathjax-viewer/?input=";
//render bug variables
/**
 * @public
 */
var invalidEquationHashCodecogsFirst50 = "GIF89a%7F%00%18%00%uFFFD%00%00%uFFFD%u0315%uFFFD3%"; // invalid codecogs equation
var invalidEquationHashCodecogsFirst50_3 = "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00%01%"; // this is one space in codecogs. not pushed yet.
var invalidEquationHashCodecogsFirst50_4 = "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0";
var invalidEquationHashCodecogsFirst50_5 = "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00z%00";
var invalidEquationHashTexrendrFirst50 = "GIF89a%uFFFD%008%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%";
var invalidEquationHashTexrendrFirst50_2 = "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0";
var invalidEquationHashTexrendrFirst50_3 = "GIF89ai%0A%uFFFD%01%uFFFD%00%00%uFFFD%uFFFD%uFFFD%"; // this is the No Expression Supplied error. Ignored for now.
var invalidEquationHashTexrendrFirst50_4 = "%7FELF%01%01%01%00%00%00%00%00%00%00%00%00%02%00%0";
var invalidEquationHashSciweaversFirst50 = "%0D%0A%09%3C%21DOCTYPE%20html%20PUBLIC%20%22-//W3C";
var defaultRendererPreference = "auto";
var activeRendererPreference = null;
function normalizeRendererPreference(renderer) {
    switch ((renderer || "").toLowerCase()) {
        case "codecogs":
            return "codecogs";
        case "mathjax":
            return "mathjax";
        case "texrendr":
            return "texrendr";
        case "sciweavers":
            return "sciweavers";
        default:
            return defaultRendererPreference;
    }
}
function getPreferredRendererFamily(rendererPreference) {
    switch (normalizeRendererPreference(rendererPreference)) {
        case "codecogs":
            return "Codecogs";
        case "texrendr":
            return "Texrendr";
        case "sciweavers":
            return "Sciweavers";
        default:
            return "";
    }
}
function getPreferredRenderer() {
    if (activeRendererPreference !== null) {
        return activeRendererPreference;
    }
    activeRendererPreference = normalizeRendererPreference(PropertiesService.getUserProperties().getProperty("renderer"));
    return activeRendererPreference;
}
function normalizeColorChannel(value) {
    if (typeof value !== "number" || !isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(255, Math.round(value)));
}
function isRenderOptions(value) {
    return typeof value === "object" && value !== null && "delim" in value;
}
function getDefaultRenderOptions(delim) {
    return {
        size: 0,
        defaultSize: 11,
        inline: false,
        delim: delim,
        clientRender: false,
        r: 0,
        g: 0,
        b: 0,
    };
}
function normalizeRenderEquationArgs(renderOptionsOrQuality, legacyDelim, legacyInline, legacyRed, legacyGreen, legacyBlue) {
    if (!isRenderOptions(renderOptionsOrQuality)) {
        var fallbackDelim_1 = legacyDelim || getDelimiters("$$");
        return __assign(__assign({}, getDefaultRenderOptions(fallbackDelim_1)), { inline: Boolean(legacyInline), r: normalizeColorChannel(legacyRed), g: normalizeColorChannel(legacyGreen), b: normalizeColorChannel(legacyBlue) });
    }
    var fallbackDelim = renderOptionsOrQuality.delim || getDelimiters("$$");
    return __assign(__assign(__assign({}, getDefaultRenderOptions(fallbackDelim)), renderOptionsOrQuality), { delim: fallbackDelim, r: normalizeColorChannel(renderOptionsOrQuality.r), g: normalizeColorChannel(renderOptionsOrQuality.g), b: normalizeColorChannel(renderOptionsOrQuality.b) });
}
function getRendererOrder() {
    var preferredFamily = getPreferredRendererFamily(getPreferredRenderer());
    var defaultOrder = [];
    var prioritizedOrder = [];
    var fallbackOrder = [];
    for (var worked = 1; worked <= capableRenderers; ++worked) {
        defaultOrder.push(worked);
    }
    if (!preferredFamily) {
        return defaultOrder;
    }
    for (var _i = 0, defaultOrder_1 = defaultOrder; _i < defaultOrder_1.length; _i++) {
        var worked = defaultOrder_1[_i];
        if (getRenderer(worked)[5] === preferredFamily) {
            prioritizedOrder.push(worked);
        }
        else {
            fallbackOrder.push(worked);
        }
    }
    return prioritizedOrder.concat(fallbackOrder);
}
/**
 * @public
 */
function reportDeltaTime(line, forcePrint) {
    if (line === void 0) { line = 0; }
    if (forcePrint === void 0) { forcePrint = ""; }
    var thisTime = Date.now();
    if (!previousTime)
        previousTime = thisTime;
    var deltaTime = thisTime - previousTime;
    if (TIMING_DEBUG || forcePrint) {
        if (line > 0) {
            var metadata = forcePrint ? " with metadata " + forcePrint : "";
            console.log("Delta time is " + deltaTime + " on line " + line + " from previous line " + previousLine + metadata);
        }
        else {
            console.log("Delta time is " + deltaTime + " from previous line " + previousLine);
        }
    }
    if (forcePrint) {
        equationRenderingTime = deltaTime;
    }
    previousTime = thisTime;
    previousLine = line;
    return deltaTime;
}
/**
 * @public
 */
function encodeFlag(flag, renderCount) {
    switch (flag) {
        case -2:
            return -2 - renderCount;
        case -1:
            return -1;
        case 0:
            return renderCount;
        default:
            return 0;
    }
}
/**
 * @public
 */
function assert(value, command) {
    if (command === void 0) { command = "unspecified"; }
    if (!value) {
        console.error("Assert failed! When doing ", command);
    }
}
//encode function that gets Missed. Google Docs characters stuff
function getCustomEncode(equation, direction, time, app) {
    // there are two sublists because they happen at differeent times (on encode or decoded string).
    // In addition, the second set is one way due to typing errors/unsupported characters.
    // Replace the first array just for the accompanying link. 	%C2%AD is better than %A0
    // Slides and Docs have different characters for representing a shift-enter
    var toFind = [
        ["#", "+", app.newlineCharacter, app.newlineCharacter, app.newlineCharacter],
        ["‘", "’", "”", "“", "−", "≥", "≤", "‐", "—"],
    ];
    var toReplace = [
        ["+%23", "+%2B", "%5C%5C%5C%5C%20", "%5C%5C%20", "%A0"],
        ["'", "'", '"', '"', "-", "\\geq", "\\leq", "-", "-"],
    ]; //&hash;&plus; todo ≥ with \geq
    assert(toFind[time].length == toReplace[time].length, "toFind[time].length == toReplace[time].length");
    for (var i = 0; i < toFind[time].length; ++i) {
        if (direction === 0)
            equation = equation.split(toFind[time][i]).join(toReplace[time][i]);
        else if (direction === 1 && time === 0) {
            // the single, double quotes, and hyphens should stay minus signs.
            equation = equation.split(toReplace[time][i]).join(toFind[time][i]);
        }
    }
    return equation;
}
//
//The one indexed 3rd rendering service needs this for file names
function getFilenameEncode(equation, direction) {
    var toFind = ["+", "'", "%", "(", ")", "&", ";", ".", "~", "*", "{", "}"];
    var toReplace = ["†", "‰27", "‰", "‹", "›", "§", "‡", "•", "˜", "ª", "«", "»"];
    for (var i = 0; i < Math.min(toFind.length, toReplace.length); ++i) {
        if (direction === 0)
            equation = equation.split(toFind[i]).join(toReplace[i]);
        else if (direction === 1)
            equation = equation.split(toReplace[i]).join(toFind[i]);
    }
    return equation;
}
/**
 * Retrives the equation from the paragraph, encodes it, and returns it.
 * @public
 */
function reEncode(equation, app) {
    equation = getCustomEncode(equation, 0, 1, app);
    // remove non-ascii characters (but separate diacritics where possible)
    equation = equation.normalize("NFC").replace(/[\u{0080}-\u{FFFF}]/gu, function (match) {
        var normalized = match.normalize("NFD").split("");
        var result = "";
        var resultEnd = "";
        for (var _i = 0, normalized_1 = normalized; _i < normalized_1.length; _i++) {
            var char = normalized_1[_i];
            if (char in UNICODE_MATH.symbols) {
                // include space after command
                result += UNICODE_MATH.symbols[char] + " ";
            }
            else if (char in UNICODE_MATH.accents) {
                // accent commands go to the beginning
                result = UNICODE_MATH.accents[char] + "{" + result;
                resultEnd += "}";
            }
            else {
                // if all else fails, just passthrough the character
                result += char;
            }
        }
        return result + resultEnd;
    });
    return getCustomEncode(encodeURIComponent(equation), 0, 0, app); //escape deprecated
}
/**
 * Decode a reEncoded equation for the client-side (MathJax) renderer.
 *
 * REASON: reEncode turns each in-equation newline into an encoded four-backslash
 * marker ("%5C%5C%5C%5C%20"). Restore it to the app's literal newline character
 * (Docs \r, Slides \v, Sheets \n) so the sidebar can decide per-position whether
 * a newline is a row break or cosmetic paste formatting, and collapse legacy
 * doubled row breaks in ENCODED space exactly like the Codecogs path — a
 * three-backslash run (e.g. "\\\hline") encodes to three %5C tokens and cannot
 * false-match. Never collapse pairs in decoded space: that halving corrupted
 * tables and align/matrix row breaks (fixed 2026-07).
 * @public
 */
function getClientEquation(equationOriginal, app) {
    return decodeURIComponent(equationOriginal
        .split("%5C%5C%5C%5C%20").join(app.newlineCharacter)
        .split("%5C%5C%5C%5C").join("%5C%5C"));
}
/**
 * returns the deencoded equation as a string.
 */
function deEncode(equation, app) {
    reportDeltaTime(269);
    debugLog("Equation to derender", equation);
    // First decode pass - handles newlines, #, and +
    var decoded = decodeURIComponent(getCustomEncode(getFilenameEncode(equation, 1), 1, 0, app));
    debugLog("First decode pass", decoded);
    reportDeltaTime(274);
    // Second pass - handles quotes and other characters
    var equationStringDecoded = getCustomEncode(decoded, 1, 1, app);
    debugLog("Second decode pass", +equationStringDecoded);
    return equationStringDecoded;
}
/**
 * Using the encoded equation, add the commands for high quality, inline or not (based on size neg or pos), and returns it.
 *
 * @param  equationStringEncoded  The encoded equation.
 * @param quality                The dpi quality to be rendered in (default 900).
 * @param inlineStyle            The text to be inserted for inline text, dependent on CodeCogs or TeXRendr.
 * @param size                   The size of the text, whose neg/pos indicated whether the equation is inline or not.
 */
function getStyle(equationStringEncoded, renderer, type, _a) {
    var inline = _a.inline, red = _a.r, green = _a.g, blue = _a.b;
    //ERROR?
    var equation = [];
    reportDeltaTime(307);
    // handle RGB coloring, except on Texrendr
    if (renderer[5] !== "Texrendr") {
        // \color[RGB]{0,0,0}
        equationStringEncoded = "%5Ccolor%5BRGB%5D%7B" + red + "%2C" + green + "%2C" + blue + "%7D" + equationStringEncoded;
    }
    if (inline) {
        // wrap in renderer inline delimiters
        equationStringEncoded = renderer[3] + "%7B" + equationStringEncoded + renderer[4] + "%7D";
    }
    else {
        // just wrap in curly braces
        equationStringEncoded = "%7B" + equationStringEncoded + "%7D";
    }
    debugLog("textColor: " + red + ", " + green + ", " + blue);
    debugLog("equationStringEncoded: " + equationStringEncoded);
    if (type === 2) {
        equationStringEncoded = equationStringEncoded.split("&plus;").join("%2B"); //HACKHACKHACKHACK REPLACE
        equationStringEncoded = equationStringEncoded.split("&hash;").join("%23"); //HACKHACKHACKHACK REPLACE
    }
    equation.push(equationStringEncoded);
    reportDeltaTime(315);
    return equationStringEncoded;
}
/**
 * @public
 */
function savePrefs(size, delim, renderer) {
    if (renderer === void 0) { renderer = defaultRendererPreference; }
    var userProperties = PropertiesService.getUserProperties();
    var normalizedRenderer = normalizeRendererPreference(renderer);
    activeRendererPreference = normalizedRenderer;
    userProperties.setProperty("size", size);
    userProperties.setProperty("delim", delim);
    userProperties.setProperty("renderer", normalizedRenderer);
    // userProperties.setProperty('defaultSize', size);
}
/**
 * @public
 */
function getPrefs() {
    var userProperties = PropertiesService.getUserProperties();
    var renderer = normalizeRendererPreference(userProperties.getProperty("renderer"));
    if (renderer === "codecogs") {
        // REASON: Older installs could have Codecogs saved as their effective default.
        // During Codecogs outages that makes the first render path block before auto
        // fallback can help, so migrate saved Codecogs preferences back to Automatic.
        renderer = defaultRendererPreference;
        userProperties.setProperty("renderer", renderer);
    }
    var savedPrefs = {
        size: userProperties.getProperty("size"),
        delim: userProperties.getProperty("delim"),
        renderer: renderer,
    };
    activeRendererPreference = savedPrefs.renderer;
    debugLog("Got prefs size:" + savedPrefs.size + " renderer:" + savedPrefs.renderer);
    return savedPrefs;
}
/**
 * @public
 */
function getKey() {
    var key = Session.getTemporaryActiveUserKey();
    console.log("Got Key: " + key);
    return key;
}
/**
 * @public
 */
function renderEquation(equationOriginal, renderOptionsOrQuality, legacyDelim, legacyInline, legacyRed, legacyGreen, legacyBlue) {
    var renderOptions = normalizeRenderEquationArgs(renderOptionsOrQuality, legacyDelim, legacyInline, legacyRed, legacyGreen, legacyBlue);
    var equation = "";
    var renderer = null;
    var resp = null;
    var failure = 1;
    var rendererType = "";
    var deltaTime;
    var worked = capableRenderers + 1;
    var failedCodecogs = 0;
    var failedTexrendr = 0;
    var failedResp = null;
    var authorizationError = false;
    // if only failed codecogs, probably weird evening bug from 10/15/19
    // if failed codecogs and texrendr, probably shitty equation and the codecogs error is more descriptive so show it
    // REASON: allowedServerFamilies restricts which server renderers are attempted in this call.
    // Explicit renderer choices use this to narrow the family. Auto's post-MathJax fallback
    // also uses it to avoid retrying Codecogs when the client-side path needs server backup.
    var rendererOrder = getRendererOrder();
    if (renderOptions.allowedServerFamilies) {
        rendererOrder = rendererOrder.filter(function (idx) {
            var family = getRenderer(idx)[5];
            return renderOptions.allowedServerFamilies.includes(family);
        });
    }
    for (var _i = 0, rendererOrder_1 = rendererOrder; _i < rendererOrder_1.length; _i++) {
        var rendererIndex = rendererOrder_1[_i];
        worked = rendererIndex;
        //[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
        try {
            renderer = getRenderer(worked);
            rendererType = renderer[5];
            equation = getStyle(equationOriginal, renderer, worked, renderOptions);
            // console.log(rendererType, "Texrendr", rendererType == "Texrendr")
            if (rendererType == "Texrendr") {
                // console.log("Used texrendr", equation, equation.replace("%5C%5C", "%0D"))
                equation = equation.split("%A0").join("%0D"); //.replace("%5C%5C", "%0D") .replace("%C2%AD", "%0D")
            }
            else if (rendererType == "Codecogs") {
                // console.log("Used Codecogs", equation, equation.split("%5C%5C%5C%5C").join("%5C%5C"))
                equation = equation
                    .split("%5C%5C%5C%5C").join("%5C%5C")
                    .replace("~", "%5C,%5C,"); // https://github.com/Divide-By-0/autolatex/issues/27
            }
            else if (rendererType == "Sciweavers") {
                // console.log("Used Sciweavers", equation, equation.split("%5C%5C%5C%5C").join("%5C%5C"))
                equation = equation.split("%5C%5C%5C%5C").join("%5C%5C"); //.replace("%A0", "%0D") .replace("%C2%AD", "%0D")
            }
            debugLog("Raw equation", equation);
            renderer[1] = renderer[1].split("FILENAME").join(getFilenameEncode(equation, 0));
            renderer[1] = renderer[1].split("EQUATION").join(equation);
            renderer[2] = renderer[2].split("FILENAME").join(getFilenameEncode(equation, 0)); // since mutating original object, important each is a new one
            debugLog("Link with equation", renderer[1]);
            debugLog("Title Alt Text " + renderer[2] + equationOriginal + "#" + renderOptions.delim[6]);
            debugLog("Cached equation: " + renderer[2] + renderer[6] + equation);
            reportDeltaTime(453);
            debugLog("Fetching ", renderer[1], " and ", renderer[2] + renderer[6] + equation);
            // REASON: GET-based renderers 400 (Codecogs) or hang on very long URLs, and the
            // sidebar could only guess "the equation was too long". Skip the fetch with an
            // explicit error so the log states the real cause (with the equation, via the
            // catch below) and the next renderer is tried. 8000 chars is beyond every
            // observed successful render but under the point where Codecogs starts 400ing.
            if (renderer[1].length > 8000) {
                throw new Error("Equation URL too long for " + rendererType + " (" + renderer[1].length + " chars > 8000)");
            }
            var _createFileInCache = UrlFetchApp.fetch(renderer[2] + renderer[6] + equation);
            // simulates putting text into text renderer => creates link for cached image which is accessed later
            // needed for codecogs to generate equation properly, need to figure out which other renderers need this. to test, use align* equations.
            reportDeltaTime(458, " fetching w eqn len " + equation.length + " with renderer " + rendererType);
            if (rendererType == "Codecogs" || rendererType == "Sciweavers") {
                Utilities.sleep(50); // sleep 50ms to let codecogs put the equation in its cache
            }
            resp = UrlFetchApp.fetch(renderer[1]);
            // REASON: removed `debugLog(resp, resp.getBlob(), ...)` here — dumping the HTTPResponse and Blob objects
            // printed ~25 lines of `{ method: [Function], ... }` per equation and was the single largest Cloud Logging
            // cost. The meaningful part (the hash prefix) is already logged below; re-add only if truly needed.
            deltaTime = reportDeltaTime(470, " equation link length " + renderer[1].length + " and renderer  " + rendererType);
            debugLog("Hash ", escape(resp.getBlob().getDataAsString()).substring(0, 50));
            if (!escape(resp.getBlob().getDataAsString())) {
                // if there is no hash, codecogs failed
                throw new Error("Saw NO Codecogs equation hash! Renderer likely down!");
            }
            else if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashSciweaversFirst50) {
                // if there is no hash, codecogs failed
                throw new Error("Saw weburl Sciweavers equation hash! Equation likely contains amsmath!");
            }
            else if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50 ||
                escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50_3 ||
                escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50_4 ||
                escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50_5) {
                console.log("Invalid Codecogs Equation! Times: " + failedCodecogs + failedTexrendr);
                failedCodecogs += 1;
                failedResp = resp;
                if (failedCodecogs && failedTexrendr) {
                    // if in order so failed codecogs first
                    console.log("Displaying codecogs error!");
                    resp = failedResp; // let it continue to completion with the failed codecogs equation
                }
                else {
                    throw new Error("Saw invalid Codecogs equation hash!");
                }
            } // have no idea if I can put an else here or not lol
            if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashTexrendrFirst50 ||
                escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashTexrendrFirst50_2 ||
                escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashTexrendrFirst50_3 ||
                escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashTexrendrFirst50_4) {
                console.log("Invalid Texrendr Equation! Times: " + failedCodecogs + failedTexrendr);
                failedTexrendr += 1;
                if (failedCodecogs && failedTexrendr) {
                    // if in order so failed codecogs first
                    console.log("Displaying Texrendr error!");
                    if (failedResp)
                        resp = failedResp; // let it continue to completion with the failed codecogs equation
                }
                else {
                    // should only execute if texrendr is 1
                    throw new Error("Saw invalid Texrendr equation hash!");
                }
            }
            if (deltaTime > 10000 && rendererType == "Codecogs" && renderer[0] <= 3) {
                console.log("Codecogs accurate but is slow! Switching renderer priority.");
                codecogsSlow = 1;
            }
            failure = 0;
            console.log("Worked with renderer ", worked, " and type ", rendererType);
            break;
        }
        catch (err) {
            if (isUrlFetchAuthorizationError(err)) {
                authorizationError = true;
            }
            // REASON: DEBUG=false silenced the per-render "Raw equation" debugLog, which
            // was the only place the equation appeared — leaving failure logs undebuggable.
            // Attach a truncated equation to the (rare) error path only, so failures stay
            // diagnosable without reintroducing per-render ingestion cost.
            console.log(rendererType + " Error! - " + err + " | eqn: " + equationOriginal);
            var failedEquationLinkLength = renderer ? renderer[1].length : -1;
            deltaTime = reportDeltaTime(533, " failed equation link length " + failedEquationLinkLength + " and renderer  " + rendererType);
            if (rendererType == "Texrendr") {
                // equation.indexOf("align")==-1 &&  removed since align now supported
                console.log("Texrendr likely down, deprioritized!");
                texrendrDown = 1;
            }
        }
        if (failure == 0)
            break;
    }
    if (failure != 0) {
        worked = capableRenderers + 1;
    }
    return {
        resp: resp,
        renderer: renderer,
        rendererType: rendererType,
        worked: worked,
        equation: equation,
        authorizationError: authorizationError
    };
}
function isUrlFetchAuthorizationError(err) {
    var message = String(err || "");
    return message.indexOf("You do not have permission to call UrlFetchApp.fetch") !== -1 ||
        message.indexOf("script.external_request") !== -1;
}
/**
 * Given the locations of the delimiters, run code to get font size, get equation, remove equation, encode/style equation, insert/style image.
 *
 * @param paragraph  The paragraph which the child is in.
 * @param childIndex The childIndex in the paragraph where the text is in, to give the place to edit image.
 * @param height     The scaled height of the equation based on font size.
 * @param width      The scaled width of the equation based on font size.
 * @public
 */
function sizeImage(app, paragraph, childIndex, height, width) {
    var maxWidth = app.getPageWidth();
    //console.log("Max Page Width: " + maxWidth);
    if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
        debugLog("Rescaled in page.");
    }
    if (childIndex == null || width == 0 || height == 0) {
        console.log("none or 0 width hight");
        return;
    }
    paragraph.getChild(childIndex).asInlineImage().setHeight(height);
    paragraph.getChild(childIndex).asInlineImage().setWidth(width);
}
/**
 * NOTE: one indexed. if codecogsSlow is 1, switch order of texrendr and codecogs
 * @public
 */
function getRenderer(worked) {
    //  order of execution ID, image URL, editing URL, in-line commandAt the beginning, in-line command at and, Human name, the part that gets rendered in browser in the fake call but not in the link(No Machine name substring)
    var codeCogsPriority = 1;
    var sciWeaverPriority = 5;
    var texRenderPriority = 4;
    if (codecogsSlow) {
        sciWeaverPriority = 1;
        codeCogsPriority = 3;
        texRenderPriority = 2;
    } //t , c, s
    if (worked == codeCogsPriority) {
        return [
            codeCogsPriority,
            "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION",
            "https://www.codecogs.com/eqnedit.php?latex=",
            "%5Cinline%20",
            "",
            "Codecogs",
            "%5Cdpi%7B900%7D",
        ];
    }
    else if (worked == codeCogsPriority + 1) {
        return [
            codeCogsPriority + 1,
            "https://latex-staging.easygenerator.com/gif.latex?%5Cdpi%7B900%7DEQUATION",
            "https://latex-staging.easygenerator.com/eqneditor/editor.php?latex=",
            "%5Cinline%20",
            "",
            "Codecogs",
            "%5Cdpi%7B900%7D",
        ];
    }
    else if (worked == codeCogsPriority + 2) {
        return [
            codeCogsPriority + 2,
            "https://latex.codecogs.com/gif.latex?%5Cdpi%7B900%7DEQUATION",
            "https://www.codecogs.com/eqnedit.php?latex=",
            "%5Cinline%20",
            "",
            "Codecogs",
            "%5Cdpi%7B900%7D",
        ];
    }
    else if (worked == texRenderPriority) {
        return [texRenderPriority, "http://texrendr.com/cgi-bin/mimetex?%5CHuge%20EQUATION", "http://www.texrendr.com/?eqn=", "%5Ctextstyle%20", "", "Texrendr", ""];
    } //http://rogercortesi.com/eqn/index.php?filename=tempimagedir%2Feqn3609.png&outtype=png&bgcolor=white&txcolor=black&res=900&transparent=1&antialias=1&latextext=  //removed %5Cdpi%7B900%7D
    else if (worked == sciWeaverPriority) {
        return [
            sciWeaverPriority,
            "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=100&ff=modern&edit=0&eq=EQUATION",
            "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=100&ff=modern&edit=0&eq=",
            "%5Ctextstyle%20%7B",
            "%7D",
            "Sciweavers",
            "",
        ];
    } //not latex font
    else if (worked == 6) {
        return [
            6,
            "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION",
            "https://www.codecogs.com/eqnedit.php?latex=",
            "%5Cinline%20",
            "",
            "Codecogs",
            "%5Cdpi%7B900%7D",
        ];
    }
    else if (worked == 7) {
        return [
            7,
            "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=iwona&edit=0&eq=EQUATION",
            "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=iwona&edit=0&eq=",
            "%5Ctextstyle%20%7B",
            "%7D",
            "Sciweavers",
            "",
        ];
    } // here to de render legacy equations properly, don't remove without migrating to correct font!
    else if (worked == 8) {
        return [
            8,
            "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=anttor&edit=0&eq=EQUATION",
            "http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=png&fs=100&ff=anttor&edit=0&eq=",
            "%5Ctextstyle%20%7B",
            "%7D",
            "Sciweavers",
            "",
        ];
    } // here to de render legacy equations properly, don't remove without migrating to correct font!
    else if (worked == 9) {
        return [
            9,
            "http://rogercortesi.com/eqn/tempimagedir/_FILENAME.png",
            "http://rogercortesi.com/eqn/index.php?filename=_FILENAME.png&outtype=png&bgcolor=white&txcolor=black&res=1800&transparent=1&antialias=0&latextext=",
            "%5Ctextstyle%20%7B",
            "%7D",
            "Roger's renderer",
            "",
        ];
    } //Filename has to not have any +, Avoid %,Instead use†‰, avoid And specific ASCII Percent codes
    else if (worked == 10) {
        return [10, "https://texrendr.com/cgi-bin/mathtex.cgi?%5Cdpi%7B1800%7DEQUATION", "https://www.texrendr.com/?eqn=", "%5Ctextstyle%20", "", "Texrendr", ""];
    } // here to de render legacy equations properly,  //http://rogercortesi.com/eqn/index.php?filename=tempimagedir%2Feqn3609.png&outtype=png&bgcolor=white&txcolor=black&res=900&transparent=1&antialias=1&latextext=  //removed %5Cdpi%7B900%7D
    else if (worked == 11) {
        return [
            11,
            "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=78&ff=arev&edit=0&eq=EQUATION",
            "http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=jpg&fs=78&ff=arev&edit=0&eq=",
            "%5Ctextstyle%20%7B",
            "%7D",
            "Sciweavers_old",
            "",
        ];
    } // here to de render legacy equations properly, don't remove without migrating to correct font!
    else if (worked == 12) {
        return [
            12,
            "http://latex.numberempire.com/render?EQUATION&sig=41279378deef11cbe78026063306e50d",
            "http://latex.numberempire.com/render?",
            "%5Ctextstyle%20%7B",
            "%7D",
            "Number empire",
            "",
        ];
    }
    // to de render MathJax equations
    else if (worked == 13) {
        return [
            13,
            MATHJAX_VIEWER_URL,
            MATHJAX_VIEWER_URL,
            "",
            "",
            "MathJax",
            "",
        ];
    }
    // to de render possibly very old equations
    else
        return [14, "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION", "https://www.codecogs.com/eqnedit.php?latex=", "%5Cinline%20", "", "Codecogs", "%5Cdpi%7B900%7D"];
}
/**
 * Given string of size, return integer value.
 *
 * @param delimiters     The text value of the delimiters from HTML selection.
 * @public
 */
function getDelimiters(delimiters) {
    // Todo - fix hardcoded delimiters. Potentially do escape(escape(original)) or something like that.
    if (delimiters == "$$" || delimiters == "all") {
        return ["$$", "$$", "\\$\\$", "\\$\\$", 2, 1, 0];
    } //raw begin, raw end, escaped begin, escaped end, # of chars, idk, renderer type #
    if (delimiters == "[") {
        return ["\\[", "\\]", "\\\\\\[", "\\\\\\]", 2, 1, 1];
    }
    if (delimiters == "$") {
        return ["$", "$", "\\$", "\\$", 1, 0, 2];
    }
    if (delimiters == "(") {
        return ["\\(", "\\)", "\\\\\\(", "\\\\\\)", 2, 1, 3];
    }
    return ["\\[", "\\]", "\\\\\\[", "\\\\\\]", 2, 1, 1];
}
/**
 * @public
 */
function getDelimiterSet(delimiters) {
    if (delimiters == "all") {
        // REASON: `$$` must be checked before `$` so the single-dollar finder does not
        // consider the two characters inside a block delimiter as separate inline delimiters.
        return [getDelimiters("$$"), getDelimiters("["), getDelimiters("("), getDelimiters("$")];
    }
    return [getDelimiters(delimiters)];
}
function getNumDelimiters(delimiters) {
    // //HARDCODED DELIMTERS!!!!!!!!!!!!!
    if (delimiters == "0") {
        return "$$";
    } //reverse lookup index 6 of array from above method
    if (delimiters == "1") {
        return "[";
    }
    if (delimiters == "2") {
        return "$";
    }
    if (delimiters == "3") {
        return "(";
    }
    return "$$";
}
/**
 * @public
 */
function debugLog() {
    var strings = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        strings[_i] = arguments[_i];
    }
    if (DEBUG) {
        // We have to ignore this because console.log with a rest parameter is part of typescript's DOM library, which Google Apps Script doesn't support.
        // @ts-ignore
        console.log.apply(console, strings);
    }
}
/**
 * Given string of size, return integer value.
 *
 * @param sizeRaw     The text value of the size from HTML selection.
 * @public
 */
function getSize(sizeRaw) {
    // handle custom sizes
    if (!isNaN(Number(sizeRaw))) {
        var parsed = Number(sizeRaw);
        if (parsed > 0) {
            return parsed;
        }
    }
    switch (sizeRaw) {
        case "smart":
            return 0;
        case "inline":
            return -1;
        case "med":
            return 24;
        case "low":
            return 12;
        default:
            return 0;
    }
}
/**
 * @public
 */
function derenderEquation(origURL, app) {
    var worked = 1;
    var found = 0;
    var renderer = [];
    for (; worked <= capableDerenderers; ++worked) {
        //[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
        renderer = getRenderer(worked)[2].split("FILENAME"); //list of possibly more than one string
        for (var I = 0; I < renderer.length; ++I) {
            if (origURL.indexOf(renderer[I]) > -1) {
                debugLog("Changing: " + origURL + " by removing " + renderer[I]);
                origURL = origURL.substring(origURL.indexOf(renderer[I])).split(renderer[I]).join(""); //removes prefix
                found = 1;
                debugLog("Next check: " + origURL + " for " + renderer[I + 1]);
            }
            else
                break;
        }
    }
    if (found == 0) {
        console.log("Not an equation link! " + origURL, origURL.indexOf(renderer[0]), origURL.indexOf(renderer[1]));
        return null; // not an equation link
    }
    var last2 = origURL.slice(-2);
    var delim = null;
    if (last2.length > 1 && (last2.charAt(0) == "%" || last2.charAt(0) == "#") && last2.charAt(1) >= "0" && last2.charAt(1) <= "9") {
        //rendered with updated renderer
        debugLog("Passed: " + last2);
        var delimtype = parseInt(last2.charAt(1)) - 0;
        origURL = origURL.slice(0, -2);
        delim = getDelimiters(getNumDelimiters(delimtype));
    }
    var origEq = deEncode(origURL, app);
    debugLog("Undid: " + origEq);
    return {
        origEq: origEq,
        delim: delim
    };
}
