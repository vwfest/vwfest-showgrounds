// Code-built "Camper" (late-60s style rear-engine van). Original cage set by eye from published dims:
// L 4.42, W 1.72, H 1.95, wheelbase 2.40, track ~1.39, tyres 185R14 (dia ~0.65). Front=+z, metres.
import * as THREE from 'three';
import { setCrease, V3, keys, DROP, MAT, cageSurface, ring, kit, plateMat, paintMaterial, wheel } from './common.js';
const ZF = 2.21, AXF = 1.27, AXR = -1.13, TRACK = 0.7;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const BELT = 1.04;
function stations(drop) {
  const yb = keys([-2.21, -1.9, -1.2, 0, 1.2, 1.9, 2.21], [0.5, 0.42, 0.38, 0.37, 0.38, 0.42, 0.47]);
  const half = (z) => { const b = yb(z); return [[0, b], [0.6, b], [0.82, b + 0.015], [0.858, b + 0.1], [0.862, BELT - 0.03], [0.866, BELT, 1], [0.866, BELT + 0.022, 1], [0.85, BELT + 0.09], [0.835, 1.7], [0.8, 1.86], [0.56, 1.945], [0, 1.955]]; };
  const fz = (z) => (x, y) => { const ef = ss(1.55, ZF, z), er = ss(-1.7, -ZF, z), u = (x / 0.866) ** 2;
    return z + ef * 0.035 * (1 - u) * Math.exp(-((y - 0.78) ** 2) / 0.03) - ef * (0.15 * u + Math.max(0, y - 1.08) * 0.24 + Math.max(0, 0.72 - y) * 0.1) + er * (0.07 * u + Math.max(0, y - 1.25) * 0.09 + Math.max(0, 0.7 - y) * 0.12); };
  const zs = []; for (let z = -2.06; z <= 2.061; z += 0.206) zs.push(z);
  const S = [];
  const endRing = (z, k) => ring(half(z).map(([x, y, c]) => [x * k, y, c]), z, fz(z));
  for (const k of [0, 0.5, 0.86]) S.push(endRing(-ZF, k));
  for (const z of zs) S.push(ring(half(z), z, fz(z)));
  for (const k of [0.86, 0.5, 0]) S.push(endRing(ZF, k));
  return S.map((r) => r.map((p) => { p.y -= drop; return p; }));
}
export function buildCamper(spec, { studio = false, lod = 0 } = {}) {
  const full = lod === 0, drop = DROP[spec.stance] || 0, wr = 0.325, ra = wr + (spec.stance === 2 || spec.stance === 4 ? 0.035 : spec.stance === 1 ? 0.055 : 0.08);
  setCrease(full); const car = new THREE.Group(), body = new THREE.Group(); car.add(body);
  const K = kit(body, full), { add, side, front, topd, strip, patch, tubeOn, placeOn, mesh, Z, sideWin, gapV, gapH } = K;
  const geo = cageSurface(stations(drop), { full, arches: [AXF, AXR], ra, wr, ax: 0.5 });
  const lower = paintMaterial(spec, studio), upper = spec.c2 ? paintMaterial({ ...spec, c1: spec.c2 }, studio) : lower;
  const belt = BELT - drop + 0.011;
  let skinMeshes;
  if (upper !== lower) { lower.clippingPlanes = [new THREE.Plane(V3(0, -1, 0), belt)]; upper.clippingPlanes = [new THREE.Plane(V3(0, 1, 0), -belt)]; lower.clipShadows = upper.clipShadows = true;
    const a = add(geo, lower), b = add(geo, upper); skinMeshes = [a, b];
    const raySkin = new THREE.Mesh(geo, new THREE.MeshBasicMaterial()); skinMeshes = [raySkin]; raySkin.updateMatrixWorld(); }
  else skinMeshes = [add(geo, lower)];
  K.setSkin(skinMeshes);
  const ytop = 1.955 - drop, B = (y) => y - drop;
  for (const az of [AXF, AXR]) for (const lx of [-0.62, 0.62]) { const m = add(new THREE.CylinderGeometry(ra - 0.01, ra - 0.01, 0.42, full ? 24 : 12, 1, true, 0, Math.PI), MAT.liner); m.rotation.z = Math.PI / 2; m.position.set(lx, wr, az); }
  // ---- interior: cab bench, dash, wheel; rear bench + table (camper fit-out)
  if (full) { const f = B(0.5);
    const floor = mesh(new THREE.BoxGeometry(1.6, 0.04, 4.0), MAT.black); floor.position.set(0, f, 0); body.add(floor);
    const dash = mesh(new THREE.BoxGeometry(1.6, 0.18, 0.3), MAT.black); dash.position.set(0, B(1.02), 1.78); body.add(dash);
    for (const sx of [-0.42, 0.42]) { const c = mesh(new THREE.BoxGeometry(0.62, 0.14, 0.5), MAT.leather); c.position.set(sx, B(0.86), 1.25); body.add(c); const bk = mesh(new THREE.BoxGeometry(0.62, 0.55, 0.1), MAT.leather); bk.position.set(sx, B(1.15), 0.98); bk.rotation.x = -0.12; body.add(bk); }
    const sw = mesh(new THREE.TorusGeometry(0.2, 0.016, 8, 40), MAT.black); sw.position.set(0.42, B(1.12), 1.62); sw.rotation.x = -1.0; body.add(sw);
    const rb = mesh(new THREE.BoxGeometry(1.5, 0.45, 0.5), MAT.leather); rb.position.set(0, B(0.78), -0.75); body.add(rb);
    const tb = mesh(new THREE.BoxGeometry(0.6, 0.04, 0.5), MAT.wood); tb.position.set(-0.45, B(1.12), 0.1); body.add(tb);
    const cab = mesh(new THREE.BoxGeometry(0.4, 0.75, 0.9), MAT.wood); cab.position.set(0.62, B(0.9), -0.15); body.add(cab); }
  // ---- glass ----
  for (const s of [-1, 1]) {
    sideWin(s, 1.08, 1.5, B(1.13), B(1.66), 0.05); // cab door
    sideWin(s, 0.3, 0.92, B(1.15), B(1.66), 0.07); sideWin(s, -0.45, 0.17, B(1.15), B(1.66), 0.07); sideWin(s, -1.2, -0.58, B(1.15), B(1.66), 0.07);
    sideWin(s, -1.72, -1.36, B(1.2), B(1.62), 0.09); // rear quarter
      }
  // wrap-around "bay" windscreen: rays fanned from a point inside the cab so the pane curls round the front corners
  const wsy0 = B(1.14), wsy1 = B(1.69), TH = 1.15, wrapHit = (u, y) => { const a = (u * 2 - 1) * TH, d = V3(Math.sin(a), 0, Math.cos(a)); const o = V3(0, y, 1.25); const h = K.hitRay(o.clone().addScaledVector(d, 3), d.clone().negate()); return h && h.p.z > 1.45 ? h : null; };
  const yAt = (u, v) => { const e = Math.abs(u * 2 - 1); return wsy0 + 0.02 * e + v * (wsy1 - wsy0 - 0.06 * e * e); };
  patch((u, v) => wrapHit(u, yAt(u, v)), full ? 40 : 12, full ? 8 : 3, MAT.glass, 0.004);
  if (full) { for (const v of [0, 1]) tubeOn(Z(0, 1, 40).map((u) => wrapHit(u, yAt(u, v))), 0.012, MAT.rubber, 0.002, 60); for (const u of [0, 1]) tubeOn(Z(0, 1, 8).map((v) => wrapHit(u, yAt(u, v))), 0.012, MAT.rubber, 0.002, 12); }
  patch((u, v) => front(-0.6 + u * 1.2, B(1.3) + v * 0.34, -1), full ? 12 : 4, full ? 4 : 2, MAT.glass, 0.004);
  // wipers
  if (full) for (const wx of [-0.5, 0.1]) { const a = front(wx, wsy0 + 0.03), b = front(wx + 0.42, wsy0 + 0.1); if (a && b) { const arm = mesh(new THREE.BoxGeometry(1, 0.012, 0.008), MAT.black); arm.scale.x = a.p.distanceTo(b.p); arm.position.copy(a.p).add(b.p).multiplyScalar(0.5).addScaledVector(a.n, 0.015); arm.lookAt(arm.position.clone().add(a.n)); arm.rotateZ(-Math.atan2(b.p.y - a.p.y, b.p.x - a.p.x)); body.add(arm); } }
  // ---- panel cuts: cab doors, sliding door + track, engine lid, front fresh-air intake ----
  for (const s of [-1, 1]) { gapV(s, 1.67, B(0.47), B(1.7)); gapV(s, 1.0, B(0.47), B(1.7)); gapH(s, B(0.47), 1.0, 1.67);
    if (s < 0) { gapV(s, 0.97, B(0.47), B(1.7)); gapV(s, -0.1, B(0.47), B(1.7)); gapH(s, B(0.47), -0.1, 0.97); }
    else { gapV(s, -0.55, B(0.47), B(1.7)); } // rear side panel seam
    gapH(s, B(1.72), -1.75, 1.67);
    if (s < 0 && full) tubeOn(Z(-1.3, 0.0, 12).map((z) => side(z, B(1.0), s)), 0.008, MAT.black, 0.004, 16); // slider track
    // rear-quarter intake louvres
    for (let i = 0; i < (full ? 7 : 3); i++) strip(10, (t) => side(-1.78 + t * 0.32, B(1.28) + i * 0.045, s), (t) => side(-1.78 + t * 0.32, B(1.28) + i * 0.045 + 0.016, s), MAT.gap, 0.003);
  }
  { const g = []; for (let i = 0; i < 2; i++) strip(30, (t) => front(-0.36 + t * 0.72, B(1.03) - i * 0.03), (t) => front(-0.5 + t * 1.0, B(1.03) - i * 0.03 - 0.014), MAT.gap, 0.003); }
  strip(30, (t) => front(-0.7 + t * 1.4, B(0.86), -1), (t) => front(-0.7 + t * 1.4, B(0.856), -1), MAT.gap, 0.003); // engine lid
  for (const x of [-0.7, 0.7]) strip(10, (t) => front(x + 0.003, B(0.5) + t * 0.36, -1), (t) => front(x - 0.003, B(0.5) + t * 0.36, -1), MAT.gap, 0.003);
  strip(40, (t) => front(-0.78 + t * 1.56, B(1.2), -1), (t) => front(-0.78 + t * 1.56, B(1.196), -1), MAT.gap, 0.003); // tailgate top
  // ---- sculpted arch lips, rain gutter, belt trim ----
  for (const s of [-1, 1]) { for (const az of [AXF, AXR]) tubeOn(Array.from({ length: 25 }, (_, i) => { const a = Math.PI * (0.06 + 0.88 * i / 24), r = ra + 0.012; return side(az + Math.cos(a) * r, wr + Math.sin(a) * r, s); }), 0.014, lower, 0.002, 40);
    tubeOn(Z(-2.05, 1.7, 40).map((z) => side(z, B(1.835), s)), 0.012, upper, 0.004, 60); }
  // ---- lights ----
  for (const s of [-1, 1]) {
    const h = front(s * 0.6, B(0.86)); if (h) { const g = new THREE.Group(); g.add(mesh(new THREE.TorusGeometry(0.095, 0.016, 10, 36), MAT.chrome)); const pod = mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 36).rotateX(Math.PI / 2), MAT.chrome); pod.position.z = -0.02; g.add(pod);
      const lens = mesh(new THREE.SphereGeometry(0.09, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.lens); lens.rotation.x = Math.PI / 2; lens.scale.y = 0.3; g.add(lens); placeOn(h, g, 0.01); }
    const ti = front(s * 0.62, B(1.05)); if (ti) { const t = mesh(new THREE.BoxGeometry(0.16, 0.06, 0.03), MAT.amber); placeOn(ti, t, 0.01); }
    const tl = front(s * 0.74, B(0.86), -1); if (tl) { const g = new THREE.Group(); const l = mesh(new THREE.BoxGeometry(0.11, 0.26, 0.03), MAT.tail); g.add(l); const a = mesh(new THREE.BoxGeometry(0.11, 0.07, 0.032), MAT.amber); a.position.y = 0.1; g.add(a); placeOn(tl, g, 0.01); }
  }
  // ---- bumpers (blade + step), plates ----
  for (const s of [1, -1]) { const y = B(0.44), zf = s * (ZF + 0.02) - (s > 0 ? 0.1 : -0.02);
    const pts = Z(-0.86, 0.86, 16).map((x) => V3(x, y, zf - s * 0.12 * (x / 0.86) ** 2 * (s > 0 ? 1 : 0.5)));
    pts.unshift(V3(-0.84, y, pts[0].z - s * 0.14)); pts.push(V3(0.84, y, pts[pts.length - 1].z - s * 0.14));
    const bl = add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), full ? 60 : 20, 0.05, full ? 10 : 5), spec.plate ? MAT.chrome : MAT.white); bl.geometry.translate(0, -y, 0); bl.scale.y = 1.6; bl.position.y = y;
    if (s > 0) { const step = mesh(new THREE.BoxGeometry(1.5, 0.02, 0.12), MAT.black); step.position.set(0, y - 0.06, zf + 0.02); body.add(step); }
    const pl = mesh(new THREE.PlaneGeometry(0.36, 0.12), plateMat(spec.plate)); pl.position.set(0, y + (s > 0 ? 0.15 : 0.2), s * (ZF + 0.0) + (s > 0 ? -0.06 : 0.0)); const ph = front(0, y + (s > 0 ? 0.15 : 0.24), s); if (ph) placeOn(ph, pl, 0.008); }
  // ---- handles, mirrors, hubcap-era details ----
  for (const s of [-1, 1]) { const dh = side(1.1, B(1.0), s); if (dh) { const hd = mesh(new THREE.CapsuleGeometry(0.012, 0.1, 4, 8), MAT.chrome); hd.rotation.set(0, Math.PI / 2, 0); const g = new THREE.Group(); g.add(hd); placeOn(dh, g, 0.012); }
    const mh = side(1.62, B(1.38), s); if (mh) { const g = new THREE.Group(); const arm = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), MAT.chrome); arm.rotation.x = Math.PI / 2; arm.position.z = 0.09; g.add(arm); const hd = mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, full ? 20 : 8), MAT.chrome); hd.rotation.x = Math.PI / 2; hd.rotation.z = 0; hd.position.set(0, 0, 0.19); hd.rotateX(Math.PI / 2); g.add(hd); placeOn(mh, g, 0, V3(0, 0, 0.6)); } }
  // ---- extras ----
  const E = spec.extras || 0, has = (i) => !!(E & (1 << i));
  if (has(0) || has(1)) { const y = ytop + 0.1, rack = new THREE.Group(); body.add(rack);
    for (const x of [-0.72, 0.72]) { const r = mesh(new THREE.CylinderGeometry(0.018, 0.018, 3.0, 8), MAT.chrome); r.rotation.x = Math.PI / 2; r.position.set(x, y, -0.25); rack.add(r); }
    for (const z of Z(-1.7, 1.2, full ? 8 : 4)) { const c = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.44, 6), MAT.chrome); c.rotation.z = Math.PI / 2; c.position.set(0, y, z); rack.add(c); }
    for (const x of [-0.72, 0.72]) for (const z of [-1.7, -0.25, 1.2]) { const l = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 6), MAT.chrome); l.position.set(x, y - 0.06, z); rack.add(l); }
    if (has(1)) { const bd = mesh(new THREE.SphereGeometry(1, full ? 32 : 12, full ? 12 : 6), new THREE.MeshPhysicalMaterial({ color: '#f1e3c4', roughness: 0.2, clearcoat: 1 })); bd.scale.set(0.27, 0.04, 1.35); bd.position.set(0.2, y + 0.06, -0.25); rack.add(bd);
      const st = mesh(new THREE.BoxGeometry(0.03, 0.005, 2.5), new THREE.MeshStandardMaterial({ color: '#e63946' })); st.position.set(0.2, y + 0.1, -0.25); rack.add(st); } }
  if (has(7)) for (const s of [-1, 1]) tubeOn(Z(-2.0, 1.95, 50).map((z) => side(z, belt - 0.012, s)), 0.009, MAT.chrome, 0.003, 60);
  if (has(2)) for (const s of [-1, 1]) tubeOn(Z(-1.9, 1.9, 50).map((z) => side(z, B(0.6), s)), 0.005, MAT.gold, 0.002, 60);
  if (has(8)) for (const s of [-1, 1]) for (const [y0, len] of [[0.62, 1.4], [0.75, 1.1], [0.88, 0.8]]) tubeOn(Z(0.8, 0.8 - len, 20).map((z, i) => side(z, B(y0) + 0.03 * Math.sin(i * 0.8), s)), 0.025 * (1 - 0), MAT.flameO, 0.002, 30);
  // ---- wheels ----
  for (const sx of [-1, 1]) for (const az of [AXF, AXR]) { const w = wheel(spec.wheels, wr, full); w.position.set(sx * TRACK, wr, az); w.rotation.y = sx * Math.PI / 2; car.add(w); }
  return car;
}
