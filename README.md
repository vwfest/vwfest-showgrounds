# VW FEST SHOW GROUNDS

A free browser 3D car-show world for the **$VWFEST** community. Up to 150 people at once, unique quiz-generated avatars, nearby + global chat,
proximity voice, outfit shop, avatar + mystery-ride NFTs, buyback-and-burn of $VWFEST (mint `9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump`) with a live Burn Tracker,
24 vendor booths, an Info Booth guide, and arcade booths. Playing never costs anything; every purchase feature is behind flags and **off by default**.

* `docs/` + `src/` — client (Three.js r170, esbuild) → GitHub Pages. `server.js` + `lib/` — Node/Express/ws game server → Render. Postgres (Supabase, schema `showgrounds`) optional; falls back to memory/pglite.
* `INTERFACES.md` — contract with the `solana/` payments module. `CHANGELOG.md` — rendered in the in-world Info Booth ("What's new").

## Run it
```
npm install --legacy-peer-deps      # dev (client build + tests)
PREVIEW=1 DEV=1 node build.cjs      # builds docs/js
SERVER_SECRET=dev-secret-0123456789 node server.js    # http://localhost:3000 (serves the client too)
npm test                            # unit + api + guide + security + e2e;   npm run test:load  = 150 simulated players
```
Production: `render.yaml` (Blueprint) and `.github/workflows/pages.yml` (tests, build, deploy `docs/`). `docs/config.js` points the Pages client at the Render URL.

## Graphics (quality tiers)
`Auto` (default) picks a tier from the GPU and device and lowers itself if the frame rate stays under ~27 fps; Settings (⚙) lets people pick **Ultra / High / Medium / Low** and toggle depth of field. `?quality=ultra` forces a tier.

| | Ultra | High | Medium | Low |
|---|---|---|---|---|
| Lighting | HDR sky (Poly Haven, CC0) image-based light, day + sunset | same | same | hemisphere + sun |
| Shadows | 3-cascade soft shadows | single 2048 map following you | 1024 | none |
| Post | GTAO ambient occlusion, bloom, sunset god rays, MSAA + SMAA, ACES | bloom, MSAA, ACES | ACES | ACES |
| Grass | 110k swaying blades | 40k | 9k | none |
| Ground / roads | PBR asphalt + grass textures (CC0) | same | flat | flat |
Cars use clear-coat paint (solid / metallic / flake / candy), chrome, glass and rubber materials with beveled bodies, torus tyres, rims, lug nuts and interiors; avatars have rounded limbs, facial features and alpha-card hair.
Honest limits: avatars are hierarchical rigid parts (not a skinned mesh); depth of field is optional and costs frame rate; phones default to Medium/Low. Assets and licences: `docs/assets/README.txt`.

## The Info Booth never goes stale
`docs/info.json` is the single source of guide text. Numbers are tokens (`{feeUsd}`, `{discountPct}`, `{vendorFeeUsd}`, `{odds.legendary}` …) that `lib/guide.js` fills from the **same config the server enforces**
(`MINT_FEE_USD`, `VWFEST_DISCOUNT_PCT`, `DEV_FEE_PCT`, `VENDOR_FEE_USD`, `VENDOR_DAYS`, `VENDOR_BOOTHS`, shop prices, ride odds…) and serves at `/api/guide`; `CHANGELOG.md` is rendered the same way.
`npm run test:guide` scans the guide for hard-coded numbers and boots the server with different env values to prove the text follows. Adding a visible number? Add it to `lib/guide.js values()`.

## Environment variables (all optional unless marked)
| Group | Variables |
|---|---|
| Core | `PORT`, `NODE_ENV=production`, **`SERVER_SECRET` (≥32 chars, required in production)**, `PUBLIC_URL`, `ALLOWED_ORIGINS` (comma list; GitHub Pages origin is built in), `MAX_PLAYERS=150`, `MAX_CONNS`, `MAX_CONNS_PER_IP`, `IDLE_MINUTES`, `VOICE_RANGE`, `GLOBAL_CHAT_COOLDOWN_MS` |
| Database | `DATABASE_URL`, `PG_CA_CERT` / `PG_CA_FILE` (TLS is verified; Supabase root cert), `PGSSL=off` (local), `PGSSL_INSECURE=1` (emergency only), `DB_SCHEMA=showgrounds`, `USE_PGLITE=1`, `PGLITE_DIR` |
| Abuse limits | `MAX_PROFILES=50000`, `PROFILE_CREATE_PER_HOUR=5` (per IP), `VENDOR_RATE_LIMIT`, `REQUIRE_WALLET_PROOF=1` |
| Purchases | `MINT_ENABLED=1` to arm, `MINT_NETWORK`, `MINT_MAINNET=1` (second key for mainnet), `VWFEST_MINT`, `VWFEST_DECIMALS`, `RPC_URL` (server, keyed; `SOLANA_RPC_URL` still accepted), `PUBLIC_RPC_URL` (browsers broadcast through it; the server has no tx relay), `MINT_DEV_FEE=0`, `MINT_FEE_USD=5`, `RIDE_MINT_USD`, `DEV_FEE_PCT=10`, `VWFEST_DISCOUNT_PCT=50`, `DEV_WALLET` (**required** for SOL/token payments and the creator fee), `MINT_SLIPPAGE_BPS`, `JUPITER_BASE`, `PAY_TOKENS` |
| No-wallet "Entry / Mint" | `WEB3AUTH_CLIENT_ID`, `WEB3AUTH_NETWORK=sapphire_mainnet\|sapphire_devnet`, `ENTRY_ONRAMP_USD`, `MOONPAY_API_KEY`, `MOONPAY_SECRET_KEY`, `MOONPAY_ENV=live\|sandbox`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `ONRAMP_URL_TEMPLATE`, `ONRAMP_URL_NAME` |
| Google sign-in | `WEB3AUTH_CLIENT_ID` (public id; defaults on devnet to the project's Sapphire devnet id, `off` disables), `WEB3AUTH_NETWORK=sapphire_devnet\|sapphire_mainnet`. The Web3Auth dashboard must list your site origin (e.g. `https://vwfest.github.io`). Card payments stay off. |
| Mainnet (not armed) | `HELIUS_API_KEY` (server-side `RPC_URL` on mainnet only; never sent to browsers), `MAINNET_AUTHORITY_SECRET_KEY` (base58 or JSON array; loaded only when `MINT_NETWORK=mainnet-beta`, signs nothing until `MINT_ENABLED`+`MINT_MAINNET`/`MAINNET_ARMED`). |
| Read RPC proxy (`/api/rpc`) | Needs a short-lived token bound to the player's joined WebSocket session (sent in `welcome`, rotated with `{t:'rpctok'}`, dies with the socket); anonymous callers get 401 and use `PUBLIC_RPC_URL`. Budgets: `RPC_SESSION_PER_MIN` (60), `RPC_IP_PER_MIN` (120), `RPC_GLOBAL_PER_MIN` (3000), `RPC_PROXY_PER_MIN` (90, per-IP HTTP limiter); `RPC_TOKEN_TTL_SEC` (600), `RPC_MAX_BATCH` (5), `RPC_MAX_ACCOUNTS` (25, getMultipleAccounts). Read-only method allowlist; the keyed upstream URL is never returned or exposed (`PUBLIC_RPC_URL` carrying an api-key is ignored). |
| DJ booth | `DJ_SLOT_MIN=15` (or `DJ_SLOT_MS`, 0 = no limit), `DJ_QUEUE_MAX=8`, `DJ_ENABLED=0` to switch off; admins end a set with `POST /api/admin/dj {"action":"release"|"next"|"clear"}` + `x-admin-secret`. Music: CC0 synthesized tracks in `docs/assets/music` (`python3 tools/make-music.py` regenerates them). DJs must play only music they have rights to. |
| Vendors | `VENDOR_FEE_USD=30`, `VENDOR_DAYS=30`, `VENDOR_BOOTHS=24` (4–24), `VENDOR_IMG_KB=150`, `VENDOR_AUTOHIDE_REPORTS=3`, `VENDOR_PREMOD=1` (recommended), `ADMIN_SECRET` (≥16 chars, enables `/api/admin/vendors`) |
| Voice | `TURN_URL`, `TURN_SECRET` (>= 16 chars, coturn `use-auth-secret`; optional `TURN_TTL_SEC`, default 900). STUN is always used; TURN credentials are short-lived per-session HMACs, sent over the authenticated WebSocket only after the player turns Voice on. Static `TURN_USERNAME`/`TURN_CREDENTIAL` are no longer used |
| DJ mic | `DJ_MIC_RANGE` (default 110: only players this close to the stage get the mic audio), `DJ_MIC_MAX_BPS` (default 24000 bytes/s hard cap) |
| Moderation | `ADMIN_SECRET` (>= 16 chars). `GET/POST /api/admin/mod` (header `x-admin-secret`): `{action: mute\|unmute\|kick\|ban\|unban, pid: <profile id or session id>, minutes}`. Mutes cover chat, voice signaling and the DJ mic; bans block join by profile and by IP. Persistent: stored in the same database as profiles (`DATABASE_URL`, table `<schema>.moderation`, RLS on), else in the JSON file `MOD_FILE` (needs a persistent disk), else memory only (logged at boot) |
| Timeouts | `PREJOIN_MS` (default 20000): connections that do not join in time are closed |
| Test only | `FIXED_SOL_USD`, `DEVNET_TOKENS_PER_USD`, `DEVNET_BURN_TOKENS` |

## Accounts and one-time setup (what a human must do)
1. **GitHub** repo `vwfest/vwfest-showgrounds` → Settings ▸ Pages ▸ Source = GitHub Actions. 2. **Render** → New ▸ Blueprint from `render.yaml`; fill the `sync: false` values.
3. **Supabase** (free) → create a project, copy the connection string to `DATABASE_URL`, download the *Server root certificate* into `PG_CA_CERT`.
4. **DEV_WALLET**: a Solana address you control (receives the 10 % creator fee only when someone pays in SOL/other tokens). 5. **RPC**: a keyed Solana RPC (Helius/QuickNode free tier) in `RPC_URL` (never exposed to browsers). Browsers broadcast through `PUBLIC_RPC_URL`; the server has no transaction relay.
6. **Google sign-in wallets**: create a Web3Auth (MetaMask Embedded Wallets) project, add the Pages origin + Render origin to *Allowed origins*, enable Google, copy the **Client ID** to `WEB3AUTH_CLIENT_ID` (free base plan, 1,000 monthly active wallets).
7. **Card / Apple Pay / Google Pay**: MoonPay account (sandbox is instant; live needs business verification) → API key + secret; or Coinbase CDP project/API key and an approved Onramp app. Keys stay on the server.
8. Arm purchases last: `MINT_ENABLED=1`, test on `devnet`, then `MINT_NETWORK=mainnet-beta` **and** `MINT_MAINNET=1`.

## Safety and legal notes
* **Entry / Mint** is labelled as a *purchase of a unique avatar NFT* (never a donation); it promises no price, return or utility beyond the avatar and burns tokens. Get legal review for your jurisdiction; the UI asks users to confirm they are 18+ and that crypto can lose value.
* Wallets are non-custodial: embedded wallet keys exist only in the player's browser (MPC-protected by Web3Auth) and are never sent to our server; the server never holds user funds. Purchases only count after the server verifies the confirmed transaction on-chain, and wallet-bound actions need a free `signMessage` ownership proof.
* Vendors are responsible for what they sell (Terms are shown when claiming). Images are JPEG-only, size-limited, re-encoded in the browser and served sandboxed; reports auto-hide booths; admins can hide/remove with `ADMIN_SECRET`. There is **no automated nudity/violence detection**: use `VENDOR_PREMOD=1` (approve before a booth appears).
* Chat: profanity/link/contact filters, rate limits, auto-mute. Voice is peer-to-peer WebRTC within ~15 m; every player can mute anyone.
* Known dependency note: `elliptic` and `deepmerge` (via the Web3Auth client bundle) have advisories with no upstream fix yet; `uuid` and `stream-json` are pinned to fixed versions with `overrides`. Server runtime dependencies audit clean.

Credits: HDRIs and PBR textures from [Poly Haven](https://polyhaven.com) (CC0); Three.js; Web3Auth; Jupiter; Metaplex Core.

## Publishing the client (GitHub Pages)
Pages serves `main:/docs`. The built bundle (`docs/js`) is committed, so run `npm run build` and commit `docs/` before pushing client changes.
(`ci-pages.yml.example` is an optional Actions workflow; copy it to `.github/workflows/` with a token that has the `workflow` scope.)

## Render (game server)
Build: `npm ci --omit=dev --ignore-scripts && npm ci --omit=dev --ignore-scripts --prefix solana`. Start: `node server.js`. Health check: `/healthz`. Env: see `render.yaml`.
