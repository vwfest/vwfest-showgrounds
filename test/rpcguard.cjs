// /api/rpc hardening: session-bound short-lived tokens (issued over the WS only), per-session / per-IP budgets, batch + getMultipleAccounts caps,
// read-only allowlist, keyed upstream URL never exposed, CORS allows exactly the token header for allowed origins.
const http = require('http'); const assert = require('assert'); const WebSocket = require('ws');
const PORT = 3297, UP = 3298, BASE = `http://127.0.0.1:${PORT}`, KEY = 'SECRETKEY-abc123-do-not-leak';
Object.assign(process.env, { SERVER_SECRET: 'rpcguard-test-secret-0123456789abcdef', PORT: String(PORT), MINT_NETWORK: 'devnet', MINT_ENABLED: '1', CHAIN_FAKE: '1', VWFEST_MINT: '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', SOLANA_RPC_URL: `http://127.0.0.1:${UP}/?api-key=${KEY}`, PUBLIC_RPC_URL: `http://127.0.0.1:${UP}/?api-key=${KEY}`,
  RPC_SESSION_PER_MIN: '12', RPC_IP_PER_MIN: '30', RPC_PROXY_PER_MIN: '500', RPC_MAX_BATCH: '3', RPC_MAX_ACCOUNTS: '25', MAX_CONNS_PER_IP: '100', PROFILE_CREATE_PER_HOUR: '50' });
const S = require('../server.js'); const { RpcGuard } = require('../lib/rpcguard');
let mode = 'ok'; const seen = [];
const upstream = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const j = JSON.parse(b); seen.push({ j, headers: req.headers, url: req.url });
  if (mode === '500') { res.statusCode = 500; return res.end('boom ' + req.url); } if (mode === '429') { res.statusCode = 429; return res.end('{}'); }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: mode === 'leak' ? 'echo http://127.0.0.1:' + UP + '/?api-key=' + KEY + ' ' + KEY : 'ok' })); }); });
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
const H = { origin: BASE, 'content-type': 'application/json' };
const post = (body, token, headers = {}) => fetch(BASE + '/api/rpc', { method: 'POST', headers: { ...H, ...(token ? { 'x-rpc-token': token } : {}), ...headers }, body: JSON.stringify(body) });
const bal = (id = 1) => ({ method: 'getBalance', params: ['11111111111111111111111111111111'], id });
const client = (nick) => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: BASE } }); const c = { ws, msgs: [], waiters: [] }; ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter((w) => !(w.t === m.t && (w.f(m), true))); }); c.wait = (t, ms = 4000) => new Promise((r2, j2) => { const old = c.msgs.find((m) => m.t === t && !m._seen); if (old) { old._seen = true; return r2(old); } const to = setTimeout(() => j2(new Error('timeout ' + t)), ms); c.waiters.push({ t, f: (m) => { clearTimeout(to); m._seen = true; r2(m); } }); }); c.send = (o) => ws.send(JSON.stringify(o)); ws.on('open', () => res(c)); ws.on('error', rej); c.nick = nick; });
const join = async (nick) => { const c = await client(nick); await c.wait('hi'); c.send({ t: 'join', nick }); const w = await Promise.race([c.wait('welcome'), c.wait('joinerr').then((m) => { throw new Error('joinerr ' + m.why); })]); c.welcome = w; c.tok = w.rpcToken && w.rpcToken.token; return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await S.init(); await new Promise((r) => upstream.listen(UP, '127.0.0.1', r)); await new Promise((r) => S.server.listen(PORT, '127.0.0.1', r));
  await t('token is issued over the WS only, short-lived, and never in /api/config or /api/status', async () => {
    const A = await join('Alice1'); assert(A.tok && A.tok.length >= 30 && A.welcome.rpcToken.ttl <= 3600 && A.welcome.rpcToken.ttl > 0);
    for (const p of ['/api/config', '/api/status', '/api/guide']) { const tx = await (await fetch(BASE + p)).text(); assert(!tx.includes(A.tok), p + ' leaks the token'); assert(!tx.includes(KEY), p + ' leaks the RPC key'); }
    A.ws.close();
  });
  await t('keyed URL is never exposed: publicRpcUrl falls back to the public default even if PUBLIC_RPC_URL carries an api-key', async () => {
    const cfg = await (await fetch(BASE + '/api/config')).json(); assert.strictEqual(cfg.publicRpcUrl, 'https://api.devnet.solana.com'); assert(!JSON.stringify(cfg).includes('api-key') && !JSON.stringify(cfg).includes(KEY));
    const hdr = (await fetch(BASE + '/api/config')).headers; assert(!JSON.stringify([...hdr]).includes(KEY));
  });
  await t('no token / bogus token / empty token -> 401 and nothing reaches the upstream node', async () => {
    const before = seen.length; for (const tok of [undefined, '', 'bogus', 'x'.repeat(40), 'a'.repeat(5000)]) { const r = await post(bal(), tok); assert.strictEqual(r.status, 401, String(tok).slice(0, 10)); }
    assert.strictEqual(seen.length, before);
  });
  await t('valid token works; wrong Origin is 403 even with a valid token; token is not forwarded upstream and the key is only used server-side', async () => {
    const A = await join('Alice2'); const before = seen.length; let r = await post(bal(7), A.tok); assert.strictEqual(r.status, 200); const j = await r.json(); assert.strictEqual(j.result, 'ok'); assert.strictEqual(j.id, 7);
    assert.strictEqual(seen.length, before + 1); assert(!seen[seen.length - 1].headers['x-rpc-token'], 'token not forwarded'); assert(seen[seen.length - 1].url.includes(KEY), 'server used the keyed URL upstream');
    r = await post(bal(), A.tok, { origin: 'https://evil.example' }); assert.strictEqual(r.status, 403); r = await fetch(BASE + '/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rpc-token': A.tok }, body: JSON.stringify(bal()) }); assert.strictEqual(r.status, 403, 'no Origin header');
    A.ws.close();
  });
  await t('token dies with the socket (session-bound)', async () => {
    const A = await join('Alice3'); assert.strictEqual((await post(bal(), A.tok)).status, 200); A.ws.close(); await sleep(150); assert.strictEqual((await post(bal(), A.tok)).status, 401);
  });
  await t('a socket that has not JOINED has no token; tokens cannot be minted by an unjoined client', async () => {
    const c = await client('x'); await c.wait('hi'); c.send({ t: 'rpctok' }); await sleep(200); assert(!c.msgs.some((m) => m.t === 'rpctok'), 'no token before join'); c.ws.close();
  });
  await t('tokens are per-session: session A cannot ride on B; kicked/left players lose access', async () => {
    const A = await join('Alice4'), B = await join('Bobby4'); assert.notStrictEqual(A.tok, B.tok); assert.strictEqual((await post(bal(), A.tok)).status, 200); assert.strictEqual((await post(bal(), B.tok)).status, 200);
    S.hub.leave(S.hub.players.get(A.welcome.id)); assert.strictEqual((await post(bal(), A.tok)).status, 401, 'player left the hub -> token dead'); assert.strictEqual((await post(bal(), B.tok)).status, 200); A.ws.close(); B.ws.close();
  });
  await t('rotation: {t:rpctok} issues a new token over the WS (rate-limited), old token has a short grace then dies', async () => {
    const A = await join('Alice5'); A.send({ t: 'rpctok' }); const m = await A.wait('rpctok'); assert(m.rpcToken && m.rpcToken.token && m.rpcToken.token !== A.tok); assert.strictEqual((await post(bal(), m.rpcToken.token)).status, 200); assert.strictEqual((await post(bal(), A.tok)).status, 200, 'grace');
    A.send({ t: 'rpctok' }); await sleep(250); assert(!A.msgs.some((x) => x.t === 'rpctok' && !x._seen), 'rotation is rate-limited'); A.ws.close();
  });
  await t('read-only allowlist still enforced with a valid token (writes, airdrops, getProgramAccounts refused, never reach upstream)', async () => {
    const A = await join('Alice6'); const before = seen.length;
    for (const m of ['sendTransaction', 'simulateTransaction', 'requestAirdrop', 'sendRawTransaction', 'getProgramAccounts', 'getLargestAccounts', 'getBlock', '__proto__', 'constructor']) { const r = await post({ method: m, params: ['x'], id: 1 }, A.tok); assert.strictEqual(r.status, 400, m); }
    for (const body of [{ method: 'getBalance' }, { method: 'getBalance', params: 'x' }, { method: 'getBalance', params: [1, 2, 3, 4, 5] }, { method: 'getBalance', params: ['x'.repeat(5000)] }, { method: 'getBalance', params: [], id: { a: 1 } }, 'str', 5, null, []]) { const r = await post(body, A.tok); assert.strictEqual(r.status, 400, JSON.stringify(body).slice(0, 40)); }
    assert.strictEqual(seen.length, before); A.ws.close();
  });
  await t('batch cap: <=3 ok (array in, array out), 4 refused; each item is validated; getMultipleAccounts key cap 25', async () => {
    const A = await join('Alice7'); const before = seen.length;
    let r = await post([bal(1), bal(2), bal(3)], A.tok); assert.strictEqual(r.status, 200); const j = await r.json(); assert(Array.isArray(j) && j.length === 3 && j.map((x) => x.id).join() === '1,2,3'); assert.strictEqual(seen.length, before + 3);
    r = await post([bal(1), bal(2), bal(3), bal(4)], A.tok); assert.strictEqual(r.status, 400); r = await post([bal(1), { method: 'sendTransaction', params: ['x'], id: 2 }], A.tok); assert.strictEqual(r.status, 400); r = await post([], A.tok); assert.strictEqual(r.status, 400);
    assert.strictEqual(seen.length, before + 3, 'refused batches never reach upstream'); A.ws.close();
  });
  await t('getMultipleAccounts: 25 keys ok, 26 refused, non-array / non-string keys refused', async () => {
    const A = await join('Alice8'); const k = (c) => Array.from({ length: c }, () => '11111111111111111111111111111111');
    assert.strictEqual((await post({ method: 'getMultipleAccounts', params: [k(25)], id: 1 }, A.tok)).status, 200); assert.strictEqual((await post({ method: 'getMultipleAccounts', params: [k(26)], id: 1 }, A.tok)).status, 400);
    assert.strictEqual((await post({ method: 'getMultipleAccounts', params: ['x'], id: 1 }, A.tok)).status, 400); assert.strictEqual((await post({ method: 'getMultipleAccounts', params: [[1, 2]], id: 1 }, A.tok)).status, 400); assert.strictEqual((await post({ method: 'getMultipleAccounts', params: [[]], id: 1 }, A.tok)).status, 400); A.ws.close();
  });
  await t('per-session budget (12/min): 429 after the budget, other sessions unaffected', async () => {
    S.rpcGuard.budgets.m.clear(); const A = await join('Alice9'), B = await join('Bobby9'); let ok = 0, r; for (let i = 0; i < 12; i++) { r = await post(bal(), A.tok); if (r.status === 200) ok++; } assert.strictEqual(ok, 12);
    r = await post(bal(), A.tok); assert.strictEqual(r.status, 429); assert.strictEqual((await post(bal(), B.tok)).status, 200, 'B has its own budget'); A.ws.close(); B.ws.close();
  });
  await t('per-IP budget (30/min): many fresh sessions from one IP cannot multiply the budget', async () => {
    S.rpcGuard.budgets.m.clear(); const cs = []; for (let i = 0; i < 4; i++) cs.push(await join('Multi' + i + 'x')); let ok = 0, lim = 0;
    for (let round = 0; round < 12; round++) for (const c of cs) { const r = await post(bal(), c.tok); if (r.status === 200) ok++; else if (r.status === 429) lim++; }
    assert.strictEqual(ok, 30, 'exactly the IP budget got through, got ' + ok); assert(lim > 0); cs.forEach((c) => c.ws.close());
  });
  await t('CF-Connecting-IP cannot be spoofed to dodge the per-IP budget from a direct (non-Cloudflare/Render) connection: header is ignored unless RENDER/TRUST_CF', async () => {
    S.rpcGuard.budgets.m.clear(); const cs = []; for (let i = 0; i < 4; i++) cs.push(await join('Spoof' + i + 'x')); let ok = 0;
    for (let round = 0; round < 12; round++) for (let i = 0; i < cs.length; i++) { const r = await post(bal(), cs[i].tok, { 'cf-connecting-ip': '203.0.113.' + (round * 4 + i + 1)}); if (r.status === 200) ok++; }
    assert(ok <= 30, 'spoofed IP headers multiplied the budget: ' + ok); cs.forEach((c) => c.ws.close());
  });
  await t('multi-item cost: a getMultipleAccounts of 25 keys costs more than a getBalance, and a batch is charged per item', async () => {
    S.rpcGuard.budgets.m.clear(); const A = await join('Costly1'); const k = Array.from({ length: 25 }, () => '11111111111111111111111111111111'); let n25 = 0;
    for (let i = 0; i < 12; i++) { const r = await post({ method: 'getMultipleAccounts', params: [k], id: 1 }, A.tok); if (r.status === 200) n25++; else break; } assert(n25 < 12, 'expensive calls exhaust the session budget faster: ' + n25); A.ws.close();
  });
  await t('upstream errors never leak the keyed URL / key; non-200 upstream is a generic 502/503; body echoing the key is scrubbed', async () => {
    S.rpcGuard.budgets.m.clear(); const A = await join('Leaky1'); mode = 'leak'; let r = await post(bal(), A.tok); let tx = await r.text(); assert.strictEqual(r.status, 200); assert(!tx.includes(KEY) && !tx.includes('api-key') , 'scrubbed: ' + tx);
    mode = '500'; r = await post(bal(), A.tok); tx = await r.text(); assert.strictEqual(r.status, 502); assert(!tx.includes(KEY) && !tx.includes('boom')); mode = '429'; r = await post(bal(), A.tok); assert.strictEqual(r.status, 503); mode = 'ok'; A.ws.close();
  });
  await t('CORS: the token header is allowed for allowed origins only (consistent with enforcement)', async () => {
    let r = await fetch(BASE + '/api/rpc', { method: 'OPTIONS', headers: { origin: BASE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-rpc-token,content-type' } }); assert.strictEqual(r.status, 204); assert(/x-rpc-token/.test(r.headers.get('access-control-allow-headers'))); assert.strictEqual(r.headers.get('access-control-allow-origin'), BASE);
    r = await fetch(BASE + '/api/rpc', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } }); assert(!r.headers.get('access-control-allow-origin') && !r.headers.get('access-control-allow-headers'));
    const A = await join('Cors1'); r = await post(bal(), A.tok); assert.strictEqual(r.headers.get('cache-control'), 'no-store'); A.ws.close();
  });
  await t('unit: expiry, grace, batch parse, atomic charge (nothing charged unless all three buckets have room)', async () => {
    const g = new RpcGuard({ sweep: false, ttlSec: 10, graceSec: 2, perSession: 5, perIp: 100, global: 100, maxBatch: 2, maxKeys: 3 }); const ws = { readyState: 1 }; const conn = { player: { id: 1, prof: { id: 'VW-x' } }, ws };
    const x = g.issue(conn, conn.player, 'o', 0); assert(g.verify(x.token, 'o', 9999).ok); assert(!g.verify(x.token, 'o', 10001).ok, 'expired'); g.revoke(conn);
    const a = g.issue(conn, conn.player, 'o', 1000);
    const b = g.issue(conn, conn.player, 'o', 2000); assert(g.verify(a.token, 'o', 2500).ok, 'grace'); assert(!g.verify(a.token, 'o', 4001).ok, 'grace over'); assert(g.verify(b.token, 'o', 4001).ok);
    assert(!g.verify(b.token, 'other-origin', 4001).ok, 'origin bound'); conn.player = { id: 2, prof: { id: 'VW-x' } }; assert(!g.verify(b.token, 'o', 4001).ok, 'sid bound');
    assert(!g.parse([bal(), bal(), bal()]).ok); assert(g.parse([bal(), bal()]).ok); assert(!g.parse({ method: 'getMultipleAccounts', params: [['a', 'b', 'c', 'd']] }).ok);
    assert(g.charge('s1', 'ip1', 3, 0) && !g.charge('s1', 'ip1', 3, 0)); assert.strictEqual(g.budgets.m.get('ip:ip1').reduce((x, e) => x + e.c, 0), 3, 'failed charge did not touch ip bucket'); assert(g.charge('s1', 'ip1', 3, 61000), 'window slides');
    g.revoke(conn); assert(!g.verify(b.token, 'o', 3000).ok);
  });
  console.log(`\nall ${n} rpcguard tests ${process.exitCode ? 'FINISHED WITH FAILURES' : 'passed'}`); S.server.close(); upstream.close(); setTimeout(() => process.exit(process.exitCode || 0), 300);
})();
