/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations - (For api keys, ask aayush)

/* exported onOpen, showSidebar, replaceEquations */

/* global Common, SlidesApp */

type PageElement = GoogleAppsScript.Slides.Shape | GoogleAppsScript.Slides.TableCell;

interface DerenderData {
  red: number,
  green: number,
  blue: number,
  origURL: string,
  size: number,
  width: number,
  height: number
}

const IntegratedApp = {
  getUi: function () {
    return SlidesApp.getUi();
  },
  getBody: function () {
    return SlidesApp.getActivePresentation().getSlides();
  },
  getActive: function () {
    return SlidesApp.getActivePresentation();
  },
  getPageWidth: function () {
    return SlidesApp.getActivePresentation().getPageWidth();
  },
  // Shift-enter in slides produces \x0B, or \v
  newlineCharacter: "%0B"
} satisfies AutoLatexCommon.IntegratedApp;


/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param _e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(_e: object) {
  IntegratedApp.getUi().createAddonMenu().addItem("Start", "showSidebar").addToUi();
}

/**
 * Runs when the add-on is installed.
 *
 * @param e The event parameter for a simple onInstall trigger. To
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
 * Find the position of a delimeter from a starting point.
 */

function findTextOffsetInSlide(str: string, search: string, offset = 0) {
  Common.debugLog("str: " + str.substring(offset) + " search: " + search);
  return str.substring(offset).indexOf(search) + offset;
}

function isTable(element: GoogleAppsScript.Slides.Table | GoogleAppsScript.Slides.Shape | GoogleAppsScript.Slides.Group): element is GoogleAppsScript.Slides.Table {
  return element.getPageElementType() === SlidesApp.PageElementType.TABLE;
}

function isTableCell(element: PageElement): element is GoogleAppsScript.Slides.TableCell {
  return "getParentTable" in element;
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
  const defaultSize = 11;
  Common.reportDeltaTime(146);
  try {
    IntegratedApp.getActive();
  } catch (error) {
    console.error(error);
    return Common.encodeFlag(-1, 0);
  }
  const slides = IntegratedApp.getBody();
  const childCount = slides.length;
  for (let slideNum = 0; slideNum < childCount; slideNum++) {
    for (let elementNum = 0; elementNum < slides[slideNum].getPageElements().length; elementNum++) {
      Common.debugLog("Slide Num: " + slideNum + " Num of shapes: " + slides[slideNum].getPageElements().length);
      let element = getElementFromIndices(slideNum, elementNum);
      if (element === null) continue;
      
      c += renderElement(slideNum, element, delim, quality, size, defaultSize, isInline);
    }
  }
  return Common.encodeFlag(0, c);
}

/**
 * Returns the element iterating
 */
function getElementFromIndices(slideNum: number, elementNum: number) {
  const doc = IntegratedApp.getBody();
  Common.assert(slideNum < doc.length, "slideNum < doc.length");
  const body = doc[slideNum];
  const elements = body.getPageElements();
  // elements = body.getPageElements();
  Common.assert(elementNum < elements.length, "elementNum (" + elementNum + ") < elements.length (" + elements.length + ")");
  let element: GoogleAppsScript.Slides.PageElement;
  if (elementNum < elements.length) {
    element = elements[elementNum];
  } else {
    return null;
  }

  return castElement(element);
}

function castElement(element: GoogleAppsScript.Slides.PageElement) {
  let elementType: GoogleAppsScript.Slides.PageElementType;
  try {
    // type = element.getPageElementType();
    elementType = element.getPageElementType();
    Common.debugLog("Element Type is:" + elementType + " object ID is:" + element.getObjectId());
  } catch {
    Common.debugLog("Not of type shape");
    return null;
  }
  
  if (elementType === SlidesApp.PageElementType.SHAPE) {
    // handles alternating footers etc.
    return element.asShape();
  } else if (elementType === SlidesApp.PageElementType.TABLE) {
    return element.asTable();
  } else if (elementType === SlidesApp.PageElementType.GROUP) {
    return element.asGroup();
  }
  return null;
}

/**
 * This reverses the findpos return logic from docs to make it more accurate
 * @param element Element to search for equations
 * @returns Count of equations successfully rendered
 */
function renderElement(slideNum: number, element: GoogleAppsScript.Slides.Group | GoogleAppsScript.Slides.Table | GoogleAppsScript.Slides.Shape, delim: AutoLatexCommon.Delimiter, quality: number, size: number, defaultSize: number, isInline: boolean) {
  if ("ungroup" in element) {
    // recursively process all elements in this group
    let c = 0;
    for (const childElement of element.getChildren()) {
      // returns null if we don't recognize the type
      const castedPageElement = castElement(childElement);
      if (castedPageElement) {
        c += renderElement(slideNum, castedPageElement, delim, quality, size, defaultSize, isInline);
      }
    }
    return c;
  } else if (isTable(element)) {
    // table
    let c = 0;
    for (let i = 0; i < element.getNumRows(); i++) {
      for (let j = 0; j < element.getNumColumns(); j++) {
        const cell = element.getCell(i, j);
        // ignore merged cells (the head cells of merged cells will still be counted)
        if (cell.getMergeState() === SlidesApp.CellMergeState.MERGED) continue;
        
        let parsedEquations = findPos(slideNum, cell, delim, quality, size, defaultSize, isInline); //or: "\\\$\\\$", "\\\$\\\$"
        c += parsedEquations.filter(([, imagesPlaced]) => imagesPlaced).length;
      }
    }
    return c;
  } else {
    // single shape
    let parsedEquations = findPos(slideNum, element, delim, quality, size, defaultSize, isInline); //or: "\\\$\\\$", "\\\$\\\$"
    return parsedEquations.filter(([, imagesPlaced]) => imagesPlaced).length;
  }
}

// slideNum and slideObjectNum are integers
/**
 * get the R, G, B values of a textrange text
 */
function getRgbColor(textRange: GoogleAppsScript.Slides.TextRange, slideNum: number): [number, number, number] {
  const doc = IntegratedApp.getBody();
  const slide = doc[slideNum];
  let foregroundColor = textRange.getTextStyle().getForegroundColor();
  if (foregroundColor == null) {
    return [0, 0, 0];
  }
  const foregroundColorType = foregroundColor.getColorType();
  if (foregroundColorType === SlidesApp.ColorType.RGB) {
    Common.debugLog("textColor :" + typeof foregroundColor);
  } else {
    foregroundColor = slide.getColorScheme().getConcreteColor(foregroundColor.asThemeColor().getThemeColorType());
    console.log("equation color: " + foregroundColor.asRgbColor().asHexString());
  }

  const red = foregroundColor.asRgbColor().getRed();
  const green = foregroundColor.asRgbColor().getGreen();
  const blue = foregroundColor.asRgbColor().getBlue();
  Common.debugLog("RGB: " + red + ", " + green + ", " + blue);
  return [red, green, blue];
}

function unwrapEQ(element: PageElement) {
  let textValue: GoogleAppsScript.Slides.TextRange | null = null;
  // test if it's a text box (table cells work)
  try {
    textValue = element.getText(); // TextRange
    Common.debugLog("TextBox Text: " + textValue);
  } catch {
    Common.debugLog("not a text box");
  }

  return textValue; // returns TextRange or null
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

function findPos(slideNum: number, element: PageElement, delim: AutoLatexCommon.Delimiter, quality: number, size: number, defaultSize: number, isInline: boolean) {
  // get the shape (elementNum) on the given slide (slideNum)
  // var element = getElementFromIndices(slideNum, elementNum);
  // debugLog("shape is: " + shape.getPageElementType())
  let imagesPlaced = [];
  if (!element)
    imagesPlaced.push([0, 0]);
  else {
    for (let i = 0; i < 100; i++) { // Parse a maximum of 100 equations per TextRange
      // Get the text of the shape.
      // var elementText = shape.getText(); // TextRange
      const elementText = unwrapEQ(element); // TextRange
      if(elementText == null) {
        imagesPlaced.push([0, 0]);
        continue;
      }
      // debugLog("Looking for delimiter :" + delim[2] + " in text");
      const checkForDelimiter = elementText.find(delim[2]); // TextRange[]

      if (checkForDelimiter == null) {
        imagesPlaced.push([0, 0]); // didn't find first delimiter
        break;
      }

      // start position of image
      const placeHolderStart = findTextOffsetInSlide(elementText.asRenderedString(), delim[0], 0);

      if (placeHolderStart === -1) {
        imagesPlaced.push([0, 0]); // didn't find first delimiter
        break;
      }

      const offset = 2 + placeHolderStart;

      // end position till of image
      const placeHolderEnd = findTextOffsetInSlide(elementText.asRenderedString(), delim[1], offset);

      Common.debugLog("Start and End of equation: " + placeHolderStart + " " + placeHolderEnd);
      // debugLog("Isolating Equation Textrange: " + element.getText().getRange(placeHolderStart, placeHolderEnd).asRenderedString());

      const textColor = getRgbColor(element.getText().getRange(placeHolderStart + 1, placeHolderEnd), slideNum);

      Common.debugLog(`RGB: ${textColor.join()}`);

      if (placeHolderEnd - placeHolderStart == 2.0) {
        // empty equation
        Common.debugLog("Empty equation!");
        elementText.clear(placeHolderStart, Math.min(elementText.getLength(), placeHolderEnd + 2));
        imagesPlaced.push([defaultSize, 0]); // default behavior of placeImage
        continue;
      }

      imagesPlaced.push(placeImage(slideNum, element, elementText, placeHolderStart, placeHolderEnd, quality, size, defaultSize, delim, isInline, textColor));
    }
  }
  return imagesPlaced;
}

function getEquation(paragraph: GoogleAppsScript.Slides.TextRange, start: number, end: number, delimiters: AutoLatexCommon.Delimiter) {
  var equationOriginal = [];
  var equation = paragraph.asRenderedString().substring(start + delimiters[4], end - delimiters[4] + 2);
  var checkForEquation = paragraph.asRenderedString();
  Common.debugLog("getEquation- " + equation.length);
  Common.debugLog("checkForEquation- " + checkForEquation.length);

  var equationStringEncoded = Common.reEncode(equation, IntegratedApp); //escape deprecated
  equationOriginal.push(equationStringEncoded);
  return equationStringEncoded;
}

/**
 * Get the coordinates of the top-left corner of this element, as well as the width and the height
 */
function getBounds(textElement: PageElement) {
  if (isTableCell(textElement)) {
    const targetRow = textElement.getRowIndex();
    const targetCol = textElement.getColumnIndex();
    const row = textElement.getParentRow();
    const col = textElement.getParentColumn();
    const table = textElement.getParentTable();
    
    let x = table.getLeft();
    let y = table.getTop();
    
    // iterate through cells before to find position
    for (let rowIdx = 0; rowIdx < targetRow; rowIdx++) {
      y += table.getRow(rowIdx).getMinimumHeight();
    }
    for (let colIdx = 0; colIdx < targetCol; colIdx++) {
      x += table.getColumn(colIdx).getWidth();
    }
    
    return {
      x,
      y,
      width: col.getWidth(),
      height: row.getMinimumHeight()
    };
  } else {
    // simple - just call the respective methods
    return {
      x: textElement.getLeft(),
      y: textElement.getTop(),
      width: textElement.getWidth(),
      height: textElement.getHeight()
    };
  }
}

function resize(eqnImage: GoogleAppsScript.Slides.Image, textElement: PageElement, size: number, scale: number, horizontalAlignment: GoogleAppsScript.Slides.ParagraphAlignment, verticalAlignment: GoogleAppsScript.Slides.ContentAlignment, bounds: ReturnType<typeof getBounds>) {
  eqnImage.setWidth(((size * eqnImage.getWidth()) / eqnImage.getHeight()) * scale);
  eqnImage.setHeight(size * scale);
  
  // try to match the horizontal alignment of the text
  if (horizontalAlignment === SlidesApp.ParagraphAlignment.END)
    eqnImage.setLeft(bounds.x + bounds.width - eqnImage.getWidth()); // subtracting the image width emulates "setRight"
  else if (horizontalAlignment === SlidesApp.ParagraphAlignment.CENTER)
    eqnImage.setLeft(bounds.x + bounds.width / 2 - eqnImage.getWidth() / 2);
  else
    eqnImage.setLeft(bounds.x);

  // match the vertical alignment
  if (verticalAlignment === SlidesApp.ContentAlignment.TOP)
    eqnImage.setTop(bounds.y);
  else if (verticalAlignment === SlidesApp.ContentAlignment.BOTTOM)
    eqnImage.setTop(bounds.y + bounds.height - eqnImage.getHeight()); // emulating "setBottom"
  else
    eqnImage.setTop(bounds.y + bounds.height / 2 - eqnImage.getHeight() / 2);
}

/**
 * Given the locations of the delimiters, run code to get font size, get equation, remove equation, encode/style equation, insert/style image.
 *
 * @param {integer} start        The offset in the childIndex where the equation start-delimiter starts.
 * @param {integer} end          The offset in the childIndex where the equation end-delimiter starts.
 * @param {integer} quality      The dpi quality to be rendered in (default 900).
 * @param {integer} size         The size of the text, whose neg/pos indicated whether the equation is inline or not.
 * @param {integer} defaultSize  The default/previous size of the text, in case size is null.
 * @param {string}  delim[6]     The text delimiters and regex delimiters for start and end in that order, and offset from front and back.
 */

function placeImage(slideNum: number, textElement: PageElement, text: GoogleAppsScript.Slides.TextRange, start: number, end: number, quality: number, size: number, defaultSize: number, delim: AutoLatexCommon.Delimiter, isInline: boolean, [red, green, blue]: number[]) {
  Common.debugLog("placeImage- EquationOriginal: " + textElement + ", type: " + typeof textElement);
  
  const equationRange = text.getRange(start + 1, end);

  let textSize = equationRange
    .getTextStyle()
    .getFontSize();
  
  // Gets the horizontal alignment of the equation. If it somehow spans multiple paragraphs, this will return the alignment of the first one
  const textHorizontalAlignment = text
    .getRange(start + 1, end)
    .getParagraphs()[0]
    .getRange()
    .getParagraphStyle()
    .getParagraphAlignment();
      
  const textVerticalAlignment = textElement.getContentAlignment();
  // var textSize = text.getTextStyle().getFontSize();
  Common.debugLog("My Text Size is: " + textSize.toString());
  if (textSize == null) {
    textSize = defaultSize;
  }

  const equationOriginal = getEquation(text, start, end, delim);
  Common.debugLog("placeImage- EquationOriginal: " + equationOriginal);

  if (equationOriginal == "") {
    console.log("No equation but undetected start and end as ", start, " ", end);
    return [defaultSize, 1];
  }

  const { renderer, rendererType, worked } = Common.renderEquation(equationOriginal, quality, delim, isInline, red, green, blue); 
  if (worked > Common.capableRenderers) return -100000;
  var doc = IntegratedApp.getBody();
  var body = doc[slideNum];

  // console.log("title alt text: " + renderer[2] + equationOriginal + "#" + delim[6])
  
  // This is a relatively expensive call for tables, so we store it in a variable
  const bounds = getBounds(textElement);

  const origURL = renderer[2] + equationOriginal + "#" + delim[6];
  const derenderData: DerenderData = {
    red,
    green,
    blue,
    origURL,
    size: textSize,
    width: bounds.width,
    height: bounds.height
  };

  if (isTableCell(textElement)) {
    // if table
    text.clear(start, Math.min(text.getLength(), end + 2));
  } else {
    // else if text box
    textElement.getText().clear(start, end + 2);
  }

  // textElement.setLeft(textElement.getLeft() + image.getWidth() * 1.1);

  // CodeCogs, other: (2 / 100.0) * (125 / 3)
  let scale = (1 / 100.0);
  if (rendererType.valueOf() === "Texrendr".valueOf())
    //TexRendr
    scale = (1 / 42.0);
  else if (rendererType.valueOf() === "Roger's renderer".valueOf())
    //Rogers renderer
    scale = (1 / 200.0);
  else if (rendererType.valueOf() === "Sciweavers".valueOf())
    //Scieweavers
    scale = (1 / 98.0);
  else if (rendererType.valueOf() === "Sciweavers_old".valueOf())
    //C [75.4, 79.6] on width and height ratio
    scale = (1 / 76.0) ;

  scale *= (125 * 2 / 3);

  var image = body.insertImage(renderer[1]);

  resize(image, textElement, textSize, scale, textHorizontalAlignment, textVerticalAlignment, bounds);
  
  // remove empty textboxes
  if (
    !isTableCell(textElement) &&
    textElement.getShapeType() === SlidesApp.ShapeType.TEXT_BOX &&
    textElement.getText().asRenderedString().length == 1
  ) {
    textElement.remove();
  }
  image.setTitle(JSON.stringify(derenderData));
  return [size, 1];
}

/**
 * De-encode all equations
 * @public
 */
function removeAll(defaultDelimRaw: string) {
  let counter = 0;
  const defaultDelim = Common.getDelimiters(defaultDelimRaw);
  for (const slide of IntegratedApp.getBody()) {
    for (const image of slide.getImages()) {
      if (derenderImage(image, defaultDelim, slide) === Common.DerenderResult.Success) counter++;
    }
  }
  return counter;
}

function derenderImage(image: GoogleAppsScript.Slides.Image, defaultDelim: AutoLatexCommon.Delimiter, slide: GoogleAppsScript.Slides.Page | GoogleAppsScript.Slides.Slide) {
  const positionX = image.getLeft(); // returns horizontal position in points measured from upper-left of the page
  // debugLog("Left: " + positionX)
  const positionY = image.getTop(); // returns vertical position
  
  let derenderData: DerenderData | [number, number, number, string, number] = JSON.parse(image.getTitle());
  
  if (Array.isArray(derenderData)) { 
    // backwards-compatibility - we use an object now
    const [red, green, blue, origURL, size] = derenderData;
    derenderData = {
      red,
      green,
      blue,
      origURL,
      // size may be undefined for older versions
      size,
      width: image.getWidth(),
      height: image.getHeight()
    };
  }
  // deconstruct
  const { red, green, blue, origURL, size, width, height } = derenderData;
  
  // these _should_ be numbers already, but I'm leaving this here in case it's needed for backwards compatibility
  const colors = [red, green, blue].map((x: string | number) => Number(x)) as [number, number, number];

  image.remove();

  Common.debugLog("image description is: " + origURL);

  if (!origURL) return Common.DerenderResult.NullUrl;

  Common.debugLog("Original URL from image", origURL);
  const result = Common.derenderEquation(origURL, IntegratedApp);
  if (!result) return Common.DerenderResult.InvalidUrl;
  const { delim: newDelim, origEq } = result;
  const delim = newDelim || defaultDelim;

  if (origEq.length <= 0) {
    console.log("Empty equation derender.");
    return Common.DerenderResult.EmptyEquation;
  }

  // insert textbox
  const shape = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, positionX, positionY, width, height);
  const textRange = shape.getText();

  const textStyle = textRange
    .insertText(0, delim[0] + origEq + delim[1])
    .getTextStyle()
    .setForegroundColor(...colors);

  if (size) {
    textStyle.setFontSize(size);
  }
  
  Common.debugLog("textRange: " + textRange + "type: " + typeof textRange);
  
  return Common.DerenderResult.Success;
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
  // var cursor = IntegratedApp.getActive().getCursor(); // * no cursor for slides => replace with highlighted textbox
  //* 1. check if selected element is image
  //* 2. get position of element
  //* 3. render selected element by using element.getChild.asInlineImage(); then
  const selection = SlidesApp.getActivePresentation().getSelection();
  Common.debugLog("The Slides App is:" + selection);
  const currentPage = selection.getCurrentPage();
  // debugLog("current slide number is: " + pageNum + "pageNum is: " + pageNum)
  const selectionType = selection.getSelectionType();
  Common.debugLog("selection Type is: " + selectionType);

  if (selectionType == SlidesApp.SelectionType.PAGE_ELEMENT) {
    // if they're selecting an image inside a group, the image is the second element in the selection
    const image = selection.getPageElementRange().getPageElements().find(el => el.getPageElementType() === SlidesApp.PageElementType.IMAGE)?.asImage();
    if (image) {
      return derenderImage(image, defaultDelim, currentPage);
    } else {
      return Common.DerenderResult.NonExistentElement;
    }
  } else {
    return Common.DerenderResult.CursorNotFound;
  }
}
