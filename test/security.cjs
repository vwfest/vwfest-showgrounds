// Security regression tests: RPC proxy gating (1), concurrent-submit race in the burn ledger (2), shop grant after a verified burn (3),
// wallet-ownership proof, TURN credentials only over the WebSocket (6), per-IP profile creation limit (10).
const http = require('http'); const crypto = require('crypto'); const assert = require('assert'); const WebSocket = require('ws');
const PORT = 3291, UP = 3292, BASE = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { SERVER_SECRET: 'security-test-secret-0123456789', PORT: String(PORT), MINT_NETWORK: 'devnet', MINT_ENABLED: '1', CHAIN_FAKE: '1', VWFEST_MINT: '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', SOLANA_RPC_URL: `http://127.0.0.1:${UP}`, RPC_WRITE_PER_MIN: '5', PROFILE_CREATE_PER_HOUR: '6', TURN_URL: 'turn:turn.example.com:3478', TURN_SECRET: 'turn-secret-xyz-0123456789', MAX_CONNS_PER_IP: '100', DEV_WALLET: '11111111111111111111111111111112' });
const S = require('../server.js'); const { Burns } = require('../lib/burns');
const seen = []; const upstream = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const j = JSON.parse(b); seen.push(j); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: 'ok' })); }); });
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
const H = { origin: BASE, 'content-type': 'application/json' };
let TOK = ''; const rpc = (body, headers = {}) => fetch(BASE + '/api/rpc', { method: 'POST', headers: { ...H, ...(TOK ? { 'x-rpc-token': TOK } : {}), ...headers }, body: JSON.stringify(body) });
const client = (nick) => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: BASE } }); const c = { ws, msgs: [], waiters: [] }; ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter((w) => !(w.t === m.t && (w.f(m), true))); }); c.wait = (t, ms = 4000) => new Promise((r2, j2) => { const old = c.msgs.find((m) => m.t === t && !m._seen); if (old) { old._seen = true; return r2(old); } const to = setTimeout(() => j2(new Error('timeout ' + t)), ms); c.waiters.push({ t, f: (m) => { clearTimeout(to); m._seen = true; r2(m); } }); }); c.send = (o) => ws.send(JSON.stringify(o)); ws.on('open', () => res(c)); ws.on('error', rej); c.nick = nick; });
const join = async (nick) => { const c = await client(nick); await c.wait('hi'); c.send({ t: 'join', nick }); const w = await Promise.race([c.wait('welcome'), c.wait('joinerr').then((m) => { throw new Error('joinerr ' + m.why); })]); c.welcome = w; return c; };
const b58 = (buf) => { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let x = BigInt('0x' + buf.toString('hex')), s = ''; while (x > 0n) { s = A[Number(x % 58n)] + s; x /= 58n; } for (const v of buf) { if (v === 0) s = '1' + s; else break; } return s; };

(async () => {
  await S.init(); await new Promise((r) => upstream.listen(UP, '127.0.0.1', r)); await new Promise((r) => S.server.listen(PORT, '127.0.0.1', r));
  const A = await join('Alice1'); TOK = A.welcome.rpcToken.token;
  await t('(1) RPC proxy: read methods work, unknown methods are refused, bad origin refused', async () => {
    let r = await rpc({ method: 'getBalance', params: ['x'], id: 1 }); assert.strictEqual(r.status, 200);
    r = await rpc({ method: 'requestAirdrop', params: ['x', 1], id: 2 }); assert.strictEqual(r.status, 400);
    r = await rpc({ method: 'getProgramAccounts', params: ['x'], id: 3 }); assert.strictEqual(r.status, 400);
    r = await fetch(BASE + '/api/rpc', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ method: 'getBalance', params: [], id: 1 }) }); assert.strictEqual(r.status, 403);
  });
  await t('(1) RPC proxy is READ-ONLY: sendTransaction / simulateTransaction / requestAirdrop are refused outright and never reach the node', async () => {
    const tx = Buffer.alloc(300, 7).toString('base64'); const before = seen.length;
    for (const m of ['sendTransaction', 'simulateTransaction', 'requestAirdrop', 'sendRawTransaction']) { let r = await rpc({ method: m, params: [tx], id: 1 }); assert.strictEqual(r.status, 400, m); r = await rpc({ method: m, params: [tx], id: 1 }); assert.strictEqual(r.status, 400, m + ' with a valid token'); }
    for (const p of ['/api/tx/send', '/api/relay', '/api/solana/tx/send', '/api/solana/relay']) { const r = await fetch(BASE + p, { method: 'POST', headers: H, body: '{}' }); assert([404, 405].includes(r.status), p + ' -> ' + r.status); }
    assert.strictEqual(seen.length, before, 'nothing reached the RPC node'); assert(A.welcome.rpcToken && A.welcome.rpcToken.token, 'a session-bound READ token is issued over the WS only (never a relay)'); assert(!JSON.stringify(await (await fetch(BASE + '/api/config')).json()).includes(TOK), 'token not in /api/config');
    const cfg = await (await fetch(BASE + '/api/config')).json(); assert(cfg.publicRpcUrl, 'clients are told which public RPC to broadcast through');
  });
  await t('(6) TURN credentials are not in /api/config; they arrive over the authenticated WebSocket', async () => {
    const cfg = await (await fetch(BASE + '/api/config')).json(); assert(!JSON.stringify(cfg).includes('turn.example.com') && !JSON.stringify(cfg).includes('credential'), 'config leaks TURN'); assert(cfg.iceServers.every((s) => !s.credential));
    const ice = A.welcome.iceServers; assert(ice.every((x) => !x.credential), 'welcome must NOT carry TURN creds (voice opt-in only)');
    A.send({ t: 'voice', on: true }); const r = await A.wait('ice'); const turn = r.iceServers.find((x) => x.credential); assert(turn && String(turn.urls).includes('turn.example.com'), 'TURN creds after voice opt-in');
    const [exp] = turn.username.split(':'); assert(+exp > Date.now() / 1000 && +exp <= Date.now() / 1000 + 3600 && turn.username.endsWith(':s' + A.welcome.id), 'short-lived, per-session username');
    assert.strictEqual(turn.credential, crypto.createHmac('sha1', process.env.TURN_SECRET).update(turn.username).digest('base64'), 'HMAC credential');
    const B2 = await join('TurnB01'); B2.send({ t: 'voice', on: true }); const r2 = await B2.wait('ice'); assert.notStrictEqual(r2.iceServers.find((x) => x.credential).credential, turn.credential, 'credentials are per session'); B2.ws.close();
  });
  await t('(2) verifyPurchase (solana/): concurrent submissions cannot both claim the same avatar code or the same signature', async () => {
    const chain = require('../lib/chain'); const s1 = '5'.repeat(88), s2 = '4'.repeat(88), s3 = '3'.repeat(88); const base = { nonce: 'q', pid: 'p', kind: 'mint', nick: 'n', expect: { code: 'C1', uri: BASE + '/nft/C1.json', burnMin: 1n, wallet: 'W1' } };
    const rs = await Promise.all([chain.verifyPurchase({ ...base, sig: s1 }), chain.verifyPurchase({ ...base, sig: s2 }), chain.verifyPurchase({ ...base, sig: s3 })]); assert.strictEqual(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs.map((r) => r.ok || r.why)));
    const same = await Promise.all([chain.verifyPurchase({ ...base, nonce: 'q2', kind: 'shop', expect: { burnMin: 1n }, sig: '2'.repeat(88) }), chain.verifyPurchase({ ...base, nonce: 'q2', kind: 'shop', expect: { burnMin: 1n }, sig: '2'.repeat(88) })]); assert.strictEqual(same.filter((r) => r.ok).length, 1);
    const B = new Burns({ network: 'devnet', mint: 'M', decimals: 6, rpcUrl: 'x', explorer: (i) => i, base: BASE }); const rec = rs.find((r) => r.ok).rec; assert(B.record(rec) && !B.record(rec), 'ledger write is idempotent by signature'); assert.strictEqual(B.list.length, 1);
  });
  await t('(3,5) shop: wallet proof required; a verified burn that cannot be granted returns an error (never silent); same signature is idempotent', async () => {
    const C = await join('Bobby2'); const pid = C.welcome.pid; const kp = crypto.generateKeyPairSync('ed25519'); const pub = b58(kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
    const sigA = '7'.repeat(88), sigB = '6'.repeat(88);
    try {
      const quote = (item) => S.pay.create({ kind: 'shop', item, pid, usd: 2, paidUsd: 2, burnMin: '1', devMin: '0', burnRaw: '1', devPct: 0, devWallet: null });
      let q = quote('halo'); C.send({ t: 'buy', qid: q.id, sig: sigA, wallet: pub }); let r = await C.wait('buyres'); assert(!r.ok && r.needProof, 'no proof -> refused'); assert(!S.profiles.byId.get(pid).items.has('halo'));
      C.send({ t: 'wauth', pubkey: pub }); const ch = await C.wait('wchal'); const bad = Buffer.alloc(64).toString('base64'); C.send({ t: 'wproof', pubkey: pub, nonce: ch.nonce, sig: bad }); assert(!(await C.wait('wok')).ok, 'bad signature refused');
      C.send({ t: 'wauth', pubkey: pub }); const ch2 = await C.wait('wchal'); C.send({ t: 'wproof', pubkey: pub, nonce: ch2.nonce, sig: crypto.sign(null, Buffer.from(ch2.message), kp.privateKey).toString('base64') }); assert((await C.wait('wok')).ok, 'valid signature accepted');
      C.send({ t: 'buy', qid: q.id, sig: sigA, wallet: pub }); r = await C.wait('buyres'); assert(r.ok, r.why); assert(S.profiles.byId.get(pid).items.has('halo'), 'granted');
      q = quote('halo'); C.send({ t: 'buy', qid: q.id, sig: sigB, wallet: pub }); r = await C.wait('buyres'); assert(!r.ok && /could not be granted/.test(r.why) && r.why.includes(sigB.slice(0, 12)), 'lost burn is reported: ' + r.why);
      assert.strictEqual(S.profiles.grant(pid, 'halo', { sig: sigA }).dup, true, 'grant is idempotent by signature');
      q = quote('halo'); C.send({ t: 'wauth', pubkey: 'NotAKey' }); assert(!(await C.wait('wok')).ok);
    } finally { /* CHAIN_FAKE=1 makes solana/ accept the reported signature without a validator */ }
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
