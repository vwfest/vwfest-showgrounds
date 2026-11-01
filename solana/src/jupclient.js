'use strict';
// ONE gateway for every Jupiter call the server makes (prices, quotes, swap-instructions) and for the browser, which reaches Jupiter only through the server's /api/jup proxy
// (the API key therefore never leaves the server). It adds the x-api-key header when JUPITER_API_KEY is set, spaces requests to the plan's rate (free key 1 req/s per ORGANISATION,
// keyless 0.5 req/s), caches identical GETs for a few seconds and coalesces concurrent identical ones, and on 429 waits until x-ratelimit-reset (absolute unix seconds) before one retry.
const DEFAULT_ROOT = 'https://api.jup.ag';
// One JUPITER_BASE for everything. Accepts the root ("https://api.jup.ag") or the legacy forms that already include /swap/v1 or /price/v3; returns the bare root without doubling any path.
function jupRoot(base) { let b = String(base || DEFAULT_ROOT).trim().replace(/\/+$/, ''); b = b.replace(/\/(swap\/v1|swap|price\/v3|price)$/, '').replace(/\/+$/, ''); return b || DEFAULT_ROOT; }
const canon = (u) => { try { const x = new URL(u); if (/\/quote$/.test(x.pathname) && !x.searchParams.has('swapMode')) x.searchParams.set('swapMode', 'ExactIn'); x.searchParams.sort(); return x.toString(); } catch { return u; } };
class JupClient {
  constructor({ root, apiKey = '', fetchImpl = fetch, rps, cacheMs = 8000, maxQueueMs = 15000, publicShare = 0.4, publicQueueMs = 3000, timeoutMs = 10000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.root = jupRoot(root); this.apiKey = apiKey || ''; this.f = fetchImpl; this.rps = rps > 0 ? rps : this.apiKey ? 1 : 0.5; this.gap = Math.ceil(1000 / this.rps) + 50; this.cacheMs = cacheMs; this.maxQueueMs = maxQueueMs; this.timeoutMs = timeoutMs; this.now = now; this.sleep = sleep;
    this.next = 0; this.pubNext = 0; this.publicShare = publicShare; this.publicQueueMs = publicQueueMs; this.cache = new Map(); this.stats = { calls: 0, hits: 0, limited: 0 };
  }
  get swap() { return this.root + '/swap/v1'; } get price() { return this.root + '/price/v3'; }
  headers(extra) { return { ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}), ...extra }; }
  // Two lanes share the ONE rate budget. 'server' (default: the server's own buy/price paths) may use every slot. 'public' (the browser proxy) may take at most `publicShare` of the slots (its slots are spaced
  // gap/share apart, so server calls always find free slots in between) and fails fast when its own backlog exceeds `publicQueueMs`: a crowd of browsers can never starve a purchase's price/quote calls.
  async slot(lane = 'server') {
    const pub = lane === 'public';
    if (pub) { // the public lane first waits for ITS OWN turn (spaced gap/share apart) without holding a global slot, so server calls arriving meanwhile take the free slots in between
      const t0 = this.now(); const at0 = Math.max(t0, this.pubNext); if (at0 - t0 > this.publicQueueMs) throw Object.assign(new Error('Jupiter is busy right now'), { busy: true });
      this.pubNext = at0 + Math.ceil(this.gap / this.publicShare); if (at0 > t0) await this.sleep(at0 - t0);
    }
    const t = this.now(); const at = Math.max(t, this.next); if (at - t > (pub ? this.publicQueueMs : this.maxQueueMs)) throw Object.assign(new Error('Jupiter is busy right now'), { busy: true });
    this.next = at + this.gap; if (at > t) await this.sleep(at - t);
  }
  async send(url, init, lane = 'server') {
    for (let attempt = 0; ; attempt++) {
      await this.slot(lane); this.stats.calls++; const r = await this.f(url, { ...init, headers: this.headers(init && init.headers), signal: AbortSignal.timeout(this.timeoutMs) });
      if (r.status === 429) { this.stats.limited++; const reset = Number(r.headers && r.headers.get && r.headers.get('x-ratelimit-reset')); const waitMs = reset > 0 ? Math.max(0, reset * 1000 - this.now()) + 50 : 1000; this.next = Math.max(this.next, this.now() + waitMs); // honor the server's own reset time for ALL callers
        if (attempt >= 1 || waitMs > this.maxQueueMs) throw Object.assign(new Error('Jupiter rate limit (429)'), { status: 429 }); continue; }
      if (!r.ok) throw Object.assign(new Error('Jupiter http ' + r.status), { status: r.status });
      return r.json();
    }
  }
  // cached + coalesced GET (key = canonical URL: sorted params, default swapMode)
  get(url, { cacheMs = this.cacheMs, lane = 'server' } = {}) {
    const k = canon(url), t = this.now(), hit = this.cache.get(k); if (hit && t - hit.at < cacheMs) { this.stats.hits++; return hit.p; }
    for (const [x, v] of this.cache) if (t - v.at > 60000) this.cache.delete(x); if (this.cache.size > 300) this.cache.clear();
    const p = this.send(url, undefined, lane); this.cache.set(k, { at: t, p }); p.catch(() => { if (this.cache.get(k) && this.cache.get(k).p === p) this.cache.delete(k); }); return p;
  }
  post(url, body, { lane = 'server' } = {}) { return this.send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, lane); }
  // keep one client per config object so prices, swap builder, the browser proxy and the legacy pricer all share ONE limiter and ONE cache
  static for(cfg, fetchImpl) {
    if (fetchImpl && fetchImpl !== fetch) return new JupClient({ root: cfg.jupiterBase, apiKey: cfg.jupiterApiKey, fetchImpl, rps: cfg.jupiterRps || 1000, // an injected fetch (tests) is not a real Jupiter: no pacing unless asked
     cacheMs: cfg.jupiterCacheMs, sleep: cfg.jupiterSleep });
    if (!JupClient._m) JupClient._m = new Map(); const id = jupRoot(cfg.jupiterBase) + '|' + (cfg.jupiterApiKey || ''); let c = JupClient._m.get(id);
    if (!c) JupClient._m.set(id, (c = new JupClient({ root: cfg.jupiterBase, apiKey: cfg.jupiterApiKey, rps: cfg.jupiterRps, cacheMs: cfg.jupiterCacheMs }))); return c;
  }
}
module.exports = { JupClient, jupRoot, DEFAULT_ROOT };
