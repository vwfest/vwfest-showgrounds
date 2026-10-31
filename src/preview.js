// Offline preview harness (no network): renders the world, a lineup of avatars and a lowrider for screenshots.
import { THREE } from './batch.js';
import { buildWorld, buildSky } from './world.js';
import { buildPerson } from './people.js';
import { carFor, rideSpec, hydraulics, PLATE_UNI } from './cars.js';
import { generate } from './gen.js';
import RIDES from '../shared/rides.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('c') }); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
const world = buildWorld(scene); const sky = buildSky(scene, renderer);
const params = new URLSearchParams(location.search); const view = params.get('v') || 'overview'; const phase = +(params.get('p') || 0.3);
sky.update(phase);
const people = [];
const vibes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
if (view === 'avatars') {
  vibes.forEach((v, i) => { const av = generate('demo-' + i, { sex: i % 3, skin: (i * 3) % 8, hairStyle: (i * 3) % 8, hair: (i * 5) % 12, eyes: i % 8, facial: i % 3 === 0 ? (i % 6) : 0, age: i % 4, body: i % 3, height: (i + 1) % 3, vibe: v, car: i % 4 }); const p = buildPerson(av, i === 3 ? { hat: 'gold_bucket', aura: 'peace_aura' } : i === 7 ? { back: 'vw_wings', glow: 'neon_underglow', face: 'neon_shades' } : i === 5 ? { hat: 'top_hat' } : {}); p.root.position.set((i - 4.5) * 1.1, 0, 0); p.root.rotation.y = 0.0; scene.add(p.root); people.push(p); });
}
if (view === 'lowrider') { const bytes = new Uint8Array(64).fill(83); bytes[0] = 254; bytes[1] = 255; const r = RIDES.roll(bytes); const c = carFor(rideSpec({ ...r, model: 0, c1: 6, c2: 1, wheels: 4, stance: 4, plate: 2, paint: 2, extras: 4 | 8 | 128 | 256 })); c.position.set(0, 0, 0); c.rotation.y = 0.7; scene.add(c); window.__car = c; }
let t = 0;
function frame() {
  t += 0.016; PLATE_UNI.uTime.value = t; for (const f of world.anim) f(t);
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  if (view === 'overview') { cam.position.set(30, 12, 78); cam.lookAt(0, 3, 20); }
  else if (view === 'stage') { cam.position.set(0, 7, -50); cam.lookAt(0, 8, -86); }
  else if (view === 'arcade') { cam.position.set(0, 4, 62); cam.lookAt(0, 3, 52); }
  else if (view === 'cars') { cam.position.set(-14, 3.2, 6); cam.lookAt(-24, 0.8, -12); }
  else if (view === 'showroom') { cam.position.set(42, 3.5, 34); cam.lookAt(42, 1.2, 22); }
  else if (view === 'avatars') { const cx = +(params.get('x') || 0); cam.position.set(cx, 1.7, +(params.get('d') || 6.4)); cam.lookAt(cx, 1.15, 0); people.forEach((p, i) => { p.aL.rotation.x = Math.sin(t * 2 + i) * 0.1; p.pose.rotation.y = 0; if (p.aura) p.aura.rotation.y = t; }); }
  else if (view === 'lowrider') { cam.position.set(+(params.get('cx') || 5.6), 1.3, +(params.get('cz') || -2.6)); cam.lookAt(0, 0.6, 0); hydraulics(window.__car, t, 'three', true); }
  renderer.render(scene, cam); requestAnimationFrame(frame);
}
world.updateShowroom(0, 0, 0); frame(); window.__ready = true;
