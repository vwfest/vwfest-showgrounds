// Wallet adapters (lazy chunk). Every adapter returns { kind, provider: { signTransaction }, pubkey, label, logout() }.
//  - injected: Phantom / Solflare browser wallet.
//  - embedded: "Sign in with Google" non-custodial wallet (Web3Auth / MetaMask Embedded Wallets). The key is split with MPC across Web3Auth's nodes and the
//    user's Google login. Transactions and messages are signed THROUGH the Web3Auth wallet provider (wallet-standard features), so this page never holds the key.
//    The key is only exported for the explicit "Reveal my private key" button (then zeroed). If the provider cannot sign, we refuse; we never export the key to sign. It never touches our server.
import { assertTop, framed } from './frame.js';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getProvider, connectWallet } from './pay.js';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const b58encode = (u8) => { let n = 0n; for (const b of u8) n = (n << 8n) | BigInt(b); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of u8) { if (b === 0) s = '1' + s; else break; } return s; };
const fromHex = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };

export const hasInjected = () => !!getProvider();
export async function connectInjected() { const w = await connectWallet(); return { kind: 'injected', provider: w.provider, pubkey: w.pubkey, label: 'Your Solana wallet', logout: async () => { try { await w.provider.disconnect(); } catch {} } }; }

// Turn Web3Auth's exported key (hex of a 32-byte seed or 64-byte secret key) into a keypair and check it matches the address Web3Auth reports.
export function keypairFromExport(hex, expectAddress) {
  const b = fromHex(String(hex).replace(/^0x/, '')); const kp = b.length === 64 ? Keypair.fromSecretKey(b) : b.length === 32 ? Keypair.fromSeed(b) : null;
  if (!kp) throw new Error('Unexpected key format from the wallet service.'); if (expectAddress && kp.publicKey.toBase58() !== expectAddress) throw new Error('Wallet address mismatch. Signing was blocked for your safety.'); return kp;
}
let w3a = null;
async function web3auth(cfg, server, remember = false) {
  if (w3a) return w3a; const e = cfg.embedded; if (!e) throw new Error('Google sign-in is not set up yet.');
  const m = await import('@web3auth/no-modal'); const main = cfg.network === 'mainnet-beta';
  const inst = new m.Web3AuthNoModal({ clientId: e.clientId, web3AuthNetwork: e.network === 'sapphire_devnet' ? m.WEB3AUTH_NETWORK.SAPPHIRE_DEVNET : m.WEB3AUTH_NETWORK.SAPPHIRE_MAINNET, sessionTime: remember ? 7 * 86400 : 3600, uiConfig: { appName: 'VW FEST SHOW GROUNDS', mode: 'dark' }, chains: [{ chainNamespace: 'solana', chainId: main ? '0x1' : '0x3', rpcTarget: main ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com', displayName: main ? 'Solana Mainnet' : 'Solana Devnet', blockExplorerUrl: 'https://solscan.io', ticker: 'SOL', tickerName: 'Solana' }] });
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('debug')) window.__w3a = inst; // debugging aid, localhost only (never expose the wallet instance on the live site)
  // init() can resolve (or hang) without the Google connector becoming ready (blocked network, origin not allowed in the Web3Auth dashboard): never leave the user on a dead button.
  try { await Promise.race([inst.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]); } catch (e) { throw new Error(e && e.message === 'timeout' ? 'Google sign-in took too long to start. Check your connection and try again.' : 'Google sign-in could not start: ' + ((e && e.message) || 'unknown error')); }
  // init() can resolve a moment before the Google ('auth') connector reports ready: wait for it (connectTo throws "not ready" otherwise).
  const auth = () => (inst.connectors || []).find((c) => c.name === 'auth'); for (let i = 0; i < 120 && !(auth() && (auth().status === 'ready' || auth().status === 'connected')); i++) await new Promise((r) => setTimeout(r, 250));
  if (!auth() || (auth().status !== 'ready' && auth().status !== 'connected')) throw new Error('Google sign-in is not available from this site right now (' + (auth() ? auth().status : 'no connector') + '). Try again, or use your own wallet.');
  inst._m = m; return (w3a = inst);
}
const maskEmail = (e) => { const m = /^([^@])[^@]*(@.+)$/.exec(String(e || '')); return m ? m[1] + '***' + m[2] : 'Google account'; };
const isZero = (u8) => !u8 || u8.every((x) => x === 0);
export async function adapt(inst) {
  const conn = inst.connection; if (!conn) return null; const sw = conn.solanaWallet; const acct = sw && sw.accounts && sw.accounts[0]; const addr = acct && (acct.address || (acct.publicKey && new PublicKey(acct.publicKey).toBase58()));
  if (!addr) throw new Error('The wallet service did not return an address.'); const user = (inst.getUserInfo && (await inst.getUserInfo().catch(() => null))) || {}; let out = false;
  // The key is exported ONLY on demand (the Reveal / Export button) and zeroed right after use. Signing never exports it: no wallet-standard feature = refuse.
  const exportPair = async () => { const priv = await conn.ethereumProvider.request({ method: 'solana_privateKey' }); return keypairFromExport(priv, addr); };
  const feature = (n) => sw && sw.features && sw.features[n];
  const signTransaction = async (tx) => {
    if (out) throw new Error('Signed out'); const f = feature('solana:signTransaction');
    if (f) {
      const before = tx.message.serialize(); const [r] = await f.signTransaction({ account: acct, transaction: tx.serialize(), chain: sw.chains && sw.chains[0] }); const signed = VersionedTransaction.deserialize(r.signedTransaction);
      const a = signed.message.serialize(); if (a.length !== before.length || a.some((x, i) => x !== before[i])) throw new Error('The wallet service changed the transaction. Nothing was signed.');
      signed.signatures.forEach((s, i) => { if (isZero(s) && tx.signatures[i] && !isZero(tx.signatures[i])) signed.signatures[i] = tx.signatures[i]; }); // keep co-signatures (the new NFT's own key)
      return signed;
    }
    throw new Error('This sign-in wallet cannot sign transactions in this browser. Nothing was signed. Use your own wallet (Phantom, Solflare, Backpack).'); // never fall back to exporting the private key into page JS
  };
  const signMessage = async (bytes) => {
    if (out) throw new Error('Signed out'); const f = feature('solana:signMessage');
    if (f) { const [r] = await f.signMessage({ account: acct, message: bytes }); return { signature: r.signature }; }
    throw new Error('This sign-in wallet cannot sign messages in this browser. Use your own wallet (Phantom, Solflare, Backpack).');
  };
  return { kind: 'embedded', provider: { signTransaction, signMessage }, pubkey: new PublicKey(addr), label: maskEmail(user.email),
    exportKey: async () => { if (out) throw new Error('Signed out'); const kp = await exportPair(); try { return b58encode(kp.secretKey); } finally { kp.secretKey.fill(0); } }, logout: async () => { out = true; try { await inst.logout(); } catch {} } };
}
export async function connectEmbedded(cfg, server, via = 'google', remember = false) {
  assertTop();
  const inst = await web3auth(cfg, server, remember); const m = inst._m;
  if (!inst.connected) await inst.connectTo(m.WALLET_CONNECTORS.AUTH, { authConnection: via === 'apple' ? m.AUTH_CONNECTION.APPLE : m.AUTH_CONNECTION.GOOGLE });
  const a = await adapt(inst); if (!a) throw new Error('Sign-in was cancelled.'); if (remember) localStorage.setItem('sg_emb', '1'); else localStorage.removeItem('sg_emb'); // staying signed in is opt-in const lo = a.logout; a.logout = async () => { localStorage.removeItem('sg_emb'); await lo(); w3a = null; }; return a;
}
// Quietly restore an earlier Google session (no popup) if there is one.
export async function resumeEmbedded(cfg, server) { if (framed || !cfg.embedded || !localStorage.getItem('sg_emb')) return null; try { const inst = await web3auth(cfg, server, true); if (!inst.connected) return null; const a = await adapt(inst); const lo = a.logout; a.logout = async () => { localStorage.removeItem('sg_emb'); await lo(); w3a = null; }; return a; } catch { return null; } }
export async function balances(conn, pubkey) { return BigInt(await conn.getBalance(pubkey, 'confirmed')); }
// Wallet ownership proof (free signMessage, never a transaction). Returns when the server confirmed it for this session.
export async function signText(provider, text) { const bytes = new TextEncoder().encode(text); const r = await provider.signMessage(bytes, 'utf8'); const sig = r && r.signature ? r.signature : r; return btoa(String.fromCharCode(...new Uint8Array(sig))); }
