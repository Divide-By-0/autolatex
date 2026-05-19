/* global google, $ */

/// <reference types="jquery" />
/// <reference path="../types/sheets-types/index.d.ts" />
/// <reference path="../types/common-types/index.d.ts" />
/// <reference lib="dom" />

// REASON: Mirror of Docs/Sidebar.ts but with a much simpler render flow. Sheets uses
// only server-side renderers right now — no MathJax client fallback — so we don't need
// the named-range / batched / concurrency-limited machinery Docs has. If MathJax ever
// gets added on the Sheets side, model the new code after Docs/Sidebar.ts (concurrency
// limit, isStaleSidebarAction guard, requestNextMathJaxBatch, etc.) rather than
// extending what's here.

interface SheetsFailureDetail {
  sheetName: string;
  a1: string;
  snippet: string;
  hint?: string;
}

interface SheetsRenderResult {
  successCount: number;
  failureCount: number;
  authorizationError: boolean;
  noSpreadsheet: boolean;
  failureDetails?: SheetsFailureDetail[];
}

interface SheetsDerenderResult {
  successCount: number;
  status: "ok" | "no-spreadsheet" | "no-selection" | "no-images";
}

$('document').ready(function () {
  $(function () {
    google.script.run
      .withSuccessHandler(loadPreferences)
      .withFailureHandler(err => showError("Couldn't load saved preferences: " + (err?.message ?? String(err)), "Status: Error loading preferences."))
      .getPrefs();
    $('#insert-text').click(insertText);
    $('#edit-text').click(editText);
    $('#undo-all').click(undoAll);
    $('#size').change(function () {
      if ($('#size :selected').val() === 'custom') {
        $('#custom-size').show();
      } else {
        $('#custom-size').hide();
      }
    });
  });
});

function runDotAnimation() {
  return setInterval(function () {
    if ($("#loading").html().length >= 18) {
      $("#loading").html("Status: Loading");
    } else {
      $("#loading").html($("#loading").text() + '.');
    }
  }, 300);
}

function getCurrentSettings() {
  let sizeRaw = $('#size :selected').val() as string;
  if (sizeRaw === 'custom') {
    sizeRaw = ($('#custom-size').val() as string) || '';
  }
  const delimiter = $('#delimit :selected').val() as string;
  const renderer = $('#renderer :selected').val() as string;
  return { sizeRaw, delimiter, renderer };
}

$("#advanced").click(function (event) {
  event.preventDefault();
  $("#divDelimiters").attr("style", function (_i, origValue) {
    if (origValue == "display: block;") {
      $("#advanced").text("Show Advanced Settings");
      return "display: none;";
    } else {
      $("#advanced").text("Hide Advanced Settings");
      return "display: block;";
    }
  });
});

function loadPreferences(choicePrefs: { size: string; delim: string; renderer: string }) {
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
  const savedRenderer = ["auto", "codecogs", "texrendr", "sciweavers"].includes(choicePrefs.renderer) ? choicePrefs.renderer : "auto";
  $('#renderer').val(savedRenderer);
  $('#insert-text').prop("disabled", false);
  $('#edit-text').prop("disabled", false);
  $('#undo-all').prop("disabled", false);
}

// REASON: Same detector as Docs/Sidebar.ts — match the locales we've actually seen in
// prod logs (en/es/fr/it/ko/uk). If a new locale shows up, add its substring here.
function isAuthorizationError(msg: unknown): boolean {
  const text = typeof msg === "string" ? msg : (msg && typeof msg === "object" && "message" in msg ? String((msg as { message: unknown }).message) : "");
  if (!text) return false;
  return /permission to call|Authorization is required|Authori[sz]ation is required|необхідн[аі] [^ ]* дозвол|необходим|권한이 없|permiso para llamar|autorisations requises|autorizzazione|disposer des autorisations/i.test(text);
}

function showAuthorizationPrompt(statusText: string) {
  google.script.run
    .withSuccessHandler((authUrl: string | null) => {
      if (authUrl) {
        showError(
          `<strong>Auto-LaTeX needs your permission to read this spreadsheet.</strong> <a href="${authUrl}" target="_blank" rel="noopener">Click here to authorize</a>, then come back and try again.`,
          statusText
        );
      } else {
        showError(
          "<strong>Authorization is required.</strong> Try reloading the spreadsheet or signing out of any other Google accounts in this tab. If that doesn't help, reinstall the add-on and click 'Select all' on the permissions screen.",
          statusText
        );
      }
    })
    .withFailureHandler(() => {
      showError("<strong>Authorization is required.</strong> Reload the spreadsheet or reinstall the add-on.", statusText);
    })
    .getAuthorizationUrl();
}

function showError(msg1: string, msg2: string) {
  $('#error').remove();
  $('#loading').html(msg2);
  $('form').prepend(`<div id="error" class="error">${msg1}</div>`);
}

function buildFailureDetailsHtml(failures: SheetsFailureDetail[] | undefined): string {
  if (!failures || failures.length === 0) return "";
  let html = `<div class="failure-summary"><strong>${failures.length} equation(s) couldn't render:</strong><ul>`;
  for (const f of failures) {
    const where = `${f.sheetName}!${f.a1}`;
    const snippet = $('<div>').text(f.snippet).html(); // HTML-escape via jQuery
    const hint = f.hint ? ` <em>(${f.hint})</em>` : "";
    html += `<li><code>${where}</code>: <code>${snippet}</code>${hint}</li>`;
  }
  html += "</ul></div>";
  return html;
}

function insertText(this: HTMLButtonElement) {
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  const runDots = runDotAnimation();
  const { sizeRaw, delimiter, renderer } = getCurrentSettings();
  const element = this;

  google.script.run
    .withSuccessHandler(function (result: SheetsRenderResult) {
      clearInterval(runDots);
      element.disabled = false;
      if (result.noSpreadsheet) {
        showError("Sorry, the script has conflicting authorizations. Try signing out of other active Gsuite accounts.", "Status: No spreadsheet.");
        return;
      }
      if (result.authorizationError && result.successCount === 0) {
        showError(
          "<strong>Auto-LaTeX is missing permission to call external renderers.</strong> Try uninstalling and reinstalling the add-on, then click 'Select all' on the permissions screen.",
          "Status: Authorization required"
        );
        return;
      }
      const failureHtml = buildFailureDetailsHtml(result.failureDetails);
      if (result.successCount === 0 && result.failureCount === 0) {
        $("#loading").html("Status: No equations found. Each equation must be the only content of its cell.");
      } else if (result.successCount > 0 && result.failureCount === 0) {
        $("#loading").html(`Status: ${result.successCount} equation${result.successCount === 1 ? "" : "s"} rendered.`);
      } else if (result.successCount > 0 && result.failureCount > 0) {
        showError(`Rendered ${result.successCount}, but ${result.failureCount} failed.${failureHtml}`, `Status: ${result.successCount} rendered, ${result.failureCount} failed.`);
      } else {
        showError(`All ${result.failureCount} equations failed.${failureHtml}`, "Status: All renderers failed.");
      }
    })
    .withFailureHandler(function (msg) {
      clearInterval(runDots);
      element.disabled = false;
      if (isAuthorizationError(msg)) {
        showAuthorizationPrompt("Status: Authorization required");
        return;
      }
      console.error("replaceEquations failed:", msg);
      showError("Sorry, something went wrong. Please reload the spreadsheet and try again. " + ((msg as { message?: string })?.message ?? ""), "Status: Error.");
    })
    .replaceEquations(sizeRaw, delimiter, renderer);
}

function editText(this: HTMLButtonElement) {
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  const runDots = runDotAnimation();
  const { sizeRaw, delimiter, renderer } = getCurrentSettings();
  const element = this;

  google.script.run
    .withSuccessHandler(function (result: SheetsDerenderResult) {
      clearInterval(runDots);
      element.disabled = false;
      switch (result.status) {
        case "no-spreadsheet":
          showError("Cannot access spreadsheet. Try reloading.", "Status: No spreadsheet.");
          break;
        case "no-selection":
          showError("Please select the cell(s) containing the rendered equation image you want to de-render.", "Status: No selection.");
          break;
        case "no-images":
          showError("No Auto-LaTeX images found in the selected cells. Make sure the rendered image is anchored to a cell inside your selection.", "Status: No matching images.");
          break;
        case "ok":
          $("#loading").html(`Status: ${result.successCount} equation${result.successCount === 1 ? "" : "s"} de-rendered.`);
          break;
      }
    })
    .withFailureHandler(function (msg) {
      clearInterval(runDots);
      element.disabled = false;
      if (isAuthorizationError(msg)) {
        showAuthorizationPrompt("Status: Authorization required");
        return;
      }
      console.error("editEquations failed:", msg);
      showError("Sorry, something went wrong while de-rendering. " + ((msg as { message?: string })?.message ?? ""), "Status: Error.");
    })
    .editEquations(sizeRaw, delimiter, renderer);
}

function undoAll(this: HTMLButtonElement) {
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  const runDots = runDotAnimation();
  const { delimiter } = getCurrentSettings();
  const element = this;

  google.script.run
    .withSuccessHandler(function (restoredCount: number) {
      clearInterval(runDots);
      element.disabled = false;
      if (restoredCount === 0) {
        $("#loading").html("Status: No Auto-LaTeX images found.");
      } else {
        $("#loading").html(`Status: ${restoredCount} equation${restoredCount === 1 ? "" : "s"} de-rendered.`);
      }
    })
    .withFailureHandler(function (msg) {
      clearInterval(runDots);
      element.disabled = false;
      if (isAuthorizationError(msg)) {
        showAuthorizationPrompt("Status: Authorization required");
        return;
      }
      console.error("removeAll failed:", msg);
      showError("Sorry, something went wrong while de-rendering all. " + ((msg as { message?: string })?.message ?? ""), "Status: Error.");
    })
    .removeAll(delimiter);
}
