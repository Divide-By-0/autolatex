// Optional live smoke test. Public generic fixtures only. Kept separate from
// deterministic PR CI because third-party availability is outside this repo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { cases, runCase } = require('../helpers/render-matrix');
const out = path.resolve(process.env.ALE_ARTIFACT_DIR || 'test-results/render-services');
const samples = ['1+1=2', String.raw`\frac{1+1}{2}=1`];
const serverCases = cases.filter(c => !['auto', 'mathjax'].includes(c.renderer));
const requests = new Map(), checks = [];
for (const c of serverCases) for (const sample of samples) {
  const result = runCase(c, sample);
  for (const call of result.renders) {
    const urls = [call.result.renderer[2] + call.result.renderer[6] + call.result.equation, call.result.renderer[1]];
    const key = JSON.stringify(urls);
    requests.set(key, { urls, renderer: c.renderer, mode: c.mode, sample });
    checks.push({ ...c, sample, key });
  }
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const results = new Map();
  try {
    // Bound each fetch and worker; identical requests across delimiters/apps
    // share one real response, avoiding hundreds of calls to public services.
    const pending = [...requests.entries()];
    await Promise.all(Array.from({ length: 3 }, async () => {
      const page = await browser.newPage();
      while (pending.length) {
        const [key, request] = pending.shift();
        let warmup;
        try {
          const response = await fetch(request.urls[0], { signal: AbortSignal.timeout(10000) });
          warmup = response.status;
          await response.arrayBuffer();
        } catch (error) { warmup = String(error); }
        try {
          const response = await fetch(request.urls[1], { signal: AbortSignal.timeout(15000) });
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.ok(response.ok, `HTTP ${response.status}`);
          const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
          const gif = /^GIF8[79]a/.test(bytes.subarray(0, 6).toString());
          const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
          assert.ok(png || gif || jpeg, `not image bytes: ${response.headers.get('content-type')}`);
          const mime = png ? 'image/png' : gif ? 'image/gif' : 'image/jpeg';
          const decoded = await page.evaluate(async ({ b64, mime }) => {
            const image = new Image(); image.src = `data:${mime};base64,${b64}`; await image.decode();
            return { width: image.naturalWidth, height: image.naturalHeight };
          }, { b64: bytes.toString('base64'), mime });
          assert.ok(decoded.width > 1 && decoded.height > 1, 'nonempty decoded image');
          const filename = `${request.renderer}-${request.mode}-${samples.indexOf(request.sample)}.${png ? 'png' : gif ? 'gif' : 'jpg'}`;
          fs.writeFileSync(path.join(out, filename), bytes);
          results.set(key, { ...request, warmup, status: 'image-decoded', ...decoded, filename });
        } catch (error) {
          results.set(key, { ...request, warmup, status: 'unavailable', error: String(error) });
        }
        console.log(`${request.renderer}/${request.mode}/${request.sample}: ${results.get(key).status}`);
      }
      await page.close();
    }));
    const gallery = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const escapeHtml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    // Derived from the shipped selector via serverCases, so retiring a renderer removes its row
    // instead of leaving a hard-coded name that crashes on a missing result.
    const galleryRenderers = [...new Set(serverCases.map(c => c.renderer))];
    const rows = galleryRenderers.flatMap(renderer => samples.map(sample => {
      const cells = ['smart', 'inline'].map(mode => {
        const result = [...results.values()].find(r => r.renderer === renderer && r.mode === mode && r.sample === sample);
        if (!result.filename) return `<td class="failed">${escapeHtml(result.error)}</td>`;
        const mime = result.filename.endsWith('.png') ? 'image/png' : result.filename.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
        const b64 = fs.readFileSync(path.join(out, result.filename)).toString('base64');
        return `<td><img alt="${escapeHtml(sample)}" src="data:${mime};base64,${b64}" style="max-width:260px;max-height:110px"></td>`;
      });
      return `<tr><td>${renderer}<br><code>${escapeHtml(sample)}</code></td>${cells.join('')}</tr>`;
    }));
    await gallery.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body{font:18px system-ui;margin:40px;background:#f5f7fa;color:#162536}h1{font-size:30px}p{line-height:1.5}table{width:100%;border-collapse:collapse;table-layout:fixed;background:white}th,td{padding:20px;border:1px solid #cbd5e1;text-align:left}th{background:#e8eef5}code{font-size:14px}.failed{font-size:15px;color:#a12828}img{display:block}
      </style></head><body><h1>External renderers · Live service responses</h1><p>Generic equations sent to the URLs generated by production Common code.<br>Actual returned images, scaled to fit. HTTP errors are shown, not replaced with MathJax output.</p><table><tr><th>Renderer / source</th><th>Automatic size</th><th>Inline size</th></tr>${rows.join('')}</table><p>Captured ${new Date().toISOString().slice(0, 10)}. Network services can change.<br>This verifies direct service responses, not Google Docs/Slides insertion or fallback after a service fails.</p></body></html>`);
    await gallery.locator('img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
    await gallery.screenshot({ path: path.join(out, 'external-auto-inline.png'), fullPage: true });
    await gallery.close();
  } finally { await browser.close(); }
  const report = { checkedAt: new Date().toISOString(), matrixCases: serverCases.length,
    uniqueRequests: requests.size, results: [...results.values()],
    checks: checks.map(({ key, ...c }) => ({ ...c, status: results.get(key).status })) };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  const unavailable = report.results.filter(r => r.status === 'unavailable');
  console.log(`${report.matrixCases} server settings; ${requests.size} distinct real requests; ${unavailable.length} unavailable. ${out}`);
  // A decoded image is not a semantic correctness check: providers may return
  // error artwork with HTTP 200. Inspect the saved images before claiming success.
  if (unavailable.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
