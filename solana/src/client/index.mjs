// Browser client for the VW FEST Solana module (also runs in Node for tests). Bundle with esbuild together with @solana/web3.js.
// NON-CUSTODIAL: the wallet adapter signs; this lib audits every transaction against the quote BEFORE the wallet sees it, and broadcasts
// through the player's own RPC (config.rpcUrl). The server is never asked to send anything.
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { auditPayTx, auditMintTx, fetchAlts } from '../audit.js';
import { checkExpiry, plausibleHeight } from '../../../src/expiry.mjs';

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------- wallet adapters: { publicKey: base58 string, signMessage(u8)->u8, signTransaction(VersionedTransaction)->VersionedTransaction } ----------
export function phantomAdapter(provider) {
  return { name: 'Phantom', get publicKey() { return provider.publicKey.toString(); },
    async connect() { const r = await provider.connect(); return (r && r.publicKey ? r.publicKey : provider.publicKey).toString(); },
    async signMessage(m) { const r = await provider.signMessage(m, 'utf8'); return r.signature || r; },
    async signTransaction(tx) { return provider.signTransaction(tx); } };
}
export function walletStandardAdapter(wallet, chain = 'solana:mainnet') {
  let account = null;
  return { name: wallet.name, get publicKey() { return account.address; },
    async connect() { const r = await wallet.features['standard:connect'].connect(); account = (r.accounts && r.accounts[0]) || wallet.accounts[0]; if (!account) throw new Error('No account'); return account.address; },
    async signMessage(m) { const [r] = await wallet.features['solana:signMessage'].signMessage({ account, message: m }); return r.signature; },
    async signTransaction(tx) { const [r] = await wallet.features['solana:signTransaction'].signTransaction({ account, transaction: tx.serialize(), chain }); return VersionedTransaction.deserialize(r.signedTransaction); } };
}
// Any object with a signing keypair-like API (tests, scripts, or embedded wallets that hand you a keypair/secret in-browser).
export function keypairAdapter(keypair, nacl) {
  return { name: 'Keypair', publicKey: keypair.publicKey.toBase58(), async connect() { return this.publicKey; },
    async signMessage(m) { return nacl.sign.detached(m, keypair.secretKey); },
    async signTransaction(tx) { tx.sign([keypair]); return tx; } };
}
// Embedded wallets (Google login: Web3Auth / Privy): both expose signMessage + signTransaction on a Solana wallet object.
export function embeddedAdapter(w) {
  return { name: 'Google wallet', get publicKey() { return String(w.publicKey || w.address); }, async connect() { return String(w.publicKey || w.address); },
    async signMessage(m) { const r = await w.signMessage(m); return r.signature || r; },
    async signTransaction(tx) { const r = await w.signTransaction(tx); return r; } };
}
// wallet-standard discovery (no dependency): returns wallets that can sign Solana messages + transactions.
export function discoverWallets(win = globalThis.window) {
  const found = []; if (!win) return found;
  const api = { register: (...ws) => { for (const w of ws) if (w.features && w.features['solana:signMessage'] && w.features['standard:connect']) found.push(w); return () => {}; } };
  win.addEventListener('wallet-standard:register-wallet', (e) => { try { e.detail(api); } catch {} });
  try { win.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api })); } catch {}
  return found;
}
export function detectPhantom(win = globalThis.window) { const p = win && ((win.phantom && win.phantom.solana) || win.solana); return p && p.isPhantom ? phantomAdapter(p) : null; }

// Poll-based confirmation (no websocket needed, works behind any proxy). "Expired / nothing charged" is only ever said when checkExpiry() proves it (see src/expiry.mjs): no status anywhere
// AND a plausible FINALIZED block height past lastValidBlockHeight, twice in a row. Anything else keeps waiting and finally says the payment may still land.
async function waitConfirmed(conn, sig, lastValidBlockHeight, raw, readers = []) {
  let expiredSeen = 0;
  for (let i = 0; i < 90; i++) {
    if (raw && i > 0 && i % 3 === 0) { try { await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch {} } // re-broadcast (same signature, idempotent) until it lands or the blockhash expires
    let st = null; try { st = (await conn.getSignatureStatuses([sig])).value[0]; } catch {}
    if (st) { if (st.err) throw new Error('Transaction failed: ' + JSON.stringify(st.err)); if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return; }
    if (lastValidBlockHeight) {
      const h = await plausibleHeight(conn, Number(lastValidBlockHeight));
      if (h !== null && h > Number(lastValidBlockHeight)) {
        const c = await checkExpiry({ conns: [conn, ...readers], sig, lastValidBlockHeight });
        if (c.state === 'landed') return; if (c.state === 'failed') throw new Error('Transaction failed: ' + JSON.stringify(c.err));
        if (c.state === 'expired' && ++expiredSeen >= 2) throw Object.assign(new Error('Transaction expired before it landed. Nothing was charged; try again.'), { expired: true, sig });
        if (c.state !== 'expired') expiredSeen = 0;
      } else expiredSeen = 0;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw Object.assign(new Error('Still confirming; the payment may still land: ' + sig + '. Do not pay again until you have checked it on Solscan.'), { pending: true, sig });
}
export function createClient({ base = '/api/solana', wallet = null, fetchImpl = (...a) => fetch(...a), connection = null, origin = null } = {}) {
  let cfg = null, token = null, conn = connection; let adapter = wallet;
  const headers = (extra) => ({ 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(origin ? { origin } : {}), ...extra });
  async function call(method, path, body) {
    const r = await fetchImpl(base + path, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
    if (!r.ok && j.ok !== false) j.ok = false; return j;
  }
  const must = (j) => { if (!j || j.ok === false) { const e = new Error((j && (j.error || j.why)) || 'request failed'); e.detail = j; throw e; } return j; };
  const api = {
    get token() { return token; }, setWallet(a) { adapter = a; }, get wallet() { return adapter; },
    async config() { if (!cfg) { cfg = must(await call('GET', '/config')); if (!conn) conn = new Connection(cfg.rpcUrl, 'confirmed'); } return cfg; },
    async connect(a) { if (a) adapter = a; if (!adapter) throw new Error('No wallet'); return adapter.connect ? adapter.connect() : adapter.publicKey; },
    async signIn() {
      const wallet = adapter.publicKey; const ch = must(await call('POST', '/auth/challenge', { wallet }));
      const sig = await adapter.signMessage(new TextEncoder().encode(ch.message));
      const v = must(await call('POST', '/auth/verify', { wallet, nonce: ch.nonce, signature: b64(sig) })); token = v.token; return v.wallet;
    },
    // o: { kind: 'avatar'|'ride'|'shop'|'vendor', method: 'vwfest'|'sol'|'spl', payTokenMint?, item?, nft? }
    async quote(o) { await api.config(); return must(await call('POST', '/quote', o)).quote; },
    async simulatePay(q) { // works even when mainnet is disarmed: build + audit + simulate, never signs or sends
      const c = await api.config(); const b = must(await call('POST', '/tx/pay', { quoteId: q.id })); const tx = VersionedTransaction.deserialize(unb64(b.tx)); auditPayTx(tx, b.quote, c, await fetchAlts(conn, tx));
      const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }); return { err: sim.value.err, logs: sim.value.logs, unitsConsumed: sim.value.unitsConsumed };
    },
    async _signSend(txB64, audit, { onStep, lastValidBlockHeight } = {}) {
      const lvb = lastValidBlockHeight;
      const c = await api.config(); if (c.simulateOnly) throw new Error('Mainnet is not enabled yet (simulate only).');
      let tx = VersionedTransaction.deserialize(unb64(txB64)); const alts = await fetchAlts(conn, tx); audit(tx, alts);
      onStep && onStep('Waiting for your wallet to approve...');
      const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
      if (sim.value.err) throw new Error('This would fail on-chain: ' + JSON.stringify(sim.value.err).slice(0, 120));
      const signed = await adapter.signTransaction(tx); audit(signed, alts); // re-audit what actually comes back from the wallet
      onStep && onStep('Sending...');
      const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      await waitConfirmed(conn, sig, lvb, signed.serialize());
      return sig;
    },
    async pay(q, { nick, onStep } = {}) {
      const c = await api.config(); const b = must(await call('POST', '/tx/pay', { quoteId: q.id })); onStep && onStep('Checking the transaction...');
      const sig = await api._signSend(b.tx, (tx, alts) => auditPayTx(tx, b.quote, c, alts), { onStep, lastValidBlockHeight: b.lastValidBlockHeight });
      onStep && onStep('Confirming on-chain...');
      for (let i = 0; i < 6; i++) { const v = await call('POST', '/pay/confirm', { quoteId: q.id, signature: sig, nick }); if (v.ok) return { signature: sig, receipt: v.receipt }; if (!v.retry && !v.pending) throw new Error(v.error || v.why); await new Promise((r) => setTimeout(r, 2000)); }
      throw new Error('Payment sent but not confirmed yet. Reload and retry; your signature: ' + sig);
    },
    async mint(q, { onStep } = {}) {
      const c = await api.config(); const b = must(await call('POST', '/tx/mint', { quoteId: q.id }));
      const sig = await api._signSend(b.tx, (tx) => auditMintTx(tx, { wallet: adapter.publicKey, asset: b.asset, collection: (q.kind === 'ride' ? c.collections.ride : c.collections.avatar), name: b.name, uri: b.uri }), { onStep, lastValidBlockHeight: b.lastValidBlockHeight });
      for (let i = 0; i < 6; i++) { const v = await call('POST', '/mint/confirm', { quoteId: q.id, signature: sig }); if (v.ok) return { signature: sig, asset: v.asset, uri: v.uri, url: v.url }; if (!v.retry && !v.pending) throw new Error(v.error || v.why); await new Promise((r) => setTimeout(r, 2000)); }
      throw new Error('Minted but not confirmed yet; retry. Signature: ' + sig);
    },
    // One call: quote -> pay -> (mint if the kind has an NFT). onQuote(q) lets the UI show the breakdown first and return false to cancel.
    async purchase(o, { nick, onStep, onQuote } = {}) {
      const q = await api.quote(o); if (onQuote && (await onQuote(q)) === false) return { cancelled: true, quote: q };
      const p = await api.pay(q, { nick, onStep }); let m = null;
      if (q.kind === 'avatar' || q.kind === 'ride') m = await api.mint(q, { onStep });
      return { quote: q, payment: p, mint: m, receipt: p.receipt };
    },
    async logout() { const j = await call('POST', '/auth/logout', {}); token = null; return j.ok !== false; },
    async listNfts() { return must(await call('GET', '/nfts')); },
    async useNft(asset) { return must(await call('POST', '/nft/use', { asset })).avatar; },
    async burns(limit = 15) { return must(await call('GET', '/burns?limit=' + limit)); },
    async onramp(provider, usd) { return must(await call('POST', '/onramp/session', { provider, usd })); },
    async faucet() { return must(await call('POST', '/devnet/faucet', {})); },
  };
  return api;
}
