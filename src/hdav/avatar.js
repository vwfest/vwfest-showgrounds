// Prototype: smoother procedural avatar (100% code-built), driven by the existing trait indices (shared/traits.js PAL/NAMES).
import * as THREE from 'three';
const PAL = {
  skin: ['f6d2b0', 'f2c9a0', 'e0a878', 'c68642', 'a8693a', '8d5524', '6b3f1d', '4a2c15'],
  hair: ['1b1b1b', '3b2314', '5a3a1e', '8b5a2b', 'c8903a', 'e4c26a', 'b5392a', 'c9c9c9', '3a86ff', 'ff5da2', '2ec4b6', '7b2cbf'],
  shirt: ['d62828', 'f77f00', 'fcbf49', '2a9d8f', '1d8fe1', '7b2cbf', 'ff4fa3', 'f1faee', '2b2d42', '6a994e', '00c2a8', 'e9c46a', '9d0208', '48cae4', 'adb5bd', '0b6e4f'],
  pants: ['264653', '3d405b', '1b4332', '6b4423', '8d99ae', '14213d', '5c2a2a', 'bfa88a', '343a40', '2f6690'],
  eyes: ['5b3a29', '3a2418', '8a6a2f', '4a8f4f', '3f7fd6', '8b99a6', 'c58b2a', '8a5ad6'],
};
const C = (k, i) => new THREE.Color('#' + PAL[k][i]);
const g2 = (x, s) => Math.exp(-(x * x) / (2 * s * s));
let TRI = 0;
const mesh = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; if (parent) parent.add(m); TRI += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; return m; };
const lathe = (prof, seg = 20) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0005), y)), seg, Math.PI, Math.PI * 2);
const canvasTex = (w, h, draw, srgb = true) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
// fabric normal map: weave + soft wrinkles (folds) baked as height -> normal
function foldNormal(seed = 1, folds = 1) { return canvasTex(256, 256, (x, w, h) => { const H = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let v = 0.06 * Math.sin(i * 1.6) * Math.sin(j * 1.6); // weave
    v += folds * (0.5 * Math.sin((i * 0.05 + j * 0.02) * 6.283 * 0.6 + seed) * g2(j - h * 0.75, 40) + 0.35 * Math.sin((i * 0.07 - j * 0.03) * 6.283 * 0.5 + seed * 2) * g2(j - h * 0.25, 35) + 0.25 * Math.sin(j * 0.09 + Math.sin(i * 0.04) * 2));
    H[j * w + i] = v; }
  const id = x.createImageData(w, h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; const dx = H[j * w + ((i + 1) % w)] - H[j * w + ((i - 1 + w) % w)], dy = H[((j + 1) % h) * w + i] - H[((j - 1 + h) % h) * w + i];
    const n = new THREE.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize(); id.data[k * 4] = (n.x * 0.5 + 0.5) * 255; id.data[k * 4 + 1] = (n.y * 0.5 + 0.5) * 255; id.data[k * 4 + 2] = (n.z * 0.5 + 0.5) * 255; id.data[k * 4 + 3] = 255; }
  x.putImageData(id, 0, 0); }, false); }
const strandNormal = () => canvasTex(128, 256, (x, w, h) => { const id = x.createImageData(w, h); for (let i = 0; i < w; i++) { const ph = Math.random() * 6.28, f = 0.6 + Math.random(); for (let j = 0; j < h; j++) { const nx = Math.sin(i * f + ph) * 0.5; const k = (j * w + i) * 4; id.data[k] = (nx * 0.5 + 0.5) * 255; id.data[k + 1] = 128; id.data[k + 2] = 230; id.data[k + 3] = 255; } } x.putImageData(id, 0, 0); }, false);
function shirtMap(base, pattern, outfit) { return canvasTex(512, 512, (x, w, h) => { x.fillStyle = base; x.fillRect(0, 0, w, h);
  if (outfit === 2) { for (let i = 0; i < 60; i++) { const cx = (i * 97) % w, cy = (i * 61) % h; x.fillStyle = i % 3 ? '#ffffff' : '#ffd166'; for (let p = 0; p < 5; p++) { const a = p / 5 * 6.283; x.beginPath(); x.ellipse(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, 8, 4, a, 0, 6.283); x.fill(); } x.fillStyle = '#e76f51'; x.beginPath(); x.arc(cx, cy, 4, 0, 6.283); x.fill(); } }
  if (pattern === 1) { x.fillStyle = 'rgba(255,255,255,0.92)'; for (let j = 0; j < h; j += 42) x.fillRect(0, j, w, 14); }
  const fx = w * 0.5, fy = h * 0.42; // chest print (u=0.5 is the front)
  if (pattern === 2) { x.strokeStyle = '#fff'; x.lineWidth = 9; x.beginPath(); x.arc(fx, fy, 34, 0, 6.283); x.moveTo(fx, fy - 34); x.lineTo(fx, fy + 34); x.moveTo(fx, fy); x.lineTo(fx - 24, fy + 24); x.moveTo(fx, fy); x.lineTo(fx + 24, fy + 24); x.stroke(); }
  if (pattern === 3) { // generic round-roof car silhouette (no manufacturer marks)
    x.fillStyle = '#fff'; x.beginPath(); x.ellipse(fx, fy + 6, 46, 26, 0, Math.PI, 0); x.rect(fx - 52, fy + 4, 104, 14); x.fill(); x.fillStyle = base; for (const s of [-1, 1]) { x.beginPath(); x.arc(fx + s * 30, fy + 20, 11, 0, 6.283); x.fill(); } x.fillStyle = '#fff'; for (const s of [-1, 1]) { x.beginPath(); x.arc(fx + s * 30, fy + 20, 7, 0, 6.283); x.fill(); } }
  // seams: side seams + hem stitch
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 2; for (const u of [0.0, 0.999, 0.25, 0.75]) { x.beginPath(); x.moveTo(u * w, 0); x.lineTo(u * w, h); x.stroke(); }
  x.setLineDash([6, 5]); x.beginPath(); x.moveTo(0, h - 10); x.lineTo(w, h - 10); x.stroke(); }); }

export function buildAvatar(av, { lod = 0 } = {}) {
  TRI = 0; const hi = lod === 0, S = hi ? 1 : 0.6, seg = (n) => Math.max(6, Math.round(n * S));
  const skinC = C('skin', av.skin), hairC = av.age === 3 && av.hair < 7 ? C('hair', av.hair).lerp(new THREE.Color('#d9d9d9'), 0.55) : C('hair', av.hair);
  const shirtC = C('shirt', av.shirt), pantsC = C('pants', av.pants), eyeC = C('eyes', av.eyes);
  const fem = av.sex === 1, bw = [0.9, 1, 1.13][av.body], outfit = av.outfit, overalls = outfit === 1, jacket = outfit === 3, vest = outfit === 4;
  const denim = new THREE.Color('#2f5d9a');
  // materials
  const skin = new THREE.MeshPhysicalMaterial({ color: skinC, roughness: 0.52, sheen: 0.6, sheenColor: new THREE.Color('#ff9a7a'), sheenRoughness: 0.5, clearcoat: 0.08, clearcoatRoughness: 0.6 });
  const cloth = (col, map, folds = 1, rough = 0.88) => new THREE.MeshPhysicalMaterial({ color: map ? 0xffffff : col, map: map || null, roughness: rough, sheen: 0.5, sheenColor: new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.5), sheenRoughness: 0.7, normalMap: foldNormal(av.shirt + folds, folds), normalScale: new THREE.Vector2(0.6, 0.6) });
  const shirtMat = cloth(shirtC, shirtMap('#' + shirtC.getHexString(), av.pattern, outfit), 1);
  const pantsMat = cloth(overalls ? denim : pantsC, null, 0.8, 0.9);
  const jacketMat = cloth(new THREE.Color('#3f6fa8'), null, 1.2, 0.85);
  const hairMat = new THREE.MeshStandardMaterial({ color: hairC, roughness: 0.45, metalness: 0.05, normalMap: strandNormal(), normalScale: new THREE.Vector2(0.8, 0.8) });
  const dark = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.55 }), sole = new THREE.MeshStandardMaterial({ color: '#e9e4d6', roughness: 0.7 });
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const hipY = 0.93, shY = 1.42, headY = 1.605;
  // ---- pelvis + torso (lathe, elliptical) ----
  const chest = (fem ? 0.165 : 0.18) * bw, waist = (fem ? 0.13 : 0.15) * bw, hip = (fem ? 0.17 : 0.155) * bw;
  const torsoP = [[0.0, 0], [hip * 0.9, 0.0], [hip, 0.06], [waist * 1.02, 0.2], [waist, 0.26], [chest * 0.97, 0.36], [chest, 0.42], [chest * 0.95, 0.47], [chest * 0.7, 0.51], [0.06, 0.55], [0.055, 0.6]];
  const torso = new THREE.Group(); torso.position.y = hipY; body.add(torso);
  const shirtTop = mesh(lathe(torsoP.slice(2).map(([r, y]) => [r, y]), seg(28)), jacket ? jacketMat : shirtMat, torso); shirtTop.scale.set(1, 1, 0.62);
  const pelvis = mesh(lathe([[0, -0.02], [hip * 0.6, -0.02], [hip * 0.95, 0.0], [hip * 1.01, 0.03], [hip * 1.03, 0.07], [waist * 1.04, 0.12]], seg(28)), pantsMat, torso); pelvis.scale.set(1, 1, 0.68);
  const beltM = mesh(new THREE.TorusGeometry(waist * 1.03, 0.012, 6, seg(28)), new THREE.MeshStandardMaterial({ color: '#3a2a1e', roughness: 0.5 }), torso); beltM.rotation.x = Math.PI / 2; beltM.scale.set(1, 0.66, 1.4); beltM.position.y = 0.11;
  if (fem) for (const s of [-1, 1]) { const b = mesh(new THREE.SphereGeometry(0.06 * bw, seg(14), seg(10)), jacket ? jacketMat : shirtMat, torso); b.position.set(s * 0.065, 0.38, 0.065 * bw); b.scale.set(1, 0.9, 0.75); }
  const collar = mesh(new THREE.TorusGeometry(0.068, 0.012, 6, seg(20)), jacket ? jacketMat : shirtMat, torso); collar.rotation.x = Math.PI / 2 - 0.25; collar.position.set(0, 0.535, 0.005); collar.scale.set(1, 0.75, 1);
  if (jacket) { const lap = mesh(new THREE.BoxGeometry(0.012, 0.32, 0.01), new THREE.MeshStandardMaterial({ color: '#274b78' }), torso); lap.position.set(0, 0.33, 0.115 * bw); for (let i = 0; i < 4; i++) { const bt = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 1, roughness: 0.3 }), torso); bt.position.set(0.02, 0.22 + i * 0.07, 0.118 * bw); } }
  if (overalls) { const bib = mesh(new THREE.BoxGeometry(0.2 * bw, 0.22, 0.02), pantsMat, torso); bib.position.set(0, 0.27, 0.105 * bw); bib.rotation.x = -0.05; for (const s of [-1, 1]) { const st = mesh(new THREE.BoxGeometry(0.04, 0.3, 0.015), pantsMat, torso); st.position.set(s * 0.08, 0.4, 0.1 * bw); st.rotation.x = -0.35; const bk = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffd166', metalness: 1, roughness: 0.3 }), torso); bk.position.set(s * 0.08, 0.36, 0.118 * bw); } }
  if (vest) for (const s of [-1, 1]) { const v = mesh(new THREE.LatheGeometry(torsoP.slice(3, 9).map(([r, y]) => new THREE.Vector2(r * 1.07, y)), seg(14), Math.PI + s * 0.25, Math.PI * 0.85), cloth(new THREE.Color('#8a5a2b'), null, 0.6), torso); v.scale.set(1, 1, 0.66); if (s < 0) v.rotation.y = Math.PI * 0.15 * -1; }
  // ---- neck + head ----
  const neck = mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.12, seg(16)), skin, body); neck.position.y = shY + 0.12;
  const head = new THREE.Group(); head.position.y = headY; body.add(head);
  const hg = new THREE.SphereGeometry(0.115, seg(56), seg(42)); const p = hg.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); let { x, y, z } = v; const fr = Math.max(0, z);
    let sx = 0.8, sy = 1.08, sz = 0.98; if (y < 0) { sx *= 1 - 0.28 * Math.pow(-y, 1.6) * (fem ? 1.15 : 0.95); sz *= 1 - 0.12 * Math.pow(-y, 2); }
    let r = 1;
    r += 0.16 * fr * g2(x, 0.09) * g2(y + 0.08, 0.16) * (y < -0.26 ? 0.4 : 1); // nose
    r += 0.035 * fr * g2(y - 0.2, 0.07) * g2(x, 0.45); // brow
    r -= 0.045 * fr * g2(Math.abs(x) - 0.33, 0.11) * g2(y - 0.1, 0.09); // eye sockets
    r += 0.035 * fr * g2(Math.abs(x) - 0.45, 0.16) * g2(y + 0.18, 0.12); // cheekbones
    r += 0.03 * fr * g2(x, 0.2) * g2(y + 0.45, 0.06); // lips
    r += 0.04 * fr * g2(x, 0.2) * g2(y + 0.75, 0.1); // chin
    r += 0.06 * Math.max(0, -z) * g2(y - 0.25, 0.4); // occiput
    p.setXYZ(i, x * 0.115 * sx * r, y * 0.115 * sy * r, z * 0.115 * sz * r); }
  hg.computeVertexNormals(); const headM = mesh(hg, skin, head);
  const ray = new THREE.Raycaster(); const surf = (x, y) => { ray.set(new THREE.Vector3(x, y, 0.4), new THREE.Vector3(0, 0, -1)); root.updateMatrixWorld(true); const h = ray.intersectObject(headM)[0]; return h ? h.point.clone().sub(head.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(x, y, 0.1); };
  const eyeWhite = new THREE.MeshPhysicalMaterial({ color: '#f4f1ec', roughness: 0.1, clearcoat: 1 }), iris = new THREE.MeshStandardMaterial({ color: eyeC, roughness: 0.3 });
  for (const s of [-1, 1]) { const ep = surf(s * 0.036, 0.012); const e = new THREE.Group(); e.position.set(ep.x, ep.y, ep.z - 0.012); head.add(e);
    mesh(new THREE.SphereGeometry(0.0145, seg(16), seg(12)), eyeWhite, e); const ir = mesh(new THREE.CircleGeometry(0.0075, seg(16)), iris, e); ir.position.z = 0.0142; const pu = mesh(new THREE.CircleGeometry(0.0034, 10), dark, e); pu.position.z = 0.0144;
    const lid = mesh(new THREE.SphereGeometry(0.0158, seg(16), 6, 0, Math.PI * 2, 0, Math.PI * 0.42), skin, e); lid.rotation.x = -0.12;
    const brow = mesh(new THREE.CapsuleGeometry(0.004, 0.026, 3, 6), new THREE.MeshStandardMaterial({ color: hairC.clone().multiplyScalar(0.7), roughness: 0.8 }), head); const bp = surf(s * 0.037, 0.04); brow.position.set(bp.x, bp.y, bp.z + 0.001); brow.rotation.z = Math.PI / 2 + s * 0.12;
    const ear = mesh(new THREE.SphereGeometry(0.022, seg(12), seg(8)), skin, head); ear.position.set(s * 0.093, 0.0, -0.005); ear.scale.set(0.45, 1.25, 0.8); }
  { const mp = surf(0, -0.054); const lip = mesh(new THREE.CapsuleGeometry(0.006, 0.03, 3, 8), new THREE.MeshStandardMaterial({ color: skinC.clone().lerp(new THREE.Color('#a8483e'), 0.45), roughness: 0.45 }), head); lip.rotation.z = Math.PI / 2; lip.position.set(mp.x, mp.y, mp.z - 0.002); lip.scale.set(1, 1, 0.6); }
  // facial hair
  const fhMat = new THREE.MeshStandardMaterial({ color: hairC, roughness: 0.8, transparent: av.facial === 1, opacity: av.facial === 1 ? 0.28 : 1, normalMap: hairMat.normalMap });
  if (av.facial === 1 || av.facial === 4) { const bg = hg.clone(), bp2 = bg.attributes.position, col = new Float32Array(bp2.count * 4); const fc = hairC.clone().multiplyScalar(0.6);
    for (let i = 0; i < bp2.count; i++) { const x = bp2.getX(i), y = bp2.getY(i), z = bp2.getZ(i); const sm = (a, b, t) => { t = Math.min(1, Math.max(0, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
      let w = sm(-0.005, -0.04, y) * sm(-0.06, 0.0, z) * (1 - 0.85 * sm(0.03, 0.0, Math.hypot(x / 1.6, y + 0.054)) * sm(0.05, 0.08, z)) * (1 - sm(-0.09, -0.12, y)); // jaw+chin, mouth hole
      const k = 1.006 + (av.facial === 4 ? 0.12 * w * Math.max(0, -y / 0.12) : 0); bp2.setXYZ(i, x * k, y * (1 + (k - 1) * 0.6), z * k); col.set([fc.r, fc.g, fc.b, w * (av.facial === 1 ? 0.22 : 1)], i * 4); }
    bg.setAttribute('color', new THREE.BufferAttribute(col, 4)); bg.computeVertexNormals(); mesh(bg, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.9, depthWrite: false, normalMap: hairMat.normalMap }), head); }
  if (av.facial === 2 || av.facial === 3 || av.facial === 4 || av.facial === 5) { const mp = surf(0, -0.04); const mu = mesh(new THREE.CapsuleGeometry(0.008, 0.04, 3, 8), fhMat, head); mu.rotation.z = Math.PI / 2; mu.position.set(mp.x, mp.y, mp.z + 0.002); }
  if (av.facial === 3) { const cp = surf(0, -0.1); const go = mesh(new THREE.SphereGeometry(0.02, 10, 8), fhMat, head); go.position.copy(cp); go.scale.set(1, 1.3, 0.7); }
  // ---- hair (style-driven) ----
  const hs = av.hairStyle, cap = (scale = 1.07, cut = 0.56, back = 0.3) => { const g = new THREE.SphereGeometry(0.118, seg(40), seg(20), 0, Math.PI * 2, 0, Math.PI * cut); const m = mesh(g, hairMat, head); m.scale.set(0.84 * scale, 1.1 * scale, 1.02 * scale); m.rotation.x = -back; m.position.set(0, 0.008, -0.006); return m; };
  if (hs !== 6) {
    if (hs === 4) { const g = new THREE.IcosahedronGeometry(0.2, hi ? 4 : 3); const pp = g.attributes.position; for (let i = 0; i < pp.count; i++) { v.fromBufferAttribute(pp, i); const n = 1 + 0.05 * Math.sin(v.x * 90) * Math.sin(v.y * 80) * Math.sin(v.z * 70); pp.setXYZ(i, v.x * n, v.y * n * 0.95, v.z * n); } g.computeVertexNormals(); const m = mesh(g, hairMat, head); m.position.set(0, 0.06, -0.03); m.scale.set(1, 0.92, 0.95); }
    else if (hs === 3) { cap(1.02, 0.5, 0.35); const fin = mesh(new THREE.BoxGeometry(0.035, 0.08, 0.24, 1, 4, 8), hairMat, head); fin.position.set(0, 0.13, -0.02); const fp = fin.geometry.attributes.position; for (let i = 0; i < fp.count; i++) fp.setY(i, fp.getY(i) * (1 - 0.6 * (fp.getZ(i) / 0.12) ** 2)); fin.geometry.computeVertexNormals(); }
    else { cap(hs === 7 ? 1.1 : 1.04, hs === 0 ? 0.47 : 0.53, 0.5);
      if (hs === 1) { const sh = mesh(lathe([[0.1, 0.06], [0.112, -0.02], [0.11, -0.12], [0.1, -0.2], [0.07, -0.23]], seg(26)), hairMat, head); sh.scale.set(1, 1, 0.92); sh.position.z = -0.02; const pp = sh.geometry.attributes.position; for (let i = 0; i < pp.count; i++) if (pp.getZ(i) > 0.03) pp.setZ(i, 0.03 + (pp.getZ(i) - 0.03) * 0.15); sh.geometry.computeVertexNormals(); }
      if (hs === 2) { const bun = mesh(new THREE.SphereGeometry(0.05, seg(16), seg(12)), hairMat, head); bun.position.set(0, 0.12, -0.08); }
      if (hs === 5) { const tail = mesh(lathe([[0.025, 0], [0.035, -0.06], [0.03, -0.18], [0.01, -0.26]], seg(12)), hairMat, head); tail.position.set(0, 0.04, -0.12); tail.rotation.x = 0.35; const tie = mesh(new THREE.TorusGeometry(0.024, 0.007, 6, 12), dark, head); tie.position.set(0, 0.035, -0.12); tie.rotation.x = Math.PI / 2 + 0.35; }
      if (hs === 7) for (let i = 0; i < (hi ? 28 : 14); i++) { const a = i * 2.4, yy = 0.03 + (i % 5) * 0.022; const c = mesh(new THREE.SphereGeometry(0.03, 8, 6), hairMat, head); c.position.set(Math.sin(a) * 0.1, yy + 0.04, Math.cos(a) * 0.1 - 0.02); if (c.position.z > 0.05 && c.position.y < 0.08) c.visible = false; } } }
  // ---- hats ----
  const hatMat = (c) => cloth(new THREE.Color(c), null, 0.3, 0.8);
  const hy = 0.085;
  if (av.hat === 1) { const m = hatMat('#' + shirtC.getHexString()); const crown = mesh(new THREE.SphereGeometry(0.128, seg(28), seg(14), 0, Math.PI * 2, 0, Math.PI * 0.5), m, head); crown.position.set(0, hy - 0.03, -0.005); crown.scale.set(0.95, 0.9, 1.02); const brim = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.008, seg(20), 1, false, -Math.PI / 2, Math.PI), m, head); brim.position.set(0, hy - 0.03, 0.09); brim.rotation.x = 0.12; brim.scale.set(0.95, 1, 1.0); const btn = mesh(new THREE.SphereGeometry(0.01, 8, 6), m, head); btn.position.set(0, hy + 0.088, 0); }
  else if (av.hat === 2) { const m = hatMat('#e9dcc3'); mesh(new THREE.CylinderGeometry(0.11, 0.125, 0.1, seg(24)), m, head).position.y = hy + 0.03; const b = mesh(new THREE.CylinderGeometry(0.125, 0.19, 0.04, seg(24), 1, true), m, head); b.position.y = hy - 0.03; b.material.side = THREE.DoubleSide; }
  else if (av.hat === 3) { const m = new THREE.MeshStandardMaterial({ color: '#7a4b22', roughness: 0.75 }); const cr = mesh(lathe([[0.0, 0.12], [0.07, 0.11], [0.115, 0.08], [0.12, 0.0]], seg(24)), m, head); cr.position.y = hy - 0.01; const br = mesh(lathe([[0.12, 0.0], [0.2, 0.0], [0.24, 0.035]], seg(28)), m, head); br.position.y = hy - 0.015; br.scale.z = 0.85; br.material.side = THREE.DoubleSide; }
  else if (av.hat === 4) { const m = hatMat('#' + pantsC.getHexString()); const be = mesh(new THREE.SphereGeometry(0.128, seg(28), seg(14), 0, Math.PI * 2, 0, Math.PI * 0.55), m, head); be.position.y = hy - 0.04; be.scale.set(0.93, 1.05, 1.0); const rib = mesh(new THREE.TorusGeometry(0.115, 0.016, 6, seg(28)), m, head); rib.rotation.x = Math.PI / 2; rib.position.y = hy - 0.035; rib.scale.set(0.95, 1.05, 1); }
  else if (av.hat === 7) { const m = new THREE.MeshStandardMaterial({ color: '#d9b44a', roughness: 0.8 }); mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.09, seg(24)), m, head).position.y = hy + 0.02; const br = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.01, seg(28)), m, head); br.position.y = hy - 0.02; const band = mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.025, seg(24), 1, true), new THREE.MeshStandardMaterial({ color: '#8a1c1c' }), head); band.position.y = hy - 0.005; }
  // glasses
  if (av.glasses) { const fr = new THREE.MeshStandardMaterial({ color: av.glasses === 1 ? '#c9a227' : '#1b1b1b', metalness: av.glasses === 1 ? 1 : 0, roughness: 0.3 }), lens = new THREE.MeshPhysicalMaterial({ color: av.glasses === 2 ? '#dfefff' : '#101418', transparent: true, opacity: av.glasses === 2 ? 0.25 : 0.85, roughness: 0.05, clearcoat: 1 });
    for (const s of [-1, 1]) { const ep = surf(s * 0.036, 0.012); const r = av.glasses === 2 ? 0.019 : 0.022; const rim = mesh(new THREE.TorusGeometry(r, 0.0025, 6, seg(20)), fr, head); rim.position.set(ep.x, ep.y, ep.z + 0.012); if (av.glasses !== 2) rim.scale.y = 0.8; const l = mesh(new THREE.CircleGeometry(r, seg(20)), lens, head); l.position.copy(rim.position); l.scale.copy(rim.scale);
      const arm = mesh(new THREE.BoxGeometry(0.003, 0.003, 0.1), fr, head); arm.position.set(s * 0.078, ep.y, ep.z - 0.04); } const br = mesh(new THREE.BoxGeometry(0.02, 0.003, 0.003), fr, head); const bp = surf(0, 0.02); br.position.set(0, bp.y, bp.z + 0.008); }
  // ---- arms (shoulder -> elbow -> wrist -> hand), sleeves with hems ----
  const sx = chest * 0.95 + 0.035, arms = [], legs = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * sx, shY - 0.02, 0); body.add(sh);
    const delt = mesh(new THREE.SphereGeometry(0.058 * bw, seg(14), seg(10)), jacket ? jacketMat : shirtMat, sh); delt.scale.set(0.95, 0.75, 0.95); delt.position.y = -0.005;
    const up = mesh(lathe([[0.05 * bw, 0], [0.047 * bw, -0.12], [0.04 * bw, -0.27]], seg(14)), skin, sh);
    const longS = jacket; const slv = mesh(lathe([[0.04 * bw, 0.04], [0.058 * bw, 0.0], [0.06 * bw, -0.08], [0.058 * bw, longS ? -0.27 : -0.15], [0.05 * bw, longS ? -0.27 : -0.15]], seg(16)), jacket ? jacketMat : shirtMat, sh); slv.material.side = THREE.DoubleSide;
    const el = new THREE.Group(); el.position.y = -0.27; sh.add(el);
    
    mesh(lathe([[0.036 * bw, 0.035], [0.04 * bw, 0], [0.038 * bw, -0.1], [0.028, -0.24]], seg(14)), longS ? jacketMat : skin, el);
    if (longS) { const cuff = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.03, seg(14)), new THREE.MeshStandardMaterial({ color: '#274b78', roughness: 0.8 }), el); cuff.position.y = -0.22; }
    const wr = new THREE.Group(); wr.position.y = -0.245; wr.scale.setScalar(1.3); el.add(wr);
    // hand: palm + 4 fingers (2 segments) + thumb
    const palm = mesh(new THREE.BoxGeometry(0.07, 0.08, 0.028, 2, 2, 1), skin, wr); palm.position.y = -0.04; palm.scale.setScalar(1.12); { const pp = palm.geometry.attributes.position; for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); pp.setX(i, pp.getX(i) * (1 - 0.15 * (y + 0.04) / 0.08)); pp.setZ(i, pp.getZ(i) * (1 - 0.3 * Math.abs(pp.getX(i)) / 0.035)); } palm.geometry.computeVertexNormals(); }
    palm.rotation.y = s * Math.PI / 2;
    for (let f = 0; f < 4; f++) { const fl = [0.042, 0.05, 0.047, 0.036][f], fx = (f - 1.5) * 0.017; const fg = new THREE.Group(); fg.position.set(0, -0.08, 0); fg.rotation.y = s * Math.PI / 2; wr.add(fg);
      const k = mesh(new THREE.CapsuleGeometry(0.0075, fl * 0.5, 3, 6), skin, fg); k.position.set(fx, -fl * 0.3, 0); const k2 = mesh(new THREE.CapsuleGeometry(0.007, fl * 0.4, 3, 6), skin, fg); k2.position.set(fx, -fl * 0.72, 0.006); k2.rotation.x = 0.35; }
    const th = mesh(new THREE.CapsuleGeometry(0.009, 0.035, 3, 6), skin, wr); th.position.set(0, -0.035, 0.03 * 1); th.rotation.set(0.6, 0, 0); 
    arms.push({ sh, el, wr, s });
    // legs
    const hp = new THREE.Group(); hp.position.set(s * hip * 0.5, hipY - 0.02, 0); body.add(hp);
    mesh(lathe([[0.07 * bw, 0.13], [0.092 * bw, 0.08], [0.09 * bw, -0.05], [0.072 * bw, -0.25], [0.06 * bw, -0.42]], seg(16)), pantsMat, hp);
    const kn = new THREE.Group(); kn.position.y = -0.42; hp.add(kn);
    mesh(lathe([[0.057 * bw, 0.04], [0.06 * bw, 0], [0.058 * bw, -0.12], [0.052 * bw, -0.3], [0.055 * bw, -0.4], [0.054 * bw, -0.43]], seg(16)), pantsMat, kn);
    const hem = mesh(new THREE.TorusGeometry(0.052 * bw, 0.004, 4, seg(16)), pantsMat, kn); hem.rotation.x = Math.PI / 2; hem.position.y = -0.425;
    const an = new THREE.Group(); an.position.y = -0.44; kn.add(an);
    const shoe = mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, seg(12)), shoeMat, an); shoe.rotation.x = Math.PI / 2; shoe.scale.set(1.0, 1, 0.75); shoe.position.set(0, -0.035, 0.045);
    const so = mesh(new THREE.BoxGeometry(0.1, 0.022, 0.26, 2, 1, 4), sole, an); so.position.set(0, -0.07, 0.045); { const sp = so.geometry.attributes.position; for (let i = 0; i < sp.count; i++) { const z = sp.getZ(i); sp.setX(i, sp.getX(i) * (1 - 0.35 * Math.max(0, Math.abs(z) / 0.13 - 0.5))); } }
    const lace = mesh(new THREE.BoxGeometry(0.045, 0.004, 0.08), sole, an); lace.position.set(0, 0.012, 0.075); lace.rotation.x = -0.35;
    legs.push({ hp, kn, an, s });
  }
  root.scale.setScalar([0.93, 1, 1.08][av.height] * (av.age === 0 ? 0.97 : 1)); root.userData.tris = TRI;
  // pose: t (s), mode 'idle' | 'walk'
  root.userData.pose = (t, mode = 'idle') => {
    const w = mode === 'walk', ph = t * 6.5;
    for (const L of legs) { const a = w ? Math.sin(ph + (L.s > 0 ? 0 : Math.PI)) * 0.45 : 0.04 * L.s; L.hp.rotation.x = -a; L.kn.rotation.x = w ? Math.max(0, Math.sin(ph + (L.s > 0 ? 0.6 : Math.PI + 0.6))) * 0.75 : 0.03; L.an.rotation.x = w ? -0.1 : 0; L.hp.rotation.z = w ? 0 : L.s * 0.035; }
    for (const A of arms) { const a = w ? Math.sin(ph + (A.s > 0 ? Math.PI : 0)) * 0.4 : 0; A.sh.rotation.set(-a, 0, A.s * (w ? 0.09 : 0.12)); A.el.rotation.x = w ? -0.35 - 0.2 * Math.max(0, -Math.sin(ph + (A.s > 0 ? Math.PI : 0))) : -0.18; A.wr.rotation.set(0, 0, 0); }
    torso.rotation.y = w ? Math.sin(ph) * 0.06 : 0; head.rotation.y = w ? -Math.sin(ph) * 0.04 : 0.08; body.position.y = w ? Math.abs(Math.cos(ph)) * 0.025 - 0.012 : 0;
  };
  root.userData.pose(0, 'idle');
  return root;
}
export { foldNormal, strandNormal, shirtMap, canvasTex, PAL, g2 };
