'use strict';
// Wallet sign-in: server nonce (TTL 5 min, single use) + ed25519 signMessage verification (Sign-In-With-Solana style text).
// Works for Phantom, any wallet-standard wallet (solana:signMessage) and embedded wallets (Web3Auth/Privy) alike.
// The session is a stateless HMAC-signed token (SERVER_SECRET), bound to the wallet.
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { PublicKey } = require('@solana/web3.js');
const C = require('./config');

const NONCE_TTL = 5 * 60 * 1000, SESSION_TTL = 12 * 3600 * 1000, MAX_PENDING = 5000, MAX_PER_WALLET = 5;
const b64u = (b) => Buffer.from(b).toString('base64url');

class Auth {
  constructor({ store, secret, allowedDomains = [], app = 'VW FEST SHOW GROUNDS', now = Date.now }) {
    if (!secret || secret.length < 32) throw new Error('Auth requires SERVER_SECRET (>= 32 chars)');
    this.store = store; this.secret = secret; this.domains = new Set(allowedDomains); this.app = app; this.now = now;
  }
  message({ domain, wallet, nonce, iat, exp }) {
    return `${domain} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to ${this.app}. This is free: it does not send a transaction and cannot move funds.\n\nNonce: ${nonce}\nIssued At: ${new Date(iat).toISOString()}\nExpiration Time: ${new Date(exp).toISOString()}`;
  }
  challenge({ wallet, domain }) {
    if (!C.isKey(wallet)) throw new Error('bad wallet');
    if (this.domains.size && !this.domains.has(domain)) throw new Error('domain not allowed');
    const t = this.now(); const ns = 'nonce';
    for (const [k, v] of this.store.entries(ns)) if (v.exp < t) this.store.delete(ns, k);
    if (this.store.size(ns) >= MAX_PENDING) throw new Error('busy');
    const mine = this.store.entries(ns).filter(([, v]) => v.wallet === wallet); if (mine.length >= MAX_PER_WALLET) this.store.delete(ns, mine[0][0]);
    const nonce = crypto.randomBytes(16).toString('hex'); const iat = t, exp = t + NONCE_TTL;
    const message = this.message({ domain, wallet, nonce, iat, exp });
    this.store.set(ns, nonce, { wallet, message, exp });
    return { nonce, message, expiresAt: exp };
  }
  // signature: base64 or Uint8Array of the 64-byte ed25519 signature over utf8(message).
  verify({ wallet, nonce, signature }) {
    // Single use: take the nonce out of the store BEFORE any other work, whatever the outcome.
    const rec = this.store.get('nonce', nonce); if (!rec) return { ok: false, why: 'Unknown or already-used challenge' };
    this.store.delete('nonce', nonce);
    if (rec.exp < this.now()) return { ok: false, why: 'Challenge expired' };
    if (rec.wallet !== wallet) return { ok: false, why: 'Wallet mismatch' };
    let sig; try { sig = typeof signature === 'string' ? Buffer.from(signature, 'base64') : Buffer.from(signature); } catch { return { ok: false, why: 'Bad signature' }; }
    if (sig.length !== 64) return { ok: false, why: 'Bad signature' };
    let ok = false; try { ok = nacl.sign.detached.verify(Buffer.from(rec.message, 'utf8'), sig, new PublicKey(wallet).toBytes()); } catch {}
    if (!ok) return { ok: false, why: 'Signature check failed' };
    return { ok: true, wallet, token: this.issue(wallet) };
  }
  issue(wallet) { const body = b64u(JSON.stringify({ w: wallet, exp: this.now() + SESSION_TTL, n: crypto.randomBytes(6).toString('hex') })); return body + '.' + this.mac(body); }
  mac(body) { return crypto.createHmac('sha256', this.secret).update('session:' + body).digest('base64url'); }
  session(token) {
    if (typeof token !== 'string' || token.length > 400) return null; const [body, mac] = token.split('.'); if (!body || !mac) return null;
    const want = Buffer.from(this.mac(body)), got = Buffer.from(mac); if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    try { const s = JSON.parse(Buffer.from(body, 'base64url').toString()); return s.exp > this.now() && C.isKey(s.w) ? { wallet: s.w, exp: s.exp } : null; } catch { return null; }
  }
}
module.exports = { Auth };
