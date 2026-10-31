// Single source of the server secret. In production SERVER_SECRET is REQUIRED (>= 16 chars): a random per-boot value would silently break
// pending ride reveals and session tokens on every restart.
const crypto = require('crypto');
const PROD = process.env.NODE_ENV === 'production';
let s = process.env.SERVER_SECRET;
if (PROD && (!s || s.length < 16)) { console.error('FATAL: SERVER_SECRET (>= 16 chars) is required when NODE_ENV=production. Set it in the Render dashboard (render.yaml uses generateValue).'); process.exit(1); }
if (!s) { console.warn('[secret] SERVER_SECRET not set: using a random one (dev only; restarts invalidate pending ride reveals and tokens)'); s = crypto.randomBytes(32).toString('hex'); }
module.exports = s;
