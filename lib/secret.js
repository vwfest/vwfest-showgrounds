// Single source of the server secret. In production SERVER_SECRET is REQUIRED (>= 32 chars): a random per-boot value would silently break
// pending ride reveals and session tokens on every restart.
const crypto = require('crypto');
const PROD = process.env.NODE_ENV === 'production';
let s = process.env.SERVER_SECRET;
if (PROD && (!s || s.length < 32)) { console.error('FATAL: SERVER_SECRET (>= 32 chars) is required when NODE_ENV=production. Set it in the Render dashboard (render.yaml uses generateValue).'); process.exit(1); }
if (s && s.length < 32) console.warn('[secret] SERVER_SECRET is shorter than 32 chars: use a long random value (dev only; production refuses to start)');
if (!s) { console.warn('[secret] SERVER_SECRET not set: using a random one (dev only; restarts invalidate pending ride reveals and tokens)'); s = crypto.randomBytes(32).toString('hex'); }
module.exports = s;
