const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { compileScript } = require("./compile-script");

const sheetsCodePath = process.env.AUTOLATEX_SHEETS_CODE_PATH
  || path.join(__dirname, "../..", "Sheets/Code.ts");

// REASON: Sheets equations are whole-cell, so the container model is a grid of strings
// plus a list of OverGridImages, not a paragraph stream like Docs. Only the Spreadsheet
// boundary is doubled here — cell scanning, delimiter parsing, renderer routing, base64
// round-trip storage and de-rendering all run the real Sheets/Code.ts against real Common.
function createOverGridImage(sheet, blob, col, row) {
  let altDescription = "";
  let altTitle = "";
  let height = 40;
  let width = 120;
  const image = {
    blob,
    anchorCol: col,
    anchorRow: row,
    removed: false,
    setAnchorCell(range) { image.anchorCol = range.getColumn(); image.anchorRow = range.getRow(); return image; },
    // Real Sheets returns a full Range here; restoreEquationFromImage calls
    // getValue/setValue/getA1Notation on it, so a row/col pair is not enough.
    getAnchorCell: () => sheet.getRange(image.anchorRow, image.anchorCol),
    setAltTextDescription(v) { altDescription = v; return image; },
    getAltTextDescription: () => altDescription,
    setAltTextTitle(v) { altTitle = v; return image; },
    getAltTextTitle: () => altTitle,
    getHeight: () => height,
    setHeight(v) { height = v; return image; },
    getWidth: () => width,
    setWidth(v) { width = v; return image; },
    remove() { image.removed = true; sheet._images = sheet._images.filter(i => i !== image); },
  };
  return image;
}

function createSheet(name, sheetId, grid) {
  const rows = grid.map(r => r.slice());
  const sheet = {
    _images: [],
    getName: () => name,
    getSheetId: () => sheetId,
    getMaxRows: () => rows.length,
    getMaxColumns: () => Math.max(...rows.map(r => r.length), 1),
    // Last row/column with content, matching Sheets semantics (1-based, 0 when empty).
    getLastRow: () => {
      for (let r = rows.length - 1; r >= 0; r--) {
        if ((rows[r] || []).some(c => c !== undefined && String(c) !== "")) return r + 1;
      }
      return 0;
    },
    getLastColumn: () => {
      let last = 0;
      for (const line of rows) {
        for (let c = (line || []).length - 1; c >= 0; c--) {
          if (line[c] !== undefined && String(line[c]) !== "") { last = Math.max(last, c + 1); break; }
        }
      }
      return last;
    },
    getActiveRange: () => makeRange(1, 1, rows.length, Math.max(...rows.map(r => r.length), 1)),
    getImages: () => sheet._images.slice(),
    getDataRange: () => makeRange(1, 1, rows.length, Math.max(...rows.map(r => r.length), 1)),
    getRange: (row, col, numRows = 1, numCols = 1) => makeRange(row, col, numRows, numCols),
    insertImage(blob, col, row) {
      const image = createOverGridImage(sheet, blob, col, row);
      sheet._images.push(image);
      return image;
    },
  };
  function makeRange(row, col, numRows = 1, numCols = 1) {
    return {
      row, col,
      getRow: () => row,
      getColumn: () => col,
      getA1Notation: () => String.fromCharCode(64 + col) + row,
      getNumRows: () => numRows,
      getNumColumns: () => numCols,
      getValues: () => Array.from({ length: numRows }, (_, r) =>
        Array.from({ length: numCols }, (_, c) => {
          const line = rows[row - 1 + r] || [];
          const cell = line[col - 1 + c];
          return cell === undefined ? "" : cell;
        })),
      getValue: () => {
        const line = rows[row - 1] || [];
        return line[col - 1] === undefined ? "" : line[col - 1];
      },
      setValue(v) {
        while (rows.length < row) rows.push([]);
        rows[row - 1][col - 1] = v;
        return this;
      },
      // Sheets reads colours for the whole scanned block at once, so this must be a grid.
      getFontColors: () => Array.from({ length: numRows }, () =>
        Array.from({ length: numCols }, () => "#000000")),
      getBackgrounds: () => Array.from({ length: numRows }, () =>
        Array.from({ length: numCols }, () => "#ffffff")),
      getFontColorObject: () => ({ asRgbColor: () => ({ asHexString: () => "#000000" }) }),
      getBackgroundObject: () => ({ asRgbColor: () => ({ asHexString: () => "#ffffff" }) }),
      getFontSize: () => 10,
    };
  }
  sheet._rows = rows;
  return sheet;
}

// `common` is a vm context produced by tests/helpers/render-matrix.js commonHarness().
function loadSheetsCode(grid, common, { sheetName = "Sheet1", sheetId = 0 } = {}) {
  const sheet = createSheet(sheetName, sheetId, grid);
  const spreadsheet = {
    getSheets: () => [sheet],
    getActiveSheet: () => sheet,
    getId: () => "test-spreadsheet",
    getName: () => "test",
  };
  const uiCalls = [];
  const context = vm.createContext({
    Common: common,
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      getUi: () => ({
        createAddonMenu: () => ({ addItem: () => ({ addToUi() { uiCalls.push("menu"); } }) }),
        showSidebar: () => uiCalls.push("sidebar"),
      }),
    },
    Utilities: {
      base64Encode: s => Buffer.from(String(s), "utf8").toString("base64"),
      base64Decode: s => Array.from(Buffer.from(String(s), "base64")),
      // restoreEquationFromImage decodes the alt text through newBlob().getDataAsString().
      newBlob: bytes => ({
        bytes,
        getBytes: () => bytes,
        getDataAsString: () => Buffer.from(bytes).toString("utf8"),
      }),
      sleep() {},
    },
    ScriptApp: {
      AuthMode: { FULL: "FULL", LIMITED: "LIMITED", NONE: "NONE" },
      getAuthorizationInfo: () => ({
        getAuthorizationStatus: () => "NOT_REQUIRED",
        getAuthorizationUrl: () => null,
      }),
    },
    Session: { getTemporaryActiveUserKey: () => "test-user" },
  });
  vm.runInContext(compileScript(sheetsCodePath), context, { filename: "Sheets.harness.js" });
  return { context, sheet, spreadsheet, uiCalls, rows: () => sheet._rows };
}

module.exports = { loadSheetsCode, createSheet };
