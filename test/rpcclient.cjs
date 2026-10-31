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
  console.log('ok   rpc client: token attach / rotate / refresh / public fallback'); process.exit(0);
})().catch((e) => { console.error('FAIL', e.stack); process.exit(1); });
