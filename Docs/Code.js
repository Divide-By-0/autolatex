/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)

/* exported onOpen, showSidebar, replaceEquations */

const SIDEBAR_TITLE = "Auto-LaTeX Equations";
var DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information

const IntegratedApp = {
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
		let activeWidth = DocumentApp.getActiveDocument().getPageWidth();
		return activeWidth;
	}
};


/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(e) {
  AutoLatexCommon.onOpen(IntegratedApp);
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
  AutoLatexCommon.showSidebar(IntegratedApp);
}
/**
 * Constantly keep replacing latex till all are finished
 */
function replaceEquations(sizeRaw, delimiter) {
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
  let body;
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

  let { resp, renderer, rendererType, worked } = AutoLatexCommon.renderEquation(equationOriginal, quality, delim, isInline, 0, 0, 0); 
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
 * Given a size and a cursor right before an equation, call function to undo the image within delimeters. Returns success indicator.
 *
 * @param {string} sizeRaw     Sidebar-selected size.
 */

function editEquations(sizeRaw, delimiter) {
  return AutoLatexCommon.editEquations(sizeRaw, delimiter);
}

/**
 * Given a cursor right before an equation, de-encode URL and replace image with raw equation between delimiters.
 *
 * @param {[string, string]} delim     Start/end delimiters to insert.
 */
function removeAll(delimRaw) {
  return AutoLatexCommon.removeAll(IntegratedApp, delimRaw);
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
      const { delim: newDelim, origEq } = AutoLatexCommon.derenderEquation(origURL);
      if (newDelim) delim = newDelim;
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
}
