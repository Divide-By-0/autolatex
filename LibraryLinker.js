/* eslint-env node */
const fs = require("fs");
const path = require("path");

// FIXME: better terminology for "link" and "unlink"
const mode = process.argv[2] === "link" ? "link" : "unlink";
const targetAddonName = process.argv[3];

/**
 * Get the script ID of the Common library from .clasp.json
 * @returns {string} 
 */
function getCommonScriptId() {
  const fileContent = JSON.parse(fs.readFileSync(path.join(__dirname, "Common", ".clasp.json"), "utf8"));
  return fileContent.scriptId;
}

/**
 * @param {"Docs"|"Slides"} addonName The name of the addon to put the library ID in
 * @param {string} libraryId The ID of the common library 
 */
function setLibraryId(addonName, libraryId) {
  const appscriptJsonPath = path.join(__dirname, addonName, "appsscript.json");
  const originalAppsScriptJson = JSON.parse(
    fs.readFileSync(appscriptJsonPath, "utf8")
  );

  originalAppsScriptJson.dependencies.libraries
    .find(({userSymbol}) => userSymbol === "Common")
    .libraryId = libraryId;

  fs.writeFileSync(appscriptJsonPath, JSON.stringify(originalAppsScriptJson, null, 2));
}

function linkLibrary(addonName) {
  const commonScriptId = getCommonScriptId();

  setLibraryId(addonName, commonScriptId);
}

function unlinkLibrary(addonName) {
  setLibraryId(addonName, "");
}

if (mode === "link")
  linkLibrary(targetAddonName);
else
  unlinkLibrary(targetAddonName);