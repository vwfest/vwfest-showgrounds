// Solana wallet ownership proof: server nonce + TTL, the wallet signs a human-readable message (signMessage, costs nothing, never a transaction),
// the server verifies the ed25519 signature. Used for wallet-bound actions (purchases); nickname play keeps using the bearer profile secret.
const crypto = require('crypto');
const { b58decode, isKey } = require('./burns');
const SPKI = Buffer.from('302a300506032b6570032100', 'hex'); // ed25519 SubjectPublicKeyInfo prefix
const TTL = 5 * 60e3;
// Each purpose has its own wording, and a nonce issued for one purpose can never be verified for another (a purchase proof is not a profile recovery).
const PURPOSE = { prove: 'Prove you own this wallet.', recover: 'Recover my Show Grounds profile on this device. Only sign this on the Show Grounds site.' };
exports.TTL_RECOVER = 3 * 60e3;
const pending = new Map(); // nonce -> { pk, exp, pid }
function sweep() { const now = Date.now(); for (const [k, v] of pending) if (v.exp < now) pending.delete(k); }
exports.challenge = (pubkey, pid, origin = '', chain = '', purpose = 'prove') => {
  if (!PURPOSE[purpose]) return null;
  if (!isKey(pubkey)) return null; if (pending.size > 5000) sweep(); if (pending.size > 8000) return null;
  const nonce = crypto.randomBytes(16).toString('hex'), exp = Date.now() + (purpose === 'recover' ? exports.TTL_RECOVER : TTL);
  const dom = String(origin || '').replace(/[^\x21-\x7e]/g, '').slice(0, 100); // the site that asked: the wallet shows it, the server re-checks it, and the client refuses a message for another site
  const message = `VW FEST SHOW GROUNDS\n${PURPOSE[purpose]} This is not a transaction and costs nothing.\nDomain: ${dom}\nNetwork: ${chain}\nWallet: ${pubkey}\nNonce: ${nonce}\nExpires: ${new Date(exp).toISOString()}`;
  pending.set(nonce, { pk: pubkey, exp, pid, message, origin: dom, purpose }); return { nonce, message, exp };
};
// signature: base64 or Uint8Array-like array. Returns true once; the nonce is burned either way.
exports.verify = ({ nonce, pubkey, signature, pid, origin = '', purpose = 'prove' }) => {
  const c = typeof nonce === 'string' ? pending.get(nonce) : null; if (c) pending.delete(nonce);
  if (!c || c.purpose !== purpose || c.exp < Date.now() || c.pk !== pubkey || (c.pid && pid && c.pid !== pid) || c.origin !== String(origin || '').replace(/[^\x21-\x7e]/g, '').slice(0, 100)) return false;
  let sig; try { sig = Array.isArray(signature) ? Buffer.from(signature) : Buffer.from(String(signature), 'base64'); } catch { return false; } if (sig.length !== 64) return false;
  try { const pk = Buffer.from(b58decode(pubkey)); if (pk.length !== 32) return false; return crypto.verify(null, Buffer.from(c.message), { key: crypto.createPublicKey({ key: Buffer.concat([SPKI, pk]), format: 'der', type: 'spki' }), }, sig); } catch { return false; }
};
