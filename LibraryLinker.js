/* eslint-env node */
const fs = require("fs");
const { program } = require("commander"); // one of our dependencies requires this anyway
const path = require("path");

program
  .description("Links Apps Script projects to the Common library")
  .argument("<link|unlink>", "Link or unlink the Apps Script project from the library")
  .argument("<Docs|Slides|Workspace|>", "The Apps Script project to link to")
  .argument("[number]", "The version of the Common library to link to. Omit to use HEAD")
  .parse(process.argv);


/**
 * Get the script ID of the Common library from .clasp.json
 * @returns {string} 
 */
function getCommonScriptId() {
  const fileContent = JSON.parse(fs.readFileSync(path.join(__dirname, "Common", ".clasp.json"), "utf8"));
  return fileContent.scriptId;
}

/**
 * @param {"Docs"|"Slides"|"Workspace"} addonName The name of the addon to put the library ID in
 * @param {string} libraryId The ID of the common library 
 */
function setLibraryId(addonName, libraryId, libraryVersion) {
  const appscriptJsonPath = path.join(__dirname, addonName, "appsscript.json");
  const originalAppsScriptJson = JSON.parse(
    fs.readFileSync(appscriptJsonPath, "utf8")
  );

  const dep = originalAppsScriptJson.dependencies.libraries
    .find(({userSymbol}) => userSymbol === "Common")
  dep.libraryId = libraryId;
  
  if (libraryVersion) {
    dep.version = libraryVersion;
    dep.developmentMode = false;
  } else {
    dep.version = "0";
    dep.developmentMode = true;
  }

  fs.writeFileSync(appscriptJsonPath, JSON.stringify(originalAppsScriptJson, null, 2));
}

function linkLibrary(addonName, libraryVersion) {
  const commonScriptId = getCommonScriptId();

  setLibraryId(addonName, commonScriptId, libraryVersion);
}

function unlinkLibrary(addonName) {
  setLibraryId(addonName, "", null);
}

const [mode, targetAddonName, version] = program.args;

if (mode === "link") {
  linkLibrary(targetAddonName, version);
} else {
  unlinkLibrary(targetAddonName);
}

