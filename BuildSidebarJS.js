const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execPromise = promisify(exec);

function wrapJS(sidebarJS) {
  return `<script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
<script>
${sidebarJS}</script>
<script type="text/javascript" id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>`;
}

async function compileTS() {
  try {
    await execPromise("npx tsc --preserveConstEnums Sidebar.ts -t es2020 --lib es2020");
  } catch (err) {
    // typescript complains about conflicting types between DOM and Google Apps Script; ignore
  }
}

async function buildSidebarJS() {
  await compileTS();
  
  const sidebarJS = fs.readFileSync("Sidebar.js", "utf8");

  const wrapped = wrapJS(sidebarJS);

  // write out
  fs.writeFileSync("SidebarJS.html", wrapped);
}

buildSidebarJS();
