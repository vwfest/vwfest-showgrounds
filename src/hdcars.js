// HD rides: pre-baked, code-built bodies (tools/hd bakes them once; nothing is sculpted at runtime).
// docs/hd/rides/m<N>.bin = quantized layers (body / each extra / wheels) x material roles x 2 LODs (near <=30k tris, far ~5k).
// Assembly per spec only concatenates arrays + sets vertex colours, then reuses the same 5 shared materials as the low-poly cars.
import { THREE } from './batch.js';
const DROP = [0, 0.04, 0.08, -0.12, 0.06], CAP = 30000, FAR = 28;
const models = new Map(), waiting = new Map();
const base = () => ((typeof window !== 'undefined' && window.SG_ASSETS) || '') + 'hd/rides/m';
function parse(buf) {
  const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x31525756) throw new Error('bad ride bake');
  const hl = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))), o0 = 8 + hl; const { lo, hi } = head; const parts = {};
  for (const e of head.parts) { const q = new Uint16Array(buf, o0 + e.pos, e.nv * 3), n = new Int8Array(buf, o0 + e.nor, e.nv * 3); const pos = new Float32Array(e.nv * 3), nor = new Float32Array(e.nv * 3);
    for (let k = 0; k < pos.length; k++) { const a = k % 3; pos[k] = lo[a] + (q[k] / 65535) * (hi[a] - lo[a]); nor[k] = n[k] / 127; }
    const p = { role: e.role, pos, nor, idx: e.i32 ? new Uint32Array(buf, o0 + e.idx, e.ni) : new Uint16Array(buf, o0 + e.idx, e.ni), tris: e.ni / 3 };
    if (e.col !== undefined) { const c = new Uint8Array(buf, o0 + e.col, e.nv * 3); p.col = new Float32Array(c.length); for (let k = 0; k < c.length; k++) p.col[k] = c[k] / 255; }
    if (e.uv !== undefined) { const u = new Uint16Array(buf, o0 + e.uv, e.nv * 2); p.uv = new Float32Array(u.length); for (let k = 0; k < u.length; k++) p.uv[k] = u[k] / 65535; }
    ((parts[e.layer] = parts[e.layer] || [[], []])[e.lod]).push(p); }
  return { parts, extras: Object.keys(parts).filter((k) => k[0] === 'x').map((k) => +k.slice(1)) };
}
export function hdReady(m) { return models.get(m) || null; }
export function loadHD(m, cb) { // cb fires once the model is ready (immediately if cached)
  const got = models.get(m); if (got) { if (cb) cb(got); return; } let w = waiting.get(m); if (!w) { w = []; waiting.set(m, w);
    fetch(base() + m + '.bin').then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => { const d = parse(b); models.set(m, d); for (const f of waiting.get(m)) f(d); waiting.delete(m); })
      .catch((e) => { console.warn('[hd] ride', m, 'stays low-poly:', e.message); waiting.delete(m); }); }
  if (cb) w.push(cb);
}
export function preloadHD() { for (let m = 0; m < 6; m++) loadHD(m); }
// lists: [{p, yOff, paint: Color|null}] -> BufferGeometry (position, normal, color[, uv])
function concat(items, withUv) {
  let nv = 0, ni = 0; for (const it of items) { nv += it.p.pos.length / 3; ni += it.p.idx.length; } if (!ni) return null;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = withUv ? new Float32Array(nv * 2) : null, idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni); let v = 0, i = 0;
  for (const it of items) { const p = it.p, n = p.pos.length / 3; pos.set(p.pos, v * 3); nor.set(p.nor, v * 3); if (it.yOff) for (let k = 0; k < n; k++) pos[(v + k) * 3 + 1] += it.yOff;
    if (it.paint) for (let k = 0; k < n; k++) { col[(v + k) * 3] = it.paint.r; col[(v + k) * 3 + 1] = it.paint.g; col[(v + k) * 3 + 2] = it.paint.b; } else if (p.col) col.set(p.col, v * 3); else col.fill(1, v * 3, (v + n) * 3);
    if (uv && p.uv) uv.set(p.uv, v * 2); for (let k = 0; k < p.idx.length; k++) idx[i++] = p.idx[k] + v; v += n; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
const GLASS_TINT = new THREE.Color('#16222b');
// spec as in cars.js. legacy: {bins} low-poly extras for trait bits the HD bake has no geometry for (keeps every NFT trait visible).
// Returns { near:{role:geo}, far:{role:geo}, tris:[near,far] }.
export function assembleHD(d, spec, legacyBins) {
  const c1 = new THREE.Color(spec.c1), c2 = new THREE.Color(spec.c2 || spec.c1), yOff = -(DROP[spec.stance] || 0), E = spec.extras || 0;
  const wl = spec.wheels === 2 ? 'w2' : 'w0'; const xs = d.extras.filter((b) => E & (1 << b)).map((b) => 'x' + b);
  const pick = (layer, lod) => (d.parts[layer] || [[], []])[lod] || [];
  const sum = (layers, lods) => layers.reduce((a, L, i) => a + pick(L, lods[i]).reduce((s, p) => s + p.tris, 0), 0);
  // near budget: body + wheels + extras <= 30k; heavy extras fall back to their far LOD first, then the wheels.
  const layers = ['body', wl, ...xs]; const lods = layers.map(() => 0);
  for (let k = layers.length - 1; k >= 1 && sum(layers, lods) > CAP; k--) lods[k] = 1;
  const out = { near: {}, far: {}, tris: [0, 0] };
  for (const [slot, ls] of [['near', lods], ['far', layers.map(() => 1)]]) { const byRole = {};
    layers.forEach((L, i) => { for (const p of pick(L, ls[i])) { const role = p.role === 'paint2' ? 'paint' : p.role; (byRole[role] = byRole[role] || []).push({ p, yOff: L[0] === 'w' ? 0 : yOff, paint: p.role === 'paint' ? c1 : p.role === 'paint2' ? c2 : p.role === 'glass' ? GLASS_TINT : null }); } });
    if (legacyBins) for (const k in legacyBins) { const g = legacyBins[k]; const role = k === 'chrome' ? 'metal' : k === 'matte' ? 'matte' : k; const n = g.attributes.position.count;
      const p = { pos: g.attributes.position.array, nor: g.attributes.normal.array, col: g.attributes.color.array, idx: g.index ? g.index.array : Uint32Array.from({ length: n }, (_, i) => i), tris: 0 }; (byRole[role] = byRole[role] || []).push({ p, yOff: 0 }); }
    for (const r in byRole) { const g = concat(byRole[r], r === 'plate'); if (g) { out[slot][r] = g; out.tris[slot === 'near' ? 0 : 1] += g.index.count / 3; } } }
  return out;
}
export const HD_FAR = FAR;
