// Read-only RPC proxy guard: session-bound short-lived tokens (issued over the authenticated WebSocket after a successful join), strict body validation
// (method allowlist, batch cap, getMultipleAccounts key cap, param size cap) and sliding-window budgets (per session, per IP, global).
// Pure logic, no HTTP: server.js wires it to /api/rpc. Tokens die with the socket / player; they are never written to disk.
const crypto = require('crypto');

const RPC_READ = new Set(['getLatestBlockhash', 'getBalance', 'getAccountInfo', 'getTokenAccountsByOwner', 'getTokenAccountBalance', 'getMinimumBalanceForRentExemption', 'getFeeForMessage', 'getSignatureStatuses', 'isBlockhashValid', 'getBlockHeight', 'getMultipleAccounts']);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

class Budgets {
  constructor() { this.m = new Map(); }
  // Sliding window: `cost` units against `limit` per windowMs. Returns false (and charges nothing) when over.
  take(key, cost, limit, windowMs = 60e3, now = Date.now(), dry = false) {
    let a = this.m.get(key); if (!a) { if (dry) return cost <= limit; a = []; this.m.set(key, a); }
    while (a.length && now - a[0].t >= windowMs) a.shift();
    let used = 0; for (const e of a) used += e.c; if (used + cost > limit) return false;
    if (!dry) a.push({ t: now, c: cost }); return true;
  }
  sweep(now = Date.now(), maxAge = 120e3) { for (const [k, a] of this.m) if (!a.length || now - a[a.length - 1].t > maxAge) this.m.delete(k); }
}

class RpcGuard {
  constructor(o = {}) {
    this.ttlMs = num(o.ttlSec, 600) * 1000; this.graceMs = num(o.graceSec, 20) * 1000; this.maxTokens = num(o.maxTokens, 5000);
    this.perSession = num(o.perSession, 60); this.perIp = num(o.perIp, 120); this.global = num(o.global, 3000);
    this.maxBatch = num(o.maxBatch, 5); this.maxKeys = num(o.maxKeys, 25); this.maxParamBytes = num(o.maxParamBytes, 4000); this.maxParams = num(o.maxParams, 4);
    this.tokens = new Map(); this.byConn = new Map(); this.budgets = new Budgets();
    if (o.sweep !== false) { this.timer = setInterval(() => this.sweep(), 60e3); this.timer.unref(); }
  }
  // Issue a fresh token bound to this joined player (sid = session id, pid = profile id) and connection. Previous tokens of the connection get a short grace.
  issue(conn, player, origin, now = Date.now()) {
    if (!conn || !player || !player.prof) return null;
    const mine = this.byConn.get(conn) || new Set();
    for (const t of mine) { const e = this.tokens.get(t); if (e) e.exp = Math.min(e.exp, now + this.graceMs); }
    if (this.tokens.size >= this.maxTokens) this.sweep(now); if (this.tokens.size >= this.maxTokens) return null;
    const token = crypto.randomBytes(24).toString('base64url');
    this.tokens.set(token, { conn, sid: player.id, pid: player.prof.id, origin: origin || '', exp: now + this.ttlMs }); mine.add(token); this.byConn.set(conn, mine);
    return { token, ttl: Math.floor(this.ttlMs / 1000) };
  }
  revoke(conn) { const s = this.byConn.get(conn); if (!s) return; for (const t of s) this.tokens.delete(t); this.byConn.delete(conn); }
  // -> { ok, session } | { ok:false, status, error }
  verify(token, origin, now = Date.now()) {
    const e = typeof token === 'string' && token.length >= 20 && token.length <= 64 ? this.tokens.get(token) : null;
    if (!e || now >= e.exp) { if (e) this.drop(token, e); return { ok: false, status: 401, error: 'join the game first' }; }
    const p = e.conn.player; // still the same joined player on a live socket, and the same web origin that joined
    if (!p || p.id !== e.sid || !p.prof || p.prof.id !== e.pid || !e.conn.ws || e.conn.ws.readyState !== 1 || (e.origin && e.origin !== origin)) { this.drop(token, e); return { ok: false, status: 401, error: 'join the game first' }; }
    return { ok: true, session: e.pid, sid: e.sid, pid: e.pid }; // the budget key is the PLAYER (profile id), not the token string: rotating tokens cannot multiply the budget
  }
  drop(token, e) { this.tokens.delete(token); const s = e && this.byConn.get(e.conn); if (s) { s.delete(token); if (!s.size) this.byConn.delete(e.conn); } }
  sweep(now = Date.now()) { for (const [t, e] of this.tokens) if (now >= e.exp || !e.conn.player) this.drop(t, e); this.budgets.sweep(now); }
  // Validate and normalise a JSON-RPC body (single object or a small batch of them). -> { ok, items:[{method,params,id}], cost } | { ok:false, status, error }
  parse(body) {
    const bad = (error) => ({ ok: false, status: 400, error });
    const list = Array.isArray(body) ? body : [body];
    if (!list.length || list.length > this.maxBatch) return bad('batch too large');
    const items = []; let cost = 0;
    for (const b of list) {
      if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.method !== 'string' || !RPC_READ.has(b.method) || !Array.isArray(b.params) || b.params.length > this.maxParams) return bad('method not allowed');
      if (b.id !== undefined && b.id !== null && typeof b.id !== 'number' && typeof b.id !== 'string') return bad('bad id');
      if (typeof b.id === 'string' && b.id.length > 64) return bad('bad id');
      let sz; try { sz = JSON.stringify(b.params).length; } catch { return bad('bad params'); } if (sz > this.maxParamBytes) return bad('params too large');
      let c = 1;
      if (b.method === 'getMultipleAccounts') { const k = b.params[0]; if (!Array.isArray(k) || !k.length || k.length > this.maxKeys || k.some((x) => typeof x !== 'string' || x.length > 64)) return bad('too many accounts'); c += Math.ceil(k.length / 10); }
      items.push({ method: b.method, params: b.params, id: b.id ?? 1 }); cost += c;
    }
    return { ok: true, items, cost };
  }
  // Charge session + IP + global budgets atomically: nothing is charged anywhere unless all three have room. -> true | false
  charge(session, ip, cost, now = Date.now()) {
    const B = this.budgets; const ks = [['g', this.global], ['ip:' + ip, this.perIp], ['s:' + session, this.perSession]];
    for (const [k, l] of ks) if (!B.take(k, cost, l, 60e3, now, true)) return false;
    for (const [k, l] of ks) B.take(k, cost, l, 60e3, now); return true;
  }
}
module.exports = { RpcGuard, Budgets, RPC_READ };
