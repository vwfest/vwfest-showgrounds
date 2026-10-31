'use strict';
// Live USD pricing with fallbacks and a slippage/sanity guard.
//  SOL/USD:  Jupiter price v3 -> Coinbase -> Kraken (first sane answer wins, cached 15 s, stale up to 2 min).
//  VWFEST/USD (mainnet): the EXECUTABLE rate from a Jupiter quote (SOL -> $VWFEST), cross-checked against Jupiter's price API.
//  If the two disagree by more than MAX_DEVIATION the quote is refused (price manipulation / thin-liquidity guard).
const { WSOL } = require('./config');
const MAX_DEVIATION = 0.25;

async function getJson(url, { headers, fetchImpl = fetch, timeout = 6000 } = {}) {
  const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

class Prices {
  constructor(cfg, fetchImpl = fetch) { this.cfg = cfg; this.f = fetchImpl; this.sol = { usd: 0, at: 0, src: '' }; this.vw = { usd: 0, at: 0, src: '' }; }
  jhdr() { return this.cfg.jupiterApiKey ? { 'x-api-key': this.cfg.jupiterApiKey } : undefined; }
  async solUsd() {
    if (this.cfg.fixedSolUsd) return { usd: this.cfg.fixedSolUsd, at: Date.now(), src: 'fixed' };
    if (Date.now() - this.sol.at < 15000 && this.sol.usd) return this.sol;
    const o = { fetchImpl: this.f, headers: this.jhdr() };
    const srcs = [
      ['jupiter', async () => (await getJson(`${this.cfg.jupiterBase}/price/v3?ids=${WSOL}`, o))[WSOL].usdPrice],
      ['coinbase', async () => +(await getJson('https://api.coinbase.com/v2/prices/SOL-USD/spot', { fetchImpl: this.f })).data.amount],
      ['kraken', async () => +(await getJson('https://api.kraken.com/0/public/Ticker?pair=SOLUSD', { fetchImpl: this.f })).result.SOLUSD.c[0]],
    ];
    for (const [src, fn] of srcs) { try { const v = +(await fn()); if (v > 1 && v < 10000) return (this.sol = { usd: v, at: Date.now(), src }); } catch {} }
    if (this.sol.usd && Date.now() - this.sol.at < 120000) return { ...this.sol, stale: true };
    throw new Error('SOL price unavailable');
  }
  // Jupiter ExactIn quote helper (any input mint -> $VWFEST).
  async jupQuote({ inputMint, outputMint, amount, swapMode = 'ExactIn', extra = '' }) {
    const u = `${this.cfg.jupiterBase}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&swapMode=${swapMode}&slippageBps=${this.cfg.slippageBps}&restrictIntermediateTokens=true${extra}`;
    return getJson(u, { fetchImpl: this.f, headers: this.jhdr(), timeout: 8000 });
  }
  // USD per 1 whole $VWFEST token.
  async vwfestUsd() {
    if (!this.cfg.mainnet) return { usd: 1 / this.cfg.devnetTokensPerUsd, at: Date.now(), src: 'devnet-fixed' };
    if (Date.now() - this.vw.at < 10000 && this.vw.usd) return this.vw;
    const sol = await this.solUsd(); const dec = 10 ** this.cfg.decimals; const probe = 100000000n; // 0.1 SOL
    let fromQuote = 0, fromApi = 0;
    try { const q = await this.jupQuote({ inputMint: WSOL, outputMint: this.cfg.vwfestMint, amount: probe.toString() }); fromQuote = (Number(probe) / 1e9 * sol.usd) / (Number(q.outAmount) / dec); } catch {}
    try { const j = await getJson(`${this.cfg.jupiterBase}/price/v3?ids=${this.cfg.vwfestMint}`, { fetchImpl: this.f, headers: this.jhdr() }); fromApi = +j[this.cfg.vwfestMint].usdPrice; } catch {}
    if (!(fromQuote > 0) && !(fromApi > 0)) { if (this.vw.usd && Date.now() - this.vw.at < 120000) return { ...this.vw, stale: true }; throw new Error('$VWFEST price unavailable'); }
    if (fromQuote > 0 && fromApi > 0 && Math.abs(fromQuote - fromApi) / Math.min(fromQuote, fromApi) > MAX_DEVIATION) throw new Error('$VWFEST price sources disagree; try again shortly');
    // Prefer the executable rate; when both exist take the HIGHER price (fewer tokens burned per USD would shortchange the buyback -> take the lower price, i.e. more tokens).
    const usd = fromQuote > 0 && fromApi > 0 ? Math.min(fromQuote, fromApi) : (fromQuote || fromApi);
    return (this.vw = { usd, at: Date.now(), src: fromQuote > 0 && fromApi > 0 ? 'jupiter-quote+price' : fromQuote > 0 ? 'jupiter-quote' : 'jupiter-price', quoteUsd: fromQuote || null, apiUsd: fromApi || null });
  }
  // USD per whole unit of an arbitrary SPL token (Jupiter price v3).
  async tokenUsd(mint) {
    const j = await getJson(`${this.cfg.jupiterBase}/price/v3?ids=${mint}`, { fetchImpl: this.f, headers: this.jhdr() });
    const v = j[mint] && +j[mint].usdPrice; if (!(v > 0)) throw new Error('token price unavailable'); return v;
  }
}
module.exports = { Prices, getJson, MAX_DEVIATION };
