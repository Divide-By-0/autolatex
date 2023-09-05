/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)

/* exported onOpen, showSidebar, replaceEquations */

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
		let activeWidth = DocumentApp.getActiveDocument().getBody().getPageWidth();
		return activeWidth;
	},
  undoImage
};


/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} _e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(_e: object) {
  IntegratedApp.getUi().createAddonMenu().addItem("Start", "showSidebar").addToUi();
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
  const ui = HtmlService.createTemplateFromFile("Sidebar").evaluate().setTitle("Auto-LaTeX Equations").setSandboxMode(HtmlService.SandboxMode.IFRAME); // choose mode IFRAME which is fastest option
  IntegratedApp.getUi().showSidebar(ui);
}

function onWorkspaceAddonHomepageOpen() {
  return generateWorkspaceHomepage("Idle");
}

function generateWorkspaceHomepage(status: string, error: string | null = null) {
  const homeCard = CardService.newCardBuilder().setName("home");
  const instructionsSection = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText("Replace all valid mathematical equations with high-quality LaTeX rendered images.<br>Remember to wrap all latex in $$ ... $$."))
    .addWidget(CardService.newTextParagraph().setText("For example, $$3^{4^5} + \\frac{1}{2}$$ would be a valid equation. Try using this sample to render your first equation!"));

  const prefs = getPrefs();

  const sizes = [
    ["Automatic", "smart"],
    ["Inline", "inline"],
    ["Font Size 24", "med"],
    ["Font Size 12", "low"]
  ];

  const delims = [
    ["$$ ... $$", "$$"],
    ["\[ ... \]", "\["]
  ];

  const sizeSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("Select Size:")
    .setFieldName("size");

  const delimSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("Select Delimiter Style:")
    .setFieldName("delimit")

  for (const size of sizes) sizeSelect.addItem(size[0], size[1], size[1] === (prefs.size || "smart"));
  for (const delim of delims) delimSelect.addItem(delim[0], delim[1], delim[1] === (prefs.delim || "$$"));

  const settingsSection = CardService.newCardSection()
    .setHeader("Settings")
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(1)
    .addWidget(sizeSelect)
    .addWidget(delimSelect);

  const renderButton = CardService.newTextButton()
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setText("Render Equations")
    .setOnClickAction(CardService.newAction().setFunctionName("onWorkspaceAddonClick").setParameters({ action: "render" }));

  const derenderButton = CardService.newTextButton()
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
    .setText("Derender Eq")
    .setOnClickAction(CardService.newAction().setFunctionName("onWorkspaceAddonClick").setParameters({ action: "derender" }));

  const derenderAllButton = CardService.newTextButton()
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setText("⠀⠀DE-RENDER ALL EQUATIONS⠀⠀")
    .setBackgroundColor("#cd3d2d")
    .setOnClickAction(CardService.newAction().setFunctionName("onWorkspaceAddonClick").setParameters({ action: "derenderAll" }));

  const statusText = `<b>Status: ${status}</b>`;

  const actionsSection = CardService.newCardSection()
    .addWidget(CardService.newButtonSet()
      .addButton(renderButton)
      .addButton(derenderButton)
      .addButton(derenderAllButton)
    )
    .addWidget(CardService.newTextParagraph().setText(error ? `${statusText}<br><font color="#dd4b39">${error}</font>` : statusText));

  const infoSection = CardService.newCardSection()
    .addWidget(CardService.newDecoratedText()
      .setTopLabel("Tips:")
      .setWrapText(true)
      .setText(`• Place your cursor right before the equation and click "De-render Equation" to convert back to code.
• Use shift+enter instead of enter for newlines in multi-line equations. Shift+enter auto-converts to \\\\.
• 'Automatic' size matches the typed font size.
• 'Inline' size compresses your equation height.`)
    )
    .addWidget(CardService.newImage()
      .setImageUrl("https://i.ibb.co/41B2V1C/unnamed.png")
      .setOpenLink(CardService.newOpenLink().setUrl("https://www.patreon.com/autolatex?source=docs"))
    )
    .addWidget(CardService.newDecoratedText()
      .setTopLabel("More:")
      .setWrapText(true)
      .setText(`• <b>We have <a href="https://www.redbubble.com/shop/ap/140480196">merch now</a>! Buy shirts, pillows, mugs, and more for your math-loving friends and students.</b>
• Check out Auto-LaTeX in your Slides presentations!
• Check out the latest <a href="https://sites.google.com/site/autolatexequations/">2022 Update Notes</a>.
• Find a full list of commands at <a href="https://www.codecogs.com/eqnedit.php">CodeCogs</a>.
• Problems? Check the <a href="https://www.autolatex.com/faq">FAQ</a>, <a href="mailto:autolatex@gmail.com">autolatex@gmail.com</a>, or check updates on <a href="https://www.facebook.com/autolatex/">facebook</a>.
• I'd love a <a href="https://workspace.google.com/marketplace/app/autolatex_equations/850293439076?hl=en&pann=docs_addon_widget&ref=sidebar_review">5 star review here</a>!
• Please <a href="https://www.patreon.com/autolatex?source=docs">donate</a> on Patreon to help keep this updated!
• I recently built <a href="https://lipoker.io/?ref=ale">lipoker.io</a>, the first free videochat poker site for friends, without signups or downloads. Think of it as the Auto-LaTeX of poker -- no scams, and beautifully functional. Try it for your next social or game night!`)
    )

  homeCard.addSection(instructionsSection);
  homeCard.addSection(settingsSection);
  homeCard.addSection(actionsSection);
  homeCard.addSection(infoSection);
  return homeCard.build();
}

function onWorkspaceAddonClick(e: GoogleAppsScript.Addons.EventObject) {
  const selectedSize = e.commonEventObject.formInputs.size.stringInputs.value[0];
  const selectedDelimit = e.commonEventObject.formInputs.delimit.stringInputs.value[0];
  let statusText: string;
  let error: string | null = null;
  switch(e.commonEventObject.parameters.action) {
    case "render": {
      const result = replaceEquations(selectedSize, selectedDelimit);
      let errorType = 0;
      let renderCount = result;
      if (result < -1) {
        errorType = -2;
        renderCount = -2 - result;
      } else if (result == -1) {
        errorType = -1;
        renderCount = 0;
      }
      statusText = renderCount === 0 ? "No equations rendered" : renderCount === 1 ? "1 equation rendered" : `${renderCount} equations rendered`;
      if (errorType === -1)
        error = "Sorry, the script has conflicting authorizations. Try signing out of other active Gsuite accounts.";
      else if (errorType === -2 && renderCount > 0)
        error = "Sorry, an equation is incorrect, or (temporarily) unavailable commands (i.e. align, &) were used.";
      else if (errorType === -2 && renderCount == 0)
        error = "Sorry, likely (temporarily) unavailable commands (i.e. align, &) were used or the equation was too long.";
      
      break; 
    } case "derender": {
      const result = editEquations(selectedSize, selectedDelimit);
      switch (result) {
        case Common.DerenderResult.InvalidUrl:
          statusText = "Error, please ensure link is still on equation.";
          error = "Cannot retrieve equation. The equation may not have been rendered by Auto-LaTeX.";
          break;
        case Common.DerenderResult.NullUrl:
          statusText = "Error, please ensure link is still on equation.";
          error = "Cannot retrieve equation. Is your cursor before an Auto-LaTeX rendered equation?";
          break;
        case Common.DerenderResult.EmptyEquation:
          statusText = "Error, please move cursor before inline equation.";
          error = "Cannot retrieve equation. Is your cursor before an Auto-LaTeX rendered equation?";
          break;
        case Common.DerenderResult.NonExistentElement:
          statusText = "Error, please move cursor before equation.";
          error = "Cannot insert text here. Is your cursor before an equation?";
          break;
        case Common.DerenderResult.CursorNotFound:
          statusText = "Error, please move cursor before equation.";
          error = "Cannot find a cursor/equation. Please click before an equation."
          break;
        case Common.DerenderResult.Success:
        default:
          statusText = "1 equation de-rendered.";
          break;
      }
      break;
    } case "derenderAll": {
      const derenderCount = removeAll(selectedDelimit);
      statusText = derenderCount === 0 ? "No equations found to de-render" : derenderCount === 1 ? "1 equation de-rendered" : `${derenderCount} equations de-rendered`;
      break;
    }
  }
  
  return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(generateWorkspaceHomepage(statusText, error))).build();
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

  let { resp, renderer, rendererType, worked, equation } = Common.renderEquation(equationOriginal, quality, delim, isInline, 0, 0, 0); 
  if (worked > Common.capableRenderers) return [-100000, null];
  // SAVING FORMATTING
  Common.reportDeltaTime(511);
  if (escape(resp.getBlob().getDataAsString()).substring(0, 50) == Common.invalidEquationHashCodecogsFirst50) {
    worked = 1; //assumes codecogs is 1
    renderer = Common.getRenderer(worked);
    rendererType = renderer[5];
  }
  Common.reportDeltaTime(517);
  const textCopy = textElement.asText().copy();
  let endLimit = end;
  if (text.length - 1 < endLimit) endLimit = text.length - 1;
  textCopy.asText().editAsText().deleteText(0, endLimit); // the copy only has the stuff after the equation
  Common.reportDeltaTime(522);
  textElement.editAsText().deleteText(start, text.length - 1); // from the original, yeet the equation and all the remaining text so its possible to insert the equation (try moving after the equation insertion?)
  const logoBlob = resp.getBlob();
  Common.reportDeltaTime(526);

  try {
    paragraph.insertInlineImage(childIndex + 1, logoBlob); // TODO ISSUE: sometimes fails because it times out and yeets
    const returnParams = repairImage(paragraph, childIndex, size, defaultSize, renderer, delim, textCopy, resp, rendererType, equation, equationOriginal);
    return returnParams;
  } catch (err) {
    console.log("Could not insert image try 1");
    console.error(err);
  }
  Common.reportDeltaTime(536);
  try {
    Utilities.sleep(1000);
    paragraph.insertInlineImage(childIndex + 1, logoBlob); // TODO ISSUE: sometimes fails because it times out and yeets
    const returnParams = repairImage(paragraph, childIndex, size, defaultSize, renderer, delim, textCopy, resp, rendererType, equation, equationOriginal);
    return returnParams;
  } catch (err) {
    console.log("Could not insert image try 2 after 1000ms");
    console.error(err);
  }
  throw new Error("Could not insert image at childindex!");
}

function repairImage(paragraph: GoogleAppsScript.Document.Paragraph, childIndex: number, size:  number, defaultSize: number, renderer: AutoLatexCommon.Renderer, delim: AutoLatexCommon.Delimiter, textCopy: GoogleAppsScript.Document.Text, resp: GoogleAppsScript.URL_Fetch.HTTPResponse, rendererType: string, equation: string, equationOriginal: string): [number, null] {
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
    console.log("At ", attemptsToSetImageUrl, " attemptsToSetImageUrls of failing to get child and link , ", equation);
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
  Common.reportDeltaTime(595);
  Common.sizeImage(IntegratedApp, paragraph, childIndex + 1, size, Math.round(width * multiple));
  defaultSize = oldSize;
  return [defaultSize, null];
}

/**
 * Given a size and a cursor right before an equation, call function to undo the image within delimeters. Returns success indicator.
 *
 * @param {string} sizeRaw     Sidebar-selected size.
 * @public
 */

function editEquations(sizeRaw: string, delimiter: string) {
  return Common.editEquations(IntegratedApp, sizeRaw, delimiter);
}

function getBodyFromIndex(index: number) {
  const doc = IntegratedApp.getActive();
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
  
  for (var index = 0; index < IntegratedApp.getBody().getParent().getNumChildren(); index++) {
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

// See DerenderResult in Common for more info on return values
function undoImage(defaultDelim: AutoLatexCommon.Delimiter) {
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
