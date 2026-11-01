'use strict';
// Configuration for the Solana module. Everything comes from env (see README). Defaults are SAFE: devnet, mainnet disarmed.
const { PublicKey, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');

const VWFEST_MINT = '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump';
const DEV_WALLET = 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok';
const WSOL = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MPL_CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const { jupRoot } = require('./jupclient');
const DEFAULT_DEV_FEE_PCT = 50; // the ONE default for the creator-fee share (env DEV_FEE_PCT may lower it; it can never exceed 50)
const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

const isKey = (s) => { if (typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false; try { return new PublicKey(s).toBytes().length === 32; } catch { return false; } };
const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
const flag = (v, d) => (v === undefined || v === '' ? d : /^(1|true|on|yes)$/i.test(String(v)));
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

function parseSecretKey(s) {
  if (!s) return null;
  try {
    const t = String(s).trim();
    const raw = t.startsWith('[') ? Uint8Array.from(JSON.parse(t)) : bs58.decode(t);
    return Keypair.fromSecretKey(raw);
  } catch { throw new Error('AUTHORITY_SECRET_KEY / MAINNET_AUTHORITY_SECRET_KEY is not a valid base58 / JSON-array secret key'); }
}

const NETWORKS = {
  devnet: { rpc: 'https://api.devnet.solana.com', cluster: 'devnet' },
  'mainnet-beta': { rpc: 'https://api.mainnet-beta.solana.com', cluster: 'mainnet-beta' },
  localnet: { rpc: 'http://127.0.0.1:8899', cluster: 'localnet' },
};

function loadConfig(env = process.env) {
  const netName = env.SOLANA_NETWORK || env.MINT_NETWORK; // MINT_NETWORK = name used by server.js / INTERFACES.md
  const network = NETWORKS[netName] ? netName : 'devnet';
  const mainnet = network === 'mainnet-beta';
  const mainnetArmed = mainnet && (flag(env.MAINNET_ARMED, false) || flag(env.MINT_MAINNET, false)); // mainnet needs an explicit second switch
  const vwfestMint = mainnet ? (env.VWFEST_MINT || VWFEST_MINT) : (env.DEVNET_VWFEST_MINT || env.VWFEST_MINT || '');
  const devWallet = env.DEV_WALLET || DEV_WALLET;
  // Mainnet uses its own variable so a devnet deploy can never pick up (or spend from) the mainnet authority key; nothing signs with it unless MAINNET_ARMED + MINT_ENABLED are on.
  const authority = parseSecretKey(mainnet ? env.MAINNET_AUTHORITY_SECRET_KEY : env.AUTHORITY_SECRET_KEY);
  const serverSecret = env.SERVER_SECRET || '';
  const cfg = {
    network, mainnet, mainnetArmed,
    // The module can build/quote/verify on mainnet while disarmed, but grants nothing and the client lib refuses to send ("simulate only").
    simulateOnly: mainnet && !mainnetArmed,
    enabled: flag(env.SOLANA_ENABLED, true),
    rpcUrl: env.RPC_URL || NETWORKS[network].rpc, // SERVER-side only (may embed a private API key)
    publicRpcUrl: env.PUBLIC_RPC_URL || NETWORKS[network].rpc, // what browsers use to broadcast. NEVER falls back to RPC_URL. The server never sends transactions for users.
    testnet: network !== 'mainnet-beta',
    dasUrl: env.DAS_URL || env.RPC_URL || '',
    cluster: NETWORKS[network].cluster,
    vwfestMint, decimals: num(env.VWFEST_DECIMALS, 6),
    devWallet, devFeePct: clamp(num(env.DEV_FEE_PCT, DEFAULT_DEV_FEE_PCT), 0, 50), // creator fee on SOL / other-token payments: 50% to DEV_WALLET, the other 50% is swapped to $VWFEST and burned
    discountPct: clamp(num(env.VWFEST_DISCOUNT_PCT, 50), 0, 90),
    slippageBps: clamp(Math.round(num(env.SLIPPAGE_BPS, 300)), 10, 2000),
    jupiterBase: jupRoot(env.JUPITER_BASE), // ONE base (default https://api.jup.ag; the retired legacy host is no longer a default); /swap/v1 and /price/v3 are derived from it
    jupiterApiKey: env.JUPITER_API_KEY || '', // optional: sent as x-api-key, server-side only. Free key = 1 req/s per organisation, keyless 0.5 req/s
    jupiterRps: num(env.JUPITER_RPS, 0),
    fixedSolUsd: num(env.FIXED_SOL_USD, 0),
    devnetTokensPerUsd: num(env.DEVNET_TOKENS_PER_USD, 10),
    quoteTtlMs: clamp(num(env.QUOTE_TTL_SEC, 300), 30, 1800) * 1000,
    authority, // collection update authority + (devnet) test-token faucet. Holds NO user funds.
    serverSecret,
    publicBase: (env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    storage: { driver: env.NFT_STORAGE || 'server', pinataJwt: env.PINATA_JWT || '', gateway: (env.PINATA_GATEWAY || 'https://gateway.pinata.cloud').replace(/\/$/, '') },
    collections: {
      // fpNamespace: legacy string hashed into avatar uniqueness fingerprints; never change it (display name can change).
      avatar: { name: 'Show Grounds Avatars', fpNamespace: 'VW Fest Show Grounds Avatars', address: env.AVATAR_COLLECTION || '', symbol: 'VWFAV' },
      ride: { name: 'Show Grounds Rides', address: env.RIDE_COLLECTION || '', symbol: 'VWFRIDE' },
    },
    // Per-kind price policy. discount = 50% off when paying in $VWFEST. devFee = dev cut applies to non-$VWFEST payments (SOL/SPL).
    // Mints: 100% of a $VWFEST payment is burned, and 50% of a SOL payment is swapped+burned and 50% goes to DEV_WALLET (set MINT_DEV_FEE=0 for a 100% burn on SOL too).
    kinds: {
      avatar: { usd: num(env.AVATAR_MINT_USD, 5), discount: true, devFee: flag(env.MINT_DEV_FEE, true), nft: 'avatar', label: 'Avatar NFT' },
      ride: { usd: num(env.RIDE_MINT_USD, 5), discount: true, devFee: flag(env.MINT_DEV_FEE, true), nft: 'ride', label: 'Mystery Ride NFT' },
      vendor: { usd: num(env.VENDOR_FEE_USD, 30), discount: false, devFee: true, nft: null, label: 'Vendor booth' },
      shop: { usd: null, discount: true, devFee: true, nft: null, label: 'Outfit shop' }, // usd is supplied by the shop catalog at quote time
    },
    features: {
      mintAvatar: flag(env.FEATURE_MINT_AVATAR, true), mintRide: flag(env.FEATURE_MINT_RIDE, true), shop: flag(env.FEATURE_SHOP, true), vendor: flag(env.FEATURE_VENDOR, true),
      payWithSol: flag(env.FEATURE_PAY_SOL, true), payWithSpl: flag(env.FEATURE_PAY_SPL, true), nftAvatarLookup: flag(env.FEATURE_NFT_AVATAR, true),
      onramp: flag(env.FEATURE_ONRAMP, true), embeddedWallet: flag(env.FEATURE_EMBEDDED_WALLET, true),
    },
    payTokens: parsePayTokens(env.PAY_TOKENS),
    metadataHosts: (env.NFT_METADATA_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean), // optional allowlist for server-side NFT metadata fetches
    maxShopUsd: num(env.MAX_SHOP_USD, 100),
    adminSecret: env.ADMIN_SECRET && env.ADMIN_SECRET.length >= 16 ? env.ADMIN_SECRET : '',
    onramp: {
      moonpay: env.MOONPAY_API_KEY && env.MOONPAY_SECRET_KEY ? { apiKey: env.MOONPAY_API_KEY, secret: env.MOONPAY_SECRET_KEY, live: env.MOONPAY_ENV === 'live' } : null,
      coinbase: env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET ? { keyId: env.CDP_API_KEY_ID, secret: env.CDP_API_KEY_SECRET } : null,
      stripe: env.STRIPE_SECRET_KEY ? { secret: env.STRIPE_SECRET_KEY } : null,
    },
    embedded: env.WEB3AUTH_CLIENT_ID ? { provider: 'web3auth', clientId: env.WEB3AUTH_CLIENT_ID, network: mainnet ? 'sapphire_mainnet' : 'sapphire_devnet' }
      : env.PRIVY_APP_ID ? { provider: 'privy', appId: env.PRIVY_APP_ID, clientId: env.PRIVY_CLIENT_ID || '' } : null,
    privyVerificationKey: env.PRIVY_VERIFICATION_KEY || '',
    explorer(id, kind = 'tx') { const q = network === 'devnet' ? '?cluster=devnet' : ''; return network === 'localnet' ? null : `https://solscan.io/${kind}/${id}${q}`; },
  };
  return cfg;
}

function parsePayTokens(raw) {
  const d = [['USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6], ['USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6], ['BONK', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 5], ['JUP', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 6]].map(([sym, mint, dec]) => ({ sym, mint, dec }));
  if (!raw) return d;
  try { const e = JSON.parse(raw); if (Array.isArray(e)) return e.filter((t) => t && isKey(t.mint) && /^[A-Za-z0-9]{1,10}$/.test(t.sym) && t.dec >= 0 && t.dec <= 12).slice(0, 12); } catch {}
  return d;
}

// Problems that must stop a feature (not the whole server). Returned, never thrown, so the host can show a friendly "off" reason.
function problems(cfg) {
  const p = [];
  if (!cfg.enabled) p.push('SOLANA_ENABLED=0');
  if (!isKey(cfg.vwfestMint)) p.push(cfg.mainnet ? 'VWFEST_MINT invalid' : 'DEVNET_VWFEST_MINT not set (run scripts/devnet-setup.js)');
  if (!isKey(cfg.devWallet)) p.push('DEV_WALLET invalid');
  if (!cfg.serverSecret || cfg.serverSecret.length < 32) p.push('SERVER_SECRET (>=32 chars, persistent) is required for commit-reveal rides and signed quotes');
  if (!cfg.authority) p.push('AUTHORITY_SECRET_KEY missing (collection authority)');
  return p;
}

module.exports = { DEFAULT_DEV_FEE_PCT, loadConfig, problems, isKey, parseSecretKey, VWFEST_MINT, DEV_WALLET, WSOL, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ATA_PROGRAM, MEMO_PROGRAM, MPL_CORE_PROGRAM, JUPITER_PROGRAM };
