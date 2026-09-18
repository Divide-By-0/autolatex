// Real Chromium + locked MathJax + production shared SVG/canvas/PNG renderer.
// Apps Script scanning uses the explicitly documented contract harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { compileScript } = require('../helpers/compile-script');
const { cases, runCase } = require('../helpers/render-matrix');
const root = path.join(__dirname, '../..');
const out = path.resolve(process.env.ALE_ARTIFACT_DIR || path.join(root, 'test-results/render-matrix'));
const revision = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const rendererPath = process.env.ALE_RENDERER_TS || path.join(root, 'SidebarMathJaxShared.ts');
const rendererSource = compileScript(rendererPath);
const rendererSha256 = crypto.createHash('sha256').update(fs.readFileSync(rendererPath)).digest('hex');
// Evaluate the build helper's declarations without invoking its CLI entry point.
const builder = vm.createContext({ require, console });
vm.runInContext(fs.readFileSync(path.join(root, 'BuildSidebarJS.js'), 'utf8').replace(/buildSidebarJS\(\);\s*$/, ''), builder);
const setup = builder.getMathJaxSetup();
const css = fs.readFileSync(path.join(root, 'Docs/ALEStylesheet.html'), 'utf8').match(/\.mathjax-equation-hidden-render\s*\{[^}]+\}/)[0];
const samples = ['1+1=2', String.raw`\text{Work} = F \times d`, String.raw`\frac{1+1}{2}=1`, String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`];
const glyphs = [['2B', '3D', '32'], ['3D', 'D7', '1D451'], ['2B', '3D', '31'], ['2211', '3D', '32']];
const clientCases = cases.filter(c => c.renderer === 'auto' || c.renderer === 'mathjax');
const records = [], visuals = [];

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    // Serve only the locked MathJax dependency tree, never the workspace generally.
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body></body></html>`);
      return;
    }
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.resolve(root, '.' + url);
    const allowed = ['node_modules/mathjax/', 'node_modules/@mathjax/'].some(p => file.startsWith(path.resolve(root, p) + path.sep));
    if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const base = `http://127.0.0.1:${server.address().port}`;
    // MathJax requests dynamic fonts from a CDN by default. Serve those exact
    // locked packages locally so CI needs no external renderer or font service.
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(base) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
      if (url.startsWith('https://cdn.jsdelivr.net/npm/@mathjax/')) {
        const relative = url.split('/npm/')[1].replace(/(mathjax-[^/@]+)@[^/]+\//, '$1/');
        const file = path.resolve(root, 'node_modules', relative);
        assert.ok(file.startsWith(path.join(root, 'node_modules/@mathjax/')));
        return route.fulfill({ path: file, contentType: 'application/javascript' });
      }
      throw new Error(`Unexpected network dependency: ${url}`);
    });
    page.on('pageerror', error => console.error('Browser:', error.message));
    await page.goto(base);
    await page.addScriptTag({ content: setup });
    await page.addScriptTag({ url: `${base}/node_modules/mathjax/tex-svg.js` });
    await page.evaluate(() => MathJax.startup.promise);
    await page.addScriptTag({ content: rendererSource });
    await page.evaluate(() => {
      const realTypeset = MathJax.tex2svgPromise.bind(MathJax);
      MathJax.tex2svgPromise = async (...args) => {
        const result = await realTypeset(...args);
        window.lastTypeset = {
          fragmentCount: result.querySelectorAll('svg').length,
          glyphs: [...result.querySelectorAll('[data-c]')].map(n => n.getAttribute('data-c')),
          errors: [...result.querySelectorAll('[data-mjx-error]')].map(n => n.getAttribute('data-mjx-error')),
        };
        return result;
      };
      window.renderPng = async options => {
        const blob = await renderEquationPngWithMathJax(options);
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let ink = 0, left = bitmap.width, right = -1;
        for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
          if (pixels[(y * bitmap.width + x) * 4 + 3] > 32) { ink++; left = Math.min(left, x); right = Math.max(right, x); }
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const b64 = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
        return { ...window.lastTypeset, width: bitmap.width, height: bitmap.height, ink, left, right, b64, mime: blob.type };
      };
    });
    const pngBySettings = new Map();
    for (const c of clientCases) {
      for (let sample = 0; sample < samples.length; sample++) {
        const { payloads } = runCase(c, samples[sample]);
        for (const p of payloads) {
          const result = await page.evaluate(p => window.renderPng(p), JSON.parse(JSON.stringify(p)));
          assert.equal(result.fragmentCount, 1, JSON.stringify(c));
          assert.deepEqual(result.errors, []);
          for (const glyph of glyphs[sample]) assert.ok(result.glyphs.includes(glyph), `${samples[sample]} missing ${glyph}; got ${result.glyphs}`);
          assert.equal(result.mime, 'image/png');
          assert.ok(result.ink > 100 && result.width > 0 && result.height > 0, 'PNG contains visible ink');
          assert.ok(result.right - result.left > result.width / 2, 'ink reaches across the image');
          const hash = crypto.createHash('sha256').update(Buffer.from(result.b64, 'base64')).digest('hex');
          // All delimiters and both Auto/MathJax preferences must produce the
          // same PNG for a given app font, size mode and equation.
          const key = `${c.app}/${c.mode}/${sample}`;
          if (pngBySettings.has(key)) assert.equal(hash, pngBySettings.get(key), 'delimiters/preference must not change pixels');
          else pngBySettings.set(key, hash);
          records.push({ ...c, sample: samples[sample], delimiterId: p.delim[6], width: result.width, height: result.height, pngSha256: hash });
          if (c.renderer === 'mathjax' && c.delimiter === '$$') visuals.push({ app: c.app, mode: c.mode, sample, ...result });
        }
      }
    }
    for (const app of ['Docs', 'Slides']) {
      for (const sample of [2, 3]) {
        const auto = visuals.find(v => v.app === app && v.mode === 'smart' && v.sample === sample);
        const inline = visuals.find(v => v.app === app && v.mode === 'inline' && v.sample === sample);
        assert.ok(inline.height < auto.height, 'Inline must use compact fraction/sum layout');
      }
    }
    await page.close();
    for (const app of ['Docs', 'Slides']) {
      const gallery = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
      const cells = visuals.filter(v => v.app === app);
      const escapeHtml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      await gallery.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        body{font:18px system-ui;margin:40px;color:#162536;background:#f5f7fa}h1{font-size:30px;margin-bottom:10px}p{line-height:1.5;color:#475569}table{border-collapse:collapse;background:white;width:100%;table-layout:fixed}th,td{border:1px solid #cbd5e1;padding:24px;text-align:left}th{background:#e8eef5}code{font-size:14px;overflow-wrap:anywhere}img{display:block;max-width:100%}.note{font-size:14px}
        </style></head><body><h1>${app} equation rendering · Auto vs Inline size</h1><p>Actual PNG output from the production renderer in Chromium.<br>Automatic and MathJax renderer choices produced identical pixels across every delimiter.</p><table><thead><tr><th>Source equation</th><th>Automatic size</th><th>Inline size</th></tr></thead><tbody>${samples.map((eq, sample) => `<tr><td><code>${escapeHtml(eq)}</code></td>${['smart', 'inline'].map(mode => { const v = cells.find(v => v.sample === sample && v.mode === mode); return `<td><img alt="${escapeHtml(eq)}" src="data:image/png;base64,${v.b64}" width="${v.width / 5 * 2}"></td>`; }).join('')}</tr>`).join('')}</tbody></table><p class="note">2× viewing scale · Source font: ${app === 'Docs' ? 11 : 18}px · Delimiters tested: $$, $ (Beta), \\[ \\], \\( \\), All.<br>Local rendering evidence; not a screenshot of the deployed Google ${app} add-on. External renderer availability and Google insertion are separate checks.<br>Renderer SHA-256: ${rendererSha256.slice(0, 20)} · Base revision: ${revision.slice(0, 7)}</p></body></html>`);
      await gallery.locator('img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
      await gallery.screenshot({ path: path.join(out, `${app.toLowerCase()}-auto-inline.png`), fullPage: true });
      await gallery.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ revision, rendererSha256, browser: browser.version(), matrixCases: cases.length, browserCases: clientCases.length, pngRenders: records.length, records }, null, 2));
    console.log(`PASS: ${clientCases.length} browser settings, ${records.length} real PNG renders. Screenshots: ${out}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ revision, rendererSha256, error: String(error), completed: records }, null, 2));
  console.error(error); process.exitCode = 1;
});
