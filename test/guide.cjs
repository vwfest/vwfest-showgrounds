// The Info Booth guide must never go stale: (1) no hard-coded prices/percentages/durations in docs/info.json or CHANGELOG.md,
// (2) every {token} resolves, (3) with different server config the rendered guide shows exactly the new values.
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
const root = path.join(__dirname, '..'); const info = fs.readFileSync(path.join(root, 'docs/info.json'), 'utf8'); const md = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const LITERAL = /\$\s?\d|\d\s?%|\b\d+\s*(days?|meters?|metres?|KB|minutes?|booths?|plots?|players?|people)\b/i;
const ok = (n) => console.log('ok  ', n);
for (const [name, text] of [['docs/info.json', info.replace(/"_note":[^\n]*/, '')], ['CHANGELOG.md', md]]) { const m = text.split('\n').find((l) => LITERAL.test(l.replace(/\{[^}]+\}/g, ''))); assert(!m, `${name} has a hard-coded value (use a {token}): ${m}`); }
ok('no hard-coded prices, percentages or durations in info.json / CHANGELOG.md');
const tokens = new Set([...(info.replace(/"_note":[^\n]*/, '') + md).matchAll(/\{([A-Za-z0-9_.]+)\}/g)].map((m) => m[1]));
const run = (env) => new Promise((resolve, reject) => {
  const port = 3300 + Math.floor(Math.random() * 500); const c = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), SERVER_SECRET: 'x', MINT_NETWORK: 'devnet', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let up = false; const done = async () => { try { const j = await (await fetch(`http://127.0.0.1:${port}/api/guide`)).json(); const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json(); c.kill(); resolve({ j, cfg }); } catch (e) { c.kill(); reject(e); } };
  c.stdout.on('data', (d) => { if (!up && /listening/.test(String(d))) { up = true; done(); } }); c.on('error', reject); setTimeout(() => { c.kill(); reject(new Error('server did not start')); }, 20000);
});
(async () => {
  const base = await run({}); for (const t of tokens) assert(t in base.j.values, `unknown token {${t}} (add it to lib/guide.js values())`); assert(!/\{[A-Za-z0-9_.]+\}/.test(JSON.stringify(base.j.sections) + JSON.stringify(base.j.changelog)), 'unresolved token in rendered guide'); ok('every token resolves');
  const txt = (r) => JSON.stringify(r.j.sections) + JSON.stringify(r.j.changelog);
  const must = (r, v, label) => assert(txt(r).includes(v), `guide should show ${label} = ${v}`);
  // defaults match the live config the client uses for pricing
  must(base, `$${base.cfg.feeUsd}`, 'avatar fee'); must(base, `$${base.cfg.rideUsd}`, 'ride fee'); must(base, `${base.cfg.discountPct}%`, 'token discount'); must(base, `${base.cfg.devFeePct}%`, 'dev fee'); must(base, `$${base.cfg.vendor.feeUsd}`, 'vendor fee'); must(base, `${base.cfg.vendor.days} days`, 'vendor days'); must(base, `${base.cfg.maxPlayers}`, 'max players'); must(base, `${base.cfg.voiceRange}`, 'voice range'); must(base, `$${base.cfg.entryUsd}`, 'entry usd');
  for (const o of base.cfg.odds) must(base, `${o.pct}%`, 'odds ' + o.tier); const prices = base.cfg.shop.map((i) => i.usd); must(base, `$${Math.min(...prices)}`, 'cheapest item'); must(base, `$${Math.max(...prices)}`, 'priciest item'); ok('defaults: guide values equal /api/config values');
  const alt = await run({ MINT_FEE_USD: '7', RIDE_MINT_USD: '9', DEV_FEE_PCT: '15', VWFEST_DISCOUNT_PCT: '40', VENDOR_FEE_USD: '45', VENDOR_DAYS: '14', VENDOR_BOOTHS: '18', MAX_PLAYERS: '120', VOICE_RANGE: '20', ENTRY_ONRAMP_USD: '8', VENDOR_IMG_KB: '90', VENDOR_AUTOHIDE_REPORTS: '5', SHOP_PRICE_MULT: '2' });
  for (const [v, l] of [['$7', 'MINT_FEE_USD'], ['$9', 'RIDE_MINT_USD'], ['15%', 'DEV_FEE_PCT'], ['85%', 'burn share'], ['40%', 'VWFEST_DISCOUNT_PCT'], ['$45', 'VENDOR_FEE_USD'], ['14 days', 'VENDOR_DAYS'], ['18 booth plots', 'VENDOR_BOOTHS'], ['120', 'MAX_PLAYERS'], ['20 meters', 'VOICE_RANGE'], ['$8', 'ENTRY_ONRAMP_USD'], ['90 KB', 'VENDOR_IMG_KB'], ['5 different players', 'VENDOR_AUTOHIDE_REPORTS']]) must(alt, v, l);
  const ap = alt.cfg.shop.map((i) => i.usd); must(alt, `$${Math.max(...ap)}`, 'SHOP_PRICE_MULT max'); assert(!txt(alt).includes('50%') || alt.cfg.odds.some((o) => o.pct === 50), 'stale 50% discount text'); assert(!txt(alt).includes('30 days'), 'stale 30 days');
  ok('changed env -> guide shows the new fee, discount, dev fee, vendor price/days/booths, shop range, limits'); console.log('\nguide tests passed'); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
