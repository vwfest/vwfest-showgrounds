// Pricing + quotes for every on-chain purchase (avatar mint, shop items, mystery rides). The browser builds the transaction (non-custodial:
// the player's wallet signs, no project wallet ever holds funds); the server only quotes and later verifies the confirmed transaction.
const crypto = require('crypto');
const quoteid = require('./quoteid');
const SOL = 'So11111111111111111111111111111111111111112';
const ceilDiv = (a, b) => (a + b - 1n) / b;

class Pay {
  constructor(c, secret) { this.c = c; this.jup = require('../solana/src/jupclient').JupClient.for({ jupiterBase: c.jupiterBase || c.jupiter, jupiterApiKey: c.jupiterApiKey || '', jupiterRps: c.jupiterRps }); this.secret = secret || require('./secret'); this.quotes = new Map(); this.active = new Map(); this.price = { usd: 0, at: 0, src: '' }; }
  async getJson(url) { if (url.startsWith(this.jup.root)) return this.jup.get(url); // every Jupiter call goes through the one gateway (key header, pacing, cache)
     const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000); try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('http ' + r.status); return await r.json(); } finally { clearTimeout(t); } }
  async solUsd() {
    if (this.c.fixedSolUsd) return { usd: this.c.fixedSolUsd, at: Date.now(), src: 'fixed' };
    if (Date.now() - this.price.at < 15000 && this.price.usd) return this.price;
    const src = [
      ['jupiter', async () => (await this.getJson(this.jup.price + '?ids=' + SOL))[SOL].usdPrice],
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
    const u = `${this.jup.swap}/quote?inputMint=${SOL}&outputMint=${this.c.mint}&amount=${lamports}&slippageBps=${this.c.slippageBps}&onlyDirectRoutes=true&restrictIntermediateTokens=true`;
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
  // A quote id is a signed, self-describing token (lib/quoteid.js): the server remembers nothing a credit depends on. `quotes` is only a cache of the open quotes
  // (so a click inside the cache window returns the SAME quote instead of asking Jupiter again, and a player holds at most ONE open quote per item).
  static keyOf(rec) { return [rec.pid, rec.kind, rec.item || '', rec.plot || '', rec.code || '', rec.method].join('|'); }
  reuse(rec, maxAgeMs = 30000) { const id = this.active.get(Pay.keyOf(rec)); const x = id && this.quotes.get(id); return x && !x.used && x.expires > Date.now() + 120000 && Date.now() - x.created < maxAgeMs ? x : null; }
  create(rec, ttlMs = 10 * 60000) {
    const now = Date.now(); for (const [id, x] of this.quotes) if (x.expires < now - 600000) { this.quotes.delete(id); if (this.active.get(Pay.keyOf(x)) === id) this.active.delete(Pay.keyOf(x)); }
    const key = Pay.keyOf(rec), prev = this.active.get(key); if (prev) { const o = this.quotes.get(prev); if (o) o.superseded = true; this.quotes.delete(prev); } // ONE open quote per player+item: the older one is dropped from the cache (its id still verifies by signature if a burn for it is already on the way)
    const mine = [...this.quotes.values()].filter((x) => x.pid === rec.pid && !x.used && x.expires > now); if (mine.length >= 4) { this.quotes.delete(mine[0].id); this.active.delete(Pay.keyOf(mine[0])); }
    const expires = now + ttlMs; const id = quoteid.sign(this.secret, { kind: rec.kind, method: rec.method, pid: rec.pid, item: rec.item, plot: rec.plot, code: rec.code, burnMin: rec.burnMin, devMin: rec.devMin, expires });
    const full = { ...rec, id, created: now, expires: Math.floor(expires / 1000) * 1000, used: false }; this.quotes.set(id, full); this.active.set(key, id); return full;
  }
  // Rebuild a quote from its signed id alone (restart, evicted cache, late buy). Returns null for anything we did not sign. No wall-clock expiry check here (a late BUY of an in-window burn is fine);
  // the expiry is enforced against the BURN's block time in solana/src/compat.js (expires + 5 min), and `expires` is part of the signed id so it cannot be edited.
  // uriFor(kind, id, code) supplies the metadata URL the mint is expected to carry (the server's public URL).
  recover(id, uriFor, usdFor, pid) {
    const cached = this.quotes.get(id); if (cached) return cached; const v = quoteid.verify(this.secret, id, pid); if (!v) return null;
    const q = { ...v, recovered: true, used: false, devWallet: BigInt(v.devMin) > 0n ? this.c.devWallet || null : null, uri: uriFor ? uriFor(v.kind, v.id, v.code) : null, usd: usdFor ? usdFor(v.kind, v.item) : undefined }; // usd = the list price (the grant records it), rebuilt from the item, never trusted from the id
    if (BigInt(v.devMin) > 0n && !q.devWallet) return null; return q;
  }
}
module.exports = { Pay, SOL };
