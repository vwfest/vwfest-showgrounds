// Persistent profiles: public id + nickname + secret token (only its SHA-256 is stored) + avatar + owned shop items.
// Unique nickname and unique avatar fingerprint. Memory is the working copy; Postgres (own schema "showgrounds") persists it.
const crypto = require('crypto');
const path = require('path');
const { cleanName, nickKey } = require('./names');
const A = require('./avatar');
const SCHEMA = (process.env.DB_SCHEMA || 'showgrounds').replace(/[^a-z0-9_]/gi, '');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const B32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newId = () => 'VW-' + Array.from(crypto.randomBytes(8), (b) => B32[b % B32.length]).join('');
const MAX_PROFILES = Number(process.env.MAX_PROFILES) > 0 ? Number(process.env.MAX_PROFILES) : 50000;

class Profiles {
  constructor(isMintedByOther) { this.byId = new Map(); this.byNick = new Map(); this.byCode = new Map(); this.q = null; this.persistent = false; this.mintedBy = isMintedByOther || (() => null); }
  async init() {
    const DDL = [
      `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,
      `CREATE TABLE IF NOT EXISTS ${SCHEMA}.profiles (id TEXT PRIMARY KEY, nick TEXT NOT NULL, nick_key TEXT NOT NULL UNIQUE, secret_hash TEXT NOT NULL, av_code TEXT NOT NULL UNIQUE, equipped JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS ${SCHEMA}.items (profile_id TEXT NOT NULL, item TEXT NOT NULL, sig TEXT NOT NULL UNIQUE, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (profile_id, item))`,
    ];
    try {
      if (process.env.DATABASE_URL) {
                const pool = require('./db').pool();
        this.q = (t, p) => pool.query(t, p); this.close = () => {};
        for (const s of DDL) await pool.query(s);
      } else if (process.env.USE_PGLITE === '1') {
        const { PGlite } = require('@electric-sql/pglite');
        const db = new PGlite(process.env.PGLITE_DIR || path.join(__dirname, '..', '.localdb'));
        this.q = (t, p) => db.query(t, p); this.close = () => db.close();
        for (const s of DDL) await db.exec(s);
      } else { console.warn('[profiles] no DATABASE_URL: memory only (profiles and purchases reset on restart)'); return; }
      const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});
      const r = await this.q(`SELECT id, nick, nick_key, secret_hash, av_code, equipped, extract(epoch from created_at)*1000 AS c FROM ${SCHEMA}.profiles`);
      for (const x of r.rows) { const av = A.unpack(x.av_code); if (av) this.put({ id: x.id, nick: x.nick, key: x.nick_key, hash: x.secret_hash, av, code: x.av_code, created: Math.round(+x.c), items: new Map(), equipped: j(x.equipped) }); }
      const it = await this.q(`SELECT profile_id, item, sig, data FROM ${SCHEMA}.items`);
      for (const x of it.rows) { const p = this.byId.get(x.profile_id); if (p) p.items.set(x.item, { sig: x.sig, ...j(x.data) }); this.sigs.add(x.sig); }
      this.persistent = true; console.log(`[profiles] loaded ${this.byId.size} profiles, ${it.rows.length} items`);
    } catch (e) { console.error('[profiles] DB unavailable, memory only:', e.message); this.q = null; }
  }
  get sigs() { return this._sigs || (this._sigs = new Set()); }
  put(p) { this.byId.set(p.id, p); this.byNick.set(p.key, p.id); this.byCode.set(p.code, p.id); }
  get size() { return this.byId.size; }
  // Is this exact trait combination used by someone else (live profile) or already minted as an NFT by someone else?
  taken(code, exceptId) {
    const o = this.byCode.get(code); if (o && o !== exceptId) return true;
    const m = this.mintedBy(code); return !!(m && m.pid !== exceptId);
  }
  save(p) {
    if (!this.q) return;
    this.q(`INSERT INTO ${SCHEMA}.profiles (id, nick, nick_key, secret_hash, av_code, equipped) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET av_code = EXCLUDED.av_code, equipped = EXCLUDED.equipped, last_seen = now()`, [p.id, p.nick, p.key, p.hash, p.code, JSON.stringify(p.equipped || {})]).catch((e) => console.error('[profiles] persist failed', e.message));
  }
  create(rawNick, quiz) {
    const nick = cleanName(rawNick);
    if (!nick) return { err: 'badnick', why: 'Nicknames are 3-14 letters, numbers, spaces, _ or -, and must be family friendly.' };
    const key = nickKey(nick); if (this.byNick.has(key)) return { err: 'taken', why: 'That nickname belongs to another profile. Pick a different one.' };
    if (this.byId.size >= MAX_PROFILES) return { err: 'full', why: 'The profile list is full right now.' };
    let id; do { id = newId(); } while (this.byId.has(id));
    const av = A.generate(id, (c) => this.taken(c, id), quiz); const secret = crypto.randomBytes(24).toString('hex');
    const prof = { id, nick, key, hash: sha(secret), av, code: A.pack(av), created: Date.now(), items: new Map(), equipped: {} };
    this.put(prof); this.save(prof);
    return { ok: true, prof, secret, created: true };
  }
  login(id, secret) {
    const p = typeof id === 'string' && typeof secret === 'string' && secret.length === 48 ? this.byId.get(id) : null;
    if (!p || !safeEq(sha(secret), p.hash)) return null;
    return p;
  }
  // Wallet recovery: issue a NEW secret (only its hash is kept); every older copy of the credential stops working.
  rotateSecret(id) {
    const p = this.byId.get(id); if (!p) return null; const secret = crypto.randomBytes(24).toString('hex'); p.hash = sha(secret);
    if (this.q) this.q(`UPDATE ${SCHEMA}.profiles SET secret_hash = $2, last_seen = now() WHERE id = $1`, [p.id, p.hash]).catch((e) => console.error('[profiles] secret persist failed', e.message));
    return secret;
  }
  setAvatar(id, rawAv) {
    const p = this.byId.get(id); if (!p) return { ok: false, why: 'Unknown profile' };
    const av = A.cleanAvatar(rawAv), code = A.pack(av);
    if (code === p.code) return { ok: true, av, code, same: true };
    if (this.taken(code, id)) return { ok: false, why: 'Another profile already has exactly this look. Change any one option to make it yours.' };
    this.byCode.delete(p.code); p.av = av; p.code = code; this.byCode.set(code, id); this.save(p);
    return { ok: true, av, code };
  }
  // ---- shop ownership: one row per (profile, item); each purchase signature is unique and can never be reused ----
  grant(id, item, rec) {
    const p = this.byId.get(id); if (!p) return { ok: false, why: 'Unknown profile' };
    const cur = p.items.get(item); if (cur && cur.sig === rec.sig) return { ok: true, dup: true }; // idempotent by signature
    if (cur) return { ok: false, why: 'You already own this item' };
    if (this.sigs.has(rec.sig)) return { ok: false, why: 'That transaction was already used' };
    this.sigs.add(rec.sig); p.items.set(item, rec);
    if (this.q) this.q(`INSERT INTO ${SCHEMA}.items (profile_id, item, sig, data) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id, item, rec.sig, JSON.stringify(rec)]).catch((e) => console.error('[profiles] item persist failed', e.message));
    return { ok: true };
  }
  equip(id, slot, item) { const p = this.byId.get(id); if (!p) return false; if (item) p.equipped[slot] = item; else delete p.equipped[slot]; this.save(p); return true; }
}
module.exports = { Profiles };
