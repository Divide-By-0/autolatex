const DEBUG = true; //doing ctrl + m to get key to see errors is still needed; DEBUG is for all nondiagnostic information

/**
 * An array which defines a renderer
 * 
 * Note: clasp-types is not compatible with type aliases, so this is defined as an interface instead.
 * @public
 */
interface Renderer {
  0: number;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: string;
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
let texrendrDown = 0;
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
const invalidEquationHashCodecogsFirst50 = "GIF89a%7F%00%18%00%uFFFD%00%00%uFFFD%u0315%uFFFD3%"; // invalid codecogs equation
const invalidEquationHashCodecogsFirst50_3 = "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00%01%"; // this is one space in codecogs. not pushed yet.
const invalidEquationHashCodecogsFirst50_4 = "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0";
const invalidEquationHashCodecogsFirst50_5 = "%uFFFDPNG%0D%0A%1A%0A%00%00%00%0DIHDR%00%00%00z%00";
const invalidEquationHashTexrendrFirst50 = "GIF89a%uFFFD%008%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%";
const invalidEquationHashTexrendrFirst50_2 = "GIF89a%01%00%01%00%uFFFD%00%00%uFFFD%uFFFD%uFFFD%0";
const invalidEquationHashTexrendrFirst50_3 = "GIF89ai%0A%uFFFD%01%uFFFD%00%00%uFFFD%uFFFD%uFFFD%"; // this is the No Expression Supplied error. Ignored for now.
const invalidEquationHashTexrendrFirst50_4 = "%7FELF%01%01%01%00%00%00%00%00%00%00%00%00%02%00%0";
const invalidEquationHashSciweaversFirst50 = "%0D%0A%09%3C%21DOCTYPE%20html%20PUBLIC%20%22-//W3C";

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
  // remove non-ascii characters (but separate diacritics where possible)
  equation = equation.normalize("NFD").replace(/[\u{0080}-\u{FFFF}]/gu, '');
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
 * @param quality                The dpi quality to be rendered in (default 900).
 * @param inlineStyle            The text to be inserted for inline text, dependent on CodeCogs or TeXRendr.
 * @param size                   The size of the text, whose neg/pos indicated whether the equation is inline or not.
 */

function getStyle(equationStringEncoded: string, quality: number, renderer: Renderer, isInline: boolean, type: number, red: number, green: number, blue: number) {
  //ERROR?
  const equation: string[] = [];
  equationStringEncoded = equationStringEncoded;
  reportDeltaTime(307);
  // handle RGB coloring, except on Texrendr
  if (renderer[5] !== "Texrendr") {
    // \color[RGB]{0,0,0}
    equationStringEncoded = "%5Ccolor%5BRGB%5D%7B" + red + "%2C" + green + "%2C" + blue + "%7D" + equationStringEncoded;
  }

  if (isInline) {
    // wrap in renderer inline delimiters
    equationStringEncoded = renderer[3] + "%7B" + equationStringEncoded + renderer[4] + "%7D";
  } else {
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
  let failure = 1;
  let rendererType = "";
  let deltaTime: number;
  let worked = 1;

  let failedCodecogs = 0;
  let failedTexrendr = 0;
  let failedResp: GoogleAppsScript.URL_Fetch.HTTPResponse | null = null;
  // if only failed codecogs, probably weird evening bug from 10/15/19
  // if failed codecogs and texrendr, probably shitty equation and the codecogs error is more descriptive so show it

  // note the last few renderers might be legacy, so ignored
  for (; worked <= capableRenderers; ++worked) {
    //[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
    try {
      renderer = getRenderer(worked);
      rendererType = renderer[5];
      equation = getStyle(equationOriginal, quality, renderer, isInline, worked, red, green, blue);
      // console.log(rendererType, "Texrendr", rendererType == "Texrendr")
      if (rendererType == "Texrendr") {
        // console.log("Used texrendr", equation, equation.replace("%5C%5C", "%0D"))
        equation = equation.split("%A0").join("%0D"); //.replace("%5C%5C", "%0D") .replace("%C2%AD", "%0D")
      } else if (rendererType == "Codecogs") {
        // console.log("Used Codecogs", equation, equation.split("%5C%5C%5C%5C").join("%5C%5C"))
        equation = equation
          .split("%5C%5C%5C%5C").join("%5C%5C")
          .replace("~", "%5C,%5C,"); // https://github.com/Divide-By-0/autolatex/issues/27
      } else if (rendererType == "Sciweavers") {
        // console.log("Used Sciweavers", equation, equation.split("%5C%5C%5C%5C").join("%5C%5C"))
        equation = equation.split("%5C%5C%5C%5C").join("%5C%5C"); //.replace("%A0", "%0D") .replace("%C2%AD", "%0D")
      }

      debugLog("Raw equation", equation);
      renderer[1] = renderer[1].split("FILENAME").join(getFilenameEncode(equation, 0));
      renderer[1] = renderer[1].split("EQUATION").join(equation);
      renderer[2] = renderer[2].split("FILENAME").join(getFilenameEncode(equation, 0)); // since mutating original object, important each is a new one
      debugLog("Link with equation", renderer[1]);
      debugLog("Title Alt Text " + renderer[2] + equationOriginal + "#" + delim[6]);
      debugLog("Cached equation: " + renderer[2] + renderer[6] + equation);
      reportDeltaTime(453);
      console.log("Fetching ", renderer[1], " and ", renderer[2] + renderer[6] + equation);

      const _createFileInCache = UrlFetchApp.fetch(renderer[2] + renderer[6] + equation);
      // simulates putting text into text renderer => creates link for cached image which is accessed later
      // needed for codecogs to generate equation properly, need to figure out which other renderers need this. to test, use align* equations.

      reportDeltaTime(458, " fetching w eqn len " + equation.length + " with renderer " + rendererType);
      if (rendererType == "Codecogs" || rendererType == "Sciweavers") {
        Utilities.sleep(50); // sleep 50ms to let codecogs put the equation in its cache
      }
      resp = UrlFetchApp.fetch(renderer[1]);
      debugLog(resp, resp.getBlob(), escape(resp.getBlob().getDataAsString()).substring(0, 50));
      deltaTime = reportDeltaTime(470, " equation link length " + renderer[1].length + " and renderer  " + rendererType);
      console.log("Hash ", escape(resp.getBlob().getDataAsString()).substring(0, 50));
      if (!escape(resp.getBlob().getDataAsString())) {
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
        console.log("Invalid Codecogs Equation! Times: " + failedCodecogs + failedTexrendr);
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
          if (failedResp)
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
      deltaTime = reportDeltaTime(533, " failed equation link length " + renderer![1].length + " and renderer  " + rendererType);
      if (rendererType == "Texrendr") {
        // equation.indexOf("align")==-1 &&  removed since align now supported
        console.log("Texrendr likely down, deprioritized!");
        texrendrDown = 1;
      }
    }
    if (failure == 0) break;
  }

  return {
    resp,
    renderer,
    rendererType,
    worked,
    equation
  }
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
  //  order of execution ID, image URL, editing URL, in-line commandAt the beginning, in-line command at and, Human name, the part that gets rendered in browser in the fake call but not in the link(No Machine name substring)
  let codeCogsPriority = 1;
  let sciWeaverPriority = 5;
  let texRenderPriority = 4;
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
  } // to de render possibly very old equations
  else
    return [13, "https://latex.codecogs.com/png.latex?%5Cdpi%7B900%7DEQUATION", "https://www.codecogs.com/eqnedit.php?latex=", "%5Cinline%20", "", "Codecogs", "%5Cdpi%7B900%7D"];
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
  let worked = 1;
  let found = 0;
  let renderer: string[] = [];
  for (; worked <= capableDerenderers; ++worked) {
    //[3,"https://latex.codecogs.com/png.latex?","http://www.codecogs.com/eqnedit.php?latex=","%5Cinline%20", "", "Codecogs"]
    renderer = getRenderer(worked)[2].split("FILENAME"); //list of possibly more than one string
    for (let I = 0; I < renderer.length; ++I) {
      if (origURL.indexOf(renderer[I]) > -1) {
        debugLog("Changing: " + origURL + " by removing " + renderer[I]);
        origURL = origURL.substring(origURL.indexOf(renderer[I])).split(renderer[I]).join(""); //removes prefix
        found = 1;
        debugLog("Next check: " + origURL + " for " + renderer[I + 1]);
      } else break;
    }
  }
  if (found == 0) {
    console.log("Not an equation link! " + origURL, origURL.indexOf(renderer[0]), origURL.indexOf(renderer[1]));
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
