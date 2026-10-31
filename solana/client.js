// Browser entry for the Solana module (ESM). Bundle with esbuild together with @solana/web3.js.
// Native flow (recommended): createClient({ base:'/api/solana', wallet }) -> signIn() -> purchase({kind, method, ...}) (quote -> audited pay tx -> verified mint).
// INTERFACES.md §2 helpers provided here: hasInjected, connectInjected, balances, onrampUrl, bridgeLinks.
// NOT provided (the UI keeps its own src/pay.js + src/wallet.js for these): prepare/signAndSend for the WS-quote flow, connectEmbedded/resumeEmbedded.
import { PublicKey } from '@solana/web3.js';
import { phantomAdapter, detectPhantom, discoverWallets, walletStandardAdapter, keypairAdapter, embeddedAdapter, createClient } from './src/client/index.mjs';
export { phantomAdapter, detectPhantom, discoverWallets, walletStandardAdapter, keypairAdapter, embeddedAdapter, createClient };

const injected = () => { const w = globalThis.window; return w && ((w.phantom && w.phantom.solana) || w.solflare || w.backpack || w.solana) || null; };
export function hasInjected() { return !!injected() || discoverWallets().length > 0; }
export async function connectInjected() {
  const p = injected(); let adapter, label = 'Wallet';
  if (p) { adapter = phantomAdapter(p); label = p.isPhantom ? 'Phantom' : p.isSolflare ? 'Solflare' : 'Wallet'; }
  else { const w = discoverWallets()[0]; if (!w) throw new Error('No Solana wallet found. Install Phantom (phantom.app) and reload.'); adapter = walletStandardAdapter(w); label = w.name; }
  let addr; try { addr = await adapter.connect(); } catch (e) { const err = new Error('Wallet connection was cancelled.'); err.code = 'USER_REJECTED'; throw err; }
  return { kind: 'injected', pubkey: new PublicKey(addr), label, adapter, signTransaction: (tx) => adapter.signTransaction(tx), signMessage: (m) => adapter.signMessage(m), async logout() { try { if (p && p.disconnect) await p.disconnect(); } catch {} } };
}
export async function balances(conn, pubkey) { return BigInt(await conn.getBalance(new PublicKey(pubkey.toString()), 'confirmed')); }
export async function onrampUrl(server, { provider, address, usd }, token) {
  const r = await fetch(server.replace(/\/$/, '') + '/api/solana/onramp/session', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ provider, usd, address }) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !(j.url || j.clientSecret)) throw new Error(j.error || 'The on-ramp is unavailable right now'); return j.url || j;
}
export function bridgeLinks(address) {
  const a = encodeURIComponent(address);
  return [{ name: 'Jupiter (swap any Solana token to SOL)', url: 'https://jup.ag/swap/SOL-USDC' }, { name: 'deBridge (from other chains)', url: 'https://app.debridge.finance/?outputChain=7565164&outputCurrency=SOL&address=' + a }, { name: 'Wormhole Portal', url: 'https://portalbridge.com/' }];
}
