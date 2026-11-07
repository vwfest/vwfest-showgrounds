// node tools/hd/bake-av.mjs -> docs/hd/av/b<sex><build>.bin + shoe.bin
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url)); const out = path.join(dir, '../../docs/hd/av'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--allow-file-access-from-files'] }); const p = await b.newPage(); p.on('pageerror', (e) => console.log('ERR', e.message));
fs.writeFileSync(path.join(dir, 'bake-av.html'), '<!doctype html><script src="bake-av.bundle.js"></script>'); await p.goto('file://' + path.join(dir, 'bake-av.html')); await p.waitForFunction(() => document.title === 'ready');
let r = await p.evaluate(() => window.bakeShoe()); fs.writeFileSync(path.join(out, 'shoe.bin'), Buffer.from(r.b64, 'base64')); console.log('shoe', r.bytes);
for (let sex = 0; sex < 3; sex++) for (let body = 0; body < 3; body++) { const t = Date.now(); r = await p.evaluate(([a, c]) => window.bakeBody(a, c), [sex, body]); fs.writeFileSync(path.join(out, `b${sex}${body}.bin`), Buffer.from(r.b64, 'base64')); console.log('body', sex, body, r.bytes, Date.now() - t + 'ms'); }
await b.close();
