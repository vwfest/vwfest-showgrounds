// Procedural sneaker: small SDF sculpt -> surface nets -> simplify; sole/upper/accent by vertex colour.
import * as THREE from 'three';
import { surfaceNets, simplify, grad } from './body.js';
const CACHE = new Map();
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const ell = (x, y, z, c, r) => { const X = (x - c[0]) / r[0], Y = (y - c[1]) / r[1], Z = (z - c[2]) / r[2]; const k0 = Math.hypot(X, Y, Z), k1 = Math.hypot(X / r[0], Y / r[1], Z / r[2]); return (k0 * (k0 - 1)) / k1; };
const rbox = (x, y, z, c, b, r) => { const qx = Math.abs(x - c[0]) - b[0], qy = Math.abs(y - c[1]) - b[1], qz = Math.abs(z - c[2]) - b[2]; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r; };
export function shoeSDF(x, y, z) { // local: origin under the foot centre, +z toes
  const w = 1 - 0.32 * Math.max(0, z - 0.06) / 0.07 - 0.15 * Math.max(0, -z - 0.07) / 0.06; // narrowing toward toe/heel
  const sole = rbox(x / Math.max(w, 0.4), y, z, [0, 0.012, 0.005], [0.04, 0.008, 0.118], 0.006);
  let up = ell(x, y, z, [0, 0.038, 0.072], [0.043, 0.032, 0.058]);
  up = smin(up, ell(x, y, z, [0, 0.05, -0.005], [0.046, 0.045, 0.085]), 0.03);
  up = smin(up, ell(x, y, z, [0, 0.062, -0.07], [0.042, 0.055, 0.045]), 0.03);
  return smin(sole, up, 0.008);
}
export async function buildShoe(lod, upperC, accent) {
  const key = 'shoe' + lod; let geo = CACHE.get(key);
  if (!geo) { const raw = surfaceNets(shoeSDF, [-0.06, -0.003, -0.13], [0.06, 0.125, 0.145], 0.0025); const s = await simplify(raw.P, raw.I, [1400, 500, 120][lod]);
    geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(s.P, 3)); geo.setIndex(new THREE.BufferAttribute(s.I, 1));
    const n = s.P.length / 3, nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const x = s.P[i * 3], y = s.P[i * 3 + 1], z = s.P[i * 3 + 2]; nor.set(grad(shoeSDF, x, y, z, 0.001), i * 3);
      const isSole = y < 0.019, stripe = Math.abs(y - 0.045 - 0.25 * (z + 0.02) * (z + 0.02) * 4) < 0.006 && Math.abs(x) > 0.035 && z > -0.08 && z < 0.06, toecap = z > 0.1 && y < 0.035;
      col.set(isSole || toecap ? [0.93, 0.91, 0.86] : stripe ? [accent.r, accent.g, accent.b] : [upperC.r, upperC.g, upperC.b], i * 3); }
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); CACHE.set(key, geo); }
  return geo;
}
