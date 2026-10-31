'use strict';
// "Use my NFT as my avatar": wallet-proven players pick an NFT they own; the server verifies ownership on-chain (solana/src/nft.js), shows it to everyone,
// re-checks ownership periodically (reverts if it was sold/moved) and proxies the image (size/type/host-limited, never an open proxy).
const https = require('https'); const net = require('net');
const chain = require('./chain'); const nft = chain.nft;
// @solana/web3.js is installed under solana/ (its own package.json), not in the root: resolve it from there.
const web3 = () => { try { return require('@solana/web3.js'); } catch { return require(require.resolve('@solana/web3.js', { paths: [require('path').join(__dirname, '..', 'solana')] })); } };
const { cleanText: cleanLabel } = require('./names');
// On-chain NFT names are attacker-controlled and shown above a player's head: same rules as chat/vendor text (no links, addresses, slurs), 32 chars.
const safeName = (n) => cleanLabel(String(n == null ? '' : n).replace(/[<>]/g, ''), 32) || 'NFT';
const MAX_IMG = 1_500_000, CACHE_MAX = 40_000_000;
const RECHECK_MS = Math.max(60, +process.env.NFT_RECHECK_SEC || 600) * 1000;

class NftAvatars {
  constructor({ hub, profiles, env = process.env, publicUrl = '', db = null, fetchImpl = fetch, imgTransport = https }) {
    this.hub = hub; this.profiles = profiles; this.env = env; this.publicUrl = publicUrl; this.db = db; this.f = fetchImpl; this.imgTransport = imgTransport;
    this.urls = new Map();     // asset -> source image url (registered by list/use only; the image proxy serves nothing else)
    this.cache = new Map(); this.cacheBytes = 0; this.pending = new Map();
    this.saved = new Map();    // profile id -> { asset, wallet, name, image, standard }
    this.cfg = null; this.conn = null; this.timer = null; this.lastList = new Map();
  }
  get enabled() { return !!(this.cfg && this.cfg.features.nftAvatarLookup && this.env.NFT_AVATARS !== '0'); }
  async init() {
    try { // fail soft: if the Solana module or its deps are missing/misconfigured, NFT avatars switch off but the server keeps running
      const cfg = chain.loadConfig(this.env); const { Connection } = web3(); this.conn = new Connection(cfg.rpcUrl, 'confirmed'); this.cfg = cfg;
    } catch (e) { this.cfg = null; this.conn = null; console.error('[nftavatar] disabled:', e && e.message); return; }
    if (this.db) { try { await this.db(`CREATE TABLE IF NOT EXISTS ${this.schema()}.nft_avatar (profile_id TEXT PRIMARY KEY, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`); const r = await this.db(`SELECT profile_id, data FROM ${this.schema()}.nft_avatar`); for (const x of r.rows) this.saved.set(x.profile_id, typeof x.data === 'string' ? JSON.parse(x.data) : x.data); for (const v of this.saved.values()) if (v.image) this.urls.set(v.asset, v.image); } catch (e) { console.error('[nft] persistence unavailable:', e.message); this.db = null; } }
    this.timer = setInterval(() => this.recheckAll().catch(() => {}), Math.min(RECHECK_MS, 60_000)); this.timer.unref();
  }
  schema() { return (this.env.DB_SCHEMA || 'showgrounds').replace(/[^a-z0-9_]/gi, ''); }
  persist(pid, v) { if (!this.db) return; const s = this.schema(); (v ? this.db(`INSERT INTO ${s}.nft_avatar (profile_id, data) VALUES ($1,$2) ON CONFLICT (profile_id) DO UPDATE SET data = EXCLUDED.data, at = now()`, [pid, JSON.stringify(v)]) : this.db(`DELETE FROM ${s}.nft_avatar WHERE profile_id = $1`, [pid])).catch(() => {}); }
  // ---- what the other players see (small, no URLs: clients derive /api/nft-img/<asset>) ----
  pub(p) { return p.nft ? { a: p.nft.asset, n: safeName(p.nft.name), s: p.nft.standard === 'MplCoreAsset' ? 'core' : 'nft' } : null; }
  async list(wallet) {
    if (!this.enabled) throw new Error('NFT avatars are not switched on');
    const r = await nft.ownedNfts({ cfg: this.cfg, conn: this.conn, wallet, limit: 48, fetchImpl: this.f });
    const items = []; for (const x of r.items || []) { let image = x.image; if (!image && x.uri) image = await this.imageFromMeta(x.uri).catch(() => null); if (!image) continue; this.urls.set(x.asset, image); items.push({ asset: x.asset, name: safeName(x.name), standard: x.standard, collection: x.collection || null, img: '/api/nft-img/' + x.asset }); }
    if (this.urls.size > 4000) for (const k of [...this.urls.keys()].slice(0, 1000)) this.urls.delete(k);
    return { items, truncated: !!r.truncated };
  }
  async imageFromMeta(uri) { const j = await nft.safeGetJson(uri, { gateway: this.cfg.storage.gateway, allowHosts: this.cfg.metadataHosts }); return nft.safeUrl((j && j.image) || ''); }
  async use(p, wallet, asset) {
    if (!this.enabled) return { ok: false, why: 'NFT avatars are not switched on' };
    const v = await nft.verifyOwnership({ cfg: this.cfg, conn: this.conn, wallet, asset, fetchImpl: this.f }); if (!v) return { ok: false, why: 'That NFT is not in the wallet you verified.' };
    let image = this.urls.get(asset) || v.image || null; if (!image && v.uri) image = await this.imageFromMeta(v.uri).catch(() => null);
    if (!image) return { ok: false, why: 'This NFT has no usable image.' };
    this.urls.set(asset, image); this.set(p, { asset, wallet, name: safeName(v.name), standard: v.standard, image, verifiedAt: Date.now(), lastCheck: Date.now() }); return { ok: true, nf: this.pub(p) };
  }
  set(p, v) { p.nft = v; this.saved.set(p.prof.id, { asset: v.asset, wallet: v.wallet, name: v.name, standard: v.standard, image: v.image }); this.persist(p.prof.id, this.saved.get(p.prof.id)); this.hub.all({ t: 'nft', id: p.id, nf: this.pub(p) }); }
  clear(p, why) { if (!p.nft) return false; p.nft = null; this.saved.delete(p.prof.id); this.persist(p.prof.id, null); this.hub.all({ t: 'nft', id: p.id, nf: null }); if (why && p.conn) this.hub.json(p.conn, { t: 'toast', text: why }); return true; }
  // On join: restore the saved choice (ownership is re-verified right away; a failed check just leaves the default avatar).
  restore(p) {
    const s = this.saved.get(p.prof.id); if (!s || !this.enabled) return; p.nft = { ...s, verifiedAt: 0, lastCheck: 0 };
    this.verify(p).then((ok) => { if (!ok && p.nft) { p.nft = null; } else if (p.nft) this.hub.all({ t: 'nft', id: p.id, nf: this.pub(p) }); }).catch(() => {});
  }
  async verify(p) { const n = p.nft; if (!n) return false; const v = await nft.verifyOwnership({ cfg: this.cfg, conn: this.conn, wallet: n.wallet, asset: n.asset, fetchImpl: this.f }); if (v) { n.lastCheck = Date.now(); n.verifiedAt = n.verifiedAt || Date.now(); } return !!v; }
  // Periodic: players whose NFT moved (sold, listed to an escrow, burned) revert to their normal avatar. RPC errors never revert anyone.
  async recheckAll() {
    if (!this.enabled) return; const now = Date.now(); let budget = 6;
    for (const p of this.hub.players.values()) {
      if (!p.nft || now - p.nft.lastCheck < RECHECK_MS || budget <= 0) continue; budget--; p.nft.lastCheck = now;
      let ok; try { ok = await this.verify(p); } catch { continue; }
      if (!ok && p.nft) this.clear(p, 'Your NFT is no longer in the verified wallet, so your avatar is back to normal.');
    }
  }
  // ---- image proxy ----
  async image(asset) {
    const url = this.urls.get(asset); if (!url) return null; const hit = this.cache.get(asset); if (hit) return hit;
    if (this.pending.has(asset)) return this.pending.get(asset);
    const pr = this.fetchImage(url).then((img) => { this.cache.set(asset, img); this.cacheBytes += img.buf.length; while (this.cacheBytes > CACHE_MAX && this.cache.size) { const k = this.cache.keys().next().value; this.cacheBytes -= this.cache.get(k).buf.length; this.cache.delete(k); } return img; }).finally(() => this.pending.delete(asset));
    this.pending.set(asset, pr); return pr;
  }
  resolve(u) { const x = new URL(u); if (x.protocol === 'ipfs:') return new URL(this.cfg.storage.gateway + '/ipfs/' + (x.hostname + x.pathname).replace(/^\/+/, '')); return x; }
  hostOk(x) { if (x.protocol !== 'https:') return false; if (x.username || x.password || (x.port && x.port !== '443')) return false; const h = x.hostname.replace(/^\[|\]$/g, '').toLowerCase(); if (!h || h === 'localhost' || /\.(local|internal|localhost)$/.test(h)) return false; if (net.isIP(h) && !nft.isPublicIp(h)) return false; const al = this.cfg.metadataHosts; return !(al && al.length && !al.some((a) => h === a || h.endsWith('.' + a))); }
  async fetchImage(url, hops = 0) {
    let x = this.resolve(url); const own = this.publicUrl ? new URL(this.publicUrl).hostname : '';
    for (; hops <= 3; hops++) {
      if (!this.hostOk(x)) throw new Error('blocked host');
      const res = await new Promise((resolve, reject) => { const req = this.imgTransport.request({ protocol: 'https:', hostname: x.hostname.replace(/^\[|\]$/g, ''), port: 443, path: x.pathname + x.search, method: 'GET', lookup: nft.pinnedLookup, timeout: 8000, headers: { accept: 'image/*', 'user-agent': 'vwfest-showgrounds' } }, resolve); req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end(); });
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); x = this.resolve(new URL(res.headers.location, x).toString()); continue; }
      if (res.statusCode !== 200) { res.resume(); throw new Error('http ' + res.statusCode); }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const okTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']; if (x.hostname.toLowerCase() === own) okTypes.push('image/svg+xml');
      if (!okTypes.includes(type)) { res.resume(); throw new Error('image type not allowed'); }
      if (+(res.headers['content-length'] || 0) > MAX_IMG) { res.destroy(); throw new Error('too large'); }
      const chunks = []; let n = 0; await new Promise((resolve, reject) => { res.on('data', (c) => { n += c.length; if (n > MAX_IMG) { res.destroy(); reject(new Error('too large')); } else chunks.push(c); }); res.on('end', resolve); res.on('error', reject); res.on('aborted', () => reject(new Error('aborted'))); });
      return { type, buf: Buffer.concat(chunks) };
    }
    throw new Error('too many redirects');
  }
  mount(app, cors) {
    app.get('/api/nft-img/:asset', cors, async (req, res) => {
      const a = String(req.params.asset); if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return res.status(404).end();
      try { const img = await this.image(a); if (!img) return res.status(404).end(); res.set({ 'Content-Type': img.type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin' }); res.send(img.buf); }
      catch { res.status(404).end(); }
    });
  }
}
module.exports = { NftAvatars };
