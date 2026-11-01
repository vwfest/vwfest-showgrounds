'use strict';
// Entry point: require('./solana')
//  * Facade for INTERFACES.md §1 (init/config/quote/solUsd/verifyPurchase/burns/auth/onramp/mountRoutes/__test)
//  * Native, richer API: { Solana, createRouter, ... } (quote -> pay -> verified mint with Metaplex Core collections), see README.
const native = require('./src/index'); const { createRouter } = require('./src/routes'); const { Facade, inspect } = require('./src/compat');
const F = new Facade();
const need = () => { if (!F.ready) throw new Error('chain.init() has not been called'); };
module.exports = {
  ...native, createRouter, Facade, inspectPurchaseTx: inspect,
  init: (o) => F.init(o), config: () => (need(), F.config()), quote: (o) => (need(), F.quote(o)), solUsd: () => (need(), F.solUsd()), verifyPurchase: (o) => (need(), F.verifyPurchase(o)), ledgerRec: (sig) => (need(), F.ledgerRec(sig)),
  flush: () => (F.ready && F.store ? F.store.flush() : Promise.resolve()),
  get degraded() { return F.ready && F.degraded; }, get durable() { return F.ready && !!F.store && F.store.durable; },
  get burns() { need(); return F.burnsApi; }, get auth() { need(); return F.authApi; }, get onramp() { need(); return F.onrampApi; },
  // Mounts the read-only compat routes + the native router. (No transaction-sending / RPC-proxy route exists in this module.)
  mountRoutes(app, { express = require('express'), rateLimit = require('express-rate-limit'), allowedOrigins = [], solana = null } = {}) {
    need(); app.get('/api/burns', (req, res) => res.set('Cache-Control', 'public, max-age=5').json({ ok: true, ...F.burnsApi.stats(), codes: undefined }));
    app.get('/api/mint/config', (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, ...F.config() }));
    app.get('/api/mint/price', async (req, res) => { try { res.set('Cache-Control', 'no-store').json({ ok: true, usd: await F.solUsd() }); } catch { res.status(503).json({ ok: false, error: 'Price unavailable' }); } });
    if (solana) app.use('/api/solana', createRouter({ solana, express, rateLimit, allowedOrigins }));
  },
  __test: { fakeVerify() { F.fake = !F.cfg.mainnet; return F.fake; }, facade: F },
};
