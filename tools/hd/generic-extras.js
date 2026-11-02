// Trait extras the per-model HD builders don't model yet, projected onto the baked HD skin (raycasts), so every NFT trait shows.
import * as THREE from 'three';
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export function genericExtras(skinItems, missing) {
  const meshes = skinItems.map((it) => new THREE.Mesh(it.g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))); const rc = new THREE.Raycaster();
  const box = new THREE.Box3(); for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); }
  const hit = (o, d) => { rc.set(o, d); const h = rc.intersectObjects(meshes, false)[0]; if (!h) return null; const n = h.face.normal.clone(); if (n.dot(d) > 0) n.negate(); return { p: h.point.clone(), n }; };
  const side = (z, y, s) => { const h = hit(V3(s * 3, y, z), V3(-s, 0, 0)); return h && Math.abs(h.p.x) > 0.25 ? h : null; };
  const top = (x, z) => hit(V3(x, 5, z), V3(0, -1, 0)); const front = (x, y) => hit(V3(x, y, box.max.z + 2), V3(0, 0, -1));
  const zl = box.min.z, zh = box.max.z, L = zh - zl, H = box.max.y; const out = {};
  const item = (g, role, color, ds = false) => ({ g, role, col: new THREE.Color(color), side: ds ? THREE.DoubleSide : THREE.FrontSide, wheel: false });
  const geo = (pos, idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  const strip = (n, fa, fb, eps = 0.005) => { const pos = [], idx = []; let prev = -1; for (let i = 0; i <= n; i++) { const A = fa(i / n), B = fb(i / n); if (!A || !B) { prev = -1; continue; } const k = pos.length / 3; pos.push(...A.p.addScaledVector(A.n, eps).toArray(), ...B.p.addScaledVector(B.n, eps).toArray()); if (prev >= 0) idx.push(prev, prev + 1, k, prev + 1, k + 1, k); prev = k; } return idx.length ? geo(pos, idx) : null; };
  const patch = (proj, nu, nv, eps = 0.005) => { const pos = [], idx = [], ok = []; for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const h = proj(i / nu, j / nv); ok.push(!!h); pos.push(...(h ? h.p.addScaledVector(h.n, eps).toArray() : [0, 0, 0])); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; if (ok[a] && ok[b] && ok[a + 1] && ok[b + 1]) idx.push(a, b, a + 1, b, b + 1, a + 1); } return idx.length ? geo(pos, idx) : null; };
  const put = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };
  // belt line: the height of max half-width at mid-body
  let beltY = H * 0.5, bw = 0; for (let y = 0.3; y < H - 0.2; y += 0.02) { const h = side(0, y, 1); if (h && h.p.x > bw) { bw = h.p.x; beltY = y; } }
  // roof: longest run of high top hits
  const roofZ = []; for (let z = zl + 0.2; z < zh - 0.2; z += 0.05) { const h = top(0, z); if (h && h.p.y > H - 0.12) roofZ.push(z); } const rz0 = roofZ.length ? Math.min(...roofZ) : -0.5, rz1 = roofZ.length ? Math.max(...roofZ) : 0.5, rzc = (rz0 + rz1) / 2, rlen = Math.max(0.8, rz1 - rz0);
  const roofW = (() => { let w = 0.3; for (let x = 0.05; x < 1; x += 0.03) { const h = top(x, rzc); if (h && h.p.y > H - 0.15) w = x; } return w; })();
  for (const bit of missing) { const L2 = [];
    if (bit === 0 || bit === 1) { const y = H + 0.09; // roof rack (surfboard sits on one)
      for (const s of [-1, 1]) { L2.push(item(put(new THREE.CylinderGeometry(0.016, 0.016, rlen, 8), s * roofW * 0.8, y, rzc, Math.PI / 2), 'matte', '#202226')); for (const z of [rz0 + 0.1, rz1 - 0.1]) L2.push(item(put(new THREE.BoxGeometry(0.04, 0.1, 0.05), s * roofW * 0.8, y - 0.05, z), 'matte', '#202226')); }
      for (let i = 0; i < 3; i++) L2.push(item(put(new THREE.CylinderGeometry(0.014, 0.014, roofW * 1.6, 8), 0, y, rz0 + 0.15 + i * (rlen - 0.3) / 2, 0, 0, Math.PI / 2), 'matte', '#202226'));
      if (bit === 1) { const sb = new THREE.SphereGeometry(1, 24, 10); sb.scale(0.26, 0.035, Math.max(1.05, rlen * 0.62)); L2.push(item(put(sb, 0, y + 0.05, rzc), 'matte', '#ffd166')); const st = new THREE.SphereGeometry(1, 16, 6); st.scale(0.05, 0.037, Math.max(1, rlen * 0.6)); L2.push(item(put(st, 0, y + 0.052, rzc), 'matte', '#ff4fa3')); } }
    if (bit === 2) for (const s of [-1, 1]) { const g1 = strip(60, (t) => side(zl + 0.35 + t * (L - 0.7), beltY + 0.006, s), (t) => side(zl + 0.35 + t * (L - 0.7), beltY - 0.006, s)); if (g1) L2.push(item(g1, 'matte', '#ffe27a', true));
      const g2 = strip(60, (t) => side(zl + 0.4 + t * (L - 0.8), beltY - 0.022, s), (t) => side(zl + 0.4 + t * (L - 0.8), beltY - 0.03, s)); if (g2) L2.push(item(g2, 'matte', '#ffffff', true)); }
    if (bit === 3) for (const s of [-1, 1]) for (const [cz, cy, rz, ry, c] of [[-0.3, -0.05, 0.55, 0.16, '#ff4fa3'], [0.0, 0.1, 0.3, 0.12, '#06d6a0'], [-0.75, -0.12, 0.22, 0.1, '#ffd166'], [0.35, -0.1, 0.18, 0.09, '#4ea8ff']]) {
      const g = patch((u, v) => { const a = u * Math.PI * 2, r = v; return side(cz * L / 4 + Math.cos(a) * rz * r, beltY - 0.12 + cy + Math.sin(a) * ry * r, s); }, 24, 4, 0.004 + (c === '#ff4fa3' ? 0 : 0.001)); if (g) L2.push(item(g, 'matte', c, true)); }
    if (bit === 4) { const zf = zh - 0.15; for (const x of [-0.13, 0.13]) { const g = patch((u, v) => top(x - 0.05 + u * 0.1, zf - v * L * 0.45), 2, 30, 0.004); if (g) L2.push(item(g, 'matte', '#ffffff', true)); } }
    if (bit === 5) for (const x of [-0.4, 0.4]) { let h = null; for (let y = 0.25; y < 0.7 && !h; y += 0.03) h = front(x, y); if (!h) continue; const c = new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16); c.rotateX(Math.PI / 2); c.translate(h.p.x, h.p.y, h.p.z + 0.06); L2.push(item(c, 'lamp', '#fff27a')); const r = new THREE.TorusGeometry(0.062, 0.01, 6, 16); r.translate(h.p.x, h.p.y, h.p.z + 0.095); L2.push(item(r, 'metal', '#f2f4f7')); }
    if (bit === 6) { const z = zl + 0.22; const t = top(0, z) || top(0, z + 0.2); const y = (t ? t.p.y : H * 0.7) + 0.16; const w = Math.min(bw * 2 - 0.1, 1.5);
      L2.push(item(put(new THREE.BoxGeometry(w, 0.035, 0.3), 0, y, z, -0.08), 'matte', '#222222')); for (const s of [-1, 1]) L2.push(item(put(new THREE.BoxGeometry(0.04, 0.18, 0.12), s * w * 0.3, y - 0.09, z), 'matte', '#222222')); }
    if (bit === 8) for (const s of [-1, 1]) for (const [y0, len, w, ph, c] of [[0.0, 0.5, 0.11, 0, '#ff6b00'], [-0.08, 0.38, 0.08, 1.3, '#ffb703'], [0.07, 0.42, 0.07, 2.1, '#ff6b00'], [-0.03, 0.3, 0.05, 0.7, '#ffd23f']]) {
      const z0 = zh - L * 0.22, yy = beltY - 0.1 + y0, ln = len * L; const g = strip(40, (t) => side(z0 - t * ln, yy + 0.03 * Math.sin(t * 7 + ph) * t + w * Math.pow(1 - t, 0.8) * Math.min(1, t * 8) / 2, s), (t) => side(z0 - t * ln, yy + 0.03 * Math.sin(t * 7 + ph) * t - w * Math.pow(1 - t, 0.8) * Math.min(1, t * 8) / 2, s), c === '#ff6b00' ? 0.005 : 0.007); if (g) L2.push(item(g, 'matte', c, true)); }
    if (L2.length) out['x' + bit] = L2; }
  return out;
}
