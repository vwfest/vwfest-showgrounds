// Headless in-game screenshots of the Bubble test car (High desktop + phone 844x390 Low).
// Serves docs/ on an unused port (8347). Software renderer: FPS is not representative of a real GPU.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../docs');
const out = process.argv[2] || '/workspace/sg-car-test/ingame';
fs.mkdirSync(out, { recursive: true });
const PORT = 8347;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let p = path.join(root, u === '/' ? 'preview-bubble.html' : u.replace(/^\//, ''));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, b) => {
    if (e) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' });
    res.end(b);
  });
});

const shots = [
  { rarity: 'common', quality: 'high', angle: 'front', w: 1440, h: 900, file: 'common-high.png' },
  { rarity: 'rare', quality: 'high', angle: 'front', w: 1440, h: 900, file: 'rare-high.png' },
  { rarity: 'epic', quality: 'high', angle: 'front', w: 1440, h: 900, file: 'epic-high.png' },
  { rarity: 'epic', quality: 'high', angle: 'plate', w: 1440, h: 900, file: 'epic-high-plate.png' },
  { rarity: 'common', quality: 'low', angle: 'front', w: 844, h: 390, file: 'common-phone.png' },
  { rarity: 'rare', quality: 'low', angle: 'front', w: 844, h: 390, file: 'rare-phone.png' },
  { rarity: 'epic', quality: 'low', angle: 'front', w: 844, h: 390, file: 'epic-phone.png' },
];

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const stats = [];
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('PAGE', s.file, e.message));
    const url = `http://127.0.0.1:${PORT}/preview-bubble.html?rarity=${s.rarity}&quality=${s.quality}&angle=${s.angle}&p=0.22`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => window.__ready === true, { timeout: 180000 });
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => window.__stats);
    const dest = path.join(out, s.file);
    await page.screenshot({ path: dest, type: 'png' });
    const bytes = fs.statSync(dest).size;
    stats.push({ ...s, ...st, bytes, path: dest });
    console.log(JSON.stringify({ file: s.file, ...st, bytes }));
    await page.close();
  }
  fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(stats, null, 2));
  await browser.close();
  server.close();
  console.log('wrote', out);
})().catch((e) => { console.error(e); process.exit(1); });
