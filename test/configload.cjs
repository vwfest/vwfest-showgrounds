// /api/config must not hold the join form shut while a sleeping host sends zero bytes.
process.env.SERVER_SECRET = 'cfg-test-secret-0123456789abcdef'; process.env.PORT = '3411'; process.env.PROFILE_CREATE_PER_HOUR = '1000';
const assert = require('assert'); const { launch, until } = require('./lib.cjs'); const S = require('../server.js');
const BASE = 'http://127.0.0.1:3411/';
(async () => {
  const { loadConfig, isConfig, fallbackConfig, configAttemptPlan, loadConfigAttempts } = await import('../src/configload.mjs');
  const plan = configAttemptPlan();
  assert.strictEqual(plan[0].timeoutMs, 8000); assert.strictEqual(plan[0].waitBefore, 0); assert(plan.length >= 4);
  const fb = fallbackConfig(); assert.deepStrictEqual(fb.shop, []); assert.deepStrictEqual(fb.odds, []); assert.strictEqual(typeof fb.voiceRange, 'number');
  const good = { shop: [{ id: 'a' }], odds: [{ tier: 'Common', pct: 55 }], network: 'devnet', voiceRange: 15, enabled: false };
  assert.strictEqual(isConfig(good), true); assert.strictEqual(isConfig({ error: 'Too many requests' }), false); assert.strictEqual(isConfig({ shop: [], odds: [], network: 'devnet' }), false);
  const hung = (url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const t0 = Date.now(); const hungR = await loadConfig(hung, 'http://x/api/config', { timeoutMs: 250 });
  assert.strictEqual(hungR.ok, false); assert.strictEqual(hungR.aborted, true); assert(Date.now() - t0 < 1500, 'hung config was not aborted');
  const bad = async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } });
  assert.strictEqual((await loadConfig(bad, 'http://x/api/config', { timeoutMs: 500 })).ok, false);
  const shape = async () => ({ ok: true, status: 200, json: async () => ({ error: 'Server error' }) });
  assert.strictEqual((await loadConfig(shape, 'http://x/api/config', { timeoutMs: 500 })).why, 'shape');
  let calls = 0; const flaky = async () => { calls++; if (calls < 2) return { ok: false, status: 503, json: async () => ({}) }; return { ok: true, status: 200, json: async () => good }; };
  const got = await loadConfigAttempts(flaky, 'http://x/api/config', { plan: [{ timeoutMs: 500, waitBefore: 0 }, { timeoutMs: 500, waitBefore: 10 }], wait: (ms) => new Promise((r) => setTimeout(r, ms)) });
  assert.strictEqual(got.ok, true); assert.strictEqual(got.cfg.network, 'devnet'); assert.strictEqual(calls, 2);
  console.log('ok   configload unit');

  await S.init(); await new Promise((r) => S.server.listen(3411, '127.0.0.1', r));
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const pg = await ctx.newPage();
  pg.setDefaultTimeout(20000);
  let held = 0;
  await pg.route('**/api/config', async (route) => {
    held++;
    if (held === 1) { await new Promise((r) => setTimeout(r, 20000)); try { await route.abort(); } catch {} return; }
    await route.continue();
  });
  const nav = Date.now();
  await pg.goto(BASE + '?quality=low&cfgms=400');
  await until(pg, () => !!document.querySelector('input[aria-label=Nickname]'), null, 20000);
  const waited = Date.now() - nav;
  assert(waited < 10000, 'join form waited ' + waited + 'ms on a hung /api/config');
  const text = await pg.locator('#joinbody').innerText();
  assert(/Create your profile|Reaching the server/.test(text), text.slice(0, 180));
  await until(pg, () => window.__sg && window.__sg.state.cfg && window.__sg.state.cfg.shop && window.__sg.state.cfg.shop.length > 3, null, 20000);
  assert.strictEqual(await pg.evaluate(() => window.__sg.state.cfg.network), 'devnet');
  console.log('ok   join form appears while /api/config is held open (' + waited + 'ms), then the real config replaces the fallback');
  await b.close(); S.server.close();
  setTimeout(() => process.exit(0), 200);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
