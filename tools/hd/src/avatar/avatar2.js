// v2 avatar: one continuous skinned body (SDF sculpt -> surface nets -> simplify -> region cuts for clothing),
// bone rig, sculpted head, layered hair strips, procedural skin shader. 100% code-built. No imported models.
import * as THREE from 'three';
import { foldNormal, strandNormal, shirtMap, canvasTex, PAL } from './avatar.js';
import { sculpt, makeSDF, surfaceNets, simplify, grad, sstep, clamp } from './body.js';
import { skinMaterial } from './skin.js';
import { shellMesh } from './shells.js';
import { buildShoe } from './shoe.js';
const C = (k, i) => new THREE.Color('#' + PAL[k][i]);
const g2 = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const PARENT = { spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', upperArmL: 'chest', foreArmL: 'upperArmL', handL: 'foreArmL', upperArmR: 'chest', foreArmR: 'upperArmR', handR: 'foreArmR', thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR' };
const GROUP = (b) => (/Arm|hand/.test(b) ? 'arm' : /thigh|shin|foot/.test(b) ? 'leg' : b === 'neck' || b === 'head' ? 'neck' : 'torso');
const SURF_CACHE = new Map();

// ---------- textures ----------
const strandTex = (seed = 1, rootFill = true, n = 70, bg = false) => canvasTex(256, 512, (x, w, h) => { x.clearRect(0, 0, w, h); if (bg) { x.fillStyle = 'rgb(200,200,200)'; x.fillRect(0, 0, w, h); } let r = seed * 9301; n = Math.round(n * 3.2);
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) { const cx = w * (0.06 + 0.88 * rnd()), len = h * (0.6 + 0.4 * rnd()), wd = 0.9 + rnd() * 1.3, l = Math.round(150 + rnd() * 105);
    const gr = x.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, `rgba(${l},${l},${l},1)`); gr.addColorStop(0.85, `rgba(${l},${l},${l},0.9)`); gr.addColorStop(1, `rgba(${l},${l},${l},0)`);
    x.strokeStyle = gr; x.lineWidth = wd; x.beginPath(); x.moveTo(cx, 0); x.bezierCurveTo(cx + (rnd() - 0.5) * 20, len * 0.3, cx + (rnd() - 0.5) * 30, len * 0.7, cx + (rnd() - 0.5) * 40, len); x.stroke(); }
  // keep the strip root dense
  return; const g = x.createLinearGradient(0, 0, 0, h * 0.25); g.addColorStop(0, 'rgba(120,120,120,0.9)'); g.addColorStop(1, 'rgba(120,120,120,0)'); x.fillStyle = g; x.globalCompositeOperation = 'destination-over'; x.fillRect(w * 0.08, 0, w * 0.84, h * 0.25); x.globalCompositeOperation = 'source-over'; });
const lashTex = () => canvasTex(128, 32, (x, w, h) => { x.clearRect(0, 0, w, h); x.strokeStyle = '#000'; for (let i = 0; i < 44; i++) { const u = 4 + i * (w - 8) / 43; x.lineWidth = 1.4; x.beginPath(); x.moveTo(u, 0); x.quadraticCurveTo(u + 2, h * 0.5, u + (u - w / 2) * 0.12 + 3, h); x.stroke(); } });
const irisTex = (col) => canvasTex(128, 128, (x, w) => { const c = w / 2; const g = x.createRadialGradient(c, c, 8, c, c, c); g.addColorStop(0, '#' + col.clone().multiplyScalar(0.5).getHexString()); g.addColorStop(0.55, '#' + col.getHexString()); g.addColorStop(0.92, '#' + col.clone().multiplyScalar(0.45).getHexString()); g.addColorStop(1, '#111'); x.fillStyle = g; x.fillRect(0, 0, w, w);
  for (let i = 0; i < 160; i++) { const a = (i / 160) * 6.283; x.strokeStyle = `rgba(255,255,255,${0.05 + 0.12 * Math.random()})`; x.lineWidth = 1; x.beginPath(); x.moveTo(c + Math.cos(a) * 16, c + Math.sin(a) * 16); x.lineTo(c + Math.cos(a) * 58, c + Math.sin(a) * 58); x.stroke(); }
  x.fillStyle = '#050505'; x.beginPath(); x.arc(c, c, 17, 0, 6.283); x.fill(); x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(c - 14, c - 16, 6, 0, 6.283); x.fill(); });
const iconTex = (kind) => canvasTex(128, 128, (x, w) => { x.clearRect(0, 0, w, w); const c = w / 2; x.strokeStyle = x.fillStyle = kind === 2 ? '#b8323f' : '#1f3f6a'; x.lineWidth = 7; x.lineCap = 'round';
  if (kind === 1) { x.beginPath(); x.moveTo(c, 18); x.lineTo(c, 104); x.moveTo(c - 26, 38); x.lineTo(c + 26, 38); x.stroke(); x.beginPath(); x.arc(c, 74, 32, 0.2, Math.PI - 0.2); x.stroke(); x.beginPath(); x.arc(c, 16, 9, 0, 6.283); x.stroke(); }
  else if (kind === 2) { x.beginPath(); x.moveTo(c, 112); x.bezierCurveTo(20, 100, 24, 60, 50, 30); x.bezierCurveTo(48, 58, 64, 60, 66, 14); x.bezierCurveTo(92, 44, 108, 90, c, 112); x.fill(); }
  else if (kind === 3) { x.beginPath(); x.ellipse(c, 70, 48, 30, 0, Math.PI, 0); x.lineTo(c + 54, 84); x.lineTo(c - 54, 84); x.closePath(); x.fill(); x.fillStyle = '#fff'; for (const s of [-1, 1]) { x.beginPath(); x.arc(c + s * 28, 86, 11, 0, 6.283); x.fill(); } }
  else { x.beginPath(); x.arc(c, c, 44, 0, 6.283); x.moveTo(c, c - 44); x.lineTo(c, c + 44); x.moveTo(c, c); x.lineTo(c - 31, c + 31); x.moveTo(c, c); x.lineTo(c + 31, c + 31); x.stroke(); } });

// ---------- head sculpt (unit direction -> surface point, head-local, metres) ----------
function headFn(fem) {
  return (x, y, z) => { const fr = Math.max(0, z), ax = Math.abs(x); let sx = 0.755, sy = 1.1, sz = 1.0;
    if (y < 0) { sx *= 1 - 0.28 * Math.pow(-y, 1.6) * (fem ? 1.15 : 0.72); sz *= 1 - 0.12 * Math.pow(-y, 2); }
    let r = 1;
    if (!fem) r += 0.055 * g2(ax - 0.58, 0.15) * g2(y + 0.62, 0.11) * (z > -0.3 ? 1 : 0); // jaw angle
    r -= 0.035 * fr * g2(ax - 0.5, 0.1) * g2(y + 0.4, 0.1); // cheek hollow
    r -= 0.05 * fr * g2(ax - 0.28, 0.08) * g2(y - 0.165, 0.03); r += 0.018 * fr * g2(ax - 0.29, 0.08) * g2(y - 0.115, 0.022); // upper-lid crease + fold
    r += 0.045 * fr * g2(x, 0.04) * g2(y + 0.215, 0.045) - 0.012 * fr * g2(ax - 0.06, 0.02) * g2(y + 0.265, 0.015); // nose tip + nostril underside
    r -= 0.02 * fr * g2(ax - 0.23, 0.028) * g2(y + 0.465, 0.028); // mouth corners
    r -= 0.014 * fr * g2(ax - (0.13 + (-0.25 - y) * 0.45), 0.028) * g2(y + 0.37, 0.09); // nasolabial folds
    r -= 0.006 * fr * g2(x, 0.022) * g2(y + 0.36, 0.035); r += 0.004 * fr * g2(ax - 0.04, 0.015) * g2(y + 0.36, 0.035); // philtrum
    r += 0.15 * fr * g2(x, 0.055) * g2(y + 0.11, 0.14) * (y < -0.27 ? 0.35 : 1); // nose
    r += 0.03 * fr * g2(y - 0.2, 0.07) * g2(x, 0.45); // brow ridge
    r += 0.045 * fr * g2(x, 0.05) * g2(y - 0.03, 0.09); // nose bridge
    r -= 0.085 * fr * g2(Math.abs(x) - 0.31, 0.1) * g2(y - 0.07, 0.085); // eye sockets
    r += 0.035 * fr * g2(Math.abs(x) - 0.105, 0.045) * g2(y + 0.255, 0.045); // nose wings
    r += 0.05 * fr * g2(Math.abs(x) - 0.47, 0.14) * g2(y + 0.15, 0.09); // cheekbones
    r += 0.075 * fr * g2(x, 0.16) * g2(y + 0.425, 0.024) + 0.008 * fr * g2(ax - 0.045, 0.02) * g2(y + 0.395, 0.015) - 0.034 * fr * g2(x, 0.24) * g2(y + 0.47, 0.012); // upper lip, mouth line
    r += 0.075 * fr * g2(x, 0.14) * g2(y + 0.5, 0.03) - 0.015 * fr * g2(x, 0.2) * g2(y + 0.585, 0.025); // lower lip + mentolabial groove
    r += 0.04 * fr * g2(x, 0.2) * g2(y + 0.75, 0.1); // chin
    r += 0.06 * Math.max(0, -z) * g2(y - 0.25, 0.4); // occiput
    return new THREE.Vector3(x * 0.115 * sx * r, y * 0.115 * sy * r, z * 0.115 * sz * r); };
}
const hairline = (u) => 0.12 + 0.28 * Math.pow(Math.max(u.z, 0), 1.2) - 0.55 * Math.max(-u.z, 0);

// ribbon (flat strip lying on a surface): pts, normals, widths -> geometry arrays
function ribbon(acc, pts, nrm, wid) {
  const base = acc.pos.length / 3, n = pts.length;
  for (let k = 0; k < n; k++) { const d = (k < n - 1 ? pts[k + 1].clone().sub(pts[k]) : pts[k].clone().sub(pts[k - 1])).normalize(); const side = new THREE.Vector3().crossVectors(d, nrm[k]).normalize().multiplyScalar(wid[k] / 2);
    for (const s of [-1, 1]) { const p = pts[k].clone().addScaledVector(side, s); acc.pos.push(p.x, p.y, p.z); acc.nor.push(nrm[k].x, nrm[k].y, nrm[k].z); acc.uv.push(s < 0 ? 0 : 1, 1 - k / (n - 1)); } }
  for (let k = 0; k < n - 1; k++) { const a = base + k * 2; acc.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
}
const accGeo = (acc) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2)); g.setIndex(acc.idx); return g; };

// Budget guard: in-game (lod 1) <= 15k tris, far (lod 2) < 3k. If an outfit/hair combo goes over, re-simplify the body.
export async function buildAvatar(av, opts = {}) { const cap = [Infinity, 15000, 2950][opts.lod || 0]; let r = await buildOnce(av, opts);
  for (let i = 0; i < 3 && r.userData.tris > cap; i++) { const u = r.userData, other = u.tris - u.bodyTris, overhead = u.bodyTris - u.bodyTarget; const target = Math.max(300, Math.floor(cap - other - overhead * 1.05 - 100)); r = await buildOnce(av, opts, target); }
  return r; }
async function buildOnce(av, { lod = 0, eq = {} } = {}, bodyOverride = 0) {
  const LOD = [{ body: 30000, head: [72, 54], strips: 1, seg: 7 }, { body: 4800, head: [40, 30], strips: 0.62, seg: 4 }, { body: 1000, head: [16, 11], strips: 0.08, seg: 2 }][lod];
  const fem = av.sex === 1, outfit = av.outfit, overalls = outfit === 1, jacket = outfit === 3, vest = outfit === 4, hawaii = outfit === 2;
  const skinC = C('skin', av.skin), hairC = av.age === 3 && av.hair < 7 ? C('hair', av.hair).lerp(new THREE.Color('#d9d9d9'), 0.55) : C('hair', av.hair);
  const shirtC = C('shirt', av.shirt), pantsC = C('pants', av.pants), eyeC = C('eyes', av.eyes), denim = new THREE.Color('#2f5d9a');
  // ----- body surface (cached per body shape) -----
  const S = sculpt(av), sdf = makeSDF(S.prims), B = S.bones;
  const key = [av.sex, av.body].join();
  let raw = SURF_CACHE.get(key); if (!raw) { raw = surfaceNets(sdf, [-0.31, -0.004, -0.175], [0.31, 1.66, 0.2], 0.0026); SURF_CACHE.set(key, raw); }
  const sm = await simplify(raw.P, raw.I, bodyOverride || LOD.body);
  // ----- per-vertex data -----
  const NB = BONES.length, bi = Object.fromEntries(BONES.map((b, i) => [b, i]));
  const sideOf = (b) => (b.endsWith('L') ? 1 : b.endsWith('R') ? -1 : 0);
  const weightsAt = (x, y, z) => { const w = new Float32Array(NB); let dmin = 1e9; const ds = S.prims.map((p) => { const d = p.f(x, y, z); dmin = Math.min(dmin, d); return d; });
    S.prims.forEach((p, i) => { const s = sideOf(p.bone); const side = s ? sstep(-0.012, 0.012, x * s) : 1; w[bi[p.bone]] = Math.max(w[bi[p.bone]], Math.exp(-(ds[i] - dmin) / 0.011) * side); }); return w; };
  const armT = (s, p) => { const sd = s > 0 ? 'L' : 'R'; const Sh = new THREE.Vector3(...B['upperArm' + sd]), El = new THREE.Vector3(...B['foreArm' + sd]), Wr = new THREE.Vector3(...B['hand' + sd]);
    const l1 = El.distanceTo(Sh), l2 = Wr.distanceTo(El); const t1 = p.clone().sub(Sh).dot(El.clone().sub(Sh).normalize()); if (t1 < l1) return t1; return l1 + p.clone().sub(El).dot(Wr.clone().sub(El).normalize()); };
  const sleeveL = jacket ? 0.53 : hawaii ? 0.17 : 0.155, waistY = 0.985;
  const FIELDS = ['neck', 'waist', 'sleeve', 'hem']; if (overalls) FIELDS.push('front', 'bibx', 'biby', 'strap'); if (jacket || vest) FIELDS.push('front', 'plk'); if (jacket) FIELDS.push('waistJ');
  const fieldVals = (p, g, t) => { const x = p.x, y = p.y, z = p.z, tor = g === 'torso' || g === 'neck';
    const radial = Math.hypot(x, z + 0.012), rN = 0.074 + (hawaii || jacket ? 0.045 : 0.03) * sstep(0.0, 0.07, z) + 0.004 * sstep(0, -0.05, z);
    const o = { neck: g === 'arm' || g === 'leg' ? -1 : (y - 1.415) + 0.9 * (0.061 - radial) + 0.04 * sstep(0.0, 0.07, z) * Math.max(0, 1 - (x / 0.085) ** 2), waist: y - waistY, sleeve: g === 'arm' ? t - sleeveL : -1, hem: g === 'leg' ? y - 0.097 : 1,
      front: tor ? z - 0.01 : -1, bibx: tor ? Math.abs(x) - 0.105 * S.bw : 1, biby: tor ? y - 1.3 : 1, strap: tor ? Math.abs(Math.abs(x) - 0.078 * S.bw) - 0.02 : 1, plk: tor ? Math.abs(x) - (vest ? 0.07 : 0.03) : 1, waistJ: y - 0.9 };
    return FIELDS.map((f) => o[f]); };
  let V = []; const nv = sm.P.length / 3;
  for (let i = 0; i < nv; i++) { const p = new THREE.Vector3(sm.P[i * 3], sm.P[i * 3 + 1], sm.P[i * 3 + 2]); const w = weightsAt(p.x, p.y, p.z); let mb = 0; for (let b = 1; b < NB; b++) if (w[b] > w[mb]) mb = b;
    const g = GROUP(BONES[mb]); const t = g === 'arm' ? armT(p.x > 0 ? 1 : -1, p) : 0; V.push({ p, w, g, f: fieldVals(p, g, t), n: new THREE.Vector3(...grad(sdf, p.x, p.y, p.z)) }); }
  let T = []; for (let i = 0; i < sm.I.length; i += 3) T.push([sm.I[i], sm.I[i + 1], sm.I[i + 2]]);
  // ----- exact clothing boundary cuts (split triangles along each field's zero line) -----
  for (let fi = 0; fi < FIELDS.length; fi++) { const cache = new Map(), NT = [];
    const mid = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; let r = cache.get(k); if (r !== undefined) return r; const A = V[a], Bv = V[b], t = A.f[fi] / (A.f[fi] - Bv.f[fi]);
      const w = new Float32Array(NB); for (let j = 0; j < NB; j++) w[j] = A.w[j] + (Bv.w[j] - A.w[j]) * t;
      const f = A.f.map((v, j) => v + (Bv.f[j] - v) * t); f[fi] = 0;
      V.push({ p: A.p.clone().lerp(Bv.p, t), w, g: t < 0.5 ? A.g : Bv.g, f, n: A.n.clone().lerp(Bv.n, t).normalize() }); r = V.length - 1; cache.set(k, r); return r; };
    for (const tr of T) { const s = tr.map((v) => V[v].f[fi] >= 0); if (s[0] === s[1] && s[1] === s[2]) { NT.push(tr); continue; }
      let k = s[0] !== s[1] && s[0] !== s[2] ? 0 : s[1] !== s[0] && s[1] !== s[2] ? 1 : 2; const a = tr[k], b = tr[(k + 1) % 3], c = tr[(k + 2) % 3];
      if (Math.abs(V[a].f[fi]) < 1e-9) { NT.push(tr); continue; }
      const ab = Math.abs(V[b].f[fi]) < 1e-9 ? b : mid(a, b), ac = Math.abs(V[c].f[fi]) < 1e-9 ? c : mid(a, c); NT.push([a, ab, ac], [ab, b, c], [ab, c, ac]); }
    T = NT; }
  // ----- label triangles -----
  const F = Object.fromEntries(FIELDS.map((f, i) => [f, i]));
  const labelOf = (tr) => { const gs = tr.map((v) => V[v].g); const g = gs[0] === gs[1] || gs[0] === gs[2] ? gs[0] : gs[1]; const f = (n) => (F[n] === undefined ? 1 : (V[tr[0]].f[F[n]] + V[tr[1]].f[F[n]] + V[tr[2]].f[F[n]]) / 3);
    if (g === 'arm') return f('sleeve') < 0 ? (jacket ? 3 : 1) : 0;
    if (g === 'leg') return f('hem') < 0 ? 0 : jacket && f('waistJ') >= 0 ? 3 : f('waist') >= 0 ? 1 : 2;
    if (jacket && f('neck') < 0 && f('waistJ') >= 0 && !(f('front') > 0 && f('plk') < 0)) return 3;
    if (f('waist') < 0) return 2; if (f('neck') >= 0) return 0;
    if (overalls && ((f('front') > 0 && f('bibx') < 0 && f('biby') < 0) || f('strap') < 0)) return 3;
    if (vest && !(f('front') > 0 && f('plk') < 0)) return 3;
    return 1; };
  const TH = [0, 0.0035, overalls ? 0.007 : 0.005, jacket ? 0.011 : vest ? 0.009 : 0.0075];
  const lab = T.map(labelOf);
  // ----- split per label, displace cloth outward, build hem strips -----
  const out = { pos: [], nor: [], uv: [], sw: [], si: [] }, groups = [[], [], [], []], copy = new Map();
  const Sx = { 1: B.upperArmL[0], '-1': B.upperArmR[0] };
  const extra = (v, L) => { let e = 0; const fv = (n) => (F[n] === undefined ? 1 : v.f[F[n]]);
    if (L === 1 && v.g !== 'arm') e += 0.004 * g2(fv('waist') - 0.022, 0.018) + 0.003 * sstep(-0.014, 0, fv('neck'));
    if ((L === 1 || L === 3) && v.g === 'arm') e += 0.004 * sstep(-0.05, 0, fv('sleeve'));
    if (L === 2 && v.g === 'leg') e += 0.006 * sstep(0.08, 0, fv('hem')) + 0.0015 * Math.sin(v.p.y * 140 + v.p.x * 40) * sstep(0.2, 0.0, fv('hem'));
    if (L === 3 && jacket) e += 0.004 * sstep(0.05, 0, fv('waistJ'));
    return e; };
  const segAxis = (p, a, b) => { const A = new THREE.Vector3(...a), Bq = new THREE.Vector3(...b), ab = Bq.clone().sub(A); const t = clamp(p.clone().sub(A).dot(ab) / ab.lengthSq(), 0, 1); return A.add(ab.multiplyScalar(t)); };
  const loose = (v, L) => { const p = v.p, o = new THREE.Vector3(); const push = (c, R, wgt = 1, horiz = true) => { const d = p.clone().sub(c); if (horiz) d.y = 0; const r = d.length(); if (r < 1e-4 || r >= R) return; o.add(d.normalize().multiplyScalar((R - r) * wgt)); };
    const sd = p.x > 0 ? 'L' : 'R';
    if (L === 2 && v.g === 'leg') { const c = p.y > B['shin' + sd][1] ? segAxis(p, B['thigh' + sd], B['shin' + sd]) : segAxis(p, B['shin' + sd], B['foot' + sd]); const R = (p.y < 0.5 ? 0.063 : 0.063 + (p.y - 0.5) * 0.08) * Math.sqrt(S.bw); push(c, R, sstep(0.82, 0.7, p.y)); }
    if ((L === 1 || L === 3) && v.g === 'arm') { const c = segAxis(p, B['upperArm' + sd], B['foreArm' + sd]); const d = p.clone().sub(c); const R = (jacket ? 0.052 : 0.054) * S.bw; const r = d.length(); if (r < R && r > 1e-4) o.add(d.normalize().multiplyScalar((R - r) * (jacket ? 0.7 : sstep(1.32, 1.24, p.y)))); }
    if ((L === 1 || L === 3) && (v.g === 'torso' || v.g === 'leg') && p.y < 1.24) { const d = new THREE.Vector3(p.x, 0, p.z + 0.005); const ang = Math.atan2(d.x, d.z); const rx = (fem ? 0.142 : 0.158) * S.bw + (L === 3 ? 0.008 : 0), rz = (fem ? 0.1 : 0.108) * S.bw + (L === 3 ? 0.008 : 0); const R = 1 / Math.hypot(Math.sin(ang) / rx, Math.cos(ang) / rz); const r = d.length(); if (r < R) o.add(d.normalize().multiplyScalar((R - r) * sstep(1.24, 1.16, p.y) * (vest ? 0.6 : 1))); }
    return o; };
  const vid = (i, L) => { const k = i * 4 + L; let r = copy.get(k); if (r !== undefined) return r; const v = V[i]; const d = L ? TH[L] + extra(v, L) : 0;
    const p = v.p.clone().addScaledVector(v.n, d); if (L) p.add(loose(v, L)); r = out.pos.length / 3; out.pos.push(p.x, p.y, p.z); out.nor.push(v.n.x, v.n.y, v.n.z);
    const cx = v.g === 'arm' ? Sx[v.p.x > 0 ? 1 : -1] : v.g === 'leg' ? (v.p.x > 0 ? 0.095 : -0.095) : 0; out.uv.push(v.g === 'arm' ? Math.atan2(v.p.x - cx, v.p.z) / (4 * Math.PI) : Math.atan2(v.p.x - cx, v.p.z) / (2 * Math.PI) + 0.5, (v.p.y - 1.0) / 0.45);
    const top = Array.from(v.w).map((w, b) => [w, b]).sort((a, b) => b[0] - a[0]).slice(0, 4); const sum = top.reduce((s, a) => s + a[0], 0) || 1; out.sw.push(...top.map((a) => a[0] / sum)); out.si.push(...top.map((a) => a[1]));
    copy.set(k, r); return r; };
  T.forEach((tr, i) => groups[lab[i]].push(vid(tr[0], lab[i]), vid(tr[1], lab[i]), vid(tr[2], lab[i])));
  const edges = new Map(); T.forEach((tr, i) => { for (let e = 0; e < 3; e++) { const a = tr[e], b = tr[(e + 1) % 3]; const k = a < b ? a + '_' + b : b + '_' + a; (edges.get(k) || edges.set(k, []).get(k)).push(i); } });
  for (const [k, ts] of edges) { if (ts.length !== 2) continue; const [L1, L2] = [lab[ts[0]], lab[ts[1]]]; if (L1 === L2 || TH[L1] === TH[L2]) continue;
    const [A, Bl, tA] = TH[L1] > TH[L2] ? [L1, L2, ts[0]] : [L2, L1, ts[1]]; const [a, b] = k.split('_').map(Number);
    const q = [vid(a, A), vid(b, A), vid(b, Bl), vid(a, Bl)]; const P = (j) => new THREE.Vector3(out.pos[q[j] * 3], out.pos[q[j] * 3 + 1], out.pos[q[j] * 3 + 2]);
    const n = new THREE.Vector3().crossVectors(P(1).sub(P(0)), P(3).sub(P(0))); const cen = T[tA].reduce((s, v) => s.add(V[v].p), new THREE.Vector3()).divideScalar(3); const outD = V[a].p.clone().add(V[b].p).multiplyScalar(0.5).sub(cen);
    if (n.dot(outD) >= 0) groups[A].push(q[0], q[1], q[2], q[0], q[2], q[3]); else groups[A].push(q[0], q[2], q[1], q[0], q[3], q[2]); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(out.si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(out.sw, 4));
  const idx = []; groups.forEach((g, m) => { geo.addGroup(idx.length, g.length, m); idx.push(...g); }); geo.setIndex(idx);
  // ----- materials -----
  const cloth = (col, map, rough = 0.88, rep = 2) => { const nm = foldNormal(1, 0); nm.repeat.set(rep, rep * 1.4); return new THREE.MeshPhysicalMaterial({ color: map ? 0xffffff : col, map: map || null, roughness: rough, sheen: 0.6, sheenColor: new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.4), sheenRoughness: 0.7, normalMap: nm, normalScale: new THREE.Vector2(0.7, 0.7) }); };
  const skin = skinMaterial(skinC, {});
  const shirtMat = cloth(shirtC, shirtMap('#' + shirtC.getHexString(), av.pattern, outfit));
  const pantsMat = cloth(overalls ? denim : pantsC, null, 0.9, 3);
  const outerMat = cloth(jacket ? new THREE.Color('#3f6fa8') : vest ? new THREE.Color('#8a5a2b') : denim, null, jacket ? 0.85 : vest ? 0.7 : 0.9, 3);
  // ----- skeleton -----
  const bones = {}; for (const b of BONES) { const bn = new THREE.Bone(); bn.name = b; bones[b] = bn; }
  for (const b of BONES) { const w = B[b]; if (PARENT[b]) { const pw = B[PARENT[b]]; bones[b].position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]); bones[PARENT[b]].add(bones[b]); } else bones[b].position.set(...w); }
  const root = new THREE.Group(); root.add(bones.hips); root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((b) => bones[b]));
  const body = new THREE.SkinnedMesh(geo, [skin, shirtMat, pantsMat, outerMat]); body.castShadow = body.receiveShadow = true; body.frustumCulled = false; root.add(body); body.bind(skeleton);
  const attach = (obj, bone, world) => { const w = B[bone]; obj.position.set(world[0] - w[0], world[1] - w[1], world[2] - w[2]); bones[bone].add(obj); obj.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); return obj; };
  const skinned = (g, mat) => { const pp = g.attributes.position, si = [], sw = []; for (let i = 0; i < pp.count; i++) { const w = weightsAt(pp.getX(i), pp.getY(i), pp.getZ(i)); const top = Array.from(w).map((x, b) => [x, b]).sort((a, b) => b[0] - a[0]).slice(0, 4); const s = top.reduce((q, a) => q + a[0], 0); sw.push(...top.map((a) => a[0] / s)); si.push(...top.map((a) => a[1])); }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4)); const m = new THREE.SkinnedMesh(g, mat); m.frustumCulled = false; m.castShadow = m.receiveShadow = true; root.add(m); m.bind(skeleton); return m; };
  const surfZ = (x, y) => { let z = 0.3; for (let i = 0; i < 60; i++) { const d = sdf(x, y, z); if (d < 0.0005) break; z -= d; } return z; };
  // belt (skinned tube following the actual waist)
  if (!overalls && !jacket) { const pts = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a); let r = 0.05; for (let j = 0; j < 40; j++) { const d = sdf(dx * r, waistY - 0.004, dz * r - 0.005); r += d; if (Math.abs(d) < 0.0003) break; } pts.push(new THREE.Vector3(dx * (r + 0.0075), waistY - 0.004, dz * (r + 0.0075) - 0.005)); }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), lod === 2 ? 24 : 64, 0.012, lod === 2 ? 4 : 6, true); tg.scale(1, 1.6, 1).translate(0, -(waistY - 0.004) * 0.6, 0);
    skinned(tg, new THREE.MeshStandardMaterial({ color: '#3a2a1e', roughness: 0.45 }));
    const bz = surfZ(0, waistY) + 0.013; const bk = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.026, 0.006), new THREE.MeshStandardMaterial({ color: '#b9a27a', metalness: 0.55, roughness: 0.35 })); attach(bk, 'hips', [0, waistY - 0.004, bz]); }
  // ----- head -----
  const hf = headFn(fem), HC = [0, 1.645, 0.012], headG = new THREE.Group(); attach(headG, 'head', HC); headG.scale.setScalar(0.93);
  const hg = new THREE.SphereGeometry(1, LOD.head[0], LOD.head[1]); { const p = hg.attributes.position, ud = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); ud.set([x, y, z], i * 3); const q = hf(x, y, z); p.setXYZ(i, q.x, q.y, q.z); } hg.setAttribute('udir', new THREE.BufferAttribute(ud, 3)); hg.computeVertexNormals(); }
  const facial = av.facial, hs = av.hairStyle;
  const headMat = skinMaterial(skinC, { head: true, scalp: hs !== 6, mohawk: hs === 3, stubble: facial === 1 || facial === 4 || facial === 5 || facial === 3, beard: facial === 4, chops: facial === 5, freckles: !!av.freckles, hairC, beardC: hairC });
  const headM = new THREE.Mesh(hg, headMat); headG.add(headM);
  const tmp = new THREE.Mesh(hg); tmp.updateMatrixWorld(true); const ray = new THREE.Raycaster();
  const surf = (x, y) => { ray.set(new THREE.Vector3(x, y, 0.4), new THREE.Vector3(0, 0, -1)); const h = ray.intersectObject(tmp)[0]; return h ? h.point : new THREE.Vector3(x, y, 0.1); };
  const M = (g, m, par = headG) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; par.add(o); return o; };
  // ears: shaped (helix rim + concha) from a squashed lathe
  for (const s of [-1, 1]) { const eg = new THREE.SphereGeometry(0.024, lod ? 10 : 16, lod ? 8 : 12); const ep = eg.attributes.position; for (let i = 0; i < ep.count; i++) { const x = ep.getX(i), y = ep.getY(i), z = ep.getZ(i); const rim = Math.hypot(y, z) / 0.024; ep.setX(i, x * (0.35 + 0.25 * rim) - (rim < 0.6 && x > 0 ? 0.004 : 0)); } eg.computeVertexNormals();
    const e = M(eg, skin); if (lod < 2) { const hx = M(new THREE.TorusGeometry(0.021, 0.0045, 7, 22, Math.PI * 1.45), skin, e); hx.rotation.set(0, Math.PI / 2, Math.PI * 0.35); hx.position.x = 0.004; hx.scale.set(1, 1, 1); } const ep2 = hf(s * 0.99, -0.02, -0.12); e.position.set(ep2.x + s * 0.004, ep2.y, ep2.z + 0.004); if (lod < 2) { const ah = M(new THREE.TorusGeometry(0.012, 0.0026, 5, 14, Math.PI * 1.2), skin, e); ah.rotation.set(0, Math.PI / 2, Math.PI * 0.45); ah.position.set(0.006, 0.002, 0.002); const lb = M(new THREE.SphereGeometry(0.0085, 8, 6), skin, e); lb.position.set(0.001, -0.02, 0.003); lb.scale.set(0.55, 1, 0.9); const tr = M(new THREE.SphereGeometry(0.004, 6, 4), skin, e); tr.position.set(0.002, -0.004, 0.019); } e.scale.set(s, 1.25, 0.82); e.rotation.y = -s * 0.25; }
  // eyes: larger, iris texture, cornea, upper/lower lids, lashes
  if (lod < 2) for (const s of [-1, 1]) { const ep = surf(s * 0.034, 0.006); const e = new THREE.Group(); e.position.set(ep.x, ep.y, ep.z - 0.0118); headG.add(e); const R = 0.0152;
    M(new THREE.SphereGeometry(R, lod ? 14 : 24, lod ? 10 : 18), new THREE.MeshPhysicalMaterial({ color: '#d6cabd', roughness: 0.3, clearcoat: 0.8 }), e);
    const ig = new THREE.SphereGeometry(R + 0.0002, lod ? 14 : 24, 6, 0, Math.PI * 2, 0, 0.52).rotateX(Math.PI / 2); { const a = ig.attributes.position, uv = ig.attributes.uv; for (let i = 0; i < a.count; i++) uv.setXY(i, a.getX(i) / 0.0166 + 0.5, a.getY(i) / 0.0166 + 0.5); } M(ig, new THREE.MeshPhysicalMaterial({ map: irisTex(eyeC), roughness: 0.15, clearcoat: 1 }), e);
    if (!lod) { const co = M(new THREE.SphereGeometry(0.0085, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.35), new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.12, roughness: 0, clearcoat: 1, transmission: 0 }), e); co.rotation.x = Math.PI / 2; co.position.z = R - 0.0045; }
    const lidMat = skinMaterial(skinC.clone().multiplyScalar(0.93), { sss: 0.8 }); lidMat.sheen = 0; lidMat.roughness = 0.6; const marginMat = new THREE.MeshStandardMaterial({ color: skinC.clone().multiplyScalar(0.62).lerp(new THREE.Color('#8a4a44'), 0.3), roughness: 0.35 }); const ul = M(new THREE.SphereGeometry(R + 0.0007, lod ? 14 : 24, 6, 0, Math.PI * 2, 0, Math.PI * 0.4), lidMat, e); ul.rotation.x = 0.05;
    const ll = M(new THREE.SphereGeometry(R + 0.0007, lod ? 14 : 24, 4, 0, Math.PI * 2, Math.PI * 0.7, Math.PI * 0.3), lidMat, e); ll.rotation.x = 0.12;
    for (const [lid, th0, tb] of [[ul, 0.4, 0.0016], [ll, 0.7, 0.0011]]) { const rr = (R + 0.0007) * Math.sin(Math.PI * th0), yy = (R + 0.0007) * Math.cos(Math.PI * th0); const tm = M(new THREE.TorusGeometry(rr, tb * 0.85, 5, lod ? 12 : 24, Math.PI * 1.15), marginMat, lid); tm.rotation.set(Math.PI / 2, 0, -Math.PI * 0.075); tm.position.y = yy; tm.castShadow = false; }
    const th = Math.PI * 0.4 + 0.0, ac = { pos: [], nor: [], uv: [], idx: [] }; const pts = [], nr = [], wd = []; for (let i = 0; i <= 10; i++) { const ph = Math.PI / 2 - 1.25 + (2.5 * i) / 10; const rr = (R + 0.0011) * Math.sin(th), y = (R + 0.0011) * Math.cos(th); pts.push(new THREE.Vector3(-rr * Math.cos(ph), y, rr * Math.sin(ph))); nr.push(new THREE.Vector3(0, 1, 0.4).normalize()); wd.push(0.0); }
    { const base = ac.pos.length / 3; pts.forEach((p, i) => { const o = new THREE.Vector3(p.x, 0, p.z).normalize(); const q = p.clone().addScaledVector(o, 0.0042).add(new THREE.Vector3(0, 0.0022, 0)); ac.pos.push(p.x, p.y, p.z, q.x, q.y, q.z); ac.nor.push(0, 1, 0, 0, 1, 0); ac.uv.push(i / 10, 1, i / 10, 0); if (i) { const a = base + (i - 1) * 2; ac.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }); }
    const lash = M(accGeo(ac), new THREE.MeshStandardMaterial({ color: '#0d0907', alphaMap: lashTex(), alphaTest: 0.3, transparent: false, side: THREE.DoubleSide }), ul); lash.castShadow = false; }
  // ----- hair / brows / facial hair: layered strips -----
  const hairAcc = { pos: [], nor: [], uv: [], idx: [] }, fhAcc = { pos: [], nor: [], uv: [], idx: [] };
  const HCw = new THREE.Vector3(...HC); const bodyD = (p) => sdf(p.x + HCw.x, p.y + HCw.y, p.z + HCw.z);
  const surfR = (u) => hf(u.x, u.y, u.z).length();
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grow = (acc, root, dir0, o) => { const pts = [], nr = [], wd = []; let p = root.clone(), d = dir0.clone().normalize(); const n = o.seg, step = o.len / n;
    for (let k = 0; k <= n; k++) { const u = p.clone().normalize(); const R = surfR(u) + o.off; if (!o.free && (p.length() < R || p.y > -0.03 || o.conform)) p.setLength(R);
      if (o.face && p.z > 0.0 && Math.abs(p.x) < 0.088 && p.y < 0.06) p.x = Math.sign(p.x || 1) * 0.088;
      if (p.y < -0.06) { const dd = bodyD(p); if (dd < 0.012) { const g = grad(sdf, p.x + HCw.x, p.y + HCw.y, p.z + HCw.z); p.addScaledVector(new THREE.Vector3(...g), 0.012 - dd); } }
      pts.push(p.clone()); const nn = p.clone().normalize(); if (p.y < -0.04) nn.set(p.x, 0, p.z).normalize(); nr.push(nn); wd.push(o.w * (1 - 0.55 * Math.pow(k / n, 1.5)));
      if (o.stop && o.stop(p)) break;
      d.y -= o.grav * step * 10; if (o.curl) d.applyAxisAngle(nn, o.curl); if (o.wave) d.applyAxisAngle(nn, Math.sin(k * 1.9 + o.ph) * o.wave); if (o.to) d.lerp(o.to.clone().sub(p).normalize(), o.toK); d.normalize(); p = p.clone().addScaledVector(d, step); }
    if (pts.length > 1) ribbon(acc, pts, nr, wd); };
  const fib = (N) => { const r = []; for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, rr = Math.sqrt(1 - y * y), a = i * 2.39996; r.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr)); } return r; };
  const tangent = (u, v) => v.clone().sub(u.clone().multiplyScalar(v.dot(u))).normalize();
  const crown = new THREE.Vector3(0, 0.78, -0.62).normalize();
  const sg = LOD.seg, NS = Math.round(380 * LOD.strips);
  if (hs !== 6 && hs !== 4) {
    const NSx = (hs === 0 ? 1.6 : hs === 1 ? 2 : 1) * (lod ? 0.6 : 1); const layers = lod === 2 ? [0.006] : [0.0035, 0.007, 0.0105];
    for (const off of layers) for (const u of fib(Math.round(NS * NSx / layers.length * (hs === 3 ? 2.2 : 1)))) { u.x += (rnd() - 0.5) * 0.03; u.z += (rnd() - 0.5) * 0.03; u.normalize(); if (u.y < hairline(u) + 0.03) continue; if (hs === 3 && Math.abs(u.x) > 0.2) continue;
      const root = hf(u.x, u.y, u.z).addScaledVector(u, off * 0.3); const away = tangent(u, u.clone().sub(crown)); if (!isFinite(away.x)) away.set(0, 0, 1);
      if (hs === 0) grow(hairAcc, root, u.z > 0.35 ? tangent(u, new THREE.Vector3(0.6, -0.2, 0.5)) : away, { len: 0.07 + 0.025 * rnd(), seg: sg, w: 0.03, off, grav: 0.06, stop: (p) => { const q = p.clone().normalize(); return q.z > 0.2 ? q.y < hairline(q) + 0.07 : q.y < -0.12; } });
      else if (hs === 1) { const dir = u.z > 0.25 ? tangent(u, new THREE.Vector3(Math.sign(u.x || 0.01), -0.4, 0)) : away; grow(hairAcc, root, dir, { len: 0.27 + 0.06 * rnd(), seg: sg + (lod ? 1 : 3), w: 0.022, off, grav: 0.25, face: true }); }
      else if (hs === 2 || hs === 5) { const tgt = hs === 2 ? new THREE.Vector3(0, 0.105, -0.105) : new THREE.Vector3(0, 0.03, -0.125); grow(hairAcc, root, tangent(u, tgt.clone().sub(root)), { len: root.distanceTo(tgt) * 1.2, seg: sg, w: 0.026, off, grav: 0, to: tgt, toK: 0.35, stop: (p) => p.distanceTo(tgt) < 0.02 }); }
      else if (hs === 3) grow(hairAcc, root, u.clone().multiplyScalar(1).add(new THREE.Vector3(0, 0, -0.7)), { len: 0.085, seg: sg, w: 0.022, off: off + 0.004, grav: 0, free: true });
      else if (hs === 7) grow(hairAcc, root, away.clone().applyAxisAngle(u, (rnd() - 0.5) * 1.2), { len: 0.085, seg: sg + 3, w: 0.026, off: off + 0.012, grav: 0.02, wave: 0.8, ph: rnd() * 6, stop: (p) => { const q = p.clone().normalize(); return q.z > 0.2 ? q.y < hairline(q) + 0.04 : q.y < -0.1; } }); }
    if (hs === 5) for (let i = 0; i < Math.round(60 * LOD.strips) + 6; i++) { const a = rnd() * 6.283, r = 0.012 * rnd(); grow(hairAcc, new THREE.Vector3(Math.cos(a) * r, 0.03 + Math.sin(a) * r, -0.13), new THREE.Vector3((rnd() - 0.5) * 0.3, -0.5, -0.8), { len: 0.26, seg: sg + 2, w: 0.022, off: 0, grav: 0.25, free: true }); }
  }
  // brows
  if (lod < 2) for (const s of [-1, 1]) for (let i = 0; i < 34; i++) { const t = (i % 17) / 16, row = i >= 17 ? 0.018 : 0; const u = new THREE.Vector3(s * (0.13 + 0.38 * t + (rnd() - 0.5) * 0.02), 0.25 + row + 0.045 * Math.sin(t * 3.0) - 0.035 * t, 0); u.z = Math.sqrt(Math.max(0, 1 - u.x * u.x - u.y * u.y)); const root = hf(u.x, u.y, u.z);
    grow(fhAcc, root, tangent(u, new THREE.Vector3(s, 0.35 - 0.6 * t, 0)), { len: 0.014 - row * 0.3, seg: 2, w: (fem ? 0.0032 : 0.0042) * (1 - 0.5 * t), off: 0.0012, grav: 0, brow: true }); }
  // facial hair strips
  const fN = lod === 2 ? 0.25 : lod === 1 ? 0.55 : 1;
  const faceRoots = (pred, n) => fib(n).filter((u) => u.z > -0.3 && pred(u));
  if (facial === 2 || facial === 3 || facial === 4) for (let i = 0; i < Math.round(26 * fN) + 6; i++) { const t = i / (Math.round(26 * fN) + 5) - 0.5; const u = new THREE.Vector3(t * 0.52, -0.355, 0); u.z = Math.sqrt(1 - u.x * u.x - u.y * u.y); grow(fhAcc, hf(u.x, u.y, u.z), tangent(u, new THREE.Vector3(t * 1.2, -1, 0)), { len: 0.02 + 0.006 * (1 - Math.abs(t) * 2), seg: 2, w: 0.01, off: 0.002, grav: 0.02 }); }
  { const bm = (u) => { const ax = Math.abs(u.x); const tb = mix(-0.29, -0.06, sstep(0.14, 0.42, ax)); let m = sstep(-0.02, 0.06, tb - u.y) * sstep(-0.5, -0.25, u.z) * sstep(-1.0, -0.8, u.y); m *= 1 - g2(u.x, 0.16) * g2(u.y + 0.465, 0.05);
      if (facial === 5) m *= sstep(0.3, 0.42, ax) * sstep(-0.8, -0.6, u.y); if (facial === 3) m = sstep(0.2, 0.14, ax) * sstep(-0.52, -0.6, u.y) * sstep(-0.98, -0.85, u.y) * (u.z > 0 ? 1 : 0); return m; };
    if (facial >= 3) { const sm2 = shellMesh(hf, bm, { layers: [7, 2, 1][lod], depth: facial === 4 ? 0.011 : 0.008, seg: [[64, 48], [30, 22], [16, 12]][lod], freq: 1300, stretch: 0.25, color: hairC.clone().multiplyScalar(1.1), lean: () => new THREE.Vector3(0, -0.8, 0.1) }); headG.add(sm2); } }
  if (hs !== 6 && hs !== 4) { const sc = (u) => sstep(-0.02, 0.09, u.y - hairline(u)) * (hs === 3 ? sstep(0.24, 0.16, Math.abs(u.x)) : 1);
    headG.add(shellMesh(hf, sc, { layers: [6, 2, 1][lod], depth: hs === 3 ? 0.012 : hs === 7 ? 0.024 : 0.008, seg: [[56, 40], [28, 20], [16, 12]][lod], freq: hs === 7 ? 420 : 1100, stretch: hs === 7 ? 0.8 : 0.3, layers: hs === 7 ? [10, 4, 1][lod] : [6, 2, 1][lod], color: hairC.clone().multiplyScalar(1.15), lean: (u) => new THREE.Vector3(0, -0.4, 0.6 * Math.sign(u.z)) })); }
  const hairMat = new THREE.MeshStandardMaterial({ color: hairC.clone().multiplyScalar(1.05), map: strandTex(3), alphaTest: 0.25, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.6, envMapIntensity: 0.6, normalMap: strandNormal(), normalScale: new THREE.Vector2(0.35, 0.35) });
  hairMat.map.colorSpace = THREE.SRGBColorSpace; hairMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin + '\n normal = normalize(mix(normalize(vNormal), vec3(0.0, 0.0, 1.0), 0.35));'); }; hairMat.customProgramCacheKey = () => 'hairNF'; hairMat.map.wrapS = hairMat.map.wrapT = THREE.ClampToEdgeWrapping;
  hairMat.alphaMap = hairMat.map; hairMat.map = lod ? null : strandTex(3, true, 70, true); if (hairMat.map) hairMat.map.colorSpace = THREE.SRGBColorSpace; hairMat.color.copy(hairC).multiplyScalar(lod ? 0.95 : 1.15); hairMat.roughness = 0.7; hairMat.envMapIntensity = 0.6; if (lod) { hairMat.alphaToCoverage = false; hairMat.alphaTest = 0.3; hairMat.normalMap = null; }
  if (hairAcc.idx.length) { const hm = M(accGeo(hairAcc), hairMat); hm.receiveShadow = false; hm.castShadow = !lod; hm.renderOrder = 2; }
  if (fhAcc.idx.length) { const fm = hairMat.clone(); fm.alphaMap = strandTex(11, false, 110); fm.map = null; fm.alphaTest = 0.3; fm.alphaTest = 0.45; fm.color.copy(hairC).multiplyScalar(0.38); M(accGeo(fhAcc), fm).receiveShadow = false; }
  if (hs === 4) { const g = new THREE.IcosahedronGeometry(0.19, lod === 2 ? 2 : lod ? 3 : 4); const pp = g.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); const n = 1 + 0.06 * Math.sin(v.x * 90) * Math.sin(v.y * 80) * Math.sin(v.z * 70); pp.setXYZ(i, v.x * n, v.y * n * 0.95, v.z * n); } g.computeVertexNormals();
    const af = M(g, new THREE.MeshStandardMaterial({ color: hairC, roughness: 0.8, normalMap: strandNormal() })); af.position.set(0, 0.085, -0.075); af.scale.set(1, 0.9, 0.85);
    const sh = M(g.clone().scale(1.04, 1.04, 1.04), new THREE.MeshStandardMaterial({ color: hairC, alphaMap: strandTex(5, true, 160), alphaTest: 0.5, roughness: 0.85 })); sh.position.copy(af.position); sh.scale.copy(af.scale); sh.material.alphaMap.repeat.set(10, 6); sh.material.alphaMap.wrapS = sh.material.alphaMap.wrapT = THREE.RepeatWrapping; }
  if (hs === 2) { const bun = M(new THREE.IcosahedronGeometry(0.044, lod === 2 ? 1 : 3), new THREE.MeshStandardMaterial({ color: hairC, roughness: 0.5, normalMap: strandNormal() })); bun.position.set(0, 0.115, -0.115); bun.scale.set(1, 0.85, 0.9); }
  if (hs === 5 || hs === 2) { const tie = M(new THREE.TorusGeometry(0.016, 0.005, 6, 14), new THREE.MeshStandardMaterial({ color: '#141414' })); tie.position.set(0, hs === 2 ? 0.1 : 0.03, hs === 2 ? -0.1 : -0.13); tie.rotation.x = Math.PI / 2 + 0.6; }
  // ----- hats (head-centre frame) -----
  const sd = (n) => Math.max(8, Math.round(n * [1, 0.6, 0.3][lod]));
  const hatMat = (c) => cloth(new THREE.Color(c), null, 0.8, 1); const hy = 0.085; const shopHat = eq.hat && eq.hat !== 'halo';
  if (!shopHat) {
    if (av.hat === 1) { const m = hatMat('#' + shirtC.getHexString()); const cr = M(new THREE.SphereGeometry(0.13, sd(32), sd(16), 0, Math.PI * 2, 0, Math.PI * 0.5), m); cr.position.set(0, hy - 0.035, -0.005); cr.scale.set(0.93, 0.85, 1.03); const br = M(new THREE.CylinderGeometry(0.1, 0.1, 0.007, sd(24), 1, false, -Math.PI / 2, Math.PI), m); br.position.set(0, hy - 0.03, 0.085); br.rotation.x = 0.16; br.scale.set(0.92, 1, 1.05); M(new THREE.SphereGeometry(0.009, 8, 6), m).position.set(0, hy + 0.077, -0.005); }
    else if (av.hat === 2) { const m = hatMat('#e9dcc3'); M(new THREE.CylinderGeometry(0.108, 0.122, 0.1, sd(28)), m).position.y = hy + 0.03; const b = M(new THREE.CylinderGeometry(0.122, 0.18, 0.04, sd(28), 1, true), m); b.position.y = hy - 0.035; b.material.side = THREE.DoubleSide; }
    else if (av.hat === 3) { const m = new THREE.MeshStandardMaterial({ color: '#7a4b22', roughness: 0.75, side: THREE.DoubleSide }); M(new THREE.LatheGeometry([[0.0, 0.12], [0.07, 0.11], [0.115, 0.08], [0.12, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)), sd(28)), m).position.y = hy - 0.01; const br = M(new THREE.LatheGeometry([[0.12, 0.0], [0.2, 0.0], [0.24, 0.035]].map(([r, y]) => new THREE.Vector2(r, y)), sd(32)), m); br.position.y = hy - 0.015; br.scale.z = 0.85; }
    else if (av.hat === 4) { const m = hatMat('#' + pantsC.getHexString()); const be = M(new THREE.SphereGeometry(0.128, sd(32), sd(16), 0, Math.PI * 2, 0, Math.PI * 0.55), m); be.position.y = hy - 0.045; be.scale.set(0.92, 1.05, 1.02); const rib = M(new THREE.TorusGeometry(0.114, 0.015, 8, sd(32)), m); rib.rotation.x = Math.PI / 2; rib.position.y = hy - 0.04; rib.scale.set(0.93, 1.05, 1); }
    else if (av.hat === 5) { const cols = ['#ff4fa3', '#ffd166', '#ffffff', '#4ea8ff', '#ff4d4d']; for (let i = 0; i < 5; i++) { const a = -0.9 + i * 0.45; const fl = new THREE.Group(); fl.position.set(0.098 * Math.cos(a) * 0.95, hy - 0.005 + 0.012 * Math.sin(i), 0.1 * Math.sin(a) * 0.6 - 0.02); headG.add(fl); for (let p = 0; p < 5; p++) { const pt = M(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.6 }), fl); pt.position.set(0, Math.cos((p / 5) * 6.283) * 0.012, Math.sin((p / 5) * 6.283) * 0.012); pt.scale.set(0.4, 1, 1); } M(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffb703' }), fl).position.x = 0.004; } }
    else if (av.hat === 6) { const m = hatMat('#c1121f'); const bd = M(new THREE.SphereGeometry(0.124, sd(32), sd(14), 0, Math.PI * 2, 0, Math.PI * 0.42), m); bd.position.set(0, hy - 0.06, -0.006); bd.scale.set(0.95, 1.05, 1.02); bd.rotation.x = -0.2; const kn = M(new THREE.SphereGeometry(0.02, 10, 8), m); kn.position.set(0, hy - 0.04, -0.125); for (const s of [-1, 1]) { const t = M(new THREE.BoxGeometry(0.03, 0.07, 0.006), m); t.position.set(s * 0.015, hy - 0.08, -0.13); t.rotation.z = s * 0.3; } }
    else if (av.hat === 7) { const m = new THREE.MeshStandardMaterial({ color: '#d9b44a', roughness: 0.85 }); M(new THREE.CylinderGeometry(0.105, 0.12, 0.09, sd(28)), m).position.y = hy + 0.02; M(new THREE.CylinderGeometry(0.25, 0.25, 0.01, sd(32)), m).position.y = hy - 0.02; const band = M(new THREE.CylinderGeometry(0.122, 0.122, 0.025, sd(28), 1, true), new THREE.MeshStandardMaterial({ color: '#8a1c1c' })); band.position.y = hy - 0.005; }
  } else if (eq.hat === 'gold_bucket') { const m = new THREE.MeshStandardMaterial({ color: '#e5b83a', metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }); M(new THREE.CylinderGeometry(0.108, 0.122, 0.1, sd(28)), m).position.y = hy + 0.03; M(new THREE.CylinderGeometry(0.122, 0.18, 0.04, sd(28), 1, true), m).position.y = hy - 0.035; }
  else if (eq.hat === 'rainbow_beanie') { ['#ff4d4d', '#ffb703', '#ffe66d', '#06d6a0', '#4ea8ff'].forEach((c, i) => { const r = M(new THREE.CylinderGeometry(0.12 - i * 0.018, 0.125 - i * 0.017, 0.03, sd(28)), hatMat(c)); r.position.y = hy - 0.03 + i * 0.028; }); M(new THREE.SphereGeometry(0.03, 10, 8), hatMat('#ffffff')).position.y = hy + 0.13; }
  else if (eq.hat === 'top_hat') { const m = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.5 }); M(new THREE.CylinderGeometry(0.1, 0.105, 0.2, sd(28)), m).position.y = hy + 0.08; M(new THREE.CylinderGeometry(0.17, 0.17, 0.012, sd(32)), m).position.y = hy - 0.02; M(new THREE.CylinderGeometry(0.107, 0.107, 0.03, sd(28)), new THREE.MeshStandardMaterial({ color: '#c1121f' })).position.y = hy + 0.0; }
  if (eq.hat === 'halo') { const h = M(new THREE.TorusGeometry(0.12, 0.012, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffe28a })); h.rotation.x = Math.PI / 2; h.position.y = 0.22; }
  // glasses + face cosmetics
  const eyeP = [-1, 1].map((s) => surf(s * 0.0365, 0.013));
  if (av.glasses) { const fr = new THREE.MeshStandardMaterial({ color: av.glasses === 1 ? '#c9a227' : '#1b1b1b', metalness: av.glasses === 1 ? 1 : 0, roughness: 0.3 }), lens = new THREE.MeshPhysicalMaterial({ color: av.glasses === 2 ? '#dfefff' : av.glasses === 1 ? '#3b4a3a' : '#101418', transparent: true, opacity: av.glasses === 2 ? 0.2 : 0.82, roughness: 0.05, clearcoat: 1 });
    for (const [i, s] of [[0, -1], [1, 1]]) { const ep = eyeP[i], r = av.glasses === 2 ? 0.02 : 0.023; const rim = M(new THREE.TorusGeometry(r, 0.0022, 6, sd(24)), fr); rim.position.set(ep.x, ep.y - 0.002, ep.z + 0.013); if (av.glasses !== 2) rim.scale.y = 0.82; const l = M(new THREE.CircleGeometry(r, sd(24)), lens); l.position.copy(rim.position); l.scale.copy(rim.scale);
      const arm = M(new THREE.BoxGeometry(0.0025, 0.003, 0.11), fr); arm.position.set(s * 0.079, ep.y + 0.002, ep.z - 0.045); }
    const br = M(new THREE.BoxGeometry(0.022, 0.0028, 0.003), fr); const bp = surf(0, 0.02); br.position.set(0, bp.y + 0.002, bp.z + 0.006); }
  if (eq.face === 'neon_shades') { const m = new THREE.MeshBasicMaterial({ color: '#ff2fd0' }); const b = M(new THREE.BoxGeometry(0.17, 0.035, 0.012), m); b.position.set(0, eyeP[0].y, eyeP[0].z + 0.015); const s2 = M(new THREE.BoxGeometry(0.17, 0.008, 0.013), new THREE.MeshBasicMaterial({ color: '#33f0ff' })); s2.position.set(0, eyeP[0].y - 0.008, eyeP[0].z + 0.016); }
  else if (eq.face === 'heart_specs') for (const p of eyeP) { const hs2 = new THREE.Shape(); hs2.moveTo(0, -0.015); hs2.bezierCurveTo(-0.03, 0.005, -0.012, 0.025, 0, 0.01); hs2.bezierCurveTo(0.012, 0.025, 0.03, 0.005, 0, -0.015); const h = M(new THREE.ShapeGeometry(hs2), new THREE.MeshBasicMaterial({ color: '#ff4fa3', side: THREE.DoubleSide })); h.position.set(p.x, p.y, p.z + 0.015); }
  // ----- shoes (rigid on the foot bones) -----
  { const sg2 = await buildShoe(lod, new THREE.Color('#2a2522'), shirtC); const sm3 = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.15 });
    for (const s of [-1, 1]) { const fb = s > 0 ? 'footL' : 'footR', A = B[fb]; const m = new THREE.Mesh(sg2, sm3); attach(m, fb, [A[0], 0, 0.035]); } }
  // ----- outfit hardware -----
  if (jacket) for (let i = 0; i < 4; i++) { const y = 1.03 + i * 0.085; attach(new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.005, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 1, roughness: 0.3 })), 'chest', [0.042, y, surfZ(0.042, y) + 0.013]); }
  if (overalls) for (const s of [-1, 1]) { const x = s * 0.078 * S.bw, y = 1.29; attach(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffd166', metalness: 1, roughness: 0.3 })), 'chest', [x, y, surfZ(x, y) + 0.01]); }
  // ----- accessories -----
  const side = av.accSide === 0 ? -1 : 1, accMat = (c, mt = 0) => new THREE.MeshStandardMaterial({ color: c, metalness: mt, roughness: mt ? 0.3 : 0.7 });
  if (av.acc === 1) { for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI, x = Math.cos(a) * 0.07, y = 1.42 - Math.sin(a) * 0.1; attach(new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), accMat('#d8dde6', 1)), 'chest', [x, y, surfZ(x, y) + 0.008]); }
    const pd = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), new THREE.MeshStandardMaterial({ map: iconTex(4), transparent: true, metalness: 0.6, roughness: 0.3, color: '#ffffff' })); attach(pd, 'chest', [0, 1.3, surfZ(0, 1.3) + 0.011]); }
  else if (av.acc === 2) { const hb = side > 0 ? 'handL' : 'handR', W = B[hb]; const wr = new THREE.Group(); attach(wr, hb, [W[0] - side * 0.012, W[1] - 0.075, W[2] + 0.01]); const m = accMat('#b0b7c3', 1); const h = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.22, 0.02), m); h.position.y = -0.02; wr.add(h); const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 6, 12, Math.PI * 1.5), m); jaw.position.y = -0.14; jaw.rotation.y = Math.PI / 2; wr.add(jaw); wr.rotation.x = 0.25; }
  else if (av.acc === 3) { const sc = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.022, 10, 24), cloth(new THREE.Color('#e63946'), null, 0.9, 1)); sc.rotation.x = Math.PI / 2 - 0.25; attach(sc, 'neck', [0, 1.46, 0.0]); const tl = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.012), sc.material); attach(tl, 'chest', [side * 0.045, 1.35, surfZ(side * 0.045, 1.35) + 0.018]); }
  else if (av.acc === 4) { const m = accMat('#222'); const band = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.007, 6, 24, Math.PI), m); band.position.y = 0.0; band.scale.set(0.95, 1.08, 1); headG.add(band); for (const s of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16).rotateZ(Math.PI / 2), m); cup.position.set(s * 0.115, -0.005, -0.005); headG.add(cup); } }
  else if (av.acc === 5) { const x = side * 0.09 * S.bw, y = 1.3; const bd = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.005, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1d8fe1', roughness: 0.4 })); attach(bd, 'chest', [x, y, surfZ(x, y) + 0.012]); }
  // tattoo: decal conformed to the forearm skin (visible with short sleeves)
  if (av.tattoo && !jacket) { const s = av.accSide === 0 ? -1 : 1, sd2 = s > 0 ? 'L' : 'R'; const El = B['foreArm' + sd2], Wr = B['hand' + sd2]; const c = [El[0] + (Wr[0] - El[0]) * 0.4, El[1] + (Wr[1] - El[1]) * 0.4, El[2] + (Wr[2] - El[2]) * 0.4];
    const pg = new THREE.PlaneGeometry(0.05, 0.05, 6, 6); pg.rotateY(s * Math.PI / 2 + s * 0.35); pg.translate(c[0] + s * 0.06, c[1], c[2]); const pp = pg.attributes.position; for (let i = 0; i < pp.count; i++) { const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i); let d = sdf(x, y, z); const g = grad(sdf, x, y, z); pp.setXYZ(i, x - g[0] * (d - 0.0006), y - g[1] * (d - 0.0006), z - g[2] * (d - 0.0006)); } pg.computeVertexNormals();
    skinned(pg, new THREE.MeshStandardMaterial({ map: iconTex(av.tattoo), transparent: true, opacity: 0.85, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide })); }
  // back cosmetics, aura, glow (root / chest)
  if (eq.back === 'surfboard') { const sb = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.75, 4, 16), new THREE.MeshStandardMaterial({ color: '#ff6b9d', roughness: 0.4 })); sb.scale.set(1, 1, 0.2); sb.rotation.z = 0.2; attach(sb, 'chest', [0.02, 1.05, -0.2 * S.bw]); }
  else if (eq.back === 'vw_wings') for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.42 - i * 0.07, 3, 8), new THREE.MeshStandardMaterial({ color: i % 2 ? '#e8eef7' : '#ff7a1a', roughness: 0.6 })); f.scale.set(1, 1, 0.35); f.rotation.z = s * (Math.PI / 2 - 0.5 + i * 0.12); attach(f, 'chest', [s * (0.22 + i * 0.05), 1.42 - i * 0.07, -0.14 * S.bw]); }
  if (eq.aura === 'flame_aura') for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const c = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5 + (i % 3) * 0.12, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? '#ff7a1a' : '#ffd23f', transparent: true, opacity: 0.8 })); c.position.set(Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5); root.add(c); }
  else if (eq.aura === 'peace_aura') { const rc = ['#ff4d4d', '#ffb703', '#ffe66d', '#06d6a0', '#4ea8ff', '#9b5de5']; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: rc[i % 6] })); b.position.set(Math.cos(a) * 0.55, 1.0 + 0.15 * Math.sin(a * 3), Math.sin(a) * 0.55); root.add(b); } }
  if (eq.glow === 'neon_underglow') { const g = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), new THREE.MeshBasicMaterial({ color: 0xb030ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); g.rotation.x = -Math.PI / 2; g.position.y = 0.01; root.add(g); }
  // ----- finish -----
  root.scale.setScalar([0.93, 1, 1.08][av.height] * (av.age === 0 ? 0.97 : 1));
  let tris = 0; root.traverse((o) => { if (o.isMesh && o.visible) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  root.userData.tris = Math.round(tris); root.userData.bodyTris = idx.length / 3; root.userData.bodyTarget = bodyOverride || LOD.body; root.userData.bones = bones;
  root.userData.pose = (t, mode = 'idle') => { const w = mode === 'walk', ph = t * 6.5, sn = Math.sin(ph);
    for (const s of [-1, 1]) { const sd = s > 0 ? 'L' : 'R', ph2 = ph + (s > 0 ? 0 : Math.PI);
      bones['thigh' + sd].rotation.set(w ? -Math.sin(ph2) * 0.42 : -0.02, 0, w ? 0 : s * 0.02); bones['shin' + sd].rotation.x = w ? Math.max(0, Math.sin(ph2 + 0.9)) * 0.85 + 0.05 : 0.03; bones['foot' + sd].rotation.x = w ? -0.15 * Math.sin(ph2 + 0.3) : 0;
      const a = w ? Math.sin(ph2 + Math.PI) * 0.38 : 0.03; bones['upperArm' + sd].rotation.set(-a, s * 0.0, s * (w ? 0.05 : 0.04)); bones['foreArm' + sd].rotation.set(w ? -0.25 - 0.25 * Math.max(0, Math.sin(ph2)) : -0.12, 0, 0); bones['hand' + sd].rotation.set(w ? -0.1 : -0.05, 0, 0); }
    bones.hips.position.y = B.hips[1] + (w ? Math.abs(Math.cos(ph)) * 0.022 - 0.012 : 0); bones.hips.rotation.y = w ? sn * 0.07 : 0; bones.spine.rotation.y = w ? -sn * 0.05 : 0; bones.chest.rotation.y = w ? -sn * 0.05 : 0; bones.chest.rotation.x = w ? 0.03 : 0;
    bones.head.rotation.set(w ? -0.03 : 0.0, w ? sn * 0.04 : 0.1, 0); bones.neck.rotation.x = 0.02; };
  root.userData.pose(0, 'idle');
  return root;
}
const mix = (a, b, t) => a + (b - a) * t;
