// Code-built Ghia Coupe ride (classic 1950s-60s sports coupe proportions). Front=+z, up=+y, metres.
// Real refs: L 4.14, W 1.634, H 1.32, wheelbase 2.40, track ~1.29, tyres 5.60-15 / 155R15 (Ø~0.63).
import * as THREE from 'three';
import { ghiaCage } from './cage.js';
const keys = (zs, ys) => { const n = zs.length, m = ys.map((_, i) => i === 0 ? (ys[1] - ys[0]) / (zs[1] - zs[0]) : i === n - 1 ? (ys[n - 1] - ys[n - 2]) / (zs[n - 1] - zs[n - 2]) : (ys[i + 1] - ys[i - 1]) / (zs[i + 1] - zs[i - 1]));
  return (z) => { if (z <= zs[0]) return ys[0]; for (let i = 1; i < n; i++) if (z <= zs[i]) { const h = zs[i] - zs[i - 1], t = (z - zs[i - 1]) / h, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * ys[i - 1] + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * ys[i] + (t3 - t2) * h * m[i]; } return ys[n - 1]; }; };
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const L = 4.14, ZF = L / 2, AXF = 1.27, AXR = -1.13, TRACK = 0.69;
const DROP = [0, 0.04, 0.08, -0.12, 0.06];
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function flakeShader(m) { m.onBeforeCompile = (sh) => {
  sh.vertexShader = 'varying vec3 vOP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
  sh.fragmentShader = 'varying vec3 vOP;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `
  { vec3 cell = floor(vOP * 520.); float h1 = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 fn = normalize(normal + (vec3(fract(h1 * 13.1), fract(h1 * 71.7), fract(h1 * 157.3)) - .5) * 0.9);
    vec3 V = normalize(vViewPosition); float sp = pow(max(0., dot(reflect(-V, fn), normalize(vec3(0.35, 0.85, 0.4)))), 80.) * step(0.55, h1);
    gl_FragColor.rgb += sp * 0.9 * vec3(1., .97, .9); }
  #include <dithering_fragment>`); }; m.customProgramCacheKey = () => 'flake'; }
export function paintMaterial(spec, studio) {
  const c = new THREE.Color(spec.c1); const P = (o) => new THREE.MeshPhysicalMaterial({ color: c, ...o });
  const m = { solid: () => P({ roughness: 0.34, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 }), metallic: () => P({ roughness: 0.28, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.05 }),
    flake: () => P({ roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.02 }), candy: () => P({ roughness: 0.14, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.25 }),
    two: () => P({ roughness: 0.34, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06 }), patina: () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.88 }) }[spec.paint]();
  if (studio && (spec.paint === 'flake' || spec.paint === 'metallic' || spec.paint === 'candy')) flakeShader(m);
  return m;
}
export const MAT = {
  chrome: new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.04, metalness: 1 }),
  polished: new THREE.MeshStandardMaterial({ color: '#eef0f3', roughness: 0.08, metalness: 1 }),
  anod: new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.45, metalness: 0.5 }),
  black: new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.6 }),
  gap: new THREE.MeshBasicMaterial({ color: '#030405', side: THREE.DoubleSide }),
  rubber: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.7, side: THREE.DoubleSide }),
  tire: new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.88 }),
  wall: new THREE.MeshStandardMaterial({ color: '#2a2b2f', roughness: 0.8 }),
  drum: new THREE.MeshStandardMaterial({ color: '#3a3b3e', roughness: 0.7, metalness: 0.6 }),
  liner: new THREE.MeshStandardMaterial({ color: '#060607', roughness: 1, side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#16222b', roughness: 0.0, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.6, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  lens: new THREE.MeshPhysicalMaterial({ color: '#fffaf0', roughness: 0.04, emissive: '#fff4d0', emissiveIntensity: 0.25, clearcoat: 1, transmission: 0 }),
  reflector: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 1 }),
  tail: new THREE.MeshPhysicalMaterial({ color: '#a50f19', roughness: 0.12, emissive: '#5a0006', emissiveIntensity: 0.6, clearcoat: 1 }),
  leather: new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.6 }),
  ivory: new THREE.MeshStandardMaterial({ color: '#e8e0c8', roughness: 0.35 }),
  gold: new THREE.MeshStandardMaterial({ color: '#ffd76a', roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide }),
  white: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, side: THREE.DoubleSide }),
  flameO: new THREE.MeshPhysicalMaterial({ color: '#ff4d00', roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide }),
  flameY: new THREE.MeshPhysicalMaterial({ color: '#ffc300', roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide }),
};
function grid(nu, nv, f) {
  const pos = [], idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) pos.push(...f(i / nu, j / nv));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
export function buildGhia(spec, { studio = false, lod = 0 } = {}) {
  const full = lod === 0;
  const drop = DROP[spec.stance] || 0, wr = 0.315, ra = wr + (spec.stance === 2 || spec.stance === 4 ? 0.04 : spec.stance === 1 ? 0.06 : 0.09);
  const D = (a) => a.map((y) => y - drop);
  const C = ghiaCage({ drop, full, arches: [AXF, AXR], ra, wr }); const { ytop, ybot, hwk } = C;
  const paint = paintMaterial(spec, studio), paint2 = spec.c2 ? paintMaterial({ ...spec, c1: spec.c2 }, studio) : paint;
  const car = new THREE.Group(); const body = new THREE.Group(); car.add(body);
  const add = (geo, mat, parent = body, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m; };
  const arches = [AXF, AXR];
  const bodyMesh = add(C.geometry, paint);
  for (const az of arches) for (const lx of [-0.56, 0.56]) { const m = add(new THREE.CylinderGeometry(ra - 0.01, ra - 0.01, 0.36, full ? 24 : 12, 1, true, 0, Math.PI), MAT.liner); m.rotation.z = Math.PI / 2; m.position.set(lx, wr, az); }
  // greenhouse
  const roof = C.roof; const cabMesh = bodyMesh;
  // ---- projection helpers ----
  const rc = new THREE.Raycaster(), skin = [bodyMesh, cabMesh];
  const hit = (o, d) => { rc.set(o, d); const h = rc.intersectObjects(skin, false)[0]; if (!h) return null; const n = h.face.normal.clone(); if (n.dot(d) > 0) n.negate(); return { p: h.point.clone(), n }; };
  const side = (z, y, s) => { const h = hit(V3(s * 3, y, z), V3(-s, 0, 0)); return h && Math.abs(h.p.x) > 0.3 ? h : null; };
  const front = (x, y, s = 1) => hit(V3(x, y, s * 4), V3(0, 0, -s));
  const topd = (x, z) => hit(V3(x, 3, z), V3(0, -1, 0));
  const strip = (n, fa, fb, mat, eps = 0.004, shadow = false) => { const pos = [], idx = []; let prev = -1;
    for (let i = 0; i <= n; i++) { const A = fa(i / n), B = fb(i / n); if (!A || !B) { prev = -1; continue; }
      const k = pos.length / 3; pos.push(...A.p.addScaledVector(A.n, eps).toArray(), ...B.p.addScaledVector(B.n, eps).toArray()); if (prev >= 0) idx.push(prev, prev + 1, k, prev + 1, k + 1, k); prev = k; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return add(g, mat, body, shadow); };
  const ribbon = (pts, s, mat, eps = 0.004) => strip(pts.length - 1, (t) => { const [z, y, w] = pts[Math.round(t * (pts.length - 1))]; return side(z, y + w / 2, s); }, (t) => { const [z, y, w] = pts[Math.round(t * (pts.length - 1))]; return side(z, y - w / 2, s); }, mat, eps);
  const tubeOn = (hits, r, mat, out = 0, seg = 64) => { const pts = hits.filter(Boolean).map((h) => h.p.clone().addScaledVector(h.n, out)); if (pts.length < 2) return; return add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, full ? 8 : 5), mat); };
  const placeOn = (h, obj, out = 0, bias = V3(0, 0, 0)) => { const n = h.n.clone().add(bias).normalize(); obj.position.copy(h.p).addScaledVector(n, out); obj.lookAt(obj.position.clone().add(n)); body.add(obj); return obj; };
  const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; return o; };
  const Z = (a, b, n = 80) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const shoulder = (z) => C.crease(z) + 0.035;
  const patch = (proj, nu, nv, mat, eps) => { const pos = [], idx = [], ok = [], H = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const h = proj(i / nu, j / nv); H.push(h); ok.push(!!h); pos.push(...(h ? h.p.clone().addScaledVector(h.n, eps).toArray() : [0, 0, 0])); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; if (ok[a] && ok[b] && ok[a + 1] && ok[b + 1]) idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); add(g, mat, body, false);
    const at = (i, j) => H[i * (nv + 1) + j]; const border = [];
    for (let i = 0; i <= nu; i++) border.push(at(i, 0)); for (let j = 1; j <= nv; j++) border.push(at(nu, j)); for (let i = nu - 1; i >= 0; i--) border.push(at(i, nv)); for (let j = nv - 1; j >= 0; j--) border.push(at(0, j));
    return border; };
  // ---- interior (seen through tinted glass) ----
  if (full) { const yb = ybot(0) + 0.06, belt = ytop(0);
    const floor = mesh(new THREE.BoxGeometry(1.3, 0.04, 2.2), MAT.black); floor.position.set(0, yb, -0.35); body.add(floor);
    for (const sx of [-1, 1]) { const cush = mesh(new THREE.BoxGeometry(0.46, 0.12, 0.48), MAT.leather); cush.position.set(sx * 0.3, yb + 0.2, -0.2); body.add(cush);
      const back = mesh(new THREE.CapsuleGeometry(0.2, 0.22, 4, 10), MAT.leather); back.scale.set(1.1, 1.05, 0.38); back.position.set(sx * 0.3, belt - 0.06, -0.45); back.rotation.x = -0.22; body.add(back); }
    const bench = mesh(new THREE.BoxGeometry(1.0, 0.25, 0.3), MAT.leather); bench.position.set(0, belt - 0.12, -1.0); body.add(bench);
    const dash = mesh(new THREE.BoxGeometry(1.0, 0.12, 0.26), paint); dash.position.set(0, belt - 0.12, 0.36); body.add(dash);
    const dpad = mesh(new THREE.BoxGeometry(0.95, 0.03, 0.2), MAT.black); dpad.position.set(0, belt - 0.05, 0.34); body.add(dpad);
    for (const gx of [0.33, 0.18]) { const gauge = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 20).rotateX(Math.PI / 2), MAT.chrome); gauge.position.set(gx, belt - 0.11, 0.225); body.add(gauge); }
    const sw = new THREE.Group(); sw.add(mesh(new THREE.TorusGeometry(0.19, 0.014, 8, 40), MAT.ivory)); for (let i = 0; i < 2; i++) { const sp = mesh(new THREE.BoxGeometry(0.36, 0.02, 0.01), MAT.ivory); sp.rotation.z = i * 0.6 - 0.3; sw.add(sp); }
    sw.position.set(0.33, belt - 0.0, 0.1); sw.rotation.x = -0.45; body.add(sw);
    const col = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), MAT.black); col.position.set(0.33, belt - 0.0, 0.24); col.rotation.x = 1.1; body.add(col); }
  // ---- glass: side windows with quarter-light split, windscreen, rear screen; seals + chrome surrounds ----
  for (const s of [-1, 1]) {
    const lo = (z) => ytop(z) + 0.035, hiR = (z) => { const hi = roof(z) - 0.06, r = Math.min(1, (z + 1.0) / 0.32, (0.36 - z) / 0.12); return lo(z) + (hi - lo(z)) * Math.sqrt(Math.max(0, r)); };
    const zA = -1.0, zB = 0.36;
    patch((u, v) => { const z = zA + u * (zB - zA); return side(z, lo(z) + v * (hiR(z) - lo(z)), s); }, full ? 48 : 16, full ? 8 : 3, MAT.glass, 0.006);
    // chrome sill (belt) strip + rubber/chrome top surround + B-pillar divider
    strip(60, (t) => side(zA + t * (zB - zA), lo(zA + t * (zB - zA)) + 0.004, s), (t) => side(zA + t * (zB - zA), lo(zA + t * (zB - zA)) - 0.018, s), MAT.chrome, 0.009);
    if (full) { tubeOn(Z(zA + 0.02, zB - 0.02, 50).map((z) => side(z, hiR(z) + 0.004, s)), 0.006, MAT.chrome, 0.008);
      strip(12, (t) => side(-0.5 + 0.02, lo(-0.5) + t * (hiR(-0.5) - lo(-0.5)), s), (t) => side(-0.5 - 0.02, lo(-0.5) + t * (hiR(-0.5) - lo(-0.5)), s), MAT.chrome, 0.011);
      strip(12, (t) => side(0.12 + 0.012, lo(0.12) + t * (hiR(0.12) - lo(0.12)) * 0.97, s), (t) => side(0.12 - 0.012, lo(0.12) + t * (hiR(0.12) - lo(0.12)) * 0.97, s), MAT.chrome, 0.011); }
  }
  const wsB = patch((u, v) => { const y0 = ytop(0.84) + 0.05, y = y0 + v * (roof(0.24) - y0 - 0.06); const w = 0.47 - 0.13 * v; const h = front((u - 0.5) * 2 * w, y); return h && h.p.z < 0.84 && h.n.y > 0.2 && h.n.z > 0.2 ? h : null; }, full ? 24 : 8, full ? 12 : 4, MAT.glass, 0.006);
  const rwB = patch((u, v) => { const y = ytop(-1.55) + 0.05 + v * 0.27; const w = 0.34 - 0.1 * v; const h = front((u - 0.5) * 2 * w, y, -1); return h && h.p.z > -1.8 && h.p.z < -0.9 ? h : null; }, full ? 18 : 6, full ? 10 : 3, MAT.glass, 0.006);
  if (full) { tubeOn([...wsB, wsB[0]], 0.009, MAT.rubber, 0.006, 120); tubeOn([...wsB, wsB[0]], 0.004, MAT.chrome, 0.011, 120); tubeOn([...rwB, rwB[0]], 0.009, MAT.rubber, 0.006, 100); tubeOn([...rwB, rwB[0]], 0.004, MAT.chrome, 0.011, 100); }
  // wipers
  if (full) for (const wx of [-0.32, 0.12]) { const a = front(wx, ytop(0.75) + 0.06), b = front(wx + 0.38, ytop(0.75) + 0.1); if (a && b) { const arm = mesh(new THREE.BoxGeometry(1, 0.012, 0.008), MAT.black); arm.scale.x = a.p.distanceTo(b.p); arm.position.copy(a.p).add(b.p).multiplyScalar(0.5).addScaledVector(a.n, 0.018); arm.lookAt(arm.position.clone().add(a.n)); arm.rotateZ(-Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x) * 0 - 0.12); body.add(arm); } }
  // ---- panel gaps: doors, bonnet, deck lid ----
  const gw = 0.0035;
  for (const s of [-1, 1]) for (const dz of [0.8, -0.52]) strip(20, (t) => side(dz + gw, ybot(dz) + 0.05 + t * (ytop(dz) - ybot(dz) - 0.06), s), (t) => side(dz - gw, ybot(dz) + 0.05 + t * (ytop(dz) - ybot(dz) - 0.06), s), MAT.gap, 0.002);
  for (const s of [-1, 1]) strip(30, (t) => side(-0.52 + t * 1.32, ybot(0) + 0.05 + gw, s), (t) => side(-0.52 + t * 1.32, ybot(0) + 0.05 - gw, s), MAT.gap, 0.002);
  const topGap = (poly) => { const n = poly.length; const P = (i) => poly[(i + n) % n];
    strip(n, (t) => { const i = Math.round(t * n), a = P(i - 1), b = P(i + 1), c = P(i); const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return topd(c[0] - dz / l * gw, c[1] + dx / l * gw); },
      (t) => { const i = Math.round(t * n), a = P(i - 1), b = P(i + 1), c = P(i); const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return topd(c[0] + dz / l * gw, c[1] - dx / l * gw); }, MAT.gap, 0.002); };
  const outline = (f, n = 60) => Array.from({ length: n }, (_, i) => f(i / n * Math.PI * 2));
  if (window.NOHOOD) {} else topGap(outline((a) => { const c = Math.cos(a), s = Math.sin(a); const z = 1.36 + 0.5 * spow(s, 0.5); const w = 0.44 - 0.16 * Math.max(0, s); return [w * spow(c, 0.45), z]; }));
  topGap(outline((a) => [0.42 * spow(Math.cos(a), 0.4), -1.62 + 0.28 * spow(Math.sin(a), 0.4)]));
  // deck-lid louvres
  for (const lx of [-0.14, 0.14]) for (let i = 0; i < (full ? 7 : 4); i++) { const h = topd(lx, -1.5 + i * 0.045); if (h) placeOn(h, mesh(new THREE.BoxGeometry(0.2, 0.012, 0.01), MAT.chrome), 0.004); }
  // ---- crease (beltline bead) ----
  // crease is in the cage itself (doubled row); sculpted arch lips + rain gutter
  for (const s of [-1, 1]) { for (const az of [AXF, AXR]) tubeOn(Array.from({ length: 25 }, (_, i) => { const a = Math.PI * (0.08 + 0.84 * i / 24), r = ra + 0.012; return side(az + Math.cos(a) * r, wr + Math.sin(a) * r, s); }), 0.014, paint, 0.002, 48);
    if (full) tubeOn(Z(-1.02, 0.5, 40).map((z) => side(z, C.top(z) - 0.068, s)), 0.006, MAT.chrome, 0.004, 60); }
  // ---- lights, nostrils, badge ----
  for (const s of [-1, 1]) {
    const h = front(s * 0.56, 0.66 - drop); if (h) { const g = new THREE.Group(); g.add(mesh(new THREE.TorusGeometry(0.092, 0.017, 10, 36), MAT.chrome)); { const cup = mesh(new THREE.CylinderGeometry(0.1, 0.108, 0.04, 36, 1, true).rotateX(Math.PI / 2), MAT.chrome); cup.position.z = -0.02; g.add(cup); const pod = mesh(new THREE.CylinderGeometry(0.112, 0.15, 0.2, 36, 1, false).rotateX(Math.PI / 2), paint); pod.position.z = -0.12; g.add(pod); } const bowl = mesh(new THREE.SphereGeometry(0.085, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.reflector); bowl.rotation.x = -Math.PI / 2; bowl.scale.y = 0.5; bowl.position.z = -0.01; g.add(bowl);
      const lens = mesh(new THREE.SphereGeometry(0.088, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.lens);  lens.rotation.x = Math.PI / 2; lens.scale.y = 0.3; g.add(lens); placeOn(h, g, 0.02, V3(0, 0, 2.2)); }
    const t = front(s * 0.5, 0.62 - drop, -1); if (t) { const tl = mesh(new THREE.SphereGeometry(0.075, 18, 10), MAT.tail); tl.scale.set(0.6, 1.2, 0.3); const tg = new THREE.Group(); tg.add(tl); const ring = mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 24), MAT.chrome); ring.scale.set(0.6, 1.2, 1); tg.add(ring); placeOn(t, tg, 0.0, V3(0, 0, -0.6)); }
    const gr = front(s * 0.29, 0.47 - drop); if (gr) { const g = new THREE.Group(); const o = mesh(new THREE.TorusGeometry(0.075, 0.011, 8, 28), MAT.chrome); o.scale.set(1.5, 0.5, 1); g.add(o); const b = mesh(new THREE.CircleGeometry(0.075, 24), MAT.anod); b.scale.set(1.5, 0.5, 1); b.position.z = -0.004; g.add(b);
      for (let i = -2; i <= 2; i++) { const bar = mesh(new THREE.BoxGeometry(0.21 * Math.sqrt(1 - (i / 3) ** 2), 0.006, 0.01), MAT.chrome); bar.position.y = i * 0.012; g.add(bar); } placeOn(gr, g, 0.006, V3(0, 0.15, 0)); g.rotateZ(s * 0.1); }
  }
  { // no manufacturer badge (trademark)
    }
  // ---- chunky bumpers + overriders ----
  for (const s of [1, -1]) { const y = (s > 0 ? 0.3 : 0.38) - drop, pts = [];
    for (let x = -0.79; x <= 0.791; x += 0.04) { const h = front(x, y + 0.03, s); if (h && Math.abs(h.p.z) > 1.78) pts.push(V3(x, y, h.p.z + s * 0.055)); }
    if (pts.length > 3) { const e0 = pts[0], e1 = pts[pts.length - 1]; pts.unshift(V3(e0.x + 0.03, y, e0.z - s * 0.1)); pts.push(V3(e1.x - 0.03, y, e1.z - s * 0.1));
      const blade = mesh(s > 0 && spec.lip ? new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => V3(p.x, y - 0.035, p.z - 0.04))), 80, 0.03, 8) : new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), full ? 80 : 24, 0.04, full ? 12 : 6), s > 0 && spec.lip ? MAT.anod : MAT.chrome); blade.geometry.translate(0, -y, 0); blade.scale.y = s > 0 && spec.lip ? 0.55 : 1.25; if (s > 0) blade.scale.x = 1.0; blade.position.y = y; body.add(blade);
      for (const ox of (s > 0 && spec.lip ? [] : [-0.36, 0.36])) { const p = pts.reduce((a, b) => Math.abs(b.x - ox) < Math.abs(a.x - ox) ? b : a); const o = mesh(new THREE.CapsuleGeometry(0.032, 0.13, 6, 12), MAT.chrome); o.scale.z = 0.8; o.position.set(p.x, y + 0.05, p.z + s * 0.02); o.rotation.x = s * 0.12; body.add(o); }
      if (s > 0) { const pl = mesh(new THREE.PlaneGeometry(0.36, 0.12), plateMat(spec.plate)); pl.position.set(0, y - 0.115, pts[Math.floor(pts.length / 2)].z + 0.03); body.add(pl); }
      else { const ph = front(0, y + 0.17, -1); if (ph) placeOn(ph, mesh(new THREE.PlaneGeometry(0.4, 0.13), plateMat(spec.plate)), 0.008); } } }
  // ---- door handles, mirrors ----
  for (const s of [-1, 1]) {
    const dh = side(-0.4, ytop(-0.4) - 0.07, s); if (dh) { const hd = mesh(new THREE.CapsuleGeometry(0.012, 0.11, 4, 8), MAT.chrome); hd.rotation.z = Math.PI / 2; const g = new THREE.Group(); hd.rotation.set(0, Math.PI / 2, 0); g.add(hd); placeOn(dh, g, 0.012); }
    const mh = side(0.68, ytop(0.68) - 0.03, s); if (mh && full) { const g = new THREE.Group(); const stalk = mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.09, 8), MAT.chrome); stalk.rotation.x = Math.PI / 2; stalk.position.z = 0.045; g.add(stalk);
      const head = mesh(new THREE.SphereGeometry(0.05, 16, 10), MAT.chrome); head.scale.set(1.1, 0.8, 0.5); head.position.z = 0.1; g.add(head); placeOn(mh, g, 0, V3(0, 1.2, 0)); }
  }
  // ---- exhaust (twin tips under rear valance) ----
  for (const ex of [-0.33, 0.33]) { const p = mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.3, full ? 16 : 8, 1, true).rotateX(Math.PI / 2), MAT.chrome); p.material = MAT.chrome; p.position.set(ex, ybot(-1.9) - 0.05, -1.98); body.add(p);
    if (full) { const inner = mesh(new THREE.CircleGeometry(0.024, 12), MAT.black); inner.position.set(ex, ybot(-1.9) - 0.05, -2.12); inner.rotation.y = Math.PI; body.add(inner); } }
  // ---- extras (trait bits) ----
  const E = spec.extras || 0, has = (i) => !!(E & (1 << i));
  for (const s of [-1, 1]) {
    if (has(2)) { ribbon(Z(-1.85, 1.62).map((z) => [z, shoulder(z) - 0.03, 0.012]), s, MAT.gold, 0.005); ribbon(Z(-1.78, 1.58).map((z) => [z, shoulder(z) - 0.052, 0.006]), s, MAT.white, 0.005); }
    if (has(7)) ribbon(Z(-0.68, 0.84, 40).map((z) => [z, ybot(z) + 0.09, 0.028]), s, MAT.chrome, 0.006);
    if (has(8)) { const tongues = [[0.47, 1.2, 0.11, 0], [0.39, 0.95, 0.09, 1.3], [0.55, 1.05, 0.08, 2.1], [0.32, 0.7, 0.07, 0.7], [0.6, 0.65, 0.06, 2.8]];
      const z0 = AXF - ra - 0.06; // start behind the front arch lip
      for (const [y0, len, w, ph] of tongues) { const yy = y0 - drop; const path = (k) => Z(z0, z0 - len, 50).map((z, i, a) => { const t = i / (a.length - 1); const ramp = Math.min(1, t * 8); return [z, yy + 0.035 * Math.sin(t * 7 + ph) * t, w * k * Math.pow(1 - t, 0.8) * (0.25 + 0.75 * ramp)]; });
        ribbon(path(1), s, MAT.flameO, 0.006); ribbon(path(0.5), s, MAT.flameY, 0.008); } }
  }
  // ---- wheels + drums ----
  for (const sx of [-1, 1]) for (const az of arches) { const w = wheel(spec.wheels, wr, full); w.position.set(sx * TRACK, wr, az); w.rotation.y = sx * Math.PI / 2; car.add(w); }
  { const u = mesh(new THREE.BoxGeometry(1.0, 0.04, 3.0), MAT.black); u.position.set(0, ybot(0) + 0.08, -0.05); body.add(u); }
  car.userData = { body }; return car;
}
let plates = {};
function plateMat(kind) { if (plates[kind]) return plates[kind]; const cv = document.createElement('canvas'); cv.width = 256; cv.height = 84; const x = cv.getContext('2d');
  x.fillStyle = kind === 1 ? '#d9dee6' : kind === 2 ? '#e8f7ff' : '#f2efe4'; x.fillRect(0, 0, 256, 84); x.strokeStyle = '#1d3557'; x.lineWidth = 6; x.strokeRect(4, 4, 248, 76);
  x.fillStyle = '#1d3557'; x.font = '900 46px Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('VWFEST', 128, 48); x.font = '700 13px Arial'; x.fillText('CALIFORNIA · SHOW GROUNDS', 128, 15);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return (plates[kind] = new THREE.MeshStandardMaterial({ map: t, metalness: kind === 1 ? 0.6 : 0, roughness: 0.3 })); }
// Wheel: axle = local +Z, outer face toward +Z. 155R15-ish tyre (r 0.315), 15" rim (r ~0.19).
export function wheel(type, r, full = true) {
  const g = new THREE.Group(), W = 0.16, m = (geo, mat) => { const o = new THREE.Mesh(geo, mat); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  const rim = 0.19, seg = full ? 56 : 24, prof = [];
  const steps = full ? 22 : 10; for (let i = 0; i <= steps; i++) { const t = i / steps, a = -Math.PI / 2 + t * Math.PI; const bulge = Math.cos(a); prof.push(new THREE.Vector2(rim + 0.01 + (r - rim - 0.01) * (0.55 + 0.45 * Math.pow(bulge, 0.35)), Math.sin(a) * W / 2 * (0.92 + 0.08 * bulge))); }
  m(new THREE.LatheGeometry([new THREE.Vector2(rim, -W / 2 + 0.012), ...prof, new THREE.Vector2(rim, W / 2 - 0.012)], seg).rotateX(Math.PI / 2), MAT.tire);
  if (full) { for (const k of [-1, 1]) for (let i = 0; i < 3; i++) { const gro = m(new THREE.TorusGeometry(r - 0.001, 0.004, 4, seg), MAT.black); gro.position.z = k * (0.022 + i * 0.022) - 0.0; gro.scale.set(1, 1, 1); }
    m(new THREE.TorusGeometry(rim + 0.06, 0.0035, 4, seg), MAT.wall).position.z = W / 2 - 0.006;
    for (let i = 0; i < 28; i++) { if (i % 14 > 9) continue; const a = i / 28 * Math.PI * 2; const l = m(new THREE.BoxGeometry(0.012, 0.018, 0.004), MAT.wall); l.position.set(Math.cos(a) * (rim + 0.085), Math.sin(a) * (rim + 0.085), W / 2 - 0.004); l.rotation.z = a + Math.PI / 2; } }
  m(new THREE.CylinderGeometry(rim, rim, W - 0.02, full ? 40 : 16, 1, true).rotateX(Math.PI / 2), MAT.polished);
  m(new THREE.TorusGeometry(rim, 0.011, 8, full ? 48 : 16), MAT.polished).position.z = W / 2 - 0.012;
  const drum = m(new THREE.CylinderGeometry(0.15, 0.15, 0.08, full ? 28 : 12).rotateX(Math.PI / 2), MAT.drum); drum.position.z = -0.04;
  if (full) for (let i = 0; i < 16; i++) { const f = m(new THREE.BoxGeometry(0.008, 0.03, 0.07), MAT.drum); const a = i / 16 * Math.PI * 2; f.position.set(Math.cos(a) * 0.155, Math.sin(a) * 0.155, -0.04); f.rotation.z = a; }
  if (type === 2) { // 5-petal forged style: polished forged petals, black-anodised recesses, open slots to the drum
    const face = m(new THREE.RingGeometry(0.135, rim, full ? 40 : 16), MAT.anod); face.position.z = W / 2 - 0.03;
    const hubD = m(new THREE.CircleGeometry(0.075, 24), MAT.anod); hubD.position.z = W / 2 - 0.03;
    const sh = new THREE.Shape(); const n = 5, a0 = 0.3, a1 = 0.2; sh.moveTo(0.06, 0);
    for (let i = 0; i < n; i++) { const c = i / n * Math.PI * 2; sh.lineTo(Math.cos(c - a1) * 0.065, Math.sin(c - a1) * 0.065); sh.lineTo(Math.cos(c - a0) * rim * 0.97, Math.sin(c - a0) * rim * 0.97); sh.absarc(0, 0, rim * 0.97, c - a0, c + a0); sh.lineTo(Math.cos(c + a1) * 0.065, Math.sin(c + a1) * 0.065); }
    const sp = m(new THREE.ExtrudeGeometry(sh, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: full ? 3 : 1, curveSegments: full ? 8 : 3 }), MAT.polished); sp.position.z = W / 2 - 0.035;
  } else { const face = m(new THREE.CircleGeometry(rim, 24), MAT.anod); face.position.z = W / 2 - 0.03; for (let i = 0; i < 5; i++) { const b = m(new THREE.BoxGeometry(0.04, rim * 1.8, 0.02), MAT.polished); b.rotation.z = i * Math.PI / 5; b.position.z = W / 2 - 0.02; } }
  m(new THREE.CylinderGeometry(0.048, 0.055, 0.03, 24).rotateX(Math.PI / 2), MAT.chrome).position.z = W / 2 - 0.005;
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + Math.PI / 5; const l = m(new THREE.CylinderGeometry(0.01, 0.01, 0.02, 6).rotateX(Math.PI / 2), MAT.chrome); l.position.set(Math.cos(a) * 0.072, Math.sin(a) * 0.072, W / 2 - 0.012); }
  return g;
}
