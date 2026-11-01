// Vendor Row: a fixed number of booth plots. A booth is claimed by buying + burning VENDOR_FEE_USD of $VWFEST (verified on-chain by the server
// before anything is granted) and lasts VENDOR_DAYS, renewable. Content is moderated: text filter, JPEG-only size/dimension-checked images, report button
// with auto-hide, optional pre-moderation, and an admin API. Memory is the working copy; Postgres (schema "showgrounds") persists it.
const crypto = require('crypto');
const { cleanText } = require('./names');
const SCHEMA = (process.env.DB_SCHEMA || 'showgrounds').replace(/[^a-z0-9_]/gi, '');
const DAY = 86400000, MAX_PRODUCTS = 6, TENTS = 5;
const COLORS = ['#e63946', '#ff7a1a', '#ffd166', '#06d6a0', '#2a9d8f', '#118ab2', '#4ea8ff', '#9b5de5', '#ff4fa3', '#f4f1ea', '#2b2d42', '#8a6a3f'];
const HEX = /^#[0-9a-f]{6}$/i;

// ---- link: https only, a real hostname, no credentials / ports / IP literals / internal names ----
function cleanLink(raw) {
  if (raw === '' || raw === null || raw === undefined) return { ok: true, url: '' }; if (typeof raw !== 'string' || raw.length > 200) return { ok: false, why: 'Link is too long' };
  let u; try { u = new URL(raw.trim()); } catch { return { ok: false, why: 'That is not a valid link' }; }
  if (u.protocol !== 'https:') return { ok: false, why: 'Links must start with https://' }; if (u.username || u.password) return { ok: false, why: 'Links with logins are not allowed' }; if (u.port) return { ok: false, why: 'Links with ports are not allowed' };
  const h = u.hostname; if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) || /(^|\.)(localhost|local|internal|onion)$/i.test(h) || h.startsWith('xn--') || h.includes('.xn--')) return { ok: false, why: 'That domain is not allowed' };
  return { ok: true, url: u.toString().slice(0, 200) };
}
// ---- image: JPEG only (the browser re-encodes everything through a canvas, which also strips metadata), bounded size and dimensions ----
function checkJpeg(buf, maxBytes, maxDim) {
  if (!Buffer.isBuffer(buf) || buf.length < 200) return { ok: false, why: 'Image is empty' }; if (buf.length > maxBytes) return { ok: false, why: `Image is too big (max ${Math.round(maxBytes / 1024)} KB)` };
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return { ok: false, why: 'Only JPEG images are accepted' };
  let i = 2, w = 0, h = 0; while (i + 9 < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m === 0xff) { i++; continue; } if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; } if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; } i += 2 + buf.readUInt16BE(i + 2); }
  if (!w || !h) return { ok: false, why: 'Unreadable image' }; if (w > maxDim || h > maxDim || w < 16 || h < 16) return { ok: false, why: `Image must be between 16 and ${maxDim}px` }; return { ok: true, w, h };
}

class Vendors {
  constructor(o = {}) {
    this.plots = Math.min(Math.max(o.plots || 24, 4), 24); this.days = Math.min(Math.max(o.days || 30, 1), 365); this.graceDays = o.graceDays ?? 7; this.imgKb = o.imgKb || 150; this.autoHide = o.autoHide || 3; this.premod = !!o.premod; this.now = o.now || (() => Date.now());
    this.booths = new Map(); this.byPid = new Map(); this.images = new Map(); this.holds = new Map(); this.holdMs = Math.max(30000, +(process.env.VENDOR_HOLD_MS) || 3 * 60000); this.holdsPerIp = Math.max(1, +(process.env.VENDOR_HOLDS_PER_IP) || 2); this.sigs = new Set(); this.version = 0; this.q = null;
  }
  async init() {
    const DDL = [`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`, `CREATE TABLE IF NOT EXISTS ${SCHEMA}.vendors (plot INT PRIMARY KEY, data JSONB NOT NULL)`, `CREATE TABLE IF NOT EXISTS ${SCHEMA}.vendor_images (id TEXT PRIMARY KEY, pid TEXT NOT NULL, data TEXT NOT NULL)`];
    try {
      if (process.env.DATABASE_URL) { const pool = require('./db').pool(); this.q = (t, p) => pool.query(t, p); this.close = () => {}; for (const s of DDL) await pool.query(s); }
      else if (process.env.PGLITE_DIR) { const { PGlite } = require('@electric-sql/pglite'); const db = new PGlite(process.env.PGLITE_DIR); this.q = (t, p) => db.query(t, p); this.close = () => db.close(); for (const s of DDL) await db.query(s); }
      else return;
      for (const r of (await this.q(`SELECT data FROM ${SCHEMA}.vendors`)).rows) this.put(r.data);
      for (const r of (await this.q(`SELECT id, pid, data FROM ${SCHEMA}.vendor_images`)).rows) this.images.set(r.id, { pid: r.pid, buf: Buffer.from(r.data, 'base64') });
    } catch (e) { console.error('[vendors] db unavailable, memory only:', e.message); this.q = null; }
  }
  put(b) { this.booths.set(b.plot, b); this.byPid.set(b.pid, b); for (const s of b.sigs || []) this.sigs.add(s); this.version++; }
  async save(b) { this.version++; if (this.q) await this.q(`INSERT INTO ${SCHEMA}.vendors (plot, data) VALUES ($1, $2) ON CONFLICT (plot) DO UPDATE SET data = $2`, [b.plot, JSON.stringify(b)]).catch((e) => console.error('[vendors] save', e.message)); }
  // ---- plot availability ----
  state(b) { if (!b) return 'free'; const t = this.now(); if (b.removed) return 'removed'; if (b.expiresAt > t) return b.hidden ? 'hidden' : 'open'; return t < b.expiresAt + this.graceDays * DAY ? 'grace' : 'free'; }
  isFree(plot) { return this.state(this.booths.get(plot)) === 'free'; }
  freePlots() { const o = []; for (let p = 1; p <= this.plots; p++) if (this.isFree(p) && !this.held(p)) o.push(p); return o; }
  held(plot, pid) { const h = this.holds.get(plot); if (!h) return false; if (h.until < this.now()) { this.holds.delete(plot); return false; } return pid ? h.pid !== pid : true; }
  // A hold reserves a plot while a player pays. SHORT (VENDOR_HOLD_MS, default 3 min), one per profile, and at most HOLDS_PER_IP at once per network address (so one machine cannot lock the whole row
  // with throw-away profiles). Returns false when the per-address cap is reached.
  holdsFromIp(ip, exceptPid) { let n = 0; const t = this.now(); for (const h of this.holds.values()) if (h.ip === ip && h.pid !== exceptPid && h.until >= t) n++; return n; }
  hold(plot, pid, ms = this.holdMs, ip = '') { if (ip && this.holdsFromIp(ip, pid) >= this.holdsPerIp) return false; for (const [p, h] of this.holds) if (h.pid === pid && p !== plot) this.holds.delete(p); this.holds.set(plot, { pid, ip, until: this.now() + ms }); return true; } // one hold per profile: quoting plot after plot must not lock the whole row
  // Can this profile buy right now? Returns { ok, mode: 'claim'|'renew', plot } or { ok:false, why }.
  canBuy(pid, plot) {
    const mine = this.byPid.get(pid);
    if (mine && !mine.removed && this.state(mine) !== 'free') { const exp = mine.expiresAt - this.now(); if (exp > 300 * DAY) return { ok: false, why: 'Your booth is already paid up for almost a year.' }; return { ok: true, mode: 'renew', plot: mine.plot }; }
    if (mine && mine.removed) return { ok: false, why: 'Your booth was removed by the moderators. Contact the team.' };
    plot = +plot; if (!Number.isInteger(plot) || plot < 1 || plot > this.plots) return { ok: false, why: 'Pick a booth plot first.' };
    if (!this.isFree(plot)) return { ok: false, why: 'That plot is taken.' }; if (this.held(plot, pid)) return { ok: false, why: 'Someone else is buying that plot right now. Try another or retry in a few minutes.' };
    return { ok: true, mode: 'claim', plot };
  }
  // Called only after the burn is verified on-chain. Idempotent per signature.
  grant({ pid, nick, plot, sig, usd }) {
    if (this.sigs.has(sig)) return { ok: false, why: 'dup' };
    let b = this.byPid.get(pid); const t = this.now(); const mode = b && !b.removed && this.state(b) !== 'free' ? 'renew' : 'claim';
    if (mode === 'renew') { b.expiresAt = Math.max(b.expiresAt, t) + this.days * DAY; if (b.hidden === 'expired') b.hidden = false; }
    else { let p = +plot; if (!this.isFree(p) || this.held(p, pid)) { const f = this.freePlots(); if (!f.length) return { ok: false, why: 'no plot' }; p = f[0]; } if (b) { this.booths.delete(b.plot); }
      b = { plot: p, pid, nick, name: nick + "'s Booth", desc: '', link: '', tent: 0, c1: '#e63946', c2: '#f4f1ea', logo: null, banner: null, products: [], since: t, expiresAt: t + this.days * DAY, hidden: false, removed: false, reports: [], sigs: [], paid: [], imgOk: !this.premod }; this.holds.delete(p); }
    b.sigs.push(sig); b.paid.push({ sig, usd, at: t, mode }); this.sigs.add(sig); b.nick = nick; this.put(b); return { ok: true, booth: b, mode };
  }
  // ---- editing (owner only) ----
  addImage(pid, buf) {
    const mine = [...this.images.values()].filter((x) => x.pid === pid).length; if (mine >= 14) return { ok: false, why: 'Too many images uploaded. Save your booth to clean up, then retry.' };
    // the id is bound to the OWNER: someone else uploading the same bytes gets a different id and can never take over (or evict) another booth's image
    const id = crypto.createHash('sha256').update(pid + ':').update(buf).digest('hex').slice(0, 20); this.images.set(id, { pid, buf }); return { ok: true, id };
  }
  async persistImage(id) { const im = this.images.get(id); if (this.q && im) await this.q(`INSERT INTO ${SCHEMA}.vendor_images (id, pid, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [id, im.pid, im.buf.toString('base64')]).catch(() => {}); }
  edit(pid, f) {
    const b = this.byPid.get(pid); if (!b || b.removed || this.state(b) === 'free') return { ok: false, why: 'You do not have an active booth.' };
    const name = cleanText(f.name, 28); if (!name || name.length < 3) return { ok: false, why: 'Booth name: 3-28 characters, friendly words, no links.' };
    const desc = cleanText(f.desc || '', 300, { multiline: true }); if (desc === null) return { ok: false, why: 'Description: max 300 characters, friendly words, no links (use the link field).' };
    const link = cleanLink(f.link); if (!link.ok) return link;
    const tent = Number.isInteger(f.tent) && f.tent >= 0 && f.tent < TENTS ? f.tent : 0; const c1 = HEX.test(f.c1 || '') ? f.c1.toLowerCase() : b.c1, c2 = HEX.test(f.c2 || '') ? f.c2.toLowerCase() : b.c2;
    const own = (id) => { const im = this.images.get(id); return im && im.pid === pid; };
    const pick = (id) => (id === null || id === undefined || id === '' ? null : typeof id === 'string' && /^[0-9a-f]{20}$/.test(id) && own(id) ? id : false);
    const logo = pick(f.logo), banner = pick(f.banner); if (logo === false || banner === false) return { ok: false, why: 'Unknown image. Upload it again.' };
    const products = []; for (const p of Array.isArray(f.products) ? f.products.slice(0, MAX_PRODUCTS) : []) { const img = pick(p && p.img); if (img === false || !img) return { ok: false, why: 'A product image is missing. Upload it again.' }; const title = cleanText((p && p.title) || '', 40); if (title === null) return { ok: false, why: 'Product captions: max 40 characters, friendly words, no links.' }; products.push({ img, title }); }
    const before = new Set([b.logo, b.banner, ...b.products.map((p) => p.img)].filter(Boolean)); const after = new Set([logo, banner, ...products.map((p) => p.img)].filter(Boolean));
    const changedImgs = [...after].some((x) => !before.has(x)); Object.assign(b, { name, desc, link: link.url, tent, c1, c2, logo, banner, products }); if (changedImgs && this.premod) b.imgOk = false;
    for (const [id, im] of this.images) if (im.pid === pid && !after.has(id)) { this.images.delete(id); if (this.q) this.q(`DELETE FROM ${SCHEMA}.vendor_images WHERE id=$1`, [id]).catch(() => {}); }
    return { ok: true, booth: b, persist: [...after] };
  }
  // weight: 0 = brand-new account (recorded for the admins, but cannot hide a booth), 1 = established account, 2 = account with a minted badge. Auto-hide when the WEIGHTED total reaches VENDOR_AUTOHIDE_REPORTS,
  // so a swarm of fresh throw-away profiles cannot take down a legitimate booth.
  report(pid, plot, weight = 1) {
    const b = this.booths.get(+plot); if (!b || this.state(b) !== 'open') return { ok: false, why: 'Nothing to report here.' }; if (b.pid === pid) return { ok: false, why: 'That is your own booth.' };
    b.rw = b.rw || {}; if (!b.reports.includes(pid)) b.reports.push(pid); b.rw[pid] = Math.max(b.rw[pid] || 0, Math.min(2, Math.max(0, weight | 0)));
    const score = b.reports.reduce((s, x) => s + (x in b.rw ? b.rw[x] : 1), 0); let auto = false; if (score >= this.autoHide && !b.hidden) { b.hidden = 'reports'; auto = true; } return { ok: true, auto, count: b.reports.length, score, booth: b };
  }
  admin(plot, action, arg) {
    const b = this.booths.get(+plot); if (!b) return { ok: false, why: 'no such booth' };
    switch (action) {
      case 'hide': b.hidden = 'admin'; break; case 'unhide': b.hidden = false; b.reports = []; b.rw = {}; b.imgOk = true; break; case 'approve': b.imgOk = true; break;
      case 'remove': b.removed = true; b.hidden = 'admin'; break; case 'restore': b.removed = false; b.hidden = false; break;
      case 'clear': b.logo = null; b.banner = null; b.products = []; b.desc = ''; b.link = ''; break;
      case 'extend': { const d = Math.min(Math.max(+arg || 0, -365), 365); b.expiresAt += d * DAY; break; }
      default: return { ok: false, why: 'unknown action' };
    }
    return { ok: true, booth: b };
  }
  // ---- views ----
  img(id) { return id && this.images.has(id) ? id : null; }
  card(b) { const ok = b.imgOk !== false; return { plot: b.plot, nick: b.nick, name: b.name, tent: b.tent, c1: b.c1, c2: b.c2, logo: ok ? this.img(b.logo) : null, banner: ok ? this.img(b.banner) : null, exp: b.expiresAt, state: this.state(b) }; }
  list() { const out = []; for (let p = 1; p <= this.plots; p++) { const b = this.booths.get(p); const st = this.state(b); if (st === 'open') out.push(this.card(b)); else if (st === 'grace') out.push({ plot: p, state: 'grace', name: b.name, nick: b.nick, exp: b.expiresAt, tent: b.tent, c1: '#777777', c2: '#999999' }); } return out; }
  detail(plot) { const b = this.booths.get(+plot); if (!b || this.state(b) !== 'open') return null; const ok = b.imgOk !== false; return { ...this.card(b), desc: b.desc, link: b.link, since: b.since, products: ok ? b.products.map((p) => ({ img: this.img(p.img), title: p.title })).filter((p) => p.img) : [], pending: !ok }; }
  mine(pid) { const b = this.byPid.get(pid); return b && !b.removed ? { ...this.card(b), desc: b.desc, link: b.link, products: b.products, logo: b.logo, banner: b.banner, state: this.state(b), hidden: b.hidden, pending: b.imgOk === false } : null; }
  imageVisible(id) { for (const b of this.booths.values()) { if (b.removed) continue; if (b.logo === id || b.banner === id || b.products.some((p) => p.img === id)) return ['open', 'grace'].includes(this.state(b)) && !b.hidden && b.imgOk !== false; } return false; }
  adminList() { return [...this.booths.values()].map((b) => ({ plot: b.plot, pid: b.pid, nick: b.nick, name: b.name, desc: b.desc, link: b.link, state: this.state(b), hidden: b.hidden, removed: b.removed, reports: b.reports.length, pending: b.imgOk === false, expiresAt: b.expiresAt, images: [b.logo, b.banner, ...b.products.map((p) => p.img)].filter(Boolean) })); }
}
module.exports = { Vendors, cleanLink, checkJpeg, COLORS, TENTS, MAX_PRODUCTS };
