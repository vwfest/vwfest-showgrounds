// Burn Tracker: verifies on-chain $VWFEST burns (made during avatar minting) and keeps a public ledger.
// Memory is the working copy; Postgres (own schema "showgrounds") persists it when DATABASE_URL is set.
const path = require('path');
const SCHEMA = (process.env.DB_SCHEMA || 'showgrounds').replace(/[^a-z0-9_]/gi, '');
const MPL_CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const isSig = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s);
const isKey = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
function b58decode(s) {
  let n = 0n; for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) return null; n = n * 58n + BigInt(i); }
  let lead = 0; for (const ch of s) { if (ch === '1') lead++; else break; }
  const hex = n === 0n ? '' : n.toString(16); return Buffer.concat([Buffer.alloc(lead), Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex')]);
}
// Parse mpl-core CreateV1 data: [0][dataState u8][name str][uri str][plugins opt]
function parseCreate(data) {
  const b = b58decode(data); if (!b || b.length < 10 || b[0] !== 0) return null;
  try { let o = 2; const nl = b.readUInt32LE(o); o += 4; const name = b.toString('utf8', o, o + nl); o += nl; const ul = b.readUInt32LE(o); o += 4; const uri = b.toString('utf8', o, o + ul); return { name, uri }; } catch { return null; }
}
function b58first(s) { // first decoded byte of a base58 string (instruction discriminator)
  let n = 0n; for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) return -1; n = n * 58n + BigInt(i); }
  let lead = 0; for (const ch of s) { if (ch === '1') lead++; else break; }
  const hex = n.toString(16); const bytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  const full = Buffer.concat([Buffer.alloc(lead), n === 0n ? Buffer.alloc(0) : bytes]); return full.length ? full[0] : -1;
}

class Burns {
  constructor(cfg) { this.cfg = cfg; this.list = []; this.sigs = new Set(); this.codes = new Map(); this.pids = new Map(); this.q = null; this.persistent = false; this.version = 0; this.skip = new Set(); }
  async init() {
    const DDL = [`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`, `CREATE TABLE IF NOT EXISTS ${SCHEMA}.burns (sig TEXT PRIMARY KEY, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`];
    try {
      if (process.env.DATABASE_URL) {
                const pool = require('./db').pool();
        this.q = (t, p) => pool.query(t, p); this.close = () => {};
        for (const s of DDL) await pool.query(s);
      } else if (process.env.USE_PGLITE === '1') {
        const { PGlite } = require('@electric-sql/pglite');
        const db = new PGlite(process.env.PGLITE_DIR || path.join(__dirname, '..', '.localdb'));
        this.q = (t, p) => db.query(t, p); this.close = () => db.close();
        for (const s of DDL) await db.exec(s);
      } else { console.warn('[burns] no DATABASE_URL: memory only (the tracker resets on restart)'); return; }
      const r = await this.q(`SELECT data FROM ${SCHEMA}.burns ORDER BY at ASC`); let skipped = 0;
      for (const row of r.rows) { const d = typeof row.data === 'string' ? JSON.parse(row.data) : row.data; if (d.network && d.network !== this.cfg.network) { skipped++; continue; } if (!this.sigs.has(d.sig)) { this.add(d); } } // rows are tagged with their cluster: a shared database never mixes devnet test burns into the mainnet tracker (or the reverse)
      this.persistent = true; this.version++; console.log(`[burns] loaded ${this.list.length} burn records for ${this.cfg.network}` + (skipped ? ` (${skipped} from another cluster ignored)` : ''));
    } catch (e) { console.error('[burns] DB unavailable, memory only:', e.message); this.q = null; }
  }
  add(d) { this.sigs.add(d.sig); this.list.push(d); if (d.code) this.codes.set(d.code, d.pid || null); if (d.pid && (d.kind === 'mint' || d.kind === 'ride')) this.pids.set(d.pid, (this.pids.get(d.pid) || []).concat(d)); }
  mintedBy(code) { return this.codes.has(code) ? { pid: this.codes.get(code) } : null; }
  forProfile(pid) { return (this.pids.get(pid) || []).map((b) => ({ code: b.code, asset: b.asset || null, sig: b.sig, url: this.cfg.explorer(b.sig, 'tx'), assetUrl: b.asset ? this.cfg.explorer(b.asset, 'address') : null, ts: b.ts })); }
  total() { return this.list.reduce((s, b) => s + BigInt(b.amount), 0n); }
  summary(limit = 15) {
    const dec = this.cfg.decimals;
    const fmt = (raw) => Number(BigInt(raw)) / 10 ** dec;
    return {
      network: this.cfg.network, mint: this.cfg.mint, decimals: dec, persistent: this.persistent,
      totalBurned: fmt(this.total()), count: this.list.length,
      recent: this.list.slice(-limit).reverse().map((b) => ({ sig: b.sig, swapSig: b.swapSig || null, wallet: b.wallet.slice(0, 4) + '…' + b.wallet.slice(-4), nick: b.nick, what: b.kind === 'shop' ? 'shop:' + b.item : b.kind === 'vendor' ? 'vendor' : b.kind === 'ride' ? 'ride' : b.kind === 'external' ? 'burn' : 'mint', amount: fmt(b.amount), ts: b.ts, asset: b.asset || null, url: this.cfg.explorer(b.sig, 'tx'), swapUrl: b.swapSig ? this.cfg.explorer(b.swapSig, 'tx') : null })),
    };
  }
  async rpc(method, params) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(this.cfg.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal });
      const j = await r.json(); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result;
    } finally { clearTimeout(tm); }
  }
  async fetchTx(sig) {
    for (let i = 0; i < 8; i++) {
      const tx = await this.rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      if (tx) return tx; await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }
  // Pure check of a parsed transaction. Returns {ok, wallet, amount, asset?, code?, devLamports} or {ok:false, why}.
  static inspect(tx, { mint, nonce, base, devWallet }) {
    if (!tx || !tx.meta || !tx.transaction) return { ok: false, why: 'Transaction not found yet' };
    if (tx.meta.err) return { ok: false, why: 'Transaction failed on-chain' };
    const msg = tx.transaction.message; const keys = msg.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey));
    const signer = keys[0]; let burn = null, memo = null, asset = null, uri = null, ownerOk = true, dev = 0n;
    for (const ix of msg.instructions) {
      const p = ix.parsed;
      if (ix.program === 'spl-token' && p && (p.type === 'burn' || p.type === 'burnChecked') && p.info.mint === mint && p.info.authority === signer) {
        const amt = p.type === 'burnChecked' ? p.info.tokenAmount.amount : p.info.amount; burn = (burn || 0n) + BigInt(amt);
      } else if (ix.program === 'spl-memo' && typeof p === 'string') memo = p;
      else if (ix.program === 'system' && p && p.type === 'transfer' && devWallet && p.info.source === signer && p.info.destination === devWallet) dev += BigInt(p.info.lamports);
      else if (ix.programId === MPL_CORE && ix.data && b58first(ix.data) === 0) {
        const c = parseCreate(ix.data); if (!c) continue;
        if (base && c.uri.startsWith(base + '/')) { asset = ix.accounts[0]; uri = c.uri; const owner = ix.accounts[4]; ownerOk = !owner || owner === signer || owner === MPL_CORE; }
      }
    }
    if (!burn || burn <= 0n) return { ok: false, why: 'No $VWFEST burn found in that transaction' };
    if (nonce && memo !== 'vwfest:' + nonce) return { ok: false, why: 'Session code mismatch' };
    if (!ownerOk) return { ok: false, why: 'The NFT was not minted to the burning wallet' };
    return { ok: true, wallet: signer, amount: burn.toString(), asset, uri, devLamports: dev.toString() };
  }
  // On-chain fallback: the ledger above only ever holds burns the SERVER verified for a purchase. Burns made outside the game (a script, a test, a manual burn) from a watched wallet
  // (BURN_WATCH_WALLETS, plus the mainnet authority) are read from the chain: recent signatures of each wallet -> parsed tx -> a burn / burnChecked of THIS mint signed by the wallet.
  // Recorded once per signature as kind 'external' (no player attached, no avatar/grant side effects). Bounded work per run; a failure never throws.
  async syncOnchain(wallets, { maxTx = 8, depth = 25 } = {}) {
    let added = 0; const seen = new Set();
    for (const w of wallets || []) {
      if (!isKey(w) || seen.has(w)) continue; seen.add(w);
      let sigs; try { sigs = await this.rpc('getSignaturesForAddress', [w, { limit: depth, commitment: 'confirmed' }]); } catch (e) { console.error('[burns] on-chain sync: signatures failed', String(e.message).slice(0, 80)); continue; }
      for (const s of sigs || []) {
        if (maxTx <= 0) break; if (s.err || this.sigs.has(s.signature) || this.skip.has(s.signature) || !isSig(s.signature)) continue; maxTx--;
        try {
          const tx = await this.rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); if (!tx) continue;
          // a purchase made through the game carries the memo "vwfest:<quote>": it belongs to the verified purchase path (which also grants the item), never to this fallback
          const game = tx.transaction && tx.transaction.message && tx.transaction.message.instructions.some((ix) => ix.program === 'spl-memo' && typeof ix.parsed === 'string' && ix.parsed.startsWith('vwfest:'));
          const r = game ? { ok: false } : Burns.inspect(tx, { mint: this.cfg.mint }); if (!r.ok) { this.skip.add(s.signature); continue; }
          if (this.sigs.has(s.signature)) continue;
          const rec = { kind: 'external', item: null, pid: undefined, sig: s.signature, wallet: r.wallet, amount: r.amount, devLamports: '0', nick: 'external', ts: (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000, network: this.cfg.network };
          this.add(rec); this.version++; added++;
          if (this.q) this.q(`INSERT INTO ${SCHEMA}.burns (sig, data) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [rec.sig, JSON.stringify(rec)]).catch((e) => console.error('[burns] persist failed', e.message));
        } catch (e) { console.error('[burns] on-chain sync: tx failed', String(e.message).slice(0, 80)); }
      }
    }
    return added;
  }
  // opts: {sig, swapSig, nonce, nick, pid, kind:'mint'|'shop', item?, expect:{code?, burnMin?:bigint, devMin?:bigint, devWallet?}}
  // Ledger write for a receipt that solana/ already verified on-chain (verifyPurchase). Synchronous + idempotent by signature.
  record(r) {
    if (!r || !isSig(r.sig) || this.sigs.has(r.sig)) return false;
    const rec = { kind: r.kind, item: r.item || null, pid: r.pid, code: r.kind === 'mint' ? r.code || undefined : undefined, rideId: r.kind === 'ride' ? r.rideId : undefined, sig: r.sig, swapSig: r.swapSig || null, wallet: r.wallet, amount: String(r.amount), devLamports: String(r.devLamports || '0'), asset: r.asset || undefined, nick: String(r.nick || 'anon').slice(0, 14), ts: r.ts || Date.now(), network: this.cfg.network };
    this.add(rec); this.version++;
    if (this.q) this.q(`INSERT INTO ${SCHEMA}.burns (sig, data) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [rec.sig, JSON.stringify(rec)]).catch((e) => console.error('[burns] persist failed', e.message));
    return true;
  }
  // Reserve the signature and the avatar code SYNCHRONOUSLY (before any await) so two concurrent submissions can't both pass the duplicate checks
  // while the transaction is being fetched; released in `finally` (on success the record itself holds the sig/code).
  async submit(o) {
    const { sig, kind, expect = {} } = o;
    if (!isSig(sig)) return { ok: false, why: 'Bad signature' };
    if (this.sigs.has(sig)) return { ok: false, why: 'Already recorded', dup: true };
    const P = this.pending || (this.pending = { sigs: new Set(), codes: new Set() });
    if (P.sigs.has(sig)) return { ok: false, why: 'That transaction is already being verified', dup: true };
    const wantCode = kind === 'mint' ? expect.code : undefined;
    if (wantCode !== undefined) { if (this.codes.has(wantCode) || P.codes.has(wantCode)) return { ok: false, why: 'This avatar has already been minted', dup: true }; P.codes.add(wantCode); }
    P.sigs.add(sig);
    try { return await this._submit(o); } finally { P.sigs.delete(sig); if (wantCode !== undefined) P.codes.delete(wantCode); }
  }
  async _submit(o) {
    const { sig, swapSig, nonce, nick, pid, kind, item, expect = {} } = o;
    const tx = await this.fetchTx(sig);
    const r = Burns.inspect(tx, { mint: this.cfg.mint, nonce, base: this.cfg.base, devWallet: expect.devWallet });
    if (!r.ok) return r;
    if (expect.wallet && r.wallet !== expect.wallet) return { ok: false, why: 'That transaction was signed by a different wallet than the one you verified' };
    if (expect.uri) { if (!r.asset || r.uri !== expect.uri) return { ok: false, why: 'The NFT in that transaction does not match your quote' }; }
    if (kind === 'mint' && this.codes.has(expect.code)) return { ok: false, why: 'This avatar has already been minted', dup: true };
    if (expect.burnMin !== undefined && BigInt(r.amount) < expect.burnMin) return { ok: false, why: 'The burned amount was lower than the quote' };
    if (expect.devMin !== undefined && BigInt(r.devLamports) < expect.devMin) return { ok: false, why: 'The creator fee in that transaction was lower than the quote' };
    if (this.sigs.has(sig)) return { ok: false, why: 'Already recorded', dup: true };
    let swapOk = null;
    if (isSig(swapSig) && swapSig !== sig) { try { const st = await this.fetchTx(swapSig); if (st && !st.meta.err && (st.transaction.message.accountKeys[0].pubkey || st.transaction.message.accountKeys[0]) === r.wallet) swapOk = swapSig; } catch {} }
    const rec = { kind, item: item || null, pid, code: kind === 'mint' ? expect.code : undefined, rideId: kind === 'ride' ? o.rideId : undefined, sig, swapSig: swapOk, wallet: r.wallet, amount: r.amount, devLamports: r.devLamports, asset: r.asset || undefined, nick: String(nick || 'anon').slice(0, 14), ts: (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000, network: this.cfg.network };
    this.add(rec); this.version++;
    if (this.q) this.q(`INSERT INTO ${SCHEMA}.burns (sig, data) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [sig, JSON.stringify(rec)]).catch((e) => console.error('[burns] persist failed', e.message));
    return { ok: true, rec };
  }
}
module.exports = { Burns, isSig, isKey, MPL_CORE, b58decode, parseCreate };
