// Defence in depth for the shared Supabase project: turn Row Level Security ON (with no policies) for every table in our schema, so the
// project's public PostgREST/anon keys can never read or write them. The server connects as the table owner, which is not affected by RLS.
// Best-effort: failures are logged, never fatal.
'use strict';
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
async function enableRls(query, schema) {
  const done = [];
  try {
    const r = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [schema]);
    for (const { table_name: t } of r.rows) { try { await query(`ALTER TABLE ${q(schema)}.${q(t)} ENABLE ROW LEVEL SECURITY`); done.push(t); } catch (e) { console.warn('[rls] could not enable on', t, String(e.message).slice(0, 100)); } }
  } catch (e) { console.warn('[rls] skipped:', String(e.message).slice(0, 100)); }
  return done;
}
module.exports = { enableRls };
