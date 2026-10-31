// Instanced grass blades with GPU wind. Blades live on a deterministic jittered grid (so they never "swim" while you walk) and are re-laid around the player.
// A footprint mask (built from the real scene geometry) keeps blades out of roads, plazas, booths, stage and cars.
import * as THREE from 'three';
const hash = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function bladeGeometry() { // 4 rows tapering to a tip; y is 0..1 (also used for the colour gradient + wind)
  const rows = [[0, 1], [0.35, 0.82], [0.7, 0.52], [1, 0]], pos = [], idx = [];
  rows.forEach(([y, w], r) => { if (w > 0) { pos.push(-0.5 * w, y, 0, 0.5 * w, y, 0); } else pos.push(0, y, 0); });
  idx.push(0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

export function makeGrassMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const uTime = { value: 0 };
  mat.userData.uTime = uTime;
  mat.userData.chain = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vGrass;\nfloat gh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(mix(normal, vec3(0.,0.,1.), 0.0) + vec3(0.,0.9,0.));')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hh = position.y; vec3 ip = vec3(instanceMatrix[3].x, 0., instanceMatrix[3].z);
        float w1 = sin(uTime*1.7 + ip.x*0.31 + ip.z*0.23), w2 = sin(uTime*3.1 + ip.x*0.9 - ip.z*0.6);
        transformed.x += (w1*0.32 + w2*0.08 + 0.12) * hh*hh; transformed.z += (w1*0.12 + w2*0.1) * hh*hh;
        float tint = gh(ip.xz*0.37); vec3 baseC = mix(vec3(0.020,0.075,0.015), vec3(0.045,0.11,0.02), tint); vec3 tipC = mix(vec3(0.16,0.30,0.05), vec3(0.28,0.36,0.07), gh(ip.xz*1.7));
        vGrass = mix(baseC, tipC, hh);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGrass;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGrass * 1.0;');
  };
  mat.onBeforeCompile = mat.userData.chain; mat.customProgramCacheKey = () => 'grass-v1';
  return mat;
}

export class Grass {
  constructor(scene, mask, half) { this.scene = scene; this.mask = mask; this.half = half; this.mesh = null; this.mat = makeGrassMaterial(); this.geo = bladeGeometry(); this.cx = 1e9; this.cz = 1e9; this.R = 0; this.N = 0; this.step = 4; }
  setCount(n) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
    this.N = n; this.cx = this.cz = 1e9; if (!n) return;
    this.R = n >= 60000 ? 28 : n >= 20000 ? 22 : 14; this.cell = 1 / Math.sqrt(n / (Math.PI * this.R * this.R) * 1.0);
    const m = new THREE.InstancedMesh(this.geo, this.mat, n); m.frustumCulled = false; m.receiveShadow = true; m.castShadow = false; m.count = 0; m.matrixAutoUpdate = false; m.renderOrder = 1; this.mesh = m; this.scene.add(m);
  }
  update(x, z, force) {
    if (!this.mesh) return; if (!force && (x - this.cx) ** 2 + (z - this.cz) ** 2 < this.step * this.step) return; this.cx = x; this.cz = z;
    const { R, cell, mask, half } = this, arr = this.mesh.instanceMatrix.array, N = this.N, lim = half - 1; let n = 0;
    const i0 = Math.floor((x - R) / cell), i1 = Math.ceil((x + R) / cell), j0 = Math.floor((z - R) / cell), j1 = Math.ceil((z + R) / cell), R2 = R * R;
    for (let j = j0; j <= j1 && n < N; j++) for (let i = i0; i <= i1; i++) {
      const px = (i + hash(i, j)) * cell, pz = (j + hash(j + 7919, i - 104729)) * cell, dx = px - x, dz = pz - z, d2 = dx * dx + dz * dz; if (d2 > R2 || Math.abs(px) > lim || Math.abs(pz) > lim) continue;
      if (mask(px, pz)) continue; const h3 = hash(i * 3 + 1, j * 7 + 5), h4 = hash(i * 5 + 2, j * 11 + 3);
      const fade = 1 - Math.max(0, (Math.sqrt(d2) / R - 0.62) / 0.38); const sy = (0.16 + h3 * 0.2) * fade, sx = 0.032 + h4 * 0.02, a = h4 * 6.2832 + h3 * 3, c = Math.cos(a), s = Math.sin(a), o = n * 16; if (sy < 0.02 || n >= N) continue;
      arr[o] = c * sx; arr[o + 1] = 0; arr[o + 2] = -s * sx; arr[o + 3] = 0; arr[o + 4] = 0; arr[o + 5] = sy; arr[o + 6] = 0; arr[o + 7] = 0; arr[o + 8] = s * sx * 0.7; arr[o + 9] = 0; arr[o + 10] = c * sx * 0.7; arr[o + 11] = 0; arr[o + 12] = px; arr[o + 13] = 0; arr[o + 14] = pz; arr[o + 15] = 1; n++;
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
  tick(t) { this.mat.userData.uTime.value = t; }
}

// Grid mask of "no grass" cells rasterised from scene geometry (1 m cells).
export function buildMask(scene, half, skip) {
  const S = Math.ceil(half * 2 + 4), off = half + 2, g = new Uint8Array(S * S); const mark = (x0, z0, x1, z1) => { const a = Math.max(0, Math.floor(x0 + off - 0.35)), b = Math.min(S - 1, Math.floor(x1 + off + 0.35)), c = Math.max(0, Math.floor(z0 + off - 0.35)), d = Math.min(S - 1, Math.floor(z1 + off + 0.35)); for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) g[j * S + i] = 1; };
  scene.updateMatrixWorld(true); const box = new THREE.Box3(), v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || (skip && skip(o))) return; const geo = o.geometry; if (!geo || !geo.attributes.position) return; const pa = geo.attributes.position, ix = geo.index;
    if ((ix ? ix.count : pa.count) > 2400) { // large merged mesh: per triangle
      const n = ix ? ix.count : pa.count; for (let t = 0; t < n; t += 3) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9; for (let k = 0; k < 3; k++) { const vi = ix ? ix.getX(t + k) : t + k; v.fromBufferAttribute(pa, vi).applyMatrix4(o.matrixWorld); if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x; if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z; if (v.y < y0) y0 = v.y; } if (y0 < 0.7 ) mark(x0, z0, x1, z1); }
    } else { box.setFromObject(o); if (box.min.y < 0.7 && box.max.y > 0.05 && box.max.x - box.min.x < 90 && box.max.z - box.min.z < 90) mark(box.min.x, box.min.z, box.max.x, box.max.z); }
  });
  return (x, z) => { const i = Math.floor(x + off), j = Math.floor(z + off); return i < 0 || j < 0 || i >= S || j >= S || g[j * S + i] === 1; };
}
