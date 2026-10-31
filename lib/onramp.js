// Fiat on-ramp helpers (server side). The ON-RAMP PROVIDER sells SOL straight to the player's OWN wallet address; this server never receives or
// holds money or keys. We only (a) sign/create the provider's checkout link with our secret API key and (b) hand the URL to the browser.
// Providers are optional and enabled by env vars (see README). Nothing here is reachable unless the matching keys are set.
const crypto = require('crypto');
const b64u = (b) => Buffer.from(b).toString('base64url');
const isKey = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

// ---- MoonPay: unsigned params + HMAC-SHA256 signature of the query string (https://dev.moonpay.com/docs/on-ramp-enhance-security-using-signed-urls) ----
function moonpayUrl(env, { address, usd, ref, redirect }) {
  const sandbox = env.MOONPAY_ENV !== 'live'; const base = sandbox ? 'https://buy-sandbox.moonpay.com' : 'https://buy.moonpay.com';
  const p = new URLSearchParams({ apiKey: env.MOONPAY_API_KEY, currencyCode: 'sol', walletAddress: address, baseCurrencyCode: 'usd', baseCurrencyAmount: String(usd), lockAmount: 'true', externalTransactionId: ref, colorCode: '#ff2fd0' });
  if (redirect) p.set('redirectURL', redirect);
  const q = '?' + p.toString(); const sig = crypto.createHmac('sha256', env.MOONPAY_SECRET_KEY).update(q).digest('base64');
  return `${base}${q}&signature=${encodeURIComponent(sig)}`;
}

// ---- Coinbase (CDP) Onramp: server creates a single-use session URL, authenticated with a short-lived JWT from the CDP API key ----
function cdpJwt(env, method, host, path) {
  const kid = env.CDP_API_KEY_ID, secret = (env.CDP_API_KEY_SECRET || '').replace(/\\n/g, '\n'); const now = Math.floor(Date.now() / 1000);
  const payload = { sub: kid, iss: 'cdp', nbf: now, exp: now + 120, uris: [`${method} ${host}${path}`] };
  const ed = !secret.includes('BEGIN'); const header = { alg: ed ? 'EdDSA' : 'ES256', kid, nonce: crypto.randomBytes(16).toString('hex'), typ: 'JWT' };
  const data = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`; let sig;
  if (ed) { const raw = Buffer.from(secret, 'base64'); const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), raw.subarray(0, 32)]), format: 'der', type: 'pkcs8' }); sig = crypto.sign(null, Buffer.from(data), key); }
  else sig = crypto.sign('sha256', Buffer.from(data), { key: secret, dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64u(sig)}`;
}
async function coinbaseUrl(env, { address, usd, ip, redirect }, fetchImpl = fetch) {
  const host = 'api.cdp.coinbase.com', path = '/platform/v2/onramp/sessions';
  const body = { destinationAddress: address, destinationNetwork: 'solana', purchaseCurrency: 'SOL', paymentAmount: usd.toFixed(2), paymentCurrency: 'USD', ...(redirect ? { redirectUrl: redirect } : {}), ...(ip ? { clientIp: ip } : {}) };
  const r = await fetchImpl(`https://${host}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cdpJwt(env, 'POST', host, path) }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  const j = await r.json().catch(() => ({})); const url = j.session && (j.session.onrampUrl || j.session.url) || j.onrampUrl || j.url;
  if (!r.ok || !url) throw new Error('coinbase: ' + (j.errorMessage || r.status)); return url;
}
// ---- Any other provider with a plain link: ONRAMP_URL_TEMPLATE="https://provider.example/buy?wallet={address}&amount={usd}&ref={ref}" (https only) ----
function templateUrl(env, { address, usd, ref }) {
  const u = (env.ONRAMP_URL_TEMPLATE || '').replace('{address}', encodeURIComponent(address)).replace('{usd}', encodeURIComponent(String(usd))).replace('{ref}', encodeURIComponent(ref));
  if (!/^https:\/\//.test(u)) throw new Error('bad template'); return u;
}

function providers(env = process.env) {
  const out = [];
  if (env.MOONPAY_API_KEY && env.MOONPAY_SECRET_KEY) out.push({ id: 'moonpay', name: 'MoonPay', how: 'Card · Apple Pay · Google Pay · bank (MoonPay checks your ID)' });
  if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) out.push({ id: 'coinbase', name: 'Coinbase', how: 'Coinbase account, debit card or Apple Pay where available' });
  if (/^https:\/\//.test(env.ONRAMP_URL_TEMPLATE || '')) out.push({ id: 'custom', name: env.ONRAMP_URL_NAME || 'Card on-ramp', how: 'Card or bank, opens the provider in a new tab' });
  return out;
}
async function session(id, args, env = process.env, fetchImpl = fetch) {
  if (!isKey(args.address)) throw new Error('bad address'); if (!providers(env).some((p) => p.id === id)) throw new Error('provider not enabled');
  const usd = Math.round(args.usd * 100) / 100; if (!(usd >= 1 && usd <= 500)) throw new Error('bad amount'); const a = { ...args, usd, ref: args.ref || crypto.randomBytes(8).toString('hex') };
  if (id === 'moonpay') return moonpayUrl(env, a); if (id === 'coinbase') return coinbaseUrl(env, a, fetchImpl); return templateUrl(env, a);
}
module.exports = { providers, session, moonpayUrl, cdpJwt, coinbaseUrl, templateUrl, isKey };
