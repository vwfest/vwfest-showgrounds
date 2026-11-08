// node tools/ride-studio.mjs <out-dir>
// Renders each HD ride through the game assemble path (daytime HDR + sun) and writes PNGs.
import { chromium } from 'playwright';
import esbuild from 'esbuild';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || '/tmp/ride-shots');
fs.mkdirSync(out, { recursive: true });
const dir = path.join(root, 'tools/hd');
await esbuild.build({
  entryPoints: [path.join(dir, 'studio-entry.js')],
  bundle: true, format: 'esm', outfile: path.join(dir, 'studio.bundle.js'),
  define: { global: 'globalThis' }, logLevel: 'silent',
});
fs.writeFileSync(path.join(dir, 'studio.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111"><canvas id="c"></canvas><script type="module" src="studio.bundle.js"></script></body>');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(root, u));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1000, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:${port}/tools/hd/studio.html`);
await page.waitForFunction(() => document.title.startsWith('studio-'), null, { timeout: 120000 });
const title = await page.title();
if (title !== 'studio-ready') { console.log(JSON.stringify({ fatal: title, errs })); process.exit(1); }
const names = ['ghia', 'camper', 'bug', 'baja', 'safari', 'wagon'];
const shots = {};
for (const n of names) {
  shots[n] = await page.evaluate((n) => window.__show(n, 'beauty'), n);
  await page.locator('#c').screenshot({ path: path.join(out, n + '.png') });
}
shots.bugWheel = await page.evaluate(() => window.__show('bug', 'wheel'));
await page.locator('#c').screenshot({ path: path.join(out, 'bug-wheel.png') });
shots.camperWheel = await page.evaluate(() => window.__show('camper', 'wheel'));
await page.locator('#c').screenshot({ path: path.join(out, 'camper-wheel.png') });
shots.phone = await page.evaluate(() => window.__show('camper', 'phone'));
await page.setViewportSize({ width: 390, height: 844 });
await page.locator('#c').screenshot({ path: path.join(out, 'phone-camper.png') });
const stats = await page.evaluate(() => window.__stats);
await b.close(); server.close();
fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify({ tris: shots, stats, errs }, null, 1));
console.log(JSON.stringify({ out, tris: shots, errs }, null, 1));
