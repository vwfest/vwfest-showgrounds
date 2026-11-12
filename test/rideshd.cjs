// Vehicle finish + baked-ride checks. No server, no wallet. Confirms the r10 materials
// stay in the vehicle module and that every baked ride still has its roles and a pop-top on the Camper.
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const esbuild = require('esbuild');
const out = path.join(os.tmpdir(), 'rideshd-' + process.pid + '.cjs');
(async () => {
  await esbuild.build({ entryPoints: [path.join(__dirname, '../src/ridemat.js')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent', define: { global: 'globalThis' } });
  const { FINISH, hdMaterials } = require(out);
  const fake = () => ({ vertexShader: 'void main(){\n#include <begin_vertex>\n}\n', fragmentShader: 'void main(){\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>\n}\n' });
  let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ', name); };
  t('camper coat is a sharp horizon over a matte base so flat orange panels are not a mirror', () => {
    assert.strictEqual(FINISH.camper.clearcoat, 1); assert(FINISH.camper.clearcoatRoughness <= 0.04); assert(FINISH.camper.roughness >= 0.4); assert.strictEqual(FINISH.camper.metalness, 0);
    const m = hdMaterials({ model: 1, paint: 'two' }); assert.strictEqual(m.paint.envMapIntensity, FINISH.camper.envMapIntensity);
    const sh = fake(); m.paint.onBeforeCompile(sh); assert(sh.vertexShader.includes('vRideP')); assert(sh.fragmentShader.includes('normal = normalize'));
  });
  t('other paints keep a full clearcoat; flake and candy actually sparkle', () => {
    for (const k of ['solid', 'metallic', 'flake', 'candy']) assert.strictEqual(FINISH[k].clearcoat, 1, k);
    assert(FINISH.flake.flake > FINISH.metallic.flake);
    const sh = fake(); hdMaterials({ model: 2, paint: 'flake' }).paint.onBeforeCompile(sh); assert(sh.fragmentShader.includes('step(0.84, h)'));
    const plain = fake(); hdMaterials({ model: 0, paint: 'solid' }).paint.onBeforeCompile(plain); assert(!plain.fragmentShader.includes('step(0.84, h)'));
  });
  t('patina is a dead coat, not a clearcoat', () => { assert.strictEqual(FINISH.patina.clearcoat, 0); assert(FINISH.patina.roughness >= 0.85); });
  t('shared roles: chrome splits by vertex colour, rubber is not pre-darkened, glass freshens, lamps take their own colour', () => {
    const m = hdMaterials({ model: 0, paint: 'solid' });
    assert.strictEqual(m.metal.metalness, 1); assert(m.metal.envMapIntensity >= 1.2);
    const metal = fake(); m.metal.onBeforeCompile(metal); assert(metal.fragmentShader.includes('metalnessFactor')); assert(metal.fragmentShader.includes('warm > 0.35'));
    assert.strictEqual(m.matte.color.getHex(), 0xffffff);
    const matte = fake(); m.matte.onBeforeCompile(matte); assert(matte.fragmentShader.includes('roughnessFactor = 0.92'));
    assert(m.glass.transparent); assert.strictEqual(m.glass.depthWrite, false);
    const glass = fake(); m.glass.onBeforeCompile(glass); assert(glass.fragmentShader.includes('gl_FragColor.a'));
    assert(m.lamp.emissiveIntensity >= 0.35 && m.lamp.emissiveIntensity <= 0.7);
    const lamp = fake(); m.lamp.onBeforeCompile(lamp); assert(lamp.fragmentShader.includes('totalEmissiveRadiance *= vColor'));
    assert.notStrictEqual(m.paint.customProgramCacheKey(), m.metal.customProgramCacheKey());
  });
  t('one material instance is shared across cars of the same finish', () => {
    const a = hdMaterials({ model: 0, paint: 'solid' }), b = hdMaterials({ model: 4, paint: 'solid' });
    assert.strictEqual(a.paint, b.paint); assert.strictEqual(a.glass, b.glass);
    assert.notStrictEqual(a.paint, hdMaterials({ model: 1, paint: 'solid' }).paint);
  });
  t('baked rides: magic, every role, body stays under 30k, stock wheel under 9.5k, Camper carries the pop-top', () => {
    for (let model = 0; model < 6; model++) {
      const buf = fs.readFileSync(path.join(__dirname, '../docs/hd/rides/m' + model + '.bin'));
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      assert.strictEqual(dv.getUint32(0, true), 0x31525756, 'magic ' + model);
      const hl = dv.getUint32(4, true); const head = JSON.parse(buf.slice(8, 8 + hl).toString());
      const roles = new Set(head.parts.filter((p) => p.layer === 'body' && p.lod === 0).map((p) => p.role));
      for (const r of ['paint', 'metal', 'matte', 'glass', 'lamp']) assert(roles.has(r), model + ' missing ' + r);
      for (let w = 0; w < 6; w++) assert(head.parts.some((p) => p.layer === 'w' + w && p.lod === 0), model + ' wheel ' + w);
      const body = head.parts.filter((p) => p.lod === 0 && p.layer === 'body').reduce((s, p) => s + p.ni / 3, 0);
      const wheel = head.parts.filter((p) => p.lod === 0 && p.layer === 'w0').reduce((s, p) => s + p.ni / 3, 0);
      assert(body < 30000, model + ' body ' + body); assert(wheel < 9500, model + ' wheel ' + wheel);
      if (model === 1) {
        const o0 = 8 + hl; let maxY = -1e9;
        for (const e of head.parts) if (e.layer === 'body' && e.lod === 0) {
          const q = new Uint16Array(buf.buffer, buf.byteOffset + o0 + e.pos, e.nv * 3);
          for (let k = 1; k < q.length; k += 3) { const y = head.lo[1] + (q[k] / 65535) * (head.hi[1] - head.lo[1]); if (y > maxY) maxY = y; }
        }
        assert(maxY > 2.02, 'camper pop-top height ' + maxY.toFixed(3));
      }
    }
  });
  t('tyre tread is applied on the shared matte role without pre-darkening rubber', () => {
    const m = hdMaterials({ model: 0, paint: 'solid' });
    const sh = fake(); m.matte.onBeforeCompile(sh);
    assert(sh.fragmentShader.includes('tread'));
    assert(sh.fragmentShader.includes('roughnessFactor = 0.92'));
  });
  t('two-tone on the Bubble uses the metallic clearcoat; camper two-tone stays satin', () => {
    const bubble = hdMaterials({ model: 0, paint: 'two' });
    const camper = hdMaterials({ model: 1, paint: 'two' });
    assert.strictEqual(bubble.paint, hdMaterials({ model: 2, paint: 'metallic' }).paint);
    assert.notStrictEqual(bubble.paint, camper.paint);
    assert.strictEqual(camper.paint.envMapIntensity, FINISH.camper.envMapIntensity);
  });
  t('gold diamond plate is metalness 1, gold, IOR 2.42, and sparks on the letters', () => {
    const { applyGoldDiamondPlate, GOLD_PLATE } = require(out);
    assert.strictEqual(GOLD_PLATE.metalness, 1);
    assert(GOLD_PLATE.roughness <= 0.15);
    assert.strictEqual(GOLD_PLATE.ior, 2.42);
    const mat = { onBeforeCompile: null, customProgramCacheKey: null };
    const uni = { value: 0 };
    applyGoldDiamondPlate(mat, uni);
    const sh = { vertexShader: 'void main(){}', fragmentShader: 'void main(){\n#include <map_fragment>\n#include <metalnessmap_fragment>\n#include <opaque_fragment>\n}', uniforms: {} };
    mat.onBeforeCompile(sh);
    assert.strictEqual(sh.uniforms.uTime, uni);
    assert(sh.fragmentShader.includes('vec3 gold'));
    assert(sh.fragmentShader.includes('metalnessFactor = mix(1.0, 0.04, diaM)'));
    assert(mat.customProgramCacheKey() === 'ride-plate-diamond-gold');
  });
  console.log(n + ' ride checks passed'); if (process.exitCode) process.exit(process.exitCode);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
