/* global google, $ */

/// <reference types="jquery" />
/// <reference path="../types/docs-types/index.d.ts" />
/// <reference path="../types/common-types/index.d.ts" />
/// <reference lib="dom" />

interface MathJaxApi {
  tex2svgPromise(equation: string, options: { display: boolean, em: number }): Promise<Element>;
  svgStylesheet(): Element;
}

interface Window {
  MathJax: MathJaxApi;
}

declare const MathJax: MathJaxApi;

// animation timeout ID
let runDots = -1;
const reportedMathJaxErrors = new Set<string>();
let isMathJaxRenderChaining = false;
let mathJaxRenderedCount = 0;
let activeSidebarActionId = 0;
const RENDER_BUTTON_LABEL = "Render Equations";
const STOP_RENDER_BUTTON_LABEL = "Stop Rendering";
const DONATE_CLICKED_STORAGE_KEY = "ale-docs-donate-clicked";

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack || "",
    };
  }
  if (typeof error === "string") {
    return {
      message: error,
      name: "Error",
      stack: "",
    };
  }
  try {
    return {
      message: JSON.stringify(error),
      name: "UnknownError",
      stack: "",
    };
  } catch {
    return {
      message: String(error),
      name: "UnknownError",
      stack: "",
    };
  }
}

function shouldLogMathJaxErrors() {
  try {
    const renderer = getCurrentSettings().renderer;
    return renderer === "mathjax" || renderer === "auto";
  } catch {
    return false;
  }
}

function resetMathJaxRenderProgress() {
  isMathJaxRenderChaining = false;
  mathJaxRenderedCount = 0;
}

function stopLoadingAnimation() {
  if (runDots !== -1) {
    clearInterval(runDots);
    runDots = -1;
  }
}

function setRenderButtonState(isStopping: boolean) {
  $('#insert-text')
    .text(isStopping ? STOP_RENDER_BUTTON_LABEL : RENDER_BUTTON_LABEL)
    .prop("disabled", false);
}

function enableSidebarButtons() {
  $('#insert-text').prop("disabled", false);
  $('#edit-text').prop("disabled", false);
  $('#undo-all').prop("disabled", false);
}

function restoreIdleSidebarControls() {
  stopLoadingAnimation();
  enableSidebarButtons();
  setRenderButtonState(false);
}

function cancelActiveMathJaxRender(showStatus = true) {
  if (!isMathJaxRenderChaining) {
    return false;
  }
  activeSidebarActionId += 1;
  resetMathJaxRenderProgress();
  restoreIdleSidebarControls();
  if (showStatus) {
    $('#error').remove();
    $("#loading").html("Status: Rendering stopped.");
  }
  return true;
}

function beginSidebarAction() {
  activeSidebarActionId += 1;
  stopLoadingAnimation();
  enableSidebarButtons();
  $('#error').remove();
  $("#loading").html("Status: Loading");
  runDots = runDotAnimation();
  return activeSidebarActionId;
}

function isStaleSidebarAction(actionId: number) {
  return actionId !== activeSidebarActionId;
}

function hasClickedDonateButton() {
  try {
    return window.localStorage.getItem(DONATE_CLICKED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistDonateButtonClicked() {
  try {
    window.localStorage.setItem(DONATE_CLICKED_STORAGE_KEY, "true");
  } catch {
    // ignore storage issues and keep current-session UI state
  }
  syncDonateButtonPlacement();
}

function syncDonateButtonPlacement() {
  const showInline = hasClickedDonateButton();
  $('#donate-inline').toggleClass('visible', showInline);
  $('#donate-pinned').toggleClass('hidden', showInline);
}

function reportMathJaxClientError(context: string, error: unknown, extra: Record<string, unknown> = {}) {
  if (!shouldLogMathJaxErrors()) {
    return;
  }

  const normalizedError = normalizeError(error);
  const dedupeKey = `${context}:${normalizedError.message}`;
  if (reportedMathJaxErrors.has(dedupeKey)) {
    return;
  }
  reportedMathJaxErrors.add(dedupeKey);

  const payload = {
    context,
    error: normalizedError,
    extra,
    href: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  };

  google.script.run
    .withFailureHandler(logError => console.error("Failed to report MathJax client error.", logError))
    .logMathJaxClientError(JSON.stringify(payload));
}

function requestNextMathJaxBatch(element: HTMLButtonElement, actionId: number) {
  if (isStaleSidebarAction(actionId)) {
    return;
  }
  const { sizeRaw, delimiter, renderer } = getCurrentSettings();
  google.script.run
    .withSuccessHandler((result, userObject) => successHandler(result, userObject, actionId))
    .withFailureHandler((msg, userObject) => errorHandler(msg, userObject, actionId))
    .withUserObject(element)
    .replaceEquations(sizeRaw, delimiter, renderer);
}

window.addEventListener("error", event => {
  if (event.error || shouldLogMathJaxErrors()) {
    reportMathJaxClientError("window.error", event.error || event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  }
});

window.addEventListener("unhandledrejection", event => {
  reportMathJaxClientError("window.unhandledrejection", event.reason);
});

// REASON: MathJax rendering is CPU-heavy (SVG → canvas → PNG). Running too many in parallel
// (e.g. 1000 equations) would freeze the browser. This limits concurrency to a safe number.
const MATHJAX_CONCURRENCY_LIMIT = 4;

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

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
  
  if (!window.MathJax || typeof window.MathJax.tex2svgPromise !== "function") {
    throw new Error("MathJax is still loading. Please try again in a moment.");
  }

  const result = await window.MathJax.tex2svgPromise(equation, {
    display: !renderOptions.inline,
    em: renderOptions.size
  });
  const svg: SVGSVGElement = result.querySelector("svg");
  if (!svg) {
    throw new Error("MathJax did not return an SVG element.");
  }
  
  // calculate width and height by rendering this svg with the specified font size
  svg.classList.add("mathjax-equation-hidden-render");
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
  
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not initialize a 2D canvas for MathJax rendering.");
  }
  
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
    
    const pngBlob = "convertToBlob" in canvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob(blob => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Could not convert MathJax canvas to a PNG blob."));
            }
          }, "image/png");
        });
    return pngBlob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/**
 * On document load, assign click handlers to each button. Added document.ready.
 */
$('document').ready(function(){
  $(function() {
      google.script.run.withSuccessHandler(loadPreferences)
          .withFailureHandler(showError).getPrefs();
      syncDonateButtonPlacement();
      $('#donate-inline-link').click(persistDonateButtonClicked);
      $('#donate-pinned-link').click(persistDonateButtonClicked);
      $('#insert-text').click(insertText);
      $('#edit-text').click(editText);
      $('#undo-all').click(undoAll);
      $('#renderList').click(showRenderDropdown);
      $('#size').change(function(){
        if ($('#size :selected').val() === 'custom') {
          $('#custom-size').show();
        } else {
          $('#custom-size').hide();
        }
      });
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
  let sizeRaw = $('#size :selected').val() as string;
  if (sizeRaw === 'custom') {
    sizeRaw = ($('#custom-size').val() as string) || '';
  }
  const delimiter = $('#delimit :selected').val() as string;
  const renderer = $('#renderer :selected').val() as string;
  return {sizeRaw, delimiter, renderer};
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

function loadPreferences(choicePrefs: {size: string, delim: string, renderer: string}) {
  $('#insert-text').prop("disabled", true);
  $('#edit-text').prop("disabled", true);
  $('#undo-all').prop("disabled", true);
  const savedSize = choicePrefs.size;
  if (savedSize && !isNaN(parseInt(savedSize))) {
    $('#size').val('custom');
    $('#custom-size').val(savedSize).show();
  } else {
    $('#size').val(savedSize);
    $('#custom-size').hide();
  }
  $('#delimit').val(choicePrefs.delim);
  const savedRenderer = ["auto", "codecogs", "mathjax", "texrendr", "sciweavers"].includes(choicePrefs.renderer) ? choicePrefs.renderer : "auto";
  $('#renderer').val(savedRenderer);
  enableSidebarButtons();
  setRenderButtonState(false);
}

function makeStatusText(successCount: number) {
  if (successCount == 0) return "Status: No equations rendered";
  else if (successCount == 1) return "Status: 1 equation rendered";
  else return `Status: ${successCount} equations rendered`;
}

function successHandler({ lastStatus, successCount, clientEquations }: { lastStatus: google.script.DocsEquationRenderStatus, successCount: number, clientEquations?: AutoLatexCommon.ClientRenderOptions[] }, element: HTMLButtonElement, actionId: number) {
  if (isStaleSidebarAction(actionId)) {
    return;
  }
  if (lastStatus === google.script.DocsEquationRenderStatus.ClientRender) {
    // REASON: In auto mode, enable chaining lazily when we first need client rendering.
    // This avoids an unnecessary extra round-trip when all equations succeed with Codecogs.
    if (!isMathJaxRenderChaining) {
      isMathJaxRenderChaining = true;
      mathJaxRenderedCount = successCount; // count any server-side (Codecogs) successes
      setRenderButtonState(true);
    }

    // we're not done yet - these equations need to be rendered on the client
    const equationsToRender = clientEquations || [];
    mapWithConcurrency(equationsToRender, MATHJAX_CONCURRENCY_LIMIT, async c => ({ options: c, renderedEquationB64: await renderMathJaxEquation(c).then(b => blobToB64(b)) }))
      .then(rendered => {
        if (isStaleSidebarAction(actionId)) {
          return;
        }
        google.script.run
          .withSuccessHandler((result, userObject) => successHandler(result, userObject, actionId))
          .withFailureHandler((msg, userObject) => errorHandler(msg, userObject, actionId))
          .withUserObject(element)
          .clientRenderComplete(rendered);
      })
      .catch(err => {
        reportMathJaxClientError("clientRenderBatch", err, { equationCount: equationsToRender.length });
        // REASON: In auto mode, if MathJax fails, try remaining server renderers (Texrendr/Sciweavers)
        // instead of showing an error immediately.
        if (getCurrentSettings().renderer === "auto") {
          if (isStaleSidebarAction(actionId)) {
            return;
          }
          google.script.run
            .withSuccessHandler((result, userObject) => successHandler(result, userObject, actionId))
            .withFailureHandler((msg, userObject) => errorHandler(msg, userObject, actionId))
            .withUserObject(element)
            .clientRenderFailed(equationsToRender.map(c => ({ options: c })));
        } else {
          errorHandler(err, element, actionId);
        }
      });
  } else {
    const roundSuccessCount = successCount;
    if (isMathJaxRenderChaining) {
      mathJaxRenderedCount += roundSuccessCount;
      if (lastStatus === google.script.DocsEquationRenderStatus.Success && roundSuccessCount > 0) {
        requestNextMathJaxBatch(element, actionId);
        return;
      }
      successCount = mathJaxRenderedCount;
      resetMathJaxRenderProgress();
    }

    $("#loading").html('');
    restoreIdleSidebarControls();
    
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

function errorHandler(msg, element, actionId: number) {
  if (isStaleSidebarAction(actionId)) {
    return;
  }
  resetMathJaxRenderProgress();
  $("#loading").html('');
  restoreIdleSidebarControls();
  console.error("Error console errored!", msg, element);
  reportMathJaxClientError("sidebar.errorHandler", msg);
  showError("<strong>Ensure you clicked 'Select all' on the permissions screen. If not, try uninstalling and reinstalling the add-on to redo permissions.</strong> Please ensure your equations are surrounded by $$ on both sides (or \\[ and an \\]), without any enters in between, or reload the page. If authorization required, try signing out of other google accounts.", "Status: Error, please reload.");
}
  
function insertText(){ 
  if (cancelActiveMathJaxRender()) {
    return;
  }
  const actionId = beginSidebarAction();
  const {sizeRaw, delimiter, renderer} = getCurrentSettings();
  if (renderer === "mathjax") {
    isMathJaxRenderChaining = true;
    mathJaxRenderedCount = 0;
    setRenderButtonState(true);
  } else {
    resetMathJaxRenderProgress();
    this.disabled = true;
  }

  google.script.run
    .withSuccessHandler((result, userObject) => successHandler(result, userObject, actionId))
    .withFailureHandler((msg, userObject) => errorHandler(msg, userObject, actionId))
    .withUserObject(this)
    .replaceEquations(sizeRaw, delimiter, renderer);
}
    
    
function editText(){
  cancelActiveMathJaxRender(false);
  const actionId = beginSidebarAction();
  resetMathJaxRenderProgress();
  this.disabled = true;
  const {sizeRaw, delimiter, renderer} = getCurrentSettings();
  google.script.run
    .withSuccessHandler(
      function(returnSuccess: AutoLatexCommon.DerenderResult, element) {
        if (isStaleSidebarAction(actionId)) {
          return;
        }
        $("#loading").html('');
        restoreIdleSidebarControls();
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
        if (isStaleSidebarAction(actionId)) {
          return;
        }
        $("#loading").html('');
        restoreIdleSidebarControls();
        showError("Please ensure cursor is immediately before the equation to be derendered.", "Status: Error, please move cursor before equation.");
      })
    .withUserObject(this)
    .editEquations(sizeRaw, delimiter, renderer);
}

    
function undoAll(){
  cancelActiveMathJaxRender(false);
  const actionId = beginSidebarAction();
  resetMathJaxRenderProgress();
  this.disabled = true;
  //var div = $('<div id="clickmsg" class="text">' + 'Ctrl + q detected' + '</div>');
  //$('#button-bar').after(div);
  const {delimiter} = getCurrentSettings();
  google.script.run
  .withSuccessHandler(
    function(returnSuccess: number, element) {
      if (isStaleSidebarAction(actionId)) {
        return;
      }
      $("#loading").html('');
      restoreIdleSidebarControls();
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
      if (isStaleSidebarAction(actionId)) {
        return;
      }
      $("#loading").html('');
      restoreIdleSidebarControls();
      showError("Please ensure cursor is inside document.", "Status: Error, please move cursor into document.");
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
  //var div = $('<div id="error" class="ale-error">' + msg + '</div>');
  $('#error').remove();
  var div = $('<div id="error" class="ale-error">' + msg1  + '</div>');
  $('#loading').after(div);
  $('#loading').html(msg2);
}
