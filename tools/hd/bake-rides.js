// Bake step (runs once in headless Chrome, never in the client): builds every ride with the code-built HD builders,
// splits it into layers (body / each extra / wheels), merges per material role, makes a far LOD, quantizes, emits m<N>.bin.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { buildGhia } from './src/rides/ghia.js';
import { buildBug } from './src/rides/bug.js';
import { buildCamper } from './src/rides/camper.js';
import { buildWagon } from './src/rides/wagon.js';
import { buildSafari } from './src/rides/safari.js';
import { genericExtras } from './generic-extras.js';
const B = [(s, o) => buildBug(s, o), buildCamper, buildGhia, buildSafari, buildWagon, (s, o) => buildBug(s, { ...o, baja: true })];
const C1 = '#ff0001', C2 = '#00ff02', ROLES = ['paint', 'paint2', 'metal', 'matte', 'glass', 'lamp', 'plate'];
const roleOf = (m) => { const c = m.color ? '#' + m.color.getHexString() : '';
  if (c === C1 && !m.map) return 'paint'; if (c === C2 && !m.map) return 'paint2'; if (m.map) return 'plate'; if (m.transparent) return 'glass';
  if (m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) return 'lamp'; if ((m.metalness || 0) >= 0.5) return 'metal'; return 'matte'; };
function collect(car) { car.updateMatrixWorld(true); const out = [];
  const bodyG = (car.userData && car.userData.body) || car.children[0]; car.traverse((o) => { if (!o.isMesh || !o.visible) return; let p = o, inBody = false; while (p) { if (p === bodyG) inBody = true; p = p.parent; }
    const mats = Array.isArray(o.material) ? o.material : [o.material]; let g = o.geometry.index ? o.geometry : o.geometry; g = g.clone().applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals(); const m = mats[0]; const role = roleOf(m); const col = m.color ? m.color.clone() : new THREE.Color(1, 1, 1);
    if (role === 'lamp') col.lerp(m.emissive, 0.3);
    const P = g.attributes.position; const sig = role + ':' + P.count + ':' + P.getX(0).toFixed(3) + ',' + P.getY(0).toFixed(3) + ',' + P.getZ(0).toFixed(3);
    out.push({ g, role, col, sig, wheel: !inBody, side: m.side }); }); return out; }
function merge(list) { // -> {pos,nor,col,uv,idx}
  let nv = 0, ni = 0; for (const it of list) { nv += it.g.attributes.position.count; ni += it.g.index ? it.g.index.count : it.g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni); let v = 0, i = 0;
  for (const it of list) { const g = it.g, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv; for (let k = 0; k < P.count; k++) { pos.set([P.getX(k), P.getY(k), P.getZ(k)], (v + k) * 3); nor.set([N.getX(k), N.getY(k), N.getZ(k)], (v + k) * 3); col.set([it.col.r, it.col.g, it.col.b], (v + k) * 3); if (U) uv.set([U.getX(k), U.getY(k)], (v + k) * 2); }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[i++] = g.index.getX(k) + v; else for (let k = 0; k < P.count; k++) idx[i++] = k + v;
    // double-sided source materials: add back faces so a single-sided merged material still shows them
    v += P.count; }
  let I = Array.from(idx); const ds = []; let vv = 0; for (const it of list) { const n = it.g.attributes.position.count; if (it.side === THREE.DoubleSide) ds.push([vv, vv + n]); vv += n; }
  if (ds.length) { const extra = []; for (let k = 0; k < I.length; k += 3) { const a = I[k]; if (ds.some(([s, e]) => a >= s && a < e)) extra.push(I[k], I[k + 2], I[k + 1]); } I = I.concat(extra); }
  return { pos, nor, col, uv, idx: Uint32Array.from(I) }; }
function simplify(m, ratio) { const target = Math.max(3, Math.floor(m.idx.length * ratio / 3) * 3); if (m.idx.length < 300) return m;
  const r = MeshoptSimplifier.simplify(m.idx, m.pos, 3, target, 0.03, ['LockBorder']); const out = Array.from(r[0] || r);
  const map = new Map(), pos = [], nor = [], col = [], uv = [], idx = []; for (const a of out) { let k = map.get(a); if (k === undefined) { k = pos.length / 3; map.set(a, k); pos.push(m.pos[a * 3], m.pos[a * 3 + 1], m.pos[a * 3 + 2]); nor.push(m.nor[a * 3], m.nor[a * 3 + 1], m.nor[a * 3 + 2]); col.push(m.col[a * 3], m.col[a * 3 + 1], m.col[a * 3 + 2]); uv.push(m.uv[a * 2], m.uv[a * 2 + 1]); } idx.push(k); }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), col: new Float32Array(col), uv: new Float32Array(uv), idx: new Uint32Array(idx) }; }
function pack(model, parts) { // quantized binary
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of parts) for (let k = 0; k < p.m.pos.length; k++) { lo[k % 3] = Math.min(lo[k % 3], p.m.pos[k]); hi[k % 3] = Math.max(hi[k % 3], p.m.pos[k]); }
  const chunks = [], head = { model, lo, hi, parts: [] }; let off = 0; const add = (ta) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } const o = off; chunks.push(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)); off += ta.byteLength; return o; };
  for (const p of parts) { const m = p.m, nv = m.pos.length / 3; const q = new Uint16Array(nv * 3); for (let k = 0; k < q.length; k++) q[k] = Math.round((m.pos[k] - lo[k % 3]) / (hi[k % 3] - lo[k % 3] || 1) * 65535);
    const n = new Int8Array(nv * 3); for (let k = 0; k < n.length; k++) n[k] = Math.round(Math.max(-1, Math.min(1, m.nor[k])) * 127);
    const e = { layer: p.layer, role: p.role, lod: p.lod, nv, ni: m.idx.length, i32: nv > 65535 }; e.pos = add(q); e.nor = add(n);
    if (['metal', 'matte', 'lamp'].includes(p.role)) { const c = new Uint8Array(nv * 3); for (let k = 0; k < c.length; k++) c[k] = Math.round(Math.min(1, m.col[k]) * 255); e.col = add(c); }
    if (p.role === 'plate') { const u = new Uint16Array(nv * 2); for (let k = 0; k < u.length; k++) u[k] = Math.round(Math.max(0, Math.min(1, m.uv[k])) * 65535); e.uv = add(u); }
    e.idx = add(e.i32 ? m.idx : Uint16Array.from(m.idx)); head.parts.push(e); }
  const hj = new TextEncoder().encode(JSON.stringify(head)); const hpad = (4 - ((8 + hj.length) % 4)) % 4; const total = 8 + hj.length + hpad + off; const buf = new Uint8Array(total); const dv = new DataView(buf.buffer);
  dv.setUint32(0, 0x31525756, true); dv.setUint32(4, hj.length + hpad, true); buf.set(hj, 8); for (let k = 0; k < hpad; k++) buf[8 + hj.length + k] = 32; let o = 8 + hj.length + hpad; for (const c of chunks) { buf.set(c, o); o += c.length; } return buf; }
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
window.bake = async (model) => { await MeshoptSimplifier.ready; const spec = (extras, wheels) => ({ model, paint: 'two', c1: C1, c2: C2, wheels, stance: 0, extras, plate: 0, tier: 0 });
  const base = collect(B[model](spec(0, 0), { lod: 1 })); const sigs = new Map(); for (const it of base) sigs.set(it.sig, (sigs.get(it.sig) || 0) + 1);
  const layers = { body: base.filter((it) => !it.wheel), w0: base.filter((it) => it.wheel), w2: collect(B[model](spec(0, 2), { lod: 1 })).filter((it) => it.wheel) };
  for (let bit = 0; bit < 9; bit++) { const all = collect(B[model](spec(1 << bit, 0), { lod: 1 })).filter((it) => !it.wheel); const left = new Map(sigs); const ex = [];
    for (const it of all) { const n = left.get(it.sig) || 0; if (n > 0) left.set(it.sig, n - 1); else ex.push(it); } if (ex.length) layers['x' + bit] = ex; }
  const missing = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((b) => !layers['x' + b]); Object.assign(layers, genericExtras(layers.body.filter((it) => it.role === 'paint' || it.role === 'paint2'), missing));
  const parts = [], stats = {}; for (const L in layers) for (const role of ROLES) { const list = layers[L].filter((it) => it.role === role); if (!list.length) continue; const m = merge(list); const f = simplify(m, L === 'body' ? 0.14 : 0.2);
    parts.push({ layer: L, role, lod: 0, m }, { layer: L, role, lod: 1, m: f }); stats[L] = stats[L] || [0, 0]; stats[L][0] += m.idx.length / 3; stats[L][1] += f.idx.length / 3; }
  const bin = pack(model, parts); return { b64: b64(bin), bytes: bin.length, stats }; };
document.title = 'ready';
