// Code-built "Wagon" (late-60s rear-engine squareback estate). Cage set by eye from published dims:
// L 4.22, W 1.605, H 1.47, wheelbase 2.40, track ~1.31, tyres 165-15 (dia ~0.62). Front=+z, metres.
import * as THREE from 'three';
import { V3, keys, DROP, MAT, cageSurface, ring, kit, plateMat, paintMaterial, wheel } from './common.js';
const ZF = 2.11, AXF = 1.21, AXR = -1.19, TRACK = 0.655;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const yb = keys([-2.11, -1.85, -1.2, 0, 1.2, 1.85, 2.11], [0.42, 0.33, 0.26, 0.25, 0.26, 0.33, 0.4]);
const hood = keys([-2.11, 0.9, 1.3, 1.8, 2.11], [0.89, 0.89, 0.87, 0.8, 0.68]);
const roof = keys([-2.11, -2.0, -1.8, -1.0, 0.2, 0.42, 0.7, 0.98], [1.3, 1.42, 1.455, 1.465, 1.46, 1.42, 1.17, 0.9]);
const wmax = keys([-2.11, -1.7, -1.0, 0, 1.0, 1.7, 2.11], [0.74, 0.795, 0.802, 0.8, 0.802, 0.79, 0.72]);
export const BELT = 0.88;
function stations(drop) {
  const half = (z) => { const b = yb(z), w = wmax(z), h = hood(z), r = Math.max(roof(z), h + 0.02), cf = ss(0.98, 0.72, z);
    const lerp = (a, c) => [a[0] + (c[0] - a[0]) * cf, a[1] + (c[1] - a[1]) * cf];
    const up = [lerp([w * 0.86, h + 0.012], [w - 0.11, BELT + 0.05]), lerp([w * 0.62, h + 0.02], [w - 0.2 - 0.06 * ss(0.1, 0.6, z), r - 0.1]), lerp([w * 0.32, h + 0.026], [w - 0.33 - 0.05 * ss(0.1, 0.6, z), r - 0.015])];
    return [[0, b], [0.62 * w, b], [w - 0.03, b + 0.03], [w, 0.52], [w + 0.004, 0.79], [w + 0.006, 0.815], [w - 0.012, BELT], ...up, [0, (h + 0.028) * (1 - cf) + r * cf]]; };
  const fz = (z) => (x, y) => { const ef = ss(1.6, ZF, z), er = ss(-1.75, -ZF, z), u = (x / 0.8) ** 2;
    return z - ef * (0.2 * u + Math.max(0, 0.55 - y) * 0.25) + er * (0.06 * u + Math.max(0, y - 0.95) * 0.14 + Math.max(0, 0.5 - y) * 0.15); };
  const S = [], endRing = (z, k) => ring(half(z).map(([x, y, c]) => [x * k, y, c]), z, fz(z));
  for (const k of [0, 0.5, 0.87]) S.push(endRing(-ZF, k));
  for (let z = -1.96; z <= 1.961; z += 0.151) S.push(ring(half(z), z, fz(z)));
  for (const k of [0.87, 0.5, 0]) S.push(endRing(ZF, k));
  return S.map((r) => r.map((p) => { p.y -= drop; return p; }));
}
export function buildWagon(spec, { studio = false, lod = 0 } = {}) {
  const full = lod === 0, drop = DROP[spec.stance] || 0, wr = 0.31, ra = wr + (spec.stance === 2 || spec.stance === 4 ? 0.035 : spec.stance === 1 ? 0.055 : 0.08);
  const car = new THREE.Group(), body = new THREE.Group(); car.add(body);
  const K = kit(body, full), { add, side, front, topd, strip, patch, tubeOn, placeOn, mesh, Z, sideWin, gapV, gapH } = K;
  const paint = paintMaterial(spec, studio);
  K.setSkin([add(cageSurface(stations(drop), { full, arches: [AXF, AXR], ra, wr, ax: 0.48 }), paint)]);
  const B = (y) => y - drop;
  for (const az of [AXF, AXR]) for (const lx of [-0.6, 0.6]) { const m = add(new THREE.CylinderGeometry(ra - 0.01, ra - 0.01, 0.4, full ? 24 : 12, 1, true, 0, Math.PI), MAT.liner); m.rotation.z = Math.PI / 2; m.position.set(lx, wr, az); }
  if (full) { const f = B(0.36); const floor = mesh(new THREE.BoxGeometry(1.4, 0.04, 3.2), MAT.black); floor.position.set(0, f, -0.3); body.add(floor);
    for (const sx of [-0.34, 0.34]) { const c = mesh(new THREE.BoxGeometry(0.5, 0.12, 0.48), MAT.leather); c.position.set(sx, B(0.55), 0.05); body.add(c); const bk = mesh(new THREE.BoxGeometry(0.5, 0.55, 0.1), MAT.leather); bk.position.set(sx, B(0.86), -0.22); bk.rotation.x = -0.2; body.add(bk); }
    const rb = mesh(new THREE.BoxGeometry(1.3, 0.5, 0.12), MAT.leather); rb.position.set(0, B(0.8), -0.95); rb.rotation.x = -0.2; body.add(rb);
    const dash = mesh(new THREE.BoxGeometry(1.4, 0.14, 0.3), MAT.black); dash.position.set(0, B(0.86), 0.72); body.add(dash);
    const sw = mesh(new THREE.TorusGeometry(0.19, 0.014, 8, 40), MAT.black); sw.position.set(0.34, B(0.92), 0.5); sw.rotation.x = -0.75; body.add(sw); }
  // ---- glass ----
  const top = (z) => B(roof(z));
  for (const s of [-1, 1]) {
    patch((u, v) => { const z = -0.05 + u * 0.9, lo = B(BELT + 0.04), hi = Math.min(top(z) - 0.075, B(1.39)); const r = Math.min(1, (z + 0.05) / 0.06, (0.85 - z) / 0.04); return z < 0.85 && hi > lo ? side(z, lo + v * (hi - lo) * Math.sqrt(Math.max(0.02, r)), s) : null; }, full ? 30 : 10, full ? 6 : 3, MAT.glass, 0.005);
    sideWin(s, -1.02, -0.16, B(BELT + 0.04), B(1.39), 0.05); sideWin(s, -1.82, -1.12, B(BELT + 0.04), B(1.39), 0.1);
    if (full) { tubeOn(Z(-0.05, 0.86, 30).map((z) => side(z, Math.min(top(z) - 0.07, B(1.395)), s)), 0.009, MAT.chrome, 0.004, 40);
      tubeOn(Z(-1.85, 0.85, 50).map((z) => side(z, B(BELT + 0.03), s)), 0.008, MAT.chrome, 0.006, 60); }
  }
  patch((u, v) => { const x = -0.56 + u * 1.12, y = B(BELT + 0.07) + v * 0.48; return Math.abs(x) * 0.35 + y < B(1.6) ? front(x, y) : null; }, full ? 24 : 8, full ? 10 : 4, MAT.glass, 0.004);
  if (full) for (const x of [-0.58, 0.58]) tubeOn(Z(0, 1, 12).map((t) => front(x * (1 - 0.06 * t), B(BELT + 0.06) + t * 0.42)), 0.012, MAT.rubber, 0.003, 16);
  patch((u, v) => front(-0.6 + u * 1.2, B(1.0) + v * 0.34, -1), full ? 14 : 5, full ? 5 : 2, MAT.glass, 0.004);
  if (full) for (const wx of [-0.44, 0.12]) { const a = front(wx, B(BELT + 0.1)), b = front(wx + 0.38, B(BELT + 0.15)); if (a && b) { const arm = mesh(new THREE.BoxGeometry(1, 0.012, 0.008), MAT.black); arm.scale.x = a.p.distanceTo(b.p); arm.position.copy(a.p).add(b.p).multiplyScalar(0.5).addScaledVector(a.n, 0.015); arm.lookAt(arm.position.clone().add(a.n)); arm.rotateZ(-Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x)); body.add(arm); } }
  // ---- panel cuts: doors, front lid, rear hatch, engine lid ----
  for (const s of [-1, 1]) { gapV(s, 0.9, B(0.32), B(BELT - 0.01)); gapV(s, -0.1, B(0.32), B(BELT - 0.01)); gapH(s, B(0.32), -0.1, 0.9);
    strip(30, (t) => topd(s * (0.6 + 0.003), 1.0 + t * 1.0), (t) => topd(s * (0.6 - 0.003), 1.0 + t * 1.0), MAT.gap, 0.002);
    for (let i = 0; i < (full ? 6 : 3); i++) strip(8, (t) => side(-1.62 + t * 0.26, B(0.55) + i * 0.035, s), (t) => side(-1.62 + t * 0.26, B(0.55) + i * 0.035 + 0.014, s), MAT.gap, 0.003); }
  strip(30, (t) => topd(-0.6 + t * 1.2, 1.0 + 0.003), (t) => topd(-0.6 + t * 1.2, 1.0 - 0.003), MAT.gap, 0.002);
  for (const y of [B(0.93), B(0.6)]) strip(30, (t) => front(-0.68 + t * 1.36, y, -1), (t) => front(-0.68 + t * 1.36, y - 0.005, -1), MAT.gap, 0.003);
  for (const x of [-0.68, 0.68]) strip(10, (t) => front(x + 0.003, B(0.6) + t * 0.85, -1), (t) => front(x - 0.003, B(0.6) + t * 0.85, -1), MAT.gap, 0.003);
  // ---- arch lips, rain gutter ----
  for (const s of [-1, 1]) { for (const az of [AXF, AXR]) tubeOn(Array.from({ length: 25 }, (_, i) => { const a = Math.PI * (0.06 + 0.88 * i / 24), r = ra + 0.012; return side(az + Math.cos(a) * r, wr + Math.sin(a) * r, s); }), 0.013, paint, 0.002, 40);
    if (full) tubeOn(Z(-1.95, 0.4, 40).map((z) => side(z, top(z) - 0.035, s)), 0.008, MAT.chrome, 0.003, 50); }
  // ---- lights + front horn grilles ----
  for (const s of [-1, 1]) {
    const h = front(s * 0.58, B(0.66)); if (h) { const g = new THREE.Group(); g.add(mesh(new THREE.TorusGeometry(0.088, 0.015, 10, 36), MAT.chrome)); const pod = mesh(new THREE.CylinderGeometry(0.095, 0.13, 0.12, 36, 1, true).rotateX(Math.PI / 2), paint); pod.position.z = -0.05; g.add(pod);
      const lens = mesh(new THREE.SphereGeometry(0.085, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.lens); lens.rotation.x = Math.PI / 2; lens.scale.y = 0.3; g.add(lens); placeOn(h, g, 0.02, V3(0, 0, 1.5)); }
    const ti = front(s * 0.66, B(0.47)); if (ti) placeOn(ti, mesh(new THREE.BoxGeometry(0.13, 0.05, 0.03), MAT.amber), 0.01);
    const gr = front(s * 0.27, B(0.5)); if (gr) { const g = new THREE.Group(); for (let i = 0; i < 4; i++) { const bar = mesh(new THREE.BoxGeometry(0.2, 0.008, 0.01), MAT.chrome); bar.position.y = (i - 1.5) * 0.02; g.add(bar); } placeOn(gr, g, 0.006); }
    const tl = front(s * 0.66, B(0.74), -1); if (tl) { const g = new THREE.Group(); const l = mesh(new THREE.BoxGeometry(0.13, 0.24, 0.03), MAT.tail); g.add(l); const a = mesh(new THREE.BoxGeometry(0.13, 0.06, 0.032), MAT.amber); a.position.y = 0.1; g.add(a); placeOn(tl, g, 0.01); }
  }
  // ---- bumpers + overriders + plates ----
  for (const s of [1, -1]) { const y = B(0.38), pts = [];
    for (let x = -0.8; x <= 0.801; x += 0.05) { const h = front(x, y + 0.02, s); if (h && Math.abs(h.p.z) > 1.75) pts.push(V3(x, y, h.p.z + s * 0.06)); }
    if (pts.length > 3) { const e0 = pts[0], e1 = pts[pts.length - 1]; pts.unshift(V3(e0.x + 0.03, y, e0.z - s * 0.12)); pts.push(V3(e1.x - 0.03, y, e1.z - s * 0.12));
      const bl = add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), full ? 60 : 20, 0.04, full ? 10 : 5), MAT.chrome); bl.geometry.translate(0, -y, 0); bl.scale.y = 1.25; bl.position.y = y;
      for (const ox of [-0.4, 0.4]) { const p = pts.reduce((a, b) => Math.abs(b.x - ox) < Math.abs(a.x - ox) ? b : a); const o = mesh(new THREE.CapsuleGeometry(0.03, 0.12, 6, 10), MAT.chrome); o.position.set(p.x, y + 0.04, p.z + s * 0.02); body.add(o); } }
    const ph = front(0, y + (s > 0 ? 0.16 : 0.2), s); if (ph) placeOn(ph, mesh(new THREE.PlaneGeometry(0.36, 0.12), plateMat(spec.plate)), 0.008); }
  for (const s of [-1, 1]) { const dh = side(0.0, B(0.8), s); if (dh) { const hd = mesh(new THREE.CapsuleGeometry(0.012, 0.1, 4, 8), MAT.chrome); hd.rotation.set(0, Math.PI / 2, 0); const g = new THREE.Group(); g.add(hd); placeOn(dh, g, 0.012); }
    const mh = side(0.8, B(0.9), s); if (mh && full) { const g = new THREE.Group(); const st = mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.09, 8), MAT.chrome); st.rotation.x = Math.PI / 2; st.position.z = 0.045; g.add(st); const hd = mesh(new THREE.SphereGeometry(0.05, 16, 10), MAT.chrome); hd.scale.set(1.1, 0.8, 0.5); hd.position.z = 0.1; g.add(hd); placeOn(mh, g, 0, V3(0, 1.2, 0)); } }
  // ---- extras ----
  const E = spec.extras || 0, has = (i) => !!(E & (1 << i));
  if (has(7)) for (const s of [-1, 1]) tubeOn(Z(-1.95, 1.9, 50).map((z) => side(z, B(0.4), s)), 0.008, MAT.chrome, 0.003, 60);
  if (has(2)) for (const s of [-1, 1]) { tubeOn(Z(-1.95, 1.85, 50).map((z) => side(z, B(0.745), s)), 0.005, MAT.gold, 0.002, 60); tubeOn(Z(-1.9, 1.8, 50).map((z) => side(z, B(0.725), s)), 0.003, MAT.white, 0.002, 60); }
  if (has(4)) for (const x of [-0.12, 0.12]) patch((u, v) => topd(x - 0.05 + u * 0.1, 0.95 + v * 1.12), 2, full ? 20 : 8, MAT.white, 0.003);
  if (has(0)) { const y = B(1.56); for (const x of [-0.6, 0.6]) { const r = mesh(new THREE.CylinderGeometry(0.016, 0.016, 2.0, 8), MAT.chrome); r.rotation.x = Math.PI / 2; r.position.set(x, y, -0.8); body.add(r); } for (const z of Z(-1.7, 0.1, 5)) { const c = mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.2, 6), MAT.chrome); c.rotation.z = Math.PI / 2; c.position.set(0, y, z); body.add(c); } }
  for (const sx of [-1, 1]) for (const az of [AXF, AXR]) { const w = wheel(spec.wheels, wr, full); w.position.set(sx * TRACK, wr, az); w.rotation.y = sx * Math.PI / 2; car.add(w); }
  return car;
}
