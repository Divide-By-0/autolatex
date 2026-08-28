/// <reference lib="dom" />

// Shared client-side MathJax equation machinery (preprocessing + SVG→canvas→PNG
// rendering), injected into the Docs, Slides, and Sheets SidebarJS.html by
// BuildSidebarJS.js (compiled to SidebarMathJaxShared.js). Keep this file free of
// project-specific references — it must compile standalone and run inside every
// sidebar's sandboxed iframe.

interface SharedMathJaxApi {
  tex2svgPromise?: (equation: string, options: { display: boolean, em: number }) => Promise<Element>;
  svgStylesheet?: () => Element;
  startup?: {
    promise?: Promise<unknown>;
  };
}

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

// REASON: MathJax 4's startup can leave its promise pending forever when a bundled
// worker fails to load in the Apps Script iframe. Keep startup's deadline short
// because it is independent of equation complexity. Typesetting and rasterization
// get a separate equation-scaled budget below so a large, valid equation is not
// mistaken for the startup deadlock.
const MATHJAX_STARTUP_TIMEOUT_MS = 30000;
const MATHJAX_EQUATION_BASE_TIMEOUT_MS = 120000;
const MATHJAX_EQUATION_TIMEOUT_PER_CHARACTER_MS = 250;
const MATHJAX_EQUATION_MAX_TIMEOUT_MS = 15 * 60 * 1000;
let mathJaxStartupWait: Promise<SharedMathJaxApi> | null = null;
let mathJaxReadyInstance: SharedMathJaxApi | null = null;

class MathJaxTimeoutError extends Error {
  constructor(readonly stage: string, readonly timeoutMs: number) {
    super(`MathJax stopped responding while ${stage}. Try again, or use Automatic/Texrendr.`);
    this.name = "MathJaxTimeoutError";
  }
}

function getMathJaxTimeoutErrorMessage(errors: unknown[]) {
  const timeoutError = errors.find(error =>
    typeof error === "object"
      && error !== null
      && (error as { name?: string }).name === "MathJaxTimeoutError"
  ) as { message?: string } | undefined;
  return timeoutError?.message || null;
}

function getMathJaxEquationTimeoutMs(equationLength: number) {
  const safeLength = Number.isFinite(equationLength) ? Math.max(0, equationLength) : 0;
  return Math.min(
    MATHJAX_EQUATION_MAX_TIMEOUT_MS,
    MATHJAX_EQUATION_BASE_TIMEOUT_MS + safeLength * MATHJAX_EQUATION_TIMEOUT_PER_CHARACTER_MS
  );
}

function withMathJaxTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timerId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new MathJaxTimeoutError(stage, timeoutMs));
      }
    }, timeoutMs);

    Promise.resolve(promise).then(
      value => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timerId);
          resolve(value);
        }
      },
      error => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timerId);
          reject(error);
        }
      }
    );
  });
}

function isMathJaxReady(mathJaxGlobal: SharedMathJaxApi | undefined): mathJaxGlobal is Required<Pick<SharedMathJaxApi, "tex2svgPromise" | "svgStylesheet">> & SharedMathJaxApi {
  return typeof mathJaxGlobal?.tex2svgPromise === "function"
    && typeof mathJaxGlobal.svgStylesheet === "function";
}

function getMathJaxGlobal() {
  return (window as unknown as { MathJax?: SharedMathJaxApi }).MathJax;
}

async function waitForMathJaxStartupInternal(timeoutMs: number): Promise<SharedMathJaxApi> {
  const startedAt = Date.now();
  let mathJaxGlobal = getMathJaxGlobal();
  // REASON: tex2svgPromise/svgStylesheet may be installed before MathJax's startup
  // promise settles. The SRE worker failure observed in production happens in that
  // interval, so the presence of those methods alone must not bypass the startup
  // deadline.
  if (mathJaxGlobal?.startup?.promise) {
    await withMathJaxTimeout(mathJaxGlobal.startup.promise, timeoutMs, "starting");
    mathJaxGlobal = getMathJaxGlobal();
    if (isMathJaxReady(mathJaxGlobal)) {
      return mathJaxGlobal;
    }
  } else if (isMathJaxReady(mathJaxGlobal)) {
    return mathJaxGlobal;
  }

  await new Promise<void>((resolve, reject) => {
    let timerId: number | undefined;
    let watchedScript: HTMLScriptElement | null = null;

    const cleanup = () => {
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
      watchedScript?.removeEventListener("error", handleScriptError);
    };
    const handleScriptError = () => {
      cleanup();
      reject(new Error("MathJax could not be loaded from the CDN. Check your connection and try again."));
    };
    const checkStartup = () => {
      const currentMathJax = getMathJaxGlobal();
      if (isMathJaxReady(currentMathJax) || currentMathJax?.startup?.promise) {
        cleanup();
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        cleanup();
        reject(new MathJaxTimeoutError("starting", timeoutMs));
        return;
      }

      // The async script tag appears after this shared inline script, so it may not
      // exist on the first check. Attach the network-error listener once it does.
      const script = document.getElementById("MathJax-script") as HTMLScriptElement | null;
      if (script && script !== watchedScript) {
        watchedScript?.removeEventListener("error", handleScriptError);
        watchedScript = script;
        watchedScript.addEventListener("error", handleScriptError, { once: true });
      }
      timerId = window.setTimeout(checkStartup, 25);
    };

    checkStartup();
  });
  mathJaxGlobal = getMathJaxGlobal();

  if (mathJaxGlobal?.startup?.promise) {
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
    await withMathJaxTimeout(mathJaxGlobal.startup.promise, remainingMs, "starting");
  }

  mathJaxGlobal = getMathJaxGlobal();
  if (!isMathJaxReady(mathJaxGlobal)) {
    throw new Error("MathJax finished loading without its SVG renderer. Reload the sidebar and try again.");
  }
  return mathJaxGlobal;
}

function waitForMathJaxStartup(timeoutMs = MATHJAX_STARTUP_TIMEOUT_MS): Promise<SharedMathJaxApi> {
  const readyMathJax = getMathJaxGlobal();
  if (isMathJaxReady(readyMathJax) && readyMathJax === mathJaxReadyInstance) {
    return Promise.resolve(readyMathJax);
  }
  if (!mathJaxStartupWait) {
    const startupWait = waitForMathJaxStartupInternal(timeoutMs);
    mathJaxStartupWait = startupWait;
    const clearStartupWait = () => {
      if (mathJaxStartupWait === startupWait) {
        mathJaxStartupWait = null;
      }
    };
    // REASON: cache only the in-flight startup wait. A failed worker can poison its
    // promise, so retries must be allowed to observe a newly loaded instance; a
    // successfully confirmed instance gets its own fast path above.
    void startupWait.then(
      ready => {
        mathJaxReadyInstance = ready;
        clearStartupWait();
      },
      clearStartupWait
    );
  }
  return mathJaxStartupWait;
}

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
  const equationTimeoutMs = getMathJaxEquationTimeoutMs(renderOptions.equation.length);

  const mathJaxGlobal = await waitForMathJaxStartup();

  const result = await withMathJaxTimeout(
    mathJaxGlobal.tex2svgPromise(equation, {
      display: !renderOptions.inline,
      em: renderOptions.size
    }),
    equationTimeoutMs,
    "typesetting an equation"
  );
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
  // REASON: a whitespace-only / empty equation (e.g. a lone "\r") typesets to a 0x0 SVG. A
  // zero-size OffscreenCanvas then throws an opaque IndexSizeError in convertToBlob ("The size
  // of OffscreenCanvas is zero"), which surfaced in prod as "MathJax failed to render 1
  // equation(s)". Docs skips these upstream in findPos, but Slides/Sheets share this renderer,
  // so fail fast here with a clear, self-explaining message instead of the canvas crash.
  if (width <= 0 || height <= 0) {
    throw new Error("Empty equation (zero-size render); nothing to rasterize.");
  }
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
    const imageLoad = new Promise<void>((resolve, reject) => {
      svgImage.onload = () => resolve();
      svgImage.onerror = err => reject(err);
    });
    svgImage.src = svgUrl;
    await withMathJaxTimeout(imageLoad, equationTimeoutMs, "loading the rendered equation image");

    ctx.drawImage(svgImage, 0, 0);

    const pngExport = "convertToBlob" in canvas
      ? (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" })
      : new Promise<Blob>((resolve, reject) => {
          (canvas as HTMLCanvasElement).toBlob(blob => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Could not convert MathJax canvas to a PNG blob."));
            }
          }, "image/png");
        });
    return await withMathJaxTimeout(pngExport, equationTimeoutMs, "creating the equation image");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function hasNonAsciiText(value: string) {
  return value.split("").some(char => char.charCodeAt(0) > 0x7F);
}

// REASON: Common.reEncode converts pasted Unicode Greek to unicode-math's
// per-character \mup... commands so the legacy server renderers preserve upright
// glyphs. MathJax 4 supports the base \mathup command but not those \mup... names.
// They appeared 225 times in a 5,000-entry production error sample (not always as
// the primary error), so translate the exact generated command set for the client
// renderer. Unknown \mup... commands stay untouched instead of being guessed.
const UNICODE_MATH_UPRIGHT_GREEK: Record<string, string> = {
  mupAlpha: "Α",
  mupBeta: "Β",
  mupGamma: "Γ",
  mupDelta: "Δ",
  mupEpsilon: "Ε",
  mupZeta: "Ζ",
  mupEta: "Η",
  mupTheta: "Θ",
  mupIota: "Ι",
  mupKappa: "Κ",
  mupLambda: "Λ",
  mupMu: "Μ",
  mupNu: "Ν",
  mupXi: "Ξ",
  mupOmicron: "Ο",
  mupPi: "Π",
  mupRho: "Ρ",
  mupSigma: "Σ",
  mupTau: "Τ",
  mupUpsilon: "Υ",
  mupPhi: "Φ",
  mupChi: "Χ",
  mupPsi: "Ψ",
  mupOmega: "Ω",
  mupalpha: "α",
  mupbeta: "β",
  mupgamma: "γ",
  mupdelta: "δ",
  mupvarepsilon: "ε",
  mupzeta: "ζ",
  mupeta: "η",
  muptheta: "θ",
  mupiota: "ι",
  mupkappa: "κ",
  muplambda: "λ",
  mupmu: "μ",
  mupnu: "ν",
  mupxi: "ξ",
  mupomicron: "ο",
  muppi: "π",
  muprho: "ρ",
  mupvarsigma: "ς",
  mupsigma: "σ",
  muptau: "τ",
  mupupsilon: "υ",
  mupvarphi: "φ",
  mupchi: "χ",
  muppsi: "ψ",
  mupomega: "ω",
  mupvartheta: "ϑ",
  mupphi: "ϕ",
  mupvarpi: "ϖ",
  mupvarkappa: "ϰ",
  mupvarrho: "ϱ",
  mupvarTheta: "ϴ",
  mupepsilon: "ϵ"
};

function normalizeUnicodeMathUprightGreek(equation: string) {
  return equation.replace(/\\mup[A-Za-z]+/g, command => {
    const symbol = UNICODE_MATH_UPRIGHT_GREEK[command.substring(1)];
    return symbol ? `\\mathup{${symbol}}` : command;
  });
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
  const preprocessed = normalizeUnicodeMathUprightGreek(rawEquation)
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
