// Wallet adapters (lazy chunk). Every adapter returns { kind, provider: { signTransaction }, pubkey, label, logout() }.
//  - injected: Phantom / Solflare browser wallet.
//  - embedded: "Sign in with Google" non-custodial wallet (Web3Auth / MetaMask Embedded Wallets). The key is split with MPC across Web3Auth's nodes and the
//    user's Google login; it is only ever re-assembled inside THIS browser tab, held in memory, and zeroed on sign-out. It never touches our server.
import { Keypair, PublicKey } from '@solana/web3.js';
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
async function web3auth(cfg, server) {
  if (w3a) return w3a; const e = cfg.embedded; if (!e) throw new Error('Google sign-in is not set up yet.');
  const m = await import('@web3auth/no-modal'); const main = cfg.network === 'mainnet-beta';
  const inst = new m.Web3AuthNoModal({ clientId: e.clientId, web3AuthNetwork: e.network === 'sapphire_devnet' ? m.WEB3AUTH_NETWORK.SAPPHIRE_DEVNET : m.WEB3AUTH_NETWORK.SAPPHIRE_MAINNET, uiConfig: { appName: 'VW FEST SHOW GROUNDS', mode: 'dark' }, chains: [{ chainNamespace: 'solana', chainId: main ? '0x1' : '0x3', rpcTarget: main ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com', displayName: main ? 'Solana Mainnet' : 'Solana Devnet', blockExplorerUrl: 'https://solscan.io', ticker: 'SOL', tickerName: 'Solana' }] });
  await inst.init(); inst._m = m; return (w3a = inst);
}
async function adapt(inst) {
  const conn = inst.connection; if (!conn) return null; const acct = conn.solanaWallet && conn.solanaWallet.accounts && conn.solanaWallet.accounts[0]; const addr = acct && (acct.address || (acct.publicKey && new PublicKey(acct.publicKey).toBase58()));
  const priv = await conn.ethereumProvider.request({ method: 'solana_privateKey' }); let kp = keypairFromExport(priv, addr); const user = (inst.getUserInfo && (await inst.getUserInfo().catch(() => null))) || {};
  return { kind: 'embedded', provider: { signTransaction: async (tx) => { if (!kp) throw new Error('Signed out'); tx.sign([kp]); return tx; }, signMessage: async (bytes) => { if (!kp) throw new Error('Signed out'); const nacl = (await import('tweetnacl')).default; return { signature: nacl.sign.detached(bytes, kp.secretKey) }; } }, pubkey: kp.publicKey, label: user.email || 'Google account',
    exportKey: () => { if (!kp) throw new Error('Signed out'); return b58encode(kp.secretKey); }, logout: async () => { if (kp) kp.secretKey.fill(0); kp = null; try { await inst.logout(); } catch {} } };
}
export async function connectEmbedded(cfg, server, via = 'google') {
  const inst = await web3auth(cfg, server); const m = inst._m;
  if (!inst.connected) await inst.connectTo(m.WALLET_CONNECTORS.AUTH, { authConnection: via === 'apple' ? m.AUTH_CONNECTION.APPLE : m.AUTH_CONNECTION.GOOGLE });
  const a = await adapt(inst); if (!a) throw new Error('Sign-in was cancelled.'); localStorage.setItem('sg_emb', '1'); const lo = a.logout; a.logout = async () => { localStorage.removeItem('sg_emb'); await lo(); w3a = null; }; return a;
}
// Quietly restore an earlier Google session (no popup) if there is one.
export async function resumeEmbedded(cfg, server) { if (!cfg.embedded || !localStorage.getItem('sg_emb')) return null; try { const inst = await web3auth(cfg, server); if (!inst.connected) return null; const a = await adapt(inst); const lo = a.logout; a.logout = async () => { localStorage.removeItem('sg_emb'); await lo(); w3a = null; }; return a; } catch { return null; } }
export async function balances(conn, pubkey) { return BigInt(await conn.getBalance(pubkey, 'confirmed')); }
// Wallet ownership proof (free signMessage, never a transaction). Returns when the server confirmed it for this session.
export async function signText(provider, text) { const bytes = new TextEncoder().encode(text); const r = await provider.signMessage(bytes, 'utf8'); const sig = r && r.signature ? r.signature : r; return btoa(String.fromCharCode(...new Uint8Array(sig))); }
