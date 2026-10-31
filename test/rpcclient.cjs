// Client helper for the session-bound RPC: token attach/rotate, public fallback without a token.
const assert = require('assert');
(async () => {
  const R = await import('../src/rpc.mjs'); const calls = []; global.fetch = async (u, i) => { calls.push({ u, h: i.headers }); return { ok: true }; };
  class Conn { constructor(url, o) { this.url = url; this.o = o; } }
  const cfg = { publicRpcUrl: 'https://api.devnet.solana.com' };
  let c = R.readConnection(Conn, 'https://srv', cfg); assert.strictEqual(c.url, cfg.publicRpcUrl, 'no token -> public RPC'); assert(!c.o.fetch);
  R.setRpcToken({ token: 'tok-1', ttl: 600 }); c = R.readConnection(Conn, 'https://srv', cfg); assert.strictEqual(c.url, 'https://srv/api/rpc'); await c.o.fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json' } }); assert.strictEqual(calls[0].h['x-rpc-token'], 'tok-1'); assert.strictEqual(calls[0].h['content-type'], 'application/json');
  R.setRpcToken('tok-2'); await c.o.fetch(c.url, {}); assert.strictEqual(calls[1].h['x-rpc-token'], 'tok-2', 'existing connections pick up rotated tokens');
  R.setRefreshFloor(0.01); let asked = 0; R.onRpcRefresh(() => asked++); R.setRpcToken({ token: "tok-3", ttl: 0.01 }); await new Promise((r) => setTimeout(r, 200)); assert.strictEqual(asked, 1, 'refresh is requested before expiry');
  R.clearRpcToken(); assert.strictEqual(R.getRpcToken(), ''); c = R.readConnection(Conn, 'https://srv', cfg); assert.strictEqual(c.url, cfg.publicRpcUrl);
  { // 401/429 -> drop token, rotate + retry once, then fall back to the public RPC
    const log = []; let behave = 'ok'; global.fetch = async (u, i) => { const tok = i.headers && i.headers['x-rpc-token']; log.push({ u, tok }); if (u === cfg.publicRpcUrl) return { ok: true, status: 200, pub: true }; if (behave === 'ok') return { ok: true, status: 200 }; if (behave === 'stale') return { status: tok === 'fresh' ? 200 : 401 }; return { status: behave === '429' ? 429 : 401 }; };
    R.setRotateWaitMs(300); R.setRpcToken('stale-tok'); let c2 = R.readConnection(Conn, 'https://srv', cfg); let asks = 0;
    R.onRpcRefresh(() => { asks++; setTimeout(() => R.setRpcToken('fresh'), 20); }); behave = 'stale'; let r = await c2.o.fetch(c2.url, { method: 'POST', headers: {} });
    assert.strictEqual(r.status, 200); assert(!r.pub, 'served by the proxy after rotation'); assert.strictEqual(asks, 1); assert.deepStrictEqual(log.map((x) => x.tok), ['stale-tok', 'fresh'], 'retried exactly once with the fresh token'); assert.strictEqual(R.getRpcToken(), 'fresh');
    let seq = 0; R.onRpcRefresh(() => { asks++; setTimeout(() => R.setRpcToken('rot-' + ++seq), 20); }); log.length = 0; behave = '401'; asks = 0; r = await c2.o.fetch(c2.url, {}); assert(r.pub, 'still 401 after rotation -> public RPC'); assert.strictEqual(log.length, 3, 'proxy, retry, public'); assert.strictEqual(log[2].u, cfg.publicRpcUrl); assert(!log[2].tok, 'no token is sent to the public RPC');
    log.length = 0; behave = '429'; R.setRpcToken('t429'); r = await c2.o.fetch(c2.url, {}); assert(r.pub, '429 also falls back');
    log.length = 0; R.clearRpcToken(); R.onRpcRefresh(() => {}); behave = '401'; R.setRpcToken('x'); r = await c2.o.fetch(c2.url, {}); assert(r.pub, 'no token arrives within the wait -> public RPC');
  }
  console.log('ok   rpc client: token attach / rotate / refresh / public fallback'); process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack); process.exit(1); });
