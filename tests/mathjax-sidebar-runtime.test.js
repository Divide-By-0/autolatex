const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const buildSidebarSource = fs.readFileSync(
  path.join(__dirname, "..", "BuildSidebarJS.js"),
  "utf8"
);

test("Docs and Slides sidebars use the MathJax release that fixes the Package getter crash", () => {
  assert.match(
    buildSidebarSource,
    /https:\/\/cdn\.jsdelivr\.net\/npm\/mathjax@4\.1\.2\/tex-svg\.js/
  );
  assert.doesNotMatch(buildSidebarSource, /mathjax@3\/es5\/tex-svg\.js/);
});

test("the combined tex-svg component is not recursively loaded during startup", () => {
  assert.match(buildSidebarSource, /loader:\s*\{\s*load:\s*\['\[tex\]\/color'\]\s*\}/);
  assert.doesNotMatch(buildSidebarSource, /load:\s*\[[^\]]*['"]tex-svg['"]/);
});
