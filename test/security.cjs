// Security regression tests: RPC proxy gating (1), concurrent-submit race in the burn ledger (2), shop grant after a verified burn (3),
// wallet-ownership proof, TURN credentials only over the WebSocket (6), per-IP profile creation limit (10).
const http = require('http'); const crypto = require('crypto'); const assert = require('assert'); const WebSocket = require('ws');
const PORT = 3291, UP = 3292, BASE = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { SERVER_SECRET: 'security-test-secret-0123456789', PORT: String(PORT), MINT_NETWORK: 'devnet', MINT_ENABLED: '1', VWFEST_MINT: '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', SOLANA_RPC_URL: `http://127.0.0.1:${UP}`, RPC_WRITE_PER_MIN: '5', PROFILE_CREATE_PER_HOUR: '6', TURN_URL: 'turn:turn.example.com:3478', TURN_SECRET: 'turn-secret-xyz', MAX_CONNS_PER_IP: '100', DEV_WALLET: '11111111111111111111111111111112' });
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
  const A = await join('Alice1');
  await t('(1) RPC proxy: read methods work, unknown methods are refused, bad origin refused', async () => {
    let r = await rpc({ method: 'getBalance', params: ['x'], id: 1 }); assert.strictEqual(r.status, 200);
    r = await rpc({ method: 'requestAirdrop', params: ['x', 1], id: 2 }); assert.strictEqual(r.status, 400);
    r = await rpc({ method: 'getProgramAccounts', params: ['x'], id: 3 }); assert.strictEqual(r.status, 400);
    r = await fetch(BASE + '/api/rpc', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ method: 'getBalance', params: [], id: 1 }) }); assert.strictEqual(r.status, 403);
  });
  await t('(1) RPC proxy: sendTransaction/simulateTransaction need a session token from a joined player', async () => {
    const tx = Buffer.alloc(300, 7).toString('base64'); const before = seen.length;
    for (const m of ['sendTransaction', 'simulateTransaction']) { let r = await rpc({ method: m, params: [tx], id: 1 }); assert.strictEqual(r.status, 401, m + ' without token'); r = await rpc({ method: m, params: [tx], id: 1 }, { 'x-rpc-token': 'forged.token' }); assert.strictEqual(r.status, 401, m + ' forged'); }
    assert.strictEqual(seen.length, before, 'nothing reached the RPC node');
    const tok = A.welcome.rpcToken; assert(tok, 'welcome carries rpcToken');
    let r = await rpc({ method: 'sendTransaction', params: [tx, { encoding: 'base58', skipPreflight: true, maxRetries: 99 }], id: 1 }, { 'x-rpc-token': tok }); assert.strictEqual(r.status, 200);
    const up = seen[seen.length - 1]; assert.strictEqual(up.params[1].encoding, 'base64', 'encoding forced'); assert(up.params[1].maxRetries <= 5);
    r = await rpc({ method: 'sendTransaction', params: ['not base64 !!'], id: 1 }, { 'x-rpc-token': tok }); assert.strictEqual(r.status, 400);
    r = await rpc({ method: 'sendTransaction', params: ['A'.repeat(5000)], id: 1 }, { 'x-rpc-token': tok }); assert.strictEqual(r.status, 400, 'oversize');
  });
  await t('(1) RPC proxy: per-player write limit (429) and tokens are bound to the secret', async () => {
    const tx = Buffer.alloc(200, 1).toString('base64'); const tok = A.welcome.rpcToken; let last = 200; for (let i = 0; i < 8; i++) last = (await rpc({ method: 'simulateTransaction', params: [tx], id: i }, { 'x-rpc-token': tok })).status; assert.strictEqual(last, 429);
    const session = require('../lib/session'); const expired = session.sign({ k: 'rpc', pid: 'x' }, -1000); assert.strictEqual((await rpc({ method: 'sendTransaction', params: [tx], id: 1 }, { 'x-rpc-token': expired })).status, 401);
    const wrongKind = session.sign({ k: 'other', pid: 'x' }, 60000); assert.strictEqual((await rpc({ method: 'sendTransaction', params: [tx], id: 1 }, { 'x-rpc-token': wrongKind })).status, 401);
  });
  await t('(6) TURN credentials are not in /api/config; they arrive over the authenticated WebSocket', async () => {
    const cfg = await (await fetch(BASE + '/api/config')).json(); assert(!JSON.stringify(cfg).includes('turn.example.com') && !JSON.stringify(cfg).includes('credential'), 'config leaks TURN'); assert(cfg.iceServers.every((s) => !s.credential));
    const ice = A.welcome.iceServers; assert(ice.some((s) => s.credential && String(s.urls).includes('turn.example.com')), 'welcome has TURN creds'); assert(ice.find((s) => s.credential).username > Date.now() / 1000);
  });
  await t('(2) burn ledger: concurrent submissions cannot both claim the same avatar code or the same signature', async () => {
    const mk = () => { const B = new Burns({ network: 'devnet', mint: 'M', decimals: 6, rpcUrl: 'x', explorer: (i) => i, base: BASE }); B.fetchTx = async () => { await new Promise((r) => setTimeout(r, 40)); return { fake: true }; }; return B; };
    const orig = Burns.inspect; Burns.inspect = () => ({ ok: true, wallet: 'W', amount: '5000000', devLamports: '0', asset: 'A', uri: BASE + '/nft/C1.json' });
    try {
      const B = mk(); const s1 = '5'.repeat(88), s2 = '4'.repeat(88), s3 = '3'.repeat(88); const base = { nonce: 'q', pid: 'p', kind: 'mint', nick: 'n', expect: { code: 'C1', uri: BASE + '/nft/C1.json', burnMin: 1n } };
      const rs = await Promise.all([B.submit({ ...base, sig: s1 }), B.submit({ ...base, sig: s2 }), B.submit({ ...base, sig: s3 })]); assert.strictEqual(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs.map((r) => r.ok || r.why))); assert.strictEqual(B.list.filter((x) => x.code === 'C1').length, 1);
      const B2 = mk(); const same = await Promise.all([B2.submit({ ...base, sig: s1, expect: { burnMin: 1n }, kind: 'shop' }), B2.submit({ ...base, sig: s1, expect: { burnMin: 1n }, kind: 'shop' })]); assert.strictEqual(same.filter((r) => r.ok).length, 1); assert.strictEqual(B2.list.length, 1);
      const B3 = mk(); B3.fetchTx = async () => { throw new Error('rpc down'); }; await B3.submit({ ...base, sig: s1 }).catch(() => {}); assert(!B3.pending.codes.has('C1') && !B3.pending.sigs.has(s1), 'reservation released after a failure'); B3.fetchTx = async () => ({}); assert((await B3.submit({ ...base, sig: s2 })).ok, 'code usable again after failed attempt');
    } finally { Burns.inspect = orig; }
  });
  await t('(3,5) shop: wallet proof required; a verified burn that cannot be granted returns an error (never silent); same signature is idempotent', async () => {
    const C = await join('Bobby2'); const pid = C.welcome.pid; const kp = crypto.generateKeyPairSync('ed25519'); const pub = b58(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
    const sigA = '2'.repeat(88), sigB = '6'.repeat(88);
    const realSubmit = S.burns.submit; S.burns.submit = async (o) => ({ ok: true, rec: { sig: o.sig, amount: '2000000', wallet: o.expect.wallet || 'W', kind: o.kind } });
    try {
      const quote = (item) => S.pay.create({ kind: 'shop', item, pid, usd: 2, paidUsd: 2, burnMin: '1', devMin: '0', burnRaw: '1', devPct: 0, devWallet: null });
      let q = quote('halo'); C.send({ t: 'buy', qid: q.id, sig: sigA, wallet: pub }); let r = await C.wait('buyres'); assert(!r.ok && r.needProof, 'no proof -> refused'); assert(!S.profiles.byId.get(pid).items.has('halo'));
      C.send({ t: 'wauth', pubkey: pub }); const ch = await C.wait('wchal'); const bad = Buffer.alloc(64).toString('base64'); C.send({ t: 'wproof', pubkey: pub, nonce: ch.nonce, sig: bad }); assert(!(await C.wait('wok')).ok, 'bad signature refused');
      C.send({ t: 'wauth', pubkey: pub }); const ch2 = await C.wait('wchal'); C.send({ t: 'wproof', pubkey: pub, nonce: ch2.nonce, sig: crypto.sign(null, Buffer.from(ch2.message), kp.privateKey).toString('base64') }); assert((await C.wait('wok')).ok, 'valid signature accepted');
      C.send({ t: 'buy', qid: q.id, sig: sigA, wallet: pub }); r = await C.wait('buyres'); assert(r.ok, r.why); assert(S.profiles.byId.get(pid).items.has('halo'), 'granted');
      q = quote('halo'); C.send({ t: 'buy', qid: q.id, sig: sigB, wallet: pub }); r = await C.wait('buyres'); assert(!r.ok && /could not be granted/.test(r.why) && r.why.includes(sigB.slice(0, 12)), 'lost burn is reported: ' + r.why);
      assert.strictEqual(S.profiles.grant(pid, 'halo', { sig: sigA }).dup, true, 'grant is idempotent by signature');
      q = quote('halo'); C.send({ t: 'wauth', pubkey: 'NotAKey' }); assert(!(await C.wait('wok')).ok);
    } finally { S.burns.submit = realSubmit; }
  });
  await t('(5) a wallet proof cannot be replayed: nonce is single-use and bound to the wallet', async () => {
    const W = require('../lib/walletauth'); const kp = crypto.generateKeyPairSync('ed25519'); const pub = b58(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(12)); const c = W.challenge(pub, 'p1'); const sig = crypto.sign(null, Buffer.from(c.message), kp.privateKey).toString('base64');
    assert(!W.verify({ nonce: c.nonce, pubkey: pub, signature: sig, pid: 'other-profile' }), 'bound to the profile'); assert(!W.verify({ nonce: c.nonce, pubkey: pub, signature: sig, pid: 'p1' }), 'nonce burned after first use');
    const c2 = W.challenge(pub, 'p1'); assert(W.verify({ nonce: c2.nonce, pubkey: pub, signature: crypto.sign(null, Buffer.from(c2.message), kp.privateKey).toString('base64'), pid: 'p1' })); });
  await t('(10) per-IP profile creation limit', async () => {
    const made = []; let refused = null; for (let i = 0; i < 9; i++) { try { made.push(await join('Spam' + i + 'x')); } catch (e) { refused = e.message; break; } } assert(refused && /Too many new profiles/.test(refused), 'refused after the limit: ' + refused); assert(made.length <= 6, 'limit respected (' + made.length + ')'); made.forEach((c) => c.ws.close());
  });
  console.log(`\nall ${n} security tests ${process.exitCode ? 'FINISHED WITH FAILURES' : 'passed'}`); S.server.close(); upstream.close(); setTimeout(() => process.exit(process.exitCode || 0), 300);
})();
