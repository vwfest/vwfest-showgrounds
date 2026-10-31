'use strict';
// Fiat on-ramps (card / Apple Pay / Google Pay -> SOL in the PLAYER'S OWN wallet). The provider takes the payment and does KYC; we never
// touch card data or funds. After the SOL lands the normal pay flow (quote -> swap -> burn) runs. Each provider is enabled only when its env keys exist.
//   MoonPay : MOONPAY_API_KEY (publishable pk_) + MOONPAY_SECRET_KEY (signs the widget URL) [+ MOONPAY_ENV=live]
//   Coinbase: CDP_API_KEY_ID + CDP_API_KEY_SECRET  (server mints a single-use Onramp session URL)
//   Stripe  : STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY (Crypto Onramp, needs Stripe approval; returns a client_secret for StripeOnramp.mount)
const crypto = require('crypto');
const C = require('./config');
const b64u = (b) => Buffer.from(b).toString('base64url');

function moonpayUrl(c, { address, usd, ref, redirect }) {
  const base = c.live ? 'https://buy.moonpay.com' : 'https://buy-sandbox.moonpay.com';
  const p = new URLSearchParams({ apiKey: c.apiKey, currencyCode: 'sol', walletAddress: address, baseCurrencyCode: 'usd', baseCurrencyAmount: String(usd), lockAmount: 'true', externalTransactionId: ref, colorCode: '#ff2fd0' });
  if (redirect) p.set('redirectURL', redirect);
  const q = '?' + p.toString(); const sig = crypto.createHmac('sha256', c.secret).update(q).digest('base64');
  return `${base}${q}&signature=${encodeURIComponent(sig)}`;
}
function cdpJwt(c, method, host, path, now = Math.floor(Date.now() / 1000)) {
  const secret = (c.secret || '').replace(/\\n/g, '\n'); const ed = !secret.includes('BEGIN');
  const header = { alg: ed ? 'EdDSA' : 'ES256', kid: c.keyId, nonce: crypto.randomBytes(16).toString('hex'), typ: 'JWT' };
  const payload = { sub: c.keyId, iss: 'cdp', nbf: now, exp: now + 120, uris: [`${method} ${host}${path}`] };
  const data = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`; let sig;
  if (ed) { const raw = Buffer.from(secret, 'base64'); const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' }); sig = crypto.sign(null, Buffer.from(data), key); }
  else sig = crypto.sign('sha256', Buffer.from(data), { key: secret, dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64u(sig)}`;
}
async function coinbaseUrl(c, { address, usd, ip, redirect, ref }, f = fetch) {
  const host = 'api.cdp.coinbase.com', path = '/platform/v2/onramp/sessions';
  const body = { destinationAddress: address, destinationNetwork: 'solana', purchaseCurrency: 'SOL', paymentAmount: usd.toFixed(2), paymentCurrency: 'USD', partnerUserRef: ref, ...(redirect ? { redirectUrl: redirect } : {}), ...(ip ? { clientIp: ip } : {}) };
  const r = await f(`https://${host}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cdpJwt(c, 'POST', host, path) }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => ({})); const url = j.session && (j.session.onrampUrl || j.session.url);
  if (!r.ok || !url) throw new Error('coinbase: ' + (j.errorMessage || r.status)); return url;
}
async function stripeSession(c, { address, usd }, f = fetch) {
  const body = new URLSearchParams({ 'wallet_addresses[solana]': address, 'destination_networks[]': 'solana', destination_currency: 'sol', source_currency: 'usd', source_amount: usd.toFixed(2) });
  const r = await f('https://api.stripe.com/v1/crypto/onramp_sessions', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(c.secret + ':').toString('base64'), 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.client_secret) throw new Error('stripe: ' + ((j.error && j.error.message) || r.status));
  return j.client_secret;
}

function providers(cfg, env = process.env) {
  const o = cfg.onramp; const out = [];
  if (!cfg.features.onramp) return out;
  if (o.moonpay) out.push({ id: 'moonpay', name: 'MoonPay', how: 'Card, Apple Pay, Google Pay or bank (MoonPay verifies your ID)', mode: 'url' });
  if (o.coinbase) out.push({ id: 'coinbase', name: 'Coinbase', how: 'Coinbase account, debit card or Apple Pay where available', mode: 'url' });
  if (o.stripe && env.STRIPE_PUBLISHABLE_KEY) out.push({ id: 'stripe', name: 'Stripe', how: 'Card, Apple Pay, Google Pay or bank', mode: 'stripe', publishableKey: env.STRIPE_PUBLISHABLE_KEY });
  return out;
}
// Amount: usd (clamped 1..500) is what the player intends to spend; callers add a ~8% cushion for provider fees.
async function createSession(cfg, id, { address, usd, ip, redirect, ref }, { fetchImpl = fetch, env = process.env } = {}) {
  if (!C.isKey(address)) throw new Error('bad address');
  if (!providers(cfg, env).some((p) => p.id === id)) throw new Error('provider not enabled');
  usd = Math.round(usd * 100) / 100; if (!(usd >= 1 && usd <= 500)) throw new Error('bad amount');
  ref = ref || crypto.randomBytes(8).toString('hex'); if (redirect && !/^https:\/\//.test(redirect)) redirect = undefined;
  if (id === 'moonpay') return { provider: id, url: moonpayUrl(cfg.onramp.moonpay, { address, usd, ref, redirect }), usd, ref };
  if (id === 'coinbase') return { provider: id, url: await coinbaseUrl(cfg.onramp.coinbase, { address, usd, ip, redirect, ref }, fetchImpl), usd, ref };
  return { provider: id, clientSecret: await stripeSession(cfg.onramp.stripe, { address, usd }, fetchImpl), publishableKey: env.STRIPE_PUBLISHABLE_KEY, usd, ref };
}
module.exports = { providers, createSession, moonpayUrl, cdpJwt, coinbaseUrl, stripeSession };
