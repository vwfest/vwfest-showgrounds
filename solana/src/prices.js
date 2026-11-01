'use strict';
// Live USD pricing with fallbacks and a slippage/sanity guard.
//  SOL/USD:  Jupiter price v3 -> Coinbase -> Kraken (first sane answer wins, cached 15 s, stale up to 2 min).
//  VWFEST/USD (mainnet): the EXECUTABLE rate from a Jupiter quote (SOL -> $VWFEST), cross-checked against Jupiter's price API.
//  If the two disagree by more than MAX_DEVIATION the quote is refused (price manipulation / thin-liquidity guard).
const { WSOL } = require('./config'); const { JupClient } = require('./jupclient');
const MAX_DEVIATION = 0.25;

async function getJson(url, { headers, fetchImpl = fetch, timeout = 6000 } = {}) {
  let last;
  for (let i = 0; i < 3; i++) { // free API tiers rate-limit (429): back off briefly and retry
    const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeout) });
    if (r.ok) return r.json();
    last = new Error('http ' + r.status + ' from ' + new URL(url).host); if (r.status !== 429 && r.status < 500) break;
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  throw last;
}

class Prices {
  constructor(cfg, fetchImpl = fetch) { this.cfg = cfg; this.f = fetchImpl; this.jup = JupClient.for(cfg, fetchImpl); // ONE gateway for every Jupiter call (key header, pacing, cache)
    this.sol = { usd: 0, at: 0, src: '' }; this.vw = { usd: 0, at: 0, src: '' }; }
  async solUsd() {
    if (this.cfg.fixedSolUsd) return { usd: this.cfg.fixedSolUsd, at: Date.now(), src: 'fixed' };
    if (Date.now() - this.sol.at < 30000 && this.sol.usd) return this.sol;
    const srcs = [
      ['jupiter', async () => (await this.jup.get(`${this.jup.price}?ids=${WSOL}`))[WSOL].usdPrice],
      ['coinbase', async () => +(await getJson('https://api.coinbase.com/v2/prices/SOL-USD/spot', { fetchImpl: this.f })).data.amount],
      ['kraken', async () => +(await getJson('https://api.kraken.com/0/public/Ticker?pair=SOLUSD', { fetchImpl: this.f })).result.SOLUSD.c[0]],
    ];
    for (const [src, fn] of srcs) { try { const v = +(await fn()); if (v > 1 && v < 10000) return (this.sol = { usd: v, at: Date.now(), src }); } catch {} }
    if (this.sol.usd && Date.now() - this.sol.at < 120000) return { ...this.sol, stale: true };
    throw new Error('SOL price unavailable');
  }
  // Jupiter ExactIn quote helper (any input mint -> $VWFEST).
  async jupQuote({ inputMint, outputMint, amount, swapMode = 'ExactIn', extra = '' }) {
    const u = `${this.jup.swap}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&swapMode=${swapMode}&slippageBps=${this.cfg.slippageBps}&restrictIntermediateTokens=true${extra}`;
    return this.jup.get(u);
  }
  // USD per 1 whole $VWFEST token.
  async vwfestUsd() {
    if (!this.cfg.mainnet) return { usd: 1 / this.cfg.devnetTokensPerUsd, at: Date.now(), src: 'devnet-fixed' };
    if (Date.now() - this.vw.at < 30000 && this.vw.usd) return this.vw;
    const sol = await this.solUsd(); const dec = 10 ** this.cfg.decimals; const probe = 100000000n; // 0.1 SOL
    let fromQuote = 0, fromApi = 0;
    try { const q = await this.jupQuote({ inputMint: WSOL, outputMint: this.cfg.vwfestMint, amount: probe.toString() }); fromQuote = (Number(probe) / 1e9 * sol.usd) / (Number(q.outAmount) / dec); } catch {}
    try { const j = await this.jup.get(`${this.jup.price}?ids=${this.cfg.vwfestMint}`); fromApi = +j[this.cfg.vwfestMint].usdPrice; } catch {}
    if (!(fromQuote > 0) && !(fromApi > 0)) { if (this.vw.usd && Date.now() - this.vw.at < 120000) return { ...this.vw, stale: true }; throw new Error('$VWFEST price unavailable'); }
    if (fromQuote > 0 && fromApi > 0 && Math.abs(fromQuote - fromApi) / Math.min(fromQuote, fromApi) > MAX_DEVIATION) throw new Error('$VWFEST price sources disagree; try again shortly');
    // Prefer the executable rate; when both exist take the HIGHER price (fewer tokens burned per USD would shortchange the buyback -> take the lower price, i.e. more tokens).
    const usd = fromQuote > 0 && fromApi > 0 ? Math.min(fromQuote, fromApi) : (fromQuote || fromApi);
    return (this.vw = { usd, at: Date.now(), src: fromQuote > 0 && fromApi > 0 ? 'jupiter-quote+price' : fromQuote > 0 ? 'jupiter-quote' : 'jupiter-price', quoteUsd: fromQuote || null, apiUsd: fromApi || null });
  }
  // USD per whole unit of an arbitrary SPL token (Jupiter price v3).
  async tokenUsd(mint) {
    const j = await this.jup.get(`${this.jup.price}?ids=${mint}`);
    const v = j[mint] && +j[mint].usdPrice; if (!(v > 0)) throw new Error('token price unavailable'); return v;
  }
}
module.exports = { Prices, getJson, MAX_DEVIATION };
