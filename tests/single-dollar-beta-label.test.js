const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("both Docs interfaces mark single-dollar delimiters as Beta without changing their value", () => {
  assert.match(
    read("Docs/Sidebar.html"),
    /<option value="\$">\$ \.\.\. \$ \(Beta\)<\/option>/
  );
  assert.match(
    read("Workspace/Code.ts"),
    /\["\$ \.\.\. \$ \(Beta\)", "\$"\]/
  );
});
