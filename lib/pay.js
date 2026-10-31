// Pricing + quotes for every on-chain purchase (avatar mint, shop items, mystery rides). The browser builds the transaction (non-custodial:
// the player's wallet signs, no project wallet ever holds funds); the server only quotes and later verifies the confirmed transaction.
const crypto = require('crypto');
const SOL = 'So11111111111111111111111111111111111111112';
const ceilDiv = (a, b) => (a + b - 1n) / b;

class Pay {
  constructor(c) { this.c = c; this.quotes = new Map(); this.price = { usd: 0, at: 0, src: '' }; }
  async getJson(url) { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000); try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('http ' + r.status); return await r.json(); } finally { clearTimeout(t); } }
  async solUsd() {
    if (this.c.fixedSolUsd) return { usd: this.c.fixedSolUsd, at: Date.now(), src: 'fixed' };
    if (Date.now() - this.price.at < 15000 && this.price.usd) return this.price;
    const src = [
      ['jupiter', async () => (await this.getJson('https://lite-api.jup.ag/price/v3?ids=' + SOL))[SOL].usdPrice],
      ['coinbase', async () => +(await this.getJson('https://api.coinbase.com/v2/prices/SOL-USD/spot')).data.amount],
      ['kraken', async () => +(await this.getJson('https://api.kraken.com/0/public/Ticker?pair=SOLUSD')).result.SOLUSD.c[0]],
    ];
    for (const [name, f] of src) { try { const v = +(await f()); if (v > 1 && v < 5000) return (this.price = { usd: v, at: Date.now(), src: name }); } catch {} }
    if (this.price.usd && Date.now() - this.price.at < 120000) return this.price;
    throw new Error('SOL price unavailable');
  }
  lamportsFor(usd, solUsd) { return BigInt(Math.max(1, Math.ceil((usd / solUsd) * 1e9))); }
  // Expected $VWFEST output for a SOL input (Jupiter ExactIn quote, direct route only to keep the tx small).
  async vwfestOut(lamports) {
    const u = `${this.c.jupiter}/quote?inputMint=${SOL}&outputMint=${this.c.mint}&amount=${lamports}&slippageBps=${this.c.slippageBps}&onlyDirectRoutes=true&restrictIntermediateTokens=true`;
    const q = await this.getJson(u); return { out: BigInt(q.outAmount), min: BigInt(q.otherAmountThreshold) };
  }
  // kind: avatar | shop | ride. Returns plain numbers/strings for the client and for later verification.
  async compute({ usd, method, devWalletOk, devPct, discountPct }) {
    const solUsd = (await this.solUsd()).usd, dec = 10 ** this.c.decimals;
    const dev = method === 'sol' ? devPct : 0;
    const q = { usd, method, solUsd, discountPct: method === 'vwfest' ? discountPct : 0, devPct: dev, swap: false, totalLamports: '0', swapLamports: '0', devLamports: '0', burnRaw: '0', burnMin: '0', devWallet: dev > 0 && devWalletOk ? this.c.devWallet : null };
    if (method === 'vwfest') {
      const paidUsd = usd * (1 - discountPct / 100); q.paidUsd = Math.round(paidUsd * 100) / 100;
      if (this.c.network === 'mainnet-beta') { const { out } = await this.vwfestOut(this.lamportsFor(paidUsd, solUsd)); q.burnRaw = out.toString(); }
      else q.burnRaw = BigInt(Math.round(paidUsd * this.c.devnetTokensPerUsd * dec)).toString();
      q.burnMin = (BigInt(q.burnRaw) * 98n / 100n).toString(); q.paidUsd ??= paidUsd;
    } else {
      const total = this.lamportsFor(usd, solUsd); const devL = dev > 0 ? total * BigInt(Math.round(dev * 100)) / 10000n : 0n; const swapL = total - devL;
      q.paidUsd = usd; q.totalLamports = total.toString(); q.devLamports = devL.toString(); q.swapLamports = swapL.toString();
      if (this.c.network === 'mainnet-beta') { q.swap = true; const { out } = await this.vwfestOut(swapL); q.burnRaw = out.toString(); }
      else q.burnRaw = BigInt(Math.round(usd * (1 - dev / 100) * this.c.devnetTokensPerUsd * dec)).toString();
      q.burnMin = (BigInt(q.burnRaw) * 97n / 100n).toString();
    }
    q.burnUi = Number(BigInt(q.burnRaw)) / dec; q.devMin = q.devLamports === '0' ? '0' : (BigInt(q.devLamports) * 99n / 100n).toString();
    return q;
  }
  create(rec) {
    for (const [id, x] of this.quotes) if (x.expires < Date.now() - 600000) this.quotes.delete(id);
    const mine = [...this.quotes.values()].filter((x) => x.pid === rec.pid && !x.used && x.expires > Date.now()); if (mine.length >= 4) this.quotes.delete(mine[0].id);
    const id = 'q' + crypto.randomBytes(7).toString('hex'); const full = { ...rec, id, expires: Date.now() + 10 * 60000, used: false }; this.quotes.set(id, full); return full;
  }
}
module.exports = { Pay, SOL };
