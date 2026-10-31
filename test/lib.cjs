// Shared test helpers (Playwright without CSP bypass, so CSP violations show up as console errors).
const { chromium } = require('playwright');
exports.launch = () => chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
exports.until = async (pg, fn, arg, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await pg.evaluate(fn, arg).catch(() => false); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + fn.toString().slice(0, 80)); await new Promise((r) => setTimeout(r, 150)); } };
exports.watch = (pg, name, errs) => { pg.on('console', (m) => { if (m.type() === 'error') { errs.push(`[${name}] ${m.text().slice(0, 240)}`); } }); pg.on('pageerror', (e) => errs.push(`[${name}] PAGEERR ${e.message}`)); };
