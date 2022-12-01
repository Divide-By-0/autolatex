/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)

var SIDEBAR_TITLE = "Auto-LaTeX Equations";
var DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information
var TIMING_DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information
var previousTime = 0;
var previousLine = 0;
var equationRenderingTime = 0;
var codecogsSlow = 0;
var texrendrDown = 0;
var capableRenderers = 8;
var capableDerenderers = 12;
//render bug variables
var invalidEquationHashCodecogsFirst50 = "GIF89a%7F%00%18%00%uFFFD%00%00%uFFFD%u0315%uFFFD3%"; // invalid codecogs equation
var invalidEquationHashCodecogsFirst50_2 = "";
var invalidEquationHashCodecogsFirst50_3 = "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00%01%"; // this is one space in codecogs. not pushed yet.
var invalidEquationHashCodecogsFirst50_4 = "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0";
var invalidEquationHashCodecogsFirst50_5 = "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00z%00";
var invalidEquationHashTexrendrFirst50 = "GIF89a%uFFFD%008%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%";
var invalidEquationHashTexrendrFirst50_2 = "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0";
var invalidEquationHashTexrendrFirst50_3 = "GIF89ai%0A%uFFFD%01%uFFFD%00%00%uFFFD%uFFFD%uFFFD%"; // this is the No Expression Supplied error. Ignored for now.
var invalidEquationHashTexrendrFirst50_4 = "%7FELF%01%01%01%00%00%00%00%00%00%00%00%00%02%00%0";
var invalidEquationHashSciweaversFirst50 = "%0D%0A%09%3C%21DOCTYPE%20html%20PUBLIC%20%22-//W3C";

// IntegratedApp = {
// 	getUi: function(){
// 		let activeUi = DocumentApp.getUi();
// 		return activeUi;
// 	},
// 	getBody: function(){
// 		let activeBody = DocumentApp.getActiveDocument().getBody();
// 		return activeBody;
// 	},
// 	getActive: function(){
// 		let activeDoc = DocumentApp.getActiveDocument();
// 		return activeDoc;
// 	},
// 	getPageWidth: function() {
// 		let activeWidth = DocumentApp.getActiveDocument().getPageWidth();
// 		return activeWidth;
// 	}
// };

/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(e) {
  DocumentApp.getUi().createAddonMenu().addItem("Start", "showSidebar").addToUi();
}

function reportDeltaTime(line = 0, forcePrint = "") {
  var thisDate = new Date();
  var thisTime = Number(thisDate.getTime()).toFixed(0);
  if (!previousTime) previousTime = thisTime;
  var deltaTime = thisTime - previousTime;
  if (TIMING_DEBUG || forcePrint) {
    if (line > 0) {
      metadata = forcePrint ? " with metadata " + forcePrint : "";
      console.log("Delta time is " + deltaTime + " on line " + line + " from previous line " + previousLine + metadata);
    } else {
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
  var ui = HtmlService.createTemplateFromFile("Sidebar").evaluate().setTitle("Auto-LaTeX Equations").setSandboxMode(HtmlService.SandboxMode.IFRAME); // choose mode IFRAME which is fastest option
  DocumentApp.getUi().showSidebar(ui);
}

//add to log
function addLog(str) {
  console.log(str);
}

/*
 * Fetch the quality the user has selected
 */
function getPreferences() {
  var userProperties = PropertiesService.getUserProperties();
  var prefs = {
    quality: userProperties.getProperty("delimiters"),
    size: userProperties.getProperty("size"),
  };
  debugLog("delimiter prefs:" + prefs.delimiters);
  debugLog("size prefs:" + prefs.size);
  return prefs;
}

function encodeFlag(flag, renderCount) {
  // return {flag: flag, renderCount: renderCount}
  // let {flag, renderCount} = input
  ans = 0;
  if (flag == -2) {
    ans = -2 - renderCount;
  }
  if (flag == -1) {
    ans = -1;
  }
  if (flag == 0) {
    ans = renderCount;
  }
  return ans;
}
/**
 * Constantly keep replacing latex till all are finished
 */
function replaceEquations(sizeRaw, delimiter) {
  // var obj = {flag: -2, renderCount: 0};
  // return obj;
  var quality = 900;
  var size = getSize(sizeRaw);
  var isInline = false;
  if (size < 0) {
    isInline = true;
    size = 0;
  }
  reportDeltaTime(140);
  var delim = getDelimiters(delimiter);
  savePrefs(sizeRaw, delimiter);
  var c = 0; //counter
  var defaultSize = 11;
  var allEmpty = 0;
  reportDeltaTime(146);
  var body;
  try {
    body = DocumentApp.getActiveDocument();
  } catch (error) {
    console.error(error);
    return encodeFlag(-1, 0);
  }

  let childCount = body.getBody().getParent().getNumChildren();
  reportDeltaTime(156);
  for (var index = 0; index < childCount; index++) {
    let failedStartElemIfIsEmpty = null;
    while (true) {
      // prevFailedStartElemIfIsEmpty is here so when $$$$ fails again and again, it doesn't get stuck there and moves on.
      let [gotSize, returnedFailedStartElemIfIsEmpty] = findPos(index, delim, quality, size, defaultSize, isInline, failedStartElemIfIsEmpty); //or: "\\\$\\\$", "\\\$\\\$"
      allEmpty = returnedFailedStartElemIfIsEmpty ? allEmpty + 1 : 0;
      failedStartElemIfIsEmpty = returnedFailedStartElemIfIsEmpty;

      if (allEmpty > 10) break; //Assume we quit on 10 consecutive empty equations.

      if (gotSize == -100000)
        // means all renderers didn't return/bugged out.
        return encodeFlag(-2, c); // instead, return pair of number and bool flag in list but whatever

      if (gotSize == 0) break; // finished with renders in this section

      defaultSize = gotSize;
      c = returnedFailedStartElemIfIsEmpty ? c : c + 1; // # of equations += 1 except empty equations
      console.log("Rendered equations: " + c);
    }
  }
  return encodeFlag(0, c);
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

function findPos(index, delim, quality, size, defaultSize, isInline, prevFailedStartElemIfIsEmpty = null) {
  debugLog("Checking document section index # ", index);
  reportDeltaTime(195);
  var docBody = getBodyFromIndex(index);
  if (docBody == null) {
    return [0, null];
  }
  var startElement = docBody.findText(delim[2]);
  if (prevFailedStartElemIfIsEmpty) {
    var startElement = docBody.findText(delim[2], prevFailedStartElemIfIsEmpty);
  }
  if (startElement == null) return [0, null]; //didn't find first delimiter
  var placeHolderStart = startElement.getStartOffset(); //position of image insertion

  var endElement = docBody.findText(delim[3], startElement);
  if (endElement == null) return [0, null]; //didn't find end delimiter (maybe make error different?)
  var placeHolderEnd = endElement.getEndOffsetInclusive(); //text between placeHolderStart and placeHolderEnd will be permanently deleted
  debugLog(delim[2], " single escaped delimiters ", placeHolderEnd - placeHolderStart, " characters long");

  reportDeltaTime(214);
  if (placeHolderEnd - placeHolderStart == 2.0) {
    // empty equation
    console.log("Empty equation! In index " + index + " and offset " + placeHolderStart);
    return [defaultSize, endElement]; // default behavior of placeImage
  }

  return placeImage(index, startElement, placeHolderStart, placeHolderEnd, quality, size, defaultSize, delim, isInline);
}

function assert(value, command = "unspecified") {
  if (value == false) {
    console.error("Assert failed! When doing ", command);
  }
}

//encode function that gets Missed. Google Docs characters stuff
function getCustomEncode(equation, direction, time) {
  // there are two sublists because they happen at differeent times (on encode or decoded string).
  // In addition, the second set is one way due to typing errors/unsupported characters.
  // Replace the first array just for the accompanying link. 	%C2%AD is better than %A0
  // Note newlines are also %0A or %0D or %0D%0A
  var toFind = [
    ["#", "+", "%0D", "%0D", "%0D"],
    ["‘", "’", "”", "“", "−", "≥", "≤", "‐", "—"],
  ];
  var toReplace = [
    ["+%23", "+%2B", "%5C%5C%5C%5C%20", "%5C%5C%20", "%A0"],
    ["'", "'", '"', '"', "-", "\\geq", "\\leq", "-", "-"],
  ]; //&hash;&plus; todo ≥ with \geq
  assert(toFind[time].length == toReplace[time].length, "toFind[time].length == toReplace[time].length");
  for (var i = 0; i < toFind[time].length; ++i) {
    if (direction == 0) equation = equation.split(toFind[time][i]).join(toReplace[time][i]);
    else if (direction == 1 && time == 0) {
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
    if (direction == 0) equation = equation.split(toFind[i]).join(toReplace[i]);
    else if (direction == 1) equation = equation.split(toReplace[i]).join(toFind[i]);
  }
  return equation;
}
/**
 * Retrives the equation from the paragraph, encodes it, and returns it.
 *
 * @param {element} paragraph  The paragraph which the child is in.
 * @param {integer} childIndex The childIndex in the paragraph where the text is in.
 * @param {integer} start      The offset in the childIndex where the equation delimiters start.
 * @param {integer} end        The offset in the childIndex where the equation delimiters end.
 */
function reEncode(equation) {
  equation = getCustomEncode(equation, 0, 1);
  var equationStringEncoded = getCustomEncode(encodeURIComponent(equation), 0, 0); //escape deprecated
  return equationStringEncoded;
}

function deEncode(equation) {
  reportDeltaTime(269);
  debugLog(equation);
  debugLog(getCustomEncode(getFilenameEncode(equation, 1), 1, 0));
  debugLog(decodeURIComponent(getCustomEncode(getFilenameEncode(equation, 1), 1, 0)));

  reportDeltaTime(274);
  var equationStringDecoded = decodeURIComponent(getCustomEncode(getFilenameEncode(equation, 1), 1, 0)); //escape deprecated
  //  console.log("Decoded without replacing: " + equationStringDecoded);
  var equationStringDecoded = getCustomEncode(equationStringDecoded, 1, 1);
  debugLog("Decoded with replacing: " + equationStringDecoded);
  return equationStringDecoded;
}

function getEquation(paragraph, childIndex, start, end, delimiters) {
  var equationOriginal = [];
  reportDeltaTime(284);
  debugLog("See text", paragraph.getChild(childIndex).getText(), paragraph.getChild(childIndex).getText().length);
  var equation = paragraph
    .getChild(childIndex)
    .getText()
    .substring(start + delimiters[4], end - delimiters[4] + 1);
  debugLog("See equation", equation);
  var equationStringEncoded = reEncode(equation); //escape deprecated
  equationOriginal.push(equationStringEncoded);
  reportDeltaTime(290);
  //console.log("Encoded: " + equationStringEncoded);
  return equationStringEncoded;
}

/**
 * Using the encoded equation, add the commands for high quality, inline or not (based on size neg or pos), and returns it.
 *
 * @param {string}  equationStringEncoded  The encoded equation.
 * @param {integer} quality                The dpi quality to be rendered in (default 900).
 * @param {string}  inlineStyle            The text to be inserted for inline text, dependent on CodeCogs or TeXRendr.
 * @param {integer} size                   The size of the text, whose neg/pos indicated whether the equation is inline or not.
 */

function getStyle(equationStringEncoded, quality, renderer, isInline, type) {
  //ERROR?
  var equation = [];
  equationStringEncoded = equationStringEncoded;
  reportDeltaTime(307);
  if (isInline) equationStringEncoded = renderer[3] + equationStringEncoded + renderer[4];
  if (type == 2) {
    equationStringEncoded = equationStringEncoded.split("&plus;").join("%2B"); //HACKHACKHACKHACK REPLACE
    equationStringEncoded = equationStringEncoded.split("&hash;").join("%23"); //HACKHACKHACKHACK REPLACE
  }
  //console.log('Equation Final: ' + equationStringEncoded);
  equation.push(equationStringEncoded);
  reportDeltaTime(315);
  return equationStringEncoded;
}

function savePrefs(size, delim) {
  var userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty("size", size);
  userProperties.setProperty("delim", delim);
  // userProperties.setProperty('defaultSize', size);
}

function getPrefs() {
  var userProperties = PropertiesService.getUserProperties();
  var savedPrefs = {
    size: userProperties.getProperty("size"),
    delim: userProperties.getProperty("delim"),
  };
  debugLog("Got prefs size:" + savedPrefs.size);
  return savedPrefs;
}

function getKey() {
  console.log("Got Key: " + Session.getTemporaryActiveUserKey() + " and email " + Session.getEffectiveUser().getEmail());
  return Session.getTemporaryActiveUserKey();
}

//retrieve size from text
function setSize(size, defaultSize, paragraph, childIndex, start) {
  //GET SIZE
  let newSize = size;
  if (size == 0) {
    try {
      newSize = paragraph
        .getChild(childIndex)
        .editAsText()
        .getFontSize(start + 3); //Fix later: Change from 3 to 1
    } catch (err) {
      newSize = paragraph
        .getChild(childIndex)
        .editAsText()
        .getFontSize(start + 1); //Fix later: Change from 3 to 1
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

// deprecated, use the indexing method to get all odd/even footers etc. as well
function getBodyFromLocation(location) {
  var docBody;
  reportDeltaTime(365);
  if (location == "header") {
    docBody = DocumentApp.getActiveDocument().getHeader();
  }
  if (location == "body") {
    docBody = DocumentApp.getActiveDocument().getBody();
  }
  if (location == "footer") {
    docBody = DocumentApp.getActiveDocument().getFooter();
    // debugLog("Got footer ", docBody.getText(), docBody.getType() === DocumentApp.ElementType.FOOTER_SECTION, docBody.getType() === DocumentApp.ElementType.HEADER_SECTION)
    // debugLog(docBody.getParent().getChild(0).getType() === DocumentApp.ElementType.BODY_SECTION, docBody.getParent().getChild(0).getType() === DocumentApp.ElementType.HEADER_SECTION )
  }
  reportDeltaTime(377);
  return docBody;
}

// to get doc section from index (i.e. header, footer, body etc)
function getBodyFromIndex(index) {
  var doc = DocumentApp.getActiveDocument();
  var p = doc.getBody().getParent();
  var all = p.getNumChildren();
  assert(index < all, "index < all");
  body = p.getChild(index);
  var type = body.getType();
  if (type === DocumentApp.ElementType.BODY_SECTION || type === DocumentApp.ElementType.HEADER_SECTION || type === DocumentApp.ElementType.FOOTER_SECTION) {
    // handles alternating footers etc.
    return body;
  }
  return null;
}

//function blobIsCCFailure(blob){
//  return escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashCodecogsFirst50
//}
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

function placeImage(index, startElement, start, end, quality, size, defaultSize, delim, isInline) {
  reportDeltaTime(411);
  var docBody = getBodyFromIndex(index);
  reportDeltaTime(413);
  // GET VARIABLES
  var textElement = startElement.getElement();
  var text = textElement.getText();
  var paragraph = textElement.getParent();
  var childIndex = paragraph.getChildIndex(textElement); //gets index of found text in paragaph
  size = setSize(size, defaultSize, paragraph, childIndex, start);
  var equationOriginal = getEquation(paragraph, childIndex, start, end, delim);

  if (equationOriginal == "") {
    console.log("No equation but undetected start and end as ", start, " ", end);
    return [defaultSize, startElement];
  }

  var equation = "";
  var renderer = getRenderer(1);
  var resp;
  var worked = 1;
  var failure = 1;
  var rendererType = "";

  var failedCodecogs = 0;
  var failedTexrendr = 0;
  var failedResp;
  // if only failed codecogs, probably weird evening bug from 10/15/19
  // if failed codecogs and texrendr, probably shitty equation and the codecogs error is more descriptive so show it

  // note the last few renderers might be legacy, so ignored
  for (; worked <= capableRenderers; ++worked) {
    //[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
    try {
      renderer = getRenderer(worked);
      rendererType = renderer[5];
      equation = getStyle(equationOriginal, quality, renderer, isInline, worked);
      // console.log(rendererType, "Texrendr", rendererType == "Texrendr")
      if (rendererType == "Texrendr") {
        // console.log("Used texrendr", equation, equation.replace("%5C%5C", "%0D"))
        equation = equation.split("%A0").join("%0D"); //.replace("%5C%5C", "%0D") .replace("%C2%AD", "%0D")
      } else if (rendererType == "Codecogs") {
        // console.log("Used Codecogs", equation, equation.split("%5C%5C%5C%5C").join("%5C%5C"))
        equation = equation.split("%5C%5C%5C%5C").join("%5C%5C"); //.replace("%A0", "%0D") .replace("%C2%AD", "%0D")
      } else if (rendererType == "Sciweavers") {
        // console.log("Used Sciweavers", equation, equation.split("%5C%5C%5C%5C").join("%5C%5C"))
        equation = equation.split("%5C%5C%5C%5C").join("%5C%5C"); //.replace("%A0", "%0D") .replace("%C2%AD", "%0D")
      }

      debugLog("Raw equation", equation);
      renderer[1] = renderer[1].split("FILENAME").join(getFilenameEncode(equation, 0));
      renderer[1] = renderer[1].split("EQUATION").join(equation);
      renderer[2] = renderer[2].split("FILENAME").join(getFilenameEncode(equation, 0)); // since mutating original object, important each is a new one
      debugLog("Link with equation", renderer[1]);
      // console.log("Link with equation", renderer[1]);

      reportDeltaTime(453);
      // if(equation.indexOf("align")>-1 && rendererType != 'Codecogs'){
      // 	continue; // dont even try to render align equatoins with texrendr
      // }
      console.log("Fetching ", renderer[1], " and ", renderer[2] + renderer[6] + equation);

      var _createFileInCache = UrlFetchApp.fetch(renderer[2] + renderer[6] + equation);
      // needed for codecogs to generate equation properly, need to figure out which other renderers need this. to test, use align* equations.

      reportDeltaTime(458, " fetching w eqn len " + equation.length + " with renderer " + rendererType);
      let didTimeOut = true;
      if (rendererType == "Codecogs" || rendererType == "Sciweavers") {
        Utilities.sleep(50); // sleep 50ms to let codecogs put the equation in its cache
      }
      resp = UrlFetchApp.fetch(renderer[1]);
      didTimeOut = false;
      debugLog(resp, resp.getBlob(), escape(resp.getBlob().getDataAsString()).substring(0, 50));
      deltaTime = reportDeltaTime(470, " equation link length " + renderer[1].length + " and renderer  " + rendererType);
      console.log("Hash ", escape(resp.getBlob().getDataAsString()).substring(0, 50));
      if (escape(resp.getBlob().getDataAsString()) == invalidEquationHashCodecogsFirst50_2) {
        // if there is no hash, codecogs failed
        throw new Error("Saw NO Codecogs equation hash! Renderer likely down!");
      } else if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashSciweaversFirst50) {
        // if there is no hash, codecogs failed
        throw new Error("Saw weburl Sciweavers equation hash! Equation likely contains amsmath!");
      } else if (
        escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50 ||
        escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50_3 ||
        escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50_4 ||
        escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50_5
      ) {
        console.log("Invalid Codecogs Equation!");
        failedCodecogs += 1;
        failedResp = resp;
        if (failedCodecogs && failedTexrendr) {
          // if in order so failed codecogs first
          console.log("Displaying codecogs error!");
          resp = failedResp; // let it continue to completion with the failed codecogs equation
        } else {
          throw new Error("Saw invalid Codecogs equation hash!");
        }
      } // have no idea if I can put an else here or not lol
      if (
        escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashTexrendrFirst50 ||
        escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashTexrendrFirst50_2 ||
        escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashTexrendrFirst50_3 ||
        escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashTexrendrFirst50_4
      ) {
        console.log("Invalid Texrendr Equation! Times: " + failedCodecogs + failedTexrendr);
        failedTexrendr += 1;
        if (failedCodecogs && failedTexrendr) {
          // if in order so failed codecogs first
          console.log("Displaying Texrendr error!");
          resp = failedResp; // let it continue to completion with the failed codecogs equation
        } else {
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
    } catch (err) {
      console.log(rendererType + " Error! - " + err);
      deltaTime = reportDeltaTime(533, " failed equation link length " + renderer[1].length + " and renderer  " + rendererType);
      if (rendererType == "Texrendr") {
        // equation.indexOf("align")==-1 &&  removed since align now supported
        console.log("Texrendr likely down, deprioritized!");
        texrendrDown = 1;
      }
    }
    if (failure == 0) break;
  }
  if (worked > capableRenderers) return [-100000, null];
  // SAVING FORMATTING
  reportDeltaTime(511);
  if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50) {
    worked = 1; //assumes codecogs is 1
    renderer = getRenderer(worked);
    rendererType = renderer[5];
  }
  reportDeltaTime(517);
  var textCopy = textElement.asText().copy();
  var endLimit = end;
  if (text.length - 1 < endLimit) endLimit = text.length - 1;
  textCopy.asText().editAsText().deleteText(0, endLimit); // the copy only has the stuff after the equation
  reportDeltaTime(522);
  textElement.editAsText().deleteText(start, text.length - 1); // from the original, yeet the equation and all the remaining text so its possible to insert the equation (try moving after the equation insertion?)
  var logoBlob = resp.getBlob();
  var attemptsToInsertImageLeft = 50;
  reportDeltaTime(526);

  try {
    paragraph.insertInlineImage(childIndex + 1, logoBlob); // TODO ISSUE: sometimes fails because it times out and yeets
    returnParams = repairImage(index, startElement, paragraph, childIndex, size, defaultSize, renderer, delim, textCopy, resp, rendererType, equation, equationOriginal);
    return returnParams;
  } catch (err) {
    console.log("Could not insert image try 1");
    console.error(err);
  }
  reportDeltaTime(536);
  try {
    Utilities.sleep(1000);
    paragraph.insertInlineImage(childIndex + 1, logoBlob); // TODO ISSUE: sometimes fails because it times out and yeets
    returnParams = repairImage(index, startElement, paragraph, childIndex, size, defaultSize, renderer, delim, textCopy, resp, rendererType, equation, equationOriginal);
    return returnParams;
  } catch (err) {
    console.log("Could not insert image try 2 after 1000ms");
    console.error(err);
  }
  throw new Error("Could not insert image at childindex!");
  // return repairImage(index, startElement, paragraph, childIndex, size, defaultSize, renderer, delim, textCopy, resp, rendererType, equation, equationOriginal);
}

function repairImage(index, startElement, paragraph, childIndex, size, defaultSize, renderer, delim, textCopy, resp, rendererType, equation, equationOriginal) {
  var attemptsToSetImageUrl = 3;
  reportDeltaTime(552); // 3 seconds!! inserting an inline image takes time
  while (attemptsToSetImageUrl > 0) {
    try {
      paragraph.getChild(childIndex + 1).setLinkUrl(renderer[2] + equationOriginal + "#" + delim[6]); //added % delim 6 to keep track of which delimiter was used to render
      break;
    } catch (err) {
      console.log("Couldn't insert child index!");
      console.log("Next child not found!");
      --attemptsToSetImageUrl;
    }
  }
  if (attemptsToSetImageUrl < 3) {
    console.log("At ", attemptsToSetImageUrl, " attemptsToSetImageUrls of failing to get child and link , ", equation);
    if (attemptsToSetImageUrl == 0) {
      throw new Error("Couldn't get equation child!"); // of image immediately after inserting
    }
  }

  reportDeltaTime(570);
  if (textCopy.getText() != "") paragraph.insertText(childIndex + 2, textCopy); // reinsert deleted text after the image, with all the formatting
  var height = paragraph.getChild(childIndex + 1).getHeight();
  var width = paragraph.getChild(childIndex + 1).getWidth();
  console.log("Pre-fixing size, width, height: " + size + ", " + width + ", " + height); //only a '1' is rendered as a 100 height (as of 10/20/19, now it is fetched as 90 height). putting an equationrendertime here just doesnt work

  //SET PROPERTIES OF IMAGE (Height, Width)
  var oldSize = size; // why use oldsize instead of new size

  if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == invalidEquationHashCodecogsFirst50 || (size > 10 && width == 126 && height == 24)) {
    size *= 5; // make codecogs errors readable, size constraint just in case some small equation is 126x24 as well
  }
  // console.log(rendererType, rendererType.valueOf(), "Texrendr".valueOf(), rendererType.valueOf() === "Codecogs".valueOf(), rendererType.valueOf() == "Codecogs".valueOf(), rendererType === "Codecogs", rendererType.valueOf() === "Texrendr".valueOf(), rendererType.valueOf() == "Texrendr".valueOf(), rendererType === "Texrendr")
  // note that valueOf here is not needed, and neither is === => removing both keeps trues true and falses false in V8.

  // if(rendererType.valueOf() === "Texrendr".valueOf())  //Old TexRendr
  // 	size = Math.round(size * height / 174);
  let multiple = size / 100.0;
  if (rendererType.valueOf() === "Texrendr".valueOf())
    //TexRendr
    multiple = size / 42.0;
  else if (rendererType.valueOf() === "Roger's renderer".valueOf())
    //Rogers renderer
    multiple = size / 200.0;
  else if (rendererType.valueOf() === "Codecogs".valueOf())
    //CodeCogs, other
    multiple = size / 100.0;
  else if (rendererType.valueOf() === "Sciweavers".valueOf())
    //Scieweavers
    multiple = size / 98.0;
  else if (rendererType.valueOf() === "Sciweavers_old".valueOf())
    //C [75.4, 79.6] on width and height ratio
    multiple = size / 76.0;
  //CodeCogs, other
  else multiple = size / 100.0;

  size = Math.round(height * multiple);
  reportDeltaTime(595);
  sizeImage(paragraph, childIndex + 1, size, Math.round(width * multiple));
  defaultSize = oldSize;
  return [defaultSize, null];
}

/**
 * Given the locations of the delimiters, run code to get font size, get equation, remove equation, encode/style equation, insert/style image.
 *
 * @param {element} paragraph  The paragraph which the child is in.
 * @param {integer} childIndex The childIndex in the paragraph where the text is in, to give the place to edit image.
 * @param {integer} height     The scaled height of the equation based on font size.
 * @param {integer} width      The scaled width of the equation based on font size.
 */

function sizeImage(paragraph, childIndex, height, width) {
  var maxWidth = DocumentApp.getActiveDocument().getPageWidth();
  //console.log("Max Page Width: " + maxWidth);
  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
    console.log("Rescaled in page.");
  }
  if (childIndex == null || width == 0 || height == 0) {
    console.log("none or 0 width hight");
    return;
  }
  paragraph.getChild(childIndex).setHeight(height);
  paragraph.getChild(childIndex).setWidth(width);
  // paragraph.getChild(childIndex).scaleHeight(multiple);
  // paragraph.getChild(childIndex).scaleWidth(multiple);
}

/**
 * Given a size and a cursor right before an equation, call function to undo the image within delimeters. Returns success indicator.
 *
 * @param {string} sizeRaw     Sidebar-selected size.
 */

function removeEquations(sizeRaw, delimiter) {
  var quality = 900;
  var size = getSize(sizeRaw);
  var delim = getDelimiters(delimiter);
  savePrefs(sizeRaw, delimiter);
  var equationsDerenderedCount = 0;
  equationsDerenderedCount += removeAll(delim);
  console.log("Derendered this many equations: " + equationsDerenderedCount);
  return equationsDerenderedCount;
}

/**
 * Given a size and a cursor right before an equation, call function to undo the image within delimeters. Returns success indicator.
 *
 * @param {string} sizeRaw     Sidebar-selected size.
 */

function editEquations(sizeRaw, delimiter) {
  var quality = 900;
  var size = getSize(sizeRaw);
  var delim = getDelimiters(delimiter);
  savePrefs(sizeRaw, delimiter);
  var toReturn = undoImage(delim);
  console.log("Undoimage return flag: " + toReturn);
  return toReturn;
}

/**
 * Given string of size, return integer value.
 *
 * @param {string} sizeRaw     The text value of the size from HTML selection.
 */

function getSize(sizeRaw) {
  var size = 0;
  if (sizeRaw == "smart") {
    size = 0;
  }
  if (sizeRaw == "inline") {
    size = -1;
  }
  if (sizeRaw == "med") {
    size = 24;
  }
  if (sizeRaw == "low") {
    size = 12;
  }
  return size;
}

// NOTE: one indexed. if codecogsSlow is 1, switch order of texrendr and codecogs
function getRenderer(worked) {
  //  order of execution ID, image URL, editing URL, in-line commandAt the beginning, in-line command at and, Human name, the part that gets rendered in browser in the fake call but not in the link(No Machine name substring)
  codeCogsPriority = 1;
  sciWeaverPriority = 4;
  texRenderPriority = 5;
  if (codecogsSlow) {
    sciWeaverPriority = 1;
    codeCogsPriority = 3;
    texRenderPriority = 2;
  } //t , c, s
  // if(texrendrDown){
  // 	temp = sciWeaverPriority
  // 	sciWeaverPriority = texRenderPriority
  // 	texRenderPriority = temp
  // } // s, c, t or c, s, t
  // texRenderPriority = 2
  // codeCogsPriority = 3
  // sciWeaverPriority = 2
  // sciWeaverPriority = 1
  capableRenderers = 8;
  capableDerenderers = 12;
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
  } else if (worked == codeCogsPriority + 1) {
    return [
      codeCogsPriority + 1,
      "https://latex-staging.easygenerator.com/gif.latex?%5Cdpi%7B900%7DEQUATION",
      "https://latex-staging.easygenerator.com/eqneditor/editor.php?latex=",
      "%5Cinline%20",
      "",
      "Codecogs",
      "%5Cdpi%7B900%7D",
    ];
  } else if (worked == codeCogsPriority + 2) {
    return [
      codeCogsPriority + 2,
      "https://latex.codecogs.com/gif.latex?%5Cdpi%7B900%7DEQUATION",
      "https://www.codecogs.com/eqnedit.php?latex=",
      "%5Cinline%20",
      "",
      "Codecogs",
      "%5Cdpi%7B900%7D",
    ];
  } else if (worked == texRenderPriority) {
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
      "",
    ];
  } else if (worked == 7) {
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
      "http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=png&fs=100&ff=anttor&edit=0&eq=EQUATION",
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
      "http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=jpg&fs=78&ff=arev&edit=0&eq=EQUATION",
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
  } // to de render possibly very old equations
  else return [0, "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION", "https://www.codecogs.com/eqnedit.php?latex=", "%5Cinline%20", "", "Codecogs", "%5Cdpi%7B900%7D"];
} //http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=jpg&fs=78&ff=txfonts&edit=0&eq=
/**
 * Given string of size, return integer value.
 *
 * @param {string} delimiters     The text value of the delimiters from HTML selection.
 */

function getDelimiters(delimiters) {
  // Todo - fix hardcoded delimiters. Potentially do escape(escape(original)) or something like that.
  if (delimiters == "$$") {
    return ["$$", "$$", "\\$\\$", "\\$\\$", 2, 1, 0];
  } //raw begin, raw end, escaped begin, escaped end, # of chars, idk, renderer type #
  if (delimiters == "[") {
    return ["\\[", "\\]", "\\\\\\[", "\\\\\\]", 2, 1, 1];
  }
  if (delimiters == "$") {
    return ["$", "$", "[^\\\\]\\$", "[^\\\\]\\$", 1, 0, 2];
  } //(^|[^\\$])\$(?!\$) //(?:^|[^\\\\\\])\\\$ //[^\\\\]\\\$
  return ["\\[", "\\]", "\\\\\\[", "\\\\\\]", 2, 1, 1];
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
  return "$$";
}

function debugLog(...strings) {
  if (DEBUG) {
    console.log(...strings);
  }
}

/**
 * Given a cursor right before an equation, de-encode URL and replace image with raw equation between delimiters.
 *
 * @param {[string, string]} delim     Start/end delimiters to insert.
 */
function removeAll(delimRaw) {
  counter = 0;
  var delim = getDelimiters(delimRaw);
  for (var index = 0; index < DocumentApp.getActiveDocument().getBody().getParent().getNumChildren(); index++) {
    var body = getBodyFromIndex(index);
    var img = body.getImages(); //places all InlineImages from the active document into the array img
    for (i = 0; i < img.length; i++) {
      var image = img[i];
      var origURL = new String(image.getLinkUrl()); //becomes "null", not null, if no equation link
      if (image.getLinkUrl() === null) {
        continue;
      }
      // console.log("Current origURL " + origURL, origURL == "null", origURL === null, typeof origURL, Object.is(origURL, null), null instanceof Object, origURL instanceof Object, origURL instanceof String, !origURL)
      // console.log("Current origURL " + image.getLinkUrl(), image.getLinkUrl() === null, typeof image.getLinkUrl(), Object.is(image.getLinkUrl(), null), !image.getLinkUrl())
      var origEq;
      var worked = 1;
      var failure = 1;
      var found = 0;
      for (; worked <= capableDerenderers; ++worked) {
        // example, [3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
        renderer = getRenderer(worked)[2].split("FILENAME"); //list of possibly more than one string
        for (var I = 0; I < renderer.length; ++I) {
          if (origURL.indexOf(renderer[I]) > -1) {
            debugLog("Changing: " + origURL + " by removing " + renderer[I]);
            origURL = origURL.substring(origURL.indexOf(renderer[I])).split(renderer[I]).join(""); //removes prefix
            found = 1;
          } else break;
        }
      }
      if (found == 0) {
        console.log("Not an equation link! " + origURL, origURL.indexOf(renderer[0]), origURL.indexOf(renderer[1]));
        continue; // not an equation link
      }
      var last2 = origURL.slice(-2);
      var delimtype = 0;
      if (last2.length > 1 && (last2.charAt(0) == "%" || last2.charAt(0) == "#") && last2.charAt(1) >= "0" && last2.charAt(1) <= "9") {
        //rendered with updated renderer
        debugLog("Passed: " + last2);
        delimtype = last2.charAt(1) - "0";
        origURL = origURL.slice(0, -2);
        delim = getDelimiters(getNumDelimiters(delimtype));
      }
      var origEq = deEncode(origURL);
      debugLog("Undid: " + origEq);
      var imageIndex = image.getParent().getChildIndex(image);
      if (origEq.length <= 0) {
        console.log("Empty. at " + imageIndex + " fold " + image.getParent().getText());
        image.removeFromParent();
        continue;
      }
      image.getParent().insertText(imageIndex, delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
      image.removeFromParent();
      counter += 1;
    }
  }
  return counter;
}

/* Returns: -4 if the URL is null (link removed for instance)
						-3 if empty equation derender
						-2 if the element the cursor is in doesnt exist
						-1 if cursor element is not found (?)
						0 if cursor not found entirely
						1 if it was fine
*/
function undoImage(delim) {
  var cursor = DocumentApp.getActiveDocument().getCursor();
  if (cursor) {
    // Attempt to insert text at the cursor position. If the insertion returns null, the cursor's
    // containing element doesn't allow insertions, so show the user an error message.
    var element = cursor.getElement(); //startElement

    if (element) {
      console.log("Valid cursor.");

      var position = cursor.getOffset(); //offset
      //element.getChild(position).removeFromParent();  //SUCCESSFULLY REMOVES IMAGE FROM PARAGRAPH
      // console.log(element.getAllContent(), element.type())
      var image = element.getChild(position).asInlineImage();
      debugLog("Image height", image.getHeight());
      var origURL = image.getLinkUrl();
      if (!origURL) {
        return -4;
      }
      debugLog("Original URL from image", origURL);
      var worked = 1;
      var failure = 1;
      for (; worked <= capableDerenderers; ++worked) {
        //[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
        renderer = getRenderer(worked)[2].split("FILENAME"); //list of possibly more than one string
        for (var I = 0; I < renderer.length; ++I) {
          if (origURL.indexOf(renderer[I]) > -1) {
            debugLog("Changing: " + origURL + " by removing " + renderer[I]);
            origURL = origURL.substring(origURL.indexOf(renderer[I])).split(renderer[I]).join(""); //removes prefix
            debugLog("Next check: " + origURL + " for " + renderer[I + 1]);
          } else break;
        }
      }
      var last2 = origURL.slice(-2);
      var delimtype = 0;
      if (last2.length > 1 && (last2.charAt(0) == "%" || last2.charAt(0) == "#") && last2.charAt(1) >= "0" && last2.charAt(1) <= "9") {
        //rendered with updated renderer
        debugLog("Passed: " + last2);
        delimtype = last2.charAt(1) - "0";
        origURL = origURL.slice(0, -2);
        delim = getDelimiters(getNumDelimiters(delimtype));
      }
      var origEq = deEncode(origURL);
      //       if(origURL.indexOf("codecogs")>-1)//codecogs                         // bad: url hardcoded location
      //          origEq = deEncode(origURL).substring(42);
      //       else if(origURL.indexOf("texrendr")>-1)
      //          origEq = deEncode(origURL).substring(29);
      //       else return -3;
      debugLog("Undid: " + origEq);
      if (origEq.length <= 0) {
        console.log("Empty equation derender.");
        return -3;
      }
      cursor.insertText(delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
      element.getChild(position + 1).removeFromParent();
      return 1;
    } else {
      return -2;
    }
  } else {
    return -1;
  }
  return 0;
}
