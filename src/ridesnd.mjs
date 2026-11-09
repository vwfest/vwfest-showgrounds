// Local horn + engine on their own AudioContext. Proximity voice is not imported and its gain is not changed.
// Browsers start the context suspended; unlock() must run inside a click, tap, or key.

export const HORN = { freq: 392, freq2: 494, gain: 0.34, seconds: 0.45 };

// throttle is signed (-1..1). Speed is m/s. Pitch and loudness both rise with throttle and with speed.
export function engineTone(driving, throttle, speed) {
  if (!driving) return { freq: 40, gain: 0 };
  const thr = Math.min(1, Math.abs(+throttle || 0));
  const spd = Math.min(1, Math.abs(+speed || 0) / 17);
  const rev = Math.min(1, thr * 0.75 + spd * 0.55);
  return { freq: 42 + rev * 96, gain: 0.05 + rev * 0.16 };
}

export function peakLevel(samples) {
  let m = 0;
  for (let i = 0; i < samples.length; i++) { const d = Math.abs(samples[i] - 128); if (d > m) m = d; }
  return m / 128;
}

export class RideSound {
  constructor(AC) { this.AC = AC || globalThis.AudioContext || globalThis.webkitAudioContext; this.ac = null; }
  unlock() {
    if (!this.AC) return false;
    if (!this.ac) {
      const ac = this.ac = new this.AC();
      this.master = ac.createGain(); this.master.gain.value = 1; this.master.connect(ac.destination);
      this.analyser = ac.createAnalyser(); this.analyser.fftSize = 1024; this.master.connect(this.analyser);
      this.eng = ac.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 42;
      this.engGain = ac.createGain(); this.engGain.gain.value = 0;
      this.eng.connect(this.engGain); this.engGain.connect(this.master); this.eng.start();
      this.buf = new Uint8Array(this.analyser.fftSize);
    }
    if (this.ac.state === 'suspended') this.ac.resume();
    return this.ac.state !== 'closed';
  }
  setHeard(on) { if (this.master) this.master.gain.value = on ? 1 : 0; }
  setDrive(driving, throttle, speed) {
    if (!this.eng) return;
    const t = engineTone(driving, throttle, speed); const now = this.ac.currentTime;
    this.eng.frequency.setTargetAtTime(t.freq, now, 0.06);
    this.engGain.gain.setTargetAtTime(t.gain, now, 0.06);
    this.tone = t;
  }
  honk() {
    if (!this.ac && !this.unlock()) return;
    const ac = this.ac; const g = ac.createGain(); g.gain.value = HORN.gain; g.connect(this.master);
    const keep = [g];
    for (const f of [HORN.freq, HORN.freq2]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(g); o.start(); keep.push(o); }
    this._horn = keep; // keep the nodes alive, and use the same sawtooth path the engine already drives
    setTimeout(() => { try { g.gain.value = 0; for (const o of keep) { if (o.stop) o.stop(); } } catch {} if (this._horn === keep) this._horn = null; }, HORN.seconds * 1000);
  }
  level() { if (!this.analyser) return 0; this.analyser.getByteTimeDomainData(this.buf); return peakLevel(this.buf); }
  live() { return { state: this.ac ? this.ac.state : 'closed', freq: this.eng ? this.eng.frequency.value : 0, gain: this.engGain ? this.engGain.gain.value : 0, tone: this.tone || null }; }
}
