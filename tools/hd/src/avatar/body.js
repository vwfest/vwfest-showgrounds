// Procedural body: signed-distance "sculpt" (smooth-unioned primitives) -> surface nets -> meshopt simplify.
// 100% code-built. One continuous surface, so no joints at shoulders, elbows, wrists, hips or knees.
import { MeshoptSimplifier } from 'meshoptimizer';
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const sstep = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rcone(a, b, r1, r2) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  return (px, py, pz) => { const ax = px - a[0], ay = py - a[1], az = pz - a[2]; const y = ax * ba[0] + ay * ba[1] + az * ba[2], z = y - l2;
    const qx = ax * l2 - ba[0] * y, qy = ay * l2 - ba[1] * y, qz = az * l2 - ba[2] * y; const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1; };
}
function ell(c, r) { return (px, py, pz) => { const x = px - c[0], y = py - c[1], z = pz - c[2]; const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]), k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2])); return k1 < 1e-9 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1; }; }
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s], lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

// ---- the sculpt: returns prims [{f, bone, k, c, br}] + bone bind positions ----
export function sculpt(av) {
  const fem = av.sex === 1, bw = [0.9, 1, 1.13][av.body], sw = fem ? 0.9 : 1, hw = (fem ? 1.1 : 0.95) * Math.sqrt(bw), P = [];
  const E_ = (c, r, bone, k) => P.push({ f: ell(c, r), bone, k, c, br: Math.max(...r) });
  const R_ = (a, b, r1, r2, bone, k) => P.push({ f: rcone(a, b, r1, r2), bone, k, c: lerp3(a, b, 0.5), br: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + Math.max(r1, r2) });
  const B = { hips: [0, 0.95, 0], spine: [0, 1.08, 0], chest: [0, 1.26, 0], neck: [0, 1.45, -0.012], head: [0, 1.6, 0] };
  // torso
  E_([0, 0.935, -0.008], [0.152 * hw, 0.11, 0.104 * Math.sqrt(bw)], 'hips', 0.04);
  E_([0, 1.07, 0.0], [0.138 * bw * (fem ? 0.92 : 1.06), 0.125, 0.098 * bw], 'spine', 0.06); if (!fem) E_([0, 0.99, -0.004], [0.146 * bw, 0.08, 0.1 * bw], 'hips', 0.06);
  E_([0, 1.25, -0.006], [(fem ? 0.158 : 0.166) * bw * sw, 0.15, (fem ? 0.104 : 0.097) * bw], 'chest', 0.06); if (!fem) E_([0, 1.295, 0.004], [0.128 * bw, 0.07, 0.088 * bw], 'chest', 0.05);
  E_([0, 1.355, -0.012], [0.148 * bw * sw, 0.085, 0.088 * bw], 'chest', 0.05);
  for (const s of [-1, 1]) {
    if (fem) E_([s * 0.066, 1.272, 0.062 * bw], [0.06, 0.056, 0.055], 'chest', 0.03); else { /* male: flat chest plane */ }
    R_([s * 0.035, 1.452, -0.018], [s * (fem ? 0.15 : 0.162) * sw * bw, 1.41, -0.018], 0.05, 0.042, 'chest', 0.04); // trapezius / shoulder line
  }
  R_([0, 1.4, -0.016], [0, 1.62, -0.002], fem ? 0.05 : 0.062, fem ? 0.044 : 0.054, 'neck', 0.035);
  for (const s of [-1, 1]) {
    const sd = s > 0 ? 'L' : 'R';
    const S = [s * ((fem ? 0.185 : 0.196) * sw * Math.sqrt(bw)), 1.39, -0.016], Ee = [s * ((fem ? 0.232 : 0.228) * sw * Math.sqrt(bw) + 0.01 * (bw - 1)), 1.115, -0.04], W = [s * ((fem ? 0.248 : 0.236) * sw * Math.sqrt(bw)), 0.868, 0.012];
    B['upperArm' + sd] = S; B['foreArm' + sd] = Ee; B['hand' + sd] = W;
    E_([S[0] + s * 0.006, 1.38, -0.012], [0.046 * bw, 0.06, 0.05 * bw], 'upperArm' + sd, 0.03);
    R_(S, Ee, 0.043 * bw, 0.034 * bw, 'upperArm' + sd, 0.014);
    E_(lerp3(S, Ee, 0.45), [0.04 * bw, 0.08, 0.044 * bw], 'upperArm' + sd, 0.02);
    R_(Ee, W, 0.036 * bw, 0.024 * Math.sqrt(bw), 'foreArm' + sd, 0.016);
    E_(lerp3(Ee, W, 0.28), [0.039 * bw, 0.075, 0.042 * bw], 'foreArm' + sd, 0.025);
    // hand: palm faces the thigh (-s*x), fingers point down, thumb forward
    const hs = fem ? 0.92 : 1, hb = 'hand' + sd, w = (dx, dy, dz) => [W[0] + s * dx * hs, W[1] + dy * hs, W[2] + dz * hs];
    E_(w(-0.002, -0.048, 0.004), [0.0145 * hs, 0.05 * hs, 0.041 * hs], hb, 0.018);
    const FZ = [0.0285, 0.0095, -0.0095, -0.0275], FL = [0.074, 0.083, 0.077, 0.061], FR = [0.0077, 0.008, 0.0076, 0.0066];
    for (let f = 0; f < 4; f++) {
      let p = w(-0.002, -0.093 + (f === 0 || f === 3 ? 0.006 : 0), FZ[f]); let ang = 0.08; const fan = (f - 1.5) * 0.07; const segs = [0.45, 0.31, 0.24];
      for (let j = 0; j < 3; j++) { ang += [0.08, 0.2, 0.18][j]; const L = FL[f] * segs[j] * hs; const d = norm([-s * Math.sin(ang), -Math.cos(ang), Math.sin(fan)]); const q = add(p, mul(d, L)); const r1 = FR[f] * hs * (1 - j * 0.1), r2 = FR[f] * hs * (0.9 - j * 0.1); R_(p, q, r1, r2, hb, j === 0 ? 0.006 : 0.002); p = q; }
    }
    { let p = w(-0.006, -0.028, 0.026); const pts = [w(-0.014, -0.056, 0.05), w(-0.02, -0.08, 0.061), w(-0.024, -0.098, 0.064)], rr = [0.0125, 0.0098, 0.0082, 0.0068]; for (let j = 0; j < 3; j++) { R_(p, pts[j], rr[j] * hs, rr[j + 1] * hs, hb, j === 0 ? 0.014 : 0.004); p = pts[j]; } }
    // legs
    const H = [s * 0.092 * hw, 0.925, 0.0], K = [s * 0.096 * hw, 0.505, 0.014], A = [s * 0.1 * hw, 0.088, -0.02];
    B['thigh' + sd] = H; B['shin' + sd] = K; B['foot' + sd] = A;
    E_([s * 0.066 * hw, 0.875, -0.05], [0.075 * hw, 0.085, 0.07 * Math.sqrt(bw)], 'thigh' + sd, 0.035); // glute
    R_(H, K, 0.084 * bw * (fem ? 1.04 : 1), 0.052 * Math.sqrt(bw), 'thigh' + sd, 0.04);
    E_([s * 0.1 * hw, 0.72, 0.012], [0.064 * bw, 0.13, 0.068 * bw], 'thigh' + sd, 0.04); // quad mass
    E_(add(K, [0, 0.008, 0.032]), [0.034, 0.036, 0.024], 'shin' + sd, 0.02);
    R_(K, A, 0.05 * Math.sqrt(bw), 0.032, 'shin' + sd, 0.025);
    E_([s * 0.098 * hw, 0.37, -0.03], [0.045 * bw, 0.095, 0.045 * bw], 'shin' + sd, 0.03); // calf
    R_(A, [s * 0.105 * hw, 0.03, 0.13], 0.036, 0.027, 'foot' + sd, 0.02); E_([s * 0.1 * hw, 0.045, -0.035], [0.03, 0.035, 0.035], 'foot' + sd, 0.02);
  }
  P.sort((a, b) => b.br - a.br);
  return { prims: P, bones: B, bw, fem };
}
export function makeSDF(prims) {
  const n = prims.length, cx = prims.map((p) => p.c[0]), cy = prims.map((p) => p.c[1]), cz = prims.map((p) => p.c[2]), br = prims.map((p) => p.br), kk = prims.map((p) => p.k), ff = prims.map((p) => p.f);
  return (x, y, z) => { let d = 1e9; for (let i = 0; i < n; i++) { const lb = Math.hypot(x - cx[i], y - cy[i], z - cz[i]) - br[i]; if (lb > d + kk[i]) continue; const e = ff[i](x, y, z); const k = kk[i], h = Math.max(k - Math.abs(d - e), 0) / k; d = Math.min(d, e) - h * h * k * 0.25; } return d; };
}
export const grad = (sdf, x, y, z, e = 0.0012) => { const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e); const l = Math.hypot(gx, gy, gz) || 1; return [gx / l, gy / l, gz / l]; };

// surface nets on a uniform grid with block culling
export function surfaceNets(sdf, lo, hi, h) {
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz), id = (i, j, k) => (k * ny + j) * nx + i, BS = 6, half = BS * h * 0.87 + 0.004;
  for (let bk = 0; bk < nz; bk += BS) for (let bj = 0; bj < ny; bj += BS) for (let bi = 0; bi < nx; bi += BS) {
    const d0 = sdf(lo[0] + (bi + BS / 2) * h, lo[1] + (bj + BS / 2) * h, lo[2] + (bk + BS / 2) * h); const full = Math.abs(d0) < half;
    for (let k = bk; k < Math.min(nz, bk + BS); k++) for (let j = bj; j < Math.min(ny, bj + BS); j++) for (let i = bi; i < Math.min(nx, bi + BS); i++) F[id(i, j, k)] = full ? sdf(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h) : d0;
  }
  const C = new Int32Array((nx - 1) * (ny - 1) * nz).fill(-1), cid = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i; const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]; const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let m = 0; for (let c = 0; c < 8; c++) { v[c] = F[id(i + co[c][0], j + co[c][1], k + co[c][2])]; if (v[c] < 0) m |= 1 << c; } if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0; for (const [a, b] of E) { if ((v[a] < 0) === (v[b] < 0)) continue; const t = v[a] / (v[a] - v[b]); sx += co[a][0] + (co[b][0] - co[a][0]) * t; sy += co[a][1] + (co[b][1] - co[a][1]) * t; sz += co[a][2] + (co[b][2] - co[a][2]) * t; cnt++; }
    C[cid(i, j, k)] = pos.length / 3; pos.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const in0 = F[id(i, j, k)] < 0;
    if (in0 !== F[id(i + 1, j, k)] < 0) quad(C[cid(i, j, k)], C[cid(i, j - 1, k)], C[cid(i, j - 1, k - 1)], C[cid(i, j, k - 1)], in0);
    if (in0 !== F[id(i, j + 1, k)] < 0) quad(C[cid(i, j, k)], C[cid(i, j, k - 1)], C[cid(i - 1, j, k - 1)], C[cid(i - 1, j, k)], in0);
    if (in0 !== F[id(i, j, k + 1)] < 0) quad(C[cid(i, j, k)], C[cid(i - 1, j, k)], C[cid(i - 1, j - 1, k)], C[cid(i, j - 1, k)], in0);
  }
  const P = new Float32Array(pos); for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; const d = sdf(x, y, z), g = grad(sdf, x, y, z); P[i] -= d * g[0]; P[i + 1] -= d * g[1]; P[i + 2] -= d * g[2]; }
  const I = new Uint32Array(idx); let vol = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
  if (vol < 0) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
  return { P, I };
}
export async function simplify(P, I, tris) {
  await MeshoptSimplifier.ready;
  const [J] = MeshoptSimplifier.simplify(I, P, 3, Math.min(I.length, tris * 3), 0.05, []);
  const remap = new Int32Array(P.length / 3).fill(-1), out = []; const K = new Uint32Array(J.length);
  for (let i = 0; i < J.length; i++) { let r = remap[J[i]]; if (r < 0) { r = remap[J[i]] = out.length / 3; out.push(P[J[i] * 3], P[J[i] * 3 + 1], P[J[i] * 3 + 2]); } K[i] = r; }
  return { P: new Float32Array(out), I: K };
}
