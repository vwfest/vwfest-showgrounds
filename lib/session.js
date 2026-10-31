// Tiny HMAC-signed, expiring tokens (no dependencies). payload is JSON, so keep it small.
const crypto = require('crypto');
const SECRET = require('./secret');
const b64 = (b) => Buffer.from(b).toString('base64url');
const mac = (body) => crypto.createHmac('sha256', SECRET).update('sess:' + body).digest('base64url');
exports.sign = (payload, ttlMs) => { const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })); return body + '.' + mac(body); };
exports.verify = (tok, kind) => {
  if (typeof tok !== 'string' || tok.length > 600) return null; const [body, sig] = tok.split('.'); if (!body || !sig) return null;
  const want = mac(body); const a = Buffer.from(sig), b = Buffer.from(want); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; } if (!p || p.exp < Date.now() || (kind && p.k !== kind)) return null; return p;
};
