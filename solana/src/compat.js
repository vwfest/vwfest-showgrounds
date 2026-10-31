'use strict';
// Drop-in server facade for INTERFACES.md §1 (single-transaction flow used by the UI's WebSocket `quote` / `buy`).
// Same security properties as the native flow: the quote's amounts are decided by the server, nothing is granted before a CONFIRMED
// transaction is parsed on-chain, and sig / avatar-code reservation happens synchronously (before any await) and is released on failure.
const crypto = require('crypto');
const { Connection, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const C = require('./config'); const { Store } = require('./store'); const { Prices } = require('./prices'); const { Auth } = require('./auth');
const { BurnTracker } = require('./burns'); const onramp = require('./onramp'); const verify = require('./verify'); const jup = require('./jupiter');

function poolBackend(pool, schema = 'showgrounds') { // reuse the host's single TLS-verified pg pool (lib/db.js). We never create our own Pool here.
  const s = String(schema).replace(/[^a-z0-9_]/gi, '');
  return { async load() { await pool.query(`CREATE SCHEMA IF NOT EXISTS ${s}`); await pool.query(`CREATE TABLE IF NOT EXISTS ${s}.solana_kv (ns TEXT NOT NULL, k TEXT NOT NULL, v JSONB, at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (ns,k))`); return (await pool.query(`SELECT ns,k,v FROM ${s}.solana_kv`)).rows.map((r) => [r.ns, r.k, r.v]); },
    async write(ns, k, v) { if (v === null) await pool.query(`DELETE FROM ${s}.solana_kv WHERE ns=$1 AND k=$2`, [ns, k]); else await pool.query(`INSERT INTO ${s}.solana_kv (ns,k,v) VALUES ($1,$2,$3) ON CONFLICT (ns,k) DO UPDATE SET v=EXCLUDED.v, at=now()`, [ns, k, JSON.stringify(v)]); } };
}

// Parse mpl-core CreateV1 data (base58 from jsonParsed): [0][dataState u8][name str][uri str]
function parseCoreCreate(dataB58) {
  let b; try { b = Buffer.from(bs58.decode(dataB58)); } catch { return null; } if (b[0] !== 0 || b.length < 10) return null;
  try { let o = 2; const nl = b.readUInt32LE(o); o += 4 + nl; const ul = b.readUInt32LE(o); o += 4; return { uri: b.toString('utf8', o, o + ul) }; } catch { return null; }
}
// Pure check of a parsed tx against INTERFACES' expect{}.
function inspect(tx, { mint, nonce, wallet, devWallet, burnMin, devMin, uri }) {
  if (!tx || !tx.meta || !tx.transaction) return { ok: false, retry: true, why: 'Transaction not found yet' };
  if (tx.meta.err) return { ok: false, why: 'Transaction failed on-chain' };
  const msg = tx.transaction.message; const keys = msg.accountKeys.map((k) => (typeof k === 'string' ? k : String(k.pubkey))); const signer = keys[0];
  const signers = msg.accountKeys.filter((k) => typeof k !== 'string' && k.signer).map((k) => String(k.pubkey)); if (!signers.includes(signer)) return { ok: false, why: 'Bad transaction signer' };
  if (wallet && signer !== wallet) return { ok: false, why: 'The transaction was not signed by your proven wallet' };
  let burn = 0n, dev = 0n, memo = null, asset = null, createdUri = null, ownerOk = true;
  for (const ix of msg.instructions) {
    const p = ix.parsed; const prog = ix.program;
    if ((prog === 'spl-token' || prog === 'spl-token-2022') && p && p.type === 'burnChecked' && p.info.mint === mint && p.info.authority === signer) burn += BigInt(p.info.tokenAmount.amount); // burnChecked only (unchecked burn is not accepted)
    else if (prog === 'spl-memo' && typeof p === 'string') memo = p;
    else if (prog === 'system' && p && p.type === 'transfer' && devWallet && p.info.source === signer && p.info.destination === devWallet) dev += BigInt(p.info.lamports);
    else if (String(ix.programId) === C.MPL_CORE_PROGRAM && ix.data) { const c = parseCoreCreate(ix.data); if (c) { asset = String(ix.accounts[0]); createdUri = c.uri; const owner = ix.accounts[4] && String(ix.accounts[4]); ownerOk = !owner || owner === signer || owner === C.MPL_CORE_PROGRAM; } }
  }
  if (burn <= 0n) return { ok: false, why: 'No $VWFEST burn found in that transaction' };
  if (nonce && !(typeof memo === 'string' && memo.split(':').includes(nonce) && memo.startsWith('vwfest:'))) return { ok: false, why: 'Session code mismatch' };
  if (burnMin !== undefined && burn < BigInt(burnMin)) return { ok: false, why: 'The burned amount was lower than the quote' };
  if (devMin !== undefined && BigInt(devMin) > 0n && dev < BigInt(devMin)) return { ok: false, why: 'The creator fee in that transaction was lower than the quote' };
  if (uri && (!asset || createdUri !== uri)) return { ok: false, why: 'The NFT in that transaction does not match your quote' };
  if (!ownerOk) return { ok: false, why: 'The NFT was not minted to the burning wallet' };
  return { ok: true, wallet: signer, amount: burn.toString(), devLamports: dev.toString(), asset, uri: createdUri, blockTime: tx.blockTime || null };
}

class Facade {
  constructor() { this.ready = false; this.fake = false; }
  async init({ env = process.env, db = null, fetchImpl, conn } = {}) {
    this.env = env; this.cfg = C.loadConfig(env); const cfg = this.cfg;
    const secretOk = !!cfg.serverSecret && cfg.serverSecret.length >= 32;
    this.enabledFlag = (env.MINT_ENABLED === '1' || env.SOLANA_ENABLED === '1') && C.isKey(cfg.vwfestMint) && secretOk && (!cfg.mainnet || cfg.mainnetArmed);
    this.reason = this.enabledFlag ? null : (!(env.MINT_ENABLED === '1' || env.SOLANA_ENABLED === '1') ? 'off' : !C.isKey(cfg.vwfestMint) ? 'VWFEST_MINT missing' : !secretOk ? 'SERVER_SECRET (>=32 chars) missing' : 'mainnet not armed');
    this.fake = env.CHAIN_FAKE === '1' && !cfg.mainnet; // test hook: never allowed on mainnet
    this.store = await new Store(db ? poolBackend(db, env.DB_SCHEMA || 'showgrounds') : null).init();
    this.conn = conn || new Connection(cfg.rpcUrl, 'confirmed'); this.prices = new Prices(cfg, fetchImpl || fetch); this.f = fetchImpl || fetch;
    this.tracker = new BurnTracker({ store: this.store, cfg });
    this.pending = new Set(); this.codes = new Set(); for (const b of this.tracker.all()) if (b.code) this.codes.add(b.code);
    const secret = cfg.serverSecret; this.authLib = secret && secret.length >= 32 ? new Auth({ store: this.store, secret }) : null; // >= 32 chars, never padded this.ready = true; return this;
  }
  config() {
    const c = this.cfg; return { enabled: !!this.enabledFlag, reason: this.reason || undefined, network: c.network, mint: c.vwfestMint, decimals: c.decimals, devWalletOk: C.isKey(c.devWallet),
      embedded: c.embedded && c.embedded.provider === 'web3auth' ? c.embedded : null, onramp: onramp.providers(c, this.env).map(({ id, name }) => ({ id, name, sandbox: id === 'moonpay' && !c.onramp.moonpay.live })), payTokens: c.payTokens.map((t) => ({ symbol: t.sym, mint: t.mint, decimals: t.dec })) };
  }
  async solUsd() { return (await this.prices.solUsd()).usd; }
  // Amounts are computed here from the caller's USD/percent policy (the caller owns pricing policy; the client can't choose any of these).
  async quote({ kind, usd, method, discountPct = 0, devPct = 0, devWalletOk = true, entry = false }) {
    if (!(usd > 0 && usd < 10000)) throw new Error('bad usd'); if (!['vwfest', 'sol'].includes(method)) throw new Error('bad method');
    const cfg = this.cfg; const dec = 10 ** cfg.decimals; const solUsd = await this.solUsd(); const vw = await this.prices.vwfestUsd();
    const dp = method === 'vwfest' ? discountPct : 0; const dv = method === 'sol' && devWalletOk ? devPct : 0;
    const q = { kind, usd, method, solUsd, discountPct: dp, devPct: dv, swap: false, totalLamports: '0', swapLamports: '0', devLamports: '0', devWallet: dv > 0 ? cfg.devWallet : null, burnRaw: '0', burnMin: '0', entry: !!entry };
    const lam = (u) => BigInt(Math.max(1, Math.ceil((u / solUsd) * 1e9)));
    if (method === 'vwfest') {
      const paid = usd * (1 - dp / 100); q.paidUsd = Math.round(paid * 100) / 100; q.burnRaw = BigInt(Math.max(1, Math.ceil(paid / vw.usd * dec))).toString(); q.burnMin = (BigInt(q.burnRaw) * 98n / 100n).toString();
    } else {
      const total = lam(usd); const devL = dv > 0 ? total * BigInt(Math.round(dv * 100)) / 10000n : 0n; const swapL = total - devL; q.paidUsd = usd; q.totalLamports = total.toString(); q.devLamports = devL.toString(); q.swapLamports = swapL.toString();
      if (cfg.mainnet) { q.swap = true; const jq = await this.prices.jupQuote({ inputMint: C.WSOL, outputMint: cfg.vwfestMint, amount: swapL.toString(), extra: '&onlyDirectRoutes=true' }); q.burnRaw = String(jq.outAmount); q.burnMin = (BigInt(jq.otherAmountThreshold) * 99n / 100n).toString(); }
      else { q.burnRaw = BigInt(Math.round(usd * (1 - dv / 100) * cfg.devnetTokensPerUsd * dec)).toString(); q.burnMin = (BigInt(q.burnRaw) * 97n / 100n).toString(); }
    }
    q.burnUi = Number(BigInt(q.burnRaw)) / dec; q.devMin = (BigInt(q.devLamports) * 99n / 100n).toString(); return q;
  }
  // opts per INTERFACES §1. expect.wallet (proven wallet) must equal the tx signer.
  async verifyPurchase(o) {
    const { sig, swapSig, nonce, pid, nick, kind, item, rideId, expect = {} } = o;
    if (!verify.isSig(sig)) return { ok: false, why: 'Bad signature' };
    // ---- synchronous reservation, before any await ----
    if (this.store.has('burn', sig) || this.pending.has('sig:' + sig)) return { ok: false, why: 'Already recorded', dup: true };
    const code = kind === 'mint' && expect.code ? String(expect.code) : null;
    if (code && (this.codes.has(code) || this.pending.has('code:' + code))) return { ok: false, why: 'This avatar has already been minted', dup: true };
    this.pending.add('sig:' + sig); if (code) this.pending.add('code:' + code);
    const release = () => { this.pending.delete('sig:' + sig); if (code) this.pending.delete('code:' + code); };
    try {
      if (this.fake) { const w = expect.wallet || 'FAKE'; const rec0 = { sig, amount: String(expect.burnMin || 1), wallet: w, kind, ts: Date.now() }; return this._commit({ ...rec0, pid, nick, item, rideId, code, quoteId: nonce, method: 'fake', devLamports: '0' }, code, release); }
      const tx = await verify.fetchTx(this.conn, sig, { tries: 8, delayMs: 1500 });
      if (tx && tx.transaction.signatures[0] !== sig) { release(); return { ok: false, why: 'Signature mismatch' }; }
      const r = inspect(tx, { mint: this.cfg.vwfestMint, nonce, wallet: expect.wallet, devWallet: expect.devWallet, burnMin: expect.burnMin, devMin: expect.devMin, uri: expect.uri });
      if (!r.ok) { release(); return r; }
      // swapSig is OWNERSHIP-ONLY: we merely record it (for the tracker's swap link) when that tx exists, succeeded and was signed by the same wallet.
      // It is never used to decide a grant and its amounts are not checked; the verified $VWFEST burn above is the only thing that counts.
      let swapOk = null; if (verify.isSig(swapSig) && swapSig !== sig) { try { const st = await verify.fetchTx(this.conn, swapSig, { tries: 2, delayMs: 800 }); if (st && !st.meta.err && String(st.transaction.message.accountKeys[0].pubkey) === r.wallet) swapOk = swapSig; } catch {} }
      return this._commit({ sig, swapSig: swapOk, kind, item: item || null, pid, nick, code, rideId, quoteId: nonce, wallet: r.wallet, amount: r.amount, devLamports: r.devLamports, asset: r.asset || undefined, method: 'tx', ts: (r.blockTime || Math.floor(Date.now() / 1000)) * 1000 }, code, release);
    } catch (e) { release(); return { ok: false, retry: true, why: 'Could not check the blockchain right now. Try again.' }; }
  }
  _commit(rec, code, release) { // synchronous: the burn ledger write IS the permanent reservation
    rec.nick = String(rec.nick || 'anon').slice(0, 14); const ok = this.tracker.record(rec); if (code) this.codes.add(code); release(); if (!ok) return { ok: false, why: 'Already recorded', dup: true }; return { ok: true, rec }; }
  get burnsApi() { const f = this; return {
    stats() { const s = f.tracker.summary(15); const top = {}; for (const b of f.tracker.all()) top[b.nick || 'anon'] = (top[b.nick || 'anon'] || 0n) + BigInt(b.amount);
      return { total: f.tracker.total().toString(), count: s.count, top: Object.entries(top).sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, 5).map(([nick, amount]) => ({ nick, amount: amount.toString() })), recent: s.recent.map((r) => ({ nick: r.nick, kind: r.kind, amount: r.amount, sig: r.sig, ts: r.ts, url: r.url })), codes: f.codes, totalBurned: s.totalBurned, network: s.network, mint: s.mint, decimals: s.decimals }; },
    get codes() { return f.codes; }, badge(pid) { return f.tracker.all().some((b) => b.pid === pid && (b.kind === 'mint' || b.kind === 'ride' || b.kind === 'avatar')); } }; }
  get authApi() { const f = this; const host = () => { try { return new URL(f.env.PUBLIC_BASE_URL || 'https://vwfestmemecoin.com').host; } catch { return 'vwfest'; } };
    return { challenge(pubkey) { if (!f.authLib) throw new Error('SERVER_SECRET missing'); const c = f.authLib.challenge({ wallet: pubkey, domain: host() }); return { nonce: c.nonce, message: c.message, expires: c.expiresAt }; },
      async verify({ pubkey, signature, nonce }) { if (!f.authLib) return { ok: false }; const v = f.authLib.verify({ wallet: pubkey, nonce, signature }); return v.ok ? { ok: true, pubkey } : { ok: false, why: v.why }; } }; }
  get onrampApi() { const f = this; return { async providers() { return f.config().onramp; }, async session({ provider, address, usd, redirect }) { const r = await onramp.createSession(f.cfg, provider, { address, usd, redirect }, { fetchImpl: f.f, env: f.env }); return { url: r.url, clientSecret: r.clientSecret, publishableKey: r.publishableKey }; } }; }
}
module.exports = { Facade, inspect, parseCoreCreate, poolBackend };
