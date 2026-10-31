// One shared Postgres pool with real TLS verification (no rejectUnauthorized:false).
//   DATABASE_URL   postgres connection string (Supabase: use the "Transaction pooler" or direct string)
//   PG_CA_CERT     PEM text of the CA that signed the server cert (Supabase: download "Server root certificate" from Dashboard > Database > SSL)
//   PG_CA_FILE     path to that PEM file (alternative to PG_CA_CERT)
//   PGSSL=off      plain TCP (local dev only);  PGSSL_INSECURE=1  encrypted but UNVERIFIED (emergency escape hatch, logs a warning)
// Without a custom CA the system trust store is used (works for providers with public CAs).
const fs = require('fs');
let pool = null;
function sslConfig() {
  if (process.env.PGSSL === 'off') return false;
  if (process.env.PGSSL_INSECURE === '1') { console.warn('[db] PGSSL_INSECURE=1: TLS certificate is NOT verified. Set PG_CA_CERT / PG_CA_FILE instead.'); return { rejectUnauthorized: false }; }
  const ca = process.env.PG_CA_CERT || (process.env.PG_CA_FILE && fs.readFileSync(process.env.PG_CA_FILE, 'utf8'));
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
}
function connString() { // pg would let ?sslmode=... override our ssl object, so strip it and decide ourselves
  try { const u = new URL(process.env.DATABASE_URL); for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(k); return u.toString(); } catch { return process.env.DATABASE_URL; }
}
exports.sslConfig = sslConfig;
exports.pool = () => {
  if (!process.env.DATABASE_URL) return null; if (pool) return pool;
  const { Pool } = require('pg'); pool = new Pool({ connectionString: connString(), max: +process.env.PG_POOL_MAX || 6, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30000, ssl: sslConfig() });
  pool.on('error', (e) => console.error('pg pool error', e.message)); return pool;
};
exports.end = async () => { if (pool) { const p = pool; pool = null; await p.end(); } };
