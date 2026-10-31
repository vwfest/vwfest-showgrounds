'use strict';
// Tiny key-value store. The in-memory Maps are the source of truth, so every check-and-set is SYNCHRONOUS (no await between "is it
// taken?" and "take it"): that is what prevents double-grant races on tx signatures, quotes, and trait sets. A backend (JSONL file or
// Postgres) only persists writes behind the scenes and replays them at boot via init().
const fs = require('fs');
const path = require('path');

class Store {
  constructor(backend = null) { this.ns = new Map(); this.backend = backend; this.pending = Promise.resolve(); }
  _m(ns) { let m = this.ns.get(ns); if (!m) this.ns.set(ns, (m = new Map())); return m; }
  async init() { if (this.backend && this.backend.load) for (const [ns, k, v] of await this.backend.load()) { if (v === null) this._m(ns).delete(k); else this._m(ns).set(k, v); } return this; }
  get(ns, k) { return this._m(ns).get(k); }
  has(ns, k) { return this._m(ns).has(k); }
  // Atomic put-if-absent. Returns true only for the single caller that wins.
  reserve(ns, k, v) { const m = this._m(ns); if (m.has(k)) return false; m.set(k, v); this._persist(ns, k, v); return true; }
  set(ns, k, v) { this._m(ns).set(k, v); this._persist(ns, k, v); }
  delete(ns, k) { if (this._m(ns).delete(k)) this._persist(ns, k, null); }
  values(ns) { return [...this._m(ns).values()]; }
  entries(ns) { return [...this._m(ns).entries()]; }
  size(ns) { return this._m(ns).size; }
  _persist(ns, k, v) { if (this.backend) this.pending = this.pending.then(() => this.backend.write(ns, k, v)).catch((e) => console.error('[solana/store] persist failed:', e.message)); }
  async flush() { await this.pending; }
  async close() { await this.flush(); if (this.backend && this.backend.close) await this.backend.close(); }
}

// Append-only JSONL log, replayed on boot (last write wins). Good for a VPS / persistent disk. NOT for Render free (ephemeral disk): use PgStore.
function fileBackend(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return {
    async load() { if (!fs.existsSync(file)) return []; const out = []; for (const line of fs.readFileSync(file, 'utf8').split('\n')) { if (!line) continue; try { const [ns, k, v] = JSON.parse(line); out.push([ns, k, v]); } catch {} } return out; },
    async write(ns, k, v) { fs.appendFileSync(file, JSON.stringify([ns, k, v]) + '\n'); },
  };
}

// Postgres backend. TLS is VERIFIED (rejectUnauthorized stays true). Supply the provider's CA via PG_CA (PEM text or base64 PEM) when it is
// not in the system trust store (e.g. Supabase). PGSSL=off exists only for a local, non-TLS dev database and is refused in production.
function pgBackend({ url, ca, ssl, schema = 'vwfest_solana', pg } = {}) {
  const { Pool } = pg || require('pg');
  const s = String(schema).replace(/[^a-z0-9_]/gi, '');
  let sslOpt;
  if (ssl === 'off') { if (process.env.NODE_ENV === 'production') throw new Error('PGSSL=off is not allowed in production'); sslOpt = false; }
  else { sslOpt = { rejectUnauthorized: true }; if (ca) sslOpt.ca = ca.includes('BEGIN CERTIFICATE') ? ca : Buffer.from(ca, 'base64').toString('utf8'); }
  const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 8000, ssl: sslOpt });
  pool.on('error', (e) => console.error('[solana/pg]', e.message));
  return {
    sslOpt,
    async load() {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ${s}.kv (ns TEXT NOT NULL, k TEXT NOT NULL, v JSONB, at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (ns, k))`);
      const r = await pool.query(`SELECT ns, k, v FROM ${s}.kv`); return r.rows.map((x) => [x.ns, x.k, x.v]);
    },
    async write(ns, k, v) {
      if (v === null) await pool.query(`DELETE FROM ${s}.kv WHERE ns=$1 AND k=$2`, [ns, k]);
      else await pool.query(`INSERT INTO ${s}.kv (ns,k,v) VALUES ($1,$2,$3) ON CONFLICT (ns,k) DO UPDATE SET v=EXCLUDED.v, at=now()`, [ns, k, JSON.stringify(v)]);
    },
    close: () => pool.end(),
  };
}

function createStore(env = process.env) {
  if (env.DATABASE_URL) return new Store(pgBackend({ url: env.DATABASE_URL, ca: env.PG_CA, ssl: env.PGSSL }));
  if (env.SOLANA_STORE_FILE) return new Store(fileBackend(env.SOLANA_STORE_FILE));
  return new Store(null);
}
module.exports = { Store, fileBackend, pgBackend, createStore };
