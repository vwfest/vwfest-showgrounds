// VW FEST SHOW GROUNDS client: world, avatars, controls, multiplayer, chat, voice, shop/mint UI glue.
import { THREE, MAT } from './batch.js';
import { buildWorld, buildSky, HALF, GAMES } from './world.js';
import { Gfx, TIERS, detectTier } from './gfx.js';
import { buildPerson, setLOD, makeTag, makeBubble, makeMic } from './people.js';
import { carFor, avatarCarSpec, rideSpec, hydraulics, PLATE_UNI } from './cars.js';
import { Net, decodeSnapshot } from './net.js';
import { setRpcToken, onRpcRefresh, clearRpcToken } from './rpc.mjs';
import { rejoinDelay } from './rejoin.mjs';
import { Voice } from './voice.js';
import { $, h, clear, modal, toast, fmt } from './dom.js';
import { buildQuiz, defaultQuiz, buildEditor } from './editor.js';
import * as UI from './ui.js';
import * as V from './vendors.js';
import { walkAngle, walkDir } from './move.mjs';
import { attachNft, animateNft } from './nftgfx.js';
import { nftAvatarModal } from './nftui.js';
import { DjClient } from './dj.js';
import { mountChip, djModal } from './djui.js';
import { FIELDS, VIBES, DEFAULT } from '../shared/traits.js';

const CFG0 = window.SG_CONFIG || {}; const onGh = /github\.io$/.test(location.hostname) || location.protocol === 'file:';
const SERVER = (CFG0.server && (onGh || CFG0.forceServer) ? CFG0.server : location.origin).replace(/\/$/, '');
const WS_URL = SERVER.replace(/^http/, 'ws') + '/ws';
const nickKey = (n) => n.toLowerCase().replace(/[ _-]+/g, '');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const q = new URLSearchParams(location.search); const DEBUG = q.has('debug');
const FL = { MOVING: 1, AIR: 2, DRIVING: 4, SPEAK: 128 };

const state = { me: null, roster: new Map(), cfg: null, burns: null, inv: { items: [], equipped: {}, rides: [], ride: null }, creds: null, online: 0, cap: 150, chatTab: 'near', blocked: () => false };
const waiters = {}; const players = new Map();
const net = new Net(WS_URL);
let voice = null, scene, renderer, camera, world, sky, me3 = null, joined = false, parked = new Map(), nowT = 0;
const ctx = { net, server: SERVER, state, waiters, get cfg() { return state.cfg; }, get voice() { return voice; }, pack: (av) => UI.packAv(av, FIELDS), closeTop() { const m = $('#modals').lastElementChild; if (m) m.remove(); }, openEditor: () => openEditor(), entry: (o) => UI.entryModal(ctx, o), purchase: (kind, o) => UI.purchaseFlow(ctx, kind, { ...o, title: kind === 'ride' ? '🎁 Mystery ride' : kind === 'shop' ? o.item.name : 'Mint avatar NFT' }), voiceChanged: () => updateVoiceHud(), shopRedraw: null, garageRedraw: null };
// ---------- DJ booth ----------
const dj = new DjClient(net, SERVER); dj.me = () => state.me && state.me.id; ctx.hype = hype; ctx.djc = dj;
const chipUpd = mountChip(dj, ctx);
dj.onChange = () => { chipUpd(); if (world && world.stage && dj.st) world.stage.setScreen(dj.st); if (dj.panel) dj.panel(); };
fetch(new URL('assets/music/playlist.json', document.baseURI)).then((r) => r.json()).then((j) => { ctx.playlist = j.tracks; }).catch(() => {});
addEventListener('pointerdown', () => dj.unlock(), { once: true }); addEventListener('keydown', () => dj.unlock(), { once: true });
function hype() { if (!joined) return; doEmote(4); dj.hype(); }
const on = (t, f) => { const prev = net.on[t]; net.on[t] = (m) => { if (prev) prev(m); f(m); }; };
// resolve waiters
for (const t of ['quote', 'quoteerr', 'buyres', 'wchal', 'wok', 'nfts', 'nftres']) on(t, (m) => { const w = waiters[t]; if (w && w.length) { waiters[t] = []; w.forEach((f) => f(m)); } });

// ---------- renderer / scene ----------
let gfx = null;
function initGL() {
  const canvas = $('#c'); renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(60, 1, 0.1, 520); world = buildWorld(scene, { server: SERVER, plots: (state.cfg.vendor && state.cfg.vendor.plots) || 24, feeUsd: (state.cfg.vendor && state.cfg.vendor.feeUsd) || 30 }); sky = buildSky(scene, renderer);
  gfx = new Gfx({ renderer, scene, camera, world, sky, base: './', isTouch }); const det = detectTier(renderer, isTouch); state.gpu = det.gpu; state.detected = det.tier; gfx.onTier = (t) => { state.tier = t; };
  setQuality(q.get('quality') || localStorage.getItem('sg-quality') || 'auto');
  world.drawBurn(state.burns);
}
// quality: 'auto' (GPU detection + FPS governor), or a fixed tier: ultra | high | med | low
function setQuality(qv) { if (!['auto', ...TIERS].includes(qv)) qv = 'auto'; if (!q.get('quality')) localStorage.setItem('sg-quality', qv); state.quality = qv; state.tier = qv === 'auto' ? state.detected : qv; if (gfx) { gfx.setTier(state.tier, qv === 'auto'); } resize(); }
function resize() { if (!camera) return; const w = innerWidth, h2 = innerHeight; gfx.resize(w, h2); camera.aspect = w / h2; camera.updateProjectionMatrix(); }
addEventListener('resize', () => renderer && resize());

// ---------- entities ----------
function spawnEntity(info, self) {
  const e = { id: info.id, key: nickKey(info.nick), nick: info.nick, av: info.av, eq: info.eq || {}, m: !!info.m, rd: info.rd || null, pk: info.pk || null, nf: info.nf || null, vibe: info.av.vibe, x: 0, y: 0, z: 0, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, flags: 0, vis: false, self: !!self, speed: 0, walkT: 0, emote: 0, emoteT: 0, lastPos: null, car: null, person: null, tag: null, bubble: null, bubbleT: 0, mic: null, dist: 0, hop: 'dip' };
  build(e); return e;
}
function build(e) {
  if (e.person) { scene.remove(e.person.root); e.person.root.traverse((o) => { if (o.isSprite) {} }); }
  if (e.car) scene.remove(e.car);
  e.person = buildPerson(e.av, e.eq); e.person.root.visible = false; scene.add(e.person.root);
  const spec = e.rd ? rideSpec(e.rd) : avatarCarSpec(e.av); e.carSpec = spec; e.car = carFor(spec); e.car.visible = false; scene.add(e.car);
  if (e.tag) { e.person.root.remove(e.tag); } e.tag = makeTag(e.nick, e.vibe, e.m, e.nf && e.nf.n); e.tag.position.y = e.nf ? 2.13 : 2.05; e.person.root.add(e.tag);
  if (!e.mic) { e.mic = makeMic(); } e.mic.visible = false; e.mic.position.y = e.nf ? 2.55 : 2.45; e.person.root.add(e.mic); attachNft(e.person, e.av, e.nf, SERVER);
  // parked ride
}
function setParked(e) {
  const old = parked.get(e.id); if (old) { scene.remove(old); parked.delete(e.id); }
  if (e.pk && e.rd) { const c = carFor(rideSpec(e.rd)); c.position.set(e.pk.x, 0, e.pk.z); c.rotation.y = e.pk.yaw; scene.add(c); parked.set(e.id, c); }
}
function updateInfo(info) {
  const old = state.roster.get(info.id); const e = players.get(info.id);
  const rec = { id: info.id, nick: info.nick, av: info.av, eq: info.eq || {}, m: info.m, rd: info.rd || null, pk: info.pk || null, nf: info.nf || null }; state.roster.set(info.id, rec);
  if (info.id === state.me.id) { Object.assign(state.me, rec); if (me3) { me3.av = rec.av; me3.eq = rec.eq; me3.m = !!rec.m; me3.rd = rec.rd; me3.pk = rec.pk; me3.nf = rec.nf; me3.vibe = rec.av.vibe; build(me3); setParked(me3); } return; }
  if (e) { const changed = JSON.stringify([e.av, e.eq, e.m, e.rd, e.nf]) !== JSON.stringify([rec.av, rec.eq, !!rec.m, rec.rd, rec.nf]); Object.assign(e, { av: rec.av, eq: rec.eq, m: !!rec.m, rd: rec.rd, nf: rec.nf, pk: rec.pk, vibe: rec.av.vibe }); if (changed) build(e); }
  setParked(e || { id: info.id, ...rec });
}

// ---------- input ----------
const keys = new Set(); let camYaw = Math.PI, camPitch = 0.28, camDist = 7.5, camLook = 0, joy = { x: 0, y: 0 }, jump = false, chatFocus = false;
addEventListener('keydown', (e) => { if (chatFocus || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; const k = e.key.toLowerCase(); keys.add(k);
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  if (!joined) return; if (k === 'enter') { e.preventDefault(); $('#chatin').focus(); }
  else if (k === 'f') interact(); else if (k === 'e') toggleDrive(); else if (k === 'p') togglePark(); else if (k === 'v' && voice) voice.ptt(true); else if (k === 'h') hype(); else if (k === 't') dj.talk(true); else if (k >= '1' && k <= '5') doEmote(+k); else if (k === 'escape') { const m = $('#modals').lastElementChild; if (m) m.remove(); } });
addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'v' && voice) voice.ptt(false); if (k === 't') dj.talk(false); });
addEventListener('blur', () => { keys.clear(); if (voice) voice.ptt(false); });
function bindCanvasDrag() {
  const c = $('#c'); let drag = null, moved = 0;
  c.addEventListener('pointerdown', (e) => { if (e.target !== c) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId, sx: e.clientX, sy: e.clientY }; moved = 0; c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy); camYaw -= dx * 0.006; camPitch = Math.max(-0.1, Math.min(1.2, camPitch + dy * 0.005)); });
  c.addEventListener('pointerup', (e) => { if (drag && moved < 6) clickAt(e.clientX, e.clientY); drag = null; });
  c.addEventListener('wheel', (e) => { camDist = Math.max(3.5, Math.min(16, camDist + e.deltaY * 0.01)); e.preventDefault(); }, { passive: false });
}
function bindTouch() {
  const base = $('#joy'), knob = $('#joyk'); let id = null, cx = 0, cy = 0;
  base.addEventListener('pointerdown', (e) => { id = e.pointerId; base.setPointerCapture(id); const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; mv(e); });
  const mv = (e) => { let dx = (e.clientX - cx) / 50, dy = (e.clientY - cy) / 50; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * 38}px,${dy * 38}px)`; };
  base.addEventListener('pointermove', (e) => { if (e.pointerId === id) mv(e); }); const end = (e) => { if (e.pointerId === id) { id = null; joy.x = joy.y = 0; knob.style.transform = 'translate(0,0)'; } }; base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
  const bj = $('#bJump'); bj.addEventListener('pointerdown', () => { jump = true; keys.add(' '); }); const jend = () => keys.delete(' '); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bj.addEventListener(ev, jend); // a cancelled/dragged-off touch must not leave Space stuck down
  { const bp = h('button', { id: 'bPark', class: 'hidden', title: 'Park your ride here', text: '🅿', onclick: () => togglePark() }); $('#bDrive').after(bp); setInterval(() => bp.classList.toggle('hidden', !(joined && L.driving)), 300); } $('#bAct').addEventListener('click', interact); $('#bDrive').addEventListener('click', toggleDrive);
  const talk = $('#bTalk'); talk.addEventListener('pointerdown', (e) => { e.preventDefault(); voice && voice.ptt(true); talk.classList.add('on'); }); const tend = () => { voice && voice.ptt(false); talk.classList.remove('on'); }; talk.addEventListener('pointerup', tend); talk.addEventListener('pointercancel', tend); talk.addEventListener('pointerleave', tend);
}

// ---------- local player ----------
const L = { x: 0, y: 0, z: 40, yaw: Math.PI, vy: 0, driving: false, speed: 0, heading: Math.PI, air: false, lastSend: 0, lastFlags: -1, hydro: false };
function collide(x, z, r) {
  for (const c of world.colliders) { if (c.r) { const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), m = c.r + r; if (d < m && d > 0.0001) { x = c.x + (dx / d) * m; z = c.z + (dz / d) * m; } }
    else { const dx = x - c.x, dz = z - c.z; const ox = c.hw + r - Math.abs(dx), oz = c.hd + r - Math.abs(dz); if (ox > 0 && oz > 0) { if (ox < oz) x += Math.sign(dx || 1) * ox; else z += Math.sign(dz || 1) * oz; } } }
  return [Math.max(-HALF + 1.5, Math.min(HALF - 1.5, x)), Math.max(-HALF + 1.5, Math.min(HALF - 1.5, z))];
}
function step(dt) {
  let ix = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + joy.x, iy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0) + joy.y;
  const mag = Math.min(1, Math.hypot(ix, iy)); const space = keys.has(' ');
  if (L.driving) { // car: A/D steer, W/S throttle
    const thr = -iy; const maxV = 17; L.speed += (thr * 14 - Math.sign(L.speed) * (thr === 0 ? 8 : 0)) * dt; if (thr === 0 && Math.abs(L.speed) < 0.4) L.speed = 0; L.speed = Math.max(-6, Math.min(maxV, L.speed));
    L.heading -= ix * dt * 1.7 * Math.min(1, Math.abs(L.speed) / 5) * Math.sign(L.speed || 1); L.yaw = L.heading;
    let nx = L.x + Math.sin(L.heading) * L.speed * dt, nz = L.z + Math.cos(L.heading) * L.speed * dt; const [cx, cz] = collide(nx, nz, 1.4); if (Math.hypot(cx - nx, cz - nz) > 0.05) L.speed *= 0.4; L.x = cx; L.z = cz;
    L.hydro = !!(me3.rd && me3.rd.stance === 4) && space; L.y = 0;
  } else {
    const run = keys.has('shift') ? 1.5 : 1; const sp = (mag > 0.05 ? 5.2 * run : 0);
    if (mag > 0.05) { const a = walkAngle(ix, iy, camYaw); const [dirx, dirz] = walkDir(ix, iy, camYaw); const nx = L.x + dirx * sp * mag * dt, nz = L.z + dirz * sp * mag * dt; [L.x, L.z] = collide(nx, nz, 0.45); let d = a - L.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); L.yaw += d * Math.min(1, dt * 12); L.speed = sp * mag; } else L.speed = 0;
    if (space && !L.air) { L.vy = 6.2; L.air = true; } L.vy -= 17 * dt; L.y += L.vy * dt; if (L.y <= 0) { L.y = 0; L.vy = 0; L.air = false; }
  }
  me3.x = L.x; me3.y = L.y; me3.z = L.z; me3.yaw = L.yaw; me3.tx = L.x; me3.tz = L.z; me3.ty = L.y;
  let flags = (L.speed > 0.4 ? FL.MOVING : 0) | (L.air ? FL.AIR : 0) | (L.driving ? FL.DRIVING : 0) | (voice && voice.speaking ? FL.SPEAK : 0); me3.flags = flags;
  const now = performance.now(); if (net.open && (flags !== L.lastFlags || now - L.lastSend > (L.speed > 0.1 || L.air ? 90 : 4000))) { net.move(L.x, L.y, L.z, L.yaw, flags); L.lastSend = now; L.lastFlags = flags; }
}
function toggleDrive() {
  if (!joined) return; if (L.driving) { L.driving = false; L.speed = 0; L.x += Math.cos(L.heading) * 2.2; L.z -= Math.sin(L.heading) * 2.2; if (me3.rd) net.json({ t: 'park', on: true }); toast('Exited your VW' + (me3.rd ? ' (parked here)' : '')); }
  else { L.driving = true; L.heading = L.yaw; L.speed = 0; if (me3.rd) net.json({ t: 'park', on: false }); toast((matchMedia('(pointer: coarse)').matches ? 'Driving: use the stick to steer, 🅿 to park' : 'Driving: W/S gas & brake, A/D steer') + (me3.rd && me3.rd.stance === 4 ? ', hold Space = hydraulics!' : '')); }
}
function togglePark() { if (!L.driving) return; toggleDrive(); }
function doEmote(i) { if (!joined) return; me3.emote = i; me3.emoteT = 0; net.json({ t: 'emote', id: i }); }

// ---------- animation ----------
const EMOTE_ANIM = { 'Wave': 'wave', 'Shaka': 'wave', 'Lean back': 'lean', 'Cheer': 'cheer', 'Honk': 'honk', 'Wrench spin': 'spin', 'Thumbs up': 'thumbs', 'Dance': 'dance', 'Party jump': 'jump', 'Peace sign': 'peace', 'Meditate': 'meditate', 'Rev it': 'rev', 'Fist pump': 'fist', 'Bow': 'bow', 'Judge nod': 'nod', 'Cast': 'cast', 'Surf pose': 'surf', 'Point': 'point', 'Deal': 'thumbs' };
function pose(e, dt, t, moving) {
  const P = e.person; const v = VIBES[e.vibe] || VIBES[0]; const ws = v.walk, idle = v.idle; let aLx = 0, aRx = 0, aLz = 0, aRz = 0, lLx = 0, lRx = 0, bob = 0, lean = 0, roll = 0, yaw = 0, sink = 0;
  if (moving) { const fast = e.speed > 6; const sw = { smooth: 0.8, stomp: 1.0, bounce: 0.9, float: 0.35, sprint: 1.25, proud: 0.7, swagger: 0.85 }[ws] || 0.8; e.walkT += dt * (e.speed * 1.9 + 2); const s = Math.sin(e.walkT), c = Math.cos(e.walkT * 2); lLx = s * sw * (fast ? 1.15 : 1); lRx = -s * sw * (fast ? 1.15 : 1); aLx = -s * sw * 0.9; aRx = s * sw * 0.9; bob = Math.abs(Math.cos(e.walkT)) * ({ stomp: 0.09, bounce: 0.16, float: 0.03, sprint: 0.1 }[ws] || 0.06); lean = ws === 'sprint' ? 0.28 : ws === 'proud' ? -0.08 : fast ? 0.15 : 0.04; if (ws === 'swagger') { roll = s * 0.1; yaw = s * 0.08; } if (ws === 'float') bob += Math.sin(t * 3) * 0.04; }
  else { const s = Math.sin(t * 1.6 + e.id), s2 = Math.sin(t * 5 + e.id);
    if (idle === 'sway') { roll = s * 0.04; aLx = s * 0.06; aRx = -s * 0.06; } else if (idle === 'tinker') { aRx = -0.9 + s2 * 0.15; aRz = 0.0; yaw = s * 0.06; } else if (idle === 'dance') { bob = Math.abs(Math.sin(t * 4 + e.id)) * 0.07; aLx = Math.sin(t * 4) * 0.5; aRx = -Math.sin(t * 4) * 0.5; roll = Math.sin(t * 2) * 0.08; }
    else if (idle === 'rev') { bob = Math.abs(s2) * 0.012; aLx = -0.2; aRx = -0.2; } else if (idle === 'pose') { aLz = 0.25; aRz = -0.25; lean = -0.06; } else if (idle === 'float') { bob = 0.12 + Math.sin(t * 1.8 + e.id) * 0.07; aLz = 0.2; aRz = -0.2; } else if (idle === 'look') { yaw = Math.sin(t * 0.7 + e.id) * 0.5; }
    else { aLx = s * 0.04; } }
  if (e.flags & FL.AIR || (e.self && L.air)) { lLx = -0.6; lRx = 0.4; aLz = 0.5; aRz = -0.5; }
  if (e.emote) { e.emoteT += dt; const list = v.emotes; const anim = EMOTE_ANIM[list[e.emote - 1]] || 'wave'; const T = e.emoteT; if (T > 3.2) e.emote = 0; else {
    const k = Math.min(1, T * 5) * (T > 2.8 ? Math.max(0, (3.2 - T) / 0.4) : 1);
    if (anim === 'wave') { aRz = -(2.6 * k); aRx = 0; roll += Math.sin(T * 10) * 0.0; P.aR.rotation.z = -2.6 * k + Math.sin(T * 12) * 0.35 * k; aRz = 0; e.__az = true; }
    else if (anim === 'cheer') { aLz = 2.7 * k; aRz = -2.7 * k; bob += Math.abs(Math.sin(T * 8)) * 0.18 * k; } else if (anim === 'jump') { bob += Math.abs(Math.sin(T * 7)) * 0.4 * k; aLz = 2 * k; aRz = -2 * k; }
    else if (anim === 'dance') { bob += Math.abs(Math.sin(T * 7)) * 0.1 * k; aLx = Math.sin(T * 7) * 1.6 * k; aRx = -Math.sin(T * 7) * 1.6 * k; roll += Math.sin(T * 3.5) * 0.2 * k; yaw += Math.sin(T * 3.5) * 0.4 * k; lLx = Math.sin(T * 7) * 0.5 * k; lRx = -Math.sin(T * 7) * 0.5 * k; }
    else if (anim === 'bow') { lean += 0.9 * Math.sin(Math.min(1, T / 1.2) * Math.PI) * k; } else if (anim === 'nod') { lean += Math.sin(T * 6) * 0.12 * k; aRx = -1.2 * k; }
    else if (anim === 'meditate') { sink = 0.45 * k; lLx = -1.4 * k; lRx = -1.4 * k; aLx = -0.7 * k; aRx = -0.7 * k; bob += Math.sin(T * 2) * 0.04; } else if (anim === 'peace') { aRz = -2.3 * k; aRx = -0.2 * k; }
    else if (anim === 'spin') { aRx = -T * 9 * k; } else if (anim === 'fist') { aRz = -2.6 * k; bob += Math.abs(Math.sin(T * 8)) * 0.05 * k; } else if (anim === 'thumbs') { aRx = -1.4 * k; } else if (anim === 'point') { aRx = -1.57 * k; }
    else if (anim === 'cast') { aLz = 1.6 * k; aRz = -1.6 * k; aLx = -0.8 * k; aRx = -0.8 * k; bob += (0.1 + Math.sin(T * 5) * 0.05) * k; } else if (anim === 'surf') { lLx = 0.5 * k; lRx = -0.5 * k; roll += Math.sin(T * 4) * 0.1 * k; aLz = 1 * k; aRz = -1 * k; } else if (anim === 'rev') { bob += Math.sin(T * 40) * 0.01 * k; aLx = -1.2 * k; aRx = -1.2 * k; } else if (anim === 'lean') { lean -= 0.35 * k; roll += 0.05 * k; } else if (anim === 'honk') { aRx = -1.4 * k; }
  } }
  P.aL.rotation.x = aLx; P.aR.rotation.x = aRx; P.aL.rotation.z = -aLz; if (!e.__az) P.aR.rotation.z = -aRz; e.__az = false; P.lL.rotation.x = lLx; P.lR.rotation.x = lRx; P.pose.position.y = bob - sink; P.upper.rotation.x = lean; P.upper.rotation.z = roll; P.upper.rotation.y = yaw; if (e.av.age === 3) P.upper.rotation.x += 0.12;
  if (P.aura) P.aura.rotation.y = t * 1.2; if (P.glow) P.glow.material.opacity = 0.45 + Math.sin(t * 3) * 0.15; if (P.halo) P.halo.position.y = 1.9 + Math.sin(t * 2) * 0.03;
}
function updateEntity(e, dt, t, self) {
  if (!self) { const k = Math.min(1, dt * 11); e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.z += (e.tz - e.z) * k; let d = e.tyaw - e.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); e.yaw += d * Math.min(1, dt * 12); if (e.lastPos) e.speed = Math.hypot(e.x - e.lastPos[0], e.z - e.lastPos[1]) / Math.max(dt, 0.001); e.lastPos = [e.x, e.z]; }
  else e.speed = L.speed;
  const driving = !!(e.flags & FL.DRIVING); const camd = Math.hypot(e.x - camera.position.x, e.z - camera.position.z); e.dist = camd;
  const show = camd < 100; e.person.root.visible = show && !driving; e.car.visible = show && driving;
  e.person.root.position.set(e.x, e.y, e.z); e.person.root.rotation.y = e.yaw; e.car.position.set(e.x, 0, e.z); e.car.rotation.y = e.yaw;
  if (e.person.root.visible) { setLOD(e.person, camd > 42 && !self); pose(e, dt, t, e.speed > 0.7); animateNft(e.person, t, e.id, camd < 60); }
  const tagOn = camd < 38 || self; if (e.tag.visible !== tagOn) e.tag.visible = tagOn;
  if (e.car.visible && e.car.userData.hydro) hydraulics(e.car, t, 'hop', self ? L.hydro : !!(e.flags & FL.AIR));
  if (e.bubble) { e.bubbleT -= dt; if (e.bubbleT <= 0) { e.person.root.remove(e.bubble); e.bubble.material.map.dispose(); e.bubble.material.dispose(); e.bubble = null; } }
  e.mic.visible = !!(e.flags & FL.SPEAK) && !driving || (!!(e.flags & FL.SPEAK) && driving); if (e.mic.visible) { e.mic.scale.setScalar(0.3 + Math.sin(t * 10) * 0.04); e.mic.position.y = driving ? 2.5 : 2.45; }
  if (driving) { e.tag.position.y = 2.6; } else e.tag.position.y = e.bubble ? 2.05 : 2.05;
}
function say(e, text) { if (!e.person) return; if (e.bubble) { e.person.root.remove(e.bubble); e.bubble.material.map.dispose(); e.bubble.material.dispose(); } e.bubble = makeBubble(text); e.bubble.position.y = 2.75; e.person.root.add(e.bubble); e.bubbleT = 6; }

// ---------- interaction ----------
let curSpot = null;
// Zones never overlap (test/spots.cjs), but if two ever do: pick the nearest, preferring the one the player is facing (yaw -> direction (sin, cos)).
function nearestSpot() { let best = null, bs = 1e9; for (const s of world.spots) { const dx = s.x - L.x, dz = s.z - L.z, d = Math.hypot(dx, dz); if (d >= s.r) continue; const face = d > 0.01 ? (Math.sin(L.yaw) * dx + Math.cos(L.yaw) * dz) / d : 0; const sc = d - 1.5 * face; if (sc < bs) { best = s; bs = sc; } } return best; }
function interact() {
  if (!joined || !curSpot) return; const s = curSpot;
  if (s.game) { window.open(s.game.url, '_blank', 'noopener,noreferrer'); toast(`Opening ${s.game.name} in a new tab…`); }
  else if (s.id === 'shop') UI.shopModal(ctx); else if (s.id === 'showroom') UI.garageModal(ctx); else if (s.id === 'burn') UI.burnModal(ctx);
  else if (s.id === 'info') V.infoModal(ctx); else if (s.id === 'dj') { if (dj.st && dj.st.on && !dj.st.dj) dj.claim(); djModal(ctx, dj); } else if (s.id.startsWith('vendor:')) V.boothModal(ctx, +s.id.slice(7));
}
function clickAt(px, py) { // click a player to open their profile card
  let best = null, bd = 48 * 48; const v = new THREE.Vector3();
  for (const e of [...players.values(), me3]) { if (!e || !e.person || !(e.person.root.visible || e.car.visible)) continue; v.set(e.x, e.y + 1.2, e.z).project(camera); if (v.z > 1) continue; const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight; const d = (sx - px) ** 2 + (sy - py) ** 2; if (d < bd) { bd = d; best = e; } }
  if (best) net.json({ t: 'profile', sid: best.id });
}

// ---------- chat ----------
const chatLog = []; function addChat(m) {
  if (m.nick && state.me && m.id !== state.me.id && voice && voice.isBlocked(nickKey(m.nick))) return;
  const box = $('#chatlog'); const line = h('div', { class: 'cl ' + (m.kind || m.scope || '') }); if (m.nick) { const v = [...state.roster.values(), state.me].find((p) => p.id === m.id); const col = v ? (VIBES[v.av.vibe] || VIBES[0]).color : '#fff'; line.append(h('b', { style: { color: col }, text: (m.m ? '★ ' : '') + m.nick + (m.scope === 'all' ? ' 🌐' : '') + ': ' }), h('span', { text: m.text })); } else line.append(h('i', { text: m.text }));
  line.dataset.scope = m.scope || 'sys'; box.append(line); while (box.children.length > 120) box.firstChild.remove(); applyTab(); box.scrollTop = box.scrollHeight;
}
function applyTab() { for (const l of $('#chatlog').children) l.style.display = state.chatTab === 'all' || l.dataset.scope !== 'all' || true ? '' : 'none'; }
function bindChat() {
  const inp = $('#chatin'); inp.addEventListener('focus', () => { chatFocus = true; keys.clear(); }); inp.addEventListener('blur', () => { chatFocus = false; });
  const send = () => { const t = inp.value.trim(); if (!t) return; net.json({ t: 'chat', scope: state.chatTab, text: t }); inp.value = ''; };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { send(); inp.blur(); } else if (e.key === 'Escape') inp.blur(); e.stopPropagation(); }); $('#chatsend').addEventListener('click', send);
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { state.chatTab = b.dataset.tab; document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); inp.placeholder = state.chatTab === 'all' ? 'Message everyone on the grounds…' : 'Say something to people nearby…'; });
  $('#chatToggle').addEventListener('click', () => $('#chat').classList.toggle('min'));
}

// ---------- net events ----------
function bindNet() {
  on('hi', (m) => { state.online = m.online; state.cap = m.cap; state.burns = m.burns; if (world) world.drawBurn(m.burns); hud(); });
  on('full', (m) => { joinDone(); showFull(m); });
  let rejoinTries = 0; on('joinerr', (m) => { joinDone(); const d = rejoinDelay(m, rejoinTries); if (d !== null && net.lastJoin) { rejoinTries++; joinMsg('Reconnecting…'); const j = net.lastJoin; setTimeout(() => { if (!joined && net.open) net.json(j); }, d); return; } if (m.err === 'stale') { localStorage.removeItem('vwfest-sg'); state.creds = null; showJoin(true); } joinMsg(m.why || 'Could not join', true); if (['badnick', 'taken'].includes(m.err)) nickProblem(); });
  on('welcome', (m) => { joinDone(); rejoinTries = 0; setRpcToken(m.rpcToken); onWelcome(m); setTimeout(() => UI.resumePurchases(ctx).catch(() => {}), 2500); if (voice && voice.on) voice.optIn(); });
  on('rpctok', (m) => setRpcToken(m.rpcToken)); onRpcRefresh(() => { if (net.open && joined) net.json({ t: 'rpctok' }); });
  on('p+', (m) => { if (!state.me || m.id === state.me.id && !joined) return; updateInfo(m); });
  on('p-', (m) => { state.roster.delete(m.id); const e = players.get(m.id); if (e) { scene.remove(e.person.root); scene.remove(e.car); players.delete(m.id); } const pk = parked.get(m.id); if (pk) { scene.remove(pk); parked.delete(m.id); } if (voice) voice.drop(m.id, true); });
  on('dj', (m) => dj.onState(m)); on('djh', () => { if (world.stage) world.stage.fx.flash = 1; });
  on('bin', (dv) => { if (dv.getUint8(0) === 4) return dj.onMicPacket(dv); const snap = decodeSnapshot(dv); const seen = new Set(); for (const s of snap.list) { seen.add(s.id); let e = players.get(s.id); if (!e) { const info = state.roster.get(s.id); if (!info) continue; e = spawnEntity(info); e.x = s.x; e.y = s.y; e.z = s.z; e.yaw = s.yaw; players.set(s.id, e); } e.tx = s.x; e.ty = s.y; e.tz = s.z; e.tyaw = s.yaw; e.flags = s.flags; } if (snap.key) for (const [id, e] of players) if (!seen.has(id)) { scene.remove(e.person.root); scene.remove(e.car); players.delete(id); } });
  on('chat', (m) => { addChat(m); const e = m.id === state.me.id ? me3 : players.get(m.id); if (e && !(voice && voice.isBlocked(e.key))) say(e, m.text); });
  on('sys', (m) => { state.online = m.online; hud(); if (m.kind !== 'leave') addChat({ text: m.text, kind: m.kind }); });
  on('chaterr', (m) => toast(m.why)); on('toast', (m) => toast(m.text));
  on('emote', (m) => { const e = m.id === state.me.id ? null : players.get(m.id); if (e) { e.emote = m.e; e.emoteT = 0; } });
  on('nft', (m) => { const nf = m.nf || null; const rec = m.id === state.me.id ? state.me : state.roster.get(m.id); if (rec) rec.nf = nf; const e = m.id === state.me.id ? me3 : players.get(m.id); if (e) { e.nf = nf; build(e); } });
  on('corr', (m) => { L.x = m.x; L.y = m.y; L.z = m.z; L.speed = 0; });
  on('kick', (m) => { net.noReconnect = true; showKicked(m.why); });
  on('vendors', (m) => { state.vendors = m.list; state.vendorPlots = m.plots; world && world.extras && world.extras.update(m.list); if (ctx.vendorRedraw) ctx.vendorRedraw(); });
  on('vendor', (m) => { toast(m.mode === 'renew' ? `Booth renewed until ${new Date(m.exp).toLocaleDateString()}` : `Your booth #${m.plot} is open! Press F at it to customize.`); });
  on('burns', (m) => { state.burns = m.burns; world && world.drawBurn(m.burns); });
  on('inv', (m) => { state.inv = m; if (ctx.shopRedraw) ctx.shopRedraw(); if (ctx.garageRedraw) ctx.garageRedraw(); world && world.setShowroom && world.setShowroom(m.rides.map((r) => ({ spec: r.spec }))); });
  on('reveal', (m) => UI.revealModal(ctx, m.ride));
  on('profile', (m) => UI.profileCardModal(ctx, m));
  on('avres', (m) => { /* handled by editor promise */ if (waiters.avres) { const w = waiters.avres; waiters.avres = []; w.forEach((f) => f(m)); } });
  on('rtc', (m) => { if (voice) voice.onSignal(m, players, { x: L.x, z: L.z, id: state.me.id }); });
  on('close', (m) => { clearRpcToken(); if (!joined && !pendingJoin && !m.was && !net.noReconnect) { const e = $('#msgjoin'); if (e && !e.textContent) joinMsg('The server is not answering yet. Retrying…'); } if (joined && !net.noReconnect) { joinMsg('Connection lost, reconnecting…', true); joined = false; $('#hudwrap').classList.add('dim'); } });
  on('open', () => { if (pendingJoin) { const j = pendingJoin; pendingJoin = null; clearTimeout(joinWatch); joinMsg('Connecting…'); net.json(j); return; } if (state.me && state.creds && !joined) { net.json({ t: 'join', id: state.creds.id, secret: state.creds.secret, nick: state.creds.nick }); } });
}
function onWelcome(m) {
  if (m.cred) { state.creds = { id: m.cred.id, secret: m.cred.secret, nick: m.nick }; try { localStorage.setItem('vwfest-sg', JSON.stringify(state.creds)); } catch {} }
  const info = { id: m.id, nick: m.nick, av: m.av, eq: m.eq, m: 0 }; state.me = { ...info, pid: m.pid, created: m.created }; state.roster.clear(); for (const r of m.roster) state.roster.set(r.id, r);
  for (const e of players.values()) { scene.remove(e.person.root); scene.remove(e.car); } players.clear(); for (const c of parked.values()) scene.remove(c); parked.clear();
  if (me3) { scene.remove(me3.person.root); scene.remove(me3.car); }
  me3 = spawnEntity(info, true); me3.vis = true; me3.rd = null; L.x = m.x; L.z = m.z; L.y = 0; L.yaw = m.yaw; camYaw = L.yaw + Math.PI; L.driving = false; state.inv = m.inv; me3.m = !!(m.roster && false);
  for (const r of m.roster) { if (r.pk) setParked(r); }
  const mine = m.inv.rides.find((r) => r.id === m.inv.ride); if (mine) { me3.rd = mine.spec; build(me3); }
  world.setShowroom(m.inv.rides.map((r) => ({ spec: r.spec })));
  for (const c of m.chat) addChat(c); joined = true; state.online = m.online; hud(); $('#join').classList.add('hidden'); $('#hudwrap').classList.remove('dim'); $('#hudwrap').classList.remove('hidden'); $('#msgjoin').textContent = '';
  setupEmoteBar(); updateVoiceHud(); toast(m.created ? `Welcome, ${m.nick}! Your profile ID is ${m.pid}.` : `Welcome back, ${m.nick}!`);
  if (!localStorage.getItem('sg-help')) { localStorage.setItem('sg-help', '1'); helpModal(); }
}
function setupEmoteBar() { const v = VIBES[state.me.av.vibe] || VIBES[0]; const bar = clear($('#emotes')); v.emotes.forEach((n, i) => bar.append(h('button', { class: 'emo', title: `${n} (${i + 1})`, onclick: () => doEmote(i + 1), text: n }))); }

// ---------- screens ----------
function hud() { $('#online').textContent = `${state.online}/${state.cap} online`; }
function joinMsg(t, bad) { const e = $('#msgjoin'); if (!e) return; e.textContent = t; e.className = 'msg' + (bad ? ' bad' : ''); }
// A join that is clicked while the socket is not open yet (server asleep on free hosting, or down) used to be dropped silently, leaving "Connecting…" forever.
// Now it is held and sent the moment the socket opens, with honest progress text while we wait.
let pendingJoin = null, joinWatch = 0, nickEl = null;
function sendJoin(msg) {
  pendingJoin = msg; clearTimeout(joinWatch);
  if (net.open) { pendingJoin = null; joinMsg('Connecting…'); net.json(msg); return; }
  joinMsg('Reaching the server…');
  joinWatch = setTimeout(() => { if (!pendingJoin) return; joinMsg('The server is waking up (free hosting can take up to a minute). Hang tight: you will join automatically.');
    joinWatch = setTimeout(() => { if (pendingJoin) joinMsg("Still can't reach the server. We keep retrying in the background. You can also try again in a minute.", true); }, 45000); }, 4000);
}
function joinDone() { pendingJoin = null; clearTimeout(joinWatch); }
function nickProblem() { if (nickEl && nickEl.isConnected) { nickEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); nickEl.focus({ preventScroll: true }); nickEl.select(); } }
function showFull(m) { net.noReconnect = true; const j = $('#join'); j.classList.remove('hidden'); clear($('#joinbody')).append(h('div', { class: 'full' }, h('h2', { text: '🚐 The grounds are full' }), h('p', { text: `${m.online} of ${m.cap} people are here right now. We will keep trying for you.` }), h('button', { class: 'btn primary', text: 'Try again now', onclick: () => location.reload() }), h('p', { class: 'muted', text: 'Meanwhile: the Arcade Room games are always open.' }), h('a', { class: 'btn', href: 'https://vwfest.github.io/vwfest-arcade/', text: '🎮 Arcade Room' }))); setTimeout(() => location.reload(), 20000); }
function showKicked(why) { const j = $('#join'); j.classList.remove('hidden'); clear($('#joinbody')).append(h('div', { class: 'full' }, h('h2', { text: 'You left the grounds' }), h('p', { text: why || '' }), h('button', { class: 'btn primary', text: 'Rejoin', onclick: () => location.reload() }))); }
function showJoin(forceNew) {
  const j = $('#join'); j.classList.remove('hidden'); const body = clear($('#joinbody')); let saved = null; try { saved = JSON.parse(localStorage.getItem('vwfest-sg') || 'null'); } catch {}
  const status = h('p', { id: 'msgjoin', class: 'msg' });
  if (saved && saved.id && !forceNew) { state.creds = saved; body.append(h('h2', { text: `Welcome back, ${saved.nick}` }), h('p', { class: 'muted', text: `Profile ${saved.id}` }), h('div', { class: 'row' }, h('button', { class: 'btn primary big', text: '▶ Enter the grounds', onclick: () => { sendJoin({ t: 'join', id: saved.id, secret: saved.secret, nick: saved.nick }); } }), h('button', { class: 'btn', text: 'New profile', onclick: () => showJoin(true) })), status); return; }
  const quiz = defaultQuiz(); const nick = h('input', { type: 'text', maxlength: 14, placeholder: 'Your nickname (3-14 letters, numbers, space _ -)', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', 'aria-label': 'Nickname', value: forceNew ? '' : (saved && saved.nick) || '' }); nickEl = nick; // 'New profile' must start EMPTY: a prefilled old name made typing append to it and the 14-char limit silently cut the new name (ShotBot -> ShotBo)
  nick.addEventListener('focus', () => nick.select());
  body.append(h('h2', { text: 'Create your profile' }), h('p', { class: 'muted', text: 'Free, no sign-up. Answer a few questions and we will build your one-of-a-kind avatar (fine details like freckles, tattoos and your outfit are rolled from your profile ID). You can customize everything afterwards.' }), nick);
  const qz = h('div', { class: 'quizwrap' }); body.append(qz); buildQuiz(qz, quiz);
  const go = h('button', { class: 'btn primary big', text: '▶ Create profile & enter', onclick: () => { const n = nick.value.trim(); if (n.length < 3) { joinMsg('Pick a nickname first (3-14 characters).', true); return nickProblem(); } state.creds = { nick: n }; sendJoin({ t: 'join', nick: n, quiz }); } });
  body.append(h('div', { class: 'row' }, go, saved ? h('button', { class: 'btn', text: 'Use saved profile', onclick: () => showJoin(false) }) : null), status);
}
function openEditor() {
  const body = h('div', { class: 'editor' }); const sig = state.me.av;
  buildEditor(body, state.me.av, state.me.eq, state.me.av, (av) => new Promise((res) => { waiters.avres = [...(waiters.avres || []), (m) => { if (m.ok) { state.me.av = m.av; } res(m); }]; net.json({ t: 'av', av }); setTimeout(() => res({ ok: false, why: 'No answer from the server' }), 8000); }));
  const mod = modal('🧍 Avatar editor', body, { cls: 'wide' });
  const mint = h('div', { class: 'row' }, h('button', { class: 'btn', text: '✨ Mint this avatar as an NFT ($' + (state.cfg ? state.cfg.feeUsd : 5) + ' · burns $VWFEST)', onclick: () => { mod.close(); ctx.purchase('avatar', { method: 'sol' }); } }), h('button', { class: 'btn', text: '🎟 No wallet? Entry / Mint with Google' + (state.cfg && state.cfg.onramp && state.cfg.onramp.length ? ' + card' : ''), onclick: () => { mod.close(); UI.entryModal(ctx); } })); body.append(mint); if (state.cfg && state.cfg.nftAvatars) body.append(h('div', { class: 'row' }, h('button', { class: 'btn', text: state.me && state.me.nf ? '🖼 Change / remove my NFT avatar' : '🖼 Use an NFT I already own (free)', onclick: () => { mod.close(); nftAvatarModal(ctx); } })));
}
function helpModal() {
  modal('Welcome to the VW FEST SHOW GROUNDS', h('div', { class: 'help' }, h('p', { text: 'A free hangout for the $VWFEST community: stroll the show field, check out the cars, visit the Arcade booths and say hi.' }), h('ul', {}, h('li', { text: 'Move: WASD / arrows (Shift to run) · Space: jump · drag to look · scroll to zoom' }), h('li', { text: 'F: use a booth / tent · E: drive your VW (A/D steer) · P: park · 1-5: emotes' }), h('li', { text: 'Click a player to open their profile card' }), h('li', { text: 'Enter: chat (Nearby or Global). Voice: open 🎙 and join; hold V to talk' }), h('li', { text: 'Mobile: left stick to move, buttons on the right' })), h('p', { class: 'muted', text: 'Shop, rides and NFT minting are optional. A wallet is only needed for those, and every purchase burns $VWFEST.' })));
}

// ---------- voice hud ----------
function updateVoiceHud() { const b = $('#bVoice'); if (!b || !voice) return; b.classList.toggle('live', voice.on); b.classList.toggle('talk', voice.speaking); b.textContent = voice.speaking ? '🎙 talking' : voice.on ? '🎧 voice' : '🎙 voice'; $('#bTalk').classList.toggle('hidden', !(isTouch && voice.micStream)); }

// ---------- main loop ----------
let last = performance.now(), frames = 0, fpsT = 0, vmT = 0;
function loop(now) {
  requestAnimationFrame(loop); const dt = Math.min(0.1, (now - last) / 1000); last = now; nowT += dt; PLATE_UNI.uTime.value = nowT;
  const phase = (Date.now() / 1000 % 600) / 600; sky.update(q.has('phase') ? +q.get('phase') : phase);
  for (const f of world.anim) f(nowT);
  dj.tick(dt, joined ? L.x : 0, joined ? L.z : 20); if (world.stage) world.stage.update(dj.level, dj.bands, dt);
  if (joined && me3) {
    step(dt); updateEntity(me3, dt, nowT, true);
    for (const e of players.values()) updateEntity(e, dt, nowT, false);
    for (const [id, c] of parked) { const info = state.roster.get(id); const d = Math.hypot(c.position.x - L.x, c.position.z - L.z); c.visible = d < 110 && !(players.get(id) && (players.get(id).flags & FL.DRIVING)); if (c.userData.hydro && c.visible) hydraulics(c, nowT, 'dip', d < 25); }
    // camera
    const cd = L.driving ? camDist + 3.5 : camDist; const tx = L.x, tz = L.z, ty = L.y + (L.driving ? 1.3 : (camLook || 1.55)); const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    if (L.driving && !drag3()) camYaw += (L.heading + Math.PI - camYaw) * Math.min(1, dt * 1.5) * 0;
    camera.position.x += (tx + Math.sin(camYaw) * cd * cp - camera.position.x) * Math.min(1, dt * 12); camera.position.z += (tz + Math.cos(camYaw) * cd * cp - camera.position.z) * Math.min(1, dt * 12); camera.position.y += (ty + sp * cd + 0.3 - camera.position.y) * Math.min(1, dt * 12); camera.lookAt(tx, ty, tz);
    curSpot = nearestSpot(); const pr = $('#prompt'); if (curSpot) { pr.classList.remove('hidden'); pr.textContent = (isTouch ? 'Tap ✋ · ' : 'Press F · ') + curSpot.label; } else pr.classList.add('hidden');
    world.updateShowroom(nowT, L.x, L.z);
    if (voice) { vmT += dt; if (vmT > 0.4) { vmT = 0; voice.manage({ x: L.x, z: L.z, id: state.me.id }, players); } voice.tick({ x: L.x, z: L.z, yaw: camYaw + Math.PI }, players); }
  } else { camera.position.set(Math.sin(nowT * 0.05) * 60, 18, 90); camera.lookAt(0, 4, 10); world.updateShowroom(nowT, 0, 0); }
  { const fx = joined && me3 ? L.x : 0, fz = joined && me3 ? L.z : 20; gfx.update(phase, { x: fx, z: fz, dist: 0 }, dt); world.updateGrass(fx, fz, nowT); gfx.render(dt); }
  frames++; fpsT += dt; if (fpsT > 1) { if (DEBUG) $('#dbg').textContent = `${Math.round(frames / fpsT)} fps · ${renderer.info.render.calls} calls · ${renderer.info.render.triangles} tris · ${state.tier} · ${players.size} vis · ↑${net.sent}B ↓${net.recv}B`; frames = 0; fpsT = 0; }
}
const drag3 = () => false;

// ---------- boot ----------
async function boot() {
  try { const r = await fetch(SERVER + '/api/config'); state.cfg = await r.json(); } catch { state.cfg = { enabled: false, shop: [], odds: [], iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], voiceRange: 15, rideUsd: 5, feeUsd: 5, discountPct: 50, decimals: 6, network: 'mainnet-beta' }; }
  initGL(); bindCanvasDrag(); bindChat(); bindNet(); if (isTouch) { document.body.classList.add('touch'); bindTouch(); }
  voice = new Voice(net, state.cfg); voice.onChange = () => updateVoiceHud(); state.blocked = (k) => voice.isBlocked(k);
  $('#bAvatar').onclick = () => joined && openEditor(); $('#bShop').onclick = () => joined && UI.shopModal(ctx); $('#bGarage').onclick = () => joined && UI.garageModal(ctx); $('#bBurn').onclick = () => UI.burnModal(ctx); $('#bVoice').onclick = () => joined && UI.voiceModal(ctx); $('#bPlayers').onclick = () => joined && UI.playersModal(ctx); $('#bHelp').onclick = () => V.infoModal(ctx); $('#bVendors').onclick = () => V.vendorDirectory(ctx); const lh = $('#howLink'); if (lh) lh.onclick = (e) => { e.preventDefault(); V.infoModal(ctx); }; $('#bSet').onclick = settingsModal; $('#bProfile').onclick = () => joined && net.json({ t: 'profile', sid: state.me.id });
  net.connect(); showJoin(false); requestAnimationFrame(loop);
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) window.__sg = { // debug/test handle (state holds the profile secret): never on a public origin
    dj, state, players, get world() { return world; }, L, net, ctx, get me() { return me3; }, cam: () => camera, goto: (x, z) => { L.x = x; L.z = z; }, emote: doEmote, setCam: (y, p) => { camYaw = y; camPitch = p; }, voice: () => voice, scene: () => scene, renderer: () => renderer, gfx: () => gfx, setDist: (d, look) => { camDist = d; camLook = look || 0; } };
  window.__ready = true;
}
function settingsModal() {
  const b = h('div', { class: 'settings' }); const names = { auto: 'Auto', ultra: 'Ultra', high: 'High', med: 'Medium', low: 'Low' };
  const chips = h('div', { class: 'row wrap' }); for (const qv of ['auto', ...TIERS]) chips.append(h('button', { class: 'chip' + (state.quality === qv ? ' on' : ''), text: names[qv], onclick: () => { setQuality(qv); ctx.closeTop(); settingsModal(); } }));
  b.append(h('div', { class: 'row' }, h('span', { text: 'Graphics quality' })), chips,
    h('p', { class: 'muted small', text: `Active: ${names[state.tier] || state.tier}${state.quality === 'auto' ? ' (auto: picked from your GPU, lowers itself if the frame rate drops)' : ''}. Ultra = HDR lighting, cascaded soft shadows, ambient occlusion, bloom, sunset god rays, anti-aliasing, dense swaying grass. Phones default to Medium/Low.` }),
    h('label', { class: 'row' }, h('span', { text: 'Depth of field (Ultra/High, costs FPS)' }), (() => { const c = h('input', { type: 'checkbox' }); c.checked = !!(gfx && gfx.dof); c.onchange = () => gfx.setDof(c.checked); return c; })()),
    h('div', { class: 'row' }, h('span', { text: 'Sign out on this device' }), h('button', { class: 'btn', text: 'Forget my profile key', onclick: () => { if (confirm('This removes your saved profile key from this browser. You will not be able to get this profile back without it. Continue?')) { localStorage.removeItem('vwfest-sg'); location.reload(); } } })), h('p', { class: 'muted small', text: 'Your profile key is stored only in this browser. The server keeps just a hash.' }), h('p', { class: 'small muted', text: `Server: ${SERVER}${state.gpu ? ` · GPU: ${state.gpu}` : ''}` }));
  modal('Settings', b);
}
boot();
