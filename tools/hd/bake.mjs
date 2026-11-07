// node tools/hd/bake.mjs  -> docs/hd/rides/m0..5.bin (bake runs in headless Chrome; output is committed so the client never sculpts)
import { chromium } from 'playwright'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url)); const out = path.join(dir, '../../docs/hd/rides'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] }); const p = await b.newPage(); p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('file://' + path.join(dir, 'bake.html')); await p.waitForFunction(() => document.title === 'ready');
for (const m of (process.argv[2] || '0,1,2,3,4,5').split(',').map(Number)) { const t = Date.now(); const r = await p.evaluate((m) => window.bake(m), m); fs.writeFileSync(path.join(out, 'm' + m + '.bin'), Buffer.from(r.b64, 'base64')); console.log('model', m, Math.round(r.bytes / 1024) + 'KB', Date.now() - t + 'ms', JSON.stringify(r.stats)); }
await b.close();
