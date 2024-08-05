import { build } from "esbuild";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const dir = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(dir, "mathjax.ts")],
  bundle: true,
  minify: true,
  target: "es2015",
  outfile: join(dir, "../MathJax.js"),
  format: "iife",
  platform: "neutral"
});
