/* global google, $ */

/// <reference path="../types/docs-types/index.d.ts" />
/// <reference path="../types/common-types/index.d.ts" />
/// <reference lib="dom" />

window.MathJax = {
  loader: { load: ['tex-svg', '[tex]/color'] },
  tex: { packages: { '[+]': ['color'] } },
  svg: {
    fontCache: 'none'
  },
  startup: {
    typeset: false // Prevent auto-typesetting
  },
  options: {
    enableAssistiveMml: false
  }
};

// animation timeout ID
let runDots = -1;

/**
* Convert a Blob to a base64 string for transmission to the server
* 
* @param blob the blob to convert
* @returns 
*/
async function blobToB64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(blob);
  });
  return dataUrl.substring(dataUrl.indexOf(",") + 1); // strip dataurl header
}

async function renderMathJaxEquation(renderOptions: AutoLatexCommon.ClientRenderOptions) {
  // apply RGB coloring + newline becomes \\
  const equation = `\\color[RGB]{${renderOptions.r},${renderOptions.g},${renderOptions.b}}` + renderOptions.equation.replace(/\n|\r|\r\n/g, "\\\\");
  
  
  const result = await window.MathJax.tex2svgPromise(equation, {
    display: !renderOptions.inline,
    em: renderOptions.size
  });
  const svg: SVGSVGElement = result.querySelector("svg");
  
  // calculate width and height by rendering this svg with the specified font size
  svg.classList.add("mathjax-equation-hidden-render")
  svg.style.fontSize = `${renderOptions.size}px`;
  document.body.appendChild(svg);
  
  // scale up by 5
  const width = svg.clientWidth * 5;
  const height = svg.clientHeight * 5;
  
  svg.remove();
  
  // set width/height explicitly on the svg
  svg.setAttribute("width", `${width}px`);
  svg.setAttribute("height", `${height}px`);
  
  const styles = MathJax.svgStylesheet().outerHTML;
  
  // create a URL for this svg
  const svgString = new XMLSerializer().serializeToString(svg)
    // inject css
    .replace("</svg>", styles + "</svg>");
  const svgBlob = new Blob([svgString], {
    type: "image/svg+xml"
  });
  
  const svgUrl = URL.createObjectURL(svgBlob);
  
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  
  try {
    // load this svg on an image
    const svgImage = new Image(width, height);
    svgImage.src = svgUrl;
    // wait for load
    await new Promise<void>((resolve, reject) => {
      svgImage.onload = () => resolve();
      svgImage.onerror = err => reject(err);
    });
    
    // draw onto canvas
    ctx.drawImage(svgImage, 0, 0);
    
    const pngBlob = await canvas.convertToBlob({
      type: "image/png"
    });
    return pngBlob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
  // TODO: error handling
}

/**
 * On document load, assign click handlers to each button. Added document.ready.
 */
$('document').ready(function(){
  $(function() {
      google.script.run.withSuccessHandler(loadPreferences)
          .withFailureHandler(showError).getPrefs();
      $('#insert-text').click(insertText);
      $('#edit-text').click(editText);
      $('#undo-all').click(undoAll);
      $('#renderList').click(showRenderDropdown);
  });
});

function showRenderDropdown() {
    $('#renderList').toggleClass('show');
}

function runDotAnimation() {
  return setInterval(function() {
    if ($("#loading").html().length >= 18) 
      $("#loading").html("Status: Loading");
    else
      $("#loading").html($("#loading").text()+'.');
  }, 300);
}

function getCurrentSettings() {
  const sizeRaw = $('#size :selected').val() as string;
  const delimiter = $('#delimit :selected').val() as string;
  return {sizeRaw, delimiter};
}

//$('donate_button').on("click",function(e){e.preventDefault;}); // for paypal to disable sidebar disappearing

// Close the dropdown menu if the user clicks outside of it
window.onclick = function(event) {
  if (!event.target.matches('.dropbtn')) {
    document.querySelectorAll(".dropdown-content.show").forEach(openDropdown => openDropdown.classList.remove('show'));
  }
}
$("#advanced").click(function(event){//.live({click:
  event.preventDefault();
  $("#divDelimiters").attr("style", function(i, origValue){
    if(origValue == "display: block;"){
      $("#advanced").text("Show Advanced Settings");
      return "display: none;";
    }
    else{
      $("#advanced").text("Hide Advanced Settings");
      return "display: block;";
    }
  });
});

function loadPreferences(choicePrefs: {size: string, delim: string}) {
  $('#insert-text').prop("disabled", true);
  $('#edit-text').prop("disabled", true);
  $('#undo-all').prop("disabled", true);
  $('#size').val(choicePrefs.size);
  $('#delimit').val(choicePrefs.delim);
  $('#insert-text').prop("disabled", false);
  $('#edit-text').prop("disabled", false);
  $('#undo-all').prop("disabled", false);
}

function makeStatusText(successCount: number) {
  if (successCount == 0) return "Status: No equations rendered";
  else if (successCount == 1) return "Status: 1 equation rendered";
  else return `Status: ${successCount} equations rendered`;
}

function successHandler({ lastStatus, successCount, clientEquations }: { lastStatus: google.script.DocsEquationRenderStatus, successCount: number, clientEquations?: AutoLatexCommon.ClientRenderOptions[] }, element: HTMLButtonElement) {
  if (lastStatus === google.script.DocsEquationRenderStatus.ClientRender) {
    // we're not done yet - these equations need to be rendered on the client
    Promise.all(clientEquations.map(async c => ({ options: c, renderedEquationB64: await renderMathJaxEquation(c).then(b => blobToB64(b)) })))
      .then(rendered => {
        google.script.run
          .withSuccessHandler(successHandler)
          .withFailureHandler(errorHandler)
          .withUserObject(element)
          .clientRenderComplete(rendered);
      });
  } else {
    $("#loading").html('');
    clearInterval(runDots);
    element.disabled = false;
    
    const statusText = makeStatusText(successCount);
    
    if (lastStatus === google.script.DocsEquationRenderStatus.NoDocument)
      showError("Sorry, the script has conflicting authorizations. Try signing out of other active Gsuite accounts.", statusText);
    else if (lastStatus === google.script.DocsEquationRenderStatus.AllRenderersFailed && successCount > 0)
      showError("Sorry, an equation is incorrect, or (temporarily) unavailable commands (i.e. align, &) were used.", statusText);
    else if (lastStatus === google.script.DocsEquationRenderStatus.AllRenderersFailed && successCount === 0)
      showError("Sorry, likely (temporarily) unavailable commands (i.e. align, &) were used or the equation was too long.", statusText);
    else {
      $("#loading").html(statusText);
    }
  }
}

function errorHandler(msg, element) {
  $("#loading").html('');
  clearInterval(runDots);
  console.error("Error console errored!", msg, element)
  showError("Please ensure your equations are surrounded by $$ on both sides (or \\[ and an \\]), without any enters in between, or reload the page. If authorization required, try signing out of other google accounts.", "Status: Error, please reload.");
  element.disabled = false;
}
  
function insertText(){ 
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  runDots = runDotAnimation();
  const {sizeRaw, delimiter} = getCurrentSettings();

  google.script.run
    .withSuccessHandler(successHandler)
    .withFailureHandler(errorHandler)
    .withUserObject(this)
    .replaceEquations(sizeRaw, delimiter, document.querySelector<HTMLInputElement>("#input-use-mathjax").checked);
}
    
    
function editText(){
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  
  runDots = runDotAnimation();
  const {sizeRaw, delimiter} = getCurrentSettings();
  google.script.run
    .withSuccessHandler(
      function(returnSuccess: AutoLatexCommon.DerenderResult, element) {
        $("#loading").html('');
        clearInterval(runDots);
        element.disabled = false;
        $("#loading").html("Status: " + "1"             + " equation replaced.");
        if(returnSuccess < 0)
          $("#loading").html("Status: " + "No"          + " equations replaced.");

        switch (returnSuccess) {
          case AutoLatexCommon.DerenderResult.InvalidUrl:
            showError("Cannot retrieve equation. The equation may not have been rendered by Auto-LaTeX.", "Status: Error, please ensure link is still on equation.");
            break;
          case AutoLatexCommon.DerenderResult.NullUrl:
            showError("Cannot retrieve equation. Is your cursor before an Auto-LaTeX rendered equation?", "Status: Error, please ensure link is still on equation.");
            break;
          case AutoLatexCommon.DerenderResult.EmptyEquation:
            showError("Cannot retrieve equation. Is your cursor before an Auto-LaTeX rendered equation?", "Status: Error, please move cursor before inline equation.");
            break;
          case AutoLatexCommon.DerenderResult.NonExistentElement:
            showError("Cannot insert text here. Is your cursor before an equation?", "Status: Error, please move cursor before equation.");
            break;
          case AutoLatexCommon.DerenderResult.CursorNotFound:
            showError("Cannot find a cursor/equation. Please click before an equation.", "Status: Error, please move cursor before equation.");
            break;
          case AutoLatexCommon.DerenderResult.Success:
          default:
            $("#loading").html("Status: 1 equation de-rendered.");
            break;
        }
      })
    .withFailureHandler(
      function(msg, element) {
        $("#loading").html('');
        clearInterval(runDots);
        showError("Please ensure cursor is immediately before the equation to be derendered.", "Status: Error, please move cursor before equation.");
        element.disabled = false;
      })
    .withUserObject(this)
    .editEquations(sizeRaw, delimiter);
}

    
function undoAll(){
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  //var div = $('<div id="clickmsg" class="text">' + 'Ctrl + q detected' + '</div>');
  //$('#button-bar').after(div);
  
  runDots = runDotAnimation();
  const {delimiter} = getCurrentSettings();
  google.script.run
  .withSuccessHandler(
    function(returnSuccess: number, element) {
      $("#loading").html('');
      clearInterval(runDots);
      element.disabled = false;
      $("#loading").html("Status: " + 0 + " equations de-rendered.");
      if(returnSuccess < 0){
        $("#loading").html("Status: " + "No"          + " equations de-rendered.");
        showError("Cannot find any equations.", "Status: Error, please move cursor before equation.");
      }
      else if(returnSuccess == 0)
        $("#loading").html("Status: " + "No"          + " equations found to de-render.");
      else if(returnSuccess == 1)
        $("#loading").html("Status: " + returnSuccess + " equation de-rendered.");
      else
        $("#loading").html("Status: " + returnSuccess + " equations de-rendered.");
    })
  .withFailureHandler(
    function(msg, element) {
      $("#loading").html('');
      clearInterval(runDots);
      showError("Please ensure cursor is inside document.", "Status: Error, please move cursor into document.");
      element.disabled = false;
    })
  .withUserObject(this)
  .removeAll(delimiter);
}

//ctrl+m to show developer key
$(document).keydown(function(e){ 
  if((e.ctrlKey && e.keyCode == 77)){
    $('#error').remove();
    
    google.script.run.withSuccessHandler(
      function(msg) {
        console.error('myFunction() yielded an error: ' + msg);
        $("#loading").html("Dev key for debugging: " + msg); //ADQsr0ZOimwdc5HmC+UsixLRc3UcLUweHoxoGd9uDOdSv9LgENOI11dsB9A0Jd2lNQI2PSrx3x0C

      })
    .withFailureHandler(
      function(msg) {
        $("#loading").html("Dev failed key for debugging: " + msg);
      })
    .withUserObject(this)
    .getKey();
  }
});

// Supposed to take keyboard shortcuts, but only local.
$(document).keydown(function(e){
  if((e.ctrlKey && e.keyCode == 81)){
    $('#error').remove();
    $("#loading").html("Status: Loading");
    //var div = $('<div id="clickmsg" class="text">' + 'Ctrl + q detected' + '</div>');
    //$('#button-bar').after(div);
    
    runDots = runDotAnimation();
    const {delimiter} = getCurrentSettings();
    google.script.run
    .withSuccessHandler(
      function(returnSuccess) {
        $("#loading").html('');
        clearInterval(runDots);
        $("#loading").html("Status: " + 0 + " equations de-rendered.");
        if(returnSuccess < 0){
          $("#loading").html("Status: " + "No"          + " equations de-rendered.");
          showError("Cannot find any equations.", "Status: Error, please move cursor before equation.");
        }
        else if(returnSuccess == 0)
          $("#loading").html("Status: " + "No"          + " equations found to de-render.");
        else if(returnSuccess == 1)
          $("#loading").html("Status: " + returnSuccess + " equation de-rendered.");
        else
          $("#loading").html("Status: " + returnSuccess + " equations de-rendered.");
      })
    .withFailureHandler(
      function() {
        $("#loading").html('');
        clearInterval(runDots);
        showError("Please ensure cursor is inside document.", "Status: Error, please move cursor into document.");
      })
    .removeAll(delimiter);
  }
});

/**
 * Inserts a div that contains an error message after a given element.
 *
 * @param msg1 The status to display.
 * @param msg2 The error message to display.
 */
function showError(msg1: any, msg2: any) {//CHANGE TO OTHER DIV WHEN PUBLISHING
  //var div = $('<div id="error" class="error">' + msg + '</div>');
  var div = $('<div id="error" class="error">' + msg1  + '</div>');
  $('#loading').after(div);
  $('#loading').html(msg2);
}
