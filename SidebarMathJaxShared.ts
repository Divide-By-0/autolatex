/// <reference lib="dom" />

// Shared client-side MathJax equation preprocessing, injected into the Docs and
// Slides SidebarJS.html by BuildSidebarJS.js (compiled to SidebarMathJaxShared.js).
// Keep this file free of project-specific references — it must compile standalone
// and run inside both sidebars' sandboxed iframes.

function hasNonAsciiText(value: string) {
  return value.split("").some(char => char.charCodeAt(0) > 0x7F);
}

// REASON: Newlines inside a \begin{...}\end{...} environment are cosmetic (pasted
// LaTeX formatting) — turning them into \\ injected phantom rows into bmatrix/align
// content. Depth-0 newlines adjacent to \begin/\end are also layout (pasted LaTeX
// puts environments on their own lines). Only the remaining depth-0 newlines mean
// "new output line" — the sidebar's shift+enter contract. An explicit \\ followed
// by a newline collapses to a single row break instead of adding an empty line.
function replaceNewlinesDepthAware(equation: string) {
  let depth = 0;
  let result = "";
  for (let i = 0; i < equation.length; i++) {
    const ch = equation.charAt(i);
    if (ch === "\\") {
      if (equation.startsWith("\\begin", i)) {
        depth++;
      } else if (equation.startsWith("\\end", i)) {
        depth = Math.max(0, depth - 1);
      }
      // copy escape pairs atomically so \\ never half-matches the checks above
      result += ch;
      if (i + 1 < equation.length) {
        result += equation.charAt(i + 1);
        i++;
      }
      continue;
    }
    if (ch === "\n" || ch === "\r" || ch === "\u000B") {
      const upcoming = equation.slice(i + 1).replace(/^[\s\u000B]+/, "");
      const cosmeticBoundary =
        depth > 0 ||
        upcoming.startsWith("\\begin") ||
        /\\end\s*\{[^{}]*\}\s*$/.test(result);
      if (cosmeticBoundary) {
        result += " ";
      } else if (/\\\\\s*$/.test(result)) {
        result += " "; // already ends with an explicit row break; don't double it
      } else {
        result += "\\\\";
      }
      continue;
    }
    result += ch;
  }
  return result;
}

/**
 * Full preprocessing chain applied to an equation before MathJax sees it.
 * Returns the equation body (color prefix is applied by the caller).
 */
function prepareEquationForMathJax(rawEquation: string) {
  const preprocessed = rawEquation
    // Unicode text inside \mbox/\mathrm needs \text for MathJax's textmacros path
    .replace(/\\mbox\s*\{([^{}]*)\}/g, (match, text) => hasNonAsciiText(text) ? `\\text{${text}}` : match)
    .replace(/\\mathrm\s*\{([^{}]*)\}/g, (match, text) => hasNonAsciiText(text) ? `\\text{${text}}` : match)
    // REASON: renders/derenders performed while the pre-2026-07 backslash collapse
    // was live permanently stripped one backslash from "\\\hline" in user docs,
    // leaving the exact 2-backslash signature "\\hline" (row break + literal
    // "hline" text). Repair it; a pristine 3-backslash run can't match this regex.
    .replace(/(^|[^\\])\\\\hline/g, "$1\\\\ \\hline");
  let equationBody = replaceNewlinesDepthAware(preprocessed);
  // REASON: MathJax v3 ignores \\ outside an environment, so shift+enter multi-line
  // equations (which the sidebar instructions promise, and which Codecogs honors)
  // silently rendered on one line. Wrap top-level \\ in gathered to restore the
  // promised line breaks. Equations that already use an environment (align, table,
  // gathered, ...) are left alone — their \\ belongs to that environment.
  if (/\\\\/.test(equationBody) && !/\\begin\s*\{/.test(equationBody)) {
    equationBody = `\\begin{gathered}${equationBody}\\end{gathered}`;
  }
  return equationBody;
}
