'use strict';
// Burn Tracker: public ledger of verified burns (only ever written by verified payments), totals, Solscan links.
class BurnTracker {
  constructor({ store, cfg }) { this.store = store; this.cfg = cfg; this.version = 0; }
  record(rec) { // rec: {sig, quoteId, kind, item, wallet, amount(raw string), method, devLamports, nick?, asset?}
    const ok = this.store.reserve('burn', rec.sig, { ...rec, ts: rec.ts || Date.now(), network: this.cfg.network }); if (ok) this.version++; return ok;
  }
  attachAsset(sig, asset) { const r = this.store.get('burn', sig); if (r) { this.store.set('burn', sig, { ...r, asset }); this.version++; } }
  all() { return this.store.values('burn').sort((a, b) => a.ts - b.ts); }
  total() { return this.all().reduce((s, b) => s + BigInt(b.amount), 0n); }
  summary(limit = 15) {
    const dec = this.cfg.decimals; const fmt = (raw) => Number(BigInt(raw)) / 10 ** dec; const all = this.all();
    const byKind = {}; for (const b of all) byKind[b.kind] = (byKind[b.kind] || 0) + fmt(b.amount);
    return { network: this.cfg.network, mint: this.cfg.vwfestMint, decimals: dec, totalBurned: fmt(this.total()), count: all.length, byKind,
      recent: all.slice(-limit).reverse().map((b) => ({ sig: b.sig, kind: b.kind, item: b.item || null, nick: b.nick || null, wallet: b.wallet.slice(0, 4) + '…' + b.wallet.slice(-4), amount: fmt(b.amount), method: b.method, ts: b.ts, asset: b.asset || null, url: this.cfg.explorer(b.sig, 'tx'), assetUrl: b.asset ? this.cfg.explorer(b.asset, 'address') : null })) };
  }
}
module.exports = { BurnTracker };
