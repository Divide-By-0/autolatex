// adapted from https://github.com/mathjax/MathJax-demos-node/blob/master/direct/tex2svg

import { mathjax } from "mathjax-full/js/mathjax";
import { TeX } from "mathjax-full/js/input/tex";
import { SVG } from "mathjax-full/js/output/svg";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages";

const mathCss = `
svg a { fill: blue; stroke: blue; }
[data-mml-node="merror"] > g { fill: red; stroke: red; }
[data-mml-node="merror"] > rect[data-background] { fill: yellow; stroke: yellow; }
[data-frame], [data-line] { stroke-width: 70px; fill: none; }
.mjx-dashed { stroke-dasharray: 140; }
.mjx-dotted { stroke-linecap: round; stroke-dasharray: 0, 140; }
use[data-c] { stroke-width: 3px; }
`;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: AllPackages });
const svg = new SVG({ fontCache: "local" });
const html = mathjax.document("", { InputJax: tex, OutputJax: svg });

globalThis.renderMathjaxEquation = (equation: string, inline: boolean) => {
  const node = html.convert(equation, {
    display: !inline,
    em: 16,
    ex: 8,
    containerWidth: 80 * 16
  });

  return adaptor.innerHTML(node);
};
