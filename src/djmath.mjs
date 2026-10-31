// Pure helpers for the DJ booth (unit-tested in test/djmath.cjs): distance falloff, server-clock playhead, μ-law voice codec, resampling.
export const EARS = { x: 0, z: -80 };               // where the speakers are (centre of the stage apron)
// Loudest at the stage, fading with distance, but never silent anywhere on the grounds (floor 15%).
export function gainAt(d) { return 0.15 + 0.85 / (1 + (d / 28) ** 2); }
// Where in the track everyone should be right now, from the server's clock.
export function playhead(serverNow, startedAt, dur) { const s = (serverNow - startedAt) / 1000; return s <= 0 ? 0 : Math.min(s, Math.max(0, dur - 0.05)); }
export const MIC_RATE = 16000;
export function mulawEncode(f32) { // float [-1,1] -> G.711 μ-law bytes
  const out = new Uint8Array(f32.length);
  for (let i = 0; i < f32.length; i++) { let s = Math.max(-1, Math.min(1, f32[i])) * 32767 | 0; const sign = s < 0 ? 0x80 : 0; if (s < 0) s = -s; if (s > 32635) s = 32635; s += 0x84; let e = 7; for (let m = 0x4000; (s & m) === 0 && e > 0; e--, m >>= 1); out[i] = ~(sign | (e << 4) | ((s >> (e + 3)) & 0x0f)) & 0xff; }
  return out;
}
export function mulawDecode(u8) {
  const out = new Float32Array(u8.length);
  for (let i = 0; i < u8.length; i++) { const u = ~u8[i] & 0xff; const sign = u & 0x80, e = (u >> 4) & 7, m = u & 0x0f; let s = ((m << 3) + 0x84) << e; s -= 0x84; out[i] = (sign ? -s : s) / 32768; }
  return out;
}
export function downsample(f32, inRate, outRate) { // box-filter resample (voice only)
  if (inRate === outRate) return f32; const r = inRate / outRate; const n = Math.floor(f32.length / r); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r)); let s = 0; for (let k = a; k < b && k < f32.length; k++) s += f32[k]; out[i] = s / (b - a); }
  return out;
}
// Spectrum (Uint8 0..255 bins) -> n bar heights 0..1 with a log-ish spread and a little gain; also overall level.
export function bars(spec, n) {
  const out = new Float32Array(n); const len = spec.length; let tot = 0;
  for (let i = 0; i < n; i++) { const a = Math.floor(Math.pow(i / n, 1.7) * len * 0.8), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * len * 0.8)); let s = 0; for (let k = a; k < b; k++) s += spec[k]; out[i] = Math.min(1, (s / (b - a) / 255) * 1.35); tot += out[i]; }
  return { bars: out, level: tot / n };
}
