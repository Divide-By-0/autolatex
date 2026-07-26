const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execPromise = promisify(exec);

function getMathJaxSetup() {
  // REASON: MathJax has no built-in table/tabular/center/figure environments, so any
  // LaTeX table hits "Unknown environment 'table'" on the client renderer, and long
  // tables also fail every server renderer (the URL-encoded equation exceeds the GET
  // limit) leaving users with no renderer that works (reported by a user 2026-05-16).
  // The macros/environments below emulate the common text-mode constructs in math mode:
  //   - table/figure map to gathered and swallow the optional [h] placement arg
  //     (the 4th element '' marks the env's single arg as optional, per configmacros)
  //   - tabular maps to array, which shares the |c|l| column-spec syntax
  //   - caption becomes a centered text row inside the gathered; label/centering/
  //     noindent/vspace are display no-ops
  //   - toprule/midrule/bottomrule cover ChatGPT-generated booktabs tables
  // configmacros (which reads 'macros'/'environments') and textmacros are already in
  // tex-svg's default package set, so only 'color' needs explicit loading.
  //
  // REASON: do not put the combined `tex-svg` component in loader.load. The component
  // is loaded directly by the script tag below; asking the loader to load it again
  // re-enters configuration startup. In the Google Apps Script iframe that exposed
  // MathJax v3's `Package` getter collision and aborted every client render before
  // tex2svgPromise existed.
  return `
window.MathJax = {
  loader: { load: ['[tex]/color'] },
  tex: {
    packages: { '[+]': ['color'] },
    macros: {
      centering: '',
      caption: ['\\\\\\\\[0.5em]\\\\text{#1}', 1],
      label: ['', 1],
      emph: ['\\\\textit{#1}', 1],
      toprule: '\\\\hline',
      midrule: '\\\\hline',
      bottomrule: '\\\\hline',
      noindent: '',
      vspace: ['', 1]
    },
    environments: {
      table: ['\\\\begin{gathered}', '\\\\end{gathered}', 1, ''],
      tabular: ['\\\\begin{array}{#1}', '\\\\end{array}', 1],
      center: ['\\\\begin{gathered}', '\\\\end{gathered}'],
      figure: ['\\\\begin{gathered}', '\\\\end{gathered}', 1, '']
    }
  },
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

function wrapJS(sidebarJS, includeMathJax, sharedJS) {
  const mathJaxSetup = includeMathJax ? getMathJaxSetup() : "";
  const sharedBlock = includeMathJax && sharedJS ? `\n${sharedJS}` : "";
  // REASON: pin MathJax 4.1.2. The prior v3 bundle crashes during configuration in
  // Google Apps Script sidebars with "Cannot set property Package ... which has only
  // a getter"; MathJax v4 fixes that exact getter-only configuration bug. Keep the
  // version explicit so a future CDN release cannot silently change rendering.
  //
  // crossorigin="anonymous" makes the browser surface real error
  // details (message/filename/lineno/stack) in window.onerror for this
  // cross-origin script. Without it, every MathJax failure inside the sandboxed
  // iframe gets reported as the opaque "Script error." — which dominated our
  // Cloud Logging signal. The jsdelivr CDN serves the proper
  // Access-Control-Allow-Origin header, so this is purely an opt-in on our side.
  const mathJaxScript = includeMathJax
    ? '\n<script type="text/javascript" id="MathJax-script" async crossorigin="anonymous" src="https://cdn.jsdelivr.net/npm/mathjax@4.1.2/tex-svg.js"></script>'
    : "";

  return `<script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
<script>
${mathJaxSetup}${sharedBlock}
${sidebarJS}</script>${mathJaxScript}`;
}

async function compileTS() {
  await execPromise("npx tsc --preserveConstEnums Sidebar.ts -t es2020 --lib es2020,dom --types google-apps-script,jquery --skipLibCheck");
}

// REASON: the MathJax equation preprocessing (depth-aware newlines, hline repair,
// gathered wrap) must behave identically in the Docs and Slides sidebars. It lives
// once in ../SidebarMathJaxShared.ts and is compiled + injected here rather than
// copy-pasted into each Sidebar.ts.
async function compileSharedTS() {
  await execPromise("npx tsc --preserveConstEnums ../SidebarMathJaxShared.ts -t es2020 --lib es2020,dom --skipLibCheck");
}

async function buildSidebarJS() {
  await compileTS();

  const sidebarJS = fs.readFileSync("Sidebar.js", "utf8");
  const sidebarHTML = fs.readFileSync("Sidebar.html", "utf8");
  const includeMathJax = sidebarHTML.includes("data-mathjax-enabled");

  let sharedJS = "";
  if (includeMathJax) {
    await compileSharedTS();
    sharedJS = fs.readFileSync("../SidebarMathJaxShared.js", "utf8");
  }

  const wrapped = wrapJS(sidebarJS, includeMathJax, sharedJS);

  // write out
  fs.writeFileSync("SidebarJS.html", wrapped);
}

buildSidebarJS();
