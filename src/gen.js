// Browser-side deterministic avatar generator for offline preview ONLY (the server is the source of truth for real profiles).
import { FIELDS, MAX, DEFAULT } from '../shared/traits.js';
export function generate(seed, quiz) { let h = 2166136261; for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } const r = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  const a = {}; for (const k of FIELDS) a[k] = Math.floor(r() * MAX[k]); Object.assign(a, quiz); if (a.carColor2 === a.carColor) a.carColor2 = 16; if (r() < 0.5) a.carColor2 = 16; return a; }
