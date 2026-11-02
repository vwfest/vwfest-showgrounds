// Procedural low-poly rides (Bug, Camper, Ghia Coupe, Safari, Wagon, Baja Bug) with paint types, wheels, stance, extras, VWFEST plates.
import { THREE, Batch, MAT, shade, mix, cTex } from './batch.js';
import { PAL } from '../shared/traits.js';
import RIDES from '../shared/rides.js';
import { loadHD, hdReady, assembleHD, HD_FAR } from './hdcars.js';

export const PLATE_UNI = { uTime: { value: 0 } };
let plateTex = null, plateTexDia = null, diaMat = null, plateMat = null, chromeMat = null;
function plateTexture(kind) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const x = cv.getContext('2d');
  x.fillStyle = kind === 1 ? '#d9dee6' : kind === 2 ? '#e8f7ff' : '#f2efe4'; x.fillRect(0, 0, 128, 64); x.strokeStyle = '#1d3557'; x.lineWidth = 4; x.strokeRect(3, 3, 122, 58);
  x.fillStyle = kind === 2 ? '#007fb0' : '#1d3557'; x.font = '900 30px Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('VWFEST', 64, 34);
  x.font = '700 9px Arial'; x.fillText('CALIFORNIA · SHOW GROUNDS', 64, 11); const t = cTex(cv); return t;
}
export function plateMaterial(kind) {
  if (kind === 2) {
    if (!diaMat) { diaMat = new THREE.ShaderMaterial({ uniforms: { uTime: PLATE_UNI.uTime, map: { value: plateTexture(2) } }, vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vUv=uv; vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: `uniform sampler2D map; uniform float uTime; varying vec2 vUv; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        void main(){ vec4 t=texture2D(map,vUv); vec2 g=floor(vUv*vec2(22.,11.)); float r=h(g); float tw=pow(max(0.,sin(uTime*(2.+r*5.)+r*40.)),14.);
          vec3 rainbow=0.5+0.5*cos(6.2831*(vUv.x*1.2+uTime*0.35+vec3(0.,.33,.66)));
          float sheen=smoothstep(.0,.15,abs(fract(vUv.x*1.5-uTime*.45)-.5)-.38);
          vec3 col=t.rgb*(.78+.22*rainbow)+tw*vec3(1.,1.,1.)*1.4+(1.-sheen)*.25; gl_FragColor=vec4(col,1.);} `, side: THREE.DoubleSide }); }
    return diaMat;
  }
  if (kind === 1) return chromeMat || (chromeMat = new THREE.MeshPhongMaterial({ map: plateTexture(1), shininess: 200, specular: 0xffffff }));
  return plateMat || (plateMat = new THREE.MeshLambertMaterial({ map: plateTexture(0) }));
}
// Routes every primitive to a material bin (paint / chrome / glass / matte / lamp) so the car gets real PBR materials, still merged to 5 meshes.
const BIN = { glass: new Set(['#25384f', '#7aa7c7']), chrome: new Set(['#d8dde6', '#9aa3af', '#e9edf3', '#e5b83a', '#aab2bd', '#7d8590', '#dddddd']), matte: new Set(['#16171a', '#202226', '#222', '#0e0e10', '#2b2b2f', '#111', '#7a4a2a', '#f4f1ea', '#3a2f2a', '#4a3a32', '#222222']), lamp: new Set(['#fff6c8', '#fff27a', '#c1121f']) };
const binOf = (c) => { const k = String(c).toLowerCase(); for (const n in BIN) if (BIN[n].has(k)) return n; return 'paint'; };
class CarBatch extends Batch {
  constructor() { super(); this.bins = { paint: new Batch(), chrome: new Batch(), glass: new Batch(), matte: new Batch(), lamp: new Batch() }; }
  raw(geo, color, ...a) { return this.bins[binOf(color)].raw(geo, color, ...a); }
  buildAll() { const o = {}; for (const k in this.bins) { const g = this.bins[k].build(); if (g) o[k] = g; } return o; }
}
const plateGeo = new THREE.PlaneGeometry(0.46, 0.23);
const GLASS = '#25384f', TIRE = '#16171a', CHROME = '#d8dde6', DARK = '#202226', RUBBER = '#2b2b2f';
export const MODEL_DIM = [ // L, W, body bottom height (stock), roof height, wheel radius
  { L: 4.1, W: 1.55, H: 1.5, wr: 0.31, wb: 2.4 }, { L: 4.4, W: 1.8, H: 1.95, wr: 0.33, wb: 2.4 }, { L: 4.15, W: 1.6, H: 1.3, wr: 0.3, wb: 2.4 },
  { L: 3.8, W: 1.5, H: 1.55, wr: 0.31, wb: 2.4 }, { L: 4.3, W: 1.6, H: 1.45, wr: 0.31, wb: 2.4 }, { L: 3.9, W: 1.75, H: 1.35, wr: 0.42, wb: 2.4 },
];
const CLEAR = [0.3, 0.2, 0.1, 0.52, 0.06];
function wheelAt(b, wheels, x, y, z, r, side) {
  const wid = 0.22, out = side * 0.115;
  b.cyl(r, wid, TIRE, x, y, z, 0, 0, Math.PI / 2, 24); // tread
  for (const k of [-1, 1]) b.tor(r * 0.8, 0.055, TIRE, x + k * wid * 0.42, y, z, 0, Math.PI / 2, 0, 24, 6); // rounded sidewalls
  if (wheels >= 4) b.cyl(r * 0.86, wid + 0.012, '#f4f1ea', x + side * 0.004, y, z, 0, 0, Math.PI / 2, 24); // whitewall
  const rim = wheels === 5 ? '#e5b83a' : wheels === 1 ? '#9aa3af' : wheels === 3 ? '#e9edf3' : CHROME; const rr = r * (wheels >= 4 ? 0.62 : wheels === 2 ? 0.7 : wheels === 1 ? 0.66 : 0.58);
  b.cyl(rr, wid + 0.03, rim, x + side * 0.005, y, z, 0, 0, Math.PI / 2, 24);
  b.tor(rr, 0.018, rim, x + side * 0.118, y, z, 0, Math.PI / 2, 0, 24, 6); // lip
  b.cyl(rr * 0.9, 0.02, DARK, x + side * 0.112, y, z, 0, 0, Math.PI / 2, 20); // dished face
  if (wheels === 2) for (let i = 0; i < 5; i++) b.box(0.03, rr * 1.7, 0.06, DARK, x + out, y, z, 0, (i * Math.PI) / 2.5, 0);
  else if (wheels >= 4) { for (let i = 0; i < 8; i++) b.box(0.012, rr * 1.9, 0.012, rim, x + out, y, z, 0, (i * Math.PI) / 8, 0); }
  else if (wheels === 3) for (let i = 0; i < 6; i++) b.box(0.02, rr * 1.6, 0.05, '#7d8590', x + out, y, z, 0, (i * Math.PI) / 6, 0);
  else for (let i = 0; i < 5; i++) b.box(0.035, rr * 1.7, 0.05, rim, x + out, y, z, 0, (i * Math.PI) / 5, 0);
  b.cyl(rr * 0.24, 0.05, rim, x + side * 0.125, y, z, 0, 0, Math.PI / 2, 16); // hub cap
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; b.cyl(0.014, 0.03, CHROME, x + side * 0.135, y + Math.cos(a) * rr * 0.4, z + Math.sin(a) * rr * 0.4, 0, 0, Math.PI / 2, 6); } // lug nuts
}
// spec: {model, paint:'solid'|'metallic'|'candy'|'flake'|'two'|'patina', c1:'#rrggbb', c2:'#rrggbb'|null, wheels, stance, extras, plate, stripe, lowrider}
export function buildCar(spec) {
  const d = MODEL_DIM[spec.model], b = new CarBatch(), wr = d.wr, st = spec.stance, clear = CLEAR[st] + (spec.model === 5 ? 0.12 : 0);
  const candy = spec.paint === 'candy', metal = spec.paint === 'metallic', flake = spec.paint === 'flake', patina = spec.paint === 'patina';
  let c1 = spec.c1;
  const c2 = spec.c2 || c1; const top = flake || metal ? mix(c1, '#ffffff', 0.12) : c1, low = spec.c2 ? c2 : shade(c1, 0.9);
  const y0 = clear + wr * 0.35; // chassis bottom
  const hw = d.W / 2, L = d.L, wy = wr, wz = d.wb / 2;
  const M = spec.model;
  const g = (w, h, dd, col, x, y, z, ry, rx, rz) => b.box(w, h, dd, col, x, y, z, ry, rx, rz);
  const gr = (w, h, dd, col, x, y, z, ry, rx, rz, r = 0.05) => b.rbox(w, h, dd, col, x, y, z, ry, rx, rz, r, 2); // beveled body panel
  // --- bodies ---
  if (M === 1) { // Bus
    const h = d.H - y0; gr(d.W, h * 0.46, L, low, 0, y0 + h * 0.23, 0, 0, 0, 0, 0.09); gr(d.W - 0.04, h * 0.54, L - 0.12, spec.c2 ? c1 : mix(c1, '#ffffff', 0.78), 0, y0 + h * 0.46 + h * 0.27, -0.03, 0, 0, 0, 0.1); g(d.W - 0.1, 0.1, L - 0.4, shade(c1, 0.95), 0, d.H + 0.02, -0.02);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) g(0.03, 0.34, 0.62, GLASS, s * (hw - 0.01), y0 + h * 0.72, -1.5 + i * 0.95); // side windows
    g(d.W - 0.2, 0.4, 0.04, GLASS, 0, y0 + h * 0.73, L / 2 - 0.02); g(0.04, 0.4, 0.4, GLASS, 0, y0 + h * 0.73, L / 2 - 0.02); // split windshield bar
    g(0.4, 0.18, 0.06, '#f4f1ea', 0, y0 + h * 0.45, L / 2 + 0.02, 0, 0, 0.0); g(0.05, 0.4, 0.07, '#f4f1ea', -0.17, y0 + h * 0.42, L / 2 + 0.02, 0, 0, 0.5); g(0.05, 0.4, 0.07, '#f4f1ea', 0.17, y0 + h * 0.42, L / 2 + 0.02, 0, 0, -0.5); // V
    gr(d.W + 0.1, 0.12, 0.2, CHROME, 0, y0 + 0.1, L / 2 + 0.06); gr(d.W + 0.1, 0.12, 0.2, CHROME, 0, y0 + 0.1, -L / 2 - 0.06);
  } else if (M === 3) { // Safari
    const h = d.H - y0; gr(d.W, h * 0.42, L, c1, 0, y0 + h * 0.21, 0, 0, 0, 0, 0.07); g(0.05, h * 0.3, L * 0.5, c1, -hw + 0.02, y0 + h * 0.57, -0.2); g(0.05, h * 0.3, L * 0.5, c1, hw - 0.02, y0 + h * 0.57, -0.2); g(d.W, h * 0.3, 0.06, c1, 0, y0 + h * 0.57, -L / 2 + 0.05);
    g(d.W - 0.1, 0.05, 0.08, '#222', 0, d.H - 0.2, L * 0.12); g(0.05, 0.36, 0.05, '#222', -hw + 0.1, d.H - 0.38, L * 0.12); g(0.05, 0.36, 0.05, '#222', hw - 0.1, d.H - 0.38, L * 0.12); g(d.W - 0.2, 0.3, 0.03, '#7aa7c7', 0, d.H - 0.4, L * 0.12, 0, -0.25); // windshield
    g(d.W - 0.3, 0.12, 1.2, shade(c1, 0.7), 0, y0 + h * 0.5, 0.3); g(0.45, 0.45, 0.4, shade(c1, 0.7), -0.4, y0 + 0.55, -0.9); g(0.45, 0.45, 0.4, shade(c1, 0.7), 0.4, y0 + 0.55, -0.9);
    gr(d.W + 0.1, 0.1, 0.16, CHROME, 0, y0 + 0.1, L / 2 + 0.05); gr(d.W + 0.1, 0.1, 0.16, CHROME, 0, y0 + 0.1, -L / 2 - 0.05);
  } else if (M === 2) { // Ghia Coupe
    const h = d.H - y0; b.sph(hw, h * 0.34, L / 2, low, 0, y0 + h * 0.3, 0, 24); b.sph(hw * 0.88, h * 0.34, L * 0.3, top, 0, y0 + h * 0.62, -0.25, 20);
    g(d.W - 0.15, h * 0.26, 0.9, GLASS, 0, y0 + h * 0.62, 0.06, 0, -0.35); g(d.W - 0.2, 0.2, 0.05, GLASS, 0, y0 + h * 0.62, -0.78); g(0.04, h * 0.2, 1.0, GLASS, hw * 0.88, y0 + h * 0.62, -0.25); g(0.04, h * 0.2, 1.0, GLASS, -hw * 0.88, y0 + h * 0.62, -0.25);
    gr(d.W + 0.05, 0.1, 0.16, CHROME, 0, y0 + 0.14, L / 2 + 0.02); gr(d.W + 0.05, 0.1, 0.16, CHROME, 0, y0 + 0.14, -L / 2 - 0.02);
  } else if (M === 4) { // Wagon
    const h = d.H - y0; b.sph(hw, h * 0.36, L / 2, low, 0, y0 + h * 0.3, 0, 24); g(d.W - 0.1, h * 0.32, L * 0.5, top, 0, y0 + h * 0.62, -0.5); b.sph(hw * 0.9, h * 0.3, 0.7, top, 0, y0 + h * 0.58, 0.45, 16);
    g(d.W - 0.2, h * 0.2, 0.04, GLASS, 0, y0 + h * 0.62, 0.5, 0, -0.5); for (const s of [-1, 1]) { g(0.04, h * 0.2, 0.85, GLASS, s * (hw - 0.08), y0 + h * 0.62, 0.05); g(0.04, h * 0.2, 0.85, GLASS, s * (hw - 0.08), y0 + h * 0.62, -1.0); }
    gr(d.W + 0.05, 0.1, 0.16, CHROME, 0, y0 + 0.14, L / 2 + 0.02); gr(d.W + 0.05, 0.1, 0.16, CHROME, 0, y0 + 0.14, -L / 2 - 0.02);
  } else { // Bug (0) and Baja Bug (5)
    const h = d.H - y0; b.sph(hw, h * 0.34, L / 2, low, 0, y0 + h * 0.3, 0, 24);
    if (M === 0) { b.sph(hw * 0.86, h * 0.4, L * 0.27, top, 0, y0 + h * 0.62, -0.1, 24); g(d.W - 0.3, h * 0.2, 0.04, GLASS, 0, y0 + h * 0.62, 0.52, 0, -0.45); g(d.W - 0.4, 0.2, 0.04, GLASS, 0, y0 + h * 0.62, -0.72, 0, 0.45); for (const s of [-1, 1]) g(0.04, h * 0.2, 0.95, GLASS, s * hw * 0.82, y0 + h * 0.62, -0.1); }
    else { g(d.W - 0.5, 0.06, 1.0, '#222', 0, y0 + h * 0.8, -0.2); for (const s of [-1, 1]) { g(0.06, 0.55, 0.06, '#222', s * 0.6, y0 + h * 0.6, 0.25); g(0.06, 0.55, 0.06, '#222', s * 0.6, y0 + h * 0.6, -0.65); } g(d.W - 0.3, h * 0.2, 0.05, GLASS, 0, y0 + h * 0.58, 0.35, 0, -0.6); g(0.9, 0.12, 0.12, '#dddddd', 0, y0 + h * 0.82, 0.1); }
    for (const s of [-1, 1]) b.sph(0.2, 0.17, 0.26, shade(low, 1.05), s * (hw - 0.2), y0 + h * 0.5, L / 2 - 0.45, 8);
    gr(d.W + 0.05, 0.1, 0.16, CHROME, 0, y0 + 0.14, L / 2 + 0.02); gr(d.W + 0.05, 0.1, 0.16, CHROME, 0, y0 + 0.14, -L / 2 - 0.02);
  }
  // interior (visible through the glass): dash, seats, steering wheel, shifter
  if (M !== 5 || true) { const cy = y0 + 0.34, front = M === 1 ? L / 2 - 0.9 : 0.3; const seat = '#4a3a32';
    gr(d.W - 0.34, 0.16, 0.22, '#222222', 0, cy + 0.3, front + 0.38, 0, 0, 0, 0.04);
    for (const s of [-1, 1]) { gr(0.42, 0.14, 0.46, seat, s * 0.3, cy, front - 0.1, 0, 0, 0, 0.05, 3); gr(0.42, 0.52, 0.12, seat, s * 0.3, cy + 0.3, front - 0.34, 0, -0.12, 0, 0.05, 3); }
    b.tor(0.15, 0.018, '#222222', -0.3, cy + 0.36, front + 0.16, -0.9, 0, 0, 18, 6); b.cyl(0.012, 0.3, '#222222', -0.3, cy + 0.26, front + 0.22, -0.9, 0, 0, 6);
    if (M !== 3) gr(d.W - 0.34, 0.1, 0.5, seat, 0, cy, front - 0.95, 0, 0, 0, 0.04, 3); }
  // headlights + taillights
  const hl = M === 1 ? 0.75 : 0.7; for (const s of [-1, 1]) { b.sph(0.12, 0.12, 0.08, '#fff6c8', s * hl * hw, y0 + (M === 1 ? 0.45 : M === 3 ? 0.55 : 0.5), L / 2 + 0.03, 8); b.sph(0.08, 0.08, 0.06, '#c1121f', s * hl * hw, y0 + 0.5, -L / 2 - 0.02, 6); }
  if (patina) for (let i = 0; i < 9; i++) { const k = (i * 53) % 17; g(0.25 + (k % 4) * 0.08, 0.14, 0.05, '#7a4a2a', ((k % 5) - 2) * 0.28, y0 + 0.28 + (k % 3) * 0.14, ((k % 7) - 3) * 0.5, 0, 0.0, 0.3 * (k % 3)); }
  // --- stance-aware wheels ---
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheelAt(b, spec.wheels, sx * (hw - 0.06), wy, sz * wz, wr, sx);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(wr * 1.06, 0.06, '#0e0e10', sx * (hw - 0.14), wy, sz * wz, 0, 0, Math.PI / 2, 14, wr * 1.06); // wheel arch shadow hint
  // --- extras / decals ---
  const E = spec.extras || 0, has = (i) => !!(E & (1 << i)), topY = d.H;
  if (has(0)) { g(1.3, 0.05, 1.6, '#202226', 0, topY + 0.08, -0.1); for (const [x, z] of [[-0.6, -0.8], [0.6, -0.8], [-0.6, 0.6], [0.6, 0.6]]) g(0.05, 0.1, 0.05, '#202226', x, topY + 0.03, z); }
  if (has(1)) g(0.34, 0.07, 2.3, '#ffd166', 0, topY + 0.2, -0.1), g(0.12, 0.06, 0.5, '#ff4fa3', 0, topY + 0.245, 0.3);
  if (has(2)) for (const s of [-1, 1]) { g(0.02, 0.025, L - 0.4, '#ffe27a', s * (hw + 0.005), y0 + 0.5, 0); g(0.02, 0.012, L - 0.4, '#ffffff', s * (hw + 0.005), y0 + 0.44, 0); }
  if (has(3)) for (const s of [-1, 1]) { b.sph(0.02, 0.2, 0.55, '#ff4fa3', s * (hw + 0.005), y0 + 0.45, -0.3, 8); b.sph(0.02, 0.14, 0.3, '#06d6a0', s * (hw + 0.005), y0 + 0.62, -0.05, 8); b.sph(0.02, 0.1, 0.22, '#ffd166', s * (hw + 0.005), y0 + 0.36, -0.7, 8); b.sph(0.02, 0.1, 0.18, '#4ea8ff', s * (hw + 0.005), y0 + 0.54, -0.8, 8); }
  if (has(4) && M !== 1) { g(0.18, 0.02, L * 0.45, '#ffffff', -0.2, y0 + (M === 3 ? 0.85 : 0.82), L * 0.22); g(0.18, 0.02, L * 0.45, '#ffffff', 0.2, y0 + (M === 3 ? 0.85 : 0.82), L * 0.22); }
  if (has(5)) for (const s of [-1, 1]) b.sph(0.08, 0.08, 0.06, '#fff27a', s * 0.35, y0 + 0.28, L / 2 + 0.06, 6);
  if (has(6)) { g(d.W - 0.1, 0.05, 0.4, '#222', 0, topY - 0.15, -L / 2 + 0.1); for (const s of [-1, 1]) g(0.05, 0.25, 0.3, '#222', s * 0.5, topY - 0.28, -L / 2 + 0.1); }
  if (has(7)) { for (const s of [-1, 1]) g(0.02, 0.03, L - 0.3, CHROME, s * (hw + 0.01), y0 + 0.62, 0); g(d.W + 0.02, 0.04, 0.03, CHROME, 0, y0 + 0.62, L / 2 + 0.01); }
  if (has(8)) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.cone(0.07, 0.55 - i * 0.1, i % 2 ? '#ffb703' : '#ff6b00', s * (hw + 0.012), y0 + 0.36 + i * 0.03, 0.6 - i * 0.5, 0, 0, s * -Math.PI / 2 * 0 + Math.PI / 2 * s * -1, 5);
  const stripe = spec.stripe || 0; // avatar-car graphics
  if (stripe === 1) { g(0.16, 0.02, L * 0.9, '#ffffff', -0.2, topY - 0.05, 0.0); g(0.16, 0.02, L * 0.9, '#ffffff', 0.2, topY - 0.05, 0.0); }
  else if (stripe === 2) for (const s of [-1, 1]) g(0.02, 0.07, L - 0.2, '#ffffff', s * (hw + 0.005), y0 + 0.5, 0);
  else if (stripe === 3) for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.cone(0.07, 0.5 - i * 0.1, i % 2 ? '#ffb703' : '#ff6b00', s * (hw + 0.012), y0 + 0.36, 0.55 - i * 0.5, 0, 0, Math.PI / 2 * -s, 5);
  else if (stripe === 4) for (const s of [-1, 1]) for (let i = 0; i < 14; i++) g(0.02, 0.08, 0.28, i % 2 ? '#111' : '#f4f1ea', s * (hw + 0.01), y0 + 0.14, -L / 2 + 0.3 + i * 0.28);
  // lowrider trim: chrome bumpers extras, fender skirts hint, antenna
  if (spec.lowrider) { for (const s of [-1, 1]) { g(0.03, 0.2, 0.9, shade(c1, 0.8), s * (hw + 0.0), y0 + 0.18, -wz); g(0.03, 0.2, 0.9, shade(c1, 0.8), s * (hw + 0.0), y0 + 0.18, wz); } g(0.04, 0.5, 0.04, CHROME, hw - 0.3, topY + 0.2, -L / 2 + 0.6); }
  const bins = b.buildAll(); const pmat = patina ? MAT.lambert : candy ? MAT.paintCandy : flake ? MAT.paintFlake : metal ? MAT.paintMetal : MAT.paint;
  const mats = { paint: pmat, chrome: MAT.chrome, glass: MAT.glass, matte: MAT.tire, lamp: MAT.lamp };
  const group = new THREE.Group(); const body = new THREE.Group(); group.add(body);
  for (const k in bins) { const m = new THREE.Mesh(bins[k], mats[k]); m.castShadow = k !== 'glass'; m.receiveShadow = k !== 'glass'; if (k === 'glass') m.renderOrder = 2; body.add(m); }
  // plates (front + rear) 
  const pm = plateMaterial(spec.plate || 0); const rear = new THREE.Mesh(plateGeo, pm), front = new THREE.Mesh(plateGeo, pm);
  rear.position.set(0, y0 + 0.28, -L / 2 - 0.1); rear.rotation.y = Math.PI; front.position.set(0, y0 + 0.14, L / 2 + 0.16); group.add(rear, front);
  group.userData = { body, hydro: !!spec.lowrider, dims: d, plateDiamond: spec.plate === 2, bound: Math.max(L, 3) / 2 };
  return group;
}
// Pose a lowrider's hydraulics (hop / three-wheel / dip). t = seconds; mode: 'hop' | 'three' | 'dip' | 'rest'
export function hydraulics(group, t, mode, active) {
  const body = group.userData.body; if (!body) return;
  if (!active) { body.position.y += (0 - body.position.y) * 0.2; body.rotation.x += (0 - body.rotation.x) * 0.2; body.rotation.z += (0 - body.rotation.z) * 0.2; return; }
  if (mode === 'hop') { const k = Math.abs(Math.sin(t * 5.2)); body.position.y = k * 0.55; body.rotation.x = Math.sin(t * 5.2 + 1.2) * 0.07; body.rotation.z = Math.sin(t * 2.6) * 0.03; }
  else if (mode === 'three') { body.rotation.z += (-0.17 - body.rotation.z) * 0.15; body.rotation.x += (0.07 - body.rotation.x) * 0.15; body.position.y += (0.18 - body.position.y) * 0.15; }
  else { body.position.y = 0.05 + Math.sin(t * 3) * 0.04; body.rotation.x = Math.sin(t * 3) * 0.05; body.rotation.z = 0; }
}
// Spec converters
export function avatarCarSpec(av) {
  const two = av.carColor2 !== 16 ? '#' + PAL.car[av.carColor2] : null;
  return { model: av.car, paint: two ? 'two' : 'solid', c1: '#' + PAL.car[av.carColor], c2: two, wheels: 1, stance: 0, extras: 0, plate: 0, stripe: av.stripe };
}
export function rideSpec(r) {
  const paint = ['solid', 'metallic', 'candy', 'flake', 'two', 'patina'][r.paint];
  const c1 = r.paint === 5 ? '#' + RIDES.PATINA[r.c1 % RIDES.PATINA.length] : '#' + RIDES.COLORS[r.c1];
  return { model: r.model, paint, c1, c2: r.c2 === 16 ? null : '#' + RIDES.COLORS[r.c2], wheels: r.wheels, stance: r.stance, extras: r.extras, plate: r.plate, stripe: 0, lowrider: r.stance === 4, tier: r.tier };
}
// ---- HD rides (pre-baked code-built bodies, see src/hdcars.js). Low-poly stays as the instant placeholder / fallback. ----
const paintMat = (spec) => spec.paint === 'patina' ? MAT.lambert : spec.paint === 'candy' ? MAT.paintCandy : spec.paint === 'flake' ? MAT.paintFlake : spec.paint === 'metallic' ? MAT.paintMetal : MAT.paint;
export function buildCarHD(spec, d, farOnly = false) {
  const a = assembleHD(d, spec); const mats = { paint: paintMat(spec), metal: MAT.chrome, matte: MAT.tire, glass: MAT.glass, lamp: MAT.lamp, plate: plateMaterial(spec.plate || 0) };
  const level = (geos) => { const grp = new THREE.Group(); for (const r in geos) { const m = new THREE.Mesh(geos[r], mats[r]); m.castShadow = r !== 'glass' && r !== 'plate'; m.receiveShadow = r !== 'glass'; if (r === 'glass') m.renderOrder = 2; grp.add(m); } return grp; };
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  if (farOnly) body.add(level(a.far)); else { const lod = new THREE.LOD(); lod.addLevel(level(a.near), 0); lod.addLevel(level(a.far), HD_FAR); body.add(lod); }
  const dm = MODEL_DIM[spec.model]; group.userData = { body, hydro: !!spec.lowrider, dims: dm, plateDiamond: spec.plate === 2, bound: Math.max(dm.L, 3) / 2, hd: true, tris: a.tris }; return group;
}
const cache = new Map();
function cloneTree(o) {
  let c; if (o.isMesh) { c = new THREE.Mesh(o.geometry, o.material); c.castShadow = o.castShadow; c.receiveShadow = o.receiveShadow; c.renderOrder = o.renderOrder; }
  else if (o.isLOD) { c = new THREE.LOD(); for (const l of o.levels) c.addLevel(cloneTree(l.object), l.distance); c.position.copy(o.position); c.rotation.copy(o.rotation); return c; }
  else c = new THREE.Group();
  c.position.copy(o.position); c.rotation.copy(o.rotation); c.scale.copy(o.scale); for (const ch of o.children) c.add(cloneTree(ch)); return c;
}
function protoFor(spec, d) { const k = (d ? 'hd' : 'lo') + JSON.stringify(spec); let p = cache.get(k); if (!p) { p = d ? buildCarHD(spec, d) : buildCar(spec); cache.set(k, p); if (cache.size > 80) { const f = cache.keys().next().value; cache.delete(f); } } return p; }
function fill(g, proto) { // swap contents in place: the Group and its .userData.body stay the same objects (callers keep references)
  const body = g.userData.body; for (const ch of [...body.children]) body.remove(ch); for (const ch of [...g.children]) if (ch !== body) g.remove(ch);
  for (const ch of proto.userData.body.children) body.add(cloneTree(ch)); for (const ch of proto.children) if (ch !== proto.userData.body) g.add(cloneTree(ch));
  g.userData = { ...proto.userData, body };
}
export function carFor(spec) { // geometry cache; returns a fresh Group sharing geometry. HD replaces the low-poly placeholder as soon as its bake is loaded.
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body); g.userData.body = body;
  const d = hdReady(spec.model); fill(g, protoFor(spec, d));
  if (!d) loadHD(spec.model, (dd) => fill(g, protoFor(spec, dd)));
  return g;
}
