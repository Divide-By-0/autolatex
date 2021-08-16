//850293439076-9mad9mt23tgjm7q4hc1orrd4uq51t9h5.apps.googleusercontent.com  
//Auto-Latex Equations - ***REMOVED***

var SIDEBAR_TITLE = 'Auto-LaTeX Equations';
var DEBUG = true; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information
var EMPTY_EQUATIONS = 0;

IntegratedApp = {
  getUi: function(type){
    return SlidesApp.getUi();
  },
  getBody: function(){
    return SlidesApp.getActivePresentation().getSlides();
  },
  getActive: function(){
    return SlidesApp.getActivePresentation();
  },
  getPageWidth: function() {
    return SlidesApp.getActivePresentation().getPageWidth();
  }
};

var TIMING_DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information 
var previousTime = 0;
var previousLine = 0;
var equationRenderingTime = 0;
var codecogsSlow = 0;
var texrendrDown = 0;
var capableRenderers = 8;
var capableDerenderers = 12;
//render bug variables
var invalidEquationHashCodecogsFirst50   = "GIF89a%7F%00%18%00%uFFFD%00%00%uFFFD%u0315%uFFFD3%"; // invalid codecogs equation
var invalidEquationHashCodecogsFirst50_2 = "";
var invalidEquationHashCodecogsFirst50_3 = "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00%01%"; // this is one space in codecogs. not pushed yet.
var invalidEquationHashCodecogsFirst50_4 = "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0";
var invalidEquationHashCodecogsFirst50_5 = "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00z%00";
var invalidEquationHashTexrendrFirst50   = "GIF89a%uFFFD%008%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%";
var invalidEquationHashTexrendrFirst50_2 = "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0";
var invalidEquationHashTexrendrFirst50_3 = "GIF89ai%0A%uFFFD%01%uFFFD%00%00%uFFFD%uFFFD%uFFFD%"; // this is the No Expression Supplied error. Ignored for now.
var invalidEquationHashTexrendrFirst50_4 = "%7FELF%01%01%01%00%00%00%00%00%00%00%00%00%02%00%0";
var invalidEquationHashSciweaversFirst50 = "%0D%0A%09%3C%21DOCTYPE%20html%20PUBLIC%20%22-//W3C";

var failedCodecogs = 0;
var failedTexrendr = 0;
var failedResp;

/** //8.03 - De-Render, Inline, Advanced Delimiters > Fixed Inline Not Appearing
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
 function onOpen(e) {
  SlidesApp.getUi().createAddonMenu()
  .addItem('Start', 'showSidebar')
  .addToUi();
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
  var ui = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle('Auto-LaTeX Equations')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);    // choose mode IFRAME which is fastest option
    IntegratedApp.getUi().showSidebar(ui);
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
    quality: userProperties.getProperty('delimiters'),
    size: userProperties.getProperty('size')
  };
  debugLog("delimiter prefs:" + prefs.delimiters);
  debugLog("size prefs:" + prefs.size);
  return prefs;
}

function encodeFlag(flag, renderCount){
  // return {flag: flag, renderCount: renderCount}
  // let {flag, renderCount} = input
  ans = 0
  if(flag == -2){
      ans = -2 - renderCount
  }
  if(flag == -1){
      ans = -1
  }
  if(flag == 0){
      ans = renderCount
  }
  return ans
}
function findTextOffsetInSlide(str, search, offset = 0){
  debugLog("str: " + str.substring(offset) + " search: " + search);
  return str.substring(offset).indexOf(search) + offset;
}

/**
 * Constantly keep replacing latex till all are finished
 */
 function replaceEquations(sizeRaw, delimiter){
  // var obj = {flag: -2, renderCount: 0};
  // return obj;
  var quality = 900;
  var size = getSize(sizeRaw);
  var isInline = false;
  if(size < 0){
    isInline = true;
    size = 0;
  } 
  var delim = getDelimiters(delimiter);
  savePrefs(sizeRaw, delimiter);
  var c = 0;  //counter
  EMPTY_EQUATIONS = 0;
  var defaultSize = 11;
  var allEmpty = 0;
  try{
    let body = IntegratedApp.getActive();
  } catch (error) {
    console.error(error);
    return encodeFlag(-1, 0)
  }
  let slides = IntegratedApp.getBody()
  // console.log(typeof IntegratedApp.getBody())
  let childCount = slides.length;
  // console.log("Children: ", childCount)
  for (var x = 0; x < 5; x++){ //please remove this, this is a terrible fix
    for (var slideNum = 0; slideNum < childCount; slideNum++){
      for (var shapeNum = 0; shapeNum < slides[slideNum].getShapes().length; shapeNum++){
        // while(true){
          // const [gotSize, isEmpty] = findPos(slideNum, shapeNum, delim, quality, size, defaultSize, isInline);   //or: "\\\$\\\$", "\\\$\\\$"
          
          // allEmpty = isEmpty ? allEmpty + isEmpty : 0
    
          // if(allEmpty > 50) break; //Assume we quit on 50 consecutive empty equations.
    
          // if(gotSize == -100000)   // means all renderers fucked.
          //   return encodeFlag(-2, c);                                   // instead, return pair of number and bool flag
    
          // if(gotSize == 0) break; // finished with renders in this section
    
          // defaultSize = gotSize;
          // c = c + 1 - isEmpty;                    // # of equations += 1 except empty equations

        findPos(slideNum, shapeNum, delim, quality, size, defaultSize, isInline);   //or: "\\\$\\\$", "\\\$\\\$"
        c = c + 1;
        // }
      }
    }
  }
  
  return encodeFlag(0, c-EMPTY_EQUATIONS)
}

// slideNum and slideObjectNum are integers
function getRgbColor(shape, slideNum){
  var doc = IntegratedApp.getBody();
  var slide = doc[slideNum];
  // debugLog("type of slide object: " + typeof slide)
  var foregroundColor = shape.getText().getTextStyle().getForegroundColor();
  if(foregroundColor == null){
    return [0,0,0];
  }
  var foregroundColorType = foregroundColor.getColorType();
  if(foregroundColorType == "RGB"){
    debugLog("textColor :" + typeof foregroundColor)
  }
  else{
    var foregroundColor = slide.getColorScheme().getConcreteColor(foregroundColor.asThemeColor().getThemeColorType());
    console.log("equation color: " + foregroundColor.asRgbColor().asHexString());
  }

  var red = foregroundColor.asRgbColor().getRed();
  var green = foregroundColor.asRgbColor().getGreen();
  var blue = foregroundColor.asRgbColor().getBlue();
  debugLog("RGB: " + red + ", " + green + ", " + blue)
  return[red, green, blue];

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

function findPos(slideNum, shapeNum, delim, quality, size, defaultSize, isInline){
  
  // get the shape (shapeNum) on the given slide (slideNum)
  var shape = getShapeFromIndices(slideNum, shapeNum);
  // debugLog("shape is: " + shape)
  if(shape == null){
    return [0, 0];
  }

  // Get the text of the shape.
  var shapeText = shape.getText(); // TextRange

  var textColor = getRgbColor(shape, slideNum);
  var red = textColor[0];
  debugLog("red: " + red)
  var green = textColor[1];
  debugLog("green: " + green)
  var blue = textColor[2];
  debugLog("blue: " + blue)

  // debugLog("Looking for delimiter :" + delim[2] + " in text");
  var checkForDelimiter = shapeText.find(delim[2]);  // TextRange[]

  if(checkForDelimiter == null) 
    return [0, 0];  // didn't find first delimiter

  // start position of image
  var placeHolderStart = findTextOffsetInSlide(shapeText.asRenderedString(), delim[1], 0); 
  
  var temp = 2;
  if(placeHolderStart != -1){
    temp += placeHolderStart;
  }
  // end position till of image 
  var placeHolderEnd = findTextOffsetInSlide(shapeText.asRenderedString(), delim[1], temp); 

  debugLog("Start and End of equation: " + placeHolderStart + " " + placeHolderEnd);

  // debugLog("Image will be inserted between " + placeHolderStart + " " + placeHolderEnd);
  // debugLog("Text to be replaced is " + (placeHolderEnd - placeHolderStart) + " characters long");

  if(placeHolderEnd - placeHolderStart == 2.0) { // empty equation
    console.log("Empty equation!");
    EMPTY_EQUATIONS ++;
    return [defaultSize, 1]; // default behavior of placeImage
  }

  return placeImage(slideNum, shapeNum, shapeText, placeHolderStart, placeHolderEnd, quality, size, defaultSize, delim, isInline, red, green, blue);
}

function assert(value, command="unspecified"){
  if(value == false){
    console.error("Assert failed! When doing ", command)
  }
}

/////////////////////////////////////////////////////////

// function selectText(slideNum, shapeNum, delim, quality, size, defaultSize, isInline){
//   // find shape
//   // debugLog("Checking document slideNum, shapeNum # " + slideNum + " " + shapeNum)
//   var shape = getShapeFromIndices(slideNum, shapeNum);
//   if(shape == null){
//     return [0, 0];
//   }
//   var shapeText = shape.getText();
//   // debugLog("Text of the shape is:" + shapeText.asRenderedString());
//   // debugLog("delim[2] is:" + delim);

//   // get index of checkForDelimiter and endElement using highlight or mouse cursor select 
//   document.getElementById('ip').addEventListener('mouseup',function(e){
//         var selection = window.getSelection();

//         var placeHolderStart = selection.anchorOffset; // get start index
//         var placeHolderEnd = selection.focusOffset; // get end index
//         if (placeHolderStart >= 0 && placeHolderEnd >= 0){
//           console.log("start: " + placeHolderStart);
//           console.log("end: " + placeHolderEnd);
//           debugLog((placeHolderEnd - placeHolderStart) + " characters long"); //output string length
//         }
//   });

//   // error messages
//   if(placeHolderEnd - placeHolderStart == 2.0) { // empty equation
//     console.log("Empty equation!");
//     return [defaultSize, 1]; // default behavior of placeImage
//   }
//   // place image
//   return placeImage(slideNum, shapeNum, checkForDelimiter, placeHolderStart, placeHolderEnd, quality, size, defaultSize, delim, isInline);


// }


///////////////////////////////////////////////

//encode function that gets Missed. Google Docs characters stuff 
function getCustomEncode(equation, direction, time){
  // there are two sublists because they happen at different times (on encode or decoded string). In addition, the second set is one way due to typing errors/unsupported characters.
  var toFind    = [["#", "+", "%0D"], ["\‘", "\’", "”", "“", "−", "≥", "≤", "‐", "—"]];
  var toReplace = [["+%23", "+%2B", "%A0"], ["'", "'", "\"", "\"", "-", "\\geq", "\\leq", "-", "-"]];//&hash;&plus; todo ≥ with \geq
  assert(toFind[time].length == toReplace[time].length, "toFind[time].length == toReplace[time].length");
  for(var i = 0; i < toFind[time].length; ++i){
    if (direction == 0) equation = equation.split(toFind[time][i]).join(toReplace[time][i]);
    else if (direction == 1 && time == 0) { // the single, double quotes, and hyphens should stay minus signs.
      equation = equation.split(toReplace[time][i]).join(toFind[time][i]);
    }
  }
  return equation;
}
//
//The one indexed 3rd rendering service needs this for file names
function getFilenameEncode(equation, direction){
  var toFind    = ["+", "'" , "%", "(", ")","&", ";", ".", "~", "*", "{", "}"];
  var toReplace = ["†","‰27", "‰", "‹", "›","§", "‡", "•", "˜", "ª", "«", "»"];
  for(var i = 0; i < Math.min(toFind.length, toReplace.length); ++i){
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
 function reEncode(equation){
  equation = getCustomEncode((equation), 0, 1);
  var equationStringEncoded =  getCustomEncode(encodeURIComponent(equation), 0, 0 ); //escape deprecated
  return equationStringEncoded;
} 

function deEncode(equation){
  // debugLog(equation);
  // debugLog(getCustomEncode (getFilenameEncode (equation, 1), 1, 0));
  // debugLog(decodeURIComponent(getCustomEncode (getFilenameEncode (equation, 1), 1, 0)));

  var equationStringDecoded = decodeURIComponent(getCustomEncode (getFilenameEncode (equation, 1), 1, 0)); //escape deprecated
  //  console.log("Decoded without replacing: " + equationStringDecoded);
  equationStringDecoded = getCustomEncode(equationStringDecoded, 1, 1);
  // debugLog("Decoded with replacing: " + equationStringDecoded);
  return equationStringDecoded;
} 

function getEquation(origShape, paragraph, childIndex, start, end, delimiters){
  var equationOriginal = [];
  // debugLog("See text" + paragraph.getChild(childIndex).getText() + paragraph.getChild(childIndex).getText().length)
  var equation = paragraph.asRenderedString().substring(start+delimiters[4], end-delimiters[4]+2);
  var checkForEquation = paragraph.asRenderedString();
  debugLog("getEquation- " + (equation).length);
  debugLog("checkForEquation- " + checkForEquation.length);
  // debugLog("Equation has no extra text: " + (("$$" + equation + "$$") == checkForEquation).toString());


  // if((checkForEquation).length-(equation).length > 5){
  //   var copy = origShape;
  //   copy.setText(copy.asRenderedString().replace(equation, ''));
  //   origShape.getParentPage().asSlide().insertShape(copy);
  // }
  // if(("$$" + equation + "$$") != checkForEquation){
  //   return "";
  // }
  var equationStringEncoded = reEncode(equation); //escape deprecated
  equationOriginal.push(equationStringEncoded);
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
 
function getStyle(equationStringEncoded, quality, renderer, isInline, type, red, green, blue){//ERROR?
  var equation = [];
  equationStringEncoded = equationStringEncoded;
  // if(isInline) equationStringEncoded = "%7B%5Ccolor%5BRGB%5D%7B" + red + "%2C" + green + "%2C" + blue + "%7D%7D" + renderer [3] + equationStringEncoded + renderer [4];
  // equationStringEncoded = "%7B%5Ccolor%5BRGB%5D%7B" + red + "%2C" + green + "%2C" + blue + "%7D%7D" + renderer [3] + equationStringEncoded + renderer [4];

  equationStringEncoded = "%7B%5Ccolor%5BRGB%5D%7B" + red + "%2C" + green + "%2C" + blue + "0%7D" + renderer [3] + equationStringEncoded + renderer [4] + "%7D";
  debugLog("textColor: " + red + ", " + green + ", " + blue)
  debugLog("equationStringEncoded: " + equationStringEncoded);
  if(type == 2){
    equationStringEncoded = equationStringEncoded.split("&plus;").join("%2B"); //HACKHACKHACKHACK REPLACE
    equationStringEncoded = equationStringEncoded.split("&hash;").join("%23"); //HACKHACKHACKHACK REPLACE
  }
  //console.log('Equation Final: ' + equationStringEncoded);
  equation.push(equationStringEncoded);
  return equationStringEncoded;
}

function savePrefs(size, delim){
  var userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('size', size);
  userProperties.setProperty('delim', delim);
  // userProperties.setProperty('defaultSize', size);
}

function getPrefs() {
  var userProperties = PropertiesService.getUserProperties();
  var savedPrefs = {
    size: userProperties.getProperty('size'),
    delim: userProperties.getProperty('delim')
  };
  debugLog("Got prefs size:" + savedPrefs.size);
  return savedPrefs;
}

function getKey(){
  console.log("Got Key: " + Session.getTemporaryActiveUserKey() + " and email " + Session.getEffectiveUser().getEmail());
  return Session.getTemporaryActiveUserKey();
}

//retrieve size from text
function setSize(size, defaultSize, paragraph, childIndex, start){
  //GET SIZE
  var newSize = paragraph.getTextStyle().getFontSize();
  // debugLog("Size is: " + newSize.toString());
  if(newSize == null){
    return defaultSize;
  } else {
    return newSize;
  }
}

function resize(eqnImage, textElement, size, scale){
  eqnImage.setLeft(textElement.getLeft());
  eqnImage.setTop(textElement.getTop());
  eqnImage.setWidth(Math.round(size*eqnImage.getWidth()/eqnImage.getHeight() * scale));
  eqnImage.setHeight(size * scale);

  // image = body.insertImage(renderer[1], textElement.getLeft(), textElement.getTop(), Math.round(size*textElement.getWidth()/textElement.getHeight() * scale), size * scale);
}

// deprecated, use the indexing method to get all odd/even footers etc. as well
function getBodyFromLocation(location){
  var docBody; 
  if(location == "header"){
    docBody = IntegratedApp.getActive().getHeader();
  }
  if(location == "body"){
    docBody = IntegratedApp.getActive().getBody();
  }
  if(location == "footer"){
    docBody = IntegratedApp.getActive().getFooter();
    // debugLog("Got footer ", docBody.getText(), docBody.getType() === DocumentApp.ElementType.FOOTER_SECTION, docBody.getType() === DocumentApp.ElementType.HEADER_SECTION)
    // debugLog(docBody.getParent().getChild(0).getType() === DocumentApp.ElementType.BODY_SECTION, docBody.getParent().getChild(0).getType() === DocumentApp.ElementType.HEADER_SECTION )
  }
  return docBody;
}

function getShapeFromIndices(slideNum, shapeNum){
  var doc = IntegratedApp.getBody();
  var all = doc.length;
  assert(slideNum < all, "slideNum < all")
  body = doc[slideNum];
  shapes = body.getShapes();
  assert(shapeNum < shapes.length, "shapeNum (" + shapeNum + ") < shapes.length (" + shapes.length + ")");
  var shape;
  if(shapeNum < shapes.length){
    shape = shapes[shapeNum];
  } else {
    return null;
  }
  type = shape.getShapeType();
  if(type === SlidesApp.ShapeType.TEXT_BOX) { // handles alternating footers etc.
    return shape;
  }
  return null;
}

//function blobIsCCFailure(blob){
//  return escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashCodecogsFirst50
//}
/**
 * Given the locations of the delimiters, run code to get font size, get equation, remove equation, encode/style equation, insert/style image.
 *
 * @param {element} checkForDelimiter The paragraph which the child is in.
 * @param {integer} start        The offset in the childIndex where the equation start-delimiter starts.
 * @param {integer} end          The offset in the childIndex where the equation end-delimiter starts.
 * @param {integer} quality      The dpi quality to be rendered in (default 900).
 * @param {integer} size         The size of the text, whose neg/pos indicated whether the equation is inline or not.
 * @param {integer} defaultSize  The default/previous size of the text, in case size is null.
 * @param {string}  delim[6]     The text delimiters and regex delimiters for start and end in that order, and offset from front and back.
 */

var linkEquation = [];

 function placeImage(slideNum, shapeNum, shapeText, start, end, quality, size, defaultSize, delim, isInline, red, green, blue) {
  // get the textElement (shapeNum) on the given slide (slideNum)
  var textElement = getShapeFromIndices(slideNum, shapeNum);
  debugLog("placeImage- EquationOriginal: " + textElement + ", type: " + (typeof textElement));

  var text = textElement.getText(); // text range

  // var textColor = getRgbColor(textElement, slideNum);
  // console.log("equation color: " + textColor);
  
  // var paragraph = textElement.getParent();
  // var childIndex  = paragraph.getChildIndex(textElement);  //gets index of found text in paragaph
  size = setSize(size, defaultSize, text, 0, start);
  
  var equationOriginal = getEquation(textElement, text, 0, start, end, delim);
  debugLog("placeImage- EquationOriginal: " + equationOriginal);

  if(equationOriginal == ""){
    console.log("No equation but undetected start and end as ", start, " ", end);
    return [defaultSize, 1];
  }

  var equation= "";
  var renderer=getRenderer(1);
  var resp;
  var worked = 1;
  var failure = 1;
  var rendererType ="";
  
  //codecogs bug variables
  var invalidEquationHashCodecogsFirst50 = "GIF89a%7F%00%18%00%uFFFD%00%00%uFFFD%u0315%uFFFD3%";
  var invalidEquationHashTexrendrFirst50 = "GIF89a%uFFFD%008%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%";
  var failedCodecogsAndTexrendr = 0;
  var failedResp;
  // if only failed codecogs, probably weird evening bug from 10/15/19
  // if failed codecogs and texrendr, probably shitty equation and the codecogs error is more descriptive so show it
  
  for (; worked <6; ++worked){//[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
    try {
      renderer = getRenderer(worked);
      equation = getStyle(equationOriginal, quality, renderer, isInline, worked, red, green, blue);
      debugLog("Raw equation" + equation);
      rendererType = renderer[5];
      renderer[1] =renderer[1].split("FILENAME").join(getFilenameEncode (equation, 0));
      renderer[1] =renderer[1].split("EQUATION").join(equation);
      renderer[2] =renderer[2].split("FILENAME").join(getFilenameEncode (equation, 0));
      debugLog("Link with equation " + renderer[1]);
      // add original equation link to the linkEquation array to be called later in de-render step
      linkEquation.push(renderer[2] + equationOriginal + "#" + delim[6]);
      debugLog("new equation added to LinkEquation array " + renderer[2] + equationOriginal + "#" + delim[6])

      var _createFileInCache = UrlFetchApp.fetch(renderer[2] + renderer[6] + equation); 
			// needed for codecogs to generate equation properly, need to figure out which other renderers need this. to test, use align* equations.
 			
			if(rendererType == "Codecogs" || rendererType == "Sciweavers"){
				Utilities.sleep(50); // sleep 50ms to let codecogs put the equation in its cache
			}

      var startDate = new Date();
      var startTime = Number(startDate.getTime()).toFixed(0);
      
      // var createFile = UrlFetchApp.fetch(renderer[2] + equation); // lol wtf why was this ever here -- goes to main url
      
      var medDate = new Date();
      var medTime = Number(medDate.getTime()).toFixed(0);
      
      resp = UrlFetchApp.fetch(renderer[1]);
      // console.log("Fetched ", renderer[1], " and ", renderer[2] + equation)

      var endDate = new Date();
      var endTime = Number(endDate.getTime()).toFixed(0);
      debugLog("Timing for retrieval: " + (medTime - startTime).toString() + (endTime - medTime).toString())

      if(escape(resp.getBlob().getDataAsString()) == invalidEquationHashCodecogsFirst50_2){ // if there is no hash, codecogs failed
        throw new Error('Saw NO Codecogs equation hash! Renderer likely down!');
      }
      else if(escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashSciweaversFirst50){ // if there is no hash, codecogs failed
        throw new Error('Saw weburl Sciweavers equation hash! Equation likely contains amsmath!');
      }
     else if(escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashCodecogsFirst50 || escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashCodecogsFirst50_3 || escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashCodecogsFirst50_4 || escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashCodecogsFirst50_5){
       console.log("Invalid Codecogs Equation! Times: " + failedCodecogs + failedTexrendr)
       failedCodecogs += 1;
       failedResp = resp;
       if(failedCodecogs && failedTexrendr){ // if in order so failed codecogs first
         console.log("Displaying codecogs error!")
         resp = failedResp // let it continue to completion with the failed codecogs equation
       }
       else{
         throw new Error('Saw invalid Codecogs equation hash!');
       }
     } // have no idea if I can put an else here or not lol
     if(escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashTexrendrFirst50 || escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashTexrendrFirst50_2 || escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashTexrendrFirst50_3 || escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashTexrendrFirst50_4){
       console.log("Invalid Texrendr Equation! Times: " + failedCodecogs + failedTexrendr)
       failedTexrendr += 1
       if(failedCodecogs && failedTexrendr){ // if in order so failed codecogs first
         console.log("Displaying Texrendr error!")
         resp = failedResp // let it continue to completion with the failed codecogs equation
       }
       else{ // should only execute if texrendr is 1
         throw new Error('Saw invalid Texrendr equation hash!');
       }
     }
     failure = 0;
     console.log("Worked with renderer ", worked, " and type ", rendererType);
     break;
   } catch(err) {
     console.log(rendererType + " Error! - " + err);
      if(rendererType == 'Texrendr'){ // equation.indexOf("align")==-1 &&  removed since align now supported
       console.log("Texrendr likely down, deprioritized!")
       texrendrDown = 1
      }
   }
   if (failure == 0) break;
 }
  if (worked > 5) return -100000;
  var doc = IntegratedApp.getBody();
  body = doc[slideNum];
  var scale = 3.0;
  // image = body.insertImage(renderer[1], textElement.getLeft(), textElement.getTop(), Math.round(size*textElement.getWidth()/textElement.getHeight() * scale), size * scale);
  // try{
    image = body.insertImage(renderer[1]);
  // }
  
  resize(image, textElement, size, 1.5);
  console.log("eqn type: " + typeof image);
  console.log("title alt text: " + renderer[2] + equationOriginal + "#" + delim[6])
  
  var obj = [red, green, blue, renderer[2] + equationOriginal + "#" + delim[6]];
  var json = JSON.stringify(obj);  

  // console.log("recieving alt text: " + image.setTitle("%5Ccolor%5BRGB%5D%7B" + red + "%2C" + green + "%2C" + blue + "0%7D" + renderer[2] + equationOriginal + "#" + delim[6]).getTitle());
  image.setTitle(json);
  // debugLog("eqn description: " + .getTitle());

  // debugLog("equation description: " + image.getDescription());

  debugLog("equation description: " + image.getDescription());
  // var textColor = textElement.getText().getTextStyle().getForegroundColor().asRgbColor() ;
  // console.log("equation color: " + textColor.asHexString());

  // textElement.remove();
  textElement.getText().clear(start, end+2);
  textElement.setLeft(textElement.getLeft() + image.getWidth() * 1.1);
  if(textElement.getText().asRenderedString().length == 1){
    textElement.remove();
  }

  // SAVING FORMATTING 
  // if(escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashCodecogsFirst50){
  //   worked = 1 //assumes codecogs is 1
  //   renderer = getRenderer(worked);
  //   rendererType = renderer[5];
  // }
  // // var textCopy = text.editAsText().copy();
  // var endLimit = end;
  // if(text.length-1 < endLimit) endLimit = text.length-1;
  // // textCopy.asText().editAsText().deleteText(0, endLimit);
  // text.clear(start, text.length -1)
  // var logoBlob = resp.getBlob();
  // var rep = 100;
  // while(rep > 0){
  //   try{
  //     paragraph.insertInlineImage(childIndex+1, logoBlob);
  //     break;
  //   } catch(err){
  //     console.log("DOCS UNAVAILABLE");
  //     --rep;
  //   }
  // }
  // if(rep < 100){
  //   console.log("At ", rep, " reps of failing to insert, ", equation) 
  // }
  // var rep = 3;
  // while(rep > 0){
  //   try{
  //     paragraph.getChild(childIndex+1).setLinkUrl(renderer[2] + equationOriginal + "#" + delim[6]); //added % delim 6 to keep track of which delimiter was used to render
  //     // paragraph.getChild(childIndex+1).setDescription(renderer[2] + equationOriginal + "#" + delim[6]); 
  //     break;
  //   } catch(err){
  //     console.log("Couldn't insert child index!")
  //     console.log("Next child not found!");
  //     --rep;
  //   }
  // }
  // // if(rep < 3){
  // //   console.log("At ", rep, " reps of failing to insert, ", equation) 
  // //   if(rep == 0){
  // //     throw new Error('Couldn\'t get equation child!');
  // //   }
  // // }

  // if(textCopy.getText() != "")
  //   paragraph.insertText(childIndex+2, textCopy);
  // var height = paragraph.getChild(childIndex+1).getHeight();
  // var width  = paragraph.getChild(childIndex+1).getWidth();
  // console.log("Orig size, width, height: " + size + ", " + width + ", " + height);                 //only a '1' is rendered as a 100 height (as of 10/20/19, now it is fetched as 90 height)
  
  // //SET PROPERTIES OF IMAGE (Height, Width)
  // var oldSize = size; // why use oldsize instead of new size
  
  // if(escape(resp.getBlob().getDataAsString()).substring(0,50) == invalidEquationHashCodecogsFirst50 || (size > 10 && width == 126 && height == 24)){
  //  size *= 5 // make codecogs errors readable, size constraint just in case some small equation is 126x24 as well
  // }
  // // console.log(rendererType, rendererType.valueOf(), "Texrendr".valueOf(), rendererType.valueOf() === "Codecogs".valueOf(), rendererType.valueOf() == "Codecogs".valueOf(), rendererType === "Codecogs", rendererType.valueOf() === "Texrendr".valueOf(), rendererType.valueOf() == "Texrendr".valueOf(), rendererType === "Texrendr")
  // // note that valueOf here is not needed, and neither is === => removing both keeps trues true and falses false in V8.
  // if(rendererType.valueOf() === "Texrendr".valueOf())  //TexRendr
  //   size = Math.round(size * height / 174);
  // else if(rendererType.valueOf() === "Roger's renderer".valueOf())      //Rogers renderer
  //   size = Math.round(size * height / 200);
  // else if(rendererType.valueOf() === "Codecogs".valueOf())      //CodeCogs, other
  //   size = Math.round(size * height / 100);
  // else       //CodeCogs, other
  //   size = Math.round(size * height / 100);

  
  // sizeImage(paragraph, childIndex+1, size, Math.round(size*width/height));
  // defaultSize = oldSize;
  // return [size, 0];
}

/**
 * Given the locations of the delimiters, run code to get font size, get equation, remove equation, encode/style equation, insert/style image.
 *
 * @param {element} paragraph  The paragraph which the child is in.
 * @param {integer} childIndex The childIndex in the paragraph where the text is in, to give the place to edit image.
 * @param {integer} height     The scaled height of the equation based on font size.
 * @param {integer} width      The scaled width of the equation based on font size. 
 */

 function sizeImage(paragraph, childIndex, height, width){
  var maxWidth = IntegratedApp.getPageWidth();
  //console.log("Max Page Width: " + maxWidth);
  if(width > maxWidth){
    height = Math.round(height * maxWidth / width);
    width = maxWidth;
    console.log("Rescaled in page.");
  }
  if (childIndex ==  null || width == 0 || height == 0){
    console.log("none or 0 width hight");
    return;
  }
  paragraph.getChild(childIndex).setHeight(height);
  paragraph.getChild(childIndex).setWidth(width);
}

/**
 * Given a size and a cursor right before an equation, call function to undo the image within delimeters. Returns success indicator.
 *
 * @param {string} sizeRaw     Sidebar-selected size.
 */
 
 function removeEquations(sizeRaw, delimiter){
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
 
 function editEquations(sizeRaw, delimiter){
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
 
 function getSize(sizeRaw){
  var size = 0;
  if(sizeRaw=="smart"){size = 0;}
  if(sizeRaw=="inline"){size = -1;}
  if(sizeRaw=="med" ){size = 24;}
  if(sizeRaw=="low" ){size = 12;}
  return size;
 }

// NOTE: one indexed
function getRenderer(worked) {//  order of execution ID, image URL, editing URL, in-line commandAt the beginning, in-line command at and, Human name, the part that gets rendered in browser in the fake call but not in the link(No Machine name substring)
	codeCogsPriority = 1
	sciWeaverPriority = 4
	texRenderPriority = 5
	capableRenderers = 8
	capableDerenderers = 12
	if (worked == codeCogsPriority) {return [codeCogsPriority, "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION","https://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs", "%5Cdpi%7B900%7D"]}
	else if (worked == codeCogsPriority + 1) {return [codeCogsPriority + 1, "https://latex-staging.easygenerator.com/gif.latex?%5Cdpi%7B900%7DEQUATION","https://latex-staging.easygenerator.com/eqneditor/editor.php?latex=","%5Cinline%20", "", "Codecogs", "%5Cdpi%7B900%7D"]}
	else if (worked == codeCogsPriority + 2) {return [codeCogsPriority + 2, "https://latex.codecogs.com/gif.latex?%5Cdpi%7B900%7DEQUATION","https://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs", "%5Cdpi%7B900%7D"]}
	else if (worked == texRenderPriority) {return [texRenderPriority, "http://texrendr.com/cgi-bin/mimetex?%5CHuge%20EQUATION","http://www.texrendr.com/?eqn=","%5Ctextstyle%20", "", "Texrendr", ""]}//http://rogercortesi.com/eqn/index.php?filename=tempimagedir%2Feqn3609.png&outtype=png&bgcolor=white&txcolor=black&res=900&transparent=1&antialias=1&latextext=  //removed %5Cdpi%7B900%7D
	else if (worked == sciWeaverPriority) {return [sciWeaverPriority, "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=100&ff=modern&edit=0&eq=EQUATION","http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=100&ff=modern&edit=0&eq=","%5Ctextstyle%20%7B", "%7D", "Sciweavers", ""]} //not latex font
	else if (worked == 6) {return [6,"https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION","https://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs", "%5Cdpi%7B900%7D", ""]}
	else if (worked == 7) {return [7,"http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=iwona&edit=0&eq=EQUATION","http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=iwona&edit=0&eq=","%5Ctextstyle%20%7B", "%7D", "Sciweavers", ""]} // here to de render legacy equations properly, don't remove without migrating to correct font!
	else if (worked == 8) {return [8,"http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=anttor&edit=0&eq=EQUATION","http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=png&fs=100&ff=anttor&edit=0&eq=","%5Ctextstyle%20%7B", "%7D", "Sciweavers", ""]} // here to de render legacy equations properly, don't remove without migrating to correct font!
	else if (worked == 9) {return [9,"http://rogercortesi.com/eqn/tempimagedir/_FILENAME.png","http://rogercortesi.com/eqn/index.php?filename=_FILENAME.png&outtype=png&bgcolor=white&txcolor=black&res=1800&transparent=1&antialias=0&latextext=","%5Ctextstyle%20%7B", "%7D", "Roger's renderer", ""]}//Filename has to not have any +, Avoid %,Instead use†‰, avoid And specific ASCII Percent codes
	else if (worked == 10) {return [10,"https://texrendr.com/cgi-bin/mathtex.cgi?%5Cdpi%7B1800%7DEQUATION","https://www.texrendr.com/?eqn=","%5Ctextstyle%20", "", "Texrendr", ""]} // here to de render legacy equations properly,  //http://rogercortesi.com/eqn/index.php?filename=tempimagedir%2Feqn3609.png&outtype=png&bgcolor=white&txcolor=black&res=900&transparent=1&antialias=1&latextext=  //removed %5Cdpi%7B900%7D
	else if (worked == 11) {return [11,"http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=78&ff=arev&edit=0&eq=EQUATION","http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=jpg&fs=78&ff=arev&edit=0&eq=","%5Ctextstyle%20%7B", "%7D", "Sciweavers_old", ""]} // here to de render legacy equations properly, don't remove without migrating to correct font!
	else if (worked == 12) {return [12,"http://latex.numberempire.com/render?EQUATION&sig=41279378deef11cbe78026063306e50d","http://latex.numberempire.com/render?","%5Ctextstyle%20%7B", "%7D", "Number empire", ""]} // to de render possibly very old equations
	else return [13,"https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION","https://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs", "%5Cdpi%7B900%7D"]
}//http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=78&ff=txfonts&edit=0&eq=
/**
 * 
 * http://www.sciweavers.org/tex2img.php?eq=%5Ccolor%5BRGB%5D%7B0%2C151%2C1670%7D%5Ctextstyle%20%7B3%5E%7B4%5E5%7D%20%2B%20%5Cfrac%7B1%7D%7B2%7D%7D&bc=Transparent&fc=Black&im=jpg&fs=12&ff=arev&edit=0
 * http://www.sciweavers.org/tex2img.php?eq=%5Ccolor%5BRGB%5D%7B0%2C151%2C1670%7D%5Ctextstyle%20%7B3%5E%7B4%5E5%7D%20%2B%20%5Cfrac%7B1%7D%7B2%7D%7D&bc=Transparent&fc=Black&im=jpg&fs=100&ff=modern&edit=0
 * Given string of size, return integer value.
 *  
 * @param {string} delimiters     The text value of the delimiters from HTML selection. 
 */

function getDelimiters(delimiters){// Todo - fix hardcoded delimiters. Potentially do escape(escape(original)) or something like that.
  if(delimiters=="$$"){return["$$", "$$", "\\\$\\\$", "\\\$\\\$", 2, 1, 0];} //raw begin, raw end, escaped begin, escaped end, # of chars, idk, renderer type #
  if(delimiters=="\["){return["\\[", "\\]", "\\\\\\[", "\\\\\\]", 2, 1, 1];}
  if(delimiters=="$"){return["$", "$", "[^\\\\]\\\$", "[^\\\\]\\\$", 1, 0, 2];} //(^|[^\\$])\$(?!\$) //(?:^|[^\\\\\\])\\\$ //[^\\\\]\\\$
  return ["\\[", "\\]", "\\\\\\[", "\\\\\\]", 2, 1, 1];
}

function getNumDelimiters(delimiters){// //HARDCODED DELIMTERS!!!!!!!!!!!!!
  if(delimiters=="0"){return "$$";} //reverse lookup index 6 of array from above method
  if(delimiters=="1"){return "\[";}
  if(delimiters=="2"){return "$";}
  return "$$";
}

function debugLog(string){
  if(DEBUG){
    console.log("DebugLog: " + string);
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
  for (var index = 0; index < IntegratedApp.getActivePresentation().getBody().getParent().getNumChildren(); index++){
    var body = getShapeFromIndices(index);
    var img = body.getImages(); //places all InlineImages from the active document into the array img
    for(i=0; i < img.length; i++) {
      var image = img[i];
      var origURL = new String(image.getLinkUrl()); //becomes "null", not null, if no equation link 
      if (image.getLinkUrl() === null) {continue;}
      // console.log("Current origURL " + origURL, origURL == "null", origURL === null, typeof origURL, Object.is(origURL, null), null instanceof Object, origURL instanceof Object, origURL instanceof String, !origURL)
      // console.log("Current origURL " + image.getLinkUrl(), image.getLinkUrl() === null, typeof image.getLinkUrl(), Object.is(image.getLinkUrl(), null), !image.getLinkUrl())
      var origEq;
      var worked = 1;
      var failure = 1;
      var found = 0;
      for (; worked < 7; ++worked){// example, [3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
        renderer=getRenderer(worked)[2].split("FILENAME");  //list of possibly more than one string
        for (var I = 0; I < renderer.length; ++I){
          if(origURL.indexOf(renderer[I])>-1){
            debugLog("Changing: " + origURL + " by removing " + renderer[I]);
            origURL = (origURL.substring(origURL.indexOf(renderer[I])).split(renderer[I]).join("")); //removes prefix
            found = 1;
          } else break;
        }
      }
      if(found == 0){
        console.log("Not an equation link! " + origURL);
        continue; // not an equation link
      }
      var last2 = origURL.slice(-2);
      var delimtype = 0;
      if(last2.length > 1 && (last2.charAt(0) == '%' || last2.charAt(0) == '#') && last2.charAt(1) >= '0' && last2.charAt(1) <= '9'){ //rendered with updated renderer
        debugLog("Passed: " + last2);
        delimtype = last2.charAt(1) - '0';
        origURL = origURL.slice(0, -2);
        delim = getDelimiters(getNumDelimiters(delimtype));
      }
      var origEq=deEncode(origURL);
      debugLog("Undid: " + origEq);
      var imageIndex = image.getParent().getChildIndex(image);
      if(origEq.length<=0){
        console.log("Empty. at "+ imageIndex+ " fold " + image.getParent().getText());
        image.removeFromParent();
        continue;
      }
      image.getParent().insertText(imageIndex, delim[0] + origEq + delim[1]);   // create text box and then insert text here    //INSERTS DELIMITERS
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
function undoImage(delim){
  // var cursor = IntegratedApp.getActive().getCursor(); // * no cursor for slides => replace with highlighted textbox
  //* 1. check if selected element is image
  //* 2. get position of element
  //* 3. render selected element by using element.getChild.asInlineImage(); then 
  var selection = SlidesApp.getActivePresentation().getSelection();
  debugLog("The Slides App is:" + selection)
  var currentPage = selection.getCurrentPage();
  // debugLog("current slide number is: " + pageNum + "pageNum is: " + pageNum)
  var selectionType = selection.getSelectionType();
  debugLog("selection Type is: " + selectionType)
  
  if(selectionType == SlidesApp.SelectionType.PAGE_ELEMENT){
    var element = selection.getPageElementRange().getPageElements()[0].asImage();
    if(element){
      console.log("valid selection");
      debugLog(element)
      var positionX = element.getLeft(); // returns horizontal position in points measured from upper-left of the page
      // debugLog("Left: " + positionX)
      var positionY = element.getTop(); // returns vertical position
      // debugLog("Top: " + positionY)
      var width = element.getWidth();
      // debugLog("Width: " + width)
      var height = element.getHeight();
      // debugLog("Height: " + height)
      // var image = element.getChild(position).asInlineImage();
      var image = element;
      // debugLog("Image height: " + image.getHeight());
      // var origURL = image.getContentUrl();
      // image.setDescription("https://www.codecogs.com/eqnedit.php?latex=f(t)%3D%5Csum_%7B-%5Cinfty%7D%5E%7B%5Cinfty%7Dc_ne%5E%7Bi%5Cfrac%7B2%5Cpi%20n%7D%7BT%7Dt%7D%3D%5Ccdots%2Bc_%7B-2%7De%5E%7B-i%5Cfrac%7B4%5Cpi%7D%7BT%7Dt%7D%2Bc_%7B-1%7De%5E%7B-i%5Cfrac%7B2%5Cpi%7D%7BT%7Dt%7D%2Bc_0%2Bc_1e%5E%7Bi%5Cfrac%7B2%5Cpi%7D%7BT%7Dt%7D%2Bc_2e%5E%7Bi%5Cfrac%7B4%5Cpi%7D%7BT%7Dt%7D%2B%5Ccdots#0");
      // for(let i = 0; i < linkEquation.length; i++){
      //   debugLog("linkEquation has " + linkEquation.length + "number of elements")
      //   debugLog("elements in link Equation are: " + linkEquation[i])
      // }
      
      image.setDescription('' + linkEquation[0])
      // debugLog("element in Link Equation is: " + linkEquation[0])
      var red = Number(JSON.parse(image.getTitle())[0]);
      var green = Number(JSON.parse(image.getTitle())[1]);
      var blue = Number(JSON.parse(image.getTitle())[2]);
      var origURL = JSON.parse(image.getTitle())[3];

      // var origURL = image.getTitle();
      image.remove();

      debugLog("image description is: " + origURL)

      if (!origURL){
        return -4;
      }
      // debugLog("Original URL from image: " + origURL);
      var worked = 1;
      var failure = 1;
      for (; worked <6; ++worked){//[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
        renderer=getRenderer(worked)[2].split("FILENAME"); //list of possibly more than one string
        for (var I = 0; I < renderer.length; ++I){
          if(origURL.indexOf(renderer[I])>-1){
            debugLog("Changing: " + origURL + " by removing " + renderer[I]);
            origURL = (origURL.substring(origURL.indexOf(renderer[I])).split (renderer [I]).join ("")); //removes prefix
            debugLog("Next check: " + origURL + " for " + renderer[I+1]);
          } else break;
        }
      }
      var last2 = origURL.slice(-2);
      var delimtype = 0;
      if(last2.length > 1 && (last2.charAt(0) == '%' || last2.charAt(0) == '#') && last2.charAt(1) >= '0' && last2.charAt(1) <= '9'){ //rendered with updated renderer
        debugLog("Passed: " + last2);
        delimtype = last2.charAt(1) - '0';
        origURL = origURL.slice(0, -2);
        delim = getDelimiters(getNumDelimiters(delimtype));
      }
      var origEq=deEncode(origURL);
      debugLog("Undid: " + origEq);
      if(origEq.length<=0){
        console.log("Empty equation derender.");
        return -3;
      }

      // insert textbox
      
      var shape = currentPage.insertShape(SlidesApp.ShapeType.TEXT_BOX, positionX, positionY, width, height);
      var textRange = shape.getText();
      textRange.insertText(0, delim[0] + origEq + delim[1]).getTextStyle().setForegroundColor(red, green, blue);
      debugLog("textRange: " + textRange + "type: " + typeof textRange)
      debugLog(typeof textRange.insertText);
      // insert original equation into newly created text box
      // element.getChild(position+1).removeFromParent();
      return 1;
    }
    else {
      return -2;
    }
  }

    
}

//   if (cursor) {
//     // Attempt to insert text at the cursor position. If the insertion returns null, the cursor's
//     // containing element doesn't allow insertions, so show the user an error message.
//     // var element  = cursor.getElement();  //checkForDelimiter

//     if (element) {
//       console.log("Valid cursor.");

//       var position = cursor.getOffset();   //offset
//       //element.getChild(position).removeFromParent();  //SUCCESSFULLY REMOVES IMAGE FROM PARAGRAPH
//       // console.log(element.getAllContent(), element.type())
//       var image = element.getChild(position).asInlineImage();
//       debugLog("Image height", image.getHeight());
//       var origURL = image.getLinkUrl(); // * URL from codecogs for decoding
//       if (!origURL){
//         return -4;
//       }
//       debugLog("Original URL from image", origURL);
//       var worked = 1;
//       var failure = 1;
//       for (; worked <6; ++worked){//[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
//         renderer=getRenderer(worked)[2].split("FILENAME"); //list of possibly more than one string
//         for (var I = 0; I < renderer.length; ++I){
//           if(origURL.indexOf(renderer[I])>-1){
//             debugLog("Changing: " + origURL + " by removing " + renderer[I]);
//             origURL = (origURL.substring(origURL.indexOf(renderer[I])).split (renderer [I]).join ("")); //removes prefix
//             debugLog("Next check: " + origURL + " for " + renderer[I+1]);
//           } else break;
//         }
//       }
//       var last2 = origURL.slice(-2);
//       var delimtype = 0;
//       if(last2.length > 1 && (last2.charAt(0) == '%' || last2.charAt(0) == '#') && last2.charAt(1) >= '0' && last2.charAt(1) <= '9'){ //rendered with updated renderer
//         debugLog("Passed: " + last2);
//         delimtype = last2.charAt(1) - '0';
//         origURL = origURL.slice(0, -2);
//         delim = getDelimiters(getNumDelimiters(delimtype));
//       }
//       var origEq=deEncode(origURL);
//       //       if(origURL.indexOf("codecogs")>-1)//codecogs                         // bad: url hardcoded location
//       //          origEq = deEncode(origURL).substring(42);
//       //       else if(origURL.indexOf("texrendr")>-1)
//       //          origEq = deEncode(origURL).substring(29);
//       //       else return -3;
//       debugLog("Undid: " + origEq);
//       if(origEq.length<=0){
//         console.log("Empty equation derender.");
//         return -3;
//       }
//       cursor.insertText(delim[0] + origEq + delim[1]);       //INSERTS DELIMITERS
//       element.getChild(position+1).removeFromParent();
//       return 1;
//     } else {
//       return -2;
//     }
//   }
//   else {
//     return -1;
//   }
//   return 0;
// }
