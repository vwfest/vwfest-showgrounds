// Code-built "Safari" (early-70s rear-engine open utility). Cage set by eye from published dims:
// L 3.78, W 1.64, H 1.50 (top up), wheelbase 2.40, track ~1.38, tyres 165-15 (dia ~0.62). Front=+z, metres.
import * as THREE from 'three';
import { setCrease, V3, keys, DROP, MAT, cageSurface, ring, kit, plateMat, paintMaterial, wheel , lensDetail, tailDetail } from './common.js';
const ZF = 1.89, AXF = 1.19, AXR = -1.21, TRACK = 0.69;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const yb = keys([-1.89, -1.6, -1.0, 0, 1.0, 1.6, 1.89], [0.5, 0.42, 0.36, 0.35, 0.36, 0.42, 0.5]);
const topY = keys([-1.89, -1.5, 0, 0.5, 1.3, 1.89], [0.99, 1.0, 1.0, 1.02, 0.99, 0.95]);
const W = 0.815, WN = 0.6; // tub half-width; nose half-width between the separate front fenders
const wz = (z) => W - (W - WN) * ss(0.5, 0.72, z);
function bodyStations(drop) {
  const half = (z) => { const b = yb(z), t = topY(z), w = wz(z);
    return [[0, b], [0.6 * w, b], [w - 0.02, b + 0.004], [w, b + 0.03, 1], [w, 0.7], [w, 0.735, 1], [w + 0.013, 0.745, 1], [w + 0.013, 0.79, 1], [w, 0.8, 1], [w, t - 0.03], [w, t - 0.004, 1], [w - 0.03, t, 1], [0.4, t + 0.004], [0, t + 0.006]]; };
  const fz = (z) => (x, y) => { const ef = ss(1.55, ZF, z), er = ss(-1.6, -ZF, z), u = (x / W) ** 2; return z - ef * (0.04 * u + Math.max(0, y - 0.62) * 0.36 + Math.max(0, 0.5 - y) * 0.1) + er * (0.03 * u + Math.max(0, 0.55 - y) * 0.12); };
  const S = [], endRing = (z, k) => ring(half(z).map(([x, y, c]) => [x * k, y, c]), z, fz(z));
  for (const k of [0, 0.55, 0.95, 0.95]) S.push(endRing(-ZF, k));
  for (let z = -1.76; z <= 1.761; z += 0.16) S.push(ring(half(z), z, fz(z)));
  for (const k of [0.95, 0.95, 0.55, 0]) S.push(endRing(ZF, k));
  return S.map((r) => r.map((p) => { p.y -= drop; return p; }));
}
// separate bolt-on front fender: flat-topped box section with crisp edges, sloped nose matching the hood face
function fenderStations(drop, s, full) {
  const sec = [[0.57, 0.5], [0.83, 0.5, 1], [0.845, 0.9, 1], [0.825, 0.945, 1], [0.6, 0.945, 1], [0.575, 0.92, 1]];
  const loop = (z, k) => { const cx = 0.71, cy = 0.69, pts = sec.flatMap((p) => p[2] && full ? [p, p, p] : [p]).map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
    const r = pts.map(([x, y]) => V3(s * x, y - drop, z - Math.max(0, z - 1.6) / 0.29 * (Math.max(0, y - 0.6) * 0.3)));
    return s > 0 ? r : r.reverse(); };
  const S = []; for (const k of [0, 0.6, 0.97, 0.97]) S.push(loop(0.45, k));
  for (let z = 0.6; z <= 1.75; z += 0.115) S.push(loop(z, 1));
  for (const k of [0.97, 0.97, 0.6, 0]) S.push(loop(ZF + 0.02, k));
  return S;
}
function topStations(drop) { // folding soft top: crisp roof corners, cloth sag between the bows
  const half = () => [[0, 0.99], [0.78, 0.99], [0.795, 1.04, 1], [0.79, 1.42], [0.775, 1.48, 1], [0.72, 1.5, 1], [0.4, 1.508], [0, 1.512]];
  const bows = [-1.45, -0.95, -0.45, 0.05, 0.42], sag = (z) => { const d = Math.min(...bows.map((b) => Math.abs(z - b))); return 0.016 * Math.min(1, d / 0.25) ** 2; };
  const fz = (z) => (x, y) => z - (z < -1.0 ? Math.max(0, y - 1.05) * 0.14 : 0);
  const R = (z, k) => ring(half().map(([x, y, c]) => [x * k, y > 1.45 ? y - sag(z) : y, c]), z, fz(z));
  const S = [R(-1.52, 0), R(-1.52, 0.92), R(-1.52, 0.92)];
  for (let z = -1.44; z <= 0.36; z += 0.1) S.push(R(z, 1));
  S.push(R(0.44, 0.92), R(0.44, 0.92), R(0.44, 0));
  return S.map((r) => r.map((p) => { p.y -= drop; return p; }));
}
export function buildSafari(spec, { studio = false, lod = 0 } = {}) {
  const full = lod === 0, drop = DROP[spec.stance] || 0, wr = 0.315, ra = wr + (spec.stance === 2 || spec.stance === 4 ? 0.04 : spec.stance === 1 ? 0.06 : 0.1);
  setCrease(full); const car = new THREE.Group(), body = new THREE.Group(); car.add(body);
  const K = kit(body, full), { add, side, front, topd, strip, patch, tubeOn, placeOn, mesh, Z, sideWin, gapV, gapH } = K;
  const paint = paintMaterial(spec, studio), B = (y) => y - drop;
  const bodyM = add(cageSurface(bodyStations(drop), { full, arches: [AXF, AXR], ra, wr, ax: 0.5 }), paint);
  const topM = add(cageSurface(topStations(drop), { full, ax: 9 }), MAT.canvas);
  const fenders = [-1, 1].map((s) => add(cageSurface(fenderStations(drop, s, full), { full, arches: [AXF], ra: ra + 0.01, wr, ax: 0.5 }), paint));
  K.setSkin([bodyM, topM, ...fenders]);
  for (const az of [AXF, AXR]) for (const lx of [-0.675, 0.675]) { const m = add(new THREE.CylinderGeometry(ra - 0.005, ra - 0.005, 0.33, full ? 24 : 12, 1, true, 0, Math.PI), MAT.liner); m.rotation.z = Math.PI / 2; m.position.set(lx, wr, az); }
  // ---- windscreen: upright flat glass in a painted fold-down frame ----
  { const zw = 0.47, y0 = B(1.02), y1 = B(1.47), g = new THREE.Group(); body.add(g); g.position.set(0, y0, zw); g.rotation.x = -0.12;
    const gl = mesh(new THREE.PlaneGeometry(1.42, y1 - y0 - 0.06), MAT.glass); gl.position.y = (y1 - y0) / 2; g.add(gl);
    for (const [w, h, x, y] of [[1.56, 0.05, 0, 0.02], [1.56, 0.045, 0, y1 - y0 - 0.02], [0.05, y1 - y0, -0.76, (y1 - y0) / 2], [0.05, y1 - y0, 0.76, (y1 - y0) / 2]]) { const f = mesh(new THREE.BoxGeometry(w, h, 0.05), paint); f.position.set(x, y, 0); g.add(f); }
    if (full) for (const wx of [-0.55, 0.05]) { const a = mesh(new THREE.BoxGeometry(0.42, 0.012, 0.01), MAT.black); a.position.set(wx + 0.21, 0.09, 0.03); a.rotation.z = 0.15; g.add(a); } }
  // interior visible through the screen
  if (true) { /* r4 */ const dash = mesh(new THREE.BoxGeometry(1.5, 0.12, 0.2), MAT.black); dash.position.set(0, B(1.05), 0.36); body.add(dash);
    const sw = mesh(new THREE.TorusGeometry(0.19, 0.014, 8, 40), MAT.black); sw.position.set(0.38, B(1.2), 0.22); sw.rotation.x = -0.9; body.add(sw);
    for (const sx of [-0.38, 0.38]) { const bk = mesh(new THREE.BoxGeometry(0.5, 0.42, 0.1), MAT.leather); bk.position.set(sx, B(1.18), -0.3); body.add(bk); } }
  // ---- soft-top windows ----
  for (const s of [-1, 1]) { sideWin(s, -0.12, 0.3, B(1.12), B(1.38), 0.04); sideWin(s, -0.88, -0.26, B(1.12), B(1.38), 0.04); sideWin(s, -1.42, -1.05, B(1.14), B(1.36), 0.06);
    if (full) tubeOn(Z(-1.5, 0.43, 40).map((z) => side(z, B(1.005), s)), 0.012, MAT.black, 0.002, 50); }
  patch((u, v) => front(-0.5 + u * 1.0, B(1.15) + v * 0.22, -1), 8, 3, MAT.glass, 0.004);
  // ---- panel work: 4 doors with exposed hinges, stamped ribs, lids ----
  for (const s of [-1, 1]) {
    for (const z of [0.42, -0.24, -0.9]) gapV(s, z, B(0.44), B(0.985)); gapH(s, B(0.44), -0.9, 0.42);
    if (full) for (const z of [0.38, -0.28]) for (const y of [0.55, 0.88]) { const h = side(z, B(y), s); if (h) placeOn(h, mesh(new THREE.BoxGeometry(0.04, 0.07, 0.02), MAT.chrome), 0.01); }
    if (full) { for (const bz of [-1.45, -0.95, -0.45, 0.05]) tubeOn(Z(0, 1, 16).map((t) => { const y = B(1.05) + t * 0.44; return side(bz, y, s); }), 0.008, MAT.black, 0.002, 16); tubeOn(Z(-1.5, 0.43, 40).map((z) => side(z, B(1.46), s)), 0.006, MAT.black, 0.002, 40); }
    const dh = side(0.2, B(0.9), s); if (dh) { const hd = mesh(new THREE.CapsuleGeometry(0.012, 0.1, 4, 8), MAT.chrome); hd.rotation.set(0, Math.PI / 2, 0); const g = new THREE.Group(); g.add(hd); placeOn(dh, g, 0.012); }
    for (const az of [AXF, AXR]) tubeOn(Array.from({ length: 25 }, (_, i) => { const a = Math.PI * (0.04 + 0.92 * i / 24), r = ra + 0.016; return side(az + Math.cos(a) * r, wr + Math.sin(a) * r, s); }), 0.02, paint, -0.004, 40);
    strip(30, (t) => topd(s * 0.62 + 0.003, 0.62 + t * 1.12), (t) => topd(s * 0.62 - 0.003, 0.62 + t * 1.12), MAT.gap, 0.002);
    strip(30, (t) => topd(s * 0.62 + 0.003, -1.82 + t * 0.32), (t) => topd(s * 0.62 - 0.003, -1.82 + t * 0.32), MAT.gap, 0.002);
    for (let i = 0; i < (full ? 6 : 3); i++) { const h = topd(s * 0.4, -1.56 - i * 0.04); if (h) placeOn(h, mesh(new THREE.BoxGeometry(0.3, 0.012, 0.01), MAT.gap), 0.003); } }
  strip(30, (t) => topd(-0.62 + t * 1.24, 0.62 + 0.003), (t) => topd(-0.62 + t * 1.24, 0.62 - 0.003), MAT.gap, 0.002);
  // ---- lights ----
  for (const s of [-1, 1]) {
    const h = front(s * 0.6, B(0.8)); if (h) { const g = new THREE.Group(); g.add(mesh(new THREE.TorusGeometry(0.09, 0.016, 10, 36), MAT.chrome)); const pod = mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.08, 36, 1, true).rotateX(Math.PI / 2), paint); pod.position.z = -0.03; g.add(pod);
      const lens = mesh(new THREE.SphereGeometry(0.086, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.lens); lens.rotation.x = Math.PI / 2; lens.scale.y = 0.3; g.add(lens); lensDetail(g, 0.086, 0, full); placeOn(h, g, 0.015, V3(0, 0, 3)); }
    const ti = front(s * 0.66, B(0.58)); if (ti) placeOn(ti, mesh(new THREE.BoxGeometry(0.1, 0.05, 0.03), MAT.amber), 0.01);
    const tl = front(s * 0.62, B(0.78), -1); if (tl) { const g = new THREE.Group(); const l = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 20).rotateX(Math.PI / 2), MAT.tail); g.add(l); tailDetail(g, 0.07, 0, 0.016, true); placeOn(tl, g, 0.01); } }
  { const h = topd(0, 1.18); if (h) { const sp = new THREE.Group(); { const t = mesh(new THREE.TorusGeometry(0.21, 0.075, 8, 28), MAT.rubber); sp.add(t); const r = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 20).rotateX(Math.PI / 2), MAT.chrome); sp.add(r); const hb = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12).rotateX(Math.PI / 2), MAT.black); sp.add(hb); } sp.rotation.x = -Math.PI / 2 + 0.12; sp.position.copy(h.p).add(V3(0, 0.085, 0)); body.add(sp); } } // r9: spare tyre on the bonnet
  { const lb = new THREE.Group(); lb.position.set(0, B(1.52), 0.36); body.add(lb); lb.add(mesh(new THREE.BoxGeometry(1.05, 0.05, 0.06), MAT.black)); // r9: roof light bar
    for (const x of [-0.39, -0.13, 0.13, 0.39]) { const c = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 16).rotateX(Math.PI / 2), MAT.chrome); c.position.set(x, 0.06, 0.02); lb.add(c); const l = mesh(new THREE.CircleGeometry(0.043, 16), MAT.lens); l.position.set(x, 0.06, 0.051); lb.add(l); }
    for (const x of [-0.5, 0.5]) { const p = mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), MAT.black); p.position.set(x, -0.05, 0); lb.add(p); } }
  // ---- bumpers (flat blades on stub brackets) + plates ----
  for (const s of [1, -1]) { const y = B(0.44), z = s * (ZF + 0.04);
    const bl = mesh(new THREE.BoxGeometry(1.66, 0.085, 0.035), MAT.chrome); bl.position.set(0, y, z); body.add(bl);
    for (const x of [-0.5, 0.5]) { const br = mesh(new THREE.BoxGeometry(0.04, 0.04, 0.09), MAT.black); br.position.set(x, y, z - s * 0.08); body.add(br); }
    const pl = mesh(new THREE.PlaneGeometry(0.36, 0.12), plateMat(spec.plate)); pl.position.set(0, y + 0.13, s * (ZF + 0.0)); pl.rotation.y = s > 0 ? 0 : Math.PI; const ph = front(0, y + 0.15, s); if (ph) placeOn(ph, pl, 0.008); }
  for (const s of [-1, 1]) { const mh = side(0.5, B(1.0), s); if (mh && full) { const g = new THREE.Group(); const arm = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), MAT.chrome); arm.rotation.x = Math.PI / 2; arm.position.z = 0.07; g.add(arm); const hd = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 20), MAT.chrome); hd.position.z = 0.15; g.add(hd); placeOn(mh, g, 0, V3(0, 0.5, 0.4)); } }
  // ---- extras ----
  const E = spec.extras || 0, has = (i) => !!(E & (1 << i));
  if (has(5)) for (const x of [-0.42, 0.42]) { const g = new THREE.Group(); const c = mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.08, 20).rotateX(Math.PI / 2), MAT.chrome); g.add(c); const l = mesh(new THREE.CircleGeometry(0.066, 20), MAT.amber); l.position.z = 0.041; g.add(l); g.position.set(x, B(0.54), ZF + 0.07); body.add(g); }
  if (has(7)) for (const s of [-1, 1]) tubeOn(Z(-0.85, 0.82, 20).map((z) => side(z, B(0.5), s)), 0.008, MAT.chrome, 0.003, 30);
  if (has(4)) for (const x of [-0.12, 0.12]) patch((u, v) => topd(x - 0.05 + u * 0.1, 0.65 + v * 1.1), 2, full ? 16 : 6, MAT.white, 0.003);
  if (has(0)) { const y = B(1.6); for (const x of [-0.6, 0.6]) { const r = mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.8, 8), MAT.chrome); r.rotation.x = Math.PI / 2; r.position.set(x, y, -0.5); body.add(r); } for (const z of Z(-1.3, 0.3, 4)) { const c = mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.2, 6), MAT.chrome); c.rotation.z = Math.PI / 2; c.position.set(0, y, z); body.add(c); } }
  for (const sx of [-1, 1]) for (const az of [AXF, AXR]) { const w = wheel(spec.wheels, wr, full); w.position.set(sx * TRACK, wr, az); w.rotation.y = sx * Math.PI / 2; car.add(w); }
  return car;
}
