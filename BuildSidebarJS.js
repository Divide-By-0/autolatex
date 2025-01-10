const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execPromise = promisify(exec);

function wrapJS(sidebarJS) {
  return `<script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
<script>
${sidebarJS}</script>`;
}

async function compileTS() {
  try {
    await execPromise("npx tsc --preserveConstEnums Sidebar.ts");
  } catch {
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
