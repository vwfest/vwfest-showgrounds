// Shared code-built helpers for ride cages (same method as v5 Ghia): hand-set cross-section stations ->
// uniform bicubic B-spline (Catmull-Clark limit of a regular quad cage), arch cutouts, raycast-projected trim.
import * as THREE from 'three';
export { paintMaterial, wheel } from './ghia.js';
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const keys = (zs, ys) => { const n = zs.length, m = ys.map((_, i) => i === 0 ? (ys[1] - ys[0]) / (zs[1] - zs[0]) : i === n - 1 ? (ys[n - 1] - ys[n - 2]) / (zs[n - 1] - zs[n - 2]) : (ys[i + 1] - ys[i - 1]) / (zs[i + 1] - zs[i - 1]));
  return (z) => { if (z <= zs[0]) return ys[0]; for (let i = 1; i < n; i++) if (z <= zs[i]) { const h = zs[i] - zs[i - 1], t = (z - zs[i - 1]) / h, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * ys[i - 1] + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * ys[i] + (t3 - t2) * h * m[i]; } return ys[n - 1]; }; };
export const DROP = [0, 0.04, 0.08, -0.12, 0.06];
export const MAT = {
  chrome: new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.05, metalness: 1 }),
  anod: new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.45, metalness: 0.5 }),
  black: new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.6 }),
  gap: new THREE.MeshBasicMaterial({ color: '#030405', side: THREE.DoubleSide }),
  rubber: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.7, side: THREE.DoubleSide }),
  liner: new THREE.MeshStandardMaterial({ color: '#060607', roughness: 1, side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#16222b', roughness: 0, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.6, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  lens: new THREE.MeshPhysicalMaterial({ color: '#fffaf0', roughness: 0.04, emissive: '#fff4d0', emissiveIntensity: 0.25, clearcoat: 1 }),
  amber: new THREE.MeshPhysicalMaterial({ color: '#ff9a1f', roughness: 0.1, emissive: '#6a3000', emissiveIntensity: 0.5, clearcoat: 1 }),
  tail: new THREE.MeshPhysicalMaterial({ color: '#a50f19', roughness: 0.12, emissive: '#5a0006', emissiveIntensity: 0.6, clearcoat: 1 }),
  leather: new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.6 }),
  canvas: new THREE.MeshStandardMaterial({ color: '#2b2a26', roughness: 0.95, side: THREE.DoubleSide }),
  wood: new THREE.MeshStandardMaterial({ color: '#c99a5b', roughness: 0.5 }),
  gold: new THREE.MeshStandardMaterial({ color: '#ffd76a', roughness: 0.3, metalness: 0.5, side: THREE.DoubleSide }),
  white: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, side: THREE.DoubleSide }),
  flameO: new THREE.MeshPhysicalMaterial({ color: '#ff4d00', roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide }),
  flameY: new THREE.MeshPhysicalMaterial({ color: '#ffc300', roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide }),
};
// stations: array of rings (closed loops of Vector3). ends are clamped by tripling the first/last station.
export function cageSurface(stations, { full = true, arches = [], ra = 0.36, wr = 0.32, ax = 0.42 } = {}) {
  const N = stations.length, S = [stations[0], stations[0], ...stations, stations[N - 1], stations[N - 1]], M = S[0].length;
  const B = (t) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6];
  const ru = full ? 4 : 2, rv = full ? 4 : 2, nu = (S.length - 3) * ru, nv = M * rv, pos = [], idx = [], v = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) { const su = Math.min(Math.floor(i / ru), S.length - 4), bu = B(i / ru - su);
    for (let j = 0; j <= nv; j++) { const sv = Math.floor(j / rv) % M, bv = B(j / rv - Math.floor(j / rv)); v.set(0, 0, 0);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) v.addScaledVector(S[su + a][(sv + b) % M], bu[a] * bv[b]);
      let y = v.y; for (const az of arches) { const dz = v.z - az; if (Math.abs(dz) < ra && Math.abs(v.x) > ax) { const ay = wr + Math.sqrt(ra * ra - dz * dz); if (y < ay) y = ay; } }
      pos.push(v.x, y, v.z); } }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// half profile [[x,y]...] (bottom-centre side -> top-centre side, x>=0) -> closed ring at z
// half profile [[x,y(,c)]...] bottom-centre -> top-centre (x>=0) -> closed ring at z. A third element c=true marks a crease:
// the cage point is tripled, which makes the cubic B-spline limit surface pass sharply through it (hard edge).
let CREASE = true; export const setCrease = (on) => { CREASE = on; }; // LOD drops the tripling to stay in budget
export const ring = (half, z, fz = () => z) => { const h = half.filter((p, i) => i > 0 && i < half.length - 1);
  const ex = (a) => a.flatMap((p) => p[2] && CREASE ? [p, p, p] : [p]);
  return [half[0], ...ex(h), half[half.length - 1], ...ex(h.slice().reverse()).map(([x, y]) => [-x, y])].map(([x, y]) => V3(x, y, fz(x, y))); };
export function kit(body, full) {
  const add = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; body.add(m); return m; };
  const rc = new THREE.Raycaster(); let skin = [];
  const hit = (o, d) => { rc.set(o, d); const h = rc.intersectObjects(skin, false)[0]; if (!h) return null; const n = h.face.normal.clone(); if (n.dot(d) > 0) n.negate(); return { p: h.point.clone(), n }; };
  const side = (z, y, s) => { const h = hit(V3(s * 3, y, z), V3(-s, 0, 0)); return h && Math.abs(h.p.x) > 0.25 ? h : null; };
  const front = (x, y, s = 1) => hit(V3(x, y, s * 5), V3(0, 0, -s));
  const topd = (x, z) => hit(V3(x, 4, z), V3(0, -1, 0));
  const strip = (n, fa, fb, mat, eps = 0.004) => { const pos = [], idx = []; let prev = -1;
    for (let i = 0; i <= n; i++) { const A = fa(i / n), B = fb(i / n); if (!A || !B) { prev = -1; continue; }
      const k = pos.length / 3; pos.push(...A.p.addScaledVector(A.n, eps).toArray(), ...B.p.addScaledVector(B.n, eps).toArray()); if (prev >= 0) idx.push(prev, prev + 1, k, prev + 1, k + 1, k); prev = k; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return add(g, mat, false); };
  const patch = (proj, nu, nv, mat, eps) => { const pos = [], idx = [], ok = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const h = proj(i / nu, j / nv); ok.push(!!h); pos.push(...(h ? h.p.clone().addScaledVector(h.n, eps).toArray() : [0, 0, 0])); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; if (ok[a] && ok[b] && ok[a + 1] && ok[b + 1]) idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return add(g, mat, false); };
  const tubeOn = (hits, r, mat, out = 0, seg = 48) => { const pts = hits.filter(Boolean).map((h) => h.p.clone().addScaledVector(h.n, out)); if (pts.length < 2) return; return add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, full ? 8 : 4), mat); };
  const placeOn = (h, obj, out = 0, bias = V3(0, 0, 0)) => { const n = h.n.clone().add(bias).normalize(); obj.position.copy(h.p).addScaledVector(n, out); obj.lookAt(obj.position.clone().add(n)); body.add(obj); return obj; };
  const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; return o; };
  const Z = (a, b, n = 60) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  // framed window: glass patch + rubber surround, projected onto the side skin
  const sideWin = (s, z0, z1, y0, y1, r = 0.06) => { const inR = (z, y) => { const dz = Math.max(z0 + r - z, 0, z - z1 + r), dy = Math.max(y0 + r - y, 0, y - y1 + r); return dz * dz + dy * dy <= r * r + 1e-6; };
    patch((u, v) => { const z = z0 + u * (z1 - z0), y = y0 + v * (y1 - y0); if (!inR(z, y)) { /* clamp to rounded corner */ const cz = Math.min(Math.max(z, z0 + r), z1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r), a = Math.atan2(y - cy, z - cz); return side(cz + Math.cos(a) * r, cy + Math.sin(a) * r, s); } return side(z, y, s); }, full ? 16 : 6, full ? 8 : 3, MAT.glass, 0.004);
    const loop = []; const n = 40; for (let i = 0; i <= n; i++) { const t = i / n * 4; let z, y; const c = [[z1 - r, y1 - r, 0], [z0 + r, y1 - r, Math.PI / 2], [z0 + r, y0 + r, Math.PI], [z1 - r, y0 + r, 1.5 * Math.PI]]; const k = Math.min(3, Math.floor(t)), a = c[k][2] + (t - k) * Math.PI / 2; z = c[k][0] + Math.cos(a) * r; y = c[k][1] + Math.sin(a) * r; loop.push(side(z, y, s)); }
    tubeOn(loop, full ? 0.011 : 0.012, MAT.rubber, 0.002, full ? 80 : 32); }; // r5: rubber seal baked at every LOD
  const gapV = (s, z, ya, yb) => strip(16, (t) => side(z + 0.0035, ya + t * (yb - ya), s), (t) => side(z - 0.0035, ya + t * (yb - ya), s), MAT.gap, 0.002);
  const gapH = (s, y, za, zb) => strip(30, (t) => side(za + t * (zb - za), y + 0.0035, s), (t) => side(za + t * (zb - za), y - 0.0035, s), MAT.gap, 0.002);
  return { hitRay: hit, add, setSkin: (a) => { skin = a; }, side, front, topd, strip, patch, tubeOn, placeOn, mesh, Z, sideWin, gapV, gapH };
}
export function plateMat(kind) { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 84; const x = cv.getContext('2d');
  x.fillStyle = kind === 2 ? '#bfe9ff' : kind === 1 ? '#d9dde2' : '#f3efe2'; x.fillRect(0, 0, 256, 84); x.strokeStyle = '#222'; x.lineWidth = 5; x.strokeRect(4, 4, 248, 76);
  x.fillStyle = '#1b2a4a'; x.font = 'bold 50px Arial'; x.textAlign = 'center'; x.fillText('VWFEST', 128, 62); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: kind ? 0.2 : 0.5, metalness: kind === 1 ? 0.6 : 0 }); }
// r4: headlamp optics read through the lens: chrome reflector rings (Fresnel steps) + bulb, sat on the lens dome.
// Lens = hemisphere radius R, dome along +z scaled to height h, base at z0. Merges into the metal/lamp roles (no new draw calls).
export function lensDetail(g, R, z0 = 0, full = true, h = 0.3) { // baked at every LOD
  for (const k of [0.38, 0.62, 0.84]) { const rho = R * k, z = z0 + R * h * Math.sqrt(1 - k * k) + 0.0015; const t = new THREE.Mesh(new THREE.TorusGeometry(rho, 0.0022, 3, 28), MAT.chrome); t.position.z = z; g.add(t); }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(R * 0.16, 10, 6), MAT.lens); bulb.position.z = z0 + R * h + 0.004; g.add(bulb);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(R * 0.1, 12), MAT.chrome); cap.position.z = z0 + R * h + 0.004 + R * 0.165; g.add(cap); }
// r5: tail lamp lens detail: chrome bezel + horizontal prism ribs over the red lens (box w x h, face at z)
export function tailDetail(g, w, h, z = 0.016, round = false) {
  if (round) { const r = new THREE.Mesh(new THREE.TorusGeometry(w, 0.006, 4, 20), MAT.chrome); r.position.z = z; g.add(r); for (const k of [0.4, 0.7]) { const t = new THREE.Mesh(new THREE.TorusGeometry(w * k, 0.0025, 3, 16), MAT.gap); t.position.z = z + 0.001; g.add(t); } return; }
  for (const [bw, bh, x, y] of [[w + 0.012, 0.006, 0, h / 2], [w + 0.012, 0.006, 0, -h / 2], [0.006, h, w / 2, 0], [0.006, h, -w / 2, 0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.01), MAT.chrome); b.position.set(x, y, z - 0.002); g.add(b); }
  for (let i = 1; i < 5; i++) { const rb = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.003, 0.004), MAT.gap); rb.position.set(0, -h / 2 + i * h / 5, z + 0.001); g.add(rb); } }
