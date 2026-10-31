'use strict';
// Pricing policy + quote breakdown. Pure maths here (breakdown), store/IO in create().
//   method 'vwfest': pay usd * (1 - discount) worth of $VWFEST (when the kind allows a discount); ALL of it is burned; no dev fee.
//   method 'sol' / 'spl': pay full USD. devPct of it goes to DEV_WALLET (SOL transfer, or the same SPL token), the rest is swapped
//                         to $VWFEST through Jupiter and burned. kinds with devFee=false (mint fees if MINT_DEV_FEE=0) burn 100%.
const crypto = require('crypto');
const C = require('./config');
const ceilDiv = (a, b) => (a + b - 1n) / b;
const toRaw = (usd, usdPerUnit, dec) => BigInt(Math.max(1, Math.ceil((usd / usdPerUnit) * 10 ** dec - 1e-9)));
const round2 = (n) => Math.round(n * 100) / 100;

function kindPolicy(cfg, kind, usdOverride) {
  const k = cfg.kinds[kind]; if (!k) throw new Error('unknown purchase kind');
  let usd = k.usd;
  if (kind === 'shop') { usd = round2(+usdOverride); if (!(usd > 0 && usd <= cfg.maxShopUsd)) throw new Error('bad shop price'); }
  if (!(usd > 0)) throw new Error('bad price');
  return { ...k, usd };
}

// prices: { solUsd, vwfestUsd, tokenUsd? } ; returns the plain-number breakdown shown to the user and used for verification.
function breakdown(cfg, { kind, usd: usdIn, method, payToken, prices }) {
  const k = kindPolicy(cfg, kind, usdIn); const dec = 10 ** cfg.decimals;
  const discountPct = method === 'vwfest' && k.discount ? cfg.discountPct : 0;
  const devPct = method !== 'vwfest' && k.devFee ? cfg.devFeePct : 0;
  const b = { kind, method, usd: k.usd, discountPct, devPct, solUsd: prices.solUsd, vwfestUsd: prices.vwfestUsd, devWallet: devPct > 0 ? cfg.devWallet : null,
    swap: false, swapInputMint: null, swapInRaw: '0', devLamports: '0', devTokenRaw: '0', devTokenMint: null, burnRaw: '0', burnMin: '0', payToken: null };
  if (method === 'vwfest') {
    b.paidUsd = round2(k.usd * (1 - discountPct / 100));
    b.burnRaw = toRaw(k.usd * (1 - discountPct / 100), prices.vwfestUsd, cfg.decimals).toString();
    b.burnMin = b.burnRaw; // exact: nothing swaps, the tx burns precisely this
  } else {
    const devUsd = k.usd * devPct / 100, burnUsd = k.usd - devUsd; b.paidUsd = k.usd;
    const burnTarget = toRaw(burnUsd, prices.vwfestUsd, cfg.decimals); // expected $VWFEST for the swap (mainnet: replaced by the Jupiter quote)
    b.burnRaw = burnTarget.toString();
    if (method === 'sol') {
      b.swapInputMint = C.WSOL; b.swapInRaw = toRaw(burnUsd, prices.solUsd, 9).toString();
      if (devPct > 0) b.devLamports = toRaw(devUsd, prices.solUsd, 9).toString();
    } else {
      if (!payToken) throw new Error('payToken required');
      b.payToken = { mint: payToken.mint, sym: payToken.sym, dec: payToken.dec }; b.swapInputMint = payToken.mint;
      b.swapInRaw = toRaw(burnUsd, prices.tokenUsd, payToken.dec).toString();
      if (devPct > 0) { b.devTokenRaw = toRaw(devUsd, prices.tokenUsd, payToken.dec).toString(); b.devTokenMint = payToken.mint; }
      b.tokenUsd = prices.tokenUsd;
    }
    b.swap = cfg.mainnet; // test networks have no $VWFEST liquidity: the player burns test tokens they hold
    b.burnMin = (BigInt(b.burnRaw) * 97n / 100n).toString(); // refined with the real Jupiter quote in finalize()
  }
  b.burnUi = Number(BigInt(b.burnRaw)) / dec; b.devSol = Number(b.devLamports) / 1e9;
  return b;
}
// The 4 numbers every receipt checks: burnMin, devLamports(*0.99), devTokenRaw(*0.99). 1% tolerance covers rounding only; the tx amounts are set by the server.
const devMinLamports = (b) => (BigInt(b.devLamports) * 99n / 100n);
const devMinToken = (b) => (BigInt(b.devTokenRaw) * 99n / 100n);

class Quotes {
  constructor({ cfg, store, prices, roller, rideSeedOf }) { this.cfg = cfg; this.store = store; this.prices = prices; this.roller = roller; this.rideSeedOf = rideSeedOf; }
  async compute({ kind, usd, method, payTokenMint }) {
    const cfg = this.cfg; const k = kindPolicy(cfg, kind, usd);
    if (!['vwfest', 'sol', 'spl'].includes(method)) throw new Error('bad payment method');
    if (method === 'sol' && !cfg.features.payWithSol) throw new Error('SOL payments are off');
    let payToken = null;
    if (method === 'spl') {
      if (!cfg.features.payWithSpl) throw new Error('Token payments are off');
      if (!cfg.mainnet) throw new Error('Paying with other tokens needs mainnet liquidity (test networks have none).');
      payToken = cfg.payTokens.find((t) => t.mint === payTokenMint); if (!payToken) throw new Error('That token is not accepted');
    }
    const [sol, vw] = await Promise.all([this.prices.solUsd(), this.prices.vwfestUsd()]);
    const tokenUsd = method === 'spl' ? await this.prices.tokenUsd(payToken.mint) : 0;
    return { b: breakdown(cfg, { kind, usd: k.usd, method, payToken, prices: { solUsd: sol.usd, vwfestUsd: vw.usd, tokenUsd } }), sources: { sol: sol.src, vwfest: vw.src } };
  }
  // opts: { wallet, kind, method, usd?, payTokenMint?, ref?, nft?: {fingerprint, traits, name?, image?} }
  async create(opts) {
    const { wallet } = opts; if (!C.isKey(wallet)) throw new Error('bad wallet');
    const { b, sources } = await this.compute(opts);
    if (b.swap) { // mainnet: replace the price-derived estimate with the executable Jupiter quote and set the slippage guard
      const jq = await this.prices.jupQuote({ inputMint: b.swapInputMint, outputMint: this.cfg.vwfestMint, amount: b.swapInRaw, extra: '&maxAccounts=40' });
      if (!jq || !jq.outAmount) throw new Error('No swap route available right now');
      b.burnRaw = String(jq.outAmount); b.burnMin = (BigInt(jq.otherAmountThreshold) * 99n / 100n).toString(); b.burnUi = Number(BigInt(b.burnRaw)) / 10 ** this.cfg.decimals; b.priceImpactPct = Number(jq.priceImpactPct || 0);
      if (b.priceImpactPct > 0.05) throw new Error('Price impact too high right now. Try later.');
    }
    const id = 'q' + crypto.randomBytes(8).toString('hex'); const now = Date.now();
    const q = { id, wallet, ref: opts.ref ? String(opts.ref).slice(0, 64) : null, ...b, sources, state: 'open', created: now, expires: now + this.cfg.quoteTtlMs, network: this.cfg.network, nft: opts.nft || null };
    if (this.cfg.kinds[opts.kind].nft === 'ride') q.commit = this.rideSeedOf(id).commit;
    return q;
  }
  view(q) { // public, never contains seeds or internal fields
    const { nft, ...rest } = q; const out = { ...rest }; delete out.seed; out.nft = nft ? { fingerprint: nft.fingerprint || null, name: nft.name || null } : null;
    out.memo = memoFor(q); out.explorer = undefined; return out;
  }
}
const memoFor = (q) => 'vwfest:' + q.id + (q.commit ? ':' + q.commit : '');
module.exports = { breakdown, kindPolicy, Quotes, memoFor, devMinLamports, devMinToken, toRaw };
