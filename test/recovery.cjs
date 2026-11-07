// Join handshake (JoinFlow) + wallet profile recovery: nonce single-use, purpose/domain/wallet binding, only NFT-minting wallets, secret rotation,
// no claim of a profile outside the proven list, rate limits; and a 2-client join smoke test.
const assert = require('assert'); const crypto = require('crypto'); const WebSocket = require('ws');
const PORT = 3417, BASE = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { JOIN_COOLDOWN_MS: '0', SERVER_SECRET: 'recovery-test-secret-0123456789abcdef', PORT: String(PORT), MINT_NETWORK: 'devnet', MINT_ENABLED: '1', CHAIN_FAKE: '1', VWFEST_MINT: '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', DEV_WALLET: 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok', FIXED_SOL_USD: '150', SOLANA_RPC_URL: 'http://127.0.0.1:1', MAX_CONNS_PER_IP: '200', PROFILE_CREATE_PER_HOUR: '100', RECOVER_PER_10MIN: '30', PREJOIN_MS: '400' });
const S = require('../server.js'); const W = require('../lib/walletauth');
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
const client = (origin = BASE) => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin } }); const c = { ws, msgs: [], waiters: [] }; ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter((w) => !(w.t === m.t && (w.f(m), true))); }); c.wait = (ty, ms = 3000) => new Promise((r2, j2) => { const old = c.msgs.find((m) => m.t === ty && !m._seen); if (old) { old._seen = true; return r2(old); } const to = setTimeout(() => j2(new Error('timeout ' + ty)), ms); c.waiters.push({ t: ty, f: (m) => { clearTimeout(to); m._seen = true; r2(m); } }); }); c.send = (o) => ws.send(JSON.stringify(o)); ws.on('open', () => res(c)); ws.on('error', rej); });
const b58 = (buf) => { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let x = BigInt('0x' + buf.toString('hex')), s = ''; while (x > 0n) { s = A[Number(x % 58n)] + s; x /= 58n; } for (const b of buf) { if (b) break; s = '1' + s; } return s; };
const kp = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12); return { pk: b58(raw), sign: (msg) => crypto.sign(null, Buffer.from(msg), privateKey).toString('base64') }; };
const join = async (c, msg) => { c.send({ t: 'join', ...msg }); return Promise.race([c.wait('welcome'), c.wait('joinerr').then((m) => { throw new Error('joinerr ' + m.err); })]); };
const recover = async (c, w) => { c.send({ t: 'rauth', pubkey: w.pk }); const ch = await c.wait('rchal'); c.send({ t: 'rproof', pubkey: w.pk, nonce: ch.nonce, sig: w.sign(ch.message) }); return { ch, r: await c.wait('rres') }; };

(async () => {
  const { JoinFlow } = await import('../src/joinflow.mjs');
  await t('JoinFlow: join held while the socket is down, sent on open, re-sent on a NEW socket after the old one closed under it', async () => {
    const sent = [], st = []; const net = { ready: false, json: (m) => sent.push(m), restart() { this.ready = false; this.restarts = (this.restarts || 0) + 1; } };
    const f = new JoinFlow(net, { status: (k) => st.push(k), answerMs: 30, maxTries: 3, wakeMs: 10, slowMs: 10 });
    f.start({ t: 'join', nick: 'A' }); assert.strictEqual(sent.length, 0); assert.strictEqual(st[0], 'reaching');
    net.ready = true; f.onOpen(); assert.strictEqual(sent.length, 1);
    net.ready = false; f.onClose(); net.ready = true; f.onOpen(); assert.strictEqual(sent.length, 2, 'the join survives the socket closing (the old bug: dropped and never re-sent)');
    f.done(); await new Promise((r) => setTimeout(r, 60)); assert.strictEqual(net.restarts || 0, 0, 'no retry after an answer');
  });
  await t('JoinFlow: no answer -> fresh connection + re-send, then a clear failure (never "Connecting…" forever), retry() starts over', async () => {
    const sent = [], st = []; const net = { ready: true, json: (m) => sent.push(m), restart() { this.ready = false; setTimeout(() => { this.ready = true; f.onOpen(); }, 5); } };
    const f = new JoinFlow(net, { status: (k) => st.push(k), answerMs: 20, maxTries: 3 });
    f.start({ t: 'join', nick: 'B' }); await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(sent.length, 3); assert.strictEqual(st[st.length - 1], 'failed'); assert.strictEqual(f.pending, null);
    f.retry(); assert.strictEqual(sent.length, 4); f.done();
  });

  await S.init(); await new Promise((r) => S.server.listen(PORT, '127.0.0.1', r));
  const owner = kp(), other = kp(), friend = kp();
  const a = await client(); await a.wait('hi'); const wa = await join(a, { nick: 'Ghia Owner', quiz: {} }); const credA = wa.cred;
  const b = await client(); await b.wait('hi'); const wb = await join(b, { nick: 'Bystander', quiz: {} });
  // A minted a ride to `owner`; `friend` only paid for a shop item of B (not an NFT) -> must not recover B
  S.rides.reveal({ id: 'ridetest' + Date.now(), pid: credA.id, sig: 'sig' + Date.now(), asset: null, wallet: owner.pk });
  S.burns.add({ kind: 'shop', item: 'x', pid: wb.pid, sig: 'shopsig' + Date.now(), wallet: friend.pk, amount: '1', ts: Date.now() });

  await t('2 websocket clients join and see each other', async () => {
    assert(wb.roster.some((p) => p.id === wa.id), 'B sees A in the roster'); const pa = a.msgs.find((m) => m.t === 'p+' && m.id === wb.id) || await a.wait('p+'); assert.strictEqual(pa.id, wb.id);
  });
  await t('real Net + JoinFlow over a socket the server drops before join (PREJOIN_MS) -> still joins, no hang', async () => {
    globalThis.WebSocket = class extends WebSocket { constructor(u) { super(u, { headers: { origin: BASE } }); } };
    const tmp = require('path').join(require('os').tmpdir(), 'sg-net-' + process.pid + '.mjs'); require('fs').copyFileSync(require('path').join(__dirname, '../src/net.js'), tmp); const { Net } = await import(tmp); const net = new Net(`ws://127.0.0.1:${PORT}/ws`); const st = [];
    const f = new JoinFlow(net, { status: (k) => st.push(k), answerMs: 3000 }); let welcome = null; net.on.open = () => f.onOpen(); net.on.close = () => f.onClose(); net.on.welcome = (m) => { welcome = m; f.done(); };
    net.connect(); await new Promise((r) => setTimeout(r, 900)); // idle on the join screen past the server's pre-join window: the socket is closed under us
    f.start({ t: 'join', nick: 'Slow Joiner', quiz: {} }); for (let i = 0; i < 60 && !welcome; i++) await new Promise((r) => setTimeout(r, 100));
    assert(welcome && welcome.nick === 'Slow Joiner', 'joined after reconnect: ' + st.join(',')); net.close();
  });
  await t('recovery: domain-bound, purpose-specific message; the owner wallet finds exactly its profile', async () => {
    const c = await client(); await c.wait('hi'); const { ch, r } = await recover(c, owner);
    assert(ch.message.includes('\nDomain: ' + BASE + '\n') && ch.message.includes('Recover my Show Grounds profile') && ch.message.includes('\nWallet: ' + owner.pk + '\n'));
    assert(r.ok); assert.deepStrictEqual(r.profiles.map((p) => p.id), [credA.id]);
    c.send({ t: 'rclaim', id: wb.pid }); const bad = await c.wait('rcred'); assert.strictEqual(bad.ok, false, 'cannot claim a profile outside the proven list');
    c.send({ t: 'rclaim', id: credA.id }); const again = await c.wait('rcred'); assert.strictEqual(again.ok, false, 'one claim per proof (the failed attempt used it)');
    c.ws.close();
  });
  await t('recovery: claim rotates the secret (old credential dead), kicks the live session, new credential joins with the rides', async () => {
    const c = await client(); await c.wait('hi'); await recover(c, owner); c.send({ t: 'rclaim', id: credA.id }); const cr = await c.wait('rcred'); assert(cr.ok && cr.id === credA.id && cr.secret && cr.secret !== credA.secret);
    const k = await a.wait('kick'); assert(/recovered/.test(k.why));
    const w = await join(c, { id: cr.id, secret: cr.secret, nick: cr.nick }); assert.strictEqual(w.pid, credA.id); assert(w.inv.rides.length >= 1);
    const d = await client(); await d.wait('hi'); d.send({ t: 'join', id: credA.id, secret: credA.secret, nick: 'x' }); const e = await d.wait('joinerr'); assert.strictEqual(e.err, 'stale', 'the old secret no longer works');
    c.ws.close(); d.ws.close();
  });
  await t('recovery: shop-only payer and unrelated wallets get nothing; wrong signer, reused nonce, cross-purpose nonce and wrong origin are refused', async () => {
    const c = await client(); await c.wait('hi');
    let { r } = await recover(c, friend); assert(r.ok && r.profiles.length === 0);
    ({ r } = await recover(c, other)); assert(r.ok && r.profiles.length === 0);
    c.send({ t: 'rclaim', id: wb.pid }); assert.strictEqual((await c.wait('rcred')).ok, false);
    c.send({ t: 'rauth', pubkey: owner.pk }); let ch = await c.wait('rchal'); c.send({ t: 'rproof', pubkey: owner.pk, nonce: ch.nonce, sig: other.sign(ch.message) }); assert.strictEqual((await c.wait('rres')).ok, false, 'signature by another key');
    c.send({ t: 'rproof', pubkey: owner.pk, nonce: ch.nonce, sig: owner.sign(ch.message) }); assert.strictEqual((await c.wait('rres')).ok, false, 'nonce burned on first use');
    const pch = W.challenge(owner.pk, null, BASE, 'devnet', 'prove'); c.send({ t: 'rproof', pubkey: owner.pk, nonce: pch.nonce, sig: owner.sign(pch.message) }); assert.strictEqual((await c.wait('rres')).ok, false, 'a purchase-proof nonce is not a recovery');
    const och = W.challenge(owner.pk, null, 'https://evil.example', 'devnet', 'recover'); c.send({ t: 'rproof', pubkey: owner.pk, nonce: och.nonce, sig: owner.sign(och.message) }); assert.strictEqual((await c.wait('rres')).ok, false, 'a challenge for another origin');
    assert.strictEqual(W.verify({ nonce: W.challenge(owner.pk, 'P', BASE, 'devnet', 'recover').nonce, pubkey: owner.pk, signature: 'x', origin: BASE, purpose: 'prove' }), false);
    c.ws.close();
  });
  await t('recovery is pre-join only and rate limited per connection', async () => {
    b.send({ t: 'rauth', pubkey: owner.pk }); await assert.rejects(b.wait('rchal', 400), 'a joined player cannot start recovery');
    const c = await client(); await c.wait('hi'); const got = []; for (let i = 0; i < 6; i++) c.send({ t: 'rauth', pubkey: other.pk });
    await new Promise((r) => setTimeout(r, 300)); for (const m of c.msgs) got.push(m.t); assert(got.filter((x) => x === 'rchal').length <= 4 && got.includes('rres'));
    c.ws.close();
  });
  console.log(`\n${n} recovery/join tests passed` + (process.exitCode ? ' (with failures)' : '')); process.exit(process.exitCode || 0);
})().catch((e) => { console.error(e); process.exit(1); });
