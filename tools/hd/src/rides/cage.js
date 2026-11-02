// Ghia body as a hand-placed quad control cage (stations x ring points), evaluated as its
// Catmull-Clark limit surface (on a regular quad cage that is the uniform bicubic B-spline).
// Creases = doubled cage rows (beltline/shoulder). Values are set by eye from photos + published dims.
import * as THREE from 'three';
const keys = (zs, ys) => { const n = zs.length, m = ys.map((_, i) => i === 0 ? (ys[1] - ys[0]) / (zs[1] - zs[0]) : i === n - 1 ? (ys[n - 1] - ys[n - 2]) / (zs[n - 1] - zs[n - 2]) : (ys[i + 1] - ys[i - 1]) / (zs[i + 1] - zs[i - 1]));
  return (z) => { if (z <= zs[0]) return ys[0]; for (let i = 1; i < n; i++) if (z <= zs[i]) { const h = zs[i] - zs[i - 1], t = (z - zs[i - 1]) / h, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * ys[i - 1] + (t3 - 2 * t2 + t) * h * m[i - 1] + (-2 * t3 + 3 * t2) * ys[i] + (t3 - t2) * h * m[i]; } return ys[n - 1]; }; };
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const ZF = 2.07;
export const P = { // hand-set cage profiles (stock ride height), z front=+
  yb: keys([-2.07, -1.85, -1.2, 0, 1.2, 1.85, 2.07], [0.44, 0.3, 0.23, 0.21, 0.23, 0.3, 0.38]),
  ws: keys([-2.07, -1.8, -1.2, 0, 1.2, 1.8, 2.07], [0.48, 0.64, 0.71, 0.69, 0.71, 0.64, 0.48]),
  wm: keys([-2.07, -1.9, -1.55, -1.15, -0.6, -0.1, 0.5, 1.2, 1.6, 1.9, 2.07], [0.58, 0.72, 0.805, 0.817, 0.795, 0.778, 0.79, 0.81, 0.79, 0.7, 0.58]),
  ym: keys([-2.07, -1.2, 0, 1.2, 2.07], [0.54, 0.53, 0.5, 0.52, 0.48]),
  yc: keys([-2.07, -1.8, -1.2, -0.4, 0.4, 1.2, 1.7, 2.07], [0.6, 0.68, 0.71, 0.69, 0.67, 0.67, 0.64, 0.56]),
  wf: keys([-2.07, -1.8, -1.2, -0.4, 0.5, 1.2, 1.7, 2.07], [0.5, 0.66, 0.74, 0.715, 0.715, 0.73, 0.7, 0.56]),
  yf: keys([-2.07, -1.85, -1.25, -0.5, 0.5, 1.25, 1.75, 2.07], [0.54, 0.74, 0.85, 0.83, 0.83, 0.79, 0.7, 0.56]),
  top: keys([-2.07, -1.95, -1.75, -1.55, -1.3, -0.9, -0.5, -0.1, 0.2, 0.45, 0.7, 1.0, 1.5, 1.9, 2.07], [0.5, 0.62, 0.74, 0.84, 0.95, 1.12, 1.24, 1.3, 1.29, 1.15, 0.86, 0.77, 0.67, 0.55, 0.48]),
  cab: (z) => ss(-1.62, -1.45, z) * (1 - ss(0.6, 0.74, z)),
};
export function ghiaCage({ drop = 0, full = true, arches = [], ra = 0.36, wr = 0.315 } = {}) {
  const N = 34, stations = [];
  for (let i = 0; i < N; i++) { const z = -ZF + (i / (N - 1)) * 2 * ZF;
    const yb = P.yb(z), ws = P.ws(z), wm = P.wm(z), ym = P.ym(z), yc = P.yc(z), wf = P.wf(z), yf = P.yf(z), top = P.top(z), cf = P.cab(z);
    const p7n = [0.5, top + 0.035], p7c = [0.68, 0.86];
    const p7 = [p7n[0] + (p7c[0] - p7n[0]) * cf, p7n[1] + (p7c[1] - p7n[1]) * cf];
    const cabin = [[0.66, Math.max(0.9, p7[1] + 0.04)], [0.56, top - 0.06], [0.3, top - 0.012]];
    const hood = [[p7[0] * 0.72, top + 0.025], [p7[0] * 0.48, top + 0.012], [p7[0] * 0.24, top + 0.004]];
    const up = hood.map((h, k) => [h[0] + (cabin[k][0] - h[0]) * cf, h[1] + (cabin[k][1] - h[1]) * cf]);
    const wc = Math.max(wf + 0.02, wm - 0.012);
    let half = [[0.55 * ws, yb], [ws, yb + 0.03], [ws + (wm - ws) * 0.55, (yb + ym) / 2 - 0.01], [wm, ym], [wc, yc], Math.abs(z) > 1.45 ? [(wm + wf) / 2 + 0.01, (ym + yf) / 2 + 0.06] : [wc, yc], [wf, yf], p7, ...up];
    // nose / tail rounding
    const e = z > 1.72 ? (z - 1.72) / (ZF - 1.72) : z < -1.76 ? (-1.76 - z) / (ZF - 1.76) : 0;
    const yN = z > 0 ? 0.47 : 0.55, sx = Math.pow(Math.max(0, 1 - Math.pow(e, 2.2)), 0.5), sy = Math.pow(Math.max(0, 1 - Math.pow(e, 3.5)), 0.5);
    half = half.map(([x, y]) => [x * sx, yN + (y - yN) * sy]); const p0 = [0, yN + (yb - yN) * sy], p11 = [0, yN + (top - yN) * sy];
    const ring = [p0, ...half, p11, ...half.slice().reverse().map(([x, y]) => [-x, y])].map(([x, y]) => new THREE.Vector3(x, y - drop, z));
    stations.push(ring);
  }
  const S = [stations[0], stations[0], ...stations, stations[N - 1], stations[N - 1]], M = S[0].length;
  const B = (t) => [(1 - t) ** 3 / 6, (3 * t ** 3 - 6 * t ** 2 + 4) / 6, (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6, t ** 3 / 6];
  const ru = full ? 6 : 2, rv = full ? 6 : 2, nu = (S.length - 3) * ru, nv = M * rv;
  const pos = [], idx = [], v = new THREE.Vector3();
  for (let i = 0; i <= nu; i++) { const su = Math.min(Math.floor(i / ru), S.length - 4), tu = i / ru - su, bu = B(tu);
    for (let j = 0; j <= nv; j++) { const sv = Math.floor(j / rv) % M, tv = j / rv - Math.floor(j / rv), bv = B(tv); v.set(0, 0, 0);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) v.addScaledVector(S[su + a][(sv + b) % M], bu[a] * bv[b]);
      let x = v.x, y = v.y, z = v.z;
      for (const az of arches) { const dz = z - az; if (Math.abs(dz) < ra && Math.abs(x) > 0.42) { const ay = wr + Math.sqrt(ra * ra - dz * dz); if (y < ay) y = ay; } }
      pos.push(x, y, z); } }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const D = (f) => (z) => f(z) - drop;
  const top = D(P.top), ytop = (z) => { const cf = P.cab(z); return (P.top(z) + 0.035) * (1 - cf) + 0.86 * cf - drop; };
  return { geometry: g, cage: stations, ytop, ybot: D(P.yb), hwk: P.wm, roof: top, top, crease: D(P.yc), fenderTop: D(P.yf) };
}
