// Local-only avatar close-up harness: face / upper / full body, front + 3/4. Usage: SHOT_OUT=dir/ node tools/avshots.cjs <label>
{ let s = +(process.env.SEED || 7); Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); } // deterministic avatar for before/after
process.env.SERVER_SECRET = 'perf-secret-0123456789abcdef'; process.env.PORT = '3392'; process.env.PROFILE_CREATE_PER_HOUR = '1000'; process.env.MAX_CONNS_PER_IP = '200'; process.env.MINT_ENABLED = '0';
const { launch, until } = require('../test/lib.cjs'); const { devices } = require('playwright'); const S = require('../server.js'); const fs = require('fs');
const BASE = 'http://127.0.0.1:3392/', label = process.argv[2] || 'run', OUT = process.env.SHOT_OUT || '/workspace/nftmock/grounds/';
const SHOTS = [['face', 1.62, 0.55, 30], ['upper', 1.35, 1.3, 35], ['full', 0.95, 3.2, 40]], ANG = [['front', 0], ['34', 0.75]];
let NB = 0; async function boot(pg) { await pg.goto(BASE + '?quality=high&phase=0.3'); await until(pg, () => window.__ready, null, 180000);
  await pg.fill('input[aria-label=Nickname]', 'AvTest' + (++NB)); await pg.locator('text=Create profile').evaluate((e) => e.click()); await until(pg, () => window.__sg.state.me && window.__sg.state.me.pid, null, 120000);
  await pg.waitForTimeout(800); await pg.evaluate(() => document.querySelectorAll('#modals > *').forEach((m) => m.remove()));
  await until(pg, () => window.__sg.me && window.__sg.me.person && window.__sg.me.person.root.visible, null, 120000).catch(() => {}); }
(async () => {
  await S.init(); await new Promise((r) => S.server.listen(3392, '127.0.0.1', r)); const b = await launch(); const res = { errors: [] };
  try {
    const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 } }); const pg = await ctx.newPage(); if (process.env.NOHAT) await pg.addInitScript(() => { window.__noHat = true; }); pg.on('pageerror', (e) => res.errors.push(e.message));
    const t0 = Date.now(); await boot(pg); res.loadMs = Date.now() - t0;
    await pg.evaluate(() => { window.__sg.goto(0, 5); window.__sg.setCam(0, 0.2); window.__sg.setDist(4); }); await pg.waitForTimeout(12000); // let HD avatar bake in
    res.hd = await pg.evaluate(() => { const roots = []; window.__sg.scene().traverse((o) => { if (o.userData && o.userData.bones && o.visible) roots.push(o); }); const r = roots[0]; if (!r) return null; let tris = 0, meshes = 0, shadow = 0; r.traverse((m) => { if (m.isMesh && m.visible) { meshes++; tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; if (m.castShadow) shadow++; } }); return { tris: Math.round(tris), meshes, shadow, roots: roots.length }; });
    for (const [n, y, d, fov] of SHOTS) for (const [an, a] of ANG) {
      const url = await pg.evaluate(([y, d, fov, a]) => { const sg = window.__sg, r = sg.root || null, me = sg.me.person.root, cam = sg.cam().clone(); me.updateMatrixWorld(true);
        const p = me.getWorldPosition(new cam.position.constructor()), fy = me.getWorldDirection(new cam.position.constructor()); const yaw = Math.atan2(fy.x, fy.z) + a;
        cam.fov = fov; cam.aspect = 1; cam.near = 0.05; cam.position.set(p.x + Math.sin(yaw) * d, p.y + y + 0.02, p.z + Math.cos(yaw) * d); cam.lookAt(p.x, p.y + y, p.z); cam.updateProjectionMatrix();
        const R = sg.renderer(); R.render(sg.scene(), cam); return R.domElement.toDataURL('image/png'); }, [y, d, fov, a]);
      fs.writeFileSync(OUT + label + '_av_' + n + '_' + an + '.png', Buffer.from(url.split(',')[1], 'base64')); }
    const walk = await pg.evaluate(() => { const sg = window.__sg, me = sg.me.person, cam = sg.cam().clone(); const root = me.root; root.updateMatrixWorld(true);
      me.aL.rotation.set(0.65, 0, 0.08); me.aR.rotation.set(-0.4, 0, -0.06); me.lL.rotation.set(0.7, 0, 0); me.lR.rotation.set(-0.35, 0, 0); me.upper.rotation.set(0.1, 0.05, 0.04);
      const p = root.getWorldPosition(new cam.position.constructor()), fy = root.getWorldDirection(new cam.position.constructor()); const yaw = Math.atan2(fy.x, fy.z) + 0.55;
      cam.fov = 38; cam.aspect = 1; cam.near = 0.05; cam.position.set(p.x + Math.sin(yaw) * 3.1, p.y + 1.05, p.z + Math.cos(yaw) * 3.1); cam.lookAt(p.x, p.y + 0.95, p.z); cam.updateProjectionMatrix();
      const R = sg.renderer(); R.render(sg.scene(), cam); root.updateMatrixWorld(true); R.render(sg.scene(), cam); return R.domElement.toDataURL('image/png'); });
    fs.writeFileSync(OUT + label + '_av_walk.png', Buffer.from(walk.split(',')[1], 'base64'));
    const bare = await pg.evaluate(() => { const sg = window.__sg, me = sg.me.person, cam = sg.cam().clone(); const root = me.root; root.updateMatrixWorld(true);
      const hidden = []; root.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.color && o.material.color.getHex() === 0xc9a227) { hidden.push(o); o.visible = false; } });
      const p = root.getWorldPosition(new cam.position.constructor()), fy = root.getWorldDirection(new cam.position.constructor()); const yaw = Math.atan2(fy.x, fy.z);
      cam.fov = 30; cam.aspect = 1; cam.near = 0.05; cam.position.set(p.x + Math.sin(yaw) * 0.55, p.y + 1.64, p.z + Math.cos(yaw) * 0.55); cam.lookAt(p.x, p.y + 1.62, p.z); cam.updateProjectionMatrix();
      const R = sg.renderer(); R.render(sg.scene(), cam); hidden.forEach((o) => { o.visible = true; }); return R.domElement.toDataURL('image/png'); });
    fs.writeFileSync(OUT + label + '_av_face_noglasses.png', Buffer.from(bare.split(',')[1], 'base64'));
    await ctx.close();
    const ph = await b.newContext({ ...devices['iPhone 13'] }); const mp = await ph.newPage(); await boot(mp);
    await mp.evaluate(() => { window.__sg.goto(0, 5); window.__sg.setCam(Math.PI, 0.18); window.__sg.setDist(3.6); }); await mp.waitForTimeout(12000); await mp.screenshot({ path: OUT + label + '_phone_avatar.png' }); await ph.close();
  } catch (e) { res.fatal = e.message; } finally { await b.close(); }
  console.log(JSON.stringify(res)); process.exit(0);
})();
