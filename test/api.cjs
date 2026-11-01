// In-process API tests: vendor booths (grant rules, editing, moderation, images, admin) and the Info Booth guide.
process.env.SERVER_SECRET = 'api-secret'; process.env.ADMIN_SECRET = 'admin-secret-0123456789'; process.env.PORT = '3198'; process.env.REPORT_MIN_AGE_MS = '0';  process.env.VENDOR_BOOTHS = '8'; process.env.MINT_NETWORK = 'devnet'; process.env.VENDOR_RATE_LIMIT = '1000';
const assert = require('assert'); const crypto = require('crypto'); const S = require('../server.js');
const BASE = 'http://127.0.0.1:3198', H = { origin: BASE, 'content-type': 'application/json' };
const jpeg = (w, h, pad = 300) => { const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]); return Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe0, 0, 4, 0, 0]), sof, crypto.randomBytes(pad), Buffer.from([0xff, 0xd9])]); };
const post = async (p, body, h = H) => { const r = await fetch(BASE + p, { method: 'POST', headers: h, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
(async () => {
  await S.init(); await new Promise((r) => S.server.listen(3198, '127.0.0.1', r));
  const mk = (nick) => { const r = S.profiles.create(nick, {}); return { id: r.prof.id, secret: r.secret, nick: r.prof.nick }; };
  const A = mk('Vendora'), B = mk('Buyerb'), C = mk('Reporter1'), D = mk('Reporter2'), E = mk('Reporter3'), F = mk('Newbie');
  await t('vendor rules: config', () => { assert.strictEqual(S.vcfg.plots, 8); assert.strictEqual(S.vcfg.feeUsd, 30); assert.strictEqual(S.vcfg.days, 30); });
  await t('claim a plot: grants 30 days, plot locked, duplicate signature refused, one booth per profile', () => {
    const v = S.vendors; assert(v.canBuy(A.id, 3).ok); const g = v.grant({ pid: A.id, nick: A.nick, plot: 3, sig: 'sigA1', usd: 30 }); assert(g.ok && g.mode === 'claim'); assert(Math.abs(g.booth.expiresAt - Date.now() - 30 * 86400000) < 5000);
    assert(!v.canBuy(B.id, 3).ok, 'taken'); assert(!v.grant({ pid: B.id, nick: B.nick, plot: 3, sig: 'sigA1', usd: 30 }).ok, 'signature reuse'); assert.strictEqual(v.canBuy(A.id, 5).mode, 'renew', 'owner buying again renews'); assert(!v.canBuy(B.id, 99).ok); assert(!v.canBuy(B.id, 'x').ok); });
  await t('renew extends from the current expiry (no days lost)', () => { const v = S.vendors; const b = v.byPid.get(A.id); const before = b.expiresAt; const g = v.grant({ pid: A.id, nick: A.nick, plot: 3, sig: 'sigA2', usd: 30 }); assert.strictEqual(g.mode, 'renew'); assert.strictEqual(g.booth.expiresAt, before + 30 * 86400000); });
  await t('plot hold: two buyers cannot get the same plot', () => { const v = S.vendors; v.hold(6, B.id); assert(!v.canBuy(F.id, 6).ok); assert(v.canBuy(B.id, 6).ok); });
  await t('image API: needs a booth, JPEG only, size and dimension limits, owner-only references', async () => {
    const ok = jpeg(256, 256); let r = await post('/api/vendor/img', { id: F.id, secret: F.secret, data: ok.toString('base64') }); assert.strictEqual(r.s, 403, 'no booth, no upload');
    r = await post('/api/vendor/img', { id: A.id, secret: 'x'.repeat(40), data: ok.toString('base64') }); assert.strictEqual(r.s, 401);
    r = await post('/api/vendor/img', { id: A.id, secret: A.secret, data: Buffer.from('<svg onload=alert(1)>').toString('base64') }); assert.strictEqual(r.s, 400);
    r = await post('/api/vendor/img', { id: A.id, secret: A.secret, data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(400)]).toString('base64') }); assert.strictEqual(r.s, 400, 'png rejected');
    r = await post('/api/vendor/img', { id: A.id, secret: A.secret, data: jpeg(4000, 4000).toString('base64') }); assert.strictEqual(r.s, 400, 'dimension');
    r = await post('/api/vendor/img', { id: A.id, secret: A.secret, data: jpeg(300, 300, 160 * 1024).toString('base64') }); assert.strictEqual(r.s, 400, 'size');
    r = await post('/api/vendor/img', { id: A.id, secret: A.secret, data: ok.toString('base64') }); assert.strictEqual(r.s, 200); A.img = r.j.id; assert(/^[0-9a-f]{20}$/.test(A.img));
    r = await post('/api/vendor/img', { id: A.id, secret: A.secret, data: ok.toString('base64'), }, { 'content-type': 'application/json', origin: 'https://evil.example' }); assert.strictEqual(r.s, 403, 'origin lock');
    S.vendors.grant({ pid: B.id, nick: B.nick, plot: 6, sig: 'sigB1', usd: 30 }); r = await post('/api/vendor/save', { id: B.id, secret: B.secret, name: 'Bee Booth', products: [{ img: A.img, title: 'stolen' }] }); assert.strictEqual(r.s, 400, 'cannot reference someone else\'s image'); });
  await t('save booth: validates text, link (https only), colors, products <= 6', async () => {
    const base = { id: A.id, secret: A.secret, name: 'Dub Parts Depot', desc: 'Genuine and used air-cooled parts.', link: 'https://example.com/shop', tent: 2, c1: '#118ab2', c2: '#ffd166', logo: A.img, banner: null, products: [{ img: A.img, title: 'Rocker panel' }] };
    for (const [patch, why] of [[{ link: 'http://example.com' }, 'http'], [{ link: 'javascript:alert(1)' }, 'js'], [{ link: 'https://user:pw@example.com' }, 'creds'], [{ link: 'https://127.0.0.1/x' }, 'ip'], [{ link: 'https://localhost/x' }, 'local'], [{ name: 'ab' }, 'short'], [{ name: 'f u c k shop' }, 'profane'], [{ desc: 'visit www.scam.com now' }, 'link in desc'], [{ products: Array(7).fill({ img: A.img, title: 'x' }) }, 'many products (6 max -> extra ignored)']]) {
      const r = await post('/api/vendor/save', { ...base, ...patch }); if (why.startsWith('many')) assert.strictEqual(r.s, 200); else assert.strictEqual(r.s, 400, why); }
    const r = await post('/api/vendor/save', base); assert.strictEqual(r.s, 200); const d = (await (await fetch(BASE + '/api/vendors/3')).json()).booth; assert.strictEqual(d.name, 'Dub Parts Depot'); assert.strictEqual(d.link, 'https://example.com/shop'); assert.strictEqual(d.tent, 2); assert.strictEqual(d.products.length, 1); assert(d.exp > Date.now()); assert(!('pid' in d)); });
  await t('image is served only with safe headers while the booth is visible', async () => {
    const r = await fetch(`${BASE}/vendor/img/${A.img}.jpg`); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'image/jpeg'); assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff'); assert(/sandbox/.test(r.headers.get('content-security-policy')));
    assert.strictEqual((await fetch(`${BASE}/vendor/img/${'0'.repeat(20)}.jpg`)).status, 404); assert.strictEqual((await fetch(`${BASE}/vendor/img/../../server.js`)).status, 404); });
  await t('directory lists only open booths; HTML in names is returned as plain data (client renders with textContent)', async () => { const j = await (await fetch(BASE + '/api/vendors')).json(); assert(j.list.some((b) => b.plot === 3 && b.name === 'Dub Parts Depot')); assert(j.list.every((b) => b.state === 'open' || b.state === 'grace')); });
  await t('reports: own booth refused, 3 unique reporters auto-hide, hidden booth disappears (and its images)', async () => {
    let r = await post('/api/vendor/report', { id: A.id, secret: A.secret, plot: 3 }); assert.strictEqual(r.s, 400);
    for (const u of [C, D, C]) r = await post('/api/vendor/report', { id: u.id, secret: u.secret, plot: 3 }); assert.strictEqual(S.vendors.booths.get(3).hidden, false, 'duplicate reporter does not count twice');
    r = await post('/api/vendor/report', { id: E.id, secret: E.secret, plot: 3 }); assert.strictEqual(r.s, 200); assert.strictEqual(S.vendors.booths.get(3).hidden, 'reports');
    assert.strictEqual((await fetch(BASE + '/api/vendors/3')).status, 404); assert.strictEqual((await fetch(`${BASE}/vendor/img/${A.img}.jpg`)).status, 404); });
  await t('admin API: off without matching secret, unhide/hide/remove/restore/extend', async () => {
    const Hs = (s) => ({ ...H, 'x-admin-secret': s }); let r = await fetch(BASE + '/api/admin/vendors'); assert.strictEqual(r.status, 401); r = await fetch(BASE + '/api/admin/vendors', { headers: { 'x-admin-secret': 'wrong-secret-0123456789' } }); assert.strictEqual(r.status, 401);
    r = await fetch(BASE + '/api/admin/vendors', { headers: { 'x-admin-secret': process.env.ADMIN_SECRET } }); const list = (await r.json()).booths; assert(list.find((b) => b.plot === 3).reports >= 3);
    r = await post('/api/admin/vendors/3', { action: 'unhide' }, Hs(process.env.ADMIN_SECRET)); assert.strictEqual(r.s, 200); assert.strictEqual((await fetch(BASE + '/api/vendors/3')).status, 200);
    await post('/api/admin/vendors/3', { action: 'remove' }, Hs(process.env.ADMIN_SECRET)); assert.strictEqual((await fetch(BASE + '/api/vendors/3')).status, 404); assert(!S.vendors.canBuy(F.id, 3).ok, 'removed plot stays locked'); assert(!S.vendors.canBuy(A.id, 3).ok);
    await post('/api/admin/vendors/3', { action: 'restore' }, Hs(process.env.ADMIN_SECRET)); assert.strictEqual((await fetch(BASE + '/api/vendors/3')).status, 200);
    const e0 = S.vendors.booths.get(3).expiresAt; await post('/api/admin/vendors/3', { action: 'extend', days: 5 }, Hs(process.env.ADMIN_SECRET)); assert.strictEqual(S.vendors.booths.get(3).expiresAt, e0 + 5 * 86400000);
    r = await post('/api/admin/vendors/3', { action: 'bogus' }, Hs(process.env.ADMIN_SECRET)); assert.strictEqual(r.s, 400); });
  await t('expiry: closed after the term, plot reopens after the grace period, renewal inside grace keeps the plot', () => {
    let now = Date.now(); const { Vendors } = require('../lib/vendors'); const v = new Vendors({ plots: 4, days: 30, graceDays: 7, now: () => now }); v.grant({ pid: 'p1', nick: 'Pat', plot: 2, sig: 's1', usd: 30 });
    now += 31 * 86400000; assert.strictEqual(v.list()[0].state, 'grace'); assert(!v.detail(2), 'closed booth has no panel'); assert(!v.canBuy('p2', 2).ok, 'plot still reserved for renewal'); assert.strictEqual(v.canBuy('p1', 9).mode, 'renew');
    const g = v.grant({ pid: 'p1', nick: 'Pat', plot: 9, sig: 's2', usd: 30 }); assert.strictEqual(g.booth.plot, 2); assert(g.booth.expiresAt > now);
    now += 40 * 86400000; assert.strictEqual(v.list().length, 0); assert(v.canBuy('p2', 2).ok, 'plot is free again'); });
  await t('premod: images stay hidden until approved', () => { const { Vendors } = require('../lib/vendors'); const v = new Vendors({ plots: 4, premod: true }); v.grant({ pid: 'p', nick: 'Pat', plot: 1, sig: 'x', usd: 30 }); const im = v.addImage('p', jpeg(64, 64)); v.edit('p', { name: 'Hello Shop', logo: im.id, products: [{ img: im.id, title: '' }] }); assert(!v.detail(1).logo && v.detail(1).products.length === 0 && v.detail(1).pending); assert(!v.imageVisible(im.id)); v.admin(1, 'approve'); assert(v.detail(1).logo); });
  await t('quote rules for vendors (no token discount, dev fee only on SOL)', async () => {
    const { Pay } = require('../lib/pay'); const P = new Pay({ network: 'devnet', mint: 'M', decimals: 6, jupiter: 'x', slippageBps: 50, devWallet: 'W'.repeat(40), devnetTokensPerUsd: 10, fixedSolUsd: 100 });
    const tok = await P.compute({ usd: 30, method: 'vwfest', devWalletOk: true, devPct: S.mint.devFeePct, discountPct: 0 }); assert.strictEqual(tok.paidUsd, 30); assert.strictEqual(tok.devLamports, '0'); assert.strictEqual(tok.burnRaw, String(300 * 1e6));
    const sol = await P.compute({ usd: 30, method: 'sol', devWalletOk: true, devPct: S.mint.devFeePct, discountPct: 0 }); assert.strictEqual(sol.devLamports, String(0.3 * 0.5 * 1e9)); assert.strictEqual(+sol.burnUi, 150); });
  await t('guide endpoint renders live values', async () => { const j = await (await fetch(BASE + '/api/guide')).json(); assert(j.ok && j.sections.length >= 10 && j.changelog.length >= 2); assert.strictEqual(j.values.vendorFeeUsd, '$30'); assert.strictEqual(j.values.boothCount, '8'); assert(JSON.stringify(j.sections).includes('8 booth plots')); });
  console.log(`\nall ${n} api tests ${process.exitCode ? 'FINISHED WITH FAILURES' : 'passed'}`); S.server.close(); setTimeout(() => process.exit(process.exitCode || 0), 300);
})();
