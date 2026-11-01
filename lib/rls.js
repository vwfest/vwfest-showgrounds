// Defence in depth for the shared Supabase project: turn Row Level Security ON (with no policies) for every table in our schema, so the
// project's public PostgREST/anon keys can never read or write them. The server connects as the table owner, which is not affected by RLS.
// Best-effort: failures are logged, never fatal.
'use strict';
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
async function enableRls(query, schema) {
  const done = [];
  try {
    const r = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [schema]);
    for (const { table_name: t } of r.rows) {
      const T = `${q(schema)}.${q(t)}`; let ok = true;
      // RLS on AND every grant removed from PUBLIC / anon / authenticated (the roles of the shared project's public API); each step awaited, failures reported
      try { await query(`ALTER TABLE ${T} ENABLE ROW LEVEL SECURITY`); } catch (e) { ok = false; console.warn('[rls] could not enable on', t, String(e.message).slice(0, 100)); }
      try { await query(`REVOKE ALL ON ${T} FROM PUBLIC`); await query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON ${T} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON ${T} FROM authenticated; END IF; END $$`); } catch (e) { ok = false; console.warn('[rls] could not revoke on', t, String(e.message).slice(0, 100)); }
      if (ok) done.push(t);
    }
    try { await query(`REVOKE ALL ON SCHEMA ${q(schema)} FROM PUBLIC`); await query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON SCHEMA ${q(schema)} FROM anon; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON SCHEMA ${q(schema)} FROM authenticated; END IF; END $$`); } catch (e) { console.warn('[rls] could not revoke on schema', String(e.message).slice(0, 100)); }
  } catch (e) { console.warn('[rls] skipped:', String(e.message).slice(0, 100)); }
  return done;
}
module.exports = { enableRls };
