'use strict';
// Express router. Mount:  app.use('/api/solana', createRouter({ solana, express, rateLimit, allowedOrigins: [...] }))
// refOf(req) -> host's own profile id for the quote (from the host's session, never from the request body).
// There is deliberately NO route that sends/relays a transaction: the player's wallet signs and the player's own RPC broadcasts.
const C = require('./config');
const safe = (res, fn) => fn().catch((e) => { const m = String(e && e.message || e).slice(0, 200); res.status(/unavailable|rpc|fetch|timeout/i.test(m) ? 503 : 400).json({ ok: false, error: m }); });

function createRouter({ solana, express, rateLimit, allowedOrigins = [], refOf } = {}) {
  const r = express.Router(); const origins = new Set(allowedOrigins);
  const lim = (n, ms = 60000) => rateLimit({ windowMs: ms, limit: n, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: 'Too many requests' } });
  const sameOrigin = (req, res, next) => { const o = req.get('origin'); if (!o || !origins.has(o)) return res.status(403).json({ ok: false, error: 'forbidden origin' }); next(); }; // POSTs only
  const authed = (req, res, next) => { const m = /^Bearer (.+)$/.exec(req.get('authorization') || ''); const s = m && solana.session(m[1]); if (!s) return res.status(401).json({ ok: false, error: 'Sign in with your wallet first' }); req.wallet = s.wallet; next(); };
  const cors = (req, res, next) => { const o = req.get('origin'); if (o && origins.has(o)) { res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type,authorization', 'Access-Control-Max-Age': '600' }); } if (req.method === 'OPTIONS') return res.status(204).end(); next(); };
  r.use(cors, lim(240));
  const json = (kb) => express.json({ limit: kb + 'kb' });
  const nostore = (res) => res.set('Cache-Control', 'no-store');

  r.get('/config', (req, res) => nostore(res).json({ ok: true, ...solana.publicConfig() }));
  r.get('/odds', (req, res) => res.set('Cache-Control', 'public, max-age=60').json({ ok: true, ...solana.odds() }));
  r.get('/burns', (req, res) => res.set('Cache-Control', 'public, max-age=5').json({ ok: true, ...solana.burnTracker(Math.min(+req.query.limit || 15, 50)) }));
  r.get('/price', (req, res) => safe(res, async () => { const [s, v] = await Promise.all([solana.prices.solUsd(), solana.prices.vwfestUsd()]); nostore(res).json({ ok: true, solUsd: s.usd, vwfestUsd: v.usd, sources: { sol: s.src, vwfest: v.src } }); }));
  // NFT metadata hosting (server storage driver). Immutable per id; served as inert data.
  const id = /^[a-z0-9]{6,64}$/i;
  r.get('/nft/meta/:id.json', (req, res) => { const m = id.test(req.params.id) && solana.nftMeta(req.params.id); if (!m) return res.status(404).json({ ok: false }); res.set({ 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }).json(m); });
  r.get('/nft/img/:id.svg', (req, res) => { const s = id.test(req.params.id) && solana.nftImg(req.params.id); if (!s) return res.status(404).end(); res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }).send(s); });
  r.get('/nft/collection/:kind.json', (req, res) => { const m = solana.collectionMeta(req.params.kind); if (!m) return res.status(404).json({ ok: false }); res.set('Cache-Control', 'public, max-age=300').json(m); });
  r.get('/nft/collection/:kind.svg', (req, res) => { const c = solana.cfg.collections[req.params.kind]; if (!c) return res.status(404).end(); const t = c.name.replace(/[<>&]/g, ''); res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#1d1035"/><text x="200" y="190" font-size="30" text-anchor="middle" fill="#ff2fd0" font-family="sans-serif" font-weight="700">VWFEST</text><text x="200" y="235" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">${t}</text></svg>`); });

  r.post('/auth/challenge', sameOrigin, lim(20), json(1), (req, res) => safe(res, async () => { const o = new URL(req.get('origin')); nostore(res).json({ ok: true, ...solana.challenge(String(req.body.wallet || ''), o.host) }); }));
  r.post('/auth/verify', sameOrigin, lim(20), json(2), (req, res) => { const b = req.body || {}; const v = solana.signIn({ wallet: String(b.wallet || ''), nonce: String(b.nonce || ''), signature: String(b.signature || '') }); nostore(res).status(v.ok ? 200 : 401).json(v.ok ? { ok: true, wallet: v.wallet, token: v.token } : { ok: false, error: v.why }); });

  r.post('/quote', sameOrigin, authed, lim(30), json(170), (req, res) => safe(res, async () => {
    const b = req.body || {}; const o = { wallet: req.wallet, kind: String(b.kind), method: String(b.method), payTokenMint: b.payTokenMint ? String(b.payTokenMint) : undefined, ref: refOf ? refOf(req) : undefined, item: b.item ? String(b.item) : undefined, nft: b.nft };
    if (o.kind === 'shop' && !solana.shopPrice) throw new Error('Shop is not configured');
    nostore(res).json({ ok: true, quote: await solana.quote(o) });
  }));
  r.post('/tx/pay', sameOrigin, authed, lim(30), json(1), (req, res) => safe(res, async () => nostore(res).json(await solana.buildPay({ quoteId: String(req.body.quoteId || ''), wallet: req.wallet }))));
  r.post('/pay/confirm', sameOrigin, authed, lim(30), json(1), (req, res) => safe(res, async () => { const v = await solana.confirmPayment({ quoteId: String(req.body.quoteId || ''), signature: String(req.body.signature || ''), wallet: req.wallet, nick: req.body.nick }); nostore(res).status(v.ok ? 200 : 422).json(v); }));
  r.post('/tx/mint', sameOrigin, authed, lim(30), json(1), (req, res) => safe(res, async () => nostore(res).json(await solana.buildMint({ quoteId: String(req.body.quoteId || ''), wallet: req.wallet }))));
  r.post('/mint/confirm', sameOrigin, authed, lim(30), json(1), (req, res) => safe(res, async () => { const v = await solana.confirmMint({ quoteId: String(req.body.quoteId || ''), signature: String(req.body.signature || ''), wallet: req.wallet }); nostore(res).status(v.ok ? 200 : 422).json(v); }));
  r.get('/receipts', authed, (req, res) => nostore(res).json({ ok: true, receipts: solana.receiptsFor(req.wallet) }));
  r.get('/nfts', authed, lim(20), (req, res) => safe(res, async () => nostore(res).json({ ok: true, ...(await solana.listNfts(req.wallet)) })));
  r.post('/nft/use', sameOrigin, authed, lim(20), json(1), (req, res) => safe(res, async () => { const v = await solana.useNftAsAvatar({ wallet: req.wallet, asset: String(req.body.asset || '') }); nostore(res).status(v.ok ? 200 : 422).json(v); }));
  r.post('/onramp/session', sameOrigin, authed, lim(6), json(1), (req, res) => safe(res, async () => { const b = req.body || {}; const usd = b.purpose === 'vendor' ? Math.ceil(solana.cfg.kinds.vendor.usd * 1.08) : Math.ceil(solana.cfg.kinds.avatar.usd * 1.08 * 100) / 100; nostore(res).json({ ok: true, ...(await solana.onrampSession(String(b.provider), { wallet: req.wallet, usd: +b.usd > 0 ? Math.min(+b.usd, 500) : usd, ip: req.ip, redirect: req.get('origin') + '/' })) }); }));
  r.post('/devnet/faucet', sameOrigin, authed, lim(3), json(1), (req, res) => safe(res, async () => nostore(res).json(await solana.devnetFaucet(req.wallet))));
  return r;
}
module.exports = { createRouter };
