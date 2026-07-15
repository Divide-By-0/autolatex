/**
 * @OnlyCurrentDoc
 */
//Auto-Latex Equations for Google Sheets

/* exported onOpen, onInstall, showSidebar, replaceEquations, editEquations, removeAll,
            getKey, getPrefs, getAuthorizationUrl, logMathJaxClientError */

/* global Common, SpreadsheetApp */

// REASON: Marker we put in OverGridImage alt text so we can distinguish our images from
// user-pasted ones and round-trip the original equation cleanly for de-rendering, even
// if the LaTeX contains characters that would confuse a plain string match. Base64 the
// LaTeX after the prefix. Format: "ALE-Latex:<base64>". Do not rename casually —
// existing rendered sheets in user spreadsheets rely on this exact prefix to identify
// Auto-LaTeX images during removeAll / editEquations.
const ALE_ALT_TEXT_PREFIX = "ALE-Latex:";

// REASON: Mirror of Docs's DocsApp / Slides's IntegratedApp pattern. The Common library
// expects an IntegratedApp shape for helpers that walk back from a fully-rendered image
// to the source equation (reEncode, derenderEquation, etc.). Most of those helpers are
// Document/Slides-centric — Sheets doesn't need getBody/getActive/getPageWidth at all,
// but the Common type definition requires them. Stub the unused getters with empty
// returns cast to the expected types so we satisfy IntegratedApp without pulling in
// SlidesApp/DocumentApp. newlineCharacter matters: Sheets cells use a literal \n which
// URL-encodes to %0A, distinct from Docs (%0D — paragraph break) and Slides (%0B —
// shift-enter within a paragraph).
const SheetsApp = {
  getUi: () => SpreadsheetApp.getUi(),
  getBody: () => ([] as unknown as GoogleAppsScript.Slides.Slide[]),
  getActive: () => (SpreadsheetApp.getActiveSpreadsheet() as unknown as GoogleAppsScript.Document.Document),
  getPageWidth: () => 0,
  newlineCharacter: "%0A",
};

interface SheetsRenderResult {
  successCount: number;
  failureCount: number;
  authorizationError: boolean;
  noSpreadsheet: boolean;
  failureDetails?: SheetsFailureDetail[];
}

interface SheetsFailureDetail {
  sheetName: string;
  a1: string;
  snippet: string;
  hint?: string;
}

interface SheetsDerenderResult {
  successCount: number;
  status: "ok" | "no-spreadsheet" | "no-selection" | "no-images";
}

/**
 * @param _e simple-trigger event; ignored.
 */
function onOpen(_e: object) {
  try {
    SpreadsheetApp.getUi().createAddonMenu().addItem("Start", "showSidebar").addToUi();
  } catch (error) {
    // REASON: Manual runs from the Apps Script editor don't have a spreadsheet UI
    // context, which throws here. Don't surface that as a real error.
    console.warn("Skipping onOpen outside a Sheets UI context.", error);
  }
}

function onInstall(e: object) {
  onOpen(e);
}

/**
 * Opens the Auto-LaTeX sidebar in the active spreadsheet.
 */
function showSidebar() {
  const ui = HtmlService.createTemplateFromFile("Sidebar").evaluate()
    .setTitle("Auto-LaTeX Equations")
    .setSandboxMode(HtmlService.SandboxMode.IFRAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  SpreadsheetApp.getUi().showSidebar(ui);
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
 * Returns the OAuth consent URL the user needs to visit to grant any
 * still-missing scopes, or null if everything is already authorized. Mirrors
 * Docs/Code.ts:getAuthorizationUrl — the sidebar uses it to swap a scary stack
 * trace for a clean "Click here to authorize" link.
 *
 * @public
 */
function getAuthorizationUrl(): string | null {
  const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    return info.getAuthorizationUrl();
  }
  return null;
}

/**
 * @public
 */
function logMathJaxClientError(payloadJson: string) {
  // REASON: Named to match the Docs/Slides server-side endpoint exposed to the sidebar.
  // Sheets doesn't ship a client MathJax renderer today, but the sidebar shares an
  // error-reporting shape with the others. Renaming this would break the shared sidebar
  // skeleton if we ever pull it into Common.
  console.error("Sheets client error:", payloadJson);
}

/**
 * Determine whether a cell's value is exactly one delimited LaTeX equation. Whole-cell
 * equations only — mixed text+equation in a single cell isn't supported because
 * `Sheet.insertImage` produces an `OverGridImage` that floats over the cell, not an
 * inline glyph within rich text.
 *
 * Returns the inner LaTeX (without delimiters) or `null` if the cell isn't an equation.
 */
function parseEquationCell(rawText: string, delim: AutoLatexCommon.Delimiter): string | null {
  if (typeof rawText !== "string") return null;
  const trimmed = rawText.trim();
  if (trimmed.length < delim[4] * 2) return null;
  const startToken = delim[0];
  const endToken = delim[1];
  if (!trimmed.startsWith(startToken) || !trimmed.endsWith(endToken)) return null;
  const inner = trimmed.substring(startToken.length, trimmed.length - endToken.length);
  if (!inner) return null;
  return inner;
}

/**
 * Iterate all cells in all sheets of the active spreadsheet, find ones whose value is a
 * delimited LaTeX equation, render each via `Common.renderEquation`, and place the
 * rendered PNG as an OverGridImage anchored to the cell. The original LaTeX (with
 * delimiters) is preserved in the image's alt-text so de-rendering can round-trip back
 * to the source.
 *
 * @public
 */
function replaceEquations(sizeRaw: string, delimiter: string, renderer: string = "auto"): SheetsRenderResult {
  let size = Common.getSize(sizeRaw);
  let isInline = false;
  if (size < 0) {
    isInline = true;
    size = 0;
  }
  const delimiterSet = Common.getDelimiterSet(delimiter);
  Common.savePrefs(sizeRaw, delimiter, renderer);
  const defaultSize = 11;
  Common.reportDeltaTime(140);

  let spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;
  try {
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  } catch (error) {
    console.error("getActiveSpreadsheet failed:", error);
  }
  if (!spreadsheet) {
    return { successCount: 0, failureCount: 0, authorizationError: false, noSpreadsheet: true };
  }

  // REASON: The renderer param mirrors Docs's; in Sheets we only run the server
  // renderers today (no MathJax client fallback), so clientRender is always false. The
  // user's chosen renderer narrows which server families Common tries.
  const renderOptions: AutoLatexCommon.RenderOptions = {
    r: 0, g: 0, b: 0,
    delim: delimiterSet[0],
    defaultSize,
    size,
    inline: isInline,
    clientRender: false,
  };
  if (renderer && renderer !== "auto") {
    renderOptions.allowedServerFamilies = mapRendererToServerFamilies(renderer);
  }

  let successCount = 0;
  let failureCount = 0;
  let authorizationError = false;
  const failureDetails: SheetsFailureDetail[] = [];

  for (const sheet of spreadsheet.getSheets()) {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow === 0 || lastColumn === 0) continue;
    // REASON: getDataRange is the cheapest way to grab a snapshot of every populated cell
    // without iterating row-by-row. Sheets returns a 2D array of primitives; LaTeX cells
    // appear as strings so we can early-skip everything else without a getValue() call
    // per cell.
    const dataRange = sheet.getRange(1, 1, lastRow, lastColumn);
    const values = dataRange.getValues();
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const cellRaw = values[r][c];
        if (typeof cellRaw !== "string") continue;
        let latex: string | null = null;
        let delim = delimiterSet[0];
        for (const candidateDelim of delimiterSet) {
          latex = parseEquationCell(cellRaw, candidateDelim);
          if (latex) {
            delim = candidateDelim;
            break;
          }
        }
        if (!latex) continue;

        // REASON: Pre-encode the equation here the same way Docs does so that Common's
        // renderEquation receives a URL-safe payload with the correct newline glyph for
        // this surface (Sheets's \n → %0A vs Docs's paragraph-break → %0D).
        const equationEncoded = Common.reEncode(latex, SheetsApp);
        const result = Common.renderEquation(equationEncoded, {
          ...renderOptions,
          delim
        });

        if (result.worked > Common.capableRenderers || !result.resp || !result.renderer) {
          if (result.authorizationError) authorizationError = true;
          failureCount++;
          failureDetails.push(buildFailureDetail(sheet, r + 1, c + 1, cellRaw, "All renderers failed"));
          continue;
        }

        try {
          insertRenderedImage(sheet, r + 1, c + 1, cellRaw, result, size);
          successCount++;
        } catch (err) {
          console.error("insertRenderedImage failed:", err);
          failureCount++;
          failureDetails.push(buildFailureDetail(sheet, r + 1, c + 1, cellRaw, "Image insertion failed: " + String((err as Error).message || err)));
        }
      }
    }
  }

  return {
    successCount,
    failureCount,
    authorizationError,
    noSpreadsheet: false,
    failureDetails: failureDetails.length ? failureDetails : undefined,
  };
}

/**
 * Map the sidebar renderer dropdown value (`auto`, `codecogs`, `texrendr`, `sciweavers`)
 * to the family-name array Common's renderEquation expects via `allowedServerFamilies`.
 * `auto` returns undefined so all families are tried in priority order.
 */
function mapRendererToServerFamilies(renderer: string): string[] | undefined {
  switch (renderer) {
    case "codecogs": return ["Codecogs"];
    case "texrendr": return ["Texrendr"];
    case "sciweavers": return ["Sciweavers", "Sciweavers_old"];
    default: return undefined;
  }
}

function insertRenderedImage(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  row: number,
  col: number,
  originalCellValue: string,
  result: AutoLatexCommon.RenderEquationResult,
  preferredSize: number
) {
  const blob = result.resp!.getBlob();
  const image = sheet.insertImage(blob, col, row);
  // REASON: Anchor exactly to the cell so reflows/inserts that shift the cell carry the
  // image with them. Without setAnchorCell, OverGridImage uses absolute pixel coords.
  const anchor = sheet.getRange(row, col);
  image.setAnchorCell(anchor);
  // REASON: Round-trip storage of the original cell value. Base64 protects against
  // special chars and lets us reconstruct exactly what the user typed during derender.
  image.setAltTextDescription(ALE_ALT_TEXT_PREFIX + Utilities.base64Encode(originalCellValue));
  image.setAltTextTitle("Auto-LaTeX equation");

  // REASON: If the user requested an explicit pixel size via the sidebar's "Custom"
  // option, apply it here. Default behavior leaves the image at its renderer-returned
  // dimensions so the user can resize manually if needed.
  if (preferredSize > 0) {
    image.setHeight(preferredSize * 4);
  }

  // REASON: Clear the cell value AFTER inserting the image. If we cleared first and
  // then insertImage threw, we'd lose the user's data. Order matters.
  anchor.setValue("");
}

function buildFailureDetail(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  row: number,
  col: number,
  cellRaw: string,
  hint: string
): SheetsFailureDetail {
  return {
    sheetName: sheet.getName(),
    a1: sheet.getRange(row, col).getA1Notation(),
    snippet: cellRaw.length > 80 ? cellRaw.substring(0, 77) + "…" : cellRaw,
    hint,
  };
}

/**
 * De-render the equation(s) currently selected on the active sheet. In Sheets the
 * "selection" is a cell range; we walk every OverGridImage whose anchor cell is inside
 * that range and restore each one. Returns counts so the sidebar can show status.
 *
 * @public
 */
function editEquations(_sizeRaw: string, _delimiter: string, _renderer: string = "auto"): SheetsDerenderResult {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) return { successCount: 0, status: "no-spreadsheet" };
  const sheet = spreadsheet.getActiveSheet();
  const range = sheet.getActiveRange();
  if (!range) return { successCount: 0, status: "no-selection" };

  const top = range.getRow();
  const bottom = top + range.getNumRows() - 1;
  const left = range.getColumn();
  const right = left + range.getNumColumns() - 1;

  let successCount = 0;
  // REASON: Iterating image[] and removing while iterating is fine because Sheets's
  // getImages() returns a snapshot array, not a live collection. We just need to skip
  // images we don't own (no ALE prefix in alt text) so we don't restore arbitrary
  // user images.
  for (const image of sheet.getImages()) {
    const anchor = image.getAnchorCell();
    const r = anchor.getRow();
    const c = anchor.getColumn();
    if (r < top || r > bottom || c < left || c > right) continue;
    if (restoreEquationFromImage(image)) successCount++;
  }

  return { successCount, status: successCount > 0 ? "ok" : "no-images" };
}

/**
 * De-render every Auto-LaTeX image across every sheet in the active spreadsheet.
 *
 * @public
 */
function removeAll(_defaultDelimRaw: string): number {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) return 0;
  let restored = 0;
  for (const sheet of spreadsheet.getSheets()) {
    for (const image of sheet.getImages()) {
      if (restoreEquationFromImage(image)) restored++;
    }
  }
  return restored;
}

/**
 * Read an OverGridImage's alt text, decode the original LaTeX cell value, restore the
 * anchor cell, and remove the image. Returns true if the image was one of ours and
 * was restored; false otherwise (so callers can keep counts).
 *
 * REASON: Split out of editEquations + removeAll so both share the same restore /
 * cleanup behavior, including the alt-text format check that prevents us from clobbering
 * user-pasted screenshots that happen to share an anchor cell with no equation.
 */
function restoreEquationFromImage(image: GoogleAppsScript.Spreadsheet.OverGridImage): boolean {
  const altText = image.getAltTextDescription();
  if (!altText || altText.indexOf(ALE_ALT_TEXT_PREFIX) !== 0) return false;
  let originalCellValue = "";
  try {
    const blob = Utilities.newBlob(Utilities.base64Decode(altText.substring(ALE_ALT_TEXT_PREFIX.length)));
    originalCellValue = blob.getDataAsString();
  } catch (err) {
    // REASON: An image carrying our ALE prefix but with corrupt base64 is almost
    // certainly an old / hand-edited entry. Skip rather than crash; the user can delete
    // the image manually.
    console.error("Failed to decode original LaTeX from image alt text:", err);
    return false;
  }
  const anchor = image.getAnchorCell();
  anchor.setValue(originalCellValue);
  image.remove();
  return true;
}
