// src/wallet.js connectEmbedded (Google sign-in): it must RETURN the adapter (a comment once swallowed `return a`, so every Google sign-in got undefined),
// the adapter's logout must clear the remembered-session flag (sg_emb), and "stay signed in" is opt-in. Runs the real wallet.js (esbuild bundle) against a stubbed Web3Auth.
const assert = require('assert'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ADDR = '11111111111111111111111111111112';
const STUB = `
export const WEB3AUTH_NETWORK = { SAPPHIRE_DEVNET: 'sd', SAPPHIRE_MAINNET: 'sm' }; export const WALLET_CONNECTORS = { AUTH: 'auth' }; export const AUTH_CONNECTION = { GOOGLE: 'google', APPLE: 'apple' };
export const calls = { logout: 0, connectTo: 0 };
export class Web3AuthNoModal { constructor(o) { this.o = o; this.connected = false; this.connectors = [{ name: 'auth', status: 'ready' }]; }
  async init() {} async connectTo() { calls.connectTo++; this.connected = true; this.connection = { solanaWallet: { accounts: [{ address: '${ADDR}' }], features: {}, chains: ['solana:devnet'] } }; }
  async getUserInfo() { return { email: 'someone@example.com' }; } async logout() { calls.logout++; this.connected = false; } }`;
(async () => {
  const out = path.join(os.tmpdir(), 'sg-wallet-bundle-' + process.pid + '.cjs');
  await require('esbuild').build({ entryPoints: [path.join(__dirname, '..', 'src', 'wallet.js')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent', define: { global: 'globalThis' },
    plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /^@web3auth\/no-modal$/ }, () => ({ path: 'w3a', namespace: 'stub' })); b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUB, loader: 'js' })); } }] });
  const store = new Map(); globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.window = { top: null }; window.top = window; window.self = window; globalThis.location = { hostname: 'example.org', search: '' };
  const W = require(out); const cfg = { embedded: { clientId: 'x', network: 'sapphire_devnet' }, network: 'devnet' };
  let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
  await t('connectEmbedded returns the wallet adapter (not undefined)', async () => {
    const a = await W.connectEmbedded(cfg, 'http://srv', 'google', false); assert(a, 'connectEmbedded returned ' + a); assert.strictEqual(a.kind, 'embedded'); assert.strictEqual(a.pubkey.toBase58(), ADDR); assert.strictEqual(typeof a.provider.signTransaction, 'function'); assert.strictEqual(typeof a.logout, 'function'); assert.match(a.label, /^s\*\*\*@example\.com$/); });
  await t('staying signed in is opt-in: sg_emb is set only when asked, and cleared otherwise', async () => {
    store.clear(); let a = await W.connectEmbedded(cfg, 'http://srv', 'google', true); assert.strictEqual(store.get('sg_emb'), '1'); await a.logout(); assert(!store.has('sg_emb'), 'logout clears sg_emb');
    store.set('sg_emb', '1'); a = await W.connectEmbedded(cfg, 'http://srv', 'google', false); assert(!store.has('sg_emb'), 'a non-remembered sign-in clears a stale flag'); });
  await t('logout clears sg_emb and really signs out of Web3Auth, after which the adapter refuses to sign', async () => {
    store.clear(); const a = await W.connectEmbedded(cfg, 'http://srv', 'google', true); assert.strictEqual(store.get('sg_emb'), '1'); await a.logout(); assert(!store.has('sg_emb')); await assert.rejects(a.provider.signMessage(new Uint8Array(1)), /Signed out/); });
  fs.rmSync(out, { force: true }); console.log(process.exitCode ? 'WALLET TESTS FAILED' : `all ${n} wallet tests passed`); process.exit(process.exitCode || 0);
})();
