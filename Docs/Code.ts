/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)

/* exported onOpen, showSidebar, replaceEquations */

var DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information

/**
 * @public
 */
const enum DocsEquationRenderStatus {
  // error types
  NoDocument,
  NoStartDelimiter,
  NoEndDelimiter,
  EmptyEquation,
  AllRenderersFailed,
  
  // equation should be rendered on the client side (MathJax)
  ClientRender,
  
  Success
}

interface DocsEquationRenderResult {
  status: DocsEquationRenderStatus,
  equationSize?: number,
  nextStartElement?: GoogleAppsScript.Document.RangeElement,
  clientRenderOptions?: AutoLatexCommon.ClientRenderOptions
}

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


/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} _e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(_e: object) {
  DocsApp.getUi().createAddonMenu().addItem("Start", "showSidebar").addToUi();
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
 * Constantly keep replacing latex till all are finished
 * @public
 */
function replaceEquations(sizeRaw: string, delimiter: string, clientRender: boolean) {
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
  let allEmpty = 0;
  Common.reportDeltaTime(146);
  let body: GoogleAppsScript.Document.Document;
  try {
    body = DocumentApp.getActiveDocument();
  } catch (error) {
    console.error(error);
    
    return {
      lastStatus: DocsEquationRenderStatus.NoDocument,
      successCount: 0
    };
  }
  
  const baseRenderOptions: AutoLatexCommon.RenderOptions = {
    size,
    defaultSize: 11,
    inline: isInline,
    delim,
    
    clientRender,
    
    // TODO: color support for Docs
    r: 0,
    g: 0,
    b: 0
  };
  
  const clientEquations: AutoLatexCommon.ClientRenderOptions[] = [];

  const childCount = body.getBody().getParent().getNumChildren();
  Common.reportDeltaTime(156);
  for (let index = 0; index < childCount; index++) {
    let failedStartElemIfIsEmpty = null;
    while (true) {
      // prevFailedStartElemIfIsEmpty is here so when $$$$ fails again and again, it doesn't get stuck there and moves on.
      const {
        status,
        equationSize,
        nextStartElement,
        clientRenderOptions
      } = findPos(index, baseRenderOptions, failedStartElemIfIsEmpty); //or: "\\\$\\\$", "\\\$\\\$"
      
      if (nextStartElement) failedStartElemIfIsEmpty = nextStartElement;
      // if we found an actual equation, update the default size
      if (equationSize) baseRenderOptions.defaultSize = equationSize;
        
      // count consecutive empty equations
      if (status == DocsEquationRenderStatus.EmptyEquation) {
        allEmpty++;
      } else {
        allEmpty = 0;
      }
      
      if (allEmpty > 10) break; //Assume we quit on 10 consecutive empty equations.
      
      // quit if all renderers failed or if document failed to load (conflicting authorizations)
      if (status == DocsEquationRenderStatus.AllRenderersFailed || status == DocsEquationRenderStatus.NoDocument) {
        return {
          lastStatus: status,
          successCount: c
        };
      }
      
      if (status === DocsEquationRenderStatus.ClientRender) {
        clientEquations.push(clientRenderOptions);
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
  
  if (clientRender) {
    return {
      lastStatus: DocsEquationRenderStatus.ClientRender,
      clientEquations,
      successCount: 0
    };
  }
  
  return {
    lastStatus: DocsEquationRenderStatus.Success,
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

function findPos(index: number, renderOptions: AutoLatexCommon.RenderOptions, prevFailedStartElemIfIsEmpty = null): DocsEquationRenderResult {
  Common.debugLog("Checking document section index # ", index);
  Common.reportDeltaTime(195);
  const docBody = getBodyFromIndex(index);
  if (docBody == null) {
    return {
      status: DocsEquationRenderStatus.NoDocument
    };
  }
  let startElement = docBody.findText(renderOptions.delim[2]);
  if (prevFailedStartElemIfIsEmpty) {
    startElement = docBody.findText(renderOptions.delim[2], prevFailedStartElemIfIsEmpty);
  }
  if (startElement == null) {
    return {
      status: DocsEquationRenderStatus.NoStartDelimiter
    };
  }
  const placeHolderStart = startElement.getStartOffset(); //position of image insertion

  const endElement = docBody.findText(renderOptions.delim[3], startElement);
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

  return placeImage(startElement, renderOptions);
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
  const equationStringEncoded = Common.reEncode(equation); //escape deprecated

  Common.reportDeltaTime(290);
  //console.log("Encoded: " + equationStringEncoded);
  return equationStringEncoded;
}

//retrieve size from text
function getSize(size: number, defaultSize: number, rangeElement: GoogleAppsScript.Document.RangeElement) {
  //GET SIZE
  let newSize = size;
  if (size == 0) {
    try {
      newSize = rangeElement
        .getElement()
        .asText()
        .editAsText()
        .getFontSize(rangeElement.getStartOffset() + 3); //Fix later: Change from 3 to 1
    } catch (err) {
      newSize = rangeElement
        .getElement()
        .asText()
        .editAsText()
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

function placeImage(startElement: GoogleAppsScript.Document.RangeElement,  renderOptions: AutoLatexCommon.RenderOptions): DocsEquationRenderResult {
  Common.reportDeltaTime(411);
  Common.reportDeltaTime(413);
  // GET VARIABLES
  const textElement = startElement.getElement().asText();
  const text = textElement.getText();
  const paragraph = textElement.getParent().asParagraph();
  const childIndex = paragraph.getChildIndex(textElement); //gets index of found text in paragaph
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
  
  // send info to the client for rendering
  if (renderOptions.clientRender) {
    const doc = DocumentApp.getActiveDocument();
    const range = doc.newRange()
      .addElement(textElement, startElement.getStartOffset(), startElement.getEndOffsetInclusive())
      .build();
    // save this range for later
    const namedRange = doc.addNamedRange("ale-equation-range", range);
    const clientRenderOptions: AutoLatexCommon.ClientRenderOptions = {
      ...renderOptions,
      size,
      rangeId: namedRange.getId(),
      equation: equationOriginal
    };
    // make sure we can retrieve this element later
    return {
      status: DocsEquationRenderStatus.ClientRender,
      equationSize: size,
      clientRenderOptions
    };
  }

  let { resp, renderer, worked } = Common.renderEquation(equationOriginal, renderOptions); 
  if (worked > Common.capableRenderers) return {
    status: DocsEquationRenderStatus.AllRenderersFailed
  };
  // SAVING FORMATTING
  Common.reportDeltaTime(511);
  if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50) {
    //assumes codecogs is 1
    renderer = Common.getRenderer(1);
  }
  Common.reportDeltaTime(517);
  const textCopy = textElement.asText().copy();
  let endLimit = startElement.getEndOffsetInclusive();
  if (text.length - 1 < endLimit) endLimit = text.length - 1;
  textCopy.asText().editAsText().deleteText(0, endLimit); // the copy only has the stuff after the equation
  Common.reportDeltaTime(522);
  textElement.editAsText().deleteText(startElement.getStartOffset(), text.length - 1); // from the original, yeet the equation and all the remaining text so its possible to insert the equation (try moving after the equation insertion?)
  const logoBlob = resp.getBlob();
  Common.reportDeltaTime(526);
  
  // try inserting twice
  for (let tryNum = 1; tryNum <= 2; tryNum++) {
    try {
      paragraph.insertInlineImage(childIndex + 1, logoBlob); // TODO ISSUE: sometimes fails because it times out and yeets
      return repairImage(paragraph, childIndex, size, renderer, renderOptions.delim, textCopy, resp, equationOriginal);
    } catch (err) {
      console.log(`Could not insert image try ${tryNum}`);
      console.error(err);
      
      Utilities.sleep(1000);
    }
  }

  throw new Error("Could not insert image at childindex!");
}

function repairImage(paragraph: GoogleAppsScript.Document.Paragraph, childIndex: number, size:  number, renderer: AutoLatexCommon.Renderer, delim: AutoLatexCommon.Delimiter, textCopy: GoogleAppsScript.Document.Text, resp: GoogleAppsScript.URL_Fetch.HTTPResponse, equationOriginal: string): DocsEquationRenderResult {
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

  if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50 || (size > 10 && width == 126 && height == 24)) {
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
  //CodeCogs, other
  else multiple = size / 100.0;

  size = Math.round(height * multiple);
  Common.reportDeltaTime(595);
  Common.sizeImage(DocsApp, paragraph, childIndex + 1, size, Math.round(width * multiple));
  
  return {
    status: DocsEquationRenderStatus.Success,
    equationSize: oldSize
  };
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
