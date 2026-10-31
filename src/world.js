// The VW FEST SHOW GROUNDS: static scene merged into a handful of draw calls, plus interactive spots and a day/sunset cycle.
import { THREE, Batch, MAT, shade, mix, cTex } from './batch.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildCar, carFor, rideSpec, hydraulics, PLATE_UNI } from './cars.js';
import RIDES from '../shared/rides.js';
import { buildExtras } from './extras.js';
import { Grass, buildMask } from './grass.js';

export const HALF = 128;
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const R = rng(209916);
const pick = (a) => a[Math.floor(R() * a.length)];
import GAMES_LIST from '../shared/games.js';
export const GAMES = GAMES_LIST;
function canvasTex(w, h, draw) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); draw(x, w, h); const t = cTex(cv); t.anisotropy = 4; return { t, cv, x }; }
function signMesh(w, h, tex, basic = true) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }) : new THREE.MeshLambertMaterial({ map: tex })); return m; }
function textTex(lines, o = {}) {
  const w = o.w || 512, h = o.h || 256;
  return canvasTex(w, h, (x) => { x.fillStyle = o.bg || '#1a1033'; x.fillRect(0, 0, w, h); if (o.border) { x.strokeStyle = o.border; x.lineWidth = 10; x.strokeRect(8, 8, w - 16, h - 16); }
    x.textAlign = 'center'; x.textBaseline = 'middle'; lines.forEach((l, i) => { x.fillStyle = l.c || '#fff'; x.font = `900 ${l.s || 60}px Arial Black, Arial, sans-serif`; if (l.glow) { x.shadowColor = l.c; x.shadowBlur = 24; } else x.shadowBlur = 0; x.fillText(l.t, w / 2, l.y || h * ((i + 1) / (lines.length + 1)), w - 30); }); });
}
export function mergeMeshes(group) { // bake world transforms of all meshes in group, merge by material
  group.updateMatrixWorld(true); const byMat = new Map();
  group.traverse((o) => { if (!o.isMesh) return; let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(a)) g.deleteAttribute(a);
    const k = o.material.uuid; if (!byMat.has(k)) byMat.set(k, { mat: o.material, geos: [] }); byMat.get(k).geos.push(g); });
  const out = new THREE.Group(); for (const { mat, geos } of byMat.values()) { const has = geos.every((g) => g.attributes.color), hasUv = geos.every((g) => g.attributes.uv); for (const g of geos) { if (!has) g.deleteAttribute('color'); if (!hasUv) g.deleteAttribute('uv'); } out.add(new THREE.Mesh(mergeGeometries(geos, false), mat)); }
  return out;
}

export function buildWorld(scene, opts = {}) {
  const colliders = [], spots = [], anim = [], api = { colliders, spots, anim };
  const solid = new Batch(), neon = new Batch(), soft = new Batch();
  const ring = (x, z, r, name) => colliders.push({ x, z, r });
  const rect = (x, z, w, d) => colliders.push({ x, z, hw: w / 2, hd: d / 2 });
  // ---------- ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 80, HALF * 2 + 80, 1, 1), new THREE.MeshStandardMaterial({ color: 0x4f8f3a, roughness: 0.95, metalness: 0 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'ground'; scene.add(ground);
  const gtex = canvasTex(256, 256, (x) => { x.fillStyle = '#4f8f3a'; x.fillRect(0, 0, 256, 256); for (let i = 0; i < 1400; i++) { x.fillStyle = ['#5da046', '#437c31', '#68ad4f', '#3f7530'][i & 3]; x.fillRect(R() * 256, R() * 256, 2 + R() * 4, 2 + R() * 4); } });
  gtex.t.wrapS = gtex.t.wrapT = THREE.RepeatWrapping; gtex.t.repeat.set(70, 70); ground.material.map = gtex.t; ground.material.color.set(0xffffff);
  // roads + paved areas (thin boxes just above the grass)
  const roadGeos = []; const roadCol = new THREE.Color();
  const road = (x, z, w, d, c = '#3a3d44') => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, 0.056, z); const pa = g.attributes.position, uv = new Float32Array(pa.count * 2), col = new Float32Array(pa.count * 3); roadCol.set(c); const t = new THREE.Color(1, 1, 1).lerp(roadCol, 0.55);
    for (let i = 0; i < pa.count; i++) { uv[i * 2] = pa.getX(i) * 0.22; uv[i * 2 + 1] = pa.getZ(i) * 0.22; col[i * 3] = t.r * 1.5; col[i * 3 + 1] = t.g * 1.5; col[i * 3 + 2] = t.b * 1.5; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); roadGeos.push(g); };
  road(0, 0, 12, 112); road(0, 52, 70, 20); road(0, -68, 60, 24, '#33363c'); road(0, 20, 26, 26, '#4a4d55'); // main aisle, entrance plaza, stage apron, burn plaza
  road(-72, 0, 8, 100); road(72, 0, 8, 100); road(0, -46, 150, 8); road(0, 36, 150, 8);
  for (let z = -48; z < 50; z += 6) { solid.box(0.25, 0.02, 2.4, '#e8e2c0', 0, 0.07, z); }
  for (const [px, pz, w, d] of [[-92, -5, 28, 56], [92, -5, 28, 56]]) road(px, pz, w, d, '#6a6f78');
  // ---------- perimeter fence ----------
  for (let i = -HALF; i <= HALF; i += 4) for (const [x, z] of [[i, -HALF], [i, HALF], [-HALF, i], [HALF, i]]) { solid.box(0.18, 1.1, 0.18, '#7a5a3a', x, 0.55, z); }
  solid.box(HALF * 2, 0.12, 0.12, '#9a7448', 0, 0.9, -HALF); solid.box(HALF * 2, 0.12, 0.12, '#9a7448', 0, 0.9, HALF); solid.box(0.12, 0.12, HALF * 2, '#9a7448', -HALF, 0.9, 0); solid.box(0.12, 0.12, HALF * 2, '#9a7448', HALF, 0.9, 0);
  // ---------- parked show cars ----------
  const carGroup = new THREE.Group(); const specs = [];
  const PAINT = ['solid', 'solid', 'metallic', 'two', 'candy', 'patina', 'flake'];
  const rows = [-34, -24, -14, -4]; // z
  for (const z of rows) for (let x = -60; x <= 60; x += 6.4) { if (Math.abs(x) < 9) continue; if (R() < 0.12) continue;
    const model = pick([0, 0, 0, 1, 2, 3, 4, 5, 0, 1]), paint = pick(PAINT), c1 = RIDES.COLORS[Math.floor(R() * 16)], c2 = R() < 0.4 ? RIDES.COLORS[Math.floor(R() * 16)] : null;
    const lowrider = R() < 0.07; const spec = { model, paint: lowrider ? 'candy' : (paint === 'two' && !c2 ? 'solid' : paint), c1: '#' + (paint === 'patina' ? RIDES.PATINA[Math.floor(R() * 5)] : c1), c2: paint === 'two' || lowrider ? '#' + (c2 || RIDES.COLORS[3]) : null, wheels: lowrider ? 4 : pick([0, 1, 1, 2, 3]), stance: lowrider ? 4 : pick([0, 0, 1, 1, 2]), extras: lowrider ? 4 | 8 | 128 : Math.floor(R() * 8) & (R() < 0.5 ? 0 : 0b11001), plate: R() < 0.12 ? 1 : 0, stripe: R() < 0.2 ? Math.floor(R() * 4) + 1 : 0, lowrider };
    const car = buildCar(spec); car.position.set(x + (R() - 0.5) * 0.6, 0, z); car.rotation.y = (z % 20 === 4 || z === -4 ? 1 : -1) * 0 + (R() < 0.5 ? 0.1 : -0.1) + (x < 0 ? Math.PI / 2 : -Math.PI / 2) * 0; car.rotation.y = Math.PI / 2 * (x < 0 ? 1 : -1) + (R() - 0.5) * 0.25 + (R() < 0.15 ? Math.PI : 0);
    carGroup.add(car); colliders.push({ x: car.position.x, z, r: 2.3 });
    // display board
    solid.box(0.5, 0.9, 0.05, '#f4f1ea', x + (x < 0 ? -2.3 : 2.3), 0.5, z, 0); }
  { const cm = mergeMeshes(carGroup); cm.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); scene.add(cm); }
  // ---------- stage ----------
  const SZ = -86;
  solid.box(46, 1.6, 20, '#2b2230', 0, 0.8, SZ); solid.box(48, 0.2, 22, '#40344a', 0, 1.65, SZ); rect(0, SZ, 48, 22);
  solid.box(46, 16, 1.2, '#1c1626', 0, 9.6, SZ - 9.4); for (const s of [-1, 1]) { solid.box(1.4, 18, 1.4, '#555a66', s * 23, 9, SZ + 8); solid.box(1.4, 18, 1.4, '#555a66', s * 23, 9, SZ - 9); solid.box(1.4, 1.4, 18, '#555a66', s * 23, 18, SZ - 0.5); }
  solid.box(46, 1.2, 1.2, '#555a66', 0, 18.2, SZ + 8); for (const s of [-1, 1]) for (let i = 0; i < 3; i++) solid.box(3.4, 3.4 + i * 0.4, 3, '#14141a', s * (17 - i * 3.4), 3.4 + (3.4 + i * 0.4) / 2, SZ + 5);
  const sign = textTex([{ t: '$VWFEST', c: '#ff2fd0', s: 150, glow: true, y: 100 }, { t: 'SHOW GROUNDS', c: '#33f0ff', s: 66, glow: true, y: 205 }], { w: 1024, h: 256, bg: '#0b0716' });
  const signM = signMesh(34, 8.5, sign.t); signM.position.set(0, 12.5, SZ - 8.6); scene.add(signM);
  for (let i = 0; i < 13; i++) neon.box(2, 0.3, 0.3, ['#ff2fd0', '#33f0ff', '#ffd166'][i % 3], -24 + i * 4, 17.5, SZ + 8);
  const fx = { level: 0, flash: 0, bars: new Float32Array(24) }; // driven by the DJ client: music level, crowd-hype flash, spectrum
  const stagePts = []; for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.ConeGeometry(2.2, 14, 8, 1, true), new THREE.MeshBasicMaterial({ color: [0xff2fd0, 0x33f0ff, 0xffd166][i % 3], transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); m.position.set(-20 + i * 8, 11, SZ + 6); m.rotation.z = 0; scene.add(m); anim.push((t) => { const sp = 1 + fx.level * 2.2; m.rotation.z = Math.sin(t * 0.8 * sp + i) * (0.5 + fx.level * 0.25); m.rotation.x = Math.cos(t * 0.6 * sp + i * 1.7) * 0.4; m.material.opacity = 0.12 + fx.level * 0.38 + fx.flash * 0.3; m.scale.set(1 + fx.level * 0.5, 1, 1 + fx.level * 0.5); }); }
  // ---------- DJ booth (in front of the stage) ----------
  { const DX = 0, DZ = -70.4;
    solid.box(5.8, 1.0, 1.3, '#15101e', DX, 0.5, DZ); solid.box(6.0, 0.08, 1.5, '#2a2240', DX, 1.04, DZ); rect(DX, DZ, 6.2, 1.7);
    for (const s of [-1, 1]) { solid.cyl(0.46, 0.06, '#0c0c10', DX + s * 1.7, 1.11, DZ, 0, 0, 0, 20); solid.cyl(0.12, 0.08, '#ff2fd0', DX + s * 1.7, 1.13, DZ, 0, 0, 0, 10); solid.box(0.14, 0.05, 0.7, '#9aa', DX + s * 2.45, 1.1, DZ + 0.1); }
    solid.box(1.0, 0.12, 0.8, '#222', DX, 1.12, DZ); for (let i = 0; i < 4; i++) neon.box(0.05, 0.03, 0.4, ['#33f0ff', '#ff2fd0', '#ffd166', '#6dff8a'][i], DX - 0.33 + i * 0.22, 1.19, DZ);
    solid.box(0.9, 0.04, 0.6, '#444', DX + 0.0, 1.1, DZ - 0.45);
    neon.box(5.6, 0.08, 0.06, '#ff2fd0', DX, 0.9, DZ + 0.68); neon.box(5.6, 0.08, 0.06, '#33f0ff', DX, 0.12, DZ + 0.68);
    for (const s of [-1, 1]) { const x = DX + s * 4.6; solid.box(1.5, 2.8, 1.2, '#101014', x, 1.4, DZ - 0.3); solid.cyl(0.5, 0.06, '#2b2b34', x, 0.95, DZ + 0.33, Math.PI / 2, 0, 0, 20); solid.cyl(0.3, 0.06, '#2b2b34', x, 2.05, DZ + 0.33, Math.PI / 2, 0, 0, 16); neon.box(1.5, 0.06, 0.06, '#33f0ff', x, 2.8, DZ + 0.33); rect(x, DZ - 0.3, 1.7, 1.4); }
    const bt = textTex([{ t: '🎧 DJ BOOTH', c: '#fff', s: 74, glow: false, y: 70 }], { w: 640, h: 130, bg: '#14102a', border: '#33f0ff' }); const bm = signMesh(3.6, 0.74, bt.t); bm.position.set(DX, 0.52, DZ + 0.67); scene.add(bm);
    // big screen above the stage: DJ name + now playing
    const scr = canvasTex(1024, 256, () => {}); const scm = signMesh(17.6, 4.4, scr.t); scm.position.set(0, 5.6, SZ + 10.62); scene.add(scm); solid.box(18.2, 5.0, 0.3, '#08080c', 0, 5.6, SZ + 10.4);
    let sig = ''; const wrap = (x, t, mw) => { let s = t; while (x.measureText(s).width > mw && s.length > 4) s = s.slice(0, -2); return s === t ? s : s + '…'; };
    const stage = { fx, setScreen(st) { // st: {on, dj:{nick}|null, track:{title,artist}|null, mic, queue:n}
      const k = JSON.stringify([st.on, st.dj && st.dj.nick, st.track && st.track.title, st.mic, st.qn]); if (k === sig) return; sig = k; const x = scr.x, w = 1024, h = 256;
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1a0830'); g.addColorStop(1, '#06223a'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.strokeStyle = st.dj ? '#ff2fd0' : '#33f0ff'; x.lineWidth = 8; x.strokeRect(6, 6, w - 12, h - 12); x.textAlign = 'center'; x.textBaseline = 'middle';
      x.shadowColor = '#ff2fd0'; x.shadowBlur = 20; x.fillStyle = '#fff'; x.font = '900 40px Arial Black, Arial, sans-serif'; x.fillText(st.dj ? '🎧 NOW DJing' : '🎧 DJ BOOTH', w / 2, 52);
      x.shadowColor = '#33f0ff'; x.font = '900 82px Arial Black, Arial, sans-serif'; x.fillStyle = st.dj ? '#33f0ff' : '#ffd166'; x.fillText(wrap(x, st.dj ? st.dj.nick : 'FREE', 900), w / 2, 130); x.shadowBlur = 0;
      x.font = '700 38px Arial, sans-serif'; x.fillStyle = '#fff'; const line = st.dj && st.track ? '♪ ' + st.track.title + ' — ' + st.track.artist : 'Step up to the decks and press F to claim them'; x.fillText(wrap(x, line, 940), w / 2, 205);
      if (st.mic) { x.fillStyle = '#ff4a4a'; x.font = '900 30px Arial'; x.textAlign = 'right'; x.fillText('🎙 LIVE', w - 28, 40); x.textAlign = 'center'; }
      if (st.qn) { x.fillStyle = '#ffd166'; x.font = '700 28px Arial'; x.textAlign = 'left'; x.fillText('Next up: ' + st.qn, 28, 40); x.textAlign = 'center'; } scr.t.needsUpdate = true; },
      update(level, bands, dt) { fx.level += (Math.min(1, level * 1.6) - fx.level) * Math.min(1, dt * 8); fx.flash = Math.max(0, fx.flash - dt * 1.6); for (let i = 0; i < 24; i++) { fx.bars[i] += ((bands ? bands[i] : 0) - fx.bars[i]) * Math.min(1, dt * 14); const hh = 0.12 + fx.bars[i] * 2.3 + fx.flash * 0.5; dummy.position.set(-21 + i * 1.82, 1.75 + hh / 2, SZ + 10.2); dummy.scale.set(1, hh, 0.5); dummy.updateMatrix(); eq.setMatrixAt(i, dummy.matrix); } eq.instanceMatrix.needsUpdate = true; eqMat.opacity = 0.55 + fx.level * 0.45; } };
    const dummy = new THREE.Object3D(); const eqMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.6 }); const eq = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 1, 1), eqMat, 24); eq.frustumCulled = false; for (let i = 0; i < 24; i++) eq.setColorAt(i, new THREE.Color().setHSL(0.88 - (i / 24) * 0.38, 1, 0.58)); scene.add(eq);
    stage.setScreen({ on: true, dj: null, track: null, mic: false, qn: 0 }); api.stage = stage; spots.push({ x: DX, z: -73, r: 5.2, id: 'dj', label: 'DJ Booth: claim the decks' }); }
  for (let r = 0; r < 4; r++) for (const s of [-1, 1]) solid.box(20, 0.7 + r * 0.5, 2.2, '#8a6a3f', s * 14, 0.35 + r * 0.25, SZ + 20 + r * 2.4); // bleachers
  // ---------- tents ----------
  const tent = (x, z, w, d, c1, c2, name) => { const hgt = 3.2, roofH = 1.8; for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid.box(0.14, hgt, 0.14, '#cfd3da', x + dx * w / 2, hgt / 2, z + dz * d / 2);
    const n = Math.round(w / 1.25); for (let i = 0; i < n; i++) { const cx = x - w / 2 + (i + 0.5) * (w / n); solid.box(w / n, 0.04, d, i % 2 ? c1 : c2, cx, hgt + 0.15, z, 0, 0, 0); soft.box(w / n, 0.6, 0.05, i % 2 ? c1 : c2, cx, hgt - 0.3, z + d / 2); }
    soft.box(w + 0.6, 0.16, d + 0.6, shade(c1, 0.8), x, hgt + 0.2, z); solid.box(w + 0.8, roofH * 0.1, d + 0.8, c1, x, hgt + 0.55, z); soft.box(w * 0.7, 0.2, d * 0.7, c2, x, hgt + 0.78, z); };
  const vend = [['#e63946', '#f4f1ea'], ['#2a9d8f', '#f4f1ea'], ['#ffd166', '#f4f1ea'], ['#9b5de5', '#f4f1ea'], ['#118ab2', '#f4f1ea']];
  const items = ['#ff6b6b', '#ffd166', '#06d6a0', '#4ea8ff', '#c77dff'];
  for (let i = 0; i < 6; i++) { const x = 90, z = -28 + i * 11, [a, b] = vend[i % 5]; tent(x, z, 7, 5, a, b); solid.box(6, 0.9, 1.2, '#8a6a3f', x, 0.45, z + 1.4); for (let k = 0; k < 6; k++) solid.box(0.6, 0.5, 0.5, pick(items), x - 2.5 + k, 1.15, z + 1.4); rect(x, z, 7.4, 5.4); }
  // swap meet (west): tables, junk piles, banners
  for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) { const x = -100 + j * 8, z = -28 + i * 9; solid.box(3.6, 0.1, 1.4, '#a8793a', x, 0.85, z); for (const s of [-1, 1]) solid.box(0.1, 0.85, 1.2, '#6d4c2a', x + s * 1.6, 0.42, z);
    for (let k = 0; k < 7; k++) { const c = pick(['#7d8590', '#b0583a', '#d9b44a', '#2a6f97', '#adb5bd', '#c1121f']); solid.box(0.25 + R() * 0.35, 0.2 + R() * 0.3, 0.25 + R() * 0.3, c, x - 1.4 + k * 0.45, 1.05, z + (R() - 0.5) * 0.4, R()); } if (R() < 0.6) { for (let k = 0; k < 4; k++) solid.cyl(0.35, 0.18, '#222', x + 2.4 + (k % 2) * 0.3, 0.2 + Math.floor(k / 2) * 0.2, z + (k % 2) * 0.1, 0, 0, 0, 10); } colliders.push({ x, z, hw: 1.9, hd: 0.9 }); }
  { const t = textTex([{ t: 'SWAP MEET', c: '#ffd166', s: 120, glow: true }], { w: 768, h: 192, bg: '#2b1b0e', border: '#ffd166' }); const m = signMesh(9, 2.25, t.t); m.position.set(-94, 4.6, 36); scene.add(m); solid.box(0.3, 4.6, 0.3, '#444', -98.5, 2.3, 36); solid.box(0.3, 4.6, 0.3, '#444', -89.5, 2.3, 36); }
  { const t = textTex([{ t: 'VENDOR ROW', c: '#33f0ff', s: 110, glow: true }], { w: 768, h: 192, bg: '#0b1a2b', border: '#33f0ff' }); const m = signMesh(9, 2.25, t.t); m.position.set(90, 4.6, 40); scene.add(m); solid.box(0.3, 4.6, 0.3, '#444', 85.5, 2.3, 40); solid.box(0.3, 4.6, 0.3, '#444', 94.5, 2.3, 40); }
  // food truck (a bus) + trailers
  { const x = 60, z = 44; const b = new Batch(); solid.box(2.3, 2.5, 6, '#ffb703', x, 1.6, z); solid.box(2.34, 0.9, 6.04, '#f4f1ea', x, 0.9, z); solid.box(0.05, 1.0, 2.6, '#222', x - 1.17, 1.9, z); solid.box(2.6, 0.1, 3, '#e63946', x - 1.55, 2.9, z); for (const dz of [-2.1, 2.1]) for (const dx of [-1, 1]) solid.cyl(0.42, 0.3, '#16171a', x + dx * 1.1, 0.42, z + dz, 0, 0, Math.PI / 2, 12);
    const t = textTex([{ t: 'TACOS & BURGERS', c: '#1a1033', s: 66, y: 90 }, { t: 'WENCH DOGS · $VWFEST', c: '#c1121f', s: 40, y: 170 }], { w: 640, h: 220, bg: '#ffe9a8', border: '#c1121f' }); const m = signMesh(4.2, 1.45, t.t); m.position.set(x - 1.2, 3.3, z); m.rotation.y = -Math.PI / 2; scene.add(m);
    for (let i = 0; i < 4; i++) { solid.box(1.2, 0.08, 1.2, '#f4f1ea', x - 5, 0.8, z - 3 + i * 2.2); solid.cyl(0.05, 0.8, '#aaa', x - 5, 0.4, z - 3 + i * 2.2, 0, 0, 0, 6); solid.box(0.9, 0.7, 0.2, '#e63946', x - 6.1, 0.35, z - 3 + i * 2.2); } rect(x, z, 2.6, 6.4); }
  // trees + hay + flags + lamp posts + string lights
  for (let i = 0; i < 70; i++) { const x = (R() - 0.5) * 2 * (HALF - 8), z = (R() - 0.5) * 2 * (HALF - 8); if ((Math.abs(x) < 98 && Math.abs(z) < 62) || Math.abs(z + 86) < 26 && Math.abs(x) < 40 || (Math.abs(x) < 40 && z > 25 && z < 70) || (z < -97 && z > -127) || (Math.abs(x + 24) < 8 && Math.abs(z - 49) < 7)) continue; const h = 3 + R() * 3;
    solid.cyl(0.25, h, '#6b4a2b', x, h / 2, z, 0, 0, 0, 6); const g = pick(['#2e7d32', '#388e3c', '#1b5e20']); soft.sph(1.6 + R(), 1.5 + R(), 1.6 + R(), g, x, h + 0.9, z, 7); soft.sph(1.2, 1.1, 1.2, shade(g, 1.15), x + 0.6, h + 1.6, z + 0.3, 6); ring(x, z, 0.6); }
  const flagC = [['#e63946', '#f4f1ea'], ['#ffd166', '#118ab2'], ['#06d6a0', '#f4f1ea'], ['#ff4fa3', '#33f0ff']];
  const flags = new Batch(); for (let i = 0; i < 28; i++) { const side = i % 2 ? 1 : -1, z = -48 + Math.floor(i / 2) * 7.4, x = side * 8.5; solid.cyl(0.07, 6, '#cfd3da', x, 3, z, 0, 0, 0, 6); const [c1, c2] = flagC[i % 4]; flags.box(0.04, 1.0, 1.6, c1, x, 5.3, z + 0.9); flags.box(0.04, 0.5, 1.6, c2, x, 5.55, z + 0.9); }
  for (let i = 0; i < 10; i++) { const x = -45 + i * 10; solid.cyl(0.1, 5, '#cfd3da', x, 2.5, 60, 0, 0, 0, 6); const c = flagC[i % 4]; flags.box(0.04, 1.2, 2, c[0], x, 4.2, 61); flags.box(0.04, 0.6, 2, c[1], x, 4.5, 61); }
  const flagMesh = new THREE.Mesh(flags.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); scene.add(flagMesh); anim.push((t) => { flagMesh.rotation.y = Math.sin(t * 1.4) * 0.02; });
  // lamp posts + string lights over entrance plaza and burn plaza
  for (let z = -40; z <= 45; z += 17) for (const s of [-1, 1]) { solid.cyl(0.08, 5.5, '#2b2d33', s * 14, 2.75, z, 0, 0, 0, 6); neon.sph(0.22, 0.22, 0.22, '#fff1b8', s * 14, 5.7, z, 6); }
  const strings = [[-14, 16, 14, 16], [-14, 24, 14, 24], [-30, 54, 30, 54], [-30, 46, 30, 46], [-46, 22, 46, 22]];
  for (const [x1, z1, x2, z2] of strings) { const n = 20; for (let i = 0; i <= n; i++) { const k = i / n, x = x1 + (x2 - x1) * k, z = z1 + (z2 - z1) * k, y = 5.6 - Math.sin(k * Math.PI) * -0.6 - 0.9 * Math.sin(k * Math.PI) * 0 - (k * (1 - k)) * 3.2; neon.sph(0.11, 0.11, 0.11, ['#ffd166', '#ff6b9d', '#33f0ff', '#9bff8a'][i % 4], x, y, z, 5); soft.box(0.9, 0.02, 0.02, '#222', x, y + 0.08, z); } for (const [x, z] of [[x1, z1], [x2, z2]]) solid.cyl(0.08, 5.8, '#2b2d33', x, 2.9, z, 0, 0, 0, 6); }
  // ---------- entrance gate ----------
  for (const s of [-1, 1]) solid.box(1.2, 8, 1.2, '#8a6a3f', s * 14, 4, 62); solid.box(30, 1.2, 1.2, '#8a6a3f', 0, 8, 62); rect(-14, 62, 1.6, 1.6); rect(14, 62, 1.6, 1.6);
  { const t = textTex([{ t: 'WELCOME TO', c: '#ffd166', s: 40, y: 50 }, { t: 'VW FEST', c: '#ff2fd0', s: 100, glow: true, y: 130 }], { w: 640, h: 200, bg: '#0b0716', border: '#ffd166' }); const m = signMesh(14, 4.4, t.t); m.position.set(0, 10.1, 62.1); scene.add(m); const m2 = signMesh(14, 4.4, t.t); m2.position.set(0, 10.1, 61.9); m2.rotation.y = Math.PI; scene.add(m2); }
  // ---------- arcade booths ----------
  GAMES.forEach((g, i) => { const x = -27.5 + i * 11, z = 52; const bx = new Batch();
    solid.box(4.2, 0.4, 3, '#2b2230', x, 0.2, z); solid.box(3.4, 3.2, 1.8, '#1b1430', x, 2.0, z - 0.2); solid.box(3.6, 0.3, 2.2, g.color, x, 3.75, z - 0.1); for (const s of [-1, 1]) solid.box(0.18, 3.2, 1.9, g.color, s * 1.75 + x, 2.0, z - 0.2);
    const t = textTex([{ t: g.icon, s: 120, y: 90 }, { t: g.name, c: '#fff', s: 54, y: 190 }, { t: 'PRESS F · PLAY ↗', c: g.color, s: 38, y: 245 }], { w: 512, h: 300, bg: '#120a26', border: g.color }); const sc = signMesh(3.0, 1.75, t.t); sc.position.set(x, 2.2, z - 1.0 + 0.72 - 0.02 + 0.0 + 0.0); sc.position.z = z + 0.78; scene.add(sc); { const sb = signMesh(3.0, 1.75, t.t); sb.position.set(x, 2.2, z - 1.18); sb.rotation.y = Math.PI; scene.add(sb); } // players walk in from the plaza side: give the back the same screen
    neon.box(3.6, 0.1, 0.1, g.color, x, 0.55, z + 0.78); rect(x, z, 4.2, 3); spots.push({ x, z: z + 3.4, r: 4.4, id: 'game:' + g.id, label: `Play ${g.name} ↗`, game: g }); spots.push({ x, z: z - 3.4, r: 3.4, id: 'game:' + g.id, label: `Play ${g.name} ↗`, game: g }); });
  { const t = textTex([{ t: 'ARCADE ROOM', c: '#33f0ff', s: 110, glow: true }], { w: 768, h: 190, bg: '#0b0716', border: '#33f0ff' }); const m = signMesh(11, 2.7, t.t); m.position.set(0, 6.6, 50.3); scene.add(m); }
  // ---------- burn plaza ----------
  { const x = 0, z = 22; solid.cyl(1.1, 1.5, '#7a2e12', x, 0.75, z, 0, 0, 0, 14); solid.cyl(1.16, 0.12, '#2b2b2b', x, 1.52, z, 0, 0, 0, 14); solid.cyl(1.17, 0.1, '#444', x, 0.5, z, 0, 0, 0, 14); solid.cyl(1.17, 0.1, '#444', x, 1.0, z, 0, 0, 0, 14); ring(x, z, 1.6);
    const fl = new Batch(); for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28; fl.cone(0.35, 1.2 + (i % 3) * 0.3, i % 2 ? '#ff7a1a' : '#ffd23f', x + Math.cos(a) * 0.5, 2.2, z + Math.sin(a) * 0.5, 0, 0, 0, 5); } fl.cone(0.5, 1.9, '#ff3d00', x, 2.4, z, 0, 0, 0, 6);
    const fm = new THREE.Mesh(fl.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false })); scene.add(fm); anim.push((t) => { fm.scale.set(1 + Math.sin(t * 9) * 0.06, 1 + Math.sin(t * 13 + 1) * 0.12, 1 + Math.sin(t * 11) * 0.06); fm.rotation.y = t * 0.8; });
    const fire = new THREE.PointLight(0xff7a1a, 2.2, 22, 2); fire.position.set(x, 3, z); scene.add(fire); anim.push((t) => { fire.intensity = 2 + Math.sin(t * 17) * 0.4 + Math.sin(t * 7) * 0.3; });
    for (const s of [-1, 1]) solid.cyl(0.14, 8, '#2b2d33', x + s * 5.2, 4, z - 1.5, 0, 0, 0, 6); solid.box(11.2, 0.3, 0.3, '#2b2d33', x, 8, z - 1.5);
    const bt = canvasTex(1024, 512, () => {}); api.burnTex = bt; api.drawBurn = (sum) => { const x2 = bt.x, w = 1024, h = 512; x2.fillStyle = '#12080a'; x2.fillRect(0, 0, w, h); const g = x2.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#ff3d00'); g.addColorStop(1, '#ffd23f'); x2.strokeStyle = g; x2.lineWidth = 14; x2.strokeRect(10, 10, w - 20, h - 20);
      x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.fillStyle = '#ffd23f'; x2.font = '900 54px Arial Black, Arial'; x2.fillText('🔥 $VWFEST BURN TRACKER 🔥', w / 2, 62);
      const tot = sum ? sum.totalBurned : 0; x2.fillStyle = '#fff'; x2.font = '900 120px Arial Black, Arial'; x2.fillText(tot.toLocaleString('en-US', { maximumFractionDigits: 0 }), w / 2, 190); x2.fillStyle = '#ff7a1a'; x2.font = '700 40px Arial'; x2.fillText('$VWFEST BURNED FOREVER', w / 2, 262);
      x2.fillStyle = '#cfd8e6'; x2.font = '600 34px Arial'; x2.fillText(sum ? `${sum.count} burns · avatars, rides & outfits` : 'loading…', w / 2, 330); const last = sum && sum.recent && sum.recent[0]; x2.fillStyle = '#9fb0c8'; x2.font = '500 30px Arial'; x2.fillText(last ? `latest: ${last.nick} burned ${last.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : (sum && sum.mintOpen === false ? 'Purchases open soon: every one burns $VWFEST' : 'be the first to burn'), w / 2, 400); x2.fillStyle = '#ffd23f'; x2.font = '600 28px Arial'; x2.fillText('PRESS F AT THE BARREL FOR THE FULL LEDGER', w / 2, 462); bt.t.needsUpdate = true; };
    api.drawBurn(null); const bm = signMesh(11, 5.5, bt.t); bm.position.set(x, 11.2, z - 1.5 + 0.2); scene.add(bm); const bm2 = signMesh(11, 5.5, bt.t); bm2.position.set(x, 11.2, z - 1.5 - 0.2); bm2.rotation.y = Math.PI; scene.add(bm2); solid.box(11.2, 5.7, 0.3, '#12080a', x, 11.2, z - 1.5);
    spots.push({ x, z, r: 4.5, id: 'burn', label: 'Burn Tracker (full ledger)' }); }
  // ---------- outfit shop tent ----------
  { const x = -42, z = 22; tent(x, z, 11, 8, '#ff4fa3', '#f4f1ea'); for (let i = 0; i < 4; i++) { solid.box(0.12, 1.6, 0.12, '#cfd3da', x - 4 + i * 2.7, 0.8, z - 2.5); solid.box(2, 0.05, 0.5, '#cfd3da', x - 4 + i * 2.7, 1.6, z - 2.5); for (let k = 0; k < 3; k++) soft.box(0.5, 0.9, 0.18, pick(['#e63946', '#ffd166', '#06d6a0', '#4ea8ff', '#c77dff']), x - 4.6 + i * 2.7 + k * 0.6, 1.1, z - 2.5); }
    solid.box(4, 1.0, 1.4, '#3c2f4a', x, 0.5, z + 2.6); solid.box(4.2, 0.1, 1.5, '#ff4fa3', x, 1.05, z + 2.6);
    const t = textTex([{ t: '👕 OUTFIT SHOP', c: '#fff', s: 78, glow: false, y: 80 }, { t: 'hats · shades · wings · auras', c: '#ffd166', s: 34, y: 150 }], { w: 640, h: 190, bg: '#2a0e22', border: '#ff4fa3' }); const m = signMesh(7, 2.1, t.t); m.position.set(x, 5.6, z + 4.2); scene.add(m); rect(x, z - 1, 11.6, 6); spots.push({ x, z: z + 6, r: 4.6, id: 'shop', label: 'Open the Outfit Shop' }); }
  // ---------- showroom tent ----------
  const showroom = new THREE.Group(); scene.add(showroom);
  { const x = 42, z = 22; tent(x, z, 14, 10, '#2b2d42', '#ffd166'); solid.box(14.6, 0.2, 10.6, '#d8dde6', x, 0.1, z); rect(x, z - 4.6, 14.4, 0.8);
    const t = textTex([{ t: '🚗 SHOWROOM', c: '#ffd166', s: 84, y: 80 }, { t: 'VW FEST SHOW GROUNDS RIDES', c: '#fff', s: 34, y: 150 }], { w: 640, h: 190, bg: '#14141f', border: '#ffd166' }); const m = signMesh(7.6, 2.25, t.t); m.position.set(x, 5.8, z + 5.4); scene.add(m);
    spots.push({ x, z: z + 7, r: 5, id: 'showroom', label: 'Showroom: open your garage / mint a ride' });
    api.showroomPos = [[x - 4.5, z - 1.2], [x, z - 1.2], [x + 4.5, z - 1.2], [x - 4.5, z + 2.2], [x, z + 2.2], [x + 4.5, z + 2.2]]; api.showroomPos.forEach(([px, pz]) => { solid.cyl(1.5, 0.3, '#2b2230', px, 0.35, pz, 0, 0, 0, 16); solid.cyl(1.4, 0.05, '#ffd166', px, 0.53, pz, 0, 0, 0, 16); }); }
  // ---------- bandstand speakers, hay bales, misc ----------
  for (let i = 0; i < 16; i++) { const x = -70 + R() * 140, z = 66 + R() * 40; solid.cyl(0.55, 0.9, '#d9b44a', x, 0.45, z, 0, 0, Math.PI / 2 * 0, 10); ring(x, z, 0.6); }
  // commit batches
  const roadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); const roadMesh = new THREE.Mesh(mergeGeometries(roadGeos), roadMat); roadMesh.receiveShadow = true; scene.add(roadMesh);
  const sg = solid.build(); const sm = new THREE.Mesh(sg, MAT.lambert); sm.castShadow = sm.receiveShadow = true; scene.add(sm);
  const sf = soft.build(); if (sf) { const m = new THREE.Mesh(sf, MAT.lambert); m.castShadow = m.receiveShadow = true; scene.add(m); } const ng = neon.build(); if (ng) scene.add(new THREE.Mesh(ng, MAT.neon));
  // ---------- showroom API ----------
  const cars = [];
  api.setShowroom = (list) => { for (const c of cars) showroom.remove(c.obj); cars.length = 0; const use = list && list.length ? list : PREVIEW; use.slice(0, 6).forEach((r, i) => { const obj = carFor(rideSpec(r.spec)); const [px, pz] = api.showroomPos[i]; obj.position.set(px, 0.55, pz); obj.scale.setScalar(0.8); showroom.add(obj); cars.push({ obj, r, base: i * 1.7 }); }); api.showroomPreview = !(list && list.length); };
  const PREVIEW = [0, 1, 2, 3, 4].map((tier) => { const bytes = new Uint8Array(64).fill(17 + tier * 29); bytes[0] = [0, 150, 205, 236, 254][tier]; const s = RIDES.roll(bytes); return { spec: s }; });
  api.updateShowroom = (t, px, pz) => { cars.forEach((c, i) => { c.obj.rotation.y = t * 0.4 + c.base; const near = (c.obj.position.x - px) ** 2 + (c.obj.position.z - pz) ** 2 < 120; if (c.obj.userData.hydro) hydraulics(c.obj, t + c.base, ['hop', 'three', 'dip'][Math.floor((t / 5 + i) % 3)], near || true); }); };
  api.setShowroom(null);
  api.extras = buildExtras(scene, api, opts);
  // ---------- graphics hooks (driven by gfx.js) ----------
  let grass = null, pbr = null; const grassMat = () => grass && grass.mat;
  api.materials = () => [...Object.values(MAT).filter((m) => m && m.isMaterial && !m.isMeshBasicMaterial && !m.isShaderMaterial), ground.material, roadMat, ...(grass ? [grass.mat] : [])];
  api.setGrass = (n) => { if (!grass) { if (!n) return; const mask = buildMask(scene, HALF, (o) => o === ground || o.name === 'sky'); grass = new Grass(scene, mask, HALF); } grass.setCount(n); };
  api.updateGrass = (x, z, t) => { if (grass) { grass.update(x, z); grass.tick(t); } };
  api.setShadowCasting = (on) => { scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.userData.shadowKind) o.castShadow = on; }); };
  api.setPbrTextures = (t) => {
    pbr = t; const g = ground.material, r = roadMat;
    if (t) { for (const k of ['map', 'normalMap', 'roughnessMap']) { g[k] = t.grass[k]; t.grass[k].repeat.set(HALF * 2 / 3.2 + 25, HALF * 2 / 3.2 + 25); r[k] = t.asphalt[k]; t.asphalt[k].repeat.set(1, 1); } g.normalScale.set(0.9, 0.9); r.normalScale.set(0.8, 0.8); g.roughness = 1; r.roughness = 1; g.color.set(0xbfd0a8); }
    else { g.map = gtex.t; g.normalMap = g.roughnessMap = null; r.map = r.normalMap = r.roughnessMap = null; g.roughness = 0.95; r.roughness = 0.92; g.color.set(0xffffff); }
    g.needsUpdate = r.needsUpdate = true;
  };
  return api;
}

// ---------- sky + lighting cycle ----------
const KEYS = [ // phase 0..1 over the cycle
  { p: 0.0, top: '#4aa3ff', hor: '#bfe3ff', sun: 1.15, hemi: 0.85, sunCol: '#fff4d6', amb: '#9fc6ff', fog: '#bfe3ff', stars: 0 },
  { p: 0.38, top: '#3f8fe8', hor: '#a9d6ff', sun: 1.1, hemi: 0.85, sunCol: '#ffe6b0', amb: '#9fc6ff', fog: '#a9d6ff', stars: 0 },
  { p: 0.52, top: '#6f4bb5', hor: '#ff8a3d', sun: 0.8, hemi: 0.6, sunCol: '#ff9a4a', amb: '#c78bff', fog: '#e8864a', stars: 0.1 },
  { p: 0.62, top: '#23194d', hor: '#e0556a', sun: 0.35, hemi: 0.42, sunCol: '#ff6a5a', amb: '#7a6ad0', fog: '#5b2f5f', stars: 0.5 },
  { p: 0.72, top: '#0a0720', hor: '#2a1650', sun: 0.1, hemi: 0.36, sunCol: '#7f8cff', amb: '#5a5aa8', fog: '#1a1033', stars: 1 },
  { p: 0.9, top: '#0a0720', hor: '#2a1650', sun: 0.1, hemi: 0.36, sunCol: '#7f8cff', amb: '#5a5aa8', fog: '#1a1033', stars: 1 },
  { p: 0.97, top: '#37508f', hor: '#ffb27a', sun: 0.7, hemi: 0.6, sunCol: '#ffc58a', amb: '#b0c4ff', fog: '#ffb27a', stars: 0.2 },
  { p: 1.0, top: '#4aa3ff', hor: '#bfe3ff', sun: 1.15, hemi: 0.85, sunCol: '#fff4d6', amb: '#9fc6ff', fog: '#bfe3ff', stars: 0 },
];
export function buildSky(scene, renderer) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 12), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vD; void main(){ float h=clamp(vD.y,0.,1.); vec3 c=mix(hor,top,pow(h,0.55)); float s=max(dot(vD,normalize(sunDir)),0.); c+=sunCol*(pow(s,600.)*3.+pow(s,12.)*0.35); gl_FragColor=vec4(c,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}' }));
  sky.renderOrder = -10; sky.name = 'sky'; scene.add(sky);
  const sp = new Float32Array(600 * 3); for (let i = 0; i < 600; i++) { const a = R() * 6.28, e = Math.acos(R() * 0.95) ; sp[i * 3] = Math.sin(e) * Math.cos(a) * 400; sp[i * 3 + 1] = Math.cos(e) * 400; sp[i * 3 + 2] = Math.sin(e) * Math.sin(a) * 400; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false })); scene.add(stars);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x5d7a3a, 0.8); scene.add(hemi); const sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(sun); scene.add(sun.target);
  scene.fog = new THREE.Fog(0xbfe3ff, 60, 260); const c1 = new THREE.Color(), c2 = new THREE.Color();
  const state = { sun: 1, sunset: 0 }, sunDir = new THREE.Vector3(0, 1, 0);
  const lerpCol = (a, b, t, out) => out.set(a).lerp(c2.set(b), t);
  function update(phase) {
    let i = 0; while (i < KEYS.length - 2 && phase > KEYS[i + 1].p) i++; const a = KEYS[i], b = KEYS[i + 1], t = Math.min(1, Math.max(0, (phase - a.p) / (b.p - a.p || 1)));
    sky.material.uniforms.top.value.set(a.top).lerp(c1.set(b.top), t); sky.material.uniforms.hor.value.set(a.hor).lerp(c1.set(b.hor), t); sky.material.uniforms.sunCol.value.set(a.sunCol).lerp(c1.set(b.sunCol), t);
    sun.color.set(a.sunCol).lerp(c1.set(b.sunCol), t); sun.intensity = a.sun + (b.sun - a.sun) * t; hemi.intensity = (a.hemi + (b.hemi - a.hemi) * t) * 1.25; hemi.color.set(a.amb).lerp(c1.set(b.amb), t); scene.fog.color.set(a.fog).lerp(c1.set(b.fog), t); stars.material.opacity = a.stars + (b.stars - a.stars) * t;
    const ang = Math.min(Math.max((phase - 0.05) / 0.6, 0), 1) * Math.PI; const dir = new THREE.Vector3(-Math.cos(ang), Math.sin(ang) * 0.9 + 0.08, 0.35).normalize(); sky.material.uniforms.sunDir.value.copy(dir); sun.position.copy(dir).multiplyScalar(100); renderer.setClearColor(scene.fog.color);
    sunDir.copy(dir); state.sun = sun.intensity; { const sa = (phase - 0.55) / 0.13, sb = (phase - 0.975) / 0.04; state.sunset = Math.max(0, 1 - Math.abs(sa), 1 - Math.abs(sb)); }
  }
  return { update, sky, stars, sun, hemi, sunDir, state };
}
export { PLATE_UNI };
