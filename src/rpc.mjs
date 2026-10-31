// Session-bound read RPC. The server hands every JOINED player a short-lived token over the WebSocket (welcome + {t:'rpctok'} rotation); /api/rpc needs it.
// Without a token (not joined yet / token missing) callers use the PUBLIC rpc (cfg.publicRpcUrl): the keyed server RPC is never reachable anonymously.
let token = "", timer = 0, ask = null, minSec = 15;
export function setRpcToken(t, ttl) { // t = { token, ttl } from welcome, or the token string from an rpctok message
  const tok = t && typeof t === 'object' ? t.token : t; const sec = (t && typeof t === 'object' && t.ttl) || ttl || 600;
  if (typeof tok !== 'string' || !tok) return; token = tok; clearTimeout(timer);
  timer = setTimeout(() => { if (ask) ask(); }, Math.max(minSec, sec * 0.6) * 1000);
}
export const setRefreshFloor = (s) => { minSec = s; };
export function onRpcRefresh(fn) { ask = fn; }
export function clearRpcToken() { token = ''; clearTimeout(timer); }
export const getRpcToken = () => token;
// web3.js `fetch` option: adds the current token to every proxied call (rotates transparently).
export const rpcFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers || {}), ...(token ? { 'x-rpc-token': token } : {}) } });
// Connection for READS: the server proxy when we hold a token, else the public RPC.
export function readConnection(Connection, server, cfg, opts = {}) {
  const base = { commitment: 'confirmed', disableRetryOnRateLimit: true, ...opts };
  if (token) return new Connection(server + '/api/rpc', { ...base, fetch: rpcFetch });
  return new Connection(cfg.publicRpcUrl || (server + '/api/rpc'), base);
}
