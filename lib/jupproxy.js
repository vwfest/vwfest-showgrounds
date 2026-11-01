// Browser -> Jupiter goes THROUGH the server (quote + swap-instructions only): the JUPITER_API_KEY stays on the server, every browser shares ONE limiter + cache (the free tier is 1 req/s for
// the whole organisation), and the endpoint is not an open proxy: allow-listed paths, validated parameters, output mint pinned to $VWFEST, allowed browser origins only.
// The browser still audits whatever comes back before it signs (src/txaudit.mjs), so this proxy adds no trust.
'use strict';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; const NUM = /^\d{1,20}$/;
const QUOTE_KEYS = new Set(['inputMint', 'outputMint', 'amount', 'swapMode', 'slippageBps', 'onlyDirectRoutes', 'restrictIntermediateTokens', 'maxAccounts']);
function cleanQuote(query, vwMint) {
  const out = new URLSearchParams(); for (const k of Object.keys(query)) { if (!QUOTE_KEYS.has(k) || typeof query[k] !== 'string') return null; }
  const q = query; if (!B58.test(q.inputMint || '') || q.outputMint !== vwMint || !NUM.test(q.amount || '') || q.inputMint === q.outputMint) return null;
  if (q.swapMode !== undefined && !['ExactIn', 'ExactOut'].includes(q.swapMode)) return null; if (q.slippageBps !== undefined && !(NUM.test(q.slippageBps) && +q.slippageBps <= 500)) return null;
  for (const k of ['onlyDirectRoutes', 'restrictIntermediateTokens']) if (q[k] !== undefined && !['true', 'false'].includes(q[k])) return null; if (q.maxAccounts !== undefined && !(NUM.test(q.maxAccounts) && +q.maxAccounts <= 64)) return null;
  for (const k of ['inputMint', 'outputMint', 'amount', 'swapMode', 'slippageBps', 'onlyDirectRoutes', 'restrictIntermediateTokens', 'maxAccounts']) if (q[k] !== undefined) out.set(k, q[k]); return out;
}
// quoteResponse must be a quote for $VWFEST (never a swap to somewhere else); everything else is rebuilt from an allow-list
function cleanSwap(body, vwMint) {
  if (!body || typeof body !== 'object' || !body.quoteResponse || typeof body.quoteResponse !== 'object' || !B58.test(body.userPublicKey || '')) return null; const qr = body.quoteResponse;
  if (qr.outputMint !== vwMint || !B58.test(qr.inputMint || '') || !NUM.test(String(qr.inAmount || '')) || !NUM.test(String(qr.outAmount || '')) || !Array.isArray(qr.routePlan) || qr.routePlan.length > 12) return null;
  return { quoteResponse: qr, userPublicKey: body.userPublicKey, wrapAndUnwrapSol: body.wrapAndUnwrapSol !== false, dynamicComputeUnitLimit: body.dynamicComputeUnitLimit !== false };
}
function mount(app, { jup, vwMint, origins, rateLimit, express }) {
  const lim = (n) => rateLimit({ windowMs: 60e3, limit: n, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });
  const gate = (req, res, next) => { res.set('Cache-Control', 'no-store'); const o = req.get('origin'); if (!o || !origins.has(o)) return res.status(403).json({ error: 'forbidden' }); next(); };
  const fail = (res, e) => { if (e && e.status === 429) res.set('Retry-After', '2'); res.status(e && (e.busy || e.status === 429) ? 503 : 502).json({ error: 'swap service unavailable, try again in a moment' }); };
  app.get('/api/jup/quote', lim(30), gate, async (req, res) => { const p = cleanQuote(req.query, vwMint); if (!p) return res.status(400).json({ error: 'bad request' }); try { res.json(await jup.get(`${jup.swap}/quote?${p}`)); } catch (e) { fail(res, e); } });
  app.post('/api/jup/swap-instructions', lim(20), gate, express.json({ limit: '24kb' }), async (req, res) => { const b = cleanSwap(req.body, vwMint); if (!b) return res.status(400).json({ error: 'bad request' }); try { res.json(await jup.post(`${jup.swap}/swap-instructions`, b)); } catch (e) { fail(res, e); } });
}
module.exports = { mount, cleanQuote, cleanSwap };
