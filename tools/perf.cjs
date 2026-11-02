// Local-only perf + screenshot harness for the grounds (headless Chrome/SwiftShader). Usage: node tools/perf.cjs <label> [shots]
process.env.SERVER_SECRET = 'perf-secret-0123456789abcdef'; process.env.PORT = '3391'; process.env.PROFILE_CREATE_PER_HOUR = '1000'; process.env.MAX_CONNS_PER_IP = '200'; process.env.MINT_ENABLED = '0';
const { launch, until } = require('../test/lib.cjs'); const { devices } = require('playwright'); const S = require('../server.js'); const fs = require('fs');
const BASE = 'http://127.0.0.1:3391/', label = process.argv[2] || 'run', shots = process.argv[3] === 'shots', OUT = '/workspace/nftmock/grounds/';
(async () => {
  await S.init(); await new Promise((r) => S.server.listen(3391, '127.0.0.1', r)); const b = await launch(); const res = {};
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
    const t0 = Date.now(); await pg.goto(BASE + '?quality=high&phase=0.3'); await until(pg, () => window.__ready, null, 180000); res.loadMs = Date.now() - t0;
    res.jsKB = Math.round(fs.readdirSync('docs/js', { recursive: true }).filter((f) => f.endsWith('.js')).reduce((a, f) => a + fs.statSync('docs/js/' + f).size, 0) / 1024);
    await pg.fill('input[aria-label=Nickname]', 'Perf' + Math.floor(Math.random() * 9000 + 1000)); await pg.locator('text=Create profile').evaluate((e) => e.click()); await until(pg, () => window.__sg.state.me && window.__sg.state.me.pid, null, 120000);
    await pg.waitForTimeout(800); await pg.evaluate(() => document.querySelectorAll('#modals > *').forEach((m) => m.remove()));
    const tj = Date.now(); await until(pg, () => window.__sg.me && window.__sg.me.root && window.__sg.me.root.visible, null, 120000).catch(() => {}); await pg.waitForTimeout(4000); res.joinToReadyMs = Date.now() - tj;
    const info = async () => pg.evaluate(() => new Promise((res) => { const r = window.__sg.renderer(); r.info.autoReset = false; r.info.reset(); requestAnimationFrame(() => requestAnimationFrame(() => { const o = { calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, progs: (r.info.programs || []).length }; r.info.autoReset = true; res(o); })); }));
    const view = async (x, z, yaw, pitch, dist, wait = 1500) => { await pg.evaluate(([x, z, y, p, d]) => { window.__sg.goto(x, z); window.__sg.setCam(y, p); window.__sg.setDist(d); }, [x, z, yaw, pitch, dist]); await pg.waitForTimeout(wait); };
    if (process.env.DIAG) { await view(0, 5, 0, 0.2, 4, 2500); const a = await info(); const r = {}; r.all = a;
      await pg.evaluate(() => { window.__hdav = []; window.__sg.scene().traverse((o) => { if (o.userData && o.userData.bones) window.__hdav.push(o); }); window.__hdav.forEach((o) => { o.__v = o.visible; o.visible = false; }); }); r.noHDav = await info();
      await pg.evaluate(() => { window.__lst = []; window.__sg.scene().traverse((o) => { if (o.isMesh && o.parent === window.__sg.scene() && o.geometry.attributes.position.count > 100000) window.__lst.push(o); }); }); 
      r.meshesAv = await pg.evaluate(() => window.__hdav.map((o) => { const l = []; o.traverse((m) => { if (m.isMesh) l.push((m.isSkinnedMesh ? 'S:' : '') + (Array.isArray(m.material) ? m.material.length : 1) + ':' + m.geometry.attributes.position.count); }); return l.join(' '); }));
      console.log(JSON.stringify(r)); process.exit(0); }
    await view(0, -10, Math.PI, 0.35, 14, 3000); res.overview = await info(); if (shots) await pg.screenshot({ path: OUT + label + '_overview.png' });
    await view(0, 5, 0, 0.2, 4, 2500); res.avatar = await info(); if (shots) await pg.screenshot({ path: OUT + label + '_avatar.png' });
    const fps = await pg.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else r(n / ((performance.now() - t) / 1000)); }; requestAnimationFrame(f); })); res.fpsSwiftShader = +fps.toFixed(1);
    // HD readiness + per-ride shots: a lineup of the six rides on the open lot
    res.hd = await pg.evaluate(() => { let cars = 0, hdCars = 0, ppl = 0, hdPpl = 0; window.__sg.scene().traverse((o) => { if (o.userData && o.userData.body && o.userData.dims) { cars++; if (o.userData.hd) hdCars++; } }); for (const e of window.__sg.players.values()) { ppl++; if (e.person && e.person.hd) hdPpl++; } let avMeshes = 0, avShadow = 0; window.__sg.scene().traverse((o) => { if (o.userData && o.userData.bones && o.visible) o.traverse((m) => { if (m.isMesh && m.visible) { avMeshes++; if (m.castShadow) avShadow++; } }); }); return { cars, hdCars, ppl, hdPpl, avMeshes, avShadow }; });
    if (shots) { const specs = [{ model: 2, paint: 'flake', c1: '#2a9d8f', c2: null, wheels: 2, stance: 2, extras: 388, plate: 1 }, { model: 1, paint: 'two', c1: '#e76f22', c2: '#f4f1ea', wheels: 0, stance: 1, extras: 131, plate: 1 }, { model: 0, paint: 'solid', c1: '#e63946', c2: null, wheels: 1, stance: 0, extras: 1, plate: 0 }, { model: 5, paint: 'solid', c1: '#ffd166', c2: null, wheels: 3, stance: 3, extras: 32, plate: 0 }, { model: 3, paint: 'patina', c1: '#6b8f7a', c2: null, wheels: 1, stance: 0, extras: 1, plate: 0 }, { model: 4, paint: 'metallic', c1: '#118ab2', c2: null, wheels: 3, stance: 1, extras: 132, plate: 1 }];
      const names = ['ghia', 'camper', 'bug', 'baja', 'safari', 'wagon'];
      await pg.evaluate((specs) => { const sc = window.__sg.scene(); window.__lineup = specs.map((sp, i) => { const c = window.__sg.carFor(sp); c.position.set(-6 + i * 0 , 0, 0); c.visible = false; sc.add(c); return c; }); }, specs); await pg.waitForTimeout(4000);
      for (let i = 0; i < 6; i++) { await pg.evaluate(() => { window.__sg.goto(0, 12.5); window.__sg.setCam(Math.PI * 0.82, 0.16); window.__sg.setDist(7); }); await pg.waitForTimeout(1200);
        await pg.evaluate((i) => { const cam = window.__sg.cam(), L = window.__sg.L; const dx = L.x - cam.position.x, dz = L.z - cam.position.z, n = Math.hypot(dx, dz), fx = dx / n, fz = dz / n;
          window.__lineup.forEach((c, k) => { c.visible = k === i; c.position.set(L.x + fx * 1.2 - fz * 2.2, 0, L.z + fz * 1.2 + fx * 2.2); c.rotation.y = Math.atan2(fx, fz) + 2.3; }); }, i); await pg.waitForTimeout(2500); await pg.screenshot({ path: OUT + label + '_car_' + names[i] + '.png' }); }
      res.lineupTris = await pg.evaluate(() => window.__lineup.map((c) => c.userData.tris || null));
      await pg.evaluate(() => window.__lineup.forEach((c) => c.parent.remove(c)));
      await pg.evaluate(() => { const sc = window.__sg.scene(); window.__lineup = [0, 1, 2, 3, 4, 5].map((w) => { const c = window.__sg.carFor({ model: 0, paint: 'solid', c1: '#e63946', c2: null, wheels: w, stance: 0, extras: 0, plate: 0 }); c.visible = false; sc.add(c); return c; }); }); await pg.waitForTimeout(3000);
      for (let i = 0; i < 6; i++) { await pg.evaluate(() => { window.__sg.goto(0, 12.5); window.__sg.setCam(Math.PI * 0.82, 0.05); window.__sg.setDist(4.2); }); await pg.waitForTimeout(1000);
        await pg.evaluate((i) => { const cam = window.__sg.cam(), L = window.__sg.L; const dx = L.x - cam.position.x, dz = L.z - cam.position.z, n = Math.hypot(dx, dz), fx = dx / n, fz = dz / n;
          window.__lineup.forEach((c, k) => { c.visible = k === i; c.position.set(L.x + fx * 0.6 - fz * 1.6, 0, L.z + fz * 0.6 + fx * 1.6); c.rotation.y = Math.atan2(fx, fz) + Math.PI / 2; }); }, i); await pg.waitForTimeout(2500); await pg.screenshot({ path: OUT + label + '_wheel_' + i + '.png' }); }
      await pg.evaluate(() => window.__lineup.forEach((c) => c.parent.remove(c)));
       }
    res.errors = errs.slice(0, 8); await ctx.close();
    if (shots) { const ph = await b.newContext({ ...devices['iPhone 13'] }); const mp = await ph.newPage(); await mp.goto(BASE + '?quality=med&phase=0.3'); await until(mp, () => window.__ready, null, 180000);
      await mp.fill('input[aria-label=Nickname]', 'Ph' + Math.floor(Math.random() * 9000 + 1000)); await mp.locator('text=Create profile').evaluate((e) => e.click()); await until(mp, () => window.__sg.state.me && window.__sg.state.me.pid, null, 120000); await mp.waitForTimeout(800); await mp.evaluate(() => document.querySelectorAll('#modals > *').forEach((m) => m.remove()));
      await mp.evaluate(() => { window.__sg.goto(0, -10); window.__sg.setCam(Math.PI * 0.85, 0.3); }); await mp.waitForTimeout(5000); await mp.screenshot({ path: OUT + label + '_phone.png' }); await ph.close(); }
  } catch (e) { res.fatal = e.message; } finally { await b.close(); }
  console.log(JSON.stringify(res)); fs.writeFileSync(OUT + 'perf_' + label + '.json', JSON.stringify(res, null, 1)); process.exit(0);
})();
