// Session-bound read RPC. The server hands every JOINED player a short-lived token over the WebSocket (welcome + {t:'rpctok'} rotation); /api/rpc needs it.
// Without a token (not joined yet / token missing) callers use the PUBLIC rpc (cfg.publicRpcUrl): the keyed server RPC is never reachable anonymously.
let token = "", timer = 0, ask = null, minSec = 15, pubUrl = '', waiters = [];
export function setRpcToken(t, ttl) { // t = { token, ttl } from welcome, or the token string from an rpctok message
  const tok = t && typeof t === 'object' ? t.token : t; const sec = (t && typeof t === 'object' && t.ttl) || ttl || 600;
  if (typeof tok !== 'string' || !tok) return; token = tok; clearTimeout(timer); const w = waiters; waiters = []; w.forEach((f) => f(tok));
  timer = setTimeout(() => { if (ask) ask(); }, Math.max(minSec, sec * 0.6) * 1000);
}
export const setRefreshFloor = (s) => { minSec = s; };
export function onRpcRefresh(fn) { ask = fn; }
export function clearRpcToken() { token = ''; clearTimeout(timer); }
export const getRpcToken = () => token;
// web3.js `fetch` option: adds the current token to every proxied call (rotates transparently). On 401/429 the token is dropped, a fresh one is requested over the socket and the call is retried ONCE;
// if that still fails (or no token arrives) the same read goes to the public RPC so UI reads (entry modal balance polling etc.) never break.
const send = (url, init, tok) => fetch(url, { ...init, headers: { ...(init.headers || {}), ...(tok ? { 'x-rpc-token': tok } : {}) } });
const nextToken = (ms) => new Promise((res) => { if (!ask) return res(''); let t = 0; const done = (tok) => { clearTimeout(t); waiters = waiters.filter((f) => f !== done); res(tok); }; t = setTimeout(() => done(''), ms); waiters.push(done); try { ask(); } catch { done(''); } }); // every exit clears its own timer
export const setRotateWaitMs = (ms) => { waitMs = ms; }; let waitMs = 4000;
const drop = (tok) => { if (tok && token === tok) { token = ''; clearTimeout(timer); timer = 0; } }; // forget a token the server rejected, together with its refresh timer (only if nobody replaced it meanwhile)
export async function rpcFetch(url, init = {}) {
  const sent = token; let r = await send(url, init, sent); if (r.status !== 401 && r.status !== 429) return r;
  if (token && token !== sent) { const t2 = token; r = await send(url, init, t2); if (r.status !== 401 && r.status !== 429) return r; drop(t2); } // another request already rotated the token while this one was in flight: use it; if it is rejected too, drop it
  drop(sent);
  const fresh = await nextToken(waitMs); if (fresh && fresh !== sent) { r = await send(url, init, fresh); if (r.status !== 401 && r.status !== 429) return r; drop(fresh); } // a rotation that is still rejected must not stay armed (no stale token, no refresh timer left running)
  return pubUrl ? send(pubUrl, init, '') : r; // fail over to the public RPC
}
// Connection for READS: the server proxy when we hold a token, else the public RPC.
export function readConnection(Connection, server, cfg, opts = {}) {
  if (cfg.publicRpcUrl) pubUrl = cfg.publicRpcUrl;
  const base = { commitment: 'confirmed', disableRetryOnRateLimit: true, ...opts };
  if (token) return new Connection(server + '/api/rpc', { ...base, fetch: rpcFetch });
  return new Connection(cfg.publicRpcUrl || (server + '/api/rpc'), base);
}
