// Fur-shell hair: N offset copies of the scalp/jaw region with a per-pixel strand cutout. Gives dense, soft volume
// for beards and as a base under hair strips. 100% procedural.
import * as THREE from 'three';
export function shellMesh(hf, mask, { layers = 4, depth = 0.006, seg = [40, 30], freq = 1400, stretch = 0.35, color, lean = null }) {
  const g = new THREE.SphereGeometry(1, seg[0], seg[1]); const p = g.attributes.position, n = p.count;
  const U = [], M = new Float32Array(n); for (let i = 0; i < n; i++) { const u = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)); U.push(u); M[i] = mask(u); const q = hf(u.x, u.y, u.z); p.setXYZ(i, q.x, q.y, q.z); }
  g.computeVertexNormals(); const N = g.attributes.normal, I = g.index.array;
  const keep = []; for (let t = 0; t < I.length; t += 3) if (Math.max(M[I[t]], M[I[t + 1]], M[I[t + 2]]) > 0.02) keep.push(I[t], I[t + 1], I[t + 2]);
  const pos = [], nor = [], lay = [], msk = [], obj = [], idx = [];
  for (let L = 0; L < layers; L++) { const f = (L + 1) / layers, base = pos.length / 3;
    for (let i = 0; i < n; i++) { const o = depth * f * (0.35 + 0.65 * M[i]); let x = p.getX(i) + N.getX(i) * o, y = p.getY(i) + N.getY(i) * o, z = p.getZ(i) + N.getZ(i) * o;
      if (lean) { const d = lean(U[i]); x += d.x * o * f; y += d.y * o * f; z += d.z * o * f; }
      pos.push(x, y, z); nor.push(N.getX(i), N.getY(i), N.getZ(i)); lay.push(f); msk.push(M[i]); obj.push(p.getX(i), p.getY(i), p.getZ(i)); }
    for (const k of keep) idx.push(base + k); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('layer', new THREE.Float32BufferAttribute(lay, 1)); geo.setAttribute('msk', new THREE.Float32BufferAttribute(msk, 1)); geo.setAttribute('base', new THREE.Float32BufferAttribute(obj, 3)); geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.FrontSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float layer; attribute float msk; attribute vec3 base; varying float vL; varying float vM; varying vec3 vB;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vL = layer; vM = msk; vB = base;');
    sh.fragmentShader = 'varying float vL; varying float vM; varying vec3 vB;\nfloat hh(vec3 p){ p = fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }\n' + sh.fragmentShader
      .replace('#include <alphatest_fragment>', `{ vec3 q = vB * vec3(${freq.toFixed(1)}, ${(freq * stretch).toFixed(1)}, ${freq.toFixed(1)}); float r = hh(floor(q)); vec2 c = fract(q.xz) - 0.5; float rad = 0.5 * (1.0 - vL * 0.7);
        float on = step(length(c), rad) * step(vL * 0.75 + (1.0 - vM) * 0.95, r * 1.0 + 0.04); float edge = hh(floor(vB * 2200.0)); if (vM < 0.35 + 0.5 * edge) discard; if (vL > 0.2 && on < 0.5) discard; }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(0.7, 1.08, vL) * (0.85 + 0.3 * hh(floor(vB * 900.0)));');
  };
  mat.customProgramCacheKey = () => 'shell' + freq + stretch;
  geo.userData = {}; const m = new THREE.Mesh(geo, mat); m.castShadow = false; m.receiveShadow = true; return m;
}
