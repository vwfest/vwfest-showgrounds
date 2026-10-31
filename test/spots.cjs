// Interaction zones: no two different interactables may overlap (walking up to the Info Booth must never show a game prompt), spawns must be walkable.
process.env.SERVER_SECRET = 's'; process.env.PORT = '3385'; process.env.MINT_NETWORK = 'devnet'; process.env.PROFILE_CREATE_PER_HOUR = '1000';
const assert = require('assert'); const S = require('../server.js'); const { launch, until } = require('./lib.cjs');
(async () => {
  await S.init(); await new Promise((r) => S.server.listen(3385, '127.0.0.1', r));
  const b = await launch(); const pg = await b.newPage({ viewport: { width: 480, height: 270 } }); pg.setDefaultTimeout(30000);
  await pg.goto('http://127.0.0.1:3385/?quality=low'); await until(pg, () => window.__ready, null, 120000);
  await pg.fill('input[aria-label=Nickname]', 'Spots'); await pg.click('text=Create profile'); await until(pg, () => window.__sg && window.__sg.world, null, 120000);
  const { spots, cols } = await pg.evaluate(() => ({ spots: __sg.world.spots.map((s) => ({ id: s.id, x: s.x, z: s.z, r: s.r })), cols: __sg.world.colliders.map((c) => ({ x: c.x, z: c.z, r: c.r || 0, hw: c.hw || 0, hd: c.hd || 0 })) }));
  let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ', name); };
  t(`${spots.length} interaction zones found (games, burn, shop, showroom, info, 24 vendor booths)`, () => { for (const id of ['burn', 'shop', 'showroom', 'info']) assert(spots.some((s) => s.id === id), id); assert(spots.filter((s) => s.id.startsWith('game:')).length >= 6); assert.strictEqual(spots.filter((s) => s.id.startsWith('vendor:')).length, 24); });
  t('no two different interactables overlap (zone distance >= r1 + r2)', () => { const bad = []; for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) { const a = spots[i], c = spots[j]; if (a.id === c.id) continue; const d = Math.hypot(a.x - c.x, a.z - c.z); if (d < a.r + c.r) bad.push(`${a.id} x ${c.id}: ${d.toFixed(1)} < ${(a.r + c.r).toFixed(1)}`); } assert.deepStrictEqual(bad, []); });
  t('the Info Booth zone does not touch any arcade game zone (>= 2 m clear)', () => { const info = spots.find((s) => s.id === 'info'); for (const g of spots.filter((s) => s.id.startsWith('game:'))) assert(Math.hypot(info.x - g.x, info.z - g.z) - info.r - g.r >= 2, g.id); });
  t('every zone can be reached: some point inside its circle is outside all colliders', () => { for (const s of spots) { let ok = false; for (let k = 0; k < 16 && !ok; k++) { const a = (k / 16) * Math.PI * 2, px = s.x + Math.cos(a) * s.r * 0.6, pz = s.z + Math.sin(a) * s.r * 0.6; ok = !cols.some((c) => (c.r ? Math.hypot(px - c.x, pz - c.z) < c.r + 0.45 : Math.abs(px - c.x) < c.hw + 0.45 && Math.abs(pz - c.z) < c.hd + 0.45)); } assert(ok, s.id + ' is walled in'); } });
  t('spawn points are not inside colliders', () => { for (const [sx, sz] of S.hub.spawns) for (const c of cols) { const inside = c.r ? Math.hypot(sx - c.x, sz - c.z) < c.r + 1.5 : Math.abs(sx - c.x) < c.hw + 1.5 && Math.abs(sz - c.z) < c.hd + 1.5; assert(!inside, `spawn ${sx},${sz} in collider ${c.x},${c.z}`); } });
  console.log(`all ${n} interaction-zone tests passed`); await b.close(); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
