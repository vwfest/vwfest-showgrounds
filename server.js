// VW FEST SHOW GROUNDS server: static client + tiny read-only API + WebSocket world hub (up to 150 people).
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
require('./lib/secret'); // fails fast in production without SERVER_SECRET
const chain = require('./lib/chain'); const { NftAvatars } = require('./lib/nftavatar'); const { DJ } = require('./lib/dj'); // Solana payments module (solana/): quotes + on-chain verification (INTERFACES.md §1)
const walletauth = require('./lib/walletauth');
const { WebSocketServer } = require('ws');
const { Hub } = require('./lib/hub');
const { Burns, isSig } = require('./lib/burns');
const { Profiles } = require('./lib/profiles');
const { Rides, serverSeed, commitOf } = require('./lib/rides');
const { Pay } = require('./lib/pay');
const { catalog } = require('./lib/shop');
const { ridesvg, placeholder } = require('./lib/ridesvg');
const R = require('./shared/rides');
const avatar = require('./lib/avatar');

const onramp = require('./lib/onramp');
const { Vendors, checkJpeg } = require('./lib/vendors');
const guide = require('./lib/guide');
const GAMES = require('./shared/games');
const PROD = process.env.NODE_ENV === 'production';
let REQUIRE_PROOF = true; // set below once the network is known: HARD-ON for mainnet (REQUIRE_WALLET_PROOF=0 only works on test networks)
const VOICE_RANGE = Number.isFinite(+process.env.VOICE_RANGE) && +process.env.VOICE_RANGE > 0 ? +process.env.VOICE_RANGE : 15;
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(+v) ? d : +v);
const PORT = num(process.env.PORT, 3000);
// ONE network decision shared with solana/ (it reads SOLANA_NETWORK || MINT_NETWORK). They must agree, and a missing/typo'd value falls back to devnet (no real money), never to mainnet.
const NETS = ['mainnet-beta', 'devnet', 'localnet'];
const DISAGREE = process.env.SOLANA_NETWORK && process.env.MINT_NETWORK && process.env.SOLANA_NETWORK !== process.env.MINT_NETWORK;
if (DISAGREE) console.error(`[network] SOLANA_NETWORK (${process.env.SOLANA_NETWORK}) and MINT_NETWORK (${process.env.MINT_NETWORK}) disagree: using devnet (no real money) until they match.`);
const NETWORK = !DISAGREE && NETS.includes(process.env.SOLANA_NETWORK || process.env.MINT_NETWORK) ? (process.env.SOLANA_NETWORK || process.env.MINT_NETWORK) : 'devnet';
REQUIRE_PROOF = NETWORK === 'mainnet-beta' || process.env.REQUIRE_WALLET_PROOF !== '0'; if (NETWORK === 'mainnet-beta' && process.env.REQUIRE_WALLET_PROOF === '0') console.warn('[security] REQUIRE_WALLET_PROOF=0 is ignored on mainnet: wallet proof is mandatory for purchases.');
if (!NETS.includes(process.env.SOLANA_NETWORK || process.env.MINT_NETWORK)) console.warn('[network] SOLANA_NETWORK/MINT_NETWORK missing or invalid: using devnet');
process.env.SOLANA_NETWORK = NETWORK; process.env.MINT_NETWORK = NETWORK;
const RPC_DEFAULT = { 'mainnet-beta': 'https://api.mainnet-beta.solana.com', devnet: 'https://api.devnet.solana.com', localnet: 'http://127.0.0.1:8899' };
const cfg = {
  maxPlayers: num(process.env.MAX_PLAYERS, 150), maxConns: num(process.env.MAX_CONNS, 400), maxConnsPerIp: num(process.env.MAX_CONNS_PER_IP, 25),
  walkSpeed: 9, carSpeed: 20, idleMs: num(process.env.IDLE_MINUTES, 10) * 60000, globalCooldownMs: num(process.env.GLOBAL_CHAT_COOLDOWN_MS, 4000),
};
const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
// Env bridge for solana/: our historical names -> its names. Avatar/ride mints are 100% buyback & burn (no creator fee); the fee applies to shop/vendor SOL/token payments only.
if (process.env.MINT_DEV_FEE === undefined) process.env.MINT_DEV_FEE = '0';
if (!process.env.RPC_URL && process.env.SOLANA_RPC_URL) process.env.RPC_URL = process.env.SOLANA_RPC_URL;
// Server-side RPC on mainnet via Helius (HELIUS_API_KEY is a Render secret: used only for RPC_URL, which never reaches browsers). Devnet keeps the public devnet RPC.
if (!process.env.RPC_URL && process.env.HELIUS_API_KEY && NETWORK === 'mainnet-beta') process.env.RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(process.env.HELIUS_API_KEY.trim());
// "Continue with Google" (Web3Auth): the client ID is public by design (it is shipped to every browser). This is the Sapphire DEVNET project, so it is only a default on devnet;
// set WEB3AUTH_CLIENT_ID (+ WEB3AUTH_NETWORK=sapphire_mainnet) to override, or WEB3AUTH_CLIENT_ID=off to disable.
if (NETWORK === 'devnet' && process.env.WEB3AUTH_CLIENT_ID === undefined) { process.env.WEB3AUTH_CLIENT_ID = 'BGa81203zpBLcIz_Fq8OYie2IHJGc1MtgPZMG8GjlpwXUciSqaoJyaqL8C0vWQXcnxlQXXGBN1ey7mOvvD4OdFE'; if (!process.env.WEB3AUTH_NETWORK) process.env.WEB3AUTH_NETWORK = 'sapphire_devnet'; }
if (process.env.WEB3AUTH_CLIENT_ID === 'off') delete process.env.WEB3AUTH_CLIENT_ID;
if (!process.env.PUBLIC_BASE_URL) process.env.PUBLIC_BASE_URL = publicUrl;
// ---- avatar-minting config. OFF unless MINT_ENABLED=1 (and, on mainnet, MINT_MAINNET=1 as a second deliberate switch). ----
const mint = {
  network: NETWORK, rpcUrl: process.env.RPC_URL || process.env.SOLANA_RPC_URL || RPC_DEFAULT[NETWORK], mint: (NETWORK === 'mainnet-beta' ? process.env.VWFEST_MINT : (process.env.DEVNET_VWFEST_MINT || process.env.VWFEST_MINT)) || '', decimals: num(process.env.VWFEST_DECIMALS, 6),
  feeUsd: num(process.env.MINT_FEE_USD, 5), rideUsd: num(process.env.RIDE_MINT_USD, 5), slippageBps: Math.min(Math.max(num(process.env.MINT_SLIPPAGE_BPS, 50), 10), 500),
  devWallet: (() => { const w = process.env.DEV_WALLET || require('./solana/src/config').loadConfig(process.env).devWallet; return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w || '') ? w : ''; })(), devFeePct: Math.min(Math.max(num(process.env.DEV_FEE_PCT, 10), 0), 50), discountPct: Math.min(Math.max(num(process.env.VWFEST_DISCOUNT_PCT, 50), 0), 90), devnetTokensPerUsd: num(process.env.DEVNET_TOKENS_PER_USD, 10), fixedSolUsd: num(process.env.FIXED_SOL_USD, 0),
  devnetBurn: num(process.env.DEVNET_BURN_TOKENS, 1),
  jupiter: process.env.JUPITER_BASE || 'https://lite-api.jup.ag/swap/v1',
  explorer(id, kind) { const q = NETWORK === 'devnet' ? '?cluster=devnet' : ''; return NETWORK === 'localnet' ? null : `https://solscan.io/${kind}/${id}${q}`; },
};
// Embedded wallet (Google sign-in -> non-custodial Solana wallet) via Web3Auth / MetaMask Embedded Wallets. The client id is public by design.
mint.embedded = process.env.WEB3AUTH_CLIENT_ID ? { provider: 'web3auth', clientId: process.env.WEB3AUTH_CLIENT_ID, network: NETWORK === 'mainnet-beta' ? 'sapphire_mainnet' : 'sapphire_devnet' } : null; // coupled to the Solana network: a devnet server never talks to the Web3Auth mainnet network (and vice versa)
mint.entryUsd = num(process.env.ENTRY_ONRAMP_USD, mint.feeUsd); mint.entryMinBurnPct = 102; // no entry discount: a card/transfer top-up must cover the full price (+2% for fees); the server quotes the normal burn
mint.payTokens = (() => { const d = [['USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6], ['USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6], ['BONK', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 5], ['JUP', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 6]].map(([sym, mint, dec]) => ({ sym, mint, dec })); try { const e = JSON.parse(process.env.PAY_TOKENS || 'null'); if (Array.isArray(e)) return e.filter((t) => t && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t.mint) && /^[A-Za-z0-9]{1,10}$/.test(t.sym) && t.dec >= 0 && t.dec <= 12).slice(0, 12); } catch {} return d; })();
const vcfg = { feeUsd: num(process.env.VENDOR_FEE_USD, 30), days: Math.min(Math.max(Math.round(num(process.env.VENDOR_DAYS, 30)), 1), 365), plots: Math.min(Math.max(Math.round(num(process.env.VENDOR_BOOTHS, 24)), 4), 24), imgKb: Math.min(Math.max(num(process.env.VENDOR_IMG_KB, 150), 20), 400), autoHide: Math.max(Math.round(num(process.env.VENDOR_AUTOHIDE_REPORTS, 3)), 2), premod: process.env.VENDOR_PREMOD === '1', maxProducts: 6 };
const ADMIN_SECRET = process.env.ADMIN_SECRET && process.env.ADMIN_SECRET.length >= 16 ? process.env.ADMIN_SECRET : '';
mint.enabled = process.env.MINT_ENABLED === '1' && !!mint.mint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint.mint) && (NETWORK !== 'mainnet-beta' || process.env.MINT_MAINNET === '1');
mint.reason = mint.enabled ? null : (process.env.MINT_ENABLED !== '1' ? 'off' : !mint.mint ? 'VWFEST_MINT missing' : 'mainnet not armed');
const ORIGINS = new Set(['https://vwfest.github.io', 'https://vwfestmemecoin.com', 'https://www.vwfestmemecoin.com', ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
if (process.env.RENDER_EXTERNAL_URL) ORIGINS.add(process.env.RENDER_EXTERNAL_URL.replace(/\/$/, ''));
if (!PROD) { ORIGINS.add(`http://127.0.0.1:${PORT}`); ORIGINS.add(`http://localhost:${PORT}`); }

const hub = new Hub(cfg);
const burns = new Burns({ network: NETWORK, mint: mint.mint, decimals: mint.decimals, rpcUrl: mint.rpcUrl, explorer: mint.explorer.bind(mint), base: publicUrl });
const profiles = new Profiles((code) => burns.mintedBy(code));
const nftav = new NftAvatars({ hub, profiles, env: process.env, publicUrl: publicUrl, db: (sql, params) => { if (!profiles.q) throw new Error('no db'); return profiles.q(sql, params); } });
const { Moderation } = require('./lib/moderation'); const mod = new Moderation(); hub.mod = mod;
const dj = new DJ({ hub, env: process.env }); hub.onLeave = (p) => dj.drop(p);
const rides = new Rides();
const pay = new Pay(mint);
const SHOP = catalog();
const vendors = new Vendors({ plots: vcfg.plots, days: vcfg.days, imgKb: vcfg.imgKb, autoHide: vcfg.autoHide, premod: vcfg.premod });
const conns = new Set(), ipCount = new Map();
let burnVer = -1;

// ---- http ----
const app = express();
app.set('trust proxy', 1); app.disable('x-powered-by');
const { clientIp, useClientIp } = require('./lib/clientip'); useClientIp(app); // real client IP (CF-Connecting-IP) for every per-IP limiter: XFF's last entry is the Cloudflare EDGE, so everyone would share one bucket
const OWN_WS = (() => { try { const u = new URL(publicUrl); return u.protocol === 'https:' ? ['wss://' + u.host] : []; } catch { return []; } })(); // this server only (was wss://*.onrender.com: any Render app)
const PUBLIC_RPC = (() => { const u = process.env.PUBLIC_RPC_URL || RPC_DEFAULT[NETWORK]; try { const x = new URL(u); if (x.searchParams.has('api-key') || x.username || x.password || u === mint.rpcUrl && mint.rpcUrl !== RPC_DEFAULT[NETWORK]) return RPC_DEFAULT[NETWORK]; } catch { return RPC_DEFAULT[NETWORK]; } return u; })(); // what browsers broadcast through (never the keyed server RPC)
const RPC_HOSTS = ["'self'", ...(() => { try { return [new URL(PUBLIC_RPC).origin]; } catch { return []; } })()]; // from the SANITISED public RPC (a keyed PUBLIC_RPC_URL never reaches the CSP)
const W3A = require('./shared/w3a'); // only allowed when an embedded-wallet client id is configured
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", "'wasm-unsafe-eval'"], styleSrc: ["'self'"], styleSrcAttr: ["'unsafe-inline'"], // inline style ATTRIBUTES only (the Web3Auth frame sets them); <style> elements stay blocked
       imgSrc: ["'self'", 'data:', 'blob:', 'https://vwfestmemecoin.com'], fontSrc: ["'self'", 'data:'],
      connectSrc: [...RPC_HOSTS, ...(mint.embedded ? W3A : []), ...OWN_WS, 'https://lite-api.jup.ag', 'https://api.coinbase.com', ...(PROD ? [] : ['ws://127.0.0.1:*', 'ws://localhost:*'])],
      frameAncestors: (process.env.FRAME_ANCESTORS || "'none'").split(',').map((x) => x.trim()).filter(Boolean), // nobody may frame the pages we serve (clickjacking); FRAME_ANCESTORS lists exceptions
      frameSrc: mint.embedded ? W3A.filter((x) => x.startsWith('https:')) : ["'none'"], workerSrc: ["'self'", 'blob:'], mediaSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"],
      upgradeInsecureRequests: PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' }, frameguard: false, referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
// Browser features this site never needs are switched off for it and for anything it embeds. Microphone stays on for this origin only (proximity voice / DJ mic; the browser still asks the player).
app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()'); next(); });
app.use(compression());
const cors = (req, res, next) => {
  const o = req.get('origin');
  if (o && ORIGINS.has(o)) { res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin'); res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.set('Access-Control-Allow-Headers', 'content-type,x-rpc-token'); res.set('Access-Control-Max-Age', '600'); }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
};
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use('/api', rateLimit({ windowMs: 60e3, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }), cors);
const mem0 = () => process.memoryUsage().rss;
app.get('/api/status', (req, res) => {
  const s = hub.stats; res.set('Cache-Control', 'public, max-age=3').json({ ok: true, profiles: profiles.size, rides: rides.byId.size, online: hub.size, cap: cfg.maxPlayers, full: hub.size >= cfg.maxPlayers, uptime: Math.round(process.uptime()), burned: burns.summary(0).totalBurned,
    perf: { cpu: process.cpuUsage(), rss: mem0(), tx: s.tx, rx: s.rx, snaps: s.snaps, avgTickMs: s.ticks ? s.tickMsSum / s.ticks : 0, rejectedMoves: s.rejectedMoves, kicks: s.kicks } });
});
app.get('/api/burns', (req, res) => res.set('Cache-Control', 'public, max-age=5').json({ ok: true, ...burns.summary(Math.min(+req.query.limit || 15, 50)) }));
// Public STUN only goes out to everyone. TURN is a paid relay: its credentials are minted per session (short-lived HMAC, coturn use-auth-secret) and only after the player opts in to voice.
// There is NO static shared TURN user/password any more (TURN_USERNAME/TURN_CREDENTIAL are ignored): set TURN_URL + TURN_SECRET.
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const TURN_TTL = Math.min(3600, Math.max(60, num(process.env.TURN_TTL_SEC, 900)));
const iceServers = (p, now = Date.now()) => {
  const out = STUN.slice(); const urls = (process.env.TURN_URL || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (p && urls.length && process.env.TURN_SECRET && process.env.TURN_SECRET.length >= 16) { const user = `${Math.floor(now / 1000) + TURN_TTL}:s${p.id}`; out.push({ urls, username: user, credential: crypto.createHmac('sha1', process.env.TURN_SECRET).update(user).digest('base64') }); }
  return out;
};
const shopView = () => SHOP.map((i) => ({ ...i, vwfestUsd: Math.round(i.usd * (1 - mint.discountPct / 100) * 100) / 100 }));
const payFlags = () => ({ dj: { on: dj.enabled && dj.playlist.length > 0, slotMs: dj.slotMs, queueMax: dj.queueMax }, nftAvatars: nftav.enabled, publicRpcUrl: PUBLIC_RPC, enabled: mint.enabled, reason: mint.reason, network: mint.network, mint: mint.mint, decimals: mint.decimals, feeUsd: mint.feeUsd, rideUsd: mint.rideUsd, slippageBps: mint.slippageBps, discountPct: mint.discountPct, devFeePct: mint.devFeePct, solShopEnabled: !!mint.devWallet, jupiter: mint.jupiter, embedded: mint.embedded, onramp: onramp.providers().map(({ id, name, how }) => ({ id, name, how })), entryUsd: mint.entryUsd, entryMinBurnPct: mint.entryMinBurnPct, payTokens: mint.payTokens, devnetTokensPerUsd: mint.devnetTokensPerUsd, base: publicUrl, vendor: { feeUsd: vcfg.feeUsd, days: vcfg.days, plots: vcfg.plots, imgKb: vcfg.imgKb, maxProducts: vcfg.maxProducts, devFeePct: mint.devFeePct, solAvailable: !!mint.devWallet, premod: vcfg.premod } });
app.get('/api/config', (req, res) => res.set('Cache-Control', 'no-store').json({
  ...payFlags(), shop: shopView(), odds: R.TIERS.map((t, i) => ({ tier: t, pct: R.ODDS[i] })), iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }], turn: !!process.env.TURN_URL, /* TURN credentials are only sent over the authenticated WebSocket after join */ voiceRange: VOICE_RANGE, maxPlayers: cfg.maxPlayers,
}));
app.get('/api/mint/config', (req, res) => res.set('Cache-Control', 'no-store').json({ ...payFlags(), shop: undefined }));
app.get('/api/rides', (req, res) => res.set('Cache-Control', 'public, max-age=10').json({ ok: true, count: rides.byId.size, recent: rides.recent(12).map(pubRide) }));
app.get('/api/mint/price', async (req, res) => { try { res.set('Cache-Control', 'no-store').json({ ok: true, usd: await chain.solUsd() }); } catch { res.status(503).json({ ok: false, error: 'Price unavailable' }); } });
// Fiat on-ramp checkout link for the player's own wallet. Origin-locked + tightly rate-limited; the provider (not us) takes the card and delivers SOL to that address.
app.post('/api/onramp/session', (req, res) => res.status(410).json({ error: 'Moved: the on-ramp is requested over the authenticated game connection' })); // was HTTP + client-supplied address; now WebSocket 'onramp' + the session's proven wallet only


// ---- Info Booth guide: docs/info.json + CHANGELOG.md rendered with LIVE config values ----
const guideValues = () => guide.values({ mint, vendor: vcfg, shop: SHOP, R, voiceRange: VOICE_RANGE, maxPlayers: cfg.maxPlayers, dj });
let guideSrc = null; try { guideSrc = guide.load(); } catch (e) { console.error('guide files missing', e.message); }
app.get('/api/guide', (req, res) => {
  if (!guideSrc) return res.status(503).json({ ok: false }); const v = guideValues(); const g = guide.render(guideSrc.info, v, { R, games: GAMES });
  res.set('Cache-Control', 'public, max-age=30').json({ ok: true, sections: g.sections, changelog: guide.changelog(guideSrc.md, v), values: v, enabled: mint.enabled, network: mint.network });
});
// ---- Vendor Row ----
const vauth = (b) => { if (!b || typeof b.id !== 'string' || typeof b.secret !== 'string') return null; return profiles.login(b.id, b.secret); };
const vLimit = rateLimit({ windowMs: 60e3, limit: num(process.env.VENDOR_RATE_LIMIT, 20), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } });
const vOrigin = (req, res, next) => { const o = req.get('origin'); if (!o || !ORIGINS.has(o)) return res.status(403).json({ error: 'forbidden' }); next(); };
app.get('/api/vendors', (req, res) => res.set('Cache-Control', 'public, max-age=5').json({ ok: true, v: vendors.version, plots: vcfg.plots, list: vendors.list() }));
app.get('/api/vendors/:plot', (req, res) => { const d = vendors.detail(req.params.plot); if (!d) return res.status(404).json({ ok: false }); res.set('Cache-Control', 'public, max-age=5').json({ ok: true, booth: d }); });
app.get('/vendor/img/:id.jpg', (req, res) => {
  const id = req.params.id; const im = /^[0-9a-f]{20}$/.test(id) && vendors.images.get(id); if (!im || !vendors.imageVisible(id)) return res.status(404).type('text').send('Not found');
  res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'public, max-age=300', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(im.buf);
});
app.post('/api/vendor/img', vLimit, vOrigin, express.json({ limit: '420kb' }), async (req, res) => {
  const p = vauth(req.body); if (!p) return res.status(401).json({ ok: false, why: 'Please sign in again.' }); const b = vendors.byPid.get(p.id); if (!b || b.removed || vendors.state(b) === 'free') return res.status(403).json({ ok: false, why: 'You do not have an active booth.' });
  if (typeof req.body.data !== 'string' || req.body.data.length > 600000 || !/^[A-Za-z0-9+/=]+$/.test(req.body.data)) return res.status(400).json({ ok: false, why: 'Bad image data' });
  const buf = Buffer.from(req.body.data, 'base64'); const chk = checkJpeg(buf, vcfg.imgKb * 1024, 1100); if (!chk.ok) return res.status(400).json(chk);
  const r = vendors.addImage(p.id, buf); if (!r.ok) return res.status(429).json(r); res.json({ ok: true, id: r.id });
});
app.post('/api/vendor/save', vLimit, vOrigin, express.json({ limit: '8kb' }), async (req, res) => {
  const p = vauth(req.body); if (!p) return res.status(401).json({ ok: false, why: 'Please sign in again.' }); const r = vendors.edit(p.id, req.body);
  if (!r.ok) return res.status(400).json(r); for (const id of r.persist) await vendors.persistImage(id); await vendors.save(r.booth); broadcastVendors(); res.json({ ok: true, mine: vendors.mine(p.id) });
});
app.post('/api/vendor/mine', vLimit, vOrigin, express.json({ limit: '1kb' }), (req, res) => { const p = vauth(req.body); if (!p) return res.status(401).json({ ok: false }); res.set('Cache-Control', 'no-store').json({ ok: true, mine: vendors.mine(p.id) }); });
app.post('/api/vendor/report', vLimit, vOrigin, express.json({ limit: '1kb' }), async (req, res) => {
  const p = vauth(req.body); if (!p) return res.status(401).json({ ok: false, why: 'Please sign in again.' }); const r = vendors.report(p.id, req.body.plot); if (!r.ok) return res.status(400).json(r);
  console.warn(`[vendor] report plot ${req.body.plot} by ${p.id} (${r.count} total${r.auto ? ', AUTO-HIDDEN' : ''})`); await vendors.save(r.booth); if (r.auto) broadcastVendors(); res.json({ ok: true });
});
// Moderation API. Disabled unless ADMIN_SECRET (>= 16 chars) is set. Send it in the x-admin-secret header.
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest(); // compare fixed-length digests: no length leak
const adminAuth = (req, res, next) => { if (!ADMIN_SECRET) return res.status(404).end(); if (!crypto.timingSafeEqual(sha(req.get('x-admin-secret') || ''), sha(ADMIN_SECRET))) return res.status(401).json({ error: 'unauthorized' }); next(); };
const adminLimit = rateLimit({ windowMs: 60e3, limit: 30, standardHeaders: true, legacyHeaders: false });
app.get('/api/admin/dj', adminLimit, adminAuth, (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, ...dj.view(), queueFull: dj.queue.map((q) => ({ id: q.id, nick: q.nick })) }));
app.post('/api/admin/dj', adminLimit, adminAuth, express.json({ limit: '1kb' }), (req, res) => { const r = dj.admin(String((req.body && req.body.action) || '')); res.status(r.ok ? 200 : 400).json(r); }); // action: release (end current set) | clear (empty queue) | next (skip track)
// Moderation: mute/unmute (chat, voice signaling, DJ mic), kick, ban/unban (join, also by IP). `pid` = profile id (VW-...) or the numeric session id of an online player; `minutes` 1..525600.
app.get('/api/admin/mod', adminLimit, adminAuth, (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, ...mod.list(), online: [...hub.players.values()].map((q) => ({ sid: q.id, pid: q.prof.id, nick: q.nick })) }));
app.post('/api/admin/mod', adminLimit, adminAuth, express.json({ limit: '1kb' }), (req, res) => {
  const b = req.body || {}; const action = String(b.action || ''); const ref = b.pid;
  const online = Number.isInteger(ref) ? hub.players.get(ref) : typeof ref === 'string' ? hub.find(ref) : null; const pid = online ? online.prof.id : typeof ref === 'string' && /^[\w-]{3,40}$/.test(ref) ? ref : null;
  if (!pid) return res.status(400).json({ ok: false, why: 'pid must be a profile id or the session id of an online player' });
  const minutes = Moderation.minutes(b.minutes, action === 'ban' ? 1440 : 60);
  if (action === 'mute') { mod.mute(pid, minutes); if (online) { online.voice = false; hub.json(online.conn, { t: 'toast', text: 'A moderator has muted you.' }); } }
  else if (action === 'unmute') mod.unmute(pid);
  else if (action === 'kick') { if (!online) return res.status(404).json({ ok: false, why: 'not online' }); }
  else if (action === 'ban') mod.ban(pid, minutes, online && online.conn.ip);
  else if (action === 'unban') { mod.unban(pid); if (b.ip && typeof b.ip === 'string') mod.unbanIp(b.ip); }
  else return res.status(400).json({ ok: false, why: 'action: mute | unmute | kick | ban | unban' });
  if ((action === 'kick' || action === 'ban') && online) { hub.json(online.conn, { t: 'kick', why: action === 'ban' ? 'You were banned by a moderator.' : 'You were removed by a moderator.' }); const w = online.conn.ws; setTimeout(() => w.close(1008, action), 100); hub.leave(online); }
  console.warn(`[admin] mod ${action} ${pid} ${action === 'mute' || action === 'ban' ? minutes + 'min' : ''}`); res.json({ ok: true, action, pid, minutes: action === 'mute' || action === 'ban' ? minutes : undefined });
});
app.get('/api/admin/vendors', adminLimit, adminAuth, (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, booths: vendors.adminList() }));
app.get('/api/admin/vendors/:plot/image/:id', adminLimit, adminAuth, (req, res) => { const im = /^[0-9a-f]{20}$/.test(req.params.id) && vendors.images.get(req.params.id); if (!im) return res.status(404).end(); res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(im.buf); });
app.post('/api/admin/vendors/:plot', adminLimit, adminAuth, express.json({ limit: '1kb' }), async (req, res) => {
  const r = vendors.admin(req.params.plot, req.body && req.body.action, req.body && req.body.days); if (!r.ok) return res.status(400).json(r); await vendors.save(r.booth); broadcastVendors(); console.warn(`[admin] vendor ${req.params.plot}: ${req.body.action}`); res.json({ ok: true, booth: vendors.adminList().find((x) => x.plot === +req.params.plot) });
});
// READ-ONLY JSON-RPC proxy (hides the keyed server RPC from the browser). By design there is NO way to send or simulate transactions through this server:
// players broadcast with their own wallet / PUBLIC_RPC_URL (solana/README: "no tx relay"). Origin-locked; /api limiter applies.
// Session-bound: only a player with a live, JOINED game socket holds a token (issued over the WS in `welcome`, rotated via {t:'rpctok'}, short-lived, bound to pid/sid and the joining Origin, revoked when the socket closes).
// Public/anonymous callers get 401 and use PUBLIC_RPC_URL directly (the client falls back to it). Budgets: per session, per IP and global; batches and getMultipleAccounts key counts are capped (lib/rpcguard.js).
const { RpcGuard } = require('./lib/rpcguard');
const rpcGuard = new RpcGuard({ ttlSec: num(process.env.RPC_TOKEN_TTL_SEC, 600), perSession: num(process.env.RPC_SESSION_PER_MIN, 60), perIp: num(process.env.RPC_IP_PER_MIN, 120), global: num(process.env.RPC_GLOBAL_PER_MIN, 3000), maxBatch: num(process.env.RPC_MAX_BATCH, 5), maxKeys: num(process.env.RPC_MAX_ACCOUNTS, 25) });
const budgets = new Map(); // (profile creation etc.)
const budget = (key, limit, windowMs = 60e3) => { const now = Date.now(); const a = (budgets.get(key) || []).filter((t) => now - t < windowMs); if (a.length >= limit) { budgets.set(key, a); return false; } a.push(now); budgets.set(key, a); return true; };
setInterval(() => { const now = Date.now(); for (const [k, a] of budgets) if (!a.length || now - a[a.length - 1] > 120e3) budgets.delete(k); }, 60e3).unref();
const RPC_KEY = (() => { try { return new URL(mint.rpcUrl).searchParams.get('api-key') || ''; } catch { return ''; } })();
const scrubRpc = (t) => { let o = String(t).split(mint.rpcUrl).join('***'); if (RPC_KEY) o = o.split(RPC_KEY).join('***'); return o; }; // the keyed URL / key never leaves the server, even inside an upstream error body
const rpcUp = async (it) => {
  const r = await fetch(mint.rpcUrl, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: it.id, method: it.method, params: it.params }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { status: r.status === 429 ? 503 : 502 };
  const t = await r.text(); if (t.length > 4e6) return { status: 502 }; return { status: 200, text: scrubRpc(t) };
};
app.post('/api/rpc', rateLimit({ windowMs: 60e3, limit: num(process.env.RPC_PROXY_PER_MIN, 90), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }), express.json({ limit: '8kb' }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const o = req.get('origin'); if (!o || !ORIGINS.has(o)) return res.status(403).json({ error: 'forbidden' });
  const v = rpcGuard.verify(String(req.get('x-rpc-token') || ''), o); if (!v.ok) return res.status(v.status).json({ error: v.error });
  const pr = rpcGuard.parse(req.body); if (!pr.ok) return res.status(pr.status).json({ error: pr.error });
  if (!rpcGuard.charge(v.session, ipOf(req), pr.cost)) return res.status(429).json({ error: 'Too many requests' });
  try {
    if (!Array.isArray(req.body)) { const r = await rpcUp(pr.items[0]); return r.text ? res.status(200).type('json').send(r.text) : res.status(r.status).json({ error: 'rpc unavailable' }); }
    const rs = await Promise.all(pr.items.map((it) => rpcUp(it))); if (rs.some((r) => !r.text)) return res.status(502).json({ error: 'rpc unavailable' });
    res.type('json').send('[' + rs.map((r) => r.text).join(',') + ']');
  } catch { res.status(502).json({ error: 'rpc unavailable' }); }
});
// NFT metadata. Avatars are stateless: the code in the URL *is* the trait set. Rides are served from the reveal record (placeholder until the mint confirms).
const pubRide = (r) => ({ id: r.id, code: r.code, spec: r.spec, desc: R.describe(r.spec), asset: r.asset, sig: r.sig, url: mint.explorer(r.sig, 'tx'), assetUrl: r.asset ? mint.explorer(r.asset, 'address') : null, ts: r.ts, commit: r.commit, seed: r.seed, reroll: r.reroll });
const nftHead = (res) => res.set('Access-Control-Allow-Origin', '*');
nftav.mount(app, (req, res, next) => next());
app.get('/nft/:file', (req, res) => {
  const m = /^([A-Za-z0-9_-]+)\.(json|svg)$/.exec(req.params.file); const a = m && avatar.unpack(m[1]);
  if (!a) return res.status(404).type('text').send('Not found');
  nftHead(res).set('Cache-Control', 'public, max-age=86400, immutable');
  if (m[2] === 'svg') return res.type('image/svg+xml').send(avatar.svg(a));
  res.type('json').send(JSON.stringify({
    name: 'VW FEST Avatar', symbol: 'VWFAV', description: 'A unique VW FEST SHOW GROUNDS avatar for the $VWFEST community. Minting it burned $VWFEST. One mint per unique trait set.',
    image: `${publicUrl}/nft/${m[1]}.svg`, external_url: 'https://vwfest.github.io/vwfest-arcade/', attributes: avatar.attrs(a),
    properties: { files: [{ uri: `${publicUrl}/nft/${m[1]}.svg`, type: 'image/svg+xml' }], category: 'image' },
  }));
});
app.get('/ride/:file', (req, res) => {
  const m = /^(q[0-9a-f]{14})\.(json|svg)$/.exec(req.params.file); if (!m) return res.status(404).type('text').send('Not found');
  nftHead(res); const r = rides.byId.get(m[1]);
  res.set('Cache-Control', r ? 'public, max-age=3600' : 'no-store');
  if (m[2] === 'svg') return res.type('image/svg+xml').send(r ? ridesvg(r.spec) : placeholder());
  const base = { symbol: 'VWRIDE', external_url: 'https://vwfest.github.io/vwfest-arcade/', image: `${publicUrl}/ride/${m[1]}.svg`, properties: { files: [{ uri: `${publicUrl}/ride/${m[1]}.svg`, type: 'image/svg+xml' }], category: 'image' }, collection: { name: 'VW Fest Show Grounds Rides' } };
  if (!r) return res.type('json').send(JSON.stringify({ ...base, name: 'VW Fest Ride (mystery)', description: 'Mystery ride. It is revealed when the mint transaction confirms.', attributes: [{ trait_type: 'Status', value: 'Unrevealed' }] }));
  const d = R.describe(r.spec);
  res.type('json').send(JSON.stringify({ ...base, name: `VW Fest Ride ${d.build}`, description: `A ${d.tier} ${d.model} from the VW Fest Show Grounds. Every ride carries a VWFEST plate. Randomness is commit-reveal: commit ${r.commit}, server seed ${r.seed}, final seed = SHA256(seed + ":" + mint tx signature)${r.reroll ? ' + "#' + r.reroll + '" re-roll counter' : ''}.`,
    attributes: [{ trait_type: 'Rarity', value: d.tier }, { trait_type: 'Model', value: d.model }, { trait_type: 'Paint', value: d.paint }, { trait_type: 'Color', value: d.color }, { trait_type: 'Second tone', value: d.second }, { trait_type: 'Wheels', value: d.wheels }, { trait_type: 'Stance', value: d.stance }, { trait_type: 'Lowrider', value: d.lowrider ? 'Yes' : 'No' }, { trait_type: 'Plate', value: d.plate }, { trait_type: 'Plate text', value: 'VWFEST' }, { trait_type: 'Build', value: d.build }, ...d.extras.map((e) => ({ trait_type: 'Extra', value: e })), { trait_type: 'Commit', value: r.commit }],
  }));
});
const chainRouter = express.Router(); app.use(chainRouter); // solana/ compat routes (/api/burns, /api/mint/config|price are served by the handlers above first)
app.use((req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : res.status(405).end()));
app.use(express.static(path.join(__dirname, 'docs'), { maxAge: PROD ? '10m' : 0, index: 'index.html' }));
app.use((req, res) => res.status(404).type('text').send('Not found'));

// ---- websocket ----
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 6144, perMessageDeflate: false });
const ipOf = (req) => String(clientIp(req) || '?').slice(0, 64);
server.on('upgrade', (req, socket, head) => {
  const reject = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  let url; try { url = new URL(req.url, 'http://x'); } catch { return reject(400, 'Bad Request'); }
  if (url.pathname !== '/ws') return reject(404, 'Not Found');
  const origin = req.headers.origin; if (!origin || !ORIGINS.has(origin)) return reject(403, 'Forbidden');
  const ip = ipOf(req);
  if (conns.size >= cfg.maxConns || (ipCount.get(ip) || 0) >= cfg.maxConnsPerIp) return reject(429, 'Too Many Requests');
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, ip, origin));
});
const str = (v, max) => typeof v === 'string' && v.length <= max;
function cleanSignal(k, d) {
  if (k === 'bye') return 1;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  if (k === 'offer' || k === 'answer') { // {type, sdp}: audio-only SDP, no data channels / video, bounded
    if (d.type !== k || !str(d.sdp, 4000) || !d.sdp.startsWith('v=0') || /^m=(video|application|text|message)/m.test(d.sdp) || !/^m=audio/m.test(d.sdp) || /[^\x09\x0a\x0d\x20-\x7e]/.test(d.sdp)) return null;
    return { type: d.type, sdp: d.sdp };
  }
  // ice: {candidate, sdpMid, sdpMLineIndex, usernameFragment}
  if (!str(d.candidate, 400) || !/^candidate:[\x20-\x7e]+$/.test(d.candidate)) return null; const o = { candidate: d.candidate };
  if (d.sdpMid !== undefined && d.sdpMid !== null) { if (!str(d.sdpMid, 32)) return null; o.sdpMid = d.sdpMid; }
  if (d.sdpMLineIndex !== undefined && d.sdpMLineIndex !== null) { if (!Number.isInteger(d.sdpMLineIndex) || d.sdpMLineIndex < 0 || d.sdpMLineIndex > 3) return null; o.sdpMLineIndex = d.sdpMLineIndex; }
  if (d.usernameFragment !== undefined && d.usernameFragment !== null) { if (!str(d.usernameFragment, 64)) return null; o.usernameFragment = d.usernameFragment; }
  return o;
}
const RTC_MAX_FRAME = 4500; // an audio-only offer/answer is ~1-3 KB
function onConnect(ws, ip, origin) {
  const c = { ws, ip, origin, player: null, tokens: 30, last: Date.now(), mv: 30, mvLast: Date.now(), strikes: 0, alive: true, burning: false, lastBurn: 0, joinTimer: null, rtc: 20, rtcLast: Date.now(), mic: 40, micLast: Date.now(), micDrops: 0, joining: false };
  conns.add(c); ipCount.set(ip, (ipCount.get(ip) || 0) + 1);
  c.joinTimer = setTimeout(() => { if (!c.player) ws.close(1000, 'join timeout'); }, num(process.env.PREJOIN_MS, 20000));
  hub.json(c, { t: 'hi', online: hub.size, cap: cfg.maxPlayers, full: hub.size >= cfg.maxPlayers, burns: burns.summary(), mint: { enabled: mint.enabled } });
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (data, isBinary) => {
    const now = Date.now(); hub.stats.rx += data.length;
    if (isBinary) { // 0x04 = DJ microphone packet (own limits inside dj.relay); 0x01 = movement
      if (data[0] === 4) { // token bucket BEFORE any copy: 40 packets burst, 30/s sustained, and only the current DJ's frames are ever processed
        c.mic = Math.min(40, c.mic + ((now - c.micLast) / 1000) * 30); c.micLast = now; if (c.mic < 1) { if (++c.micDrops > 600) ws.close(1008, 'slow down'); return; } c.mic -= 1;
        if (c.player && data.length <= 4096 && dj.isDj(c.player)) dj.relay(c.player, Buffer.from(data)); return; }
      // movement: separate, generous bucket (20/s)
      c.mv = Math.min(30, c.mv + ((now - c.mvLast) / 1000) * 20); c.mvLast = now;
      if (c.mv < 1) return; c.mv -= 1;
      if (c.player) hub.onMove(c.player, Buffer.from(data)); return;
    }
    if (data.length > 6000) return;
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (m.t === 'rtc') { // WebRTC signaling has its own bucket (ICE bursts)
      if (data.length > RTC_MAX_FRAME) return; c.rtc = Math.min(20, c.rtc + ((now - c.rtcLast) / 1000) * 6); c.rtcLast = now; if (c.rtc < 1) { if (++c.strikes > 40) ws.close(1008, 'slow down'); return; } c.rtc -= 1;
    } else {
      if (data.length > 2500) return;
      c.tokens = Math.min(30, c.tokens + ((now - c.last) / 1000) * 6); c.last = now;
      if (c.tokens < 1) { if (++c.strikes > 40) ws.close(1008, 'slow down'); return; }
      c.tokens -= 1;
    }
    try { Promise.resolve(handle(c, m)).catch((e) => console.error('handler error', e && e.message)); } catch (e) { console.error('handler error', e && e.message); } // handle() is async: a rejection must never become an unhandledRejection (process exit)
  });
  ws.on('close', () => { clearTimeout(c.joinTimer); rpcGuard.revoke(c); conns.delete(c); const n = (ipCount.get(ip) || 1) - 1; if (n <= 0) ipCount.delete(ip); else ipCount.set(ip, n); if (c.player) hub.leave(c.player); });
  ws.on('error', () => {});
}
setInterval(() => { for (const c of conns) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch {} } }, 20000).unref();
let vSig = '';
const vendorMsg = () => ({ t: 'vendors', v: vendors.version, plots: vcfg.plots, list: vendors.list() });
function broadcastVendors() { const m = vendorMsg(); vSig = JSON.stringify(m.list); hub.all(m); }
setInterval(() => { const sig = JSON.stringify(vendors.list()); if (sig !== vSig) broadcastVendors(); }, 30000).unref(); // also catches expiries
setInterval(() => { if (burns.version !== burnVer) { burnVer = burns.version; hub.all({ t: 'burns', burns: burns.summary() }); } }, 2000).unref();

const ownedItems = (prof) => [...prof.items.keys()];
const profileCard = (q) => {
  const prof = q.prof;
  return { t: 'profile', sid: q.id, pid: prof.id, nick: prof.nick, av: prof.av, eq: prof.equipped || {}, created: prof.created, online: true, minted: burns.forProfile(prof.id), rides: rides.forProfile(prof.id).map(pubRide), items: prof.items.size, nf: q.nft ? { a: q.nft.asset, n: q.nft.name } : undefined };
};
const inv = (p) => ({ t: 'inv', items: ownedItems(p.prof), equipped: p.prof.equipped || {}, rides: rides.forProfile(p.prof.id).map(pubRide), ride: p.prof.ride || null });
const setRide = (p, id) => { const r = id ? rides.byId.get(id) : null; p.prof.ride = r && r.pid === p.prof.id ? id : null; p.rd = p.prof.ride ? r.spec : null; if (!p.rd) p.park = null; };

async function handle(c, m) {
  const p = c.player;
  switch (m.t) {
    case 'join': {
      if (p || c.joining) return; c.joining = true;
      try {
      if (mod.banned(null, c.ip)) { hub.json(c, { t: 'joinerr', err: 'banned', why: 'You are banned from the grounds.' }); return setTimeout(() => c.ws.close(1008, 'banned'), 200); }
      if (hub.size >= cfg.maxPlayers && !hub.find(typeof m.id === 'string' ? m.id : '')) { hub.json(c, { t: 'full', online: hub.size, cap: cfg.maxPlayers }); return setTimeout(() => c.ws.close(1000, 'full'), 200); }
      let prof = profiles.login(m.id, m.secret), created = null;
      if (prof && mod.banned(prof.id, c.ip)) { hub.json(c, { t: 'joinerr', err: 'banned', why: 'You are banned from the grounds.' }); return setTimeout(() => c.ws.close(1008, 'banned'), 200); }
      if (!prof) {
        if (typeof m.nick !== 'string' && m.id) return hub.json(c, { t: 'joinerr', err: 'stale', why: 'Your saved profile was not found. Pick a nickname to start a new one.' });
        if (!budget('mk:' + c.ip, num(process.env.PROFILE_CREATE_PER_HOUR, 5), 3600e3)) return hub.json(c, { t: 'joinerr', err: 'rate', why: 'Too many new profiles from your network. Try again later.' });
        const r = profiles.create(m.nick, m.quiz); if (!r.ok) return hub.json(c, { t: 'joinerr', err: r.err, why: r.why });
        prof = r.prof; created = { id: prof.id, secret: r.secret };
      }
      const r = hub.join(c, prof, burns.forProfile(prof.id).length > 0 || rides.forProfile(prof.id).length > 0);
      if (r.full) { hub.json(c, { t: 'full', online: hub.size, cap: cfg.maxPlayers }); return setTimeout(() => c.ws.close(1000, 'full'), 200); }
      if (r.err) return hub.json(c, { t: 'joinerr', err: r.err, why: r.why });
      clearTimeout(c.joinTimer); setRide(r.p, prof.ride); hub.json(c, vendorMsg()); nftav.restore && setTimeout(() => nftav.restore(r.p), 50); setTimeout(() => dj.hello(r.p), 80); hub.welcome(r.p, { rpcToken: rpcGuard.issue(c, r.p, c.origin), iceServers: STUN, cred: created, created: prof.created, inv: inv(r.p), vibe: prof.av.vibe });
      } finally { c.joining = false; }
      break;
    }
    case 'rpctok': { if (!p) return; const now = Date.now(); if (now - (p.lastRpcTok || 0) < 5000) return; p.lastRpcTok = now; hub.json(c, { t: 'rpctok', rpcToken: rpcGuard.issue(c, p, c.origin) }); break; } // rotate before expiry (client refreshes at ~60% of ttl)
    case 'chat': if (p) hub.onChat(p, m); break;
    case 'emote': if (p) hub.onEmote(p, m.id); break;
    case 'djclaim': { if (!p) return; const r = dj.claim(p); hub.json(c, { t: 'djres', ...r }); break; }
    case 'djleave': { if (!p) return; dj.leave(p); hub.json(c, { t: 'djres', ok: true, you: null }); break; }
    case 'djskip': if (p) dj.skip(p); break;
    case 'djpick': if (p) dj.setTrack(p, m.i); break;
    case 'djmic': if (p) dj.setMic(p, m.on); break;
    case 'djhype': if (p) dj.hype(p); break;
    case 'nfts': case 'nftuse': case 'nftclear': { // use-my-NFT avatar: wallet must have signed our challenge in this session (wauth/wproof)
      if (!p) return; const now = Date.now(); if (now - (p.lastNft || 0) < 1500) return hub.json(c, { t: 'nftres', ok: false, why: 'Slow down a little.' }); p.lastNft = now;
      if (m.t === 'nftclear') { nftav.clear(p); return hub.json(c, { t: 'nftres', ok: true, nf: null }); }
      const proven = typeof m.wallet === 'string' && p.proven && p.proven.get(m.wallet) > now; if (!proven) return hub.json(c, { t: 'nftres', ok: false, needProof: true, why: 'Verify your wallet first (free signature).' });
      (async () => { try {
        if (m.t === 'nfts') { const r = await nftav.list(m.wallet); hub.json(c, { t: 'nfts', ok: true, items: r.items, truncated: r.truncated }); }
        else { const r = await nftav.use(p, m.wallet, String(m.asset || '')); hub.json(c, { t: 'nftres', ...r }); }
      } catch (e) { hub.json(c, { t: m.t === 'nfts' ? 'nfts' : 'nftres', ok: false, why: /switched on/.test(e.message) ? e.message : 'Could not read that wallet right now. Try again in a minute.' }); } })(); break; }
    case 'av': { // avatar editor save: validated, and an exact duplicate of another profile's (or a minted) trait set is rejected
      if (!p || Date.now() - (p.lastAv || 0) < 800) return; p.lastAv = Date.now();
      const r = profiles.setAvatar(p.prof.id, m.av);
      if (r.ok) { p.prof.av = r.av; hub.setAvatar(p, r.av); }
      hub.json(c, { t: 'avres', ok: r.ok, why: r.why, av: r.ok ? r.av : p.av, code: r.code });
      break;
    }
    case 'profile': { const q = p && Number.isInteger(m.sid) ? hub.players.get(m.sid) : null; if (q && Date.now() - (p.lastCard || 0) > 400) { p.lastCard = Date.now(); hub.json(c, profileCard(q)); } break; }
    case 'equip': {
      if (!p) return; const it = typeof m.item === 'string' ? SHOP.find((x) => x.id === m.item) : null;
      if (m.item && (!it || !p.prof.items.has(it.id))) return hub.json(c, { t: 'toast', text: 'You do not own that item yet.' });
      const slot = it ? it.slot : ['hat', 'face', 'back', 'aura', 'glow'].includes(m.slot) ? m.slot : null; if (!slot) return;
      profiles.equip(p.prof.id, slot, it ? it.id : null); hub.refresh(p); hub.json(c, inv(p)); break;
    }
    case 'ride:equip': if (p) { setRide(p, typeof m.id === 'string' ? m.id : null); profiles.save(p.prof); hub.refresh(p); hub.json(c, inv(p)); } break;
    case 'park': { // leave your equipped ride parked where you stand (visible to everyone until you drive off or leave)
      if (!p) return; if (!m.on || !p.rd) { p.park = null; hub.refresh(p); break; }
      p.park = { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, yaw: Math.round(p.yaw * 100) / 100 }; hub.refresh(p); break;
    }
    case 'voice': { // opt-in: only now does this session get relay (TURN) credentials, and only players with voice on can exchange signaling
      if (!p || !budget('voice:' + p.id, 12)) return; const on = m.on === true; if (on && mod.muted(p.prof.id)) return hub.json(c, { t: 'toast', text: 'A moderator has muted you.' });
      p.voice = on; if (on) hub.json(c, { t: 'ice', iceServers: iceServers(p) }); else if (hub.players.size) for (const q of hub.players.values()) if (q.voice && q !== p && (q.x - p.x) ** 2 + (q.z - p.z) ** 2 <= (VOICE_RANGE + 40) ** 2) hub.json(q.conn, { t: 'rtc', from: p.id, k: 'bye', d: 1 });
      break;
    }
    case 'rtc': { // WebRTC voice signaling relay: both sides must have voice on, be near each other, not muted; the payload is rebuilt from an allow-list (never relayed as received)
      if (!p || !p.voice || !Number.isInteger(m.to) || !['offer', 'answer', 'ice', 'bye'].includes(m.k)) return;
      const q = hub.players.get(m.to); if (!q || q === p || !q.voice || mod.muted(p.prof.id)) return;
      if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 > (VOICE_RANGE + 12) ** 2) return;
      const d = cleanSignal(m.k, m.d); if (d === null) return;
      hub.json(q.conn, { t: 'rtc', from: p.id, k: m.k, d }); break;
    }
    case 'quote': {
      if (!p) return; const now = Date.now(); if (now - (p.lastQuote || 0) < 1200) return; p.lastQuote = now;
      if (!mint.enabled) return hub.json(c, { t: 'quoteerr', why: 'Purchases are not open yet.' });
      try {
        const kind = m.kind, method = m.method === 'vwfest' ? 'vwfest' : 'sol'; let usd, item = null, uri = null, code = null, entry = false, devPct = mint.devFeePct, discountPct = mint.discountPct, extra = {};
        if (kind === 'avatar') {
          if (method !== 'sol') return hub.json(c, { t: 'quoteerr', why: 'Avatar minting is paid in SOL (100% is used to buy back and burn $VWFEST).' });
          code = avatar.pack(p.av); if (burns.codes.has(code)) return hub.json(c, { t: 'quoteerr', why: 'This exact avatar has already been minted. Change a trait to mint a new one.' });
          usd = mint.feeUsd; devPct = 0; uri = `${publicUrl}/nft/${code}.json`; extra = { name: 'VW FEST Avatar', code }; /* no entry discount: m.entry is ignored (a session issued is not proof that anything was paid) */
        } else if (kind === 'shop') {
          item = SHOP.find((x) => x.id === m.item); if (!item) return hub.json(c, { t: 'quoteerr', why: 'Unknown item.' });
          if (p.prof.items.has(item.id)) return hub.json(c, { t: 'quoteerr', why: 'You already own this.' });
          if (method === 'sol' && !mint.devWallet) return hub.json(c, { t: 'quoteerr', why: 'Paying in SOL is not available right now. Use $VWFEST.' });
          usd = item.usd; extra = { itemName: item.name };
        } else if (kind === 'ride') { // ride mints are 100% buyback & burn like avatars (no creator fee)
          devPct = 0; usd = mint.rideUsd;
        } else if (kind === 'vendor') { // booth: no token discount (burn the full fee); the creator fee applies only when paying in SOL / other tokens
          if (method === 'sol' && !mint.devWallet && mint.devFeePct > 0) return hub.json(c, { t: 'quoteerr', why: 'Paying in SOL is not available right now. Use $VWFEST.' });
          const cb = vendors.canBuy(p.prof.id, m.plot); if (!cb.ok) return hub.json(c, { t: 'quoteerr', why: cb.why });
          usd = vcfg.feeUsd; discountPct = 0; extra = { plot: cb.plot, mode: cb.mode, days: vcfg.days }; if (cb.mode === 'claim') vendors.hold(cb.plot, p.prof.id);
        } else return;
        const q = await chain.quote({ kind, usd, method, devWalletOk: !!mint.devWallet, devPct, discountPct, entry });
        if (q.devPct > 0 && !q.devWallet) return hub.json(c, { t: 'quoteerr', why: 'Paying in SOL is not available right now.' });
        const rec = pay.create({ ...q, kind, item: item && item.id, pid: p.prof.id, uri, code, plot: extra.plot });
        if (kind === 'ride') { rec.uri = `${publicUrl}/ride/${rec.id}.json`; extra = { name: 'VW Fest Ride', commit: commitOf(serverSeed(rec.id)) }; }
        hub.json(c, { t: 'quote', q: { id: rec.id, kind, item: rec.item, method, usd, paidUsd: q.paidUsd, solUsd: q.solUsd, discountPct: q.discountPct, devPct: q.devPct, swap: q.swap, totalLamports: q.totalLamports, swapLamports: q.swapLamports, devLamports: q.devLamports, devWallet: q.devWallet, burnRaw: q.burnRaw, burnMin: q.burnMin, burnUi: q.burnUi, entry, uri: rec.uri, expires: rec.expires, ...extra } });
      } catch (e) { console.error('quote failed', e.message); hub.json(c, { t: 'quoteerr', why: 'Could not get a price right now. Try again in a moment.' }); }
      break;
    }
    case 'onramp': { // fiat on-ramp link: the destination is ALWAYS this session's proven wallet (the client cannot choose an address)
      if (!p || !budget('onramp:' + p.id, 6) || !budget('onrampip:' + c.ip, 12)) return hub.json(c, { t: 'onramperr', why: 'Too many requests. Try again in a minute.' });
      let addr = null; const now = Date.now(); if (p.proven) for (const [k, exp] of p.proven) if (exp > now) addr = k; // most recently proven, still valid
      if (!addr) return hub.json(c, { t: 'onramperr', needProof: true, why: 'Verify your wallet first (free signature), then try again.' });
      if (typeof m.provider !== 'string' || !onramp.isKey(addr)) return hub.json(c, { t: 'onramperr', why: 'Bad request' });
      try { const usd = m.purpose === 'vendor' ? Math.ceil(vcfg.feeUsd * 1.08) : mint.entryUsd; const url = await onramp.session(m.provider, { address: addr, usd, ip: c.ip, redirect: c.origin + '/' }); p.rampAt = Date.now(); p.rampAddr = addr; hub.json(c, { t: 'onrampres', url, usd, address: addr }); }
      catch (e) { console.error('onramp failed', String(e.message).slice(0, 160)); hub.json(c, { t: 'onramperr', why: 'The on-ramp is unavailable right now' }); }
      break;
    }
    case 'wauth': { // wallet ownership challenge (signMessage); proofs live only for this WebSocket session
      if (!p || !budget('wauth:' + p.id, 8)) return; const ch = walletauth.challenge(typeof m.pubkey === 'string' ? m.pubkey : '', p.prof.id, c.origin, NETWORK);
      return hub.json(c, ch ? { t: 'wchal', pubkey: m.pubkey, nonce: ch.nonce, message: ch.message, exp: ch.exp } : { t: 'wok', ok: false, why: 'Bad wallet address' });
    }
    case 'wproof': {
      if (!p || !budget('wproof:' + p.id, 12)) return; const ok = walletauth.verify({ nonce: m.nonce, pubkey: m.pubkey, signature: m.sig, pid: p.prof.id, origin: c.origin });
      if (ok) { (p.proven || (p.proven = new Map())).set(m.pubkey, Date.now() + 30 * 60e3); if (p.proven.size > 5) p.proven.delete(p.proven.keys().next().value); }
      return hub.json(c, { t: 'wok', ok, pubkey: m.pubkey, why: ok ? undefined : 'Could not verify the wallet signature' });
    }
    case 'buy': { // client reports a signed+sent purchase tx; nothing is granted until the confirmed tx is verified on-chain
      if (!p || !mint.enabled || typeof m.qid !== 'string') return; const q = pay.quotes.get(m.qid);
      if (!q || q.pid !== p.prof.id || q.used || q.busy || q.expires + 120000 < Date.now()) return hub.json(c, { t: 'buyres', ok: false, why: 'That quote expired. Start again.', qid: m.qid });
      if (!isSig(m.sig)) return hub.json(c, { t: 'buyres', ok: false, why: 'Bad signature', qid: m.qid });
      const proof = typeof m.wallet === 'string' && p.proven && p.proven.get(m.wallet) > Date.now(); // wallet-bound action: the paying wallet must have signed our challenge in this session
      if (REQUIRE_PROOF && !proof) return hub.json(c, { t: 'buyres', ok: false, why: 'Please prove you own this wallet first (sign the free message), then try again.', qid: q.id, needProof: true });
      q.busy = true;
      try {
        const kind = q.kind === 'avatar' ? 'mint' : q.kind;
        const r = await chain.verifyPurchase({ sig: m.sig, swapSig: m.swapSig, nonce: q.id, nick: p.nick, pid: p.prof.id, kind, item: q.item, rideId: q.kind === 'ride' ? q.id : undefined,
          expect: { wallet: REQUIRE_PROOF ? m.wallet : undefined, code: q.code || undefined, uri: q.uri || undefined, burnMin: BigInt(q.burnMin), devMin: BigInt(q.devMin), devWallet: q.devWallet || undefined } });
        if (!r.ok) return hub.json(c, { t: 'buyres', ok: false, why: r.why, qid: q.id, retry: !r.dup && (r.retry || /not found/i.test(r.why || '')) });
        burns.record(r.rec); // Burn Tracker ledger (UI feed); the verified, de-duplicated receipt comes from solana/
        q.used = true; const burned = (Number(BigInt(r.rec.amount)) / 10 ** mint.decimals).toLocaleString('en-US', { maximumFractionDigits: 2 });
        if (q.kind === 'avatar') { hub.setMinted(p); hub.sys(`${p.nick} minted their avatar NFT and burned ${burned} $VWFEST 🔥`, 'burn'); }
        else if (q.kind === 'shop') { const g = profiles.grant(p.prof.id, q.item, { sig: m.sig, usd: q.usd, method: q.method, ts: Date.now() }); if (!g.ok && !g.dup) { console.error('shop grant failed after verified burn', m.sig, g.why); return hub.json(c, { t: 'buyres', ok: false, why: 'Your burn is confirmed but the item could not be granted (' + g.why + '). Contact the team with this transaction: ' + m.sig.slice(0, 12) + '…', qid: q.id, final: true }); } const it = SHOP.find((x) => x.id === q.item); hub.sys(`${p.nick} bought ${it ? it.name : 'an item'} and burned ${burned} $VWFEST 🔥`, 'burn'); if (it && !p.prof.equipped[it.slot]) { profiles.equip(p.prof.id, it.slot, it.id); hub.refresh(p); } }
        else if (q.kind === 'vendor') { const g = vendors.grant({ pid: p.prof.id, nick: p.nick, plot: q.plot, sig: m.sig, usd: q.usd }); if (!g.ok && g.why !== 'dup') { console.error('vendor grant failed after verified burn', m.sig, g.why); return hub.json(c, { t: 'buyres', ok: false, why: 'Your burn is confirmed but no booth plot is free. Contact the team with this transaction: ' + m.sig.slice(0, 12) + '…', qid: q.id }); } await vendors.save(g.booth); broadcastVendors(); hub.sys(`${p.nick} ${g.mode === 'renew' ? 'renewed' : 'opened'} a booth on Vendor Row (#${g.booth.plot}) and burned ${burned} $VWFEST 🔥`, 'burn'); hub.json(c, { t: 'vendor', plot: g.booth.plot, mode: g.mode, exp: g.booth.expiresAt }); }
        else if (q.kind === 'ride') { const rec = rides.reveal({ id: q.id, pid: p.prof.id, sig: m.sig, asset: r.rec.asset, wallet: r.rec.wallet }); hub.setMinted(p); const d = R.describe(rec.spec); hub.sys(`${p.nick} minted a ${d.tier.toUpperCase()} ${d.model}${d.lowrider ? ' LOWRIDER' : ''} and burned ${burned} $VWFEST 🔥`, 'burn'); if (!p.prof.ride) { setRide(p, rec.id); hub.refresh(p); } hub.json(c, { t: 'reveal', ride: pubRide(rec) }); }
        hub.json(c, { t: 'buyres', ok: true, qid: q.id, kind: q.kind, burned }); hub.json(c, inv(p));
      } catch (e) { console.error('buy failed', e.message); hub.json(c, { t: 'buyres', ok: false, why: 'Could not verify yet, try again in a moment', qid: q.id, retry: true }); }
      finally { q.busy = false; }
      break;
    }
    default: break;
  }
}

async function init() {
  await burns.init();
  await chain.init({ env: process.env, db: require('./lib/db').pool() }); // one shared TLS-verified pg pool; memory-only without DATABASE_URL
  chain.mountRoutes(chainRouter, { express, rateLimit, allowedOrigins: [...ORIGINS] });
  await vendors.init(); await rides.init(); await profiles.init(); await nftav.init();
  try { // moderation survives restarts: the same database as the profiles, else MOD_FILE (a path on a persistent disk), else memory only
    const { dbStore, fileStore } = require('./lib/moderation'); const schema = (process.env.DB_SCHEMA || 'showgrounds').replace(/[^a-z0-9_]/gi, '');
    const store = profiles.q ? await dbStore(profiles.q, schema).init() : process.env.MOD_FILE ? fileStore(process.env.MOD_FILE) : null;
    if (store) console.log(`[moderation] ${await mod.attach(store)} active mutes/bans restored (${profiles.q ? 'database' : 'file'})`); else console.warn('[moderation] memory only: mutes and bans are lost on restart (set DATABASE_URL or MOD_FILE)');
  } catch (e) { console.error('[moderation] persistence unavailable, memory only:', String(e.message).slice(0, 120)); }
  if (profiles.q) require('./lib/rls').enableRls(profiles.q, (process.env.DB_SCHEMA || 'showgrounds').replace(/[^a-z0-9_]/gi, '')).then((t) => t.length && console.log('[rls] enabled on', t.join(', '))); // best-effort, never blocks boot
}
if (require.main === module) {
  init().then(() => {
    server.listen(PORT, '0.0.0.0', () => console.log(`[showgrounds] listening on ${PORT} (cap ${cfg.maxPlayers}, purchases ${mint.enabled ? 'ENABLED on ' + NETWORK : 'off: ' + mint.reason}, SOL shop ${mint.devWallet ? 'on' : 'off (DEV_WALLET unset)'})`));
  });
  process.on('SIGTERM', () => { server.close(); require('./lib/db').end().catch(() => {}); setTimeout(() => process.exit(0), 500).unref(); });
}
module.exports = { rpcGuard, requireProof: () => REQUIRE_PROOF, mod, iceServers, cleanSignal, dj, nftav, app, server, hub, burns, mint, cfg, profiles, rides, pay, vendors, vcfg, guideValues, init };
