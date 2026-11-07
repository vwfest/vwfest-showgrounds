// Avatar bake (headless Chrome, never in the client): body surface per (sex, build) at several triangle targets per LOD, plus shoes.
import { sculpt, makeSDF, surfaceNets, simplify } from './src/avatar/body.js';
import { shoeSDF } from './src/avatar/shoe.js';
const TARGETS = { 1: [4800, 4200, 3600, 3000, 2400, 1800, 1200], 2: [1000, 800, 600, 450, 300] };
function pack(entries) { const head = [], chunks = []; let off = 0; const add = (ta) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } const o = off; chunks.push(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)); off += ta.byteLength; return o; };
  for (const e of entries) { const nv = e.P.length / 3, i32 = nv > 65535; head.push({ lod: e.lod, target: e.target, nv, ni: e.I.length, i32, p: add(Float32Array.from(e.P)), i: add(i32 ? Uint32Array.from(e.I) : Uint16Array.from(e.I)) }); }
  let hj = new TextEncoder().encode(JSON.stringify(head)); const hp = (4 - ((4 + hj.length) % 4)) % 4; const buf = new Uint8Array(4 + hj.length + hp + off); new DataView(buf.buffer).setUint32(0, hj.length + hp, true); buf.set(hj, 4); buf.fill(32, 4 + hj.length, 4 + hj.length + hp); let o = 4 + hj.length + hp; for (const c of chunks) { buf.set(c, o); o += c.length; } return buf; }
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
window.bakeBody = async (sex, body) => { const S = sculpt({ sex, body, height: 1, age: 1 }), sdf = makeSDF(S.prims); const raw = surfaceNets(sdf, [-0.31, -0.004, -0.175], [0.31, 1.66, 0.2], 0.0026); const out = [];
  for (const lod of [1, 2]) for (const t of TARGETS[lod]) { const s = await simplify(raw.P, raw.I, t); out.push({ lod, target: t, ...s }); } const b = pack(out); return { b64: b64(b), bytes: b.length }; };
window.bakeShoe = async () => { const raw = surfaceNets(shoeSDF, [-0.06, -0.003, -0.13], [0.06, 0.125, 0.145], 0.0025); const out = []; for (const lod of [1, 2]) { const s = await simplify(raw.P, raw.I, [1400, 500, 120][lod]); out.push({ lod, target: 0, ...s }); } const b = pack(out); return { b64: b64(b), bytes: b.length }; };
document.title = 'ready';
