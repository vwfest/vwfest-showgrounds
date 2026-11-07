// Pre-baked avatar surfaces (docs/hd/av/*.bin, made by tools/hd/bake-avatar.js): body per (sex, build) at several triangle targets + shoes.
// The SDF sculpt -> surface nets -> simplify pipeline is far too slow for the client, so it only ever runs in the bake.
const store = new Map(); let shoes = null; const pending = new Map();
const base = () => ((typeof window !== 'undefined' && window.SG_ASSETS) || '') + 'hd/av/';
function parse(buf) { const dv = new DataView(buf), hl = dv.getUint32(0, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))), o = 4 + hl;
  return head.map((e) => ({ lod: e.lod, target: e.target, P: new Float32Array(buf, o + e.p, e.nv * 3), I: e.i32 ? new Uint32Array(buf, o + e.i, e.ni) : new Uint16Array(buf, o + e.i, e.ni) })); }
const get = (name) => { let p = pending.get(name); if (!p) { p = fetch(base() + name + '.bin').then((r) => { if (!r.ok) throw new Error('avatar bake ' + name + ': ' + r.status); return r.arrayBuffer(); }).then(parse); pending.set(name, p); } return p; };
export async function loadAvatarBake(sex, body) { const k = sex + '' + body; if (!store.has(k)) store.set(k, await get('b' + k)); if (!shoes) shoes = await get('shoe'); }
export const avatarBakeReady = (sex, body) => store.has(sex + '' + body) && !!shoes;
export function bakedBody(sex, body, lod, target) { const list = store.get(sex + '' + body).filter((e) => e.lod === lod).sort((a, b) => b.target - a.target);
  return list.find((e) => e.target <= target) || list[list.length - 1]; }
export function bakedShoe(lod) { const l = shoes.filter((e) => e.lod === lod); return l[0] || shoes[0]; }
