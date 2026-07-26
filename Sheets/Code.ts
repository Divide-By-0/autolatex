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
  // present when the sidebar should render these client-side via MathJax and
  // call clientRenderComplete / clientRenderFailed with the results
  clientEquations?: SheetsClientRenderOptions[];
}

// One cell's equation handed to the sidebar for client-side MathJax rendering.
// Cells are addressed by sheetId + row/col (Sheets needs no named-range machinery:
// the anchor cell is the identity), and the original cell value rides along so the
// completion path can build the round-trip alt text and detect stale cells.
interface SheetsClientRenderOptions {
  sheetId: number;
  row: number;
  col: number;
  equation: string;
  originalCellValue: string;
  size: number;
  inline: boolean;
  r: number;
  g: number;
  b: number;
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
  // REASON: with the single-$ delimiter, a cell holding "$$x$$" would otherwise parse
  // as the equation "$x$" (dollars included). The "all" set tries $$ before $, but a
  // user who explicitly selected "$ ... $" still needs this guard.
  if (delim[4] === 1 && startToken === "$" && (inner.startsWith("$") || inner.endsWith("$"))) return null;
  return inner;
}

// Parse a "#rrggbb" hex color into [r, g, b]; anything malformed falls back to black.
function getRgbFromHex(colorHex: string | null): [number, number, number] {
  if (!colorHex || !/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
    return [0, 0, 0];
  }
  const channels = [1, 3, 5].map(index => parseInt(colorHex.slice(index, index + 2), 16));
  if (channels.some(channel => isNaN(channel))) {
    return [0, 0, 0];
  }
  return channels as [number, number, number];
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

  // REASON: MathJax (best) and Automatic render on the client like Docs/Slides —
  // that's the only path that supports tables, long equations, and the rest of the
  // MathJax feature set. Scan the sheet, hand the equations to the sidebar, and let
  // clientRenderComplete place the PNGs. Explicit server-renderer choices keep the
  // in-process loop below.
  if (renderer === "mathjax" || renderer === "auto") {
    const clientEquations = collectClientEquations(spreadsheet, delimiterSet, size, isInline);
    return {
      successCount: 0,
      failureCount: 0,
      authorizationError: false,
      noSpreadsheet: false,
      clientEquations,
    };
  }

  // REASON: The renderer param mirrors Docs's; the user chose an explicit server
  // renderer, which narrows which families Common tries.
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

  // REASON: Apps Script kills executions at 6 minutes. A sheet full of equations
  // rendered sequentially through server fetches can exceed that; stop cleanly with
  // budget to spare so completed work is kept, and tell the user to run again —
  // already-rendered cells no longer parse as equations, so the next run resumes
  // where this one stopped.
  const RENDER_TIME_BUDGET_MS = 270000;
  const renderStartTime = Date.now();
  let timeBudgetExceeded = false;

  for (const sheet of spreadsheet.getSheets()) {
    if (timeBudgetExceeded) break;
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow === 0 || lastColumn === 0) continue;
    // REASON: getDataRange is the cheapest way to grab a snapshot of every populated cell
    // without iterating row-by-row. Sheets returns a 2D array of primitives; LaTeX cells
    // appear as strings so we can early-skip everything else without a getValue() call
    // per cell.
    const dataRange = sheet.getRange(1, 1, lastRow, lastColumn);
    const values = dataRange.getValues();
    // REASON: one bulk read per sheet; equations render in the cell's font color so
    // colored/dark-themed sheets keep their equations visible (parity with Docs).
    const fontColors = dataRange.getFontColors();
    for (let r = 0; r < values.length && !timeBudgetExceeded; r++) {
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

        if (Date.now() - renderStartTime > RENDER_TIME_BUDGET_MS) {
          timeBudgetExceeded = true;
          failureCount++;
          failureDetails.push(buildFailureDetail(sheet, r + 1, c + 1, cellRaw,
            "Stopped before the execution time limit — click Render Equations again to continue from here"));
          break;
        }

        const [fontR, fontG, fontB] = getRgbFromHex(fontColors[r][c]);

        // REASON: Pre-encode the equation here the same way Docs does so that Common's
        // renderEquation receives a URL-safe payload with the correct newline glyph for
        // this surface (Sheets's \n → %0A vs Docs's paragraph-break → %0D).
        const equationEncoded = Common.reEncode(latex, SheetsApp);
        const result = Common.renderEquation(equationEncoded, {
          ...renderOptions,
          delim,
          r: fontR, g: fontG, b: fontB
        });

        if (result.worked > Common.capableRenderers || !result.resp || !result.renderer) {
          if (result.authorizationError) authorizationError = true;
          failureCount++;
          failureDetails.push(buildFailureDetail(sheet, r + 1, c + 1, cellRaw, "All renderers failed"));
          continue;
        }

        try {
          insertRenderedImage(sheet, r + 1, c + 1, cellRaw, result.resp!.getBlob(), size);
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

/**
 * Scan every sheet for whole-cell equations and package them for client-side
 * MathJax rendering. Fast (bulk reads only, no fetches), so no time budget needed.
 */
function collectClientEquations(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
  delimiterSet: AutoLatexCommon.Delimiter[],
  size: number,
  isInline: boolean
): SheetsClientRenderOptions[] {
  const clientEquations: SheetsClientRenderOptions[] = [];
  for (const sheet of spreadsheet.getSheets()) {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow === 0 || lastColumn === 0) continue;
    const dataRange = sheet.getRange(1, 1, lastRow, lastColumn);
    const values = dataRange.getValues();
    const fontColors = dataRange.getFontColors();
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const cellRaw = values[r][c];
        if (typeof cellRaw !== "string") continue;
        let latex: string | null = null;
        for (const candidateDelim of delimiterSet) {
          latex = parseEquationCell(cellRaw, candidateDelim);
          if (latex) break;
        }
        if (!latex) continue;
        const [fontR, fontG, fontB] = getRgbFromHex(fontColors[r][c]);
        // REASON: round-trip through reEncode + getClientEquation like Docs so cell
        // newlines (\n) survive as literal newlines for the depth-aware client
        // transform, and unicode gets the same normalization as every other surface.
        const clientEquation = Common.getClientEquation(Common.reEncode(latex, SheetsApp), SheetsApp);
        clientEquations.push({
          sheetId: sheet.getSheetId(),
          row: r + 1,
          col: c + 1,
          equation: clientEquation,
          originalCellValue: cellRaw,
          size,
          inline: isInline,
          r: fontR, g: fontG, b: fontB,
        });
      }
    }
  }
  return clientEquations;
}

function findSheetById(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet, sheetId: number) {
  for (const sheet of spreadsheet.getSheets()) {
    if (sheet.getSheetId() === sheetId) return sheet;
  }
  return null;
}

// Place one client- or server-rendered equation image, verifying the cell hasn't
// changed since the scan (rendering happens asynchronously in the sidebar).
function placeEquationImageAtCell(
  options: SheetsClientRenderOptions,
  blob: GoogleAppsScript.Base.Blob,
  failureDetails: SheetsFailureDetail[]
): boolean {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet ? findSheetById(spreadsheet, options.sheetId) : null;
  if (!sheet) return false;
  const cell = sheet.getRange(options.row, options.col);
  // REASON: the user may have edited the cell while the client was rendering; only
  // replace it if it still holds the exact equation we scanned.
  if (cell.getValue() !== options.originalCellValue) {
    failureDetails.push(buildFailureDetail(sheet, options.row, options.col, String(cell.getValue() || ""),
      "Cell changed while rendering — run Render again"));
    return false;
  }
  insertRenderedImage(sheet, options.row, options.col, options.originalCellValue, blob, options.size);
  return true;
}

/**
 * Called by the sidebar with client-rendered PNGs. Inserts each image at its cell.
 * @public
 */
function clientRenderComplete(rendered: { options: SheetsClientRenderOptions, renderedEquationB64: string }[]): SheetsRenderResult {
  let successCount = 0;
  let failureCount = 0;
  const failureDetails: SheetsFailureDetail[] = [];
  for (const item of rendered) {
    try {
      const blob = Utilities.newBlob(Utilities.base64Decode(item.renderedEquationB64), "image/png", "equation.png");
      if (placeEquationImageAtCell(item.options, blob, failureDetails)) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (err) {
      console.error("clientRenderComplete insertion failed:", err);
      failureCount++;
    }
  }
  return { successCount, failureCount, authorizationError: false, noSpreadsheet: false,
    failureDetails: failureDetails.length ? failureDetails : undefined };
}

/**
 * Called by the sidebar when MathJax couldn't render some equations (auto mode).
 * Tries the non-Codecogs server renderers for just those cells, mirroring Docs.
 * @public
 */
function clientRenderFailed(equations: { options: SheetsClientRenderOptions }[]): SheetsRenderResult {
  let successCount = 0;
  let failureCount = 0;
  let authorizationError = false;
  const failureDetails: SheetsFailureDetail[] = [];
  console.log("MathJax client render failed, trying server fallback for", equations.length, "equations");
  for (const { options } of equations) {
    try {
      // options.equation is the decoded client equation (delimiters already stripped
      // at scan time); re-encode it for the server renderers.
      const equationEncoded = Common.reEncode(options.equation, SheetsApp);
      const result = Common.renderEquation(equationEncoded, {
        r: options.r, g: options.g, b: options.b,
        delim: Common.getDelimiters("$$"),
        defaultSize: 11,
        size: options.size,
        inline: options.inline,
        clientRender: false,
        allowedServerFamilies: ["Texrendr", "Sciweavers", "Sciweavers_old", "Roger's renderer", "Number empire"],
      });
      if (result.worked > Common.capableRenderers || !result.resp || !result.renderer) {
        if (result.authorizationError) authorizationError = true;
        failureCount++;
        continue;
      }
      if (placeEquationImageAtCell(options, result.resp.getBlob(), failureDetails)) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (err) {
      console.error("Server fallback render failed:", err);
      failureCount++;
    }
  }
  return { successCount, failureCount, authorizationError, noSpreadsheet: false,
    failureDetails: failureDetails.length ? failureDetails : undefined };
}

function insertRenderedImage(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  row: number,
  col: number,
  originalCellValue: string,
  blob: GoogleAppsScript.Base.Blob,
  preferredSize: number
) {
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
  // option, apply it here. Scale the width by the same factor — setHeight alone
  // stretches the image because OverGridImage does not preserve aspect ratio.
  if (preferredSize > 0) {
    const currentHeight = image.getHeight();
    const currentWidth = image.getWidth();
    const targetHeight = preferredSize * 4;
    image.setHeight(targetHeight);
    if (currentHeight > 0 && currentWidth > 0) {
      image.setWidth(Math.max(1, Math.round(currentWidth * targetHeight / currentHeight)));
    }
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
  // REASON: if the user typed a new value into the cell after rendering, restoring
  // the LaTeX would silently destroy their data. Leave both the cell and the image
  // alone; they can clear the cell and derender again if the restore is wanted.
  const existingValue = anchor.getValue();
  if (existingValue !== "" && existingValue !== null && existingValue !== undefined) {
    console.warn("Skipping derender into non-empty cell " + anchor.getA1Notation());
    return false;
  }
  anchor.setValue(originalCellValue);
  image.remove();
  return true;
}
