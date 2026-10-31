// Procedural low-poly people from avatar traits (+ shop cosmetics). Parts are merged geometries; a 'far' single-mesh LOD is built too.
import { THREE, Batch, MAT, shade, mix, cTex } from './batch.js';
import { PAL, VIBES } from '../shared/traits.js';

const C = (k, i) => '#' + PAL[k][i];
const cache = new Map();
const neonMat = MAT.neon;
export function buildPerson(av, eq = {}) {
  const key = JSON.stringify([av, eq]); let hit = cache.get(key);
  if (!hit) { hit = make(av, eq); cache.set(key, hit); if (cache.size > 120) { const k = cache.keys().next().value; const o = cache.get(k); if (!o.shared) {} cache.delete(k); } }
  return instance(hit);
}
function make(av, eq) {
  const skin = C('skin', av.skin), shirt = C('shirt', av.shirt), pants = C('pants', av.pants), hair = C('hair', av.hair), eye = C('eyes', av.eyes);
  const bw = [0.88, 1, 1.14][av.body], sw = [0.5, 0.44, 0.47][av.sex] * bw, hw = [0.42, 0.46, 0.44][av.sex] * bw;
  const far = new Batch(), up = new Batch(), aL = new Batch(), aR = new Batch(), lL = new Batch(), lR = new Batch(), neon = new Batch();
  for (const p of [up, aL, aR, lL, lR]) p.twin = far;
  const hipY = 0.82, shY = 1.4, headY = 1.56;
  const outfit = av.outfit, overalls = outfit === 1, hawaii = outfit === 2, jacket = outfit === 3, vest = outfit === 4;
  const denim = '#2f5d9a', shirtC = hawaii ? mix(shirt, '#ffffff', 0.15) : shirt, legC = overalls ? denim : pants;
  // legs (pivot at hip)
  for (const [L, s] of [[lL, -1], [lR, 1]]) { L.ox = s * hw * 0.24; L.oy = hipY; L.rbox(0.17 * bw, 0.66, 0.2 * bw, legC, 0, -0.33, 0, 0, 0, 0, 0.055, 3); L.rbox(0.18 * bw, 0.1, 0.3, '#2a2420', 0, -0.76, 0.05, 0, 0, 0, 0.04, 3); L.box(0.19 * bw, 0.04, 0.31, '#d8d2c2', 0, -0.8, 0.05); }
  // torso
  up.rbox(sw, 0.3, 0.25 * bw, shirtC, 0, 1.23, 0, 0, 0, 0, 0.07, 3); up.rbox(hw, 0.3, 0.24 * bw, jacket ? shade(shirtC, 0.9) : overalls ? denim : shirtC, 0, 0.97, 0, 0, 0, 0, 0.07, 3); up.box(hw + 0.01, 0.07, 0.25 * bw, overalls ? denim : pants, 0, 0.84, 0);
  if (overalls) { up.box(sw * 0.62, 0.32, 0.04, denim, 0, 1.2, 0.13 * bw); for (const s of [-1, 1]) { up.box(0.05, 0.26, 0.26 * bw, denim, s * sw * 0.26, 1.28, 0); up.cyl(0.02, 0.02, '#ffd166', s * sw * 0.26, 1.16, 0.15 * bw, Math.PI / 2, 0, 0, 6); } up.box(0.14, 0.1, 0.03, shade(denim, 0.8), 0, 1.1, 0.15 * bw); }
  if (hawaii) for (let i = 0; i < 7; i++) up.cyl(0.03, 0.01, i % 2 ? '#ffd166' : '#ffffff', ((i * 37) % 9 - 4) * 0.045, 1.1 + ((i * 53) % 5) * 0.05, 0.13 * bw + 0.005, Math.PI / 2, 0, 0, 6);
  if (jacket) { up.box(sw + 0.02, 0.3, 0.27 * bw, '#3f6fa8', 0, 1.23, 0); up.box(0.02, 0.3, 0.27 * bw, '#274b78', 0, 1.23, 0.01); up.box(0.22, 0.05, 0.1, '#274b78', 0, 1.4, 0.1); }
  if (vest) for (const s of [-1, 1]) up.box(sw * 0.4, 0.34, 0.27 * bw, '#8a5a2b', s * sw * 0.28, 1.2, 0.0);
  if (av.pattern === 1) for (let i = 0; i < 5; i++) up.box(sw + 0.005, 0.022, 0.255 * bw, '#ffffff', 0, 1.1 + i * 0.065, 0);
  else if (av.pattern === 2) { up.cyl(0.07, 0.01, '#ffffff', 0, 1.2, 0.13 * bw + 0.006, Math.PI / 2, 0, 0, 12); up.cyl(0.05, 0.012, shirtC, 0, 1.2, 0.13 * bw + 0.008, Math.PI / 2, 0, 0, 12); up.box(0.012, 0.13, 0.012, '#ffffff', 0, 1.2, 0.13 * bw + 0.012); up.box(0.012, 0.07, 0.012, '#ffffff', -0.02, 1.17, 0.13 * bw + 0.012, 0, 0, -0.7); up.box(0.012, 0.07, 0.012, '#ffffff', 0.02, 1.17, 0.13 * bw + 0.012, 0, 0, 0.7); }
  else if (av.pattern === 3) { up.sph(0.07, 0.045, 0.01, '#ffffff', 0, 1.18, 0.13 * bw + 0.008, 8); up.sph(0.035, 0.035, 0.01, '#ffffff', 0, 1.25, 0.13 * bw + 0.008, 8); }
  // arms (pivot at shoulder)
  for (const [A, s] of [[aL, -1], [aR, 1]]) {
    A.ox = s * (sw / 2 + 0.07); A.oy = shY; const long = jacket || outfit === 1 && false; const sleeve = jacket ? '#3f6fa8' : shirtC;
    A.rbox(0.13 * bw, long ? 0.58 : 0.26, 0.14 * bw, sleeve, 0, long ? -0.29 : -0.13, 0, 0, 0, 0, 0.05, 3); if (!long) A.rbox(0.1 * bw, 0.34, 0.11 * bw, skin, 0, -0.43, 0, 0, 0, 0, 0.045, 3); else A.box(0.1, 0.1, 0.11, skin, 0, -0.62, 0);
    A.sph(0.06, 0.06, 0.06, skin, 0, -0.64, 0, 6);
    if (av.tattoo && (av.accSide === 0 ? s === -1 : s === 1) && !long) { const tc = ['', '#1d4e89', '#d1495b', '#2a9d8f', '#444'][av.tattoo]; A.box(0.02, 0.12, 0.09, tc, s * 0.062 * bw, -0.4, 0); }
  }
  // head
  up.box(0.07, 0.07, 0.07, skin, 0, 1.46, 0); up.sph(0.145, 0.17, 0.15, skin, 0, headY, 0, 28);
  for (const s of [-1, 1]) { up.sph(0.022, 0.03, 0.02, skin, s * 0.15, headY, 0, 6); up.sph(0.028, 0.034, 0.012, '#ffffff', s * 0.055, headY + 0.02, 0.138, 6); up.sph(0.017, 0.02, 0.01, eye, s * 0.055, headY + 0.02, 0.146, 6); up.sph(0.008, 0.01, 0.008, '#111', s * 0.055, headY + 0.02, 0.152, 4); if (av.sex === 1) up.box(0.05, 0.008, 0.01, '#111', s * 0.055, headY + 0.052, 0.14); }
  up.sph(0.022, 0.026, 0.026, shade(skin, 0.94), 0, headY - 0.012, 0.152, 12); for (const s of [-1, 1]) { up.sph(0.011, 0.008, 0.01, shade(skin, 0.7), s * 0.012, headY - 0.03, 0.158, 6); up.box(0.05, 0.009, 0.012, mix(hair, '#000000', 0.2), s * 0.055, headY + 0.062, 0.143, 0, 0, s * -0.12); up.sph(0.006, 0.006, 0.004, '#ffffff', s * 0.055 + 0.008, headY + 0.027, 0.153, 5); up.sph(0.033, 0.012, 0.012, shade(skin, 0.88), s * 0.055, headY + 0.043, 0.141, 8); } up.box(0.06, av.sex === 1 ? 0.014 : 0.01, 0.01, av.sex === 1 ? '#d6336c' : '#8a4b3d', 0, headY - 0.065, 0.14);
  if (av.freckles) for (const [x, y] of [[-0.09, -0.035], [-0.07, -0.05], [-0.1, -0.055], [0.09, -0.035], [0.07, -0.05], [0.1, -0.055]]) up.sph(0.008, 0.008, 0.004, '#9c5a3a', x, headY + y, 0.14, 4);
  if (av.age >= 2) for (const s of [-1, 1]) up.box(0.04, 0.006, 0.01, '#6b4a3a', s * 0.055, headY + 0.055, 0.145);
  const hc = av.age === 3 && av.hair < 7 ? mix(hair, '#d9d9d9', 0.55) : hair;
  const hs = av.hairStyle;
  if (hs !== 6) {
    if (hs !== 3 && hs !== 4 && hs !== 7) up.sph(0.158, 0.13, 0.165, hc, 0, headY + 0.07, -0.01, 22);
    if (hs === 1) { up.box(0.3, 0.38, 0.06, hc, 0, headY - 0.1, -0.1); for (const s of [-1, 1]) up.box(0.04, 0.3, 0.12, hc, s * 0.145, headY - 0.06, -0.02); }
    if (hs === 2) up.sph(0.07, 0.07, 0.07, hc, 0, headY + 0.22, -0.04, 8);
    if (hs === 3) { up.box(0.05, 0.1, 0.3, hc, 0, headY + 0.17, -0.02); up.sph(0.1, 0.06, 0.15, shade(hc, 0.9), 0, headY + 0.1, -0.03, 8); }
    if (hs === 4) up.sph(0.26, 0.26, 0.24, hc, 0, headY + 0.07, -0.03, 10);
    if (hs === 5) { up.cyl(0.045, 0.26, hc, 0, headY - 0.04, -0.2, 0.5, 0, 0, 6); }
    if (hs === 7) for (const [x, y, z] of [[-0.1, 0.09, 0], [0.1, 0.09, 0], [0, 0.15, 0.02], [-0.07, 0.15, -0.07], [0.07, 0.15, -0.07], [0, 0.1, -0.12], [-0.13, 0.02, -0.06], [0.13, 0.02, -0.06]]) up.sph(0.065, 0.065, 0.065, hc, x, headY + y, z, 6);
  }
  const fh = hair;
  if (av.facial === 1) up.sph(0.12, 0.09, 0.05, mix(skin, '#000000', 0.18), 0, headY - 0.07, 0.115, 8);
  if (av.facial === 2 || av.facial === 3) up.box(0.11, 0.025, 0.03, fh, 0, headY - 0.045, 0.145);
  if (av.facial === 3) up.box(0.04, 0.05, 0.03, fh, 0, headY - 0.1, 0.14);
  if (av.facial === 4) { up.sph(0.145, 0.1, 0.1, fh, 0, headY - 0.09, 0.07, 8); up.box(0.1, 0.022, 0.03, fh, 0, headY - 0.045, 0.145); }
  if (av.facial === 5) { for (const s of [-1, 1]) up.box(0.04, 0.12, 0.05, fh, s * 0.125, headY - 0.04, 0.05); up.box(0.1, 0.02, 0.03, fh, 0, headY - 0.045, 0.145); }
  // eyewear
  if (av.glasses === 1) for (const s of [-1, 1]) up.box(0.075, 0.05, 0.015, '#15171c', s * 0.058, headY + 0.015, 0.155);
  else if (av.glasses === 2) for (const s of [-1, 1]) { up.cyl(0.04, 0.01, '#2b2b2b', s * 0.058, headY + 0.02, 0.153, Math.PI / 2, 0, 0, 10); up.cyl(0.032, 0.012, '#bfe3ff', s * 0.058, headY + 0.02, 0.155, Math.PI / 2, 0, 0, 10); }
  else if (av.glasses === 3) up.box(0.23, 0.045, 0.02, '#0d0d10', 0, headY + 0.02, 0.152);
  if (av.glasses) up.box(0.03, 0.01, 0.012, '#222', 0, headY + 0.03, 0.155);
  // hats (shop hats replace the avatar's hat)
  const sh = eq.hat;
  const hy = headY + 0.1;
  if (sh === 'gold_bucket') { up.cyl(0.14, 0.12, '#e5b83a', 0, hy + 0.06, 0, 0, 0, 0, 12, 0.14); up.cyl(0.2, 0.025, '#f1cc5c', 0, hy, 0, 0, 0, 0, 14, 0.2); }
  else if (sh === 'rainbow_beanie') { const rc = ['#ff4d4d', '#ffb703', '#ffe66d', '#06d6a0', '#4ea8ff']; rc.forEach((c, i) => up.cyl(0.165 - i * 0.012, 0.045, c, 0, hy - 0.04 + i * 0.045, 0, 0, 0, 0, 12, 0.165 - i * 0.012)); up.sph(0.05, 0.05, 0.05, '#ffffff', 0, hy + 0.2, 0, 6); }
  else if (sh === 'top_hat') { up.cyl(0.115, 0.26, '#15161a', 0, hy + 0.13, 0, 0, 0, 0, 12, 0.115); up.cyl(0.19, 0.025, '#15161a', 0, hy, 0, 0, 0, 0, 14, 0.19); up.cyl(0.118, 0.045, '#c1121f', 0, hy + 0.04, 0, 0, 0, 0, 12, 0.118); }
  else if (!sh || sh === 'halo') {
    const h = av.hat;
    if (h === 1) { up.sph(0.165, 0.11, 0.17, shirt, 0, hy + 0.01, -0.005, 10); up.box(0.2, 0.015, 0.16, shirt, 0, hy - 0.03, 0.2); }
    else if (h === 2) { up.cyl(0.14, 0.12, '#e9dcc3', 0, hy + 0.04, 0, 0, 0, 0, 12, 0.14); up.cyl(0.21, 0.02, '#e9dcc3', 0, hy - 0.01, 0, 0, 0, 0, 14, 0.21); }
    else if (h === 3) { up.cyl(0.13, 0.12, '#7a4b22', 0, hy + 0.05, 0, 0, 0, 0, 10, 0.13); up.cyl(0.24, 0.02, '#7a4b22', 0, hy - 0.01, 0, 0, 0, 0, 14, 0.2); up.box(0.26, 0.03, 0.04, '#5a3517', 0, hy + 0.12, 0); }
    else if (h === 4) { up.sph(0.165, 0.14, 0.17, pants, 0, hy + 0.0, -0.005, 10); up.sph(0.04, 0.04, 0.04, '#ffffff', 0, hy + 0.15, 0, 6); }
    else if (h === 5) { for (let i = 0; i < 5; i++) up.sph(0.03, 0.03, 0.012, ['#ff4fa3', '#ffd166', '#06d6a0', '#4ea8ff', '#ff4d4d'][i], 0.14, hy - 0.02 + (i - 2) * 0.012, 0.03 + (i - 2) * 0.035, 5); up.sph(0.02, 0.02, 0.012, '#ffd166', 0.15, hy - 0.02, 0.03, 5); }
    else if (h === 6) { up.cyl(0.158, 0.06, '#c1121f', 0, hy - 0.01, 0, 0, 0, 0, 12, 0.158); up.sph(0.158, 0.09, 0.165, '#c1121f', 0, hy + 0.01, -0.005, 10); up.box(0.06, 0.06, 0.06, '#c1121f', 0, hy - 0.03, -0.19, 0.4); }
    else if (h === 7) { up.cyl(0.12, 0.09, '#d9b44a', 0, hy + 0.05, 0, 0, 0, 0, 10, 0.12); up.cyl(0.25, 0.015, '#d9b44a', 0, hy, 0, 0, 0, 0, 14, 0.25); }
  }
  // face cosmetics
  if (eq.face === 'neon_shades') neon.box(0.26, 0.06, 0.03, '#ff2fd0', 0, headY + 0.02, 0.16), neon.box(0.26, 0.02, 0.035, '#33f0ff', 0, headY + 0.005, 0.162);
  else if (eq.face === 'heart_specs') for (const s of [-1, 1]) { neon.sph(0.04, 0.04, 0.015, '#ff4fa3', s * 0.062 - s * 0.018, headY + 0.03, 0.158, 6); neon.sph(0.04, 0.04, 0.015, '#ff4fa3', s * 0.062 + s * 0.018, headY + 0.03, 0.158, 6); neon.cone(0.045, 0.06, '#ff4fa3', s * 0.062, headY + 0.0, 0.158, Math.PI, 0, 0, 4); }
  // accessory
  const side = av.accSide === 0 ? -1 : 1;
  if (av.acc === 1) { for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI; up.box(0.015, 0.015, 0.015, '#d8dde6', Math.cos(a) * -0.09 * -1, 1.42 - Math.sin(a) * 0.1, 0.12 * bw); } up.cyl(0.035, 0.012, '#ffffff', 0, 1.27, 0.13 * bw + 0.01, Math.PI / 2, 0, 0, 10); }
  else if (av.acc === 2) { aR.box(0.04, 0.34, 0.025, '#b0b7c3', 0.02, -0.62, 0.07, 0, 0.5); aR.cyl(0.05, 0.02, '#b0b7c3', 0.02, -0.82, 0.18, 0.5, 0, 0, 8); }
  else if (av.acc === 3) { up.cyl(0.12, 0.07, '#e63946', 0, 1.46, 0, 0, 0, 0, 10, 0.12); up.box(0.06, 0.2, 0.03, '#e63946', side * 0.05, 1.33, 0.14 * bw); }
  else if (av.acc === 4) { up.box(0.3, 0.02, 0.03, '#222', 0, headY + 0.17, 0, 0, 0, 0); for (const s of [-1, 1]) { up.cyl(0.05, 0.05, '#222', s * 0.155, headY, 0, 0, 0, Math.PI / 2, 8); up.box(0.02, 0.2, 0.03, '#222', s * 0.15, headY + 0.1, 0); } }
  else if (av.acc === 5) { up.cyl(0.04, 0.01, '#1d8fe1', side * sw * 0.28, 1.3, 0.13 * bw + 0.008, Math.PI / 2, 0, 0, 12); up.box(0.04, 0.012, 0.01, '#fff', side * sw * 0.28, 1.3, 0.13 * bw + 0.016); }
  // back cosmetics
  if (eq.back === 'surfboard') up.box(0.22, 0.95, 0.05, '#ff6b9d', 0.02, 1.0, -0.2 * bw - 0.02, 0, 0.12, 0.2), up.box(0.04, 0.9, 0.055, '#ffffff', 0.02, 1.0, -0.2 * bw - 0.02, 0, 0.12, 0.2);
  else if (eq.back === 'vw_wings') for (const s of [-1, 1]) for (let i = 0; i < 4; i++) up.box(0.5 - i * 0.07, 0.06, 0.03, i % 2 ? '#e8eef7' : '#ff7a1a', s * (0.3 + i * 0.07), 1.45 - i * 0.1, -0.2 * bw - 0.04, 0, 0, s * (0.5 - i * 0.12));
  // hair cards: alpha-textured strand planes layered over the scalp (long hair, ponytail, short crop...)
  const cards = new Batch(); cards.keepUv = true; if (hs !== 6 && hs !== 4) { const ring = (y, r, len, n, from, to, tilt, w = 0.1) => { for (let i = 0; i < n; i++) { const a = from + (to - from) * (i + 0.5) / n; cards.card(w, len, shade(hc, 0.85 + 0.3 * ((i * 7) % 5) / 5), Math.sin(a) * r, y, Math.cos(a) * r - 0.01, tilt, a, 0, 0.3); } };
    if (hs === 1) { ring(headY - 0.12, 0.16, 0.42, 9, 0.9, 5.4, -0.18, 0.13); ring(headY - 0.02, 0.165, 0.3, 9, 0.8, 5.5, -0.3, 0.12); ring(headY + 0.1, 0.12, 0.2, 8, 0, 6.28, -0.5, 0.12); }
    else if (hs === 5) { ring(headY + 0.07, 0.14, 0.2, 10, 0.5, 5.8, -0.45, 0.1); for (let i = 0; i < 5; i++) cards.card(0.07, 0.34, shade(hc, 0.9 + i * 0.04), (i - 2) * 0.025, headY - 0.14, -0.22 - i * 0.004, -0.3, Math.PI, 0, 0.2); }
    else if (hs === 7) ring(headY + 0.11, 0.14, 0.12, 10, 0, 6.28, -0.6, 0.09);
    else if (hs === 3) { ring(headY + 0.1, 0.1, 0.17, 6, 3.3, 6.0, -0.4, 0.09); }
    else if (hs === 2) ring(headY + 0.1, 0.13, 0.16, 11, 0.6, 5.7, -0.5, 0.1);
    else ring(headY + 0.09, 0.145, 0.15, 12, 0.7, 5.6, -0.5, 0.1); }
  const mk = (b) => { const g = b.build(); return g; };
  const hip = [hipY];
  return { geo: { hair: cards.parts.length ? mk(cards) : null, up: mk(up), aL: mk(aL), aR: mk(aR), lL: mk(lL), lR: mk(lR), far: mk(far), neon: neon.parts.length ? mk(neon) : null }, sx: sw / 2 + 0.07, hw, hipY, shY, eq, av, scale: [0.93, 1, 1.08][av.height] * (av.age === 0 ? 0.97 : 1), halo: sh === 'halo' ? headY + 0.36 : null, shared: true };
}
let hairM = null;
function hairMat() {
  if (hairM) return hairM; const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128; const x = cv.getContext('2d'); x.clearRect(0, 0, 64, 128);
  for (let i = 0; i < 26; i++) { const px = 2 + (i / 25) * 60, w = 2.6, tipY = 112 + ((i * 37) % 16), a = 0.8 + 0.2 * ((i * 13) % 5) / 5, g = x.createLinearGradient(0, 0, 0, tipY); g.addColorStop(0, `rgba(${215 - (i % 4) * 22},${215 - (i % 4) * 22},${215 - (i % 4) * 22},${a})`); g.addColorStop(1, 'rgba(255,255,255,0.9)');
    x.fillStyle = g; x.beginPath(); x.moveTo(px - w, 0); x.lineTo(px + w, 0); x.lineTo(px + w * 0.8, tipY * 0.7); x.lineTo(px, tipY); x.lineTo(px - w * 0.8, tipY * 0.7); x.closePath(); x.fill(); }
  const t = cTex(cv); t.anisotropy = 4; hairM = new THREE.MeshStandardMaterial({ map: t, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 }); return hairM;
}
function instance(h) {
  const root = new THREE.Group(), pose = new THREE.Group(); root.add(pose); root.scale.setScalar(h.scale);
  const m = (g, mat = MAT.lambert) => new THREE.Mesh(g, mat);
  const upper = new THREE.Group(); upper.position.y = h.hipY; pose.add(upper); const up = m(h.geo.up); up.position.y = -h.hipY; upper.add(up);
  if (h.geo.neon) { const n = m(h.geo.neon, MAT.neon); n.position.y = -h.hipY; upper.add(n); }
  let hairMesh = null; if (h.geo.hair) { hairMesh = new THREE.Mesh(h.geo.hair, hairMat()); hairMesh.position.y = -h.hipY; hairMesh.castShadow = true; upper.add(hairMesh); }
  const arm = (g, x) => { const p = new THREE.Group(); p.position.set(x, h.shY - h.hipY, 0); const mm = m(g); p.add(mm); upper.add(p); return p; };
  // arm/leg meshes are authored relative to their pivots offset (ox/oy baked via Batch offsets) -> undo the offset by positioning at 0 and compensating
  const aL = new THREE.Group(), aR = new THREE.Group(), lL = new THREE.Group(), lR = new THREE.Group();
  const s = h.sx; aL.position.set(-s, h.shY, 0); aR.position.set(s, h.shY, 0); lL.position.set(-h.hw * 0.24, h.hipY, 0); lR.position.set(h.hw * 0.24, h.hipY, 0);
  for (const [g, geo, ox, oy] of [[aL, h.geo.aL, -s, h.shY], [aR, h.geo.aR, s, h.shY], [lL, h.geo.lL, -h.hw * 0.24, h.hipY], [lR, h.geo.lR, h.hw * 0.24, h.hipY]]) { const mesh = m(geo); mesh.position.set(-ox, -oy, 0); g.add(mesh); }
  pose.add(lL, lR); upper.add(aL, aR); aL.position.y -= h.hipY; aR.position.y -= h.hipY;
  const farMesh = m(h.geo.far); farMesh.visible = false; pose.add(farMesh);
  const extras = new THREE.Group(); root.add(extras);
  let aura = null, glow = null, halo = null;
  if (h.eq.aura === 'flame_aura') { const b = new Batch(); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.cone(0.1, 0.5 + (i % 3) * 0.12, i % 2 ? '#ff7a1a' : '#ffd23f', Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5, 0, 0, 0, 5); } aura = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })); extras.add(aura); }
  else if (h.eq.aura === 'peace_aura') { const b = new Batch(); const rc = ['#ff4d4d', '#ffb703', '#ffe66d', '#06d6a0', '#4ea8ff', '#9b5de5']; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; b.box(0.1, 0.07, 0.07, rc[i % 6], Math.cos(a) * 0.62, 0.15, Math.sin(a) * 0.62, -a); } for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; b.box(0.05, 0.05, 0.05, rc[(i + 3) % 6], Math.cos(a) * 0.62, 1.5, Math.sin(a) * 0.62, -a); } aura = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })); extras.add(aura); }
  if (h.eq.glow === 'neon_underglow') { glow = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), new THREE.MeshBasicMaterial({ color: 0xb030ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.04; extras.add(glow); }
  if (h.halo) { halo = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 20), new THREE.MeshBasicMaterial({ color: 0xffe28a })); halo.rotation.x = Math.PI / 2; halo.position.y = h.halo; extras.add(halo); }
  for (const mm of [up, hairMesh, ...[aL, aR, lL, lR].map((g) => g.children[0])]) if (mm) { mm.castShadow = true; mm.receiveShadow = true; }
  return { root, pose, upper, aL, aR, lL, lR, farMesh, nearMeshes: [up, ...(hairMesh ? [hairMesh] : []), ...[aL, aR, lL, lR].map((g) => g.children[0])], aura, glow, halo, upMesh: up, scale: h.scale, hasGlow: !!glow };
}
export function setLOD(p, far) { for (const mm of p.nearMeshes) mm.visible = !far; p.farMesh.visible = far; }
// ---- sprites ----
const texCache = new Map();
function tex(key, draw, w, h) { let t = texCache.get(key); if (t) return t; const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); t = cTex(cv); texCache.set(key, t); if (texCache.size > 300) { const k = texCache.keys().next().value; texCache.get(k).dispose(); texCache.delete(k); } return t; }
export function makeTag(nick, vibe, minted, nftName) {
  const two = !!nftName; const H = two ? 88 : 56; const v = VIBES[vibe] || VIBES[0]; const t = tex('tag:' + nick + vibe + minted + (nftName || ''), (x, w, h) => {
    x.font = '700 30px Arial, sans-serif'; const label = (minted || two ? '★ ' : '') + nick; let tw = Math.min(w - 40, x.measureText(label).width) + 30;
    const sub = two ? 'NFT \u2713 ' + String(nftName).slice(0, 26) : ''; if (two) { x.font = '600 20px Arial, sans-serif'; tw = Math.max(tw, Math.min(w - 20, x.measureText(sub).width + 34)); }
    x.fillStyle = 'rgba(10,8,24,.72)'; const L = (w - tw) / 2; x.beginPath(); x.roundRect(L, 6, tw, h - 12, 18); x.fill(); x.strokeStyle = two ? '#ffd166' : v.color; x.lineWidth = 3; x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 30px Arial, sans-serif'; x.fillStyle = minted || two ? '#ffd166' : v.color; x.fillText(label, w / 2, two ? 30 : h / 2 + 1, w - 50);
    if (two) { x.font = '600 20px Arial, sans-serif'; x.fillStyle = '#9fe8ff'; x.fillText(sub, w / 2, 63, w - 40); }
  }, 320, H);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, fog: false })); sp.scale.set(1.5, 0.26 * H / 56, 1); sp.renderOrder = 10; return sp;
}
export function makeBubble(text) {
  const lines = []; let cur = ''; for (const w of text.split(' ')) { if ((cur + ' ' + w).length > 26) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; } if (cur) lines.push(cur); const L = lines.slice(0, 4);
  const cv = document.createElement('canvas'); cv.width = 420; cv.height = 40 + L.length * 34; const x = cv.getContext('2d');
  x.fillStyle = 'rgba(255,255,255,.95)'; x.beginPath(); x.roundRect(4, 4, 412, cv.height - 22, 16); x.fill(); x.beginPath(); x.moveTo(200, cv.height - 18); x.lineTo(210, cv.height - 2); x.lineTo(222, cv.height - 18); x.fill();
  x.fillStyle = '#1a1033'; x.font = '600 26px Arial, sans-serif'; x.textAlign = 'center'; L.forEach((l, i) => x.fillText(l, 210, 38 + i * 32, 396));
  const t = cTex(cv); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, fog: false })); sp.scale.set(2.2, (2.2 * cv.height) / 420, 1); sp.renderOrder = 11; sp.userData.tex = t; return sp;
}
export function makeMic() {
  const t = tex('mic', (x, w, h) => { x.fillStyle = '#20c997'; x.beginPath(); x.arc(w / 2, h / 2, w / 2 - 3, 0, 7); x.fill(); x.fillStyle = '#fff'; x.font = '44px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🎙', w / 2, h / 2 + 3); }, 64, 64);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, fog: false })); sp.scale.set(0.32, 0.32, 1); sp.renderOrder = 12; return sp;
}
