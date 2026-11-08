// Headless studio for ride beauty shots. Uses the same HD assemble path as the game
// (quantized bins + the vehicle materials in src/cars.js). Not part of the client bundle.
import { THREE } from '../../src/batch.js';
import { carFor } from '../../src/cars.js';
import { loadHD, hdReady } from '../../src/hdcars.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

window.SG_ASSETS = '/docs/';
const SPECS = [
  { name: 'ghia', model: 2, paint: 'flake', c1: '#2a9d8f', c2: null, wheels: 2, stance: 2, extras: 388, plate: 1 },
  { name: 'camper', model: 1, paint: 'two', c1: '#e76f22', c2: '#f4f1ea', wheels: 0, stance: 1, extras: 131, plate: 1 },
  { name: 'bug', model: 0, paint: 'solid', c1: '#e63946', c2: null, wheels: 1, stance: 0, extras: 1, plate: 0 },
  { name: 'baja', model: 5, paint: 'solid', c1: '#ffd166', c2: null, wheels: 3, stance: 3, extras: 32, plate: 0 },
  { name: 'safari', model: 3, paint: 'patina', c1: '#6b8f7a', c2: null, wheels: 1, stance: 0, extras: 1, plate: 0 },
  { name: 'wagon', model: 4, paint: 'metallic', c1: '#118ab2', c2: null, wheels: 3, stance: 1, extras: 132, plate: 1 },
];
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0xb7d4f0, 1);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb7d4f0, 18, 40);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 80);
const hemi = new THREE.HemisphereLight(0x9fc6ff, 0x5d7a3a, 0.32);
const sun = new THREE.DirectionalLight(0xfff4d6, 1.15);
sun.position.set(-6, 9, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 30;
sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(hemi, sun, sun.target);
const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshStandardMaterial({ color: '#8d987c', roughness: 0.96, metalness: 0 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const cars = new Map();
function sizeTo(w, h, dpr) {
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
function frame(car, mode) {
  const box = new THREE.Box3().setFromObject(car);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  sun.target.position.copy(c); sun.target.updateMatrixWorld();
  if (mode === 'wheel') {
    camera.position.set(c.x + s.x * 0.55, c.y * 0.35 + 0.15, c.z + s.z * 0.42);
    camera.lookAt(c.x + s.x * 0.28, 0.32, c.z + s.z * 0.22);
    return;
  }
  const dist = Math.max(s.x, s.y, s.z) * (mode === 'phone' ? 1.55 : 1.45);
  camera.position.set(c.x + dist * 0.72, c.y + s.y * 0.15, c.z + dist * 0.95);
  camera.lookAt(c.x, c.y * 0.92, c.z - s.z * 0.02);
}
window.__show = (name, mode) => {
  for (const c of cars.values()) c.visible = false;
  const car = cars.get(name); car.visible = true;
  const phone = mode === 'phone';
  sizeTo(phone ? 390 : 960, phone ? 844 : 640, phone ? 2 : 1);
  frame(car, mode || 'beauty');
  renderer.render(scene, camera);
  return car.userData.tris || null;
};
window.__readyStudio = false;
(async () => {
  for (let m = 0; m < 6; m++) loadHD(m);
  await new Promise((res) => { const t = setInterval(() => { if ([0, 1, 2, 3, 4, 5].every((m) => hdReady(m))) { clearInterval(t); res(); } }, 40); });
  const pm = new THREE.PMREMGenerator(renderer);
  const hdr = await new RGBELoader().loadAsync('/docs/assets/kloppenheim_06_puresky_1k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pm.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 1.0;
  hdr.dispose(); pm.dispose();
  for (const spec of SPECS) { const c = carFor(spec); c.visible = false; scene.add(c); cars.set(spec.name, c); }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__stats = {};
  for (const spec of SPECS) window.__stats[spec.name] = cars.get(spec.name).userData.tris;
  window.__readyStudio = true;
  document.title = 'studio-ready';
})().catch((e) => { document.title = 'studio-fail ' + e.message; console.error(e); });
