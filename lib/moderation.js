// Admin moderation: mute / kick / ban by profile id (pid) for a duration (bans also remember the player's IP so a new profile on the same network is refused too).
// Enforced in chat, WebRTC signaling, the DJ mic relay and join.
// Persistence: attach(store) loads unexpired entries and then writes every change through, so a restart / redeploy does not free a banned or muted player.
//   dbStore(query, schema)  Postgres/Supabase table <schema>.moderation (the same database as profiles)   fileStore(path)  JSON file (atomic rename; needs a persistent disk)
// Without a store it is memory only (the server logs a warning).
'use strict';
const fs = require('fs'); const path = require('path');
const MAX_MIN = 525600; // 1 year
class Moderation {
  constructor(now = () => Date.now()) { this.now = now; this.mutes = new Map(); this.bans = new Map(); this.ipBans = new Map(); this.store = null; this.chain = Promise.resolve(); }
  _map(kind) { return kind === 'mute' ? this.mutes : kind === 'ban' ? this.bans : this.ipBans; }
  _put(kind, id, until) { this._map(kind).set(id, until); this._w((st) => st.set(kind, id, until)); }
  _del(kind, id) { const r = this._map(kind).delete(id); if (r) this._w((st) => st.del(kind, id)); return r; }
  _w(fn) { if (!this.store) return; this.chain = this.chain.then(() => fn(this.store)).catch((e) => console.error('[moderation] could not persist:', String(e && e.message).slice(0, 120))); } // ordered, never throws into the caller
  flush() { return this.chain; } // resolves when every change so far is stored
  async attach(store) { // load what is still in force, then keep the store in step
    const rows = await store.load(); const t = this.now(); for (const { kind, id, until } of rows) if (until > t && ['mute', 'ban', 'ip'].includes(kind) && typeof id === 'string') this._map(kind).set(id, Number(until));
    this.store = store; this.sweep(); return rows.length; }
  static minutes(v, dflt) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_MIN) : dflt; }
  sweep() { const t = this.now(); for (const [kind, m] of [['mute', this.mutes], ['ban', this.bans], ['ip', this.ipBans]]) for (const [k, v] of m) if (v <= t) this._del(kind, k); }
  mute(pid, minutes) { this._put('mute', pid, this.now() + minutes * 60000); }
  unmute(pid) { return this._del('mute', pid); }
  ban(pid, minutes, ip) { const u = this.now() + minutes * 60000; this._put('ban', pid, u); if (ip) this._put('ip', ip, u); }
  unban(pid) { return this._del('ban', pid); }
  unbanIp(ip) { return this._del('ip', ip); }
  muted(pid) { const u = this.mutes.get(pid); if (!u) return false; if (u <= this.now()) { this._del('mute', pid); return false; } return true; }
  banned(pid, ip) { const t = this.now(); const u = pid && this.bans.get(pid); if (u) { if (u > t) return true; this._del('ban', pid); } const v = ip && this.ipBans.get(ip); if (v) { if (v > t) return true; this._del('ip', ip); } return false; }
  list() { this.sweep(); const t = this.now(); const o = (m) => [...m].map(([k, v]) => ({ id: k, minutesLeft: Math.ceil((v - t) / 60000) })); return { mutes: o(this.mutes), bans: o(this.bans), ipBans: this.ipBans.size }; }
}

// Postgres / Supabase: one row per active entry. The table lives in the app schema, so lib/rls.js turns Row Level Security on for it like for the others.
function dbStore(query, schema) {
  const T = `${String(schema).replace(/[^a-z0-9_]/gi, '')}.moderation`;
  return {
    async init() { // locked down BEFORE use, and verified: Supabase's public (anon / authenticated) PostgREST roles must never be able to read or write who is banned
      await query(`CREATE TABLE IF NOT EXISTS ${T} (kind TEXT NOT NULL, id TEXT NOT NULL, until_ms BIGINT NOT NULL, PRIMARY KEY (kind, id))`);
      await query(`ALTER TABLE ${T} ENABLE ROW LEVEL SECURITY`);
      await query(`REVOKE ALL ON ${T} FROM PUBLIC`);
      await query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON ${T} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON ${T} FROM authenticated; END IF; END $$`); // (these roles exist on Supabase, not on plain Postgres)
      const r = await query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [T]); if (!r.rows[0] || r.rows[0].relrowsecurity !== true) throw new Error('row level security is not enabled on ' + T);
      return this;
    },
    async load() { const r = await query(`SELECT kind, id, until_ms FROM ${T}`); return r.rows.map((x) => ({ kind: x.kind, id: x.id, until: Number(x.until_ms) })); },
    async set(kind, id, until) { await query(`INSERT INTO ${T} (kind, id, until_ms) VALUES ($1, $2, $3) ON CONFLICT (kind, id) DO UPDATE SET until_ms = EXCLUDED.until_ms`, [kind, id, Math.round(until)]); },
    async del(kind, id) { await query(`DELETE FROM ${T} WHERE kind = $1 AND id = $2`, [kind, id]); },
  };
}
// JSON file (atomic: write a temp file, rename it over the old one). Only durable on a persistent disk.
function fileStore(file, { strict = false } = {}) { // strict (production): an unreadable / corrupt file is an error, not an empty list
  const rows = new Map(); const key = (k, i) => k + '\u0000' + i;
  const save = async () => { const tmp = file + '.tmp-' + process.pid; await fs.promises.mkdir(path.dirname(file), { recursive: true }); await fs.promises.writeFile(tmp, JSON.stringify([...rows.values()]), { mode: 0o600 }); await fs.promises.rename(tmp, file); };
  return {
    async load() { try { const j = JSON.parse(await fs.promises.readFile(file, 'utf8')); if (Array.isArray(j)) for (const x of j) if (x && typeof x.id === 'string') rows.set(key(x.kind, x.id), { kind: x.kind, id: x.id, until: Number(x.until) }); } catch (e) { if (e.code !== 'ENOENT') { if (strict) throw e; console.error('[moderation] could not read', file, String(e.message).slice(0, 100)); } } return [...rows.values()]; },
    async set(kind, id, until) { rows.set(key(kind, id), { kind, id, until }); await save(); },
    async del(kind, id) { rows.delete(key(kind, id)); await save(); },
  };
}
// Boot wiring. Chooses the store (database when profiles have one, else MOD_FILE, else memory), restores state and returns { mode, restored }.
// In production a configured-but-failing store (DATABASE_URL set but the database is down, RLS/REVOKE failed, unreadable MOD_FILE) THROWS: the caller refuses to start rather than run with bans silently in memory.
async function setupModeration(mod, { q, env = process.env, schema = 'showgrounds', prod = false } = {}) {
  const sch = String(schema).replace(/[^a-z0-9_]/gi, ''); let mode = 'memory';
  try {
    if (env.DATABASE_URL && !q) throw new Error('DATABASE_URL is set but the database is unavailable');
    const store = q ? dbStore(q, sch) : env.MOD_FILE ? fileStore(env.MOD_FILE, { strict: prod }) : null; if (!store) { console.warn('[moderation] memory only: mutes and bans are lost on restart (set DATABASE_URL or MOD_FILE)'); return { mode, restored: 0 }; }
    if (store.init) await store.init(); mode = q ? 'database' : 'file'; const restored = await mod.attach(store); console.log(`[moderation] ${restored} active mutes/bans restored (${mode})`); return { mode, restored };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 160);
    if (prod) { console.error('FATAL [moderation]: persistence is configured but failed (' + msg + '). Refusing to start with bans held only in memory.'); throw Object.assign(new Error('moderation persistence failed: ' + msg), { fatal: true }); }
    console.error('[moderation] persistence unavailable, memory only:', msg); return { mode: 'memory', restored: 0 };
  }
}
module.exports = { Moderation, MAX_MIN, dbStore, fileStore, setupModeration };
