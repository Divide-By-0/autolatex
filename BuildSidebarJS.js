const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execPromise = promisify(exec);

function getMathJaxSetup() {
  return `
window.MathJax = {
  loader: { load: ['tex-svg', '[tex]/color'] },
  tex: { packages: { '[+]': ['color'] } },
  svg: {
    fontCache: 'none'
  },
  startup: {
    typeset: false // Prevent auto-typesetting
  },
  options: {
    enableAssistiveMml: false
  }
};
`;
}

function wrapJS(sidebarJS, includeMathJax) {
  const mathJaxSetup = includeMathJax ? getMathJaxSetup() : "";
  const mathJaxScript = includeMathJax
    ? '\n<script type="text/javascript" id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>'
    : "";

  return `<script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
<script>
${mathJaxSetup}
${sidebarJS}</script>${mathJaxScript}`;
}

async function compileTS() {
  await execPromise("npx tsc --preserveConstEnums Sidebar.ts -t es2020 --lib es2020,dom --skipLibCheck");
}

async function buildSidebarJS() {
  await compileTS();
  
  const sidebarJS = fs.readFileSync("Sidebar.js", "utf8");
  const sidebarHTML = fs.readFileSync("Sidebar.html", "utf8");
  const includeMathJax = sidebarHTML.includes("input-use-mathjax");

  const wrapped = wrapJS(sidebarJS, includeMathJax);

  // write out
  fs.writeFileSync("SidebarJS.html", wrapped);
}

buildSidebarJS();
