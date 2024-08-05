/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)

/* exported onOpen, showSidebar, replaceEquations */

var DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information
// number of tries to insert the equation image
const INSERT_IMAGE_TRIES = 2;
// number of tries to set the link on the image
const SET_IMAGE_LINK_TRIES = 3;
// image scale divisors for each renderer
const IMAGE_SCALE_DIVISORS = {
  "Texrendr": 42.0,
  "Roger's renderer": 200.0,
  "Codecogs": 100.0,
  "Sciweavers": 98.0,
  "Sciweavers_old": 76.0
};

const DocsApp = {
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
	}
};

/**
 * Constantly keep replacing latex till all are finished
 * @public
 */
function replaceEquations(sizeRaw: string, delimiter: string) {
  const quality = 900;
  let size = Common.getSize(sizeRaw);
  let isInline = false;
  if (size < 0) {
    isInline = true;
    size = 0;
  }
  Common.reportDeltaTime(140);
  const delim = Common.getDelimiters(delimiter);
  Common.savePrefs(sizeRaw, delimiter);
  let c = 0; //counter
  let defaultSize = 11;
  let allEmpty = 0;
  Common.reportDeltaTime(146);
  let body: GoogleAppsScript.Document.Document;
  try {
    body = DocumentApp.getActiveDocument();
  } catch (error) {
    console.error(error);
    return Common.encodeFlag(-1, 0);
  }

  let childCount = body.getBody().getParent().getNumChildren();
  Common.reportDeltaTime(156);
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
        return Common.encodeFlag(-2, c); // instead, return pair of number and bool flag in list but whatever

      if (gotSize == 0) break; // finished with renders in this section

      defaultSize = gotSize;
      c = returnedFailedStartElemIfIsEmpty ? c : c + 1; // # of equations += 1 except empty equations
      console.log("Rendered equations: " + c);
    }
  }
  return Common.encodeFlag(0, c);
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

function findPos(index: number, delim: AutoLatexCommon.Delimiter, quality: number, size: number, defaultSize: number, isInline: boolean, prevFailedStartElemIfIsEmpty = null): [number, GoogleAppsScript.Document.RangeElement | null] {
  Common.debugLog("Checking document section index # ", index);
  Common.reportDeltaTime(195);
  const docBody = getBodyFromIndex(index);
  if (docBody == null) {
    return [0, null];
  }
  let startElement = docBody.findText(delim[2]);
  if (prevFailedStartElemIfIsEmpty) {
    startElement = docBody.findText(delim[2], prevFailedStartElemIfIsEmpty);
  }
  if (startElement == null) return [0, null]; //didn't find first delimiter
  const placeHolderStart = startElement.getStartOffset(); //position of image insertion

  const endElement = docBody.findText(delim[3], startElement);
  if (endElement == null) return [0, null]; //didn't find end delimiter (maybe make error different?)
  const placeHolderEnd = endElement.getEndOffsetInclusive(); //text between placeHolderStart and placeHolderEnd will be permanently deleted
  Common.debugLog(delim[2], " single escaped delimiters ", placeHolderEnd - placeHolderStart, " characters long");

  Common.reportDeltaTime(214);
  if (placeHolderEnd - placeHolderStart == 2.0) {
    // empty equation
    console.log("Empty equation! In index " + index + " and offset " + placeHolderStart);
    return [defaultSize, endElement]; // default behavior of placeImage
  }

  return placeImage(startElement, placeHolderStart, placeHolderEnd, quality, size, defaultSize, delim, isInline);
}


function getEquation(paragraph: GoogleAppsScript.Document.Paragraph, childIndex: number, start: number, end: number, delimiters: AutoLatexCommon.Delimiter) {
  const equationOriginal = [];
  Common.reportDeltaTime(284);
  Common.debugLog("See text", paragraph.getChild(childIndex).asText().getText(), paragraph.getChild(childIndex).asText().getText().length);
  const equation = paragraph
    .getChild(childIndex)
    .asText()
    .getText()
    .substring(start + delimiters[4], end - delimiters[4] + 1);
    Common.debugLog("See equation", equation);
    const equationStringEncoded = Common.reEncode(equation); //escape deprecated
  equationOriginal.push(equationStringEncoded);
  Common.reportDeltaTime(290);
  //console.log("Encoded: " + equationStringEncoded);
  return equationStringEncoded;
}

//retrieve size from text
function setSize(size: number, defaultSize: number, paragraph: GoogleAppsScript.Document.Paragraph, childIndex: number, start: number) {
  //GET SIZE
  let newSize = size;
  if (size == 0) {
    try {
      newSize = paragraph
        .getChild(childIndex)
        .asText()
        .editAsText()
        .getFontSize(start + 3); //Fix later: Change from 3 to 1
    } catch (err) {
      newSize = paragraph
        .getChild(childIndex)
        .asText()
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

function placeImage(startElement: GoogleAppsScript.Document.RangeElement, start: number, end: number, quality: number, size: number, defaultSize: number, delim: AutoLatexCommon.Delimiter, isInline: boolean): [number, GoogleAppsScript.Document.RangeElement | null] {
  Common.reportDeltaTime(411);
  Common.reportDeltaTime(413);
  // GET VARIABLES
  const textElement = startElement.getElement().asText();
  const text = textElement.getText();
  const paragraph = textElement.getParent().asParagraph();
  const childIndex = paragraph.getChildIndex(textElement); //gets index of found text in paragaph
  size = setSize(size, defaultSize, paragraph, childIndex, start);
  const equationOriginal = getEquation(paragraph, childIndex, start, end, delim);

  if (equationOriginal == "") {
    console.log("No equation but undetected start and end as ", start, " ", end);
    return [defaultSize, startElement];
  }

  const renderResult = Common.renderEquation(equationOriginal, quality, delim, isInline, 0, 0, 0); 
  if (!renderResult) return [-100000, null];
  const { imageBlob, renderer, editorOriginalEqUrl, isCodecogsError } = renderResult;
  
  // SAVING FORMATTING
  Common.reportDeltaTime(511);
  const textCopy = textElement.asText().copy();
  let endLimit = end;
  if (text.length - 1 < endLimit) endLimit = text.length - 1;
  textCopy.asText().editAsText().deleteText(0, endLimit); // the copy only has the stuff after the equation
  Common.reportDeltaTime(522);
  textElement.editAsText().deleteText(start, text.length - 1); // from the original, yeet the equation and all the remaining text so its possible to insert the equation (try moving after the equation insertion?)
  Common.reportDeltaTime(526);

  for (let i = 0; i < INSERT_IMAGE_TRIES; i++) {
    try {
      paragraph.insertInlineImage(childIndex + 1, imageBlob); // TODO ISSUE: sometimes fails because it times out and yeets
      const returnParams = repairImage(paragraph, childIndex, size, defaultSize, renderer, textCopy, editorOriginalEqUrl, isCodecogsError);
      return returnParams;
    } catch (err) {
      console.log(`Could not insert image try ${i + 1}`);
      console.error(err);

      // wait 1 second before trying again
      Utilities.sleep(1000);
    }
  }

  throw new Error("Could not insert image at childindex!");
}

function repairImage(paragraph: GoogleAppsScript.Document.Paragraph, childIndex: number, size:  number, defaultSize: number, renderer: AutoLatexCommon.Renderer, textCopy: GoogleAppsScript.Document.Text, editorOriginalEqUrl: string, isCodecogsError: boolean): [number, null] {
  Common.reportDeltaTime(552); // 3 seconds!! inserting an inline image takes time

  // try to set the link on the image (with the derendering info)
  for (let i = 0; i < SET_IMAGE_LINK_TRIES; i++) {
    try {
      paragraph.getChild(childIndex + 1).asInlineImage().setLinkUrl(editorOriginalEqUrl); //added % delim 6 to keep track of which delimiter was used to render

      if (i > 0) {
        console.log(`At ${i + 1} attemptsToSetImageUrls of failing to get child and link, ${editorOriginalEqUrl}`);
      }
      break;
    } catch (err) {
      console.log("Couldn't insert child index!");
      console.log("Next child not found!");

      if (i === SET_IMAGE_LINK_TRIES - 1) {
        throw new Error("Couldn't get equation child!"); // of image immediately after inserting
      }
    }
  }

  Common.reportDeltaTime(570);
  if (textCopy.getText() != "") paragraph.insertText(childIndex + 2, textCopy); // reinsert deleted text after the image, with all the formatting
  const height = paragraph.getChild(childIndex + 1).asInlineImage().getHeight();
  const width = paragraph.getChild(childIndex + 1).asInlineImage().getWidth();
  console.log("Pre-fixing size, width, height: " + size + ", " + width + ", " + height); //only a '1' is rendered as a 100 height (as of 10/20/19, now it is fetched as 90 height). putting an equationrendertime here just doesnt work

  //SET PROPERTIES OF IMAGE (Height, Width)
  const oldSize = size; // why use oldsize instead of new size

  if (isCodecogsError || (size > 10 && width == 126 && height == 24)) {
    size *= 5; // make codecogs errors readable, size constraint just in case some small equation is 126x24 as well
  }
  

  // if(rendererType.valueOf() === "Texrendr".valueOf())  //Old TexRendr
  // 	size = Math.round(size * height / 174);

  const multiple = size / (IMAGE_SCALE_DIVISORS[renderer.name] ?? 100.0);

  size = Math.round(height * multiple);
  Common.reportDeltaTime(595);
  Common.sizeImage(DocsApp, paragraph, childIndex + 1, size, Math.round(width * multiple));
  defaultSize = oldSize;
  return [defaultSize, null];
}

function getBodyFromIndex(index: number) {
  const doc = DocsApp.getActive();
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
  
  for (var index = 0; index < DocsApp.getBody().getParent().getNumChildren(); index++) {
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
      const result = Common.derenderEquation(origURL);
      if (!result) continue;
      const { origEq, delim: newDelim } = result;
      const delim = newDelim || defaultDelim;
      const imageIndex = image.getParent().getChildIndex(image);
      if (origEq.length <= 0) {
        console.log("Empty. at " + imageIndex + " fold " + image.getParent().getText());
        image.removeFromParent();
        continue;
      }
      image.getParent().asParagraph().insertText(imageIndex, delim[0] + origEq + delim[1]); //INSERTS DELIMITERS
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

function editEquations(sizeRaw: string, delimiter: string) {
  const defaultDelim = Common.getDelimiters(delimiter);
  Common.savePrefs(sizeRaw, delimiter);
  const cursor = DocumentApp.getActiveDocument().getCursor();
  if (cursor) {
    // Attempt to insert text at the cursor position. If the insertion returns null, the cursor's
    // containing element doesn't allow insertions, so show the user an error message.
    const element = cursor.getElement().asParagraph(); //startElement

    if (element) {
      console.log("Valid cursor.");

      const position = cursor.getOffset(); //offset
      if (position >= element.getNumChildren()) {
        return Common.DerenderResult.CursorNotFound;
      }
      //element.getChild(position).removeFromParent();  //SUCCESSFULLY REMOVES IMAGE FROM PARAGRAPH
      // console.log(element.getAllContent(), element.type())
      const image = element.getChild(position).asInlineImage();
      Common.debugLog("Image height", image.getHeight());
      const origURL = image.getLinkUrl();
      if (!origURL) {
        return Common.DerenderResult.NullUrl;
      }
      Common.debugLog("Original URL from image", origURL);
      const result = Common.derenderEquation(origURL);
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
    } else {
      return Common.DerenderResult.NonExistentElement;
    }
  } else {
    return Common.DerenderResult.CursorNotFound;
  }
}
