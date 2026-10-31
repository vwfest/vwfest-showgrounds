// Mystery Rides: commit-reveal randomness. At quote time the server publishes commit = SHA256(serverSeed). serverSeed = HMAC(SERVER_SECRET, rideId),
// so nothing needs storing to survive a restart. After the player's mint tx confirms, the ride is rolled from SHA256(serverSeed ":" txSignature):
// the signature does not exist until the player signs (it commits to a fresh blockhash), so the server cannot pick the outcome; the commit
// stops it from changing the seed afterwards. The seed is revealed with the NFT metadata so anyone can recompute the roll.
const crypto = require('crypto');
const path = require('path');
const R = require('../shared/rides');
const SCHEMA = (process.env.DB_SCHEMA || 'showgrounds').replace(/[^a-z0-9_]/gi, '');
const SECRET = require('./secret');
const serverSeed = (rideId) => crypto.createHmac('sha256', SECRET).update('ride:' + rideId).digest('hex');
const commitOf = (seedHex) => crypto.createHash('sha256').update(seedHex).digest('hex');
const rollBytes = (finalHex) => Buffer.concat([crypto.createHmac('sha256', finalHex).update('0').digest(), crypto.createHmac('sha256', finalHex).update('1').digest()]);
const finalSeed = (seedHex, sig) => crypto.createHash('sha256').update(seedHex + ':' + sig).digest('hex');

class Rides {
  constructor() { this.byId = new Map(); this.byCode = new Set(); this.byPid = new Map(); this.q = null; this.version = 0; }
  async init() {
    const DDL = [`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`, `CREATE TABLE IF NOT EXISTS ${SCHEMA}.rides (id TEXT PRIMARY KEY, pid TEXT NOT NULL, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`];
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
      } else return;
      const r = await this.q(`SELECT data FROM ${SCHEMA}.rides ORDER BY at ASC`);
      for (const x of r.rows) this.put(typeof x.data === 'string' ? JSON.parse(x.data) : x.data);
    } catch (e) { console.error('[rides] DB unavailable, memory only:', e.message); this.q = null; }
  }
  put(rec) { this.byId.set(rec.id, rec); this.byCode.add(rec.code); this.byPid.set(rec.pid, (this.byPid.get(rec.pid) || []).concat(rec)); this.version++; }
  forProfile(pid) { return this.byPid.get(pid) || []; }
  recent(n) { return [...this.byId.values()].sort((a, b) => b.ts - a.ts).slice(0, n); }
  // Roll + record. Re-rolls (counter in the seed, still deterministic and published) only if the exact trait set already exists.
  reveal({ id, pid, sig, asset, wallet }) {
    const seed = serverSeed(id);
    for (let n = 0; n < 50; n++) {
      const fin = finalSeed(seed, n ? sig + '#' + n : sig); const spec = R.roll(rollBytes(fin)); const code = R.code(spec).toString('base64url');
      if (this.byCode.has(code)) continue;
      const rec = { id, pid, sig, asset: asset || null, wallet, seed, commit: commitOf(seed), reroll: n, spec, code, ts: Date.now() };
      this.put(rec);
      if (this.q) this.q(`INSERT INTO ${SCHEMA}.rides (id, pid, data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, pid, JSON.stringify(rec)]).catch((e) => console.error('[rides] persist failed', e.message));
      return rec;
    }
    throw new Error('could not roll a unique ride');
  }
}
module.exports = { Rides, serverSeed, commitOf, rollBytes, finalSeed };
