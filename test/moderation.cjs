// Moderation persistence: mutes / bans (and IP bans) survive a restart through the database store (PGlite stands in for Supabase/Postgres) or a JSON file,
// expired entries are not restored, unban/unmute are persisted too, and a failing store never throws into the admin request. Plus a real server restart with MOD_FILE.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const { Moderation, dbStore, fileStore } = require('../lib/moderation');
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mod-'));
const scenario = async (mkStore) => {
  let now = 1_000_000; const a = new Moderation(() => now); await a.attach(await mkStore());
  a.mute('VW-MUTED1', 30); a.ban('VW-BANNED1', 60, '9.9.9.9'); a.ban('VW-BANNED2', 1, '8.8.8.8'); a.mute('VW-UNMUTED', 30); a.unmute('VW-UNMUTED'); a.ban('VW-UNBANNED', 60, '7.7.7.7'); a.unban('VW-UNBANNED'); a.unbanIp('7.7.7.7'); await a.flush();
  now += 5 * 60000; // "restart" 5 minutes later: BANNED2 (1 min) has expired
  const b = new Moderation(() => now); const restored = await b.attach(await mkStore()); assert(restored >= 4, 'restored ' + restored);
  assert(b.muted('VW-MUTED1'), 'mute survives'); assert(b.banned('VW-BANNED1', null), 'ban survives'); assert(b.banned(null, '9.9.9.9'), 'IP ban survives');
  assert(!b.banned('VW-BANNED2', null) && !b.banned(null, '8.8.8.8'), 'expired ban is gone'); assert(!b.muted('VW-UNMUTED'), 'unmute persisted'); assert(!b.banned('VW-UNBANNED', null) && !b.banned(null, '7.7.7.7'), 'unban persisted');
  b.unban('VW-BANNED1'); await b.flush(); const c = new Moderation(() => now); await c.attach(await mkStore()); assert(!c.banned('VW-BANNED1', null), 'a later unban is also persisted'); assert(c.muted('VW-MUTED1'));
};
(async () => {
  await t('file store: mute / ban / IP ban / unban survive a restart; expired entries are not restored', () => scenario(async () => fileStore(path.join(tmp, 'mod.json'))));
  await t('database store (<schema>.moderation, PGlite standing in for Supabase): same guarantees', async () => { const { PGlite } = require('@electric-sql/pglite'); const db = new PGlite(); await db.exec('CREATE SCHEMA IF NOT EXISTS showgrounds'); await scenario(async () => dbStore((s, p) => db.query(s, p), 'showgrounds').init()); const r = await db.query('SELECT count(*)::int AS c FROM showgrounds.moderation'); assert(r.rows[0].c >= 2); });
  await t('a store that fails never throws into the caller (the in-memory ban still applies) and later writes still go through', async () => {
    let fail = true; const rows = []; const store = { async load() { return []; }, async set(k, i, u) { if (fail) throw new Error('db down'); rows.push([k, i, u]); }, async del() {} }; const m = new Moderation(); const err = console.error; console.error = () => {}; await m.attach(store);
    m.ban('VW-X', 10, '1.1.1.1'); await m.flush(); assert(m.banned('VW-X', null)); fail = false; m.mute('VW-Y', 5); await m.flush(); console.error = err; assert(rows.some((r) => r[1] === 'VW-Y'), 'queue keeps going after a failure'); });
  await t('a corrupt file or garbage rows are ignored, not fatal', async () => { const f = path.join(tmp, 'bad.json'); fs.writeFileSync(f, '{not json'); const e = console.error; console.error = () => {}; const m = new Moderation(); await m.attach(fileStore(f)); console.error = e; assert.strictEqual(m.list().bans.length, 0);
    fs.writeFileSync(f, JSON.stringify([{ kind: 'ban', id: 'VW-OK', until: Date.now() + 60000 }, { kind: 'evil', id: 'x', until: Date.now() + 60000 }, { kind: 'ban', id: 5, until: Date.now() + 60000 }, null])); const m2 = new Moderation(); await m2.attach(fileStore(f)); assert(m2.banned('VW-OK', null)); assert.strictEqual(m2.list().bans.length, 1); });
  await t('REAL server restart: a ban made through /api/admin/mod is still in force after the process is restarted (MOD_FILE)', async () => {
    const PORT = 3363, file = path.join(tmp, 'server-mod.json'); const env = { ...process.env, SERVER_SECRET: 'mod-secret-0123456789-0123456789abcdef', PORT: String(PORT), MINT_NETWORK: 'devnet', ADMIN_SECRET: 'mod-admin-secret-0123456789', MOD_FILE: file, DATABASE_URL: '', USE_PGLITE: '', MAX_CONNS_PER_IP: '50' }; delete env.DATABASE_URL; delete env.USE_PGLITE;
    const start = () => new Promise((res, rej) => { const c = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] }); c.out = ''; c.stdout.on('data', (d) => { c.out += d; if (/listening/.test(String(d))) res(c); }); c.stderr.on('data', (d) => (c.out += d)); setTimeout(() => rej(new Error('server did not start: ' + c.out.slice(-300))), 25000); });
    const adm = (b) => fetch(`http://127.0.0.1:${PORT}/api/admin/mod`, { method: b ? 'POST' : 'GET', headers: { origin: `http://127.0.0.1:${PORT}`, 'content-type': 'application/json', 'x-admin-secret': env.ADMIN_SECRET }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
    let s = await start(); try { assert((await adm({ action: 'ban', pid: 'VW-PERSIST1', minutes: 120 })).ok); assert((await adm({ action: 'mute', pid: 'VW-PERSIST2', minutes: 120 })).ok); await new Promise((r) => setTimeout(r, 300)); } finally { s.kill(); await new Promise((r) => s.on('exit', r)); }
    assert(fs.existsSync(file), 'file written'); s = await start(); try { const l = await adm(); assert(l.bans.some((x) => x.id === 'VW-PERSIST1' && x.minutesLeft > 100), JSON.stringify(l)); assert(l.mutes.some((x) => x.id === 'VW-PERSIST2'), JSON.stringify(l)); assert(/restored/.test(s.out), s.out.slice(-300)); } finally { s.kill(); } });
  fs.rmSync(tmp, { recursive: true, force: true }); console.log(process.exitCode ? 'MODERATION TESTS FAILED' : `all ${n} moderation tests passed`); process.exit(process.exitCode || 0);
})();
