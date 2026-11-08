// HD avatar (v6, code-built skinned body) swapped in over the low-poly person once its pre-baked surface is loaded.
// The low-poly rig (aL/aR/lL/lR/upper/pose groups) stays the animation API: every frame its rotations drive the HD bones.
// Builds are queued one at a time so a crowd joining never stalls the frame; near (<=15k) and far (<3k) are built per person.
import { buildAvatar } from './hdav/avatar2.js';
import { loadAvatarBake } from './hdav/baked.js';
import { hdPoseTargets } from './hdav/pose.mjs';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
const protos = new Map(); // same traits -> clone the skinned prototypes instead of rebuilding
const queue = []; let busy = false; let enabled = true;
export function setHDPeople(on) { enabled = on; }
function pump() { if (busy || !queue.length) return; busy = true; const job = queue.shift(); job().catch((e) => console.warn('[hd] avatar stays low-poly:', e.message)).finally(() => { busy = false; setTimeout(pump, 30); }); }
// Fewer draw calls: rigid parts that hang off the same bone and share a material (eyes, lashes, buttons, studs...) become one mesh.
function mergeRigid(root) { const groups = new Map();
  root.traverse((o) => { if (!o.isMesh || o.isSkinnedMesh || o.children.length || Array.isArray(o.material) || o.material.transparent && o.material.blending === THREE.AdditiveBlending) return; const mt = o.material, k = o.parent.uuid + '|' + [mt.type, mt.color && mt.color.getHex(), mt.map && mt.map.uuid, mt.normalMap && mt.normalMap.uuid, mt.alphaMap && mt.alphaMap.uuid, mt.roughness, mt.metalness, mt.transparent, mt.opacity, mt.side, mt.vertexColors, mt.emissive && mt.emissive.getHex(), mt.clearcoat, mt.alphaTest, mt.onBeforeCompile && mt.onBeforeCompile.toString().length, mt.customProgramCacheKey && mt.customProgramCacheKey()].join(); /* same look = same draw call */ let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(o); });
  for (const list of groups.values()) { if (list.length < 2) continue; const par = list[0].parent; const geos = [];
    for (const m of list) { m.updateMatrix(); let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrix); for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a); geos.push(g); }
    const keys = Object.keys(geos[0].attributes); if (!geos.every((g) => Object.keys(g.attributes).length === keys.length && keys.every((k) => g.attributes[k]))) continue;
    const mg = mergeGeometries(geos, false); if (!mg) continue; const mm = new THREE.Mesh(mg, list[0].material); mm.castShadow = list[0].castShadow; mm.receiveShadow = list[0].receiveShadow; mm.renderOrder = list[0].renderOrder; for (const m of list) par.remove(m); par.add(mm); } }
function setR(b, r) { if (b && r) b.rotation.set(r.x, r.y, r.z); }
function drive(p, bones) { // low-poly pose groups -> HD bones (both rigs: +z forward, world-aligned bone frames)
  const t = hdPoseTargets(p.upper.rotation, p.aL.rotation, p.aR.rotation, p.lL.rotation, p.lR.rotation);
  setR(bones.upperArmR, t.armR.upper); setR(bones.foreArmR, t.armR.fore); setR(bones.handR, t.armR.hand);
  setR(bones.upperArmL, t.armL.upper); setR(bones.foreArmL, t.armL.fore); setR(bones.handL, t.armL.hand);
  bones.thighR.rotation.copy(p.lL.rotation); bones.thighL.rotation.copy(p.lR.rotation);
  bones.shinR.rotation.x = t.legR.shin; bones.shinL.rotation.x = t.legL.shin;
  bones.footR.rotation.x = t.legR.foot; bones.footL.rotation.x = t.legL.foot;
  setR(bones.spine, t.spine); setR(bones.chest, t.chest); setR(bones.neck, t.neck); setR(bones.head, t.head);
}
export function hdPerson(p, av, eq = {}) {
  if (!enabled || typeof window === 'undefined') return; const e2 = { ...eq }; delete e2.aura; delete e2.glow; if (e2.hat === 'halo') delete e2.hat; // aura/glow/halo stay on the shared low-poly extras (animated by main.js)
  const key = JSON.stringify([av, e2]);
  queue.push(async () => { let pr = protos.get(key);
    if (!pr) { await loadAvatarBake(av.sex, av.body); const n = await buildAvatar(av, { lod: 1, eq: e2 }); await new Promise((r) => setTimeout(r, 16)); const f = await buildAvatar(av, { lod: 2, eq: e2 }); mergeRigid(n); mergeRigid(f); pr = { n, f }; protos.set(key, pr); if (protos.size > 60) protos.delete(protos.keys().next().value); }
    const mk = (src, far) => { const c = skClone(src); c.userData = { tris: src.userData.tris, bones: {} }; let big = null; c.traverse((o) => { if (o.isBone) c.userData.bones[o.name] = o; if (o.isMesh) { o.castShadow = false; if (o.isSkinnedMesh && (!big || o.geometry.attributes.position.count > big.geometry.attributes.position.count)) big = o; } }); if (big) big.castShadow = true; return c; }; // shadow from the body only: small parts add draw calls per shadow cascade
    const near = mk(pr.n, false), far = mk(pr.f, true);
    for (const f of [near, far]) { f.scale.setScalar(1); const bones = f.userData.bones; let mesh = null; f.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
      if (mesh) mesh.onBeforeRender = () => drive(p, bones); }
    near.visible = !p.far; far.visible = !!p.far; for (const mm of p.nearMeshes) mm.visible = false; p.farMesh.visible = false; p.pose.add(near, far);
    p.hd = { near, far, tris: [near.userData.tris, far.userData.tris] }; });
  pump();
}
