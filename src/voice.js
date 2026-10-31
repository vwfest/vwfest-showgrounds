// Proximity voice chat: WebRTC audio peer-to-peer (server only relays signaling, only between nearby players), spatialised with Web Audio.
// Everything is opt-in: nothing connects until the player turns Voice on, and the microphone is never requested until they press "Enable microphone".
const MAX_PEERS = 8, HYST = 4;
const PREFS_KEY = 'sg-voice-prefs';
export class Voice {
  constructor(net, cfg) {
    this.net = net; this.range = cfg.voiceRange || 15; this.ice = cfg.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];
    this.on = false; this.micStream = null; this.mode = 'ptt'; this.pttHeld = false; this.ctx = null; this.peers = new Map(); this.deaf = false; this.speaking = false; this.level = 0; this.onChange = () => {}; this.err = '';
    try { this.prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { this.prefs = {}; }
  }
  pref(key) { return this.prefs[key] || (this.prefs[key] = { vol: 1, mute: false, block: false }); }
  savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch {} }
  isBlocked(key) { return !!(this.prefs[key] && this.prefs[key].block); }
  audioCtx() { if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); } if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
  start() { this.on = true; this.audioCtx(); this.onChange(); }
  stop() { this.on = false; for (const id of [...this.peers.keys()]) this.drop(id, true); this.disableMic(); this.onChange(); }
  async enableMic() {
    this.err = '';
    try {
      this.start(); const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.micStream = s; const track = s.getAudioTracks()[0]; track.enabled = false; const ctx = this.audioCtx(); const src = ctx.createMediaStreamSource(s); this.an = ctx.createAnalyser(); this.an.fftSize = 512; src.connect(this.an); this.buf = new Uint8Array(this.an.fftSize);
      for (const p of this.peers.values()) p.sender && p.sender.replaceTrack(track).catch(() => {});
    } catch (e) { this.err = e && e.name === 'NotAllowedError' ? 'Microphone permission was denied in your browser.' : 'No microphone available.'; }
    this.onChange();
  }
  disableMic() { if (this.micStream) { this.micStream.getTracks().forEach((t) => t.stop()); this.micStream = null; this.an = null; for (const p of this.peers.values()) p.sender && p.sender.replaceTrack(null).catch(() => {}); } this.speaking = false; }
  setMode(m) { this.mode = m; this.onChange(); }
  ptt(v) { this.pttHeld = v; }
  // called every frame: update talking state, send gating, spatial params
  tick(listener, players) {
    const track = this.micStream && this.micStream.getAudioTracks()[0];
    if (this.an) { this.an.getByteTimeDomainData(this.buf); let s = 0; for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; s += v * v; } this.level = Math.sqrt(s / this.buf.length); }
    const want = !!track && !this.deaf && (this.mode === 'ptt' ? this.pttHeld : this.mode === 'open' ? true : false);
    const gate = this.mode === 'open' ? this.level > 0.02 : true; const talking = want && gate;
    if (track) track.enabled = want; if (talking !== this.speaking) { this.speaking = talking; this.onChange(); }
    const L = this.ctx && this.ctx.listener; if (L && listener) { const f = [Math.sin(listener.yaw), 0, Math.cos(listener.yaw)]; if (L.positionX) { L.positionX.value = listener.x; L.positionY.value = 1.6; L.positionZ.value = listener.z; L.forwardX.value = f[0]; L.forwardZ.value = f[2]; L.forwardY.value = 0; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } }
    for (const [id, p] of this.peers) { const o = players.get(id); if (!o || !p.gain) continue; const d = Math.hypot(o.x - listener.x, o.z - listener.z); const pr = this.pref(o.key); const att = Math.max(0, 1 - d / this.range); p.gain.gain.value = this.deaf || pr.mute || pr.block ? 0 : Math.pow(att, 1.4) * pr.vol * 1.6; if (p.pan.positionX) { p.pan.positionX.value = o.x; p.pan.positionY.value = 1.6; p.pan.positionZ.value = o.z; } p.dist = d; }
  }
  // choose nearest peers (cap 8) within range, hysteresis on drop
  manage(self, players) {
    if (!this.on) return; const cand = [];
    for (const [id, o] of players) { const pr = this.pref(o.key); if (pr.block) continue; const d = Math.hypot(o.x - self.x, o.z - self.z); cand.push([d, id]); }
    cand.sort((a, b) => a[0] - b[0]); const want = new Set(cand.filter(([d], i) => d <= this.range && i < MAX_PEERS).map(([, id]) => id));
    for (const [id, p] of this.peers) { const o = players.get(id); const d = o ? Math.hypot(o.x - self.x, o.z - self.z) : 1e9; if (!o || d > this.range + HYST || (this.pref(o.key).block)) this.drop(id, false); }
    for (const id of want) if (!this.peers.has(id) && this.peers.size < MAX_PEERS && self.id < id) this.connect(id, true); // lower id initiates; the other side answers
  }
  mk(id) {
    const pc = new RTCPeerConnection({ iceServers: this.net.ice || this.ice }); const p = { pc, id, queue: [], remoteSet: false, gain: null, pan: null, sender: null, dist: 0, born: Date.now() }; this.peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate) this.net.json({ t: 'rtc', to: id, k: 'ice', d: e.candidate.toJSON() }); };
    pc.ontrack = (e) => { const ctx = this.audioCtx(); const stream = e.streams[0] || new MediaStream([e.track]); const a = new Audio(); a.srcObject = stream; a.muted = true; a.play().catch(() => {}); p.audio = a; const src = ctx.createMediaStreamSource(stream); const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'linear'; pan.refDistance = 1; pan.maxDistance = 1000; pan.rolloffFactor = 0; const g = ctx.createGain(); g.gain.value = 0; src.connect(pan); pan.connect(g); g.connect(ctx.destination); p.pan = pan; p.gain = g; p.src = src; this.onChange(); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(id, false); else if (pc.connectionState === 'disconnected') setTimeout(() => { if (pc.connectionState === 'disconnected') this.drop(id, false); }, 5000); this.onChange(); };
    const tr = pc.addTransceiver('audio', { direction: 'sendrecv' }); p.sender = tr.sender; const track = this.micStream && this.micStream.getAudioTracks()[0]; if (track) tr.sender.replaceTrack(track).catch(() => {});
    return p;
  }
  async connect(id) { const p = this.mk(id); try { const off = await p.pc.createOffer(); await p.pc.setLocalDescription(off); this.net.json({ t: 'rtc', to: id, k: 'offer', d: { type: off.type, sdp: off.sdp } }); } catch { this.drop(id, false); } }
  async onSignal(m, players, self) {
    const id = m.from; if (!this.on) return;
    if (m.k === 'bye') return this.drop(id, true);
    let p = this.peers.get(id);
    try {
      if (m.k === 'offer') {
        const o = players.get(id); if (!o || this.pref(o.key).block || this.peers.size >= MAX_PEERS) return; if (Math.hypot(o.x - self.x, o.z - self.z) > this.range + 8) return;
        if (p) this.drop(id, true); p = this.mk(id); await p.pc.setRemoteDescription(m.d); p.remoteSet = true; for (const c of p.queue) await p.pc.addIceCandidate(c).catch(() => {}); p.queue = [];
        const ans = await p.pc.createAnswer(); await p.pc.setLocalDescription(ans); this.net.json({ t: 'rtc', to: id, k: 'answer', d: { type: ans.type, sdp: ans.sdp } });
      } else if (m.k === 'answer' && p) { await p.pc.setRemoteDescription(m.d); p.remoteSet = true; for (const c of p.queue) await p.pc.addIceCandidate(c).catch(() => {}); p.queue = []; }
      else if (m.k === 'ice' && p) { if (p.remoteSet) await p.pc.addIceCandidate(m.d).catch(() => {}); else p.queue.push(m.d); }
    } catch { this.drop(id, true); }
  }
  drop(id, quiet) {
    const p = this.peers.get(id); if (!p) return; this.peers.delete(id);
    if (!quiet) this.net.json({ t: 'rtc', to: id, k: 'bye', d: 1 });
    try { p.pc.close(); } catch {} try { p.src && p.src.disconnect(); p.pan && p.pan.disconnect(); p.gain && p.gain.disconnect(); } catch {} if (p.audio) { p.audio.srcObject = null; } this.onChange();
  }
  connected() { return [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected').length; }
}
