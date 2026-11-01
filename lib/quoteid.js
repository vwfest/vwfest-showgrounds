// Signed, self-describing quote ids. The id is the memo of the burn transaction ("vwfest:<id>"), so a purchase can be re-verified from the chain alone:
// it carries what the server needs to check the burn (kind, item, plot, avatar code, minimum burn, minimum creator fee, paying method, expiry; the owner profile is bound by the HMAC, not written into the id)
// and an HMAC over all of it (SERVER_SECRET), so nobody can mint or edit one. The server keeps NO state that a credit depends on: a restart, an evicted quote or
// a buy that arrives after expiry still finds its quote. Expiry only decides whether a NEW payment may start (quote creation + the client's pre-sign check).
// The wallet is not in the id (it is unknown when the quote is made): it is bound at buy time by the proven-wallet requirement and checked as the burner on chain.
'use strict';
const crypto = require('crypto');
const KINDS = ['avatar', 'shop', 'ride', 'vendor'];
const MAC_LEN = 8; // 64-bit truncated HMAC-SHA256 (forgery needs 2^64 online guesses against a rate-limited oracle that must then ALSO match a real burn)
const wv = (n) => { let v = BigInt(n); const o = []; do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; o.push(b); } while (v); return Buffer.from(o); };
const rv = (b, st) => { let r = 0n, s = 0n; for (;;) { if (st.o >= b.length || s > 70n) throw new Error('bad quote'); const x = b[st.o++]; r |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) return r; s += 7n; } };
const ws = (s) => { const x = Buffer.from(String(s || ''), 'utf8'); if (x.length > 60) throw new Error('field too long'); return Buffer.concat([Buffer.from([x.length]), x]); };
const rs = (b, st) => { const n = b[st.o++]; if (n === undefined || st.o + n > b.length) throw new Error('bad quote'); const x = b.toString('utf8', st.o, st.o + n); st.o += n; return x; };
// The owner (pid) is NOT written into the id (every byte of it is memo bytes in the transaction): it is covered by the HMAC instead, so verify() needs the pid of the player who presents the id,
// and an id presented by anybody else simply does not verify.
const mac = (secret, body, pid) => crypto.createHmac('sha256', secret).update('sg-quote-v2\0').update(String(pid || '')).update('\0').update(body).digest().subarray(0, MAC_LEN);
// p: { kind, method:'sol'|'vwfest', pid, item?, plot?, code?, burnMin, devMin, expires (ms), nonce? (5 random bytes) }
function sign(secret, p) {
  const k = KINDS.indexOf(p.kind); if (k < 0) throw new Error('bad kind'); const exp = Math.floor(p.expires / 1000); const nonce = p.nonce || crypto.randomBytes(5);
  const head = Buffer.alloc(6); head[0] = 1; head[1] = (k << 1) | (p.method === 'sol' ? 1 : 0); head.writeUInt32BE(exp, 2);
  const body = Buffer.concat([head, nonce, wv(p.burnMin), wv(p.devMin || 0), ws(p.item), Buffer.from([Number(p.plot) || 0]), ws(p.code)]);
  return 'q' + Buffer.concat([body, mac(secret, body, p.pid)]).toString('base64url');
}
// -> the quote fields, or null when the id is malformed or the signature is wrong
function verify(secret, id, pid) {
  try {
    if (typeof id !== 'string' || id[0] !== 'q' || id.length > 200 || !/^q[A-Za-z0-9_-]+$/.test(id)) return null; const raw = Buffer.from(id.slice(1), 'base64url'); if (raw.length < 12 + MAC_LEN) return null;
    const body = raw.subarray(0, raw.length - MAC_LEN); if (typeof pid !== 'string' || !pid || !crypto.timingSafeEqual(raw.subarray(raw.length - MAC_LEN), mac(secret, body, pid)) || body[0] !== 1) return null;
    const k = KINDS[body[1] >> 1]; if (!k) return null; const st = { o: 11 };
    const burnMin = rv(body, st), devMin = rv(body, st), item = rs(body, st), plot = body[st.o++], code = rs(body, st); if (st.o !== body.length) return null;
    return { id, kind: k, method: body[1] & 1 ? 'sol' : 'vwfest', expires: body.readUInt32BE(2) * 1000, burnMin: burnMin.toString(), devMin: devMin.toString(), pid, item: item || null, plot: plot || undefined, code: code || undefined };
  } catch { return null; }
}
module.exports = { sign, verify, KINDS };
