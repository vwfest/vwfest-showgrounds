// DJ client: plays the house playlist in sync with the server clock, fades with distance from the stage, lets each listener mute / set volume,
// feeds the stage lights with the spectrum, relays the DJ microphone (μ-law 16 kHz) and plays other DJs' voice over the music.
import { EARS, gainAt, playhead, mulawEncode, mulawDecode, downsample, bars, MIC_RATE } from './djmath.mjs';

export class DjClient {
  constructor(net, server) {
    this.net = net; this.server = server; this.st = null; this.off = 0; this.offN = 0; this.level = 0; this.bands = new Float32Array(24);
    this.vol = +(localStorage.getItem('sg.djvol') ?? 0.8); this.muted = localStorage.getItem('sg.djmute') === '1'; this.blocked = false; this.gain = 0;
    this.audio = null; this.ac = null; this.an = null; this.gn = null; this.spec = null; this.cur = ''; this.lastSync = 0; this.lastDraw = 0; this.talking = false;
    this.onChange = () => {}; this.voiceT = 0; this.micStream = null; this.micSeq = 0; this.playAt = 0;
  }
  serverNow() { return Date.now() + this.off; }
  get iAmDj() { return !!(this.st && this.st.dj && this.me && this.st.dj.id === this.me()); }
  onState(m) { // server -> {t:'dj', now, ...}
    const o = m.now - Date.now(); this.off = this.offN ? this.off * 0.6 + o * 0.4 : o; this.offN++; const prevTrack = this.st && this.st.track && this.st.track.at; this.st = m;
    if (!m.mic && this.voiceGain) this.voiceT = 0; if (prevTrack !== (m.track && m.track.at)) this.lastSync = 0; this.onChange();
  }
  unlock() { // call from a user gesture
    if (!this.ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; this.ac = new AC(); }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); this.ensureAudio(); if (this.blocked) this.sync(true);
  }
  ensureAudio() {
    if (this.audio || !this.ac) return; const a = new Audio(); a.preload = 'auto'; a.loop = false; this.audio = a; // same-origin file, so the analyser can read it
    const src = this.ac.createMediaElementSource(a); this.gn = this.ac.createGain(); this.an = this.ac.createAnalyser(); this.an.fftSize = 128; this.an.smoothingTimeConstant = 0.6; this.spec = new Uint8Array(this.an.frequencyBinCount);
    this.duck = this.ac.createGain(); src.connect(this.an); this.an.connect(this.gn); this.gn.connect(this.duck); this.duck.connect(this.ac.destination);
    this.voiceGain = this.ac.createGain(); this.voiceGain.connect(this.ac.destination);
  }
  url(file) { return new URL('assets/music/' + file, document.baseURI).href; }
  sync(force) { // jump to the server playhead if we drifted
    const a = this.audio, tr = this.st && this.st.track; if (!a || !tr) return; const want = playhead(this.serverNow(), tr.at, tr.dur);
    if (this.cur !== tr.file) { this.cur = tr.file; a.src = this.url(tr.file); a.load(); }
    if (this.muted || this.vol <= 0.001) { if (!a.paused) a.pause(); return; }
    if (a.readyState >= 1 && (force || Math.abs(a.currentTime - want) > 0.35)) { try { a.currentTime = want; } catch {} }
    if (a.paused && a.readyState >= 1) { const p = a.play(); if (p && p.catch) p.catch(() => { if (!this.blocked) { this.blocked = true; this.onChange(); } }); if (p && p.then) p.then(() => { if (this.blocked) { this.blocked = false; this.onChange(); } }); }
  }
  setVol(v) { this.vol = Math.max(0, Math.min(1, v)); localStorage.setItem('sg.djvol', this.vol); this.lastSync = 0; this.onChange(); }
  setMuted(m) { this.muted = !!m; localStorage.setItem('sg.djmute', m ? '1' : '0'); this.lastSync = 0; if (m && this.audio) this.audio.pause(); this.onChange(); }
  tick(dt, px, pz) { // every frame
    const now = performance.now(); const st = this.st; const live = st && st.on && st.track && st.dj;
    if (live && this.ac && this.audio) { if (now - this.lastSync > 1000) { this.lastSync = now; this.sync(false); } const d = Math.hypot(px - EARS.x, pz - EARS.z); const g = this.muted ? 0 : gainAt(d) * this.vol; this.gain += (g - this.gain) * Math.min(1, dt * 6); this.gn.gain.value = this.gain; }
    else if (this.audio && !this.audio.paused) this.audio.pause();
    if (this.duck) this.duck.gain.value += ((this.voiceT > 0 ? 0.35 : 1) - this.duck.gain.value) * Math.min(1, dt * 8);
    if (this.voiceT > 0) this.voiceT -= dt;
    let lv = 0, bd = null; if (live && this.an && this.audio && !this.audio.paused && this.gain > 0.01) { this.an.getByteFrequencyData(this.spec); const r = bars(this.spec, 24); lv = r.level * (0.6 + this.gain * 0.6); bd = r.bars; } else if (live && !this.ac) { lv = 0.15 + 0.1 * Math.sin(now / 300); }
    this.level = lv; this.bands = bd || this.bands; if (!bd) this.bands = this.bands.map((v) => v * 0.9);
    if (this.panel && now - this.lastDraw > 500) { this.lastDraw = now; this.panel(); }
  }
  // ---- DJ microphone ----
  async talk(on) {
    if (on === this.talking) return; if (on && !(this.st && this.st.dj && this.me && this.st.dj.id === this.me())) return; this.talking = on; this.net.json({ t: 'djmic', on });
    if (!on) { this.stopMic(); this.onChange(); return; }
    try { await this.startMic(); } catch (e) { this.talking = false; this.net.json({ t: 'djmic', on: false }); this.err = e && e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not open the microphone.'; }
    this.onChange();
  }
  async startMic() {
    this.unlock(); const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); if (!this.talking) { ms.getTracks().forEach((t) => t.stop()); return; }
    this.micStream = ms; const src = this.ac.createMediaStreamSource(ms); const sp = this.ac.createScriptProcessor(4096, 1, 1); const z = this.ac.createGain(); z.gain.value = 0; let buf = new Float32Array(0);
    sp.onaudioprocess = (e) => { if (!this.talking) return; const ds = downsample(e.inputBuffer.getChannelData(0), this.ac.sampleRate, MIC_RATE); const nb = new Float32Array(buf.length + ds.length); nb.set(buf); nb.set(ds, buf.length); buf = nb;
      while (buf.length >= 1600) { const u = mulawEncode(buf.subarray(0, 1600)); buf = buf.slice(1600); const pk = new Uint8Array(2 + u.length); pk[0] = 4; pk[1] = this.micSeq++ & 255; pk.set(u, 2); this.net.sendBin(pk); } };
    src.connect(sp); sp.connect(z); z.connect(this.ac.destination); this.micNodes = [src, sp, z];
  }
  stopMic() { if (this.micNodes) { for (const n of this.micNodes) { try { n.disconnect(); } catch {} } this.micNodes = null; } if (this.micStream) { this.micStream.getTracks().forEach((t) => t.stop()); this.micStream = null; } }
  onMicPacket(dv) { // [4][seq][μ-law...] from the DJ (relayed by the server)
    if (!this.ac || this.muted || !this.voiceGain) return; const u = new Uint8Array(dv.buffer, dv.byteOffset + 2, dv.byteLength - 2); const f = mulawDecode(u); const b = this.ac.createBuffer(1, f.length, MIC_RATE); b.copyToChannel(f, 0);
    const src = this.ac.createBufferSource(); src.buffer = b; this.voiceGain.gain.value = Math.min(1, this.vol * 1.3); src.connect(this.voiceGain); const t = this.ac.currentTime; if (this.playAt < t + 0.02 || this.playAt > t + 0.6) this.playAt = t + 0.12; src.start(this.playAt); this.playAt += b.duration; this.voiceT = 0.4;
  }
  // ---- actions ----
  claim() { this.unlock(); this.net.json({ t: 'djclaim' }); }
  leave() { this.net.json({ t: 'djleave' }); if (this.talking) this.talk(false); }
  skip() { this.net.json({ t: 'djskip' }); }
  pick(i) { this.net.json({ t: 'djpick', i }); }
  hype() { this.net.json({ t: 'djhype' }); }
}
