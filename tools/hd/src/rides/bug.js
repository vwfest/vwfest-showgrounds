// Bug: original code-built body. Hand-placed control cage (stations x ring) -> uniform bicubic B-spline
// (Catmull-Clark limit on a regular quad cage). Separate lofted fenders, running boards, upright lamps.
// Proportions from published dims: L 4.08, W 1.54, H 1.50, wheelbase 2.40, track 1.31/1.35, tyre ~Ø0.64.
import * as THREE from 'three';
import { lensDetail } from './common.js';
import { MAT as M0, paintMaterial, wheel } from './ghia.js';
const MAT = { ...M0, glass: M0.glass.clone() }; MAT.glass.opacity = 0.42; MAT.glass.color.set('#1a2a33');
const keys = (zs, ys) => { const n = zs.length, m = ys.map((_, i) => i === 0 ? (ys[1] - ys[0]) / (zs[1] - zs[0]) : i === n - 1 ? (ys[n - 1] - ys[n - 2]) / (zs[n - 1] - zs[n - 2]) : (ys[i + 1] - ys[i - 1]) / (zs[i + 1] - zs[i - 1]));
  return (z) => { if (z <= zs[0]) return ys[0]; for (let i = 1; i < n; i++) if (z <= zs[i]) { const h = zs[i] - zs[i - 1], t = (z - zs[i - 1]) / h, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * ys[i - 1] + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * ys[i] + (t3 - t2) * h * m[i]; } return ys[n - 1]; }; };
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const DROP = [0, 0.05, 0.09, -0.1, 0.07];
const AXF = 1.17, AXR = -1.23, ZF = 1.95, ZR = -1.98, TRACK = 0.665;
// side-view & plan-view profiles of the body tub (between fenders)
const P = {
  top: keys([ZR, -1.85, -1.55, -1.15, -0.75, -0.35, 0.0, 0.25, 0.42, 0.66, 1.1, 1.5, 1.8, ZF], [0.5, 0.66, 0.86, 1.12, 1.38, 1.51, 1.54, 1.52, 1.43, 1.02, 0.94, 0.84, 0.7, 0.5]),
  yb: keys([ZR, -1.7, -0.9, 0, 0.9, 1.7, ZF], [0.42, 0.34, 0.3, 0.29, 0.3, 0.34, 0.4]),
  w: keys([ZR, -1.85, -1.5, -1.0, -0.4, 0.3, 0.8, 1.3, 1.7, ZF], [0.36, 0.48, 0.58, 0.66, 0.7, 0.7, 0.66, 0.56, 0.47, 0.34]),
  belt: keys([-1.2, -0.4, 0.4, 0.8], [0.98, 0.97, 0.96, 0.96]),
  cab: (z) => ss(-1.25, -0.95, z) * (1 - ss(0.3, 0.68, z)),
};
function bspline(S, M, ru, rv, closed = true, post) {
  const B = (t) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6];
  const nu = (S.length - 3) * ru, nv = closed ? M * rv : (M - 3) * rv, pos = [], idx = [], v = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) { const su = Math.min(Math.floor(i / ru), S.length - 4), bu = B(i / ru - su);
    for (let j = 0; j <= nv; j++) { const sv = closed ? Math.floor(j / rv) % M : Math.min(Math.floor(j / rv), M - 4), bv = B(j / rv - Math.floor(j / rv) + (closed ? 0 : Math.floor(j / rv) - sv)); v.set(0, 0, 0);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) v.addScaledVector(S[su + a][(sv + b) % M], bu[a] * bv[b]);
      if (post) post(v); pos.push(v.x, v.y, v.z); } }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function bodyCage(drop, full, zf = ZF, zr = ZR) {
  const N = 30, st = [];
  for (let i = 0; i < N; i++) { const z = zr + (i / (N - 1)) * (zf - zr);
    const yb = P.yb(z), w = P.w(z), top = P.top(z), cf = P.cab(z), belt = P.belt(z), H = top - yb;
    const hood = [[0.6 * w, yb], [w, yb + 0.04], [w, yb + 0.2 * H], [0.96 * w, yb + 0.45 * H], [0.85 * w, yb + 0.66 * H], [0.68 * w, yb + 0.84 * H], [0.46 * w, yb + 0.95 * H], [0.23 * w, top]];
    const bl = Math.min(belt, top - 0.12), cab = [[0.6 * w, yb], [w, yb + 0.04], [w, (yb + bl) / 2], [w, bl - 0.03], [0.95 * w, bl + 0.02], [0.86 * w, bl + 0.45 * (top - bl)], [0.7 * w, top - 0.07], [0.4 * w, top - 0.012]];
    let half = hood.map((h, k) => [h[0] + (cab[k][0] - h[0]) * cf, h[1] + (cab[k][1] - h[1]) * cf]);
    const e = z > zf - 0.25 ? (z - zf + 0.25) / 0.25 : z < zr + 0.23 ? (zr + 0.23 - z) / 0.23 : 0, yN = z > 0 ? 0.5 : 0.52;
    const sx = Math.pow(Math.max(0, 1 - Math.pow(e, 2.4)), 0.5), sy = Math.pow(Math.max(0, 1 - Math.pow(e, 3)), 0.5);
    half = half.map(([x, y]) => [x * sx, yN + (y - yN) * sy]);
    const ring = [[0, yN + (yb - yN) * sy], ...half, [0, yN + (top - yN) * sy], ...half.slice().reverse().map(([x, y]) => [-x, y])].map(([x, y]) => V3(x, y - drop, z));
    st.push(ring); }
  const S = [st[0], st[0], ...st, st[N - 1], st[N - 1]];
  return bspline(S, S[0].length, full ? 5 : 2, full ? 5 : 2);
}
// fender: lofted along a hand-set centreline (z,y), cross-section dome spanning x in [xi, xo]
function fender(path, xi, xo, drop, full, lift = 0) {
  const curve = new THREE.CatmullRomCurve3(path.map(([z, y]) => V3(0, y - drop + lift, z))), n = 16, st = [];
  for (let i = 0; i <= n; i++) { const t = i / n, p = curve.getPoint(t), tg = curve.getTangent(t), nrm = V3(0, tg.z, -tg.y).normalize(); if (nrm.y < -0.2 && Math.abs(tg.y) < 0.9) nrm.negate();
    const k = Math.min(1, Math.sin(Math.PI * t) * 2.2 + 0.25); // taper ends
    const xm = (xi + xo) / 2, hw = (xo - xi) / 2 * (0.8 + 0.2 * k), th = 0.17 * Math.min(1, k + 0.1);
    const prof = [[-1.0, -0.02], [-0.3, -0.03], [0.55, -0.04], [0.97, -0.1], [1.03, -0.04], [1.0, 0.06], [0.75, 0.13], [0.3, 0.16], [-0.3, 0.16], [-1.0, 0.1]];
    st.push(prof.map(([u, v]) => V3(xm + u * hw, 0, 0).add(p.clone().addScaledVector(nrm, v * th / 0.15)))); }
  const S = [st[0], st[0], ...st, st[n], st[n]];
  return bspline(S, S[0].length, full ? 4 : 2, full ? 4 : 2);
}
export function buildBug(spec, { studio = false, lod = 0, baja = false } = {}) {
  const full = lod === 0, drop = (DROP[spec.stance] || 0) - (baja ? 0.08 : 0), wr = baja ? 0.36 : 0.32;
  const paint = paintMaterial(spec, studio); const car = new THREE.Group(), body = new THREE.Group(); car.add(body);
  const mesh = (g, m, p = body) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; p.add(o); return o; };
  const bodyMesh = mesh(baja ? bodyCage(drop, full, 1.6, -1.62) : bodyCage(drop, full), paint);
  // fenders (front: long nose sweep carrying the lamp; rear: fuller, taillight on top)
  const FF = [[0.52, 0.36], [0.72, 0.52], [0.9, 0.68], [1.17, 0.77], [1.42, 0.74], [1.62, 0.63], [1.76, 0.49], [1.81, 0.38]];
  const RF = [[-0.58, 0.36], [-0.78, 0.55], [-1.0, 0.72], [-1.25, 0.8], [-1.55, 0.78], [-1.8, 0.66], [-1.95, 0.5], [-1.98, 0.36]];
  const BF = [[0.72, 0.42], [0.88, 0.7], [1.1, 0.9], [1.35, 0.9], [1.55, 0.74], [1.6, 0.6]], BR = [[-0.8, 0.42], [-0.98, 0.74], [-1.2, 0.93], [-1.4, 0.9], [-1.5, 0.76], [-1.53, 0.62]];
  const fenders = [];
  for (const s of [-1, 1]) for (const [path, xo] of baja ? [[BF, 0.83], [BR, 0.85]] : [[FF, 0.755], [RF, 0.775]]) { const g = fender(path, 0.44, xo, drop, full); if (s < 0) { g.scale(-1, 1, 1); g.index.array.reverse(); g.computeVertexNormals(); } fenders.push(mesh(g, paint)); }
  for (const az of [AXF, AXR]) for (const lx of [-0.62, 0.62]) { if (baja) continue; const m = mesh(new THREE.CylinderGeometry(wr + 0.07, wr + 0.07, 0.26, full ? 24 : 10, 1, true, 0, Math.PI), MAT.liner); m.rotation.z = Math.PI / 2; m.position.set(lx, wr - drop * 0.2, az); }
  // projection helpers (decorate the surface without hard-coding offsets)
  const rc = new THREE.Raycaster(), skin = [bodyMesh, ...fenders];
  const hit = (o, d, objs = skin) => { rc.set(o, d); const h = rc.intersectObjects(objs, false)[0]; if (!h) return null; const n = h.face.normal.clone().transformDirection(h.object.matrixWorld); if (n.dot(d) > 0) n.negate(); return { p: h.point.clone(), n }; };
  body.updateMatrixWorld(true);
  const side = (z, y, s) => hit(V3(s * 0.69, y, z), V3(-s, 0, 0), [bodyMesh]) || null;
  const sideOut = (z, y, s) => hit(V3(s * 3, y, z), V3(-s, 0, 0));
  const front = (x, y, s = 1) => hit(V3(x, y, s * 4), V3(0, 0, -s), [bodyMesh]);
  const strip = (n, fa, fb, mat, eps = 0.004) => { const pos = [], idx = []; let prev = -1;
    for (let i = 0; i <= n; i++) { const A = fa(i / n), B = fb(i / n); if (!A || !B) { prev = -1; continue; } const k = pos.length / 3; pos.push(...A.p.addScaledVector(A.n, eps).toArray(), ...B.p.addScaledVector(B.n, eps).toArray()); if (prev >= 0) idx.push(prev, prev + 1, k, prev + 1, k + 1, k); prev = k; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; body.add(m); return m; };
  const patch = (proj, nu, nv, mat, eps) => { const pos = [], idx = [], ok = [], H = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const h = proj(i / nu, j / nv); H.push(h); ok.push(!!h); pos.push(...(h ? h.p.clone().addScaledVector(h.n, eps).toArray() : [0, 0, 0])); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; if (ok[a] && ok[b] && ok[a + 1] && ok[b + 1]) idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); body.add(new THREE.Mesh(g, mat));
    const at = (i, j) => H[i * (nv + 1) + j], border = []; for (let i = 0; i <= nu; i++) border.push(at(i, 0)); for (let j = 1; j <= nv; j++) border.push(at(nu, j)); for (let i = nu - 1; i >= 0; i--) border.push(at(i, nv)); for (let j = nv - 1; j >= 0; j--) border.push(at(0, j)); return border.filter(Boolean); };
  const tubeOn = (hits, r, mat, out = 0, seg = 64) => { const pts = hits.filter(Boolean).map((h) => h.p.clone().addScaledVector(h.n, out)); if (pts.length > 1) mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, full ? 8 : 4), mat); };
  const Z = (a, b, n = 60) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const belt = (z) => P.belt(z) - drop, roof = (z) => P.top(z) - drop, yb = (z) => P.yb(z) - drop;
  // interior
  if (true) { /* r4: interior baked into HD */ const fy = yb(0) + 0.08; mesh(new THREE.BoxGeometry(1.2, 0.04, 2.0), MAT.black).position.set(0, fy, -0.2);
    for (const sx of [-1, 1]) { mesh(new THREE.BoxGeometry(0.44, 0.12, 0.46), MAT.leather).position.set(sx * 0.29, fy + 0.22, 0.05); const bk = mesh(new THREE.CapsuleGeometry(0.19, 0.26, 4, 10), MAT.leather); bk.scale.set(1.1, 1, 0.35); bk.position.set(sx * 0.29, belt(0) - 0.02, -0.22); bk.rotation.x = -0.2; }
    mesh(new THREE.BoxGeometry(1.0, 0.3, 0.32), MAT.leather).position.set(0, belt(-0.9) - 0.1, -0.85);
    mesh(new THREE.BoxGeometry(0.8, 0.12, 0.2), MAT.black).position.set(0, belt(0.5) - 0.06, 0.5);
    const sw = mesh(new THREE.TorusGeometry(0.19, 0.014, 8, 40), MAT.ivory); sw.position.set(0.3, belt(0.4) + 0.03, 0.36); sw.rotation.x = -0.5;
    const sp = mesh(new THREE.CircleGeometry(0.06, 20), MAT.chrome); sp.position.set(0.0, belt(0.6) + 0.0, 0.73); }
  // glass: door window + rear quarter (oval-ish), split by B-pillar; upright windscreen; small rear screen
  for (const s of [-1, 1]) {
    const lo = (z) => belt(z) + 0.045, hiW = (z, a, b) => { const r = Math.min(1, (z - a) / 0.14, (b - z) / 0.1), hi = roof(z) - 0.075; return lo(z) + (hi - lo(z)) * Math.sqrt(Math.max(0, r)); };
    for (const [a, b] of [[-0.2, 0.6], [-0.95, -0.28]]) { const bb = patch((u, v) => { const z = a + u * (b - a); return side(z, lo(z) + v * (hiW(z, a, b) - lo(z)), s); }, full ? 30 : 10, full ? 8 : 3, MAT.glass, 0.006);
      if (full) { tubeOn([...bb, bb[0]], 0.015, MAT.rubber, 0.004, 120); tubeOn(Z(a, b, 30).map((z) => side(z, lo(z), s)), 0.005, MAT.chrome, 0.008, 40); } }
  }
  const ws = patch((u, v) => { const y = belt(0.7) + 0.07 + v * 0.3, w = 0.46 - 0.07 * v; const h = front((u - 0.5) * 2 * w, y); return h && h.n.z > 0.3 ? h : null; }, full ? 20 : 8, full ? 10 : 4, MAT.glass, 0.006);
  const rw = patch((u, v) => { const y = belt(-1.1) + 0.14 + v * 0.2, w = 0.34 - 0.05 * v; const h = front((u - 0.5) * 2 * w, y, -1); return h && h.p.z > -1.5 ? h : null; }, full ? 14 : 6, full ? 8 : 3, MAT.glass, 0.006);
  if (full) for (const b of [ws, rw]) tubeOn([...b, b[0]], 0.016, MAT.rubber, 0.005, 120);
  // panel gaps: door cut, hood + engine-lid outlines, rain gutter, running boards
  const gw = 0.0035;
  for (const s of [-1, 1]) { for (const dz of [0.62, -0.32]) strip(16, (t) => side(dz + gw, yb(dz) + 0.06 + t * (belt(dz) - yb(dz) + 0.02), s), (t) => side(dz - gw, yb(dz) + 0.06 + t * (belt(dz) - yb(dz) + 0.02), s), MAT.gap, 0.002);
    tubeOn(Z(-1.0, 0.62, 40).map((z) => side(z, roof(z) - 0.06, s)), 0.007, paint, 0.004, 50); // rain gutter
    const rb = mesh(new THREE.BoxGeometry(0.2, 0.035, 1.05), MAT.rubber); rb.position.set(s * 0.64, 0.33 - drop, -0.02);
    if (full) for (let i = 0; i < 4; i++) { const r = mesh(new THREE.BoxGeometry(0.17, 0.008, 0.9), MAT.black); r.position.set(s * 0.64, 0.352 - drop, -0.02 + 0 * i); r.position.x = s * (0.58 + i * 0.04); r.scale.x = 0.05; } }
  const topd = (x, z) => hit(V3(x, 3, z), V3(0, -1, 0), [bodyMesh]);
  const outline = (cz, rz, w, k, n = 50) => strip(n, (t) => { const a = t * Math.PI * 2, x = w * Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.6, z = cz + rz * Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** k; return topd(x, z); }, (t) => { const a = t * Math.PI * 2, x = (w - 0.008) * Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.6, z = cz + (rz - 0.008) * Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** k; return topd(x, z); }, MAT.gap, 0.002);
  if (baja) outline(1.17, 0.38, 0.4, 0.6); else { outline(1.32, 0.48, 0.42, 0.6); outline(-1.55, 0.3, 0.36, 0.7); }
  if (!baja) for (let i = 0; i < (full ? 5 : 3); i++) { const h = topd(0, -1.3 - i * 0.04); if (h) { const l = mesh(new THREE.BoxGeometry(0.34, 0.01, 0.012), MAT.black); l.position.copy(h.p).addScaledVector(h.n, 0.003); l.lookAt(l.position.clone().add(h.n)); } }
  { const h = topd(0, 1.62); if (h && full) { const hd = mesh(new THREE.BoxGeometry(0.06, 0.02, 0.13), MAT.chrome); hd.position.copy(h.p).addScaledVector(h.n, 0.008); } }
  // lamps: upright headlamps faired into the front-fender noses; teardrop taillights on rear fenders
  for (const s of [-1, 1]) {
    const hz = baja ? 1.5 : 1.6, hy = (baja ? 0.9 : 0.86) - drop, hx = s * 0.645, g = new THREE.Group(); g.position.set(hx, hy, hz); g.rotation.x = -0.12; body.add(g);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.22, full ? 28 : 12).rotateX(Math.PI / 2), paint); pod.position.z = -0.08; pod.castShadow = true; g.add(pod);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.094, 0.013, 8, full ? 32 : 14), MAT.chrome); ring.position.z = 0.03; g.add(ring);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.09, full ? 24 : 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.lens); lens.rotation.x = Math.PI / 2; lens.scale.y = 0.28; lens.position.z = 0.025; g.add(lens); lensDetail(g, 0.09, 0.025, full, 0.28);
    const t = new THREE.Group(); t.position.set(s * (baja ? 0.66 : 0.64), (baja ? 0.84 : 0.79) - drop, baja ? -1.45 : -1.73); t.rotation.x = 0.55; body.add(t);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(0.07, full ? 18 : 8, 10), MAT.tail); tl.scale.set(0.75, 1.25, 0.45); t.add(tl);
    const tr = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 20), MAT.chrome); tr.scale.set(0.75, 1.25, 1); t.add(tr);
    // turn signal on fender top
    if (full && !baja) { const ts = mesh(new THREE.CapsuleGeometry(0.018, 0.06, 4, 8), MAT.chrome); ts.rotation.x = Math.PI / 2; ts.position.set(s * 0.63, 0.79 - drop, 1.42); }
    // horn grille in the apron
    const gr = !baja && front(s * 0.3, 0.5 - drop); if (gr && full) for (let i = 0; i < 5; i++) { const b = mesh(new THREE.BoxGeometry(0.12, 0.008, 0.01), MAT.chrome); b.position.copy(gr.p).addScaledVector(gr.n, 0.004); b.position.y += (i - 2) * 0.02; b.lookAt(b.position.clone().add(gr.n)); }
  }
  // blade bumpers on brackets with overriders
  if (!baja) for (const s of [1, -1]) { const y = 0.37 - drop, zb = s * 2.06, pts = Z(-0.8, 0.8, 16).map((x) => V3(x, y, zb - s * 0.12 * (x / 0.8) ** 2));
    const bl = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), full ? 60 : 16, 0.04, full ? 10 : 5), MAT.chrome); bl.scale.y = 1.4; bl.position.y = -y * 0.4;
    for (const bx of [-0.42, 0.42]) { const br = mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), MAT.black); br.position.set(bx, y - 0.02, zb - s * 0.09); if (full) { const o = mesh(new THREE.CapsuleGeometry(0.025, 0.12, 4, 10), MAT.chrome); o.position.set(bx * 0.75, y + 0.06, zb + s * 0.0); } }
    if (s > 0) { const pl = mesh(new THREE.PlaneGeometry(0.36, 0.12), plateMat(spec.plate)); pl.position.set(0, y - 0.1, zb + 0.03); }
    else { const pl = mesh(new THREE.PlaneGeometry(0.36, 0.12), plateMat(spec.plate)); pl.rotation.y = Math.PI; pl.position.set(0, 0.6 - drop, -1.97); const lt = mesh(new THREE.BoxGeometry(0.16, 0.05, 0.06), MAT.chrome); lt.position.set(0, 0.69 - drop, -1.96); } }
  // door handles, mirror, exhaust (twin pea-shooters)
  for (const s of [-1, 1]) { const dh = side(-0.22, belt(-0.22) - 0.07, s); if (dh) { const h = mesh(new THREE.CapsuleGeometry(0.011, 0.1, 4, 8), MAT.chrome); h.rotation.x = Math.PI / 2; h.position.copy(dh.p).addScaledVector(dh.n, 0.012); } }
  if (full) { const mh = side(0.55, belt(0.55) + 0.01, 1); if (mh) { const g = new THREE.Group(); g.position.copy(mh.p); body.add(g); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.12, 6), MAT.chrome); st.rotation.z = -0.9; st.position.set(0.05, 0.04, 0); g.add(st); const hd = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 8), MAT.chrome); hd.scale.set(0.5, 1, 1.2); hd.position.set(0.1, 0.08, 0); g.add(hd); } }
  if (baja) { // tube bumpers, exposed engine, stinger exhaust
    const T = (pts, r = 0.028) => (r *= 1.3, 0) ||  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => V3(x, y - drop, z)), false, 'catmullrom', 0.1), full ? 48 : 14, r, full ? 10 : 5), MAT.black);
    T([[-0.62, 0.42, 1.45], [-0.62, 0.42, 1.78], [-0.5, 0.42, 1.86], [0.5, 0.42, 1.86], [0.62, 0.42, 1.78], [0.62, 0.42, 1.45]]);
    T([[-0.45, 0.42, 1.86], [-0.42, 0.72, 1.7], [0.42, 0.72, 1.7], [0.45, 0.42, 1.86]], 0.022);
    T([[-0.62, 0.45, -1.5], [-0.62, 0.45, -2.05], [-0.5, 0.45, -2.12], [0.5, 0.45, -2.12], [0.62, 0.45, -2.05], [0.62, 0.45, -1.5]]);
    for (const s of [-1, 1]) T([[s * 0.55, 0.45, -2.1], [s * 0.5, 0.86, -1.95], [s * 0.45, 0.92, -1.62]], 0.022);
    T([[-0.5, 0.86, -1.95], [0.5, 0.86, -1.95]], 0.02);
    const al = new THREE.MeshStandardMaterial({ color: '#b9bbbe', roughness: 0.5, metalness: 0.7 }), eg = new THREE.Group(); eg.position.set(0, 0.52 - drop, -1.84); body.add(eg); const E2 = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; eg.add(o); return o; };
    E2(new THREE.BoxGeometry(0.62, 0.3, 0.42), al, 0, 0, 0); E2(new THREE.CylinderGeometry(0.2, 0.2, 0.32, full ? 28 : 10).rotateZ(Math.PI / 2), MAT.black, 0, 0.27, -0.05);
    for (const s of [-1, 1]) { E2(new THREE.BoxGeometry(0.16, 0.22, 0.4), MAT.black, s * 0.4, -0.02, 0); for (let i = 0; i < (full ? 6 : 2); i++) E2(new THREE.BoxGeometry(0.02, 0.2, 0.38), al, s * (0.33 + i * 0.026), -0.02, 0); }
    E2(new THREE.CylinderGeometry(0.11, 0.09, 0.2, full ? 20 : 8), MAT.chrome, 0.18, 0.5, 0.06); E2(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 12), MAT.black, -0.16, 0.42, 0.06);
    const st = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(0, 0.34 - drop, -1.95), V3(0, 0.44 - drop, -2.1), V3(0, 0.68 - drop, -2.18)]), full ? 24 : 8, 0.04, full ? 12 : 6, false), MAT.chrome);
    const pl = mesh(new THREE.PlaneGeometry(0.36, 0.12), plateMat(spec.plate)); pl.position.set(0, 0.62 - drop, 1.75); pl.rotation.x = -0.2;
    const pr = mesh(new THREE.PlaneGeometry(0.36, 0.12), plateMat(spec.plate)); pr.rotation.y = Math.PI; pr.position.set(0, 0.62 - drop, -2.13); }
  if (!baja) for (const ex of [-0.26, 0.26]) { const p = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, full ? 14 : 6, 1, true).rotateX(Math.PI / 2), MAT.chrome); p.position.set(ex, 0.3 - drop, -2.0); }
  { // cut window openings out of the body shell so the glass is see-through
    const pa = bodyMesh.geometry.attributes.position, ix = bodyMesh.geometry.index.array, keep = [], c = new THREE.Vector3();
    const inWin = (x, y, z) => { const ax = Math.abs(x);
      if (ax > 0.3 && z > -0.93 && z < 0.58 && y > belt(z) + 0.055 && y < roof(z) - 0.085 && !(z > -0.3 && z < -0.18)) return true;
      if (ax < 0.4 && z > 0.42 && z < 0.82 && y > belt(0.7) + 0.09 && y < roof(z) - 0.07) return true;
      if (ax < 0.28 && z < -1.0 && z > -1.5 && y > belt(-1.1) + 0.16 && y < belt(-1.1) + 0.32) return true; return false; };
    for (let i = 0; i < ix.length; i += 3) { c.set(0, 0, 0); for (let k = 0; k < 3; k++) c.x += pa.getX(ix[i + k]) / 3, c.y += pa.getY(ix[i + k]) / 3, c.z += pa.getZ(ix[i + k]) / 3; if (!inWin(c.x, c.y, c.z)) keep.push(ix[i], ix[i + 1], ix[i + 2]); }
    bodyMesh.geometry.setIndex(keep); bodyMesh.material = bodyMesh.material.clone(); bodyMesh.material.side = THREE.DoubleSide; }
  // fender beading (rubber welt where each fender meets the body)
  for (const s of [-1, 1]) for (const [a, b] of (baja ? [[0.75, 1.58], [-1.6, -0.82]] : [[0.6, 1.9], [-1.95, -0.66]])) tubeOn(Z(a, b, 30).map((z) => hit(V3(s * 0.535, 3, z), V3(0, -1, 0), fenders)), 0.009, MAT.rubber, 0.0, 40);
  // trait extras
  const E = spec.extras || 0, has = (i) => !!(E & (1 << i));
  for (const s of [-1, 1]) {
    if (has(2)) { strip(60, (t) => side(-0.95 + t * 1.55, belt(0) - 0.075, s), (t) => side(-0.95 + t * 1.55, belt(0) - 0.087, s), MAT.gold, 0.005); }
    if (has(7)) { strip(40, (t) => side(-0.9 + t * 1.5, yb(0) + 0.1, s), (t) => side(-0.9 + t * 1.5, yb(0) + 0.125, s), MAT.chrome, 0.006);
      tubeOn(Z(0.55, 0.85, 12).map((z) => sideOut(z, 0.0 + 0.62 - drop + (z - 0.55) * 0.5, s)), 0.006, MAT.chrome, 0.004, 12); }
    if (has(5)) { const f = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 16).rotateX(Math.PI / 2), MAT.lens); f.position.set(s * (baja ? 0.25 : 0.45), (baja ? 0.82 : 0.47) - drop, baja ? 1.72 : 2.06); }
  }
  if (has(0)) { const ry = roof(-0.1) + 0.035, r = new THREE.Group(); r.position.set(0, ry, -0.15); body.add(r);
    for (const fx of [-0.45, 0.45]) for (const fz of [-0.65, 0.35]) { const h = topd(fx, fz); if (!h) continue; const ht = ry - h.p.y; const f = new THREE.Mesh(new THREE.BoxGeometry(0.04, ht, 0.06), MAT.black); f.position.set(fx * 1.06, -ht / 2, fz + 0.15); r.add(f); const pad = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.1), MAT.rubber); pad.position.set(fx * 1.06, -ht, fz + 0.15); r.add(pad); } for (const x of [-0.5, 0.5]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.3), MAT.chrome); b.position.x = x; r.add(b); } for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.02, 0.03), MAT.black); b.position.z = -0.55 + i * 0.275; r.add(b); } }
  // wheels (stance-aware track)
  const tr = TRACK + (baja ? 0.06 : 0) + (spec.stance === 2 || spec.stance === 4 ? 0.02 : 0);
  for (const sx of [-1, 1]) for (const az of [AXF, AXR]) { const w = spec.wheels === 1 ? steelie(spec, wr, full, paint) : wheel(spec.wheels, wr, full); if (baja) { w.scale.z = 1.4; if (full || true) knobs(w, wr, full); } w.position.set(sx * tr, wr, az); w.rotation.y = sx * Math.PI / 2; car.add(w); }
  mesh(new THREE.BoxGeometry(1.0, 0.05, 3.0), MAT.black).position.set(0, yb(0) + 0.03, -0.05);
  car.userData = { body }; return car;
}
let plates = {};
function plateMat(kind) { if (plates[kind]) return plates[kind]; const cv = document.createElement('canvas'); cv.width = 256; cv.height = 84; const x = cv.getContext('2d');
  x.fillStyle = kind === 1 ? '#d9dee6' : kind === 2 ? '#e8f7ff' : '#f2efe4'; x.fillRect(0, 0, 256, 84); x.strokeStyle = '#1d3557'; x.lineWidth = 6; x.strokeRect(4, 4, 248, 76);
  x.fillStyle = '#1d3557'; x.font = '900 46px Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('VWFEST', 128, 48); x.font = '700 13px Arial'; x.fillText('CALIFORNIA · SHOW GROUNDS', 128, 15);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return (plates[kind] = new THREE.MeshStandardMaterial({ map: t, metalness: kind === 1 ? 0.6 : 0, roughness: 0.3 })); }

// steel wheel: painted pressed disc with vent slots + chrome dome hubcap (type 0 adds a full chrome cap + beauty ring)
function steelie(spec, r, full, paint) { const g = wheel(2, r, full); g.children.slice().forEach((o) => { if (o.position.z > 0.03 && o.geometry.type !== 'LatheGeometry' && o.geometry.type !== 'TorusGeometry') g.remove(o); });
  const W = 0.16, m = (geo, mat) => { const o = new THREE.Mesh(geo, mat); o.castShadow = true; g.add(o); return o; };
  const disc = new THREE.MeshStandardMaterial({ color: spec.wheels === 1 ? '#e9e6dc' : '#cfd3d8', roughness: 0.35, metalness: 0.3 });
  const prof = [[0.188, 0], [0.18, 0.012], [0.15, 0.02], [0.12, 0.012], [0.095, 0.03], [0.07, 0.034], [0.0, 0.034]].map(([x, y]) => new THREE.Vector2(x, y));
  m(new THREE.LatheGeometry(prof, full ? 40 : 16).rotateX(Math.PI / 2), disc).position.z = W / 2 - 0.04;
  for (let i = 0; i < (full ? 8 : 0); i++) { const a = i / 8 * Math.PI * 2, v = m(new THREE.CapsuleGeometry(0.008, 0.02, 2, 6), MAT.black); v.position.set(Math.cos(a) * 0.135, Math.sin(a) * 0.135, W / 2 - 0.018); v.rotation.z = a; }
  const cap = m(new THREE.SphereGeometry(spec.wheels === 0 ? 0.15 : 0.085, full ? 28 : 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.chrome); cap.rotation.x = Math.PI / 2; cap.scale.y = spec.wheels === 0 ? 0.22 : 0.4; cap.position.z = W / 2 - 0.006;
  if (spec.wheels === 0) m(new THREE.TorusGeometry(0.175, 0.01, 6, full ? 40 : 16), MAT.chrome).position.z = W / 2 - 0.015;
  return g; }

function knobs(w, r, full) { const n = full ? 30 : 14, g = new THREE.BoxGeometry(0.05, 0.022, 0.065);
  for (let i = 0; i < n; i++) for (const k of [-1, 1]) { const a = (i + (k > 0 ? 0.5 : 0)) / n * Math.PI * 2, b = new THREE.Mesh(g, MAT.tire); b.position.set(Math.cos(a) * (r - 0.004), Math.sin(a) * (r - 0.004), k * 0.035); b.rotation.z = a + Math.PI / 2; b.castShadow = true; w.add(b); } }
