// Avatar preview (own tiny WebGL scene), the profile quiz and the full avatar editor.
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THREE } from './batch.js';
import { h, clear } from './dom.js';
import { buildPerson } from './people.js';
import { carFor, avatarCarSpec } from './cars.js';
import { PAL, NAMES, FIELDS, MAX, DEFAULT, GROUPS, LABEL, QUIZ, VIBES } from '../shared/traits.js';

const COLOR_FIELDS = { skin: 'skin', hair: 'hair', eyes: 'eyes', shirt: 'shirt', pants: 'pants', carColor: 'car', carColor2: 'car' };
export class Preview {
  constructor() {
    this.canvas = h('canvas', { class: 'pv', width: 280, height: 330 }); this.mode = 'person'; this.av = { ...DEFAULT }; this.eq = {}; this.spin = 0.4; this.running = false;
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false }); this.r.outputColorSpace = THREE.SRGBColorSpace; this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.0; this.r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); this.r.setSize(280, 330, false);
    this.scene = new THREE.Scene(); { const pm = new THREE.PMREMGenerator(this.r); this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environmentIntensity = 0.75; pm.dispose(); } this.scene.add(new THREE.HemisphereLight(0xffffff, 0x7a6a8a, 0.55)); const d = new THREE.DirectionalLight(0xfff0d8, 2.0); d.position.set(3, 5, 6); this.scene.add(d);
    const g = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32), new THREE.MeshBasicMaterial({ color: 0x2a1c4a })); g.rotation.x = -Math.PI / 2; g.position.y = -0.01; this.scene.add(g);
    this.cam = new THREE.PerspectiveCamera(32, 280 / 330, 0.1, 50); this.holder = new THREE.Group(); this.scene.add(this.holder); this.t0 = performance.now();
  }
  set(av, eq = {}, mode) { this.av = av; this.eq = eq; if (mode) this.mode = mode; this.rebuild(); }
  rebuild() {
    clear2(this.holder);
    if (this.mode === 'person') { const p = buildPerson(this.av, this.eq); this.person = p; this.holder.add(p.root); this.cam.position.set(0, 1.35, 5.2); this.cam.lookAt(0, 0.95, 0); }
    else { const c = carFor(avatarCarSpec(this.av)); c.scale.setScalar(0.62); this.holder.add(c); this.cam.position.set(0, 1.4, 5.2); this.cam.lookAt(0, 0.55, 0); }
  }
  start() { if (this.running) return; this.running = true; const loop = () => { if (!this.running) return; if (!this.canvas.isConnected) { this.running = false; return; } const t = (performance.now() - this.t0) / 1000; this.holder.rotation.y = this.spin * t * (this.drag ? 0 : 1) + (this.yaw || 0); this.r.render(this.scene, this.cam); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
  mount(parent) { parent.append(this.canvas); this.start(); let x0 = null; this.canvas.onpointerdown = (e) => { x0 = e.clientX; this.drag = true; this.yaw = this.holder.rotation.y; this.t0 = performance.now(); this.canvas.setPointerCapture(e.pointerId); }; this.canvas.onpointermove = (e) => { if (x0 !== null) { this.yaw += (e.clientX - x0) * 0.012; x0 = e.clientX; } }; this.canvas.onpointerup = () => { x0 = null; this.drag = false; this.spin = 0; }; }
}
function clear2(g) { while (g.children.length) g.remove(g.children[0]); }
let sharedPreview = null; export const getPreview = () => sharedPreview || (sharedPreview = new Preview());

// One control per trait: swatches for colors, chips for the rest.
export function control(k, value, onPick, lockedFn) {
  const pal = COLOR_FIELDS[k]; const row = h('div', { class: 'ctl' }, h('label', { text: LABEL[k] }));
  const wrap = h('div', { class: pal ? 'sws' : 'chips' }); row.append(wrap);
  for (let i = 0; i < MAX[k]; i++) {
    if (pal) { if (k === 'carColor2' && i === 16) continue; wrap.append(h('button', { class: 'sw' + (value === i ? ' on' : ''), style: { background: '#' + PAL[pal][i] }, title: NAMES[k][i], 'aria-label': NAMES[k][i], onclick: () => onPick(k, i) })); }
    else wrap.append(h('button', { class: 'chip' + (value === i ? ' on' : ''), text: NAMES[k][i], onclick: () => onPick(k, i) }));
  }
  if (k === 'carColor2') wrap.append(h('button', { class: 'chip' + (value === 16 ? ' on' : ''), text: 'Single color', onclick: () => onPick(k, 16) }));
  return row;
}
export function vibeCards(value, onPick) {
  const w = h('div', { class: 'vibes' }); VIBES.forEach((v, i) => w.append(h('button', { class: 'vibe' + (value === i ? ' on' : ''), style: { '--vc': v.color }, onclick: () => onPick('vibe', i) }, h('span', { class: 'vi', text: v.icon }), h('span', { text: v.name }))));
  return h('div', { class: 'ctl' }, h('label', { text: 'Personality (sets your walk, idle moves, emotes & name-tag color)' }), w);
}
// The quiz asked once when a profile is created.
export function buildQuiz(root, state, onChange) {
  const pv = getPreview(); const holder = h('div', { class: 'pvbox' }); const form = h('div', { class: 'quiz' });
  const draw = () => {
    clear(form); const set = (k, v) => { state[k] = v; pv.set({ ...DEFAULT, ...state }, {}, pv.mode); draw(); onChange && onChange(); };
    for (const k of ['sex', 'age', 'body', 'height']) form.append(control(k, state[k], set));
    form.append(control('skin', state.skin, set), control('hairStyle', state.hairStyle, set), control('hair', state.hair, set), control('eyes', state.eyes, set), control('facial', state.facial, set));
    form.append(vibeCards(state.vibe, set), control('car', state.car, set));
  };
  draw(); pv.set({ ...DEFAULT, ...state }, {}, 'person'); root.append(holder, form); pv.mount(holder);
  holder.append(h('div', { class: 'pvbtns' }, h('button', { class: 'chip on', onclick: () => pv.set({ ...DEFAULT, ...state }, {}, 'person') , text: '🧍 Me' }), h('button', { class: 'chip', onclick: () => pv.set({ ...DEFAULT, ...state }, {}, 'car'), text: '🚗 My VW' })));
}
export function defaultQuiz() { const q = {}; for (const k of QUIZ) q[k] = DEFAULT[k]; q.sex = 2; return q; }
// Full avatar editor for a logged-in profile. save(av) resolves {ok, why}.
export function buildEditor(root, av0, eq, signature, save) {
  let av = { ...av0 }; const pv = getPreview(); const msg = h('p', { class: 'msg' }); const holder = h('div', { class: 'pvbox' }); const form = h('div', { class: 'quiz' });
  const draw = () => {
    clear(form);
    const set = (k, v) => { av[k] = v; pv.set(av, eq, pv.mode); msg.textContent = ''; draw(); };
    for (const [g, ks] of GROUPS) { const sec = h('details', { class: 'grp', open: g === 'Identity' || g === 'Outfit' }, h('summary', { text: g })); for (const k of ks) sec.append(k === 'vibe' ? vibeCards(av.vibe, set) : control(k, av[k], set)); form.append(sec); }
  };
  const rand = () => { for (const k of FIELDS) if (k !== 'vibe' && k !== 'sex') av[k] = Math.floor(Math.random() * MAX[k]); if (av.carColor2 === av.carColor) av.carColor2 = 16; pv.set(av, eq, pv.mode); draw(); };
  const reset = () => { av = { ...signature }; pv.set(av, eq, pv.mode); draw(); msg.textContent = ''; };
  const btnSave = h('button', { class: 'btn primary', text: 'Save look', onclick: async () => { btnSave.disabled = true; const r = await save(av); btnSave.disabled = false; msg.textContent = r.ok ? '✅ Saved! You are the only one with this exact look.' : '⚠ ' + (r.why || 'Could not save'); msg.className = 'msg ' + (r.ok ? 'ok' : 'bad'); if (r.ok && r.av) av = { ...r.av }; } });
  draw(); pv.set(av, eq, 'person'); root.append(holder, h('div', { class: 'edcol' }, form, msg, h('div', { class: 'row' }, btnSave, h('button', { class: 'btn', text: '🎲 Randomize', onclick: rand }), h('button', { class: 'btn', text: '↺ My signature look', onclick: reset }))));
  pv.mount(holder); holder.append(h('div', { class: 'pvbtns' }, h('button', { class: 'chip on', text: '🧍 Me', onclick: () => pv.set(av, eq, 'person') }), h('button', { class: 'chip', text: '🚗 My VW', onclick: () => pv.set(av, eq, 'car') })));
}
