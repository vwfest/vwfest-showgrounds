// Geometry batching: accumulate colored primitives (vertex colors), merge into ONE BufferGeometry => one draw call per batch.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// Color management is ON: hex colors are authored as sRGB and converted to linear for lighting; canvas textures must be tagged SRGBColorSpace.
const U = { box: new THREE.BoxGeometry(1, 1, 1), cyl: {}, sph: {}, cone: {}, rb: {}, tor: {} };
const v3 = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), m = new THREE.Matrix4(), s3 = new THREE.Vector3(), c = new THREE.Color();
const cyl = (seg) => U.cyl[seg] || (U.cyl[seg] = new THREE.CylinderGeometry(1, 1, 1, seg));
const sph = (seg) => U.sph[seg] || (U.sph[seg] = new THREE.SphereGeometry(1, seg, Math.max(4, seg >> 1)));
const cone = (seg) => U.cone[seg] || (U.cone[seg] = new THREE.ConeGeometry(1, 1, seg));
export class Batch {
  constructor() { this.parts = []; this.ox = 0; this.oy = 0; this.oz = 0; this.twin = null; }
  raw(geo, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    x = (x || 0) + this.ox; y = (y || 0) + this.oy; z = (z || 0) + this.oz; if (this.twin) this.twin._raw(geo, color, x, y, z, rx, ry, rz, sx, sy, sz); return this._raw(geo, color, x, y, z, rx, ry, rz, sx, sy, sz);
  }
  _raw(geo, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); q.setFromEuler(e); m.compose(v3.set(x || 0, y || 0, z || 0), q, s3.set(sx, sy, sz)); g.applyMatrix4(m); if (!this.keepUv) g.deleteAttribute('uv');
    const n = g.attributes.position.count, col = new Float32Array(n * 3); c.set(color); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); this.parts.push(g); return this;
  }
  // Alpha-card (hair strands): bent plane that keeps UVs (use a Batch with keepUv = true and a map + alphaTest material).
  card(w, h, color, x, y, z, rx, ry, rz, bend = 0.25) { const k = 'card' + w.toFixed(3) + h.toFixed(3) + bend; const g = U.rb[k] || (U.rb[k] = (() => { const p = new THREE.PlaneGeometry(w, h, 2, 4); const pa = p.attributes.position; for (let i = 0; i < pa.count; i++) { const X = pa.getX(i) / (w / 2), Y = pa.getY(i) / (h / 2); pa.setZ(i, -X * X * bend * w * 0.5 + (1 - Y) * 0.0); } p.computeVertexNormals(); return p; })()); return this.raw(g, color, x, y, z, rx, ry, rz, 1, 1, 1); }
  box(w, h, d, color, x, y, z, ry, rx, rz) { return this.raw(U.box, color, x, y, z, rx, ry, rz, w, h, d); }
  // Beveled box (rounded edges, smooth normals): body panels, limbs, seats. Geometry is cached per size.
  rbox(w, h, d, color, x, y, z, ry, rx, rz, r = 0.04, seg = 3) { const rr = Math.min(r, Math.min(w, h, d) * 0.48), k = [w, h, d, rr, seg].map((v) => v.toFixed(3)).join(); const g = U.rb[k] || (U.rb[k] = new RoundedBoxGeometry(w, h, d, seg, rr)); return this.raw(g, color, x, y, z, rx, ry, rz, 1, 1, 1); }
  // Torus (tires, steering wheels): radius, tube radius; axis = local Z by default.
  tor(r, tube, color, x, y, z, rx, ry, rz, seg = 20, tseg = 8) { const k = r.toFixed(3) + ',' + tube.toFixed(3) + ',' + seg; const g = U.tor[k] || (U.tor[k] = new THREE.TorusGeometry(r, tube, tseg, seg)); return this.raw(g, color, x, y, z, rx, ry, rz, 1, 1, 1); }
  cyl(rt, h, color, x, y, z, rx, ry, rz, seg = 10, rz2) { return this.raw(cyl(seg), color, x, y, z, rx, ry, rz, rt, h, rz2 === undefined ? rt : rz2); }
  sph(sx, sy, sz, color, x, y, z, seg = 10) { return this.raw(sph(seg), color, x, y, z, 0, 0, 0, sx, sy, sz); }
  cone(r, h, color, x, y, z, rx, ry, rz, seg = 6) { return this.raw(cone(seg), color, x, y, z, rx, ry, rz, r, h, r); }
  // Tapered vertical block (bottom width/depth -> top width/depth) for sloped panels.
  build() { if (!this.parts.length) return null; const g = mergeGeometries(this.parts, false); this.parts.forEach((p) => p.dispose()); this.parts = []; g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
}
const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
export const MAT = {
  lambert: std({ roughness: 0.88, metalness: 0 }),               // world: matte, with image-based lighting
  phong: std({ roughness: 0.38, metalness: 0.45 }),              // metallic / flake paint base
  glossy: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04 }),
  paint: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035, ior: 1.5, specularIntensity: 0.6, envMapIntensity: 0.85 }), // r2: dielectric base under a glassy coat (no grey metal sheen)
  paintMetal: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.1 }),
  paintFlake: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') }),
  paintCandy: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.25, iridescenceIOR: 1.4 }),
  chrome: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 1, envMapIntensity: 1.6 }), // r5: brighter trim highlights
  glass: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.38, ior: 1.52, specularIntensity: 0.45, clearcoat: 0.3, clearcoatRoughness: 0, envMapIntensity: 0.6, depthWrite: false }), // r4: clearer glass so seats + dash read through it (reflection kept, less milky)
  tire: new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0x8a8a8a, roughness: 0.78, metalness: 0, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color('#5a5a5a'), envMapIntensity: 0.5 }), // r2: rubber: darker, soft satin sidewall
  lamp: std({ roughness: 0.2, metalness: 0, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.4 }),
  basic: new THREE.MeshBasicMaterial({ vertexColors: true }),
  neon: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false, color: new THREE.Color(2.2, 2.2, 2.2) }), // >1 = HDR, feeds the bloom
};
export const cTex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; };
export const hex = (n) => '#' + n;
export const shade = (col, f) => { c.set(col); c.multiplyScalar(f); return '#' + c.getHexString(); };
export const mix = (a, b, t) => { const x = new THREE.Color(a), y = new THREE.Color(b); x.lerp(y, t); return '#' + x.getHexString(); };
export { THREE };
