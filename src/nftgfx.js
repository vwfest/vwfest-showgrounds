// In-world look of a verified NFT avatar: the NFT image as a chest badge + a gold frame floating ABOVE the name tag (so the tag never overlaps it).
// Textures come from the game server's image proxy (/api/nft-img/<asset>), so every image is size/type checked and CORS-clean.
import { THREE } from './batch.js';
const cache = new Map();
export function nftTexture(url) {
  let t = cache.get(url); if (t) return t;
  t = new THREE.TextureLoader().setCrossOrigin('anonymous').load(url, (tx) => { tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; tx.needsUpdate = true; }, undefined, () => { t.userData.failed = true; });
  if (cache.size > 80) { const k = cache.keys().next().value; const o = cache.get(k); o.dispose(); cache.delete(k); }
  cache.set(url, t); return t;
}
export const NFT_FRAME_Y = 3.62;   // frame centre (root space). Tag sits at 2.12 (two lines), speech bubble up to ~3.2.
export function attachNft(person, av, nf, server) {
  detachNft(person); if (!nf || !nf.a) return;
  const tex = nftTexture(`${server}/api/nft-img/${nf.a}`); const g = new THREE.Group(); g.name = 'nft';
  // gold frame + picture (picture is unlit so the artwork keeps its colours)
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.96, 0.07), new THREE.MeshStandardMaterial({ color: 0xffd166, metalness: 0.9, roughness: 0.28, emissive: 0x553300 }));
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.84), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); pic.position.z = 0.04; frame.add(pic);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.84), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); back.position.z = -0.04; back.rotation.y = Math.PI; frame.add(back);
  const holo = new THREE.Group(); holo.add(frame); holo.position.set(0, NFT_FRAME_Y, 0); g.add(holo);
  // chest badge, on the torso so it follows the body
  const bw = [0.88, 1, 1.14][av.body] || 1, zf = 0.125 * bw + 0.03; const badge = new THREE.Group(); badge.position.set(0, 1.17 - person.upper.position.y, zf);
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.31), new THREE.MeshBasicMaterial({ color: 0xffd166 })); badge.add(rim);
  const bp = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); bp.position.z = 0.003; badge.add(bp);
  person.upper.add(badge);
  person.root.add(g); person.nft = { g, holo, badge };
}
export function detachNft(person) {
  const n = person.nft; if (!n) return; person.root.remove(n.g); person.upper.remove(n.badge);
  n.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); n.badge.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); person.nft = null;
}
export function animateNft(person, t, seed, near) { const n = person.nft; if (!n) return; n.g.visible = near; if (near) n.holo.rotation.y = Math.sin(t * 0.7 + seed) * 0.3; }
