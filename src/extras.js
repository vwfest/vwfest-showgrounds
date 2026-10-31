// Vendor Row (booth plots behind the stage) and the Info Booth by the entrance. Booth tents are one small merged mesh per plot and are rebuilt only when
// that plot's state changes; signs are canvas textures (banner images load from the game server's /vendor/img).
import { THREE, Batch, MAT, shade, cTex } from './batch.js';
export const VROW_Z = -113;
export function plotLayout(n) { const half = Math.ceil(n / 2), out = []; for (let i = 0; i < n; i++) out.push({ plot: i + 1, x: i < half ? -(9.5 + (half - 1 - i) * 9.5) : 9.5 + (i - half) * 9.5, z: VROW_Z }); return out; }
const cvs = (w, h, draw) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); draw(x, w, h); const t = cTex(cv); t.anisotropy = 4; return { t, cv, x }; };
const fit = (x, text, maxW, size, font = 'Arial Black, Arial, sans-serif') => { let s = size; do { x.font = `900 ${s}px ${font}`; s -= 2; } while (x.measureText(text).width > maxW && s > 16); return text; };
const sign = (w, h, tex) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));

export function tentGeo(style, c1, c2) {
  const b = new Batch(), w = 7, d = 5, hgt = 3.2; for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.14, hgt, 0.14, '#cfd3da', dx * w / 2, hgt / 2, dz * d / 2);
  const n = 6; const stripe = (i, y, c, k) => b.box(w / n, 0.05, d, i % 2 ? c1 : c2, -w / 2 + (i + 0.5) * (w / n), y, 0);
  if (style === 0) { for (let i = 0; i < n; i++) stripe(i, hgt + 0.15); for (let i = 0; i < n; i++) b.box(w / n, 0.5, 0.05, i % 2 ? c1 : c2, -w / 2 + (i + 0.5) * (w / n), hgt - 0.25, d / 2); }
  else if (style === 1) { b.box(w + 0.6, 0.12, d + 0.6, c1, 0, hgt + 0.2, 0); b.box(w + 0.6, 0.6, 0.08, c2, 0, hgt - 0.1, d / 2 + 0.3); b.box(w * 0.7, 0.3, d * 0.7, c2, 0, hgt + 0.45, 0); }
  else if (style === 2) { const a = 0.38, L = (d / 2) / Math.cos(a); for (const s of [-1, 1]) b.box(w + 0.4, 0.07, L + 0.2, s > 0 ? c1 : c2, 0, hgt + 0.55, s * (d / 4), 0, -s * a * -1, 0); b.box(w + 0.4, 0.14, 0.14, '#cfd3da', 0, hgt + 0.95, 0); }
  else if (style === 3) { for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) b.box(w / n, 0.05, d / 4, (i + j) % 2 ? c1 : c2, -w / 2 + (i + 0.5) * (w / n), hgt + 0.15, -d / 2 + (j + 0.5) * (d / 4)); b.box(w + 0.4, 0.5, 0.06, c1, 0, hgt - 0.2, d / 2 + 0.02); }
  else { for (let k = 0; k < 4; k++) b.box(w * (1 - k * 0.22), 0.28, d * (1 - k * 0.22), k % 2 ? c2 : c1, 0, hgt + 0.15 + k * 0.28, 0); }
  b.box(w - 0.6, 0.9, 1.1, '#8a6a3f', 0, 0.45, d / 2 - 0.9); b.box(w - 0.2, 0.06, 1.3, shade(c1, 0.9), 0, 0.93, d / 2 - 0.9);
  for (let k = 0; k < 6; k++) b.box(0.3 + (k % 3) * 0.1, 0.3, 0.3, [c1, c2, '#ffd166', '#4ea8ff', '#06d6a0', '#ff6b6b'][k], -w / 2 + 1 + k * 1.05, 1.1, d / 2 - 0.9);
  return b.build();
}
const money = (n) => '$' + (Number.isInteger(+n) ? n : (+n).toFixed(2));

export function buildExtras(scene, api, ctx) {
  const { colliders, spots } = api; const out = { plots: new Map() };
  const lay = plotLayout(ctx.plots || 24); const pad = new Batch(), post = new Batch();
  const ox = lay.length ? Math.min(...lay.map((p) => p.x)) - 6 : 0, ex = lay.length ? Math.max(...lay.map((p) => p.x)) + 6 : 0;
  pad.box(ex - ox + 10, 0.05, 26, '#5b5f68', (ox + ex) / 2, 0.03, VROW_Z + 2); pad.box(ex - ox + 10, 0.06, 6, '#3a3d44', (ox + ex) / 2, 0.035, VROW_Z + 12);
  scene.add(new THREE.Mesh(pad.build(), MAT.lambert));
  // arch over the centre aisle
  { const b = new Batch(); for (const s of [-1, 1]) b.box(0.8, 9, 0.8, '#2b2d42', s * 6, 4.5, VROW_Z + 6); b.box(13, 1, 0.8, '#2b2d42', 0, 9.3, VROW_Z + 6); scene.add(new THREE.Mesh(b.build(), MAT.lambert));
    const t = cvs(1024, 220, (x, w, h) => { x.fillStyle = '#10081f'; x.fillRect(0, 0, w, h); x.strokeStyle = '#33f0ff'; x.lineWidth = 10; x.strokeRect(8, 8, w - 16, h - 16); x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = '#ff2fd0'; x.shadowBlur = 24; x.fillStyle = '#ff2fd0'; x.font = '900 100px Arial Black, Arial'; x.fillText('VENDOR ROW', w / 2, 90); x.shadowColor = '#33f0ff'; x.fillStyle = '#33f0ff'; x.font = '900 44px Arial Black, Arial'; x.fillText('shop the show', w / 2, 175); });
    const m = sign(12.4, 2.6, t.t); m.position.set(0, 9.3, VROW_Z + 6.45); scene.add(m); const m2 = sign(12.4, 2.6, t.t); m2.position.set(0, 9.3, VROW_Z + 5.55); m2.rotation.y = Math.PI; scene.add(m2); }
  const imgs = new Map(); const loadImg = (id, cb) => { if (!id) return cb(null); if (imgs.has(id)) { const i = imgs.get(id); return i.complete ? cb(i) : i.addEventListener('load', () => cb(i)); } const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async'; imgs.set(id, i); i.onload = () => cb(i); i.onerror = () => cb(null); i.src = `${ctx.server}/vendor/img/${id}.jpg`; };
  for (const L of lay) {
    const g = new THREE.Group(); g.position.set(L.x, 0, L.z); scene.add(g); const rec = { L, g, tent: null, sign: null, key: '', spot: null };
    post.box(0.2, 1.3, 0.2, '#cfd3da', L.x - 3.6, 0.65, L.z + 5.2); rect(colliders, L.x, L.z + 0.2, 7.4, 5.2); // plot post + collision
    rec.spot = { x: L.x, z: L.z + 4.6, r: 3.6, id: 'vendor:' + L.plot, label: `Booth #${L.plot}`, plot: L.plot }; spots.push(rec.spot); out.plots.set(L.plot, rec);
  }
  scene.add(new THREE.Mesh(post.build(), MAT.lambert));
  function paintSign(rec, v, bannerImg) {
    const W = 768, H = 288; const c = rec.sign ? rec.sign.cv : null;
    const t = rec.sign || cvs(W, H, () => {}); rec.sign = t; const x = t.x;
    x.clearRect(0, 0, W, H); x.fillStyle = v && v.state === 'open' ? v.c1 : '#2a2d36'; x.fillRect(0, 0, W, H); x.fillStyle = '#0e0a1c'; x.fillRect(10, 10, W - 20, H - 20); x.textAlign = 'center'; x.textBaseline = 'middle';
    if (v && v.state === 'open') { if (bannerImg) { x.drawImage(bannerImg, 10, 10, W - 20, H - 20); x.fillStyle = '#0009'; x.fillRect(10, H - 78, W - 20, 68); } x.fillStyle = '#fff'; x.shadowColor = '#000'; x.shadowBlur = 8; fit(x, v.name, W - 70, 56); x.fillText(v.name, W / 2, bannerImg ? H - 44 : H / 2 - 20); x.shadowBlur = 0; if (!bannerImg) { x.fillStyle = '#ffd166'; x.font = '700 34px Arial'; x.fillText('by ' + v.nick, W / 2, H / 2 + 44); } x.fillStyle = '#ffffffcc'; x.font = '700 26px Arial'; x.textAlign = 'left'; x.fillText('#' + v.plot, 28, 36); }
    else if (v && v.state === 'grace') { x.fillStyle = '#aaa'; x.font = '900 60px Arial Black, Arial'; x.fillText('CLOSED', W / 2, H / 2 - 20); x.font = '700 30px Arial'; x.fillText('owner can renew · #' + rec.L.plot, W / 2, H / 2 + 40); }
    else { x.fillStyle = '#33f0ff'; x.shadowColor = '#33f0ff'; x.shadowBlur = 16; x.font = '900 64px Arial Black, Arial'; x.fillText('AVAILABLE', W / 2, H / 2 - 36); x.shadowBlur = 0; x.fillStyle = '#ffd166'; x.font = '900 48px Arial Black, Arial'; x.fillText(`Booth #${rec.L.plot}`, W / 2, H / 2 + 24); x.fillStyle = '#fff'; x.font = '700 30px Arial'; x.fillText(`claim it for ${money(ctx.feeUsd || 30)} · press F`, W / 2, H / 2 + 76); }
    t.t.needsUpdate = true;
    if (!rec.signMesh) { rec.signMesh = sign(6.4, 2.4, t.t); rec.signMesh.position.set(0, 4.7, 2.6); rec.g.add(rec.signMesh); rec.sp = sign(6.4, 2.4, t.t); rec.sp.position.set(0, 4.7, 2.5); rec.sp.rotation.y = Math.PI; rec.g.add(rec.sp); }
  }
  // list: [{plot, state:'open'|'grace', name, nick, tent, c1, c2, banner, exp}]
  out.update = (list) => {
    const by = new Map(list.map((b) => [b.plot, b])); out.by = by;
    for (const rec of out.plots.values()) {
      const v = by.get(rec.L.plot) || null; const key = v ? [v.state, v.tent, v.c1, v.c2, v.name, v.banner, v.nick].join('|') : 'free'; if (key === rec.key) continue; rec.key = key;
      if (rec.tent) { rec.g.remove(rec.tent); rec.tent.geometry.dispose(); rec.tent = null; }
      const st = v ? v.tent : 0, a = v && v.state === 'open' ? v.c1 : v ? '#777777' : '#4a4d55', b = v && v.state === 'open' ? v.c2 : v ? '#999999' : '#6a6f78';
      rec.tent = new THREE.Mesh(tentGeo(st, a, b), MAT.lambert); rec.g.add(rec.tent);
      paintSign(rec, v ? { ...v, plot: rec.L.plot } : null, null); if (v && v.state === 'open' && v.banner) loadImg(v.banner, (img) => { if (img && rec.key === key) paintSign(rec, { ...v, plot: rec.L.plot }, img); });
      rec.spot.label = v ? (v.state === 'open' ? `${v.name} (#${rec.L.plot})` : `Booth #${rec.L.plot} (closed)`) : `Booth #${rec.L.plot}: available for ${money(ctx.feeUsd || 30)}`;
    }
  };
  out.update([]);
  // ---------- Info Booth ----------
  { const x = -24, z = 49; const b = new Batch(); b.box(7, 0.25, 5, '#2b2d42', x, 0.13, z); b.box(6.2, 1.1, 1.2, '#f4f1ea', x, 0.8, z + 1.3); b.box(6.4, 0.18, 1.5, '#118ab2', x, 1.4, z + 1.3);
    for (const dx of [-3, 3]) for (const dz of [-1.8, 1.8]) b.box(0.18, 3.4, 0.18, '#cfd3da', x + dx, 1.8, z + dz); for (let i = 0; i < 8; i++) b.box(7.4 / 8, 0.08, 4.4, i % 2 ? '#118ab2' : '#f4f1ea', x - 3.7 + (i + 0.5) * (7.4 / 8), 3.55, z);
    b.box(0.35, 8.2, 0.35, '#2b2d42', x - 3.2, 4.1, z - 1.9); b.box(0.35, 8.2, 0.35, '#2b2d42', x + 3.2, 4.1, z - 1.9); b.box(7.4, 0.35, 0.35, '#2b2d42', x, 8.3, z - 1.9);
    for (let k = 0; k < 5; k++) b.box(0.5, 0.35, 0.3, ['#ff6b6b', '#ffd166', '#06d6a0', '#4ea8ff', '#c77dff'][k], x - 2 + k * 1, 1.7, z + 1.3); // brochures
    scene.add(new THREE.Mesh(b.build(), MAT.lambert)); rect(colliders, x, z, 7, 5);
    const t = cvs(1024, 512, (c, w, h) => { c.fillStyle = '#0b2a45'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ffd166'; c.lineWidth = 14; c.strokeRect(10, 10, w - 20, h - 20); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffd166'; c.beginPath(); c.arc(190, 256, 118, 0, 7); c.fill(); c.fillStyle = '#0b2a45'; c.font = '900 210px Arial Black, Arial'; c.fillText('i', 190, 262); c.shadowColor = '#33f0ff'; c.shadowBlur = 30; c.fillStyle = '#fff'; c.font = '900 210px Arial Black, Arial'; c.fillText('INFO', 650, 230); c.shadowBlur = 0; c.fillStyle = '#ffd166'; c.font = '800 52px Arial'; c.fillText('guide · prices · what\'s new', 610, 400); });
    for (const [d, ry] of [[-2.05, 0], [-1.75, Math.PI]]) { const m = sign(7.2, 3.6, t.t); m.position.set(x, 6.4, z + d - 0.0); m.rotation.y = ry; scene.add(m); }
    spots.push({ x, z: z + 4, r: 4.6, id: 'info', label: "Info Booth: guide & what's new" }); out.info = { x, z }; }
  return out;
}
function rect(colliders, x, z, w, d) { colliders.push({ x, z, hw: w / 2, hd: d / 2 }); }
