const DEBUG = true; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information

/**
 * An array which defines a renderer
 * 
 * Note: clasp-types is not compatible with type aliases, so this is defined as an interface instead.
 * @public
 */
interface Renderer {
  image: string;
  editor: string;
  inlineStart: string;
  inlineEnd: string;
  name: string;
  // the part that gets rendered in browser in the fake call but not in the link(No Machine name substring)
  editorEnd: string;
};

/**
 * @public
 */
const enum DerenderResult {
  InvalidUrl, // if no derenderer was able to get the raw equation out
  NullUrl, // if the URL is null (link removed for instance)
  EmptyEquation, 
  NonExistentElement, // if the element the cursor is in doesnt exist
  CursorNotFound,
  Success
}

/**
 * @public
 */
interface IntegratedApp {
  getUi(): GoogleAppsScript.Base.Ui;
  getBody(): GoogleAppsScript.Document.Body | GoogleAppsScript.Slides.Slide[];
  getActive(): GoogleAppsScript.Document.Document | GoogleAppsScript.Slides.Presentation;
  getPageWidth(): number;
}

/**
 * @public
 */
interface Delimiter {
  0: string;
  1: string;
  2: string;
  3: string;
  4: number;
  5: number;
  6: number;
}

const TIMING_DEBUG = false; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information
let previousTime = 0;
let previousLine = 0;
let equationRenderingTime = 0;
let codecogsSlow = 0;

const codeCogsRenderers: Renderer[] = [
  {
    image: "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION",
    editor: "https://www.codecogs.com/eqnedit.php?latex=",
    inlineStart: "%5Cinline%20",
    inlineEnd: "",
    name: "Codecogs",
    editorEnd: "%5Cdpi%7B900%7D",
  },
  {
    image: "https://latex-staging.easygenerator.com/gif.latex?%5Cdpi%7B900%7DEQUATION",
    editor: "https://latex-staging.easygenerator.com/eqneditor/editor.php?latex=",
    inlineStart: "%5Cinline%20",
    inlineEnd: "",
    name: "Codecogs",
    editorEnd: "%5Cdpi%7B900%7D",
  },
  {
    image: "https://latex.codecogs.com/gif.latex?%5Cdpi%7B900%7DEQUATION",
    editor: "https://www.codecogs.com/eqnedit.php?latex=",
    inlineStart: "%5Cinline%20",
    inlineEnd: "",
    name: "Codecogs",
    editorEnd: "%5Cdpi%7B900%7D",
  }
];
const sciWeaverRenderer: Renderer = {
  image: "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=100&ff=modern&edit=0&eq=EQUATION",
  editor: "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=100&ff=modern&edit=0&eq=",
  inlineStart: "%5Ctextstyle%20%7B",
  inlineEnd: "%7D",
  name: "Sciweavers",
  editorEnd: ""
};
const texRendrRenderer: Renderer = {
  image: "http://texrendr.com/cgi-bin/mimetex?%5CHuge%20EQUATION",
  editor: "http://www.texrendr.com/?eqn=",
  inlineStart: "%5Ctextstyle%20",
  inlineEnd: "",
  name: "Texrendr",
  editorEnd: ""
};
// renderers not affected by changing priorities
const otherRenderers: Renderer[] = [
  {
    image: "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION",
    editor: "https://www.codecogs.com/eqnedit.php?latex=",
    inlineStart: "%5Cinline%20",
    inlineEnd: "",
    name: "Codecogs",
    editorEnd: "%5Cdpi%7B900%7D",
  },
  {
    image: "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=iwona&edit=0&eq=EQUATION",
    editor: "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=iwona&edit=0&eq=",
    inlineStart: "%5Ctextstyle%20%7B",
    inlineEnd: "%7D",
    name: "Sciweavers",
    editorEnd: "",
  },
  {
    image: "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=png&fs=100&ff=anttor&edit=0&eq=EQUATION",
    editor: "http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=png&fs=100&ff=anttor&edit=0&eq=",
    inlineStart: "%5Ctextstyle%20%7B",
    inlineEnd: "%7D",
    name: "Sciweavers",
    editorEnd: "",
  },
  {
    image: "http://rogercortesi.com/eqn/tempimagedir/_FILENAME.png",
    editor: "http://rogercortesi.com/eqn/index.php?filename=_FILENAME.png&outtype=png&bgcolor=white&txcolor=black&res=1800&transparent=1&antialias=0&latextext=",
    inlineStart: "%5Ctextstyle%20%7B",
    inlineEnd: "%7D",
    name: "Roger's renderer",
    editorEnd: "",
  },
  {
    image: "http://www.sciweavers.org/tex2img.php?bc=Transparent&fc=Black&im=jpg&fs=78&ff=arev&edit=0&eq=EQUATION",
    editor: "http://www.sciweavers.org/tex2img.php?bc=White&fc=Black&im=jpg&fs=78&ff=arev&edit=0&eq=",
    inlineStart: "%5Ctextstyle%20%7B",
    inlineEnd: "%7D",
    name: "Sciweavers_old",
    editorEnd: "",
  },
  {
    image: "http://latex.numberempire.com/render?EQUATION&sig=41279378deef11cbe78026063306e50d",
    editor: "http://latex.numberempire.com/render?",
    inlineStart: "%5Ctextstyle%20%7B",
    inlineEnd: "%7D",
    name: "Number empire",
    editorEnd: "",
  },
  {
    image: "https://texrendr.com/cgi-bin/mathtex.cgi?%5Cdpi%7B1800%7DEQUATION",
    editor: "https://www.texrendr.com/?eqn=",
    inlineStart: "%5Ctextstyle%20",
    inlineEnd: "",
    name: "Texrendr",
    editorEnd: ""
  },
  {
    image: "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION",
    editor: "https://www.codecogs.com/eqnedit.php?latex=", inlineStart: "%5Cinline%20",
    inlineEnd: "",
    name: "Codecogs",
    editorEnd: "%5Cdpi%7B900%7D"
  },
];

/**
 * @public
 */
const capableRenderers = 8;
/**
 * @public
 */
const capableDerenderers = 12;
//render bug variables

/**
 * @public
 */
const invalidEquationHashesCodecogs = new Set([
  "GIF89a%7F%00%18%00%uFFFD%00%00%uFFFD%u0315%uFFFD3%", // invalid codecogs equation
  "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00%01%", // this is one space in codecogs. not pushed yet.
  "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0",
  "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00z%00",
]);
const invalidEquationHashesTexrendr = new Set([
  "GIF89a%uFFFD%008%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%",
  "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0",
  "GIF89ai%0A%uFFFD%01%uFFFD%00%00%uFFFD%uFFFD%uFFFD%", // this is the No Expression Supplied error. Ignored for now.
  "%7FELF%01%01%01%00%00%00%00%00%00%00%00%00%02%00%0"
]);
const invalidEquationHashSciweavers = new Set([
  "%0D%0A%09%3C%21DOCTYPE%20html%20PUBLIC%20%22-//W3C"
]);

/**
 * @public
 */
function reportDeltaTime(line: number | undefined = 0, forcePrint: string = "") {
  const thisTime = Date.now();
  if (!previousTime) previousTime = thisTime;
  var deltaTime = thisTime - previousTime;
  if (TIMING_DEBUG || forcePrint) {
    if (line > 0) {
      const metadata = forcePrint ? " with metadata " + forcePrint : "";
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
 * @public
 */
function encodeFlag(flag: number, renderCount: number) {
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
function assert(value: boolean, command = "unspecified") {
  if (!value) {
    console.error("Assert failed! When doing ", command);
  }
}

//encode function that gets Missed. Google Docs characters stuff
function getCustomEncode(equation: string, direction: number, time: number) {
  // there are two sublists because they happen at differeent times (on encode or decoded string).
  // In addition, the second set is one way due to typing errors/unsupported characters.
  // Replace the first array just for the accompanying link. 	%C2%AD is better than %A0
  // Note newlines are also %0A or %0D or %0D%0A
  const toFind = [
    ["#", "+", "%0D", "%0D", "%0D"],
    ["‘", "’", "”", "“", "−", "≥", "≤", "‐", "—"],
  ];
  const toReplace = [
    ["+%23", "+%2B", "%5C%5C%5C%5C%20", "%5C%5C%20", "%A0"],
    ["'", "'", '"', '"', "-", "\\geq", "\\leq", "-", "-"],
  ]; //&hash;&plus; todo ≥ with \geq
  assert(toFind[time].length == toReplace[time].length, "toFind[time].length == toReplace[time].length");
  for (let i = 0; i < toFind[time].length; ++i) {
    if (direction === 0) equation = equation.split(toFind[time][i]).join(toReplace[time][i]);
    else if (direction === 1 && time === 0) {
      // the single, double quotes, and hyphens should stay minus signs.
      equation = equation.split(toReplace[time][i]).join(toFind[time][i]);
    }
  }
  return equation;
}
//
//The one indexed 3rd rendering service needs this for file names
function getFilenameEncode(equation: string, direction: number) {
  const toFind = ["+", "'", "%", "(", ")", "&", ";", ".", "~", "*", "{", "}"];
  const toReplace = ["†", "‰27", "‰", "‹", "›", "§", "‡", "•", "˜", "ª", "«", "»"];
  for (let i = 0; i < Math.min(toFind.length, toReplace.length); ++i) {
    if (direction === 0) equation = equation.split(toFind[i]).join(toReplace[i]);
    else if (direction === 1) equation = equation.split(toReplace[i]).join(toFind[i]);
  }
  return equation;
}
/**
 * Retrives the equation from the paragraph, encodes it, and returns it.
 * @public
 */
function reEncode(equation: string) {
  equation = getCustomEncode(equation, 0, 1);
  return getCustomEncode(encodeURIComponent(equation), 0, 0); //escape deprecated
}

/**
 * returns the deencoded equation as a string.
 */
function deEncode(equation: string) {
  reportDeltaTime(269);
  debugLog(equation);
  debugLog(getCustomEncode(getFilenameEncode(equation, 1), 1, 0));
  debugLog(decodeURIComponent(getCustomEncode(getFilenameEncode(equation, 1), 1, 0)));

  reportDeltaTime(274);
  const equationStringDecoded = getCustomEncode(
    decodeURIComponent(getCustomEncode(getFilenameEncode(equation, 1), 1, 0)), //escape deprecated
    1,
    1
  );
  debugLog("Decoded with replacing: " + equationStringDecoded);
  return equationStringDecoded;
}

/**
 * Using the encoded equation, add the commands for high quality, inline or not (based on size neg or pos), and returns it.
 *
 * @param  equationStringEncoded  The encoded equation.
 * @param inlineStyle            The text to be inserted for inline text, dependent on CodeCogs or TeXRendr.
 * @param size                   The size of the text, whose neg/pos indicated whether the equation is inline or not.
 */

function getStyle(equationStringEncoded: string, renderer: Renderer, isInline: boolean, type: number, red: number, green: number, blue: number) {
  //ERROR?
  const equation: string[] = [];
  equationStringEncoded = equationStringEncoded;
  reportDeltaTime(307);
  if (isInline) {
    equationStringEncoded = renderer.inlineStart + "%7B%5Ccolor%5BRGB%5D%7B" + red + "%2C" + green + "%2C" + blue + "%7D" + equationStringEncoded + renderer.inlineEnd + "%7D";
  } else {
    equationStringEncoded = "%7B%5Ccolor%5BRGB%5D%7B" + red + "%2C" + green + "%2C" + blue + "%7D" + equationStringEncoded + "%7D";
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
function savePrefs(size: string, delim: string) {
  const userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty("size", size);
  userProperties.setProperty("delim", delim);
  // userProperties.setProperty('defaultSize', size);
}

/**
 * @public
 */
function getPrefs() {
  const userProperties = PropertiesService.getUserProperties();
  const savedPrefs = {
    size: userProperties.getProperty("size"),
    delim: userProperties.getProperty("delim"),
  };
  debugLog("Got prefs size:" + savedPrefs.size);
  return savedPrefs;
}

/**
 * @public
 */
function getKey() {
  console.log("Got Key: " + Session.getTemporaryActiveUserKey() + " and email " + Session.getEffectiveUser().getEmail());
  return Session.getTemporaryActiveUserKey();
}

/**
 * @public
 */
function renderEquation(equationOriginal: string, quality: number, delim: Delimiter, isInline: boolean, red: number, green: number, blue: number) {
  var equation = "";
  let renderer: Renderer | null = null;
  let resp: GoogleAppsScript.URL_Fetch.HTTPResponse | null = null;
  let deltaTime: number;

  // if only failed codecogs, probably weird evening bug from 10/15/19
  // if failed codecogs and texrendr, probably shitty equation and the codecogs error is more descriptive so show it
  let codecogsFailedResp: GoogleAppsScript.URL_Fetch.HTTPResponse | null = null;
  let texrenderFailCount = 0;
  let codecogsFailCount = 0;

  // note the last few renderers might be legacy, so ignored
  for (let worked = 1; worked <= capableRenderers; ++worked) {
    try {
      renderer = getRenderer(worked);
      equation = getStyle(equationOriginal, renderer, isInline, worked, red, green, blue);

      // renderer-specific replacements
      switch (renderer.name) {
        case "Texrendr":
          equation = equation.replaceAll("%A0", "%0D");
          break;
        case "Codecogs":
        case "Sciweavers":
          equation = equation.replaceAll("%5C%5C%5C%5C", "%5C%5C");
          break;
      }

      debugLog("Raw equation", equation);
      const equationFilename = getFilenameEncode(equation, 0);
      const imageUrl = renderer.image
        .replace("FILENAME", equationFilename)
        .replace("EQUATION", equation);

      const baseEditorUrl = renderer.editor.replace("FILENAME", equationFilename);
      const editorCacheUrl = baseEditorUrl + renderer[6] + equation;
      // equation original with the delim
      const editorOriginalEqUrl = baseEditorUrl + equationOriginal + "#" + delim[6];
      
      
      debugLog("Link with equation:", imageUrl);
      debugLog("Title Alt Text:", editorOriginalEqUrl);
      debugLog("Cached equation:", editorCacheUrl);
      reportDeltaTime(453);
      console.log(`Fetching ${imageUrl} and ${editorCacheUrl}`);

      // simulates putting text into text renderer => creates link for cached image which is accessed later
      // needed for codecogs to generate equation properly, need to figure out which other renderers need this. to test, use align* equations.
      UrlFetchApp.fetch(editorCacheUrl);

      reportDeltaTime(458, " fetching w eqn len " + equation.length + " with renderer " + renderer.name);
      if (renderer.name === "Codecogs" || renderer.name === "Sciweavers") {
        Utilities.sleep(50); // sleep 50ms to let codecogs put the equation in its cache
      }
      resp = UrlFetchApp.fetch(imageUrl);

      deltaTime = reportDeltaTime(470, ` equation link length ${imageUrl.length} and renderer ${renderer.name}`);
;

      const equationHash = escape(resp.getBlob().getDataAsString()).substring(0, 50);
      debugLog(resp, resp.getBlob(), equationHash);
      
      if (!equationHash) {
        // if there is no hash, codecogs failed
        throw new Error("Saw NO Codecogs equation hash! Renderer likely down!");
      } else if (invalidEquationHashSciweavers.has(equationHash) && renderer.name === "Sciweavers") {
        // sciweavers error
        throw new Error("Saw weburl Sciweavers equation hash! Equation likely contains amsmath!");
      } else if (invalidEquationHashesCodecogs.has(equationHash) && renderer.name === "Codecogs") {
        console.log(`Invalid Codecogs Equation! Fail count: ${texrenderFailCount + codecogsFailCount}`);
        codecogsFailedResp = resp;
        codecogsFailCount++;
        
        if (texrenderFailCount) {
          // texrender also failed, so just display the error from codecogs
          console.log("Displaying codecogs error!");
        } else {
          // throw an error, and try with other renderers (like texrender too)
          throw new Error("Saw invalid Codecogs equation hash!");
        }
      } else if (invalidEquationHashesTexrendr.has(equationHash) && renderer.name === "Texrendr") {
        console.log(`Invalid Texrendr Equation! Fail count: ${texrenderFailCount + codecogsFailCount}`);
        texrenderFailCount++;
        
        if (codecogsFailedResp) {
          // if in order so failed codecogs first
          console.log("Displaying Codecogs error instead!");
          resp = codecogsFailedResp; // let it continue to completion with the failed codecogs equation
          renderer = codeCogsRenderers[0];
        } else {
          // should only execute if texrendr is 1
          throw new Error("Saw invalid Texrendr equation hash!");
        }
      }

      // Deprioritize Codecogs if it was slow
      // if worked > 3, then codecogsSlow was already true
      if (deltaTime > 10000 && renderer.name == "Codecogs" && worked <= 3) {
        console.log("Codecogs accurate but is slow! Switching renderer priority.");
        codecogsSlow = 1;
      }
      console.log(`Worked with ${renderer.name} (${worked})`);

      // return the 
      return {
        imageBlob: resp.getBlob(),
        renderer,
        editorOriginalEqUrl,
        equation,
        isCodecogsError: resp === codecogsFailedResp
      };
    } catch (err) {
      // an error occurred; continue to the next renderer
      
      console.log(`${renderer.name} Error! - ${err}`);
      
      deltaTime = reportDeltaTime(533, ` failed equation link length ${renderer![1].length} and renderer ${renderer.name}`);
    }
  }

  return null;
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

function sizeImage(app: IntegratedApp, paragraph: GoogleAppsScript.Document.Paragraph, childIndex: number, height: number, width: number) {
  const maxWidth = app.getPageWidth();
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
  paragraph.getChild(childIndex).asInlineImage().setHeight(height);
  paragraph.getChild(childIndex).asInlineImage().setWidth(width);
}

/**
 * NOTE: one indexed. if codecogsSlow is 1, switch order of texrendr and codecogs
 * @public
 */
function getRenderer(worked: number): Renderer {
  // for worked >= 6, renderers are static
  if (worked >= 6) {
    return otherRenderers[worked - 6];
  }

  // if codecogs is slow, use sciweaver/texrendr before it
  const renderers = codecogsSlow ?
    [sciWeaverRenderer, texRendrRenderer, ...codeCogsRenderers] :
    [...codeCogsRenderers, texRendrRenderer, sciWeaverRenderer];

  return renderers[worked - 1];
}

/**
 * Given string of size, return integer value.
 *
 * @param delimiters     The text value of the delimiters from HTML selection.
 * @public
 */

function getDelimiters(delimiters: string): Delimiter {
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

function getNumDelimiters(delimiters: string | number) {
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

/**
 * @public
 */
function debugLog(...strings: any[]) {
  if (DEBUG) {
    // We have to ignore this because console.log with a rest parameter is part of typescript's DOM library, which Google Apps Script doesn't support.
    // @ts-ignore
    console.log(...strings);
  }
}

/**
 * Given string of size, return integer value.
 *
 * @param sizeRaw     The text value of the size from HTML selection.
 * @public
 */

function getSize(sizeRaw: string) {
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
function derenderEquation(origURL: string) {
  let found = false;
  for (let worked = 1; worked <= capableDerenderers; ++worked) {
    //[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
    const renderer = getRenderer(worked).editor.split("FILENAME"); //list of possibly more than one string
    for (const item of renderer) {
      const itemIndex = origURL.indexOf(item);

      if (itemIndex === -1) break;
      
      debugLog(`Changing: ${origURL} by removing ${item}`);
      origURL = origURL.substring(itemIndex + item.length); //removes prefix
      found = true;
    }
  }
  if (!found) {
    console.log("Not an equation link! " + origURL);
    return null; // not an equation link
  }
  const last2 = origURL.slice(-2);
  let delim: Delimiter | null = null;
  if (last2.length > 1 && (last2.charAt(0) == "%" || last2.charAt(0) == "#") && last2.charAt(1) >= "0" && last2.charAt(1) <= "9") {
    //rendered with updated renderer
    debugLog("Passed: " + last2);
    const delimtype = parseInt(last2.charAt(1)) - 0;
    origURL = origURL.slice(0, -2);
    delim = getDelimiters(getNumDelimiters(delimtype));
  }
  const origEq = deEncode(origURL);
  debugLog("Undid: " + origEq);

  return {
    origEq,
    delim
  }
}
