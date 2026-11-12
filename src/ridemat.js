// Vehicle-only finishes for the HD rides (and the low-poly placeholder).
// One shared material per role so a car stays a handful of draw calls.
// Vertex colours already distinguish chrome / gold / anodized, tyre / leather / canvas / whitewall,
// and headlamp / tail / amber. These shaders only decide how each of those reads under the
// daytime sky. Nothing here is copied from an external model or shader pack.
import { THREE } from './batch.js';

const cache = new Map();
function vary(sh) {
  if (sh.vertexShader.includes('vRideP')) return;
  sh.vertexShader = 'varying vec3 vRideP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRideP = position;');
  sh.fragmentShader = 'varying vec3 vRideP;\n' + sh.fragmentShader;
}
// Micro orange-peel on the base normal only. The clearcoat normal stays smooth, which is what
// a real automotive coat does: sharp horizon reflection, slightly broken base.
function peel(amount) {
  return `{ float h = fract(sin(dot(floor(vRideP * 90.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 wob = vec3(fract(h * 17.13), fract(h * 47.77), fract(h * 91.17)) - 0.5;
    normal = normalize(normal + wob * ${amount.toFixed(3)});
    roughnessFactor = clamp(roughnessFactor + (h - 0.5) * 0.045, 0.04, 1.0); }`;
}
function flake(strength) {
  if (!strength) return '';
  return `{ float h = fract(sin(dot(floor(vRideP * 220.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vec3 fn = normalize(normal + (vec3(fract(h * 13.1), fract(h * 71.7), fract(h * 157.3)) - 0.5) * 0.85);
    float sp = pow(max(0.0, dot(reflect(-normalize(vViewPosition), fn), normalize(vec3(0.32, 0.86, 0.38)))), 48.0);
    gl_FragColor.rgb += sp * step(0.84, h) * ${strength.toFixed(3)} * vec3(1.0, 0.97, 0.9); }`;
}
// Merged metal: bright neutral = polished chrome, warm = gold wire, dark = anodized / drum.
const METAL_SPLIT = `{ float l = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
  float warm = vColor.r - vColor.b;
  float rough = mix(0.5, 0.065, smoothstep(0.2, 0.72, l));
  if (warm > 0.35 && l > 0.35) rough = 0.22;
  if (l < 0.12) rough = 0.5;
  roughnessFactor = rough;
  metalnessFactor = mix(0.5, 1.0, smoothstep(0.04, 0.35, l)); }`;
// Merged matte: rubber stays dead, leather and wood satin, canvas cloth, whitewall clean, painted steel a little metallic.
const MATTE_SPLIT = `{ float l = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
  float warm = vColor.r - vColor.b;
  float sat = max(vColor.r, max(vColor.g, vColor.b)) - min(vColor.r, min(vColor.g, vColor.b));
  roughnessFactor = 0.92; metalnessFactor = 0.0;
  if (l > 0.85 && sat < 0.05) { roughnessFactor = 0.4; }
  else if (l > 0.45 && sat < 0.16 && warm < 0.18) { roughnessFactor = 0.4; metalnessFactor = 0.28; }
  else if (l > 0.4 && l < 0.68 && warm > 0.15 && sat > 0.15 && sat < 0.4) { roughnessFactor = 0.93; }
  else if (warm > 0.25 && sat > 0.3 && l > 0.15) { roughnessFactor = 0.66; }
  else if (warm > 0.04 && l > 0.03 && l < 0.2 && sat < 0.25) { roughnessFactor = 0.55; } }`;
// Tyre tread: circumferential grooves + block sipes on dark rubber only (whitewalls and trim stay smooth).
const TIRE_TREAD = `{ float l = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
  float sat = max(vColor.r, max(vColor.g, vColor.b)) - min(vColor.r, min(vColor.g, vColor.b));
  if (l < 0.22 && sat < 0.14) {
    float r = length(vRideP.yz);
    float a = atan(vRideP.y, vRideP.z);
    float circ = abs(fract(r * 52.0) - 0.5);
    float groove = 1.0 - smoothstep(0.10, 0.22, circ);
    float block = smoothstep(0.12, 0.38, abs(sin(a * 18.0 + r * 4.0)));
    float tread = groove * block;
    roughnessFactor = mix(roughnessFactor, 0.98, tread);
    normal = normalize(normal + vec3((fract(sin(a * 40.0 + r * 9.0) * 43758.5453) - 0.5) * 0.4 * tread, 0.0, 0.0));
  } }`;
// Glass: dark contact-shadow ellipses stay flat; real panes get a fresnel edge so the cabin reads.
const GLASS_FRESNEL = `{ float mx = max(vColor.r, max(vColor.g, vColor.b));
  if (mx < 0.004) gl_FragColor.a = 0.5;
  else { float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
    float f = pow(1.0 - clamp(ndv, 0.0, 1.0), 1.65);
    gl_FragColor.a = mix(0.16, 0.74, f);
    gl_FragColor.rgb += f * vec3(0.55, 0.64, 0.72) * 0.4; } }`;

function compile(mat, { peelAmt = 0, flakeAmt = 0, metal = false, matte = false, glass = false, lamp = false, key }) {
  mat.onBeforeCompile = (sh) => {
    vary(sh);
    if (peelAmt) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + peel(peelAmt));
    if (metal || matte) sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + (metal ? METAL_SPLIT : MATTE_SPLIT + TIRE_TREAD));
    if (lamp) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor;');
    const tail = (glass ? GLASS_FRESNEL : '') + flake(flakeAmt);
    if (tail) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + tail);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

export const FINISH = {
  solid: { roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.72, specularIntensity: 0.65, ior: 1.5, peel: 0.1, flake: 0 },
  metallic: { roughness: 0.3, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 0.88, specularIntensity: 0.7, ior: 1.5, peel: 0.1, flake: 0.35 },
  flake: { roughness: 0.24, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.028, envMapIntensity: 0.8, specularIntensity: 0.7, ior: 1.5, peel: 0.08, flake: 0.7 },
  candy: { roughness: 0.16, metalness: 0.32, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.75, specularIntensity: 0.8, ior: 1.5, iridescence: 0.32, iridescenceIOR: 1.4, peel: 0.06, flake: 0.22 },
  // Camper panels are large and flat. A full sky reflection greys the orange out, so the coat stays
  // satin: enough of a horizon streak to read as paint, not enough env to wash the colour.
  // Sharp coat, matte base: the horizon streak stays, the flat orange panels do not fill with sky.
  camper: { roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.7, specularIntensity: 0.45, ior: 1.5, peel: 0.12, flake: 0 },
  patina: { roughness: 0.9, metalness: 0, clearcoat: 0, clearcoatRoughness: 1, envMapIntensity: 0.22, specularIntensity: 0.15, ior: 1.45, peel: 0.05, flake: 0 },
};

function paintFor(kind) {
  let m = cache.get(kind); if (m) return m;
  const f = FINISH[kind];
  m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: f.roughness, metalness: f.metalness, clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness, envMapIntensity: f.envMapIntensity, specularIntensity: f.specularIntensity, ior: f.ior, iridescence: f.iridescence || 0, iridescenceIOR: f.iridescenceIOR || 1.3 });
  cache.set(kind, compile(m, { peelAmt: f.peel, flakeAmt: f.flake, key: 'ride-paint-' + kind }));
  return m;
}
function singleton(name, make) { let m = cache.get(name); if (!m) cache.set(name, m = make()); return m; }

export function hdMaterials(spec) {
  const camper = spec.model === 1 && (spec.paint === 'solid' || spec.paint === 'two');
  const kind = spec.paint === 'patina' ? 'patina' : camper ? 'camper' : spec.paint === 'two' ? 'metallic' : FINISH[spec.paint] ? spec.paint : 'solid';
  return {
    paint: paintFor(kind),
    metal: singleton('metal', () => compile(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.12, metalness: 1, envMapIntensity: 1.35 }), { metal: true, key: 'ride-metal' })),
    matte: singleton('matte', () => compile(new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.35 }), { matte: true, key: 'ride-matte' })),
    glass: singleton('glass', () => compile(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.34, ior: 1.52, specularIntensity: 0.7, clearcoat: 0.45, clearcoatRoughness: 0.02, envMapIntensity: 0.85, depthWrite: false }), { glass: true, key: 'ride-glass' })),
    lamp: singleton('lamp', () => compile(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.7, envMapIntensity: 1.05 }), { lamp: true, key: 'ride-lamp' })),
  };
}

// Gold-plated VWFEST plate with diamond lettering (plate = 2 / plateDiamond).
// Gold is a real metal (metalness 1, low roughness). Letters use a cheap sparkle +
// iridescence path (IOR 2.42) instead of transmission, so phones stay in budget.
export const GOLD_PLATE = { color: '#c9a227', metalness: 1, roughness: 0.12, envMapIntensity: 1.6, ior: 2.42 };
export function applyGoldDiamondPlate(mat, uTime) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.fragmentShader = 'uniform float uTime;\n' + sh.fragmentShader;
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float dia = sampledDiffuseColor.r; float cut = sampledDiffuseColor.g;
      vec3 gold = vec3(0.831, 0.686, 0.216); vec3 deep = vec3(0.40, 0.26, 0.07);
      diffuseColor.rgb = mix(gold, deep, cut);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      float diaM = 0.0;
      #ifdef USE_MAP
      diaM = texture2D(map, vMapUv).r;
      #endif
      metalnessFactor = mix(1.0, 0.04, diaM);
      roughnessFactor = mix(0.12, 0.025, diaM);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
      float diaA = 0.0;
      #ifdef USE_MAP
      diaA = texture2D(map, vMapUv).r;
      #endif
      if (diaA > 0.15) {
        float h = fract(sin(dot(vMapUv * 90.0, vec2(12.9898, 78.233))) * 43758.5453);
        float tw = pow(max(0.0, sin(uTime * (3.0 + h * 8.0) + h * 40.0)), 18.0);
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vMapUv.x * 1.4 + uTime * 0.35 + vec3(0.0, 0.33, 0.66)));
        float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.4);
        gl_FragColor.rgb += (tw * 1.7 + fres * 0.55) * mix(vec3(1.0), rainbow, 0.75) * diaA;
      }`);
  };
  mat.customProgramCacheKey = () => 'ride-plate-diamond-gold';
  return mat;
}
