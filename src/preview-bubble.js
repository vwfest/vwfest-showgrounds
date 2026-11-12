// Offline preview of the photoreal Bubble test car (model 0) in the Show Grounds world.
// Query: rarity=common|rare|epic, quality=high|low|med|ultra|auto, angle=front|rear
import { THREE } from './batch.js';
import { buildWorld, buildSky } from './world.js';
import { carFor, rideSpec, hydraulics, PLATE_UNI } from './cars.js';
import { loadHD, hdReady } from './hdcars.js';
import { Gfx, detectTier } from './gfx.js';
import SPECS from '../shared/bubble-specs.js';

const params = new URLSearchParams(location.search);
const rarity = ['common', 'rare', 'epic'].includes(params.get('rarity')) ? params.get('rarity') : 'epic';
const qualityWanted = params.get('quality') || 'high';
const angle = params.get('angle') || (rarity === 'epic' ? 'rear' : 'front');
const phase = +(params.get('p') || 0.22);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
const world = buildWorld(scene);
const sky = buildSky(scene, renderer);
sky.update(phase);

const gfx = new Gfx({ renderer, scene, camera: cam, world, sky, base: './', isTouch: /phone|low/.test(qualityWanted) || matchMedia('(pointer: coarse)').matches });
const det = detectTier(renderer, gfx.isTouch);

const raw = SPECS.SPECS[rarity];
const spec = rideSpec(raw);
const name = SPECS.BUBBLE;
const label = document.getElementById('tag');
if (label) label.textContent = `${name}  ·  ${rarity.toUpperCase()}`;

window.__meta = { name, rarity, qualityWanted, detected: det.tier, gpu: det.gpu, spec: raw };
window.__ready = false;
window.__stats = null;

let car = null, t = 0, frames = 0, acc = 0, last = performance.now();
const times = [];

function placeCam() {
  if (angle === 'rear') { cam.position.set(3.15, 0.82, -4.35); cam.lookAt(0, 0.42, -1.35); }
  else if (angle === 'plate') { cam.position.set(0.55, 0.72, -3.55); cam.lookAt(0, 0.58, -2.05); }
  else { cam.position.set(4.15, 1.22, 3.55); cam.lookAt(0, 0.55, 0); }
}

function frame() {
  const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
  PLATE_UNI.uTime.value = t;
  if (world.anim) for (const f of world.anim) f(t);
  if (world.updateShowroom) world.updateShowroom(t, 0, 0);
  if (car && car.userData.hydro) hydraulics(car, t, 'three', true);
  const w = innerWidth, h = innerHeight; if (gfx.w !== w || gfx.h !== h) { gfx.resize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }
  gfx.update(phase, { x: 0, z: 0, dist: 5 }, dt);
  gfx.render(dt);
  frames++; acc += dt; times.push(dt);
  if (times.length > 60) times.shift();
  if (!window.__ready && car && car.userData.hd && frames > 8) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const tris = car.userData.tris || [0, 0];
    window.__stats = { fps: +(1 / avg).toFixed(1), frameMs: +(avg * 1000).toFixed(2), trisNear: tris[0], trisFar: tris[1], quality: gfx.tier, gpu: det.gpu, rarity, name, hd: !!car.userData.hd };
    window.__ready = true;
  }
  requestAnimationFrame(frame);
}

(async () => {
  const q = qualityWanted === 'auto' ? det.tier : qualityWanted;
  await gfx.setTier(q, qualityWanted === 'auto');
  await new Promise((res) => loadHD(0, res));
  if (!hdReady(0)) console.warn('HD bake did not load; showing low-poly placeholder');
  car = carFor(spec);
  car.position.set(0, 0, 0);
  car.rotation.y = angle === 'front' ? 0.52 : 0;
  scene.add(car);
  window.__car = car;
  placeCam();
  last = performance.now();
  frame();
})().catch((e) => { console.error(e); document.body.dataset.err = e.message; });
