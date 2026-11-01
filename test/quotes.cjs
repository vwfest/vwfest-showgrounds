// Purchase flow through the real quote -> proof -> buy path with solana/ (CHAIN_FAKE=1). Derived from security.cjs helpers.
// Security regression tests: RPC proxy gating (1), concurrent-submit race in the burn ledger (2), shop grant after a verified burn (3),
// wallet-ownership proof, TURN credentials only over the WebSocket (6), per-IP profile creation limit (10).
const http = require('http'); const crypto = require('crypto'); const assert = require('assert'); const WebSocket = require('ws');
const PORT = 3363, UP = 3364, BASE = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { SERVER_SECRET: 'security-test-secret-0123456789', PORT: String(PORT), MINT_NETWORK: 'devnet', MINT_ENABLED: '1', CHAIN_FAKE: '1', FIXED_SOL_USD: '150', DEV_WALLET: 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok', VWFEST_MINT: '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', SOLANA_RPC_URL: `http://127.0.0.1:${UP}`, RPC_WRITE_PER_MIN: '5', PROFILE_CREATE_PER_HOUR: '6', TURN_URL: 'turn:turn.example.com:3478', TURN_SECRET: 'turn-secret-xyz', MAX_CONNS_PER_IP: '100', DEV_WALLET: '11111111111111111111111111111112' });
const S = require('../server.js'); const { Burns } = require('../lib/burns');
const seen = []; const upstream = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const j = JSON.parse(b); seen.push(j); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: 'ok' })); }); });
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
const H = { origin: BASE, 'content-type': 'application/json' };
const rpc = (body, headers = {}) => fetch(BASE + '/api/rpc', { method: 'POST', headers: { ...H, ...headers }, body: JSON.stringify(body) });
const client = (nick) => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: BASE } }); const c = { ws, msgs: [], waiters: [] }; ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter((w) => !(w.t === m.t && (w.f(m), true))); }); c.wait = (t, ms = 4000) => new Promise((r2, j2) => { const old = c.msgs.find((m) => m.t === t && !m._seen); if (old) { old._seen = true; return r2(old); } const to = setTimeout(() => j2(new Error('timeout ' + t)), ms); c.waiters.push({ t, f: (m) => { clearTimeout(to); m._seen = true; r2(m); } }); }); c.send = (o) => ws.send(JSON.stringify(o)); ws.on('open', () => res(c)); ws.on('error', rej); c.nick = nick; });
const join = async (nick) => { const c = await client(nick); await c.wait('hi'); c.send({ t: 'join', nick }); const w = await Promise.race([c.wait('welcome'), c.wait('joinerr').then((m) => { throw new Error('joinerr ' + m.why); })]); c.welcome = w; return c; };
const b58 = (buf) => { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let x = BigInt('0x' + buf.toString('hex')), s = ''; while (x > 0n) { s = A[Number(x % 58n)] + s; x /= 58n; } for (const v of buf) { if (v === 0) s = '1' + s; else break; } return s; };

(async () => {
  await S.init(); await new Promise((r) => upstream.listen(UP, '127.0.0.1', r)); await new Promise((r) => S.server.listen(PORT, '127.0.0.1', r));
  const Q = require('../lib/quoteid'), secret = require('../lib/secret');
  const C = await join('Buyer1'); const pid = C.welcome.pid; const kp = crypto.generateKeyPairSync('ed25519'); const pub = b58(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  const ask = async (m) => { await new Promise((r) => setTimeout(r, 1300)); C.send({ t: 'quote', ...m }); const r = await Promise.race([C.wait('quote'), C.wait('quoteerr').then((e) => { throw new Error('quoteerr ' + e.why); })]); C.msgs = C.msgs.filter((x) => x.t !== 'quote'); return r.q; };
  const sigs = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').map((c) => c.repeat(88)); let k = 0;
  const buy = async (qid, sig = sigs[k++]) => { C.msgs = C.msgs.filter((x) => x.t !== 'buyres'); C.send({ t: 'buy', qid, sig, wallet: pub }); return C.wait('buyres'); };
  C.send({ t: 'wauth', pubkey: pub }); const ch = await C.wait('wchal'); C.send({ t: 'wproof', pubkey: pub, nonce: ch.nonce, sig: crypto.sign(null, Buffer.from(ch.message), kp.privateKey).toString('base64') }); assert((await C.wait('wok')).ok);
  const restart = () => { S.pay.quotes.clear(); S.pay.active.clear(); }; // what a server restart does to the in-memory cache

  await t('quote ids are HMAC-signed and self-describing: tamper, truncation and another secret are all rejected', () => {
    const id = Q.sign(secret, { kind: 'shop', method: 'sol', pid: 'VW-ABC', item: 'halo', burnMin: '123456789', devMin: '5', expires: Date.now() + 1e6 }); const v = Q.verify(secret, id);
    assert(v && v.kind === 'shop' && v.item === 'halo' && v.pid === 'VW-ABC' && v.burnMin === '123456789' && v.devMin === '5' && v.method === 'sol'); assert.strictEqual(Q.verify('another-secret-another-secret-0123456789', id), null);
    for (let i = 1; i < id.length; i += 7) { const bad = id.slice(0, i) + (id[i] === 'A' ? 'B' : 'A') + id.slice(i + 1); assert.strictEqual(Q.verify(secret, bad), null, 'flip at ' + i); } assert.strictEqual(Q.verify(secret, id.slice(0, -2)), null); assert.strictEqual(Q.verify(secret, 'q'), null); assert.strictEqual(Q.verify(secret, 'qdeadbeefdeadbeef'), null);
    const a = Q.sign(secret, { kind: 'avatar', method: 'sol', pid: 'VW-ABCDEFGH', code: 'BgEABg4AAAEGAQMDARABAgQEAgEGAAQA', burnMin: '123456789012', devMin: '0', expires: Date.now() + 1e6 }); assert(a.length < 110, 'memo stays small: ' + a.length); });
  await t('a purchase survives a server restart: the quote cache is wiped, the buy still credits (signed id re-verified, burn checked against the signed minimums)', async () => {
    const q = await ask({ kind: 'shop', item: 'halo', method: 'sol' }); restart(); assert.strictEqual(S.pay.quotes.size, 0); const r = await buy(q.id); assert(r.ok, r.why); assert(S.profiles.byId.get(pid).items.has('halo')); });
  await t('a buy that arrives AFTER the quote expired is still honored (expiry only blocks starting a payment)', async () => {
    const rec = S.pay.create({ kind: 'shop', item: 'rainbow_beanie', pid, method: 'sol', usd: 2, paidUsd: 2, burnMin: '1', devMin: '0', burnRaw: '1', devPct: 0, devWallet: null }, -3600e3); assert(rec.expires < Date.now()); restart();
    const r = await buy(rec.id); assert(r.ok, JSON.stringify(r)); assert(!/Unknown quote|expired/i.test(r.why || ''), 'not refused as unknown/expired: ' + r.why); });
  await t('forged / foreign quote ids are refused: unsigned id, another player\'s id, edited minimum', async () => {
    let r = await buy('q' + 'ab'.repeat(7)); assert(!r.ok && /Unknown quote/.test(r.why)); const other = Q.sign(secret, { kind: 'shop', method: 'sol', pid: 'VW-SOMEONEELSE', item: 'halo', burnMin: '1', devMin: '0', expires: Date.now() + 1e6 }); r = await buy(other); assert(!r.ok && /Unknown quote/.test(r.why));
    const own = Q.sign(secret, { kind: 'shop', method: 'sol', pid, item: 'halo', burnMin: '1', devMin: '0', expires: Date.now() + 1e6 }); const raw = Buffer.from(own.slice(1), 'base64url'); raw[8] ^= 1; r = await buy('q' + raw.toString('base64url')); assert(!r.ok && /Unknown quote/.test(r.why)); });
  await t('one quote is redeemed by exactly ONE burn: a second transaction with the same quote id is refused; the same signature is recorded once', async () => {
    const q = await ask({ kind: 'ride', method: 'sol' }); const s1 = sigs[k++], s2 = sigs[k++]; const r1 = await buy(q.id, s1); assert(r1.ok, r1.why); const before = S.burns.list.length;
    const r2 = await buy(q.id, s2); assert(!r2.ok && /already used/i.test(r2.why), JSON.stringify(r2)); const r3 = await buy(q.id, s1); assert.strictEqual(S.burns.list.length, before, 'no second ledger row'); assert(S.burns.list.filter((b) => b.sig === s1).length === 1); });
  await t('crash recovery: a burn recorded in the ledger but never delivered is delivered when the player retries the same signature', async () => {
    const q = await ask({ kind: 'shop', item: 'top_hat', method: 'sol' }); const sig = sigs[k++]; const real = S.profiles.grant.bind(S.profiles); S.profiles.grant = () => { throw new Error('simulated crash after the burn was recorded'); };
    let r; try { r = await buy(q.id, sig); } finally { S.profiles.grant = real; } assert(!r.ok, 'first attempt failed'); assert(!S.profiles.byId.get(pid).items.has('top_hat'));
    restart(); r = await buy(q.id, sig); assert(r.ok, JSON.stringify(r)); assert(S.profiles.byId.get(pid).items.has('top_hat'), 'delivered by the retry'); const r2 = await buy(q.id, sig); assert(r2.ok, 'retrying again is idempotent'); });
  await t('a player holds ONE open quote per item: asking again inside the window returns the same quote; later asks supersede the cached one', async () => {
    const a = await ask({ kind: 'shop', item: 'neon_shades', method: 'sol' }); const b = await ask({ kind: 'shop', item: 'neon_shades', method: 'sol' }); assert.strictEqual(a.id, b.id, 'same quote inside the cache window');
    const c = S.pay.create({ ...S.pay.quotes.get(a.id), expires: undefined }); assert.notStrictEqual(c.id, a.id); assert(!S.pay.quotes.has(a.id), 'old quote dropped from the cache'); assert.strictEqual([...S.pay.quotes.values()].filter((x) => x.pid === pid && x.item === 'neon_shades').length, 1); });
  console.log(process.exitCode ? 'QUOTE TESTS FAILED' : `all ${n} quote tests passed`); process.exit(process.exitCode || 0);
})();
