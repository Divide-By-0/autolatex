/// <reference lib="dom" />

// Shared client-side MathJax equation machinery (preprocessing + SVG→canvas→PNG
// rendering), injected into the Docs, Slides, and Sheets SidebarJS.html by
// BuildSidebarJS.js (compiled to SidebarMathJaxShared.js). Keep this file free of
// project-specific references — it must compile standalone and run inside every
// sidebar's sandboxed iframe.

declare const MathJax: {
  tex2svgPromise(equation: string, options: { display: boolean, em: number }): Promise<Element>;
  svgStylesheet(): Element;
};

interface SharedMathJaxRenderOptions {
  equation: string;
  inline: boolean;
  size: number;
  r: number;
  g: number;
  b: number;
  bgR?: number;
  bgG?: number;
  bgB?: number;
}

// REASON: MathJax rendering is CPU-heavy (SVG → canvas → PNG). Running too many in
// parallel (e.g. 1000 equations) would freeze the browser; this caps concurrency.
const MATHJAX_CONCURRENCY_LIMIT = 4;

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function blobToB64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(blob);
  });
  return dataUrl.substring(dataUrl.indexOf(",") + 1); // strip dataurl header
}

/**
 * Render one equation to a PNG blob via MathJax: preprocess, typeset to SVG,
 * rasterize at 5x on a canvas (optionally over a sampled background color), and
 * export. `reportError` (each sidebar passes its Cloud Logging reporter) receives
 * TeX syntax errors; rendering still proceeds so one bad equation can't fail a
 * batch.
 */
async function renderEquationPngWithMathJax(
  renderOptions: SharedMathJaxRenderOptions,
  reportError?: (context: string, error: unknown, extra?: Record<string, unknown>) => void
): Promise<Blob> {
  const equationBody = prepareEquationForMathJax(renderOptions.equation);
  const equation = `\\color[RGB]{${renderOptions.r},${renderOptions.g},${renderOptions.b}}` + equationBody;

  const mathJaxGlobal = (window as unknown as { MathJax?: typeof MathJax }).MathJax;
  if (!mathJaxGlobal || typeof mathJaxGlobal.tex2svgPromise !== "function") {
    throw new Error("MathJax is still loading. Please try again in a moment.");
  }

  const result = await mathJaxGlobal.tex2svgPromise(equation, {
    display: !renderOptions.inline,
    em: renderOptions.size
  });
  const svg = result.querySelector("svg") as SVGSVGElement | null;
  if (!svg) {
    throw new Error("MathJax did not return an SVG element.");
  }

  // REASON: tex2svgPromise RESOLVES on TeX syntax errors, embedding the message as a
  // red merror node — report them (with the equation) so they're debuggable.
  const mjxErrorNode = svg.querySelector("[data-mjx-error]");
  if (mjxErrorNode && reportError) {
    reportError("mathjax.merror", mjxErrorNode.getAttribute("data-mjx-error") || "unknown TeX error", {
      equation: renderOptions.equation,
    });
  }

  // measure at the requested font size, then rasterize at 5x for quality
  svg.classList.add("mathjax-equation-hidden-render");
  svg.style.fontSize = `${renderOptions.size}px`;
  document.body.appendChild(svg);
  const width = svg.clientWidth * 5;
  const height = svg.clientHeight * 5;
  svg.remove();
  svg.setAttribute("width", `${width}px`);
  svg.setAttribute("height", `${height}px`);

  const styles = mathJaxGlobal.svgStylesheet().outerHTML;
  const svgString = new XMLSerializer().serializeToString(svg).replace("</svg>", styles + "</svg>");
  const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
  const svgUrl = URL.createObjectURL(svgBlob);

  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) {
    throw new Error("Could not initialize a 2D canvas for MathJax rendering.");
  }

  // REASON: when the equation text carries a highlight (background color), the
  // server samples it into bgR/bgG/bgB; bake it into the PNG so the image matches
  // the highlight band instead of showing the page through a transparent
  // background. Absent -> transparent.
  if (typeof renderOptions.bgR === "number") {
    ctx.fillStyle = `rgb(${renderOptions.bgR},${renderOptions.bgG},${renderOptions.bgB})`;
    ctx.fillRect(0, 0, width, height);
  }

  try {
    const svgImage = new Image(width, height);
    svgImage.src = svgUrl;
    await new Promise<void>((resolve, reject) => {
      svgImage.onload = () => resolve();
      svgImage.onerror = err => reject(err);
    });

    ctx.drawImage(svgImage, 0, 0);

    return "convertToBlob" in canvas
      ? await (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob(blob => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Could not convert MathJax canvas to a PNG blob."));
            }
          }, "image/png");
        });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

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
