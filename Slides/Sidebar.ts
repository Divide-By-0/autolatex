/* global google, $ */

/// <reference types="jquery" />
/// <reference path="../types/slides-types/index.d.ts" />
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


// REASON: mirrors the Docs sidebar's client-error reporting so MathJax failures in
// Slides reach Cloud Logging with the offending equation; without it they vanished
// in the sandboxed iframe. Deduped per session to keep error-path ingestion tiny.
const reportedMathJaxErrors = new Set<string>();
function reportMathJaxClientError(context: string, error: unknown, extra: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const dedupeKey = `${context}:${message}`;
  if (reportedMathJaxErrors.has(dedupeKey)) {
    return;
  }
  reportedMathJaxErrors.add(dedupeKey);
  const payload = {
    context,
    error: { message, stack: error instanceof Error ? error.stack || "" : "" },
    extra,
    href: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  };
  (google.script.run as any)
    .withFailureHandler((logError: unknown) => console.error("Failed to report MathJax client error.", logError))
    .logMathJaxClientError(JSON.stringify(payload));
}

interface SlidesClientRenderOptions {
  size: number;
  inline: boolean;
  r: number;
  g: number;
  b: number;
  bgR?: number;
  bgG?: number;
  bgB?: number;
  delim: AutoLatexCommon.Delimiter;
  equation: string;
  equationLinkEncoded: string;
  slideId: string;
  pageElementId: string;
  tableRow?: number;
  tableColumn?: number;
  rangeStart: number;
  rangeEnd: number;
}

interface SlidesClientEquationRenderResult {
  lastStatus: SlidesClientRenderStatus;
  successCount: number;
  clientEquations?: SlidesClientRenderOptions[];
}

const enum SlidesClientRenderStatus {
  AllRenderersFailed,
  ClientRender,
  NoPresentation,
  Success,
  // REASON: Must mirror Code.ts SlidesEquationRenderStatus exactly. const enums get
  // inlined as numbers per file at compile time, so the order here has to match the
  // server-side definition or values arriving via google.script.run will be misread.
  AuthorizationFailed,
}

function isSlidesEquationRenderResult(value: unknown): value is SlidesClientEquationRenderResult {
  return typeof value === "object" && value !== null && "lastStatus" in value;
}

function makeSlidesRenderStatusText(renderCount: number) {
  if (renderCount == 0)
    return "Status: No equations rendered";
  else if (renderCount == 1)
    return "Status: 1 equation rendered";
  return `Status: ${renderCount} equations rendered`;
}

// Shared MathJax machinery (mapWithConcurrency, blobToB64, MATHJAX_CONCURRENCY_LIMIT,
// renderEquationPngWithMathJax) is implemented in ../SidebarMathJaxShared.ts and
// injected ahead of this file by BuildSidebarJS.js.
declare const MATHJAX_CONCURRENCY_LIMIT: number;
declare function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]>;
declare function blobToB64(blob: Blob): Promise<string>;
declare function renderEquationPngWithMathJax(
  renderOptions: { equation: string; inline: boolean; size: number; r: number; g: number; b: number; bgR?: number; bgG?: number; bgB?: number },
  reportError?: (context: string, error: unknown, extra?: Record<string, unknown>) => void
): Promise<Blob>;

async function renderMathJaxEquation(renderOptions: SlidesClientRenderOptions) {
  return renderEquationPngWithMathJax(renderOptions, reportMathJaxClientError);
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
  // REASON: Older users may have Codecogs saved from when it was the practical default.
  // Open the sidebar on Automatic so Codecogs outages don't keep affecting them.
  const rendererPreference = choicePrefs.renderer === "codecogs" ? "auto" : choicePrefs.renderer;
  const savedRenderer = ["auto", "mathjax", "texrendr", "sciweavers"].includes(rendererPreference) ? rendererPreference : "auto";
  $('#renderer').val(savedRenderer);
  $('#insert-text').prop("disabled", false);
  $('#edit-text').prop("disabled", false);
  $('#undo-all').prop("disabled", false);
}
  
function insertText(){ 
  // console.log("TEST insertText");
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  const runDots = runDotAnimation();
  const {sizeRaw, delimiter, renderer} = getCurrentSettings();
  let mathJaxRenderedCount = 0;

  const finishNumericRender = function(returnSuccess: number, element: HTMLButtonElement) {
    $("#loading").html('');
    clearInterval(runDots);
    element.disabled = false;
    console.log(returnSuccess);
    let flag = 0;
    let renderCount = 1;
    if(returnSuccess < -1){
      flag = -2;
      renderCount = -2 - returnSuccess;
    }
    else if(returnSuccess == -1){
      flag = -1;
      renderCount = 0;
    }
    else{
      flag = 0;
      renderCount = returnSuccess;
    }
    if(flag == -1)
      showError("Sorry, the script has conflicting authorizations. Try signing out of other active Gsuite accounts.", "Status: " + renderCount +  " equations replaced");
    else if(flag == -2 && renderCount > 0)
      showError("Sorry, the equation is too long or another problem occurred.", "Status: " + renderCount +  " equations replaced");
    else if(flag == -2 && renderCount == 0)
      showError("Sorry, the renderers are down, an equation is too long, or an equation is misformed.", "Status: " + renderCount +  " equations replaced");
    else if(flag == 0 && renderCount == 0)
      $("#loading").html("Status: " + "No"          + " equations rendered");
    else if(flag == 0 && renderCount == 1)
      $("#loading").html("Status: " + renderCount + " equation rendered" );
    else
      $("#loading").html("Status: " + renderCount + " equations rendered");
  };

  const finishMathJaxRender = function(result: SlidesClientEquationRenderResult, element: HTMLButtonElement) {
    $("#loading").html('');
    clearInterval(runDots);
    element.disabled = false;

    const statusText = makeSlidesRenderStatusText(mathJaxRenderedCount);
    if (result.lastStatus === SlidesClientRenderStatus.NoPresentation)
      showError("Sorry, the script has conflicting authorizations. Try signing out of other active Gsuite accounts.", statusText);
    else if (result.lastStatus === SlidesClientRenderStatus.AuthorizationFailed)
      showError("<strong>Auto-LaTeX is missing permission to call external renderers.</strong> Try uninstalling and reinstalling the add-on, then click 'Select all' on the permissions screen. The equation may be valid; Google has not granted the add-on external request access yet.", statusText);
    else if (result.lastStatus === SlidesClientRenderStatus.AllRenderersFailed && mathJaxRenderedCount > 0)
      showError("Sorry, the equation is too long or another problem occurred.", statusText);
    else if (result.lastStatus === SlidesClientRenderStatus.AllRenderersFailed && mathJaxRenderedCount === 0)
      showError("Sorry, the renderers are down, an equation is too long, or an equation is misformed.", statusText);
    else
      $("#loading").html(statusText);
  };

  const handleFailure = function(msg: unknown, element: HTMLButtonElement) {
    $("#loading").html('');
    clearInterval(runDots);
    console.error("Error console errored!", msg, element);
    showError("Please ensure your equations are surrounded by $$ on both sides (or \\[ and an \\]), without any enters in between, or reload the page.", "Status: Error, please reload.");
    element.disabled = false;
  };

  const requestNextMathJaxBatch = function(element: HTMLButtonElement) {
    google.script.run
      .withSuccessHandler((response, userObject) => handleSuccess(response, userObject as HTMLButtonElement))
      .withFailureHandler((msg, userObject) => handleFailure(msg, userObject as HTMLButtonElement))
      .withUserObject(element)
      .replaceEquations(sizeRaw, delimiter, renderer);
  };

  const handleMathJaxResponse = function(result: SlidesClientEquationRenderResult, element: HTMLButtonElement) {
    if (result.lastStatus === SlidesClientRenderStatus.ClientRender) {
      const equationsToRender = result.clientEquations || [];
      if (equationsToRender.length === 0) {
        finishMathJaxRender({
          lastStatus: SlidesClientRenderStatus.AllRenderersFailed,
          successCount: 0
        }, element);
        return;
      }

      // REASON: Carry forward any successes the server included with this ClientRender batch.
      mathJaxRenderedCount += result.successCount;

      // REASON: Render equations independently. A single MathJax failure should not force
      // the whole batch through legacy server renderers that cannot preserve Unicode text.
      mapWithConcurrency(equationsToRender, MATHJAX_CONCURRENCY_LIMIT, async eq => {
        try {
          return {
            ok: true as const,
            rendered: {
              options: eq,
              renderedEquationB64: await renderMathJaxEquation(eq).then(blob => blobToB64(blob))
            }
          };
        } catch (error) {
          reportMathJaxClientError("clientRenderEquation", error, {
            equation: eq.equation,
            equationLength: eq.equation.length
          });
          return {
            ok: false as const,
            options: eq
          };
        }
      })
        .then(results => {
          const rendered = results
            .filter(result => result.ok)
            .map(result => result.rendered);
          const failed = results
            .filter(result => !result.ok)
            .map(result => ({ options: result.options }));
          // REASON: In auto mode, equations MathJax couldn't render fall back to the
          // server-side renderers (Texrendr/Sciweavers) per equation, so one bad
          // equation neither kills the batch (PR #61's concern) nor resends already-
          // rendered equations to the server (the pre-#61 whole-batch fallback).
          const handleFailedSet = () => {
            if (renderer === "auto") {
              (google.script.run as any)
                .withSuccessHandler((response: SlidesClientEquationRenderResult, userObject: HTMLButtonElement) => handleMathJaxResponse(response, userObject))
                .withFailureHandler((msg: unknown, userObject: HTMLButtonElement) => handleFailure(msg, userObject))
                .withUserObject(element)
                .clientRenderFailed(failed);
            } else {
              handleFailure(new Error(`MathJax failed to render ${failed.length} equation(s).`), element);
            }
          };

          if (rendered.length > 0) {
            (google.script.run as any)
              .withSuccessHandler((response: SlidesClientEquationRenderResult, userObject: HTMLButtonElement) => {
                if (failed.length > 0) {
                  // REASON: This round's response won't pass through handleMathJaxResponse
                  // (the failed subset still needs the server round-trip), so fold its
                  // successes into the running count to keep the final summary accurate.
                  mathJaxRenderedCount += response.successCount || 0;
                  handleFailedSet();
                  return;
                }
                handleMathJaxResponse(response, userObject);
              })
              .withFailureHandler((msg: unknown, userObject: HTMLButtonElement) => handleFailure(msg, userObject))
              .withUserObject(element)
              .clientRenderComplete(rendered);
            return;
          }

          if (failed.length > 0) {
            handleFailedSet();
            return;
          }

          handleFailure(new Error("MathJax did not render any equations."), element);
        })
        .catch(error => {
          // Unexpected machinery failure — per-equation render errors are already
          // caught and reported above, so don't retry anything here.
          reportMathJaxClientError("clientRenderBatch", error, {
            equationCount: equationsToRender.length,
            // full equations so the failure is reproducible from logs alone
            equations: equationsToRender.map(eq => eq.equation),
          });
          handleFailure(error, element);
        });
      return;
    }

    mathJaxRenderedCount += result.successCount;
    if (result.lastStatus === SlidesClientRenderStatus.Success && result.successCount > 0) {
      requestNextMathJaxBatch(element);
      return;
    }

    finishMathJaxRender(result, element);
  };

  const handleSuccess = function(returnSuccess: number | SlidesClientEquationRenderResult, element: HTMLButtonElement) {
    // REASON: In auto mode, server returns object responses (like MathJax mode) for the one-at-a-time flow.
    if ((renderer === "mathjax" || renderer === "auto") && isSlidesEquationRenderResult(returnSuccess)) {
      handleMathJaxResponse(returnSuccess, element);
      return;
    }
    finishNumericRender(returnSuccess as number, element);
  };

  google.script.run
    .withSuccessHandler((returnSuccess, element) => handleSuccess(returnSuccess, element as HTMLButtonElement))
    .withFailureHandler((msg, element) => handleFailure(msg, element as HTMLButtonElement))
    .withUserObject(this)
    .replaceEquations(sizeRaw, delimiter, renderer);
}
    
    
function editText(){
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  
  const runDots = runDotAnimation();
  const {sizeRaw, delimiter, renderer} = getCurrentSettings();
  google.script.run
    .withSuccessHandler(
      function(returnSuccess: { result: AutoLatexCommon.DerenderResult, successCount: number }, element) {
        $("#loading").html('');
        clearInterval(runDots);
        element.disabled = false;

          switch (returnSuccess.result) {
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
              showError("No image found in your selection. Click the rendered equation image (shift-click to select several) and try again.", "Status: Error, please select the equation image.");
              break;
            case AutoLatexCommon.DerenderResult.CursorNotFound:
              showError("Nothing is selected. Click the rendered equation image (shift-click to select several) and try again.", "Status: Error, please select the equation image.");
              break;
            case AutoLatexCommon.DerenderResult.Success:
            default: {
              const n = returnSuccess.successCount || 1;
              $("#loading").html(`Status: ${n} equation${n === 1 ? "" : "s"} de-rendered.`);
              break;
            }
          }
      })
    .withFailureHandler(
      function(msg, element) {
        $("#loading").html('');
        clearInterval(runDots);
        showError("Please select equation image to be derendered.", "Status: Error, please select equation to be derendered.");
        element.disabled = false;
    })
    .withUserObject(this)
    .editEquations(sizeRaw, delimiter, renderer);
}

    
function undoAll(){
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  //var div = $('<div id="clickmsg" class="text">' + 'Ctrl + q detected' + '</div>');
  //$('#button-bar').after(div);
  
  const runDots = runDotAnimation();
  const {delimiter} = getCurrentSettings();
  google.script.run
  .withSuccessHandler(
    function(returnSuccess, element) {
      $("#loading").html('');
      clearInterval(runDots);
      element.disabled = false;
      $("#loading").html("Status: " + 0 + " equations de-rendered.");
      if(returnSuccess < 0){
        $("#loading").html("Status: " + "No"          + " equations de-rendered.");
        showError("Cannot find any equations.", "Status: Error, please click equation image.");
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
      showError("Please select image.", "Status: Error, please select image.");
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
    
    const runDots = runDotAnimation();
    const {delimiter} = getCurrentSettings();
    google.script.run
    .withSuccessHandler(
      function(returnSuccess) {
        $("#loading").html('');
        clearInterval(runDots);
        $("#loading").html("Status: " + 0 + " equations de-rendered.");
        if(returnSuccess < 0){
          $("#loading").html("Status: " + "No"          + " equations de-rendered.");
          showError("Cannot find any equations.", "Status: Error, please select image.");
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
        showError("Please select image.", "Status: Error, please select image.");
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
