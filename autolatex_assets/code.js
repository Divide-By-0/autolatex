/**
 * Creates a menu entry in the Google Docs UI when the document is opened.
 *
 * @param {object} e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
function onOpen(e) {
  DocumentApp.getUi().createAddonMenu()
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
  var ui = HtmlService.createHtmlOutputFromFile('Sidebar')
      .setWidth(300)
      .setTitle('Auto-Latex Equations');
  DocumentApp.getUi().showSidebar(ui);
}

//add to log
function addLog(str) {
  Logger.log(str);
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
  Logger.log("delimiter prefs:" + prefs.delimiters);
  Logger.log("size prefs:" + prefs.size);
  return prefs;
}

/**
 * Constantly keep replacing latex till all are finished
 */
function replaceEquations(sizeRaw, delimiter){
  var quality = 900;
  var size = getSize(sizeRaw);
  var isInline = false;
  if(size < 0){
    isInline = true;
    size = 0;
  } 
  var delim = getDelimiters(delimiter);
  savePrefs(sizeRaw, delimiter);
  //placeImage("\\\\\\(", "\\\\\\)");
  var c = 0;  //counter
  var defaultSize = 11;
  while(true){
    var gotSize = findPos(delim, quality, size, defaultSize, isInline);   //or: "\\\$\\\$", "\\\$\\\$"
    if(gotSize == -100000)
      return (c - 100000);                                   //instead, return pair of number and bool flag
    
    if(gotSize == 0)break;
    defaultSize = gotSize;
    c++;
  }
  return c;
}
    
/**
 * Get position of insertion then place the image there.
 * @param {string}  delim[4]     The text delimiters and regex delimiters for start and end in that order.
 */
 
function findPos(delim, quality, size, defaultSize, isInline){
  var docBody = DocumentApp.getActiveDocument().getBody();
  
  var startElement = docBody.findText(delim[2]);
  if(startElement==null)
    return 0; 
  var placeHolderStart = startElement.getStartOffset(); //position of image insertion

  var endElement = docBody.findText(delim[3], startElement);
  if(endElement==null)
    return 0;
  var placeHolderEnd = endElement.getEndOffsetInclusive(); //text between placeHolderStart and placeHolderEnd will be permanently deleted

  return placeImage(startElement, placeHolderStart, placeHolderEnd, quality, size, defaultSize, delim, isInline);
}

/**
 * Retrives the equation from the paragraph, encodes it, and returns it.
 *
 * @param {element} paragraph  The paragraph which the child is in.
 * @param {integer} childIndex The childIndex in the paragraph where the text is in.
 * @param {integer} start      The offset in the childIndex where the equation delimiters start.
 * @param {integer} end        The offset in the childIndex where the equation delimiters end.
 */
 
function getEquation(paragraph, childIndex, start, end){
  var equation = [];
  var equationOriginal = [];
  var equationStringEncoded = paragraph.getChild(childIndex).getText().substring(start+2, end-1);
  equationStringEncoded = encodeURI(equationStringEncoded); //escape deprecated
  equationStringEncoded.split("+").join("%2B");
  equationOriginal.push(equationStringEncoded);
  return equationOriginal;
}

/**
 * Using the encoded equation, add the commands for high quality, inline or not (based on size neg or pos), and returns it.
 *
 * @param {string}  equationStringEncoded  The encoded equation.
 * @param {integer} quality                The dpi quality to be rendered in (default 900).
 * @param {string}  inlineStyle            The text to be inserted for inline text, dependent on CodeCogs or TeXRendr.
 * @param {integer} size                   The size of the text, whose neg/pos indicated whether the equation is inline or not.
 */
 
function getStyle(equationStringEncoded, quality, inlineStyle, isInline){
  var equation = [];
  equationStringEncoded = "%5Cdpi%7B" + quality + "%7D" + equationStringEncoded;
  equationStringEncoded = equationStringEncoded.split("+").join("%2B");
  //Logger.log('EquationOrig: ' + equationStringEncoded);
  if(isInline) equationStringEncoded = inlineStyle + equationStringEncoded;
  equation.push(equationStringEncoded);
  //Logger.log('Equation: ' + equation);
  return equation;
}

function savePrefs(size, delim){
  var userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('size', size);
  userProperties.setProperty('delim', delim);
}

function getPrefs() {
  var userProperties = PropertiesService.getUserProperties();
  var savedPrefs = {
    size: userProperties.getProperty('size'),
    delim: userProperties.getProperty('delim')
  };
  Logger.log("Got prefs size:" + savedPrefs.size);
  return savedPrefs;
}


function setSize(size, defaultSize, paragraph, childIndex, start){
  //GET SIZE
  Logger.log("size is " + size);
  if(size==0){
    size = paragraph.getChild(childIndex).editAsText().getFontSize(start+3);
    Logger.log("New size is " + size);
    if(size==null ||  size <= 0){
      Logger.log("Null size! Assigned " +  defaultSize);
      size = defaultSize;
    }
  }
  Logger.log("Found Size In Doc As " + size);
  return size;
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
 * @param {string}  delim[4]     The text delimiters and regex delimiters for start and end in that order.
 */
 
function placeImage(startElement, start, end, quality, size, defaultSize, delim, isInline) {
  var docBody = DocumentApp.getActiveDocument().getBody();
  // GET VARIABLES
  var textElement = startElement.getElement(); 
  var text      = textElement.getText();
  var paragraph = textElement.getParent();
  var childIndex          = paragraph.getChildIndex(textElement);  //gets index of found text in paragaph
  
  Logger.log('Child at: ' + childIndex + ', range = (' + start + ',' + end + ')');

  size = setSize(size, defaultSize, paragraph, childIndex, start);
  
  //GET EQUATION, APPLY QUALITY - 300(low), 600(med), 900(high), 1800(super-high)
  var equationOriginal = getEquation(paragraph, childIndex, start, end);
  var equationCodeCogs = getStyle(equationOriginal, quality, "%5Cinline%20", isInline); //inline style is either "%5Cinline%20" or "%5Ctextstyle%20", if CodeCogs or texrendr.
  var equationTexRendr = getStyle(equationOriginal, quality, "%5Ctextstyle%20", isInline); //inline style is either "%5Cinline%20" or "%5Ctextstyle%20", if CodeCogs or texrendr.
  
  var resp;
  var worked = 1;
  try {
    resp = UrlFetchApp.fetch("https://latex.codecogs.com/png.latex?" + equationCodeCogs);
  } catch(err) {
    Logger.log("CodeCogs Error! - " + err);
    worked = 0;
  }
  
  if(worked==0){
    try {
      resp = UrlFetchApp.fetch("http://texrendr.com/cgi-bin/mathtex.cgi?" + equationTexRendr);
      worked = 2;
    } catch(err) {
      Logger.log("TexRendr Error! - " + err);
      worked = 0;
    }
  }
  
  if(worked == 0) return -100000;
  // SAVING FORMATTING 
  var textCopy = textElement.asText().copy();
  var endLimit = end;
  if(text.length-1 < endLimit) endLimit = text.length-1;
  textCopy.asText().editAsText().deleteText(0, endLimit);
  textElement.editAsText().deleteText(start, text.length -1)
  var logoBlob = resp.getBlob();
  while(true){
    try{
      paragraph.insertInlineImage(childIndex+1, logoBlob);
      break;
    } catch(err){
      Logger.log("DOCS UNAVAIALLABBLLELE");
    }
  }
  
  if(worked == 1)
    paragraph.getChild(childIndex+1).setLinkUrl("http://www.codecogs.com/eqnedit.php?latex=" + equationOriginal);
  else if(worked == 2)
    paragraph.getChild(childIndex+1).setLinkUrl("http://www.texrendr.com/?eqn=" + equationOriginal);
    
  if(textCopy.getText() != "")
    paragraph.insertText(childIndex+2, textCopy);
  var height = paragraph.getChild(childIndex+1).getHeight();
  var width  = paragraph.getChild(childIndex+1).getWidth();
  Logger.log("Orig size, width, height: " + size + ", " + width + ", " + height);                 //only a '1' is rendered as a 100 height
  
  //SET PROPERTIES OF IMAGE (Height, Width)
  var oldSize = size;
  if(worked == 1)       //CodeCogs
    size = Math.round(size * height / 100);
  else if(worked == 2)  //TexRendr
    size = Math.round(size * height / 87);
  sizeImage(paragraph, childIndex+1, size, Math.round(size*width/height));
  defaultSize = oldSize;
  return defaultSize;
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
  var maxWidth = DocumentApp.getActiveDocument().getPageWidth();
  Logger.log("Max Page Width: " + maxWidth);
  if(width > maxWidth){
    height = Math.round(height * maxWidth / width);
    width = maxWidth;
    Logger.log("Rescaled in page.");
  }
  paragraph.getChild(childIndex).setHeight(height);
  paragraph.getChild(childIndex).setWidth(width);
  Logger.log("Final Width, Height: " + width + ", " + height);
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
  Logger.log(toReturn);
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


/**
 * Given string of size, return integer value.
 *  
 * @param {string} delimiters     The text value of the delimiters from HTML selection. 
 */
 
function getDelimiters(delimiters){// //HARDCODED DELIMTERS!!!!!!!!!!!!!
  if(delimiters=="$$"){return["$$", "$$", "\\\$\\\$", "\\\$\\\$"];}
  if(delimiters=="\["){return["\\[", "\\]", "\\\\\\[", "\\\\\\]"];}
  return ["\\[", "\\]", "\\\\\\[", "\\\\\\]"];
}

/**
 * Given a cursor right before an equation, de-encode URL and replace image with raw equation between delimiters.
 *
 * @param {string} start     Start delimiter to insert.
 * @param {string} end       End delimiter to insert.
 */

function undoImage(delim){
  var cursor = DocumentApp.getActiveDocument().getCursor();
  if (cursor) {
   // Attempt to insert text at the cursor position. If the insertion returns null, the cursor's
   // containing element doesn't allow insertions, so show the user an error message.
     var element  = cursor.getElement();  //startElement
     
     if (element) {
       Logger.log("Valid cursor.");
       
       var position = cursor.getOffset();   //offset
       //element.getChild(position).removeFromParent();  //SUCCESSFULLY REMOVES IMAGE FROM PARAGRAPH
       var origURL = element.getChild(position).asInlineImage().getLinkUrl();
       var origEq;
       Logger.log(origURL.charAt(11));
       if(origURL.charAt(11)=="c")//codecogs                         //HARDCODED LOCATION IN URL!!!!!!!!!!!!!!!!!!!!!!!
         origEq = decodeURI(origURL).substring(42);
       else 
         origEq = decodeURI(origURL).substring(29);
       Logger.log("Undid: " + origEq);
       if(origEq.length<=0){
         Logger.log("Empty.");
         return -3;
       }
       cursor.insertText(delim[0] + origEq + delim[1]);       //INSERTS DELIMITERS
       element.getChild(position+1).removeFromParent();
       return 1;
     
     } else {
       return -2;
     }
   } 
   else {
     return -1;
   }
   return 0;
}