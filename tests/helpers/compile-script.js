const fs = require("node:fs");
const ts = require("typescript");

// NOTE: Apps Script build outputs can be ignored or stale in a clean checkout.
// Compile tracked source in memory so tests exercise the code being reviewed.
function compileScript(filename) {
  return ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

module.exports = { compileScript };
