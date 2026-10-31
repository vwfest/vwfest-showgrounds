# solana/ — non-custodial payments, burns and NFT minting for VW FEST SHOW GROUNDS

Node 20 server module + browser client. **The server never holds user keys or funds and has no route that sends or relays a transaction**
(the player's wallet signs, the player's own RPC broadcasts). Default network is **devnet**; **mainnet is off** until `MAINNET_ARMED=1`.

```
solana/
  index.js            require('./solana'): INTERFACES.md §1 facade (init/config/quote/solUsd/verifyPurchase/burns/auth/onramp/mountRoutes) + native API
  client.js           browser ESM entry (bundle with esbuild): createClient + wallet adapters + INTERFACES §2 helpers (see "Gaps")
  src/config.js       env -> config, feature flags, constants ($VWFEST mint, DEV_WALLET, program ids)
  src/prices.js       SOL/USD (Jupiter -> Coinbase -> Kraken), $VWFEST/USD (Jupiter executable quote cross-checked with price API, 25% deviation guard)
  src/quotes.js       pricing policy + breakdown (50% off in $VWFEST, 10% dev fee, burn amounts, slippage guard)
  src/jupiter.js      Jupiter swap-instructions + allow-list audit of every instruction Jupiter returns
  src/txbuild.js      builds UNSIGNED pay tx (swap -> burn) and mint tx (Core create; co-signed only by collection authority + asset key)
  src/audit.js        tx audit used by the server AND the browser before the wallet is asked to sign
  src/verify.js       on-chain verification (signer, memo, burn, dev fee, NFT account state), top-level instructions only
  src/rides.js        commit-reveal ride roller, published odds, verifyRide()
  src/nft.js          Metaplex Core instructions, metadata, SVG sanitizer, deterministic asset address, NFT ownership lookup (DAS or getProgramAccounts)
  src/auth.js         wallet sign-in: server nonce (5 min, single use) + ed25519 signMessage verify + HMAC session token
  src/burns.js        Burn Tracker ledger/totals + Solscan links
  src/onramp.js       MoonPay / Coinbase Onramp / Stripe Crypto Onramp session creation (behind env keys)
  src/store.js        in-memory source of truth with synchronous put-if-absent; JSONL file or Postgres write-behind (TLS verified)
  src/compat.js       the §1 single-transaction facade implementation
  src/routes.js       Express router for the native HTTP API
  src/client/index.mjs browser/Node client + wallet adapters (Phantom, wallet-standard, embedded/Google, keypair)
  scripts/            testnet-setup.js, create-collections.js, mainnet-sim.js (simulation only)
  test/               unit + end-to-end (real local validator with the real mpl-core program) + facade + bundle tests
```

## Money rules (all implemented + tested)

| | Pay in `$VWFEST` | Pay in SOL | Pay in any SPL token (USDC, BONK, JUP, `PAY_TOKENS`) |
|---|---|---|---|
| Avatar NFT mint ($5), Ride NFT mint ($5), Outfit shop | **50% off**, 100% burned | full USD price: **90% swapped via Jupiter to $VWFEST and burned, 10% SOL to `DEV_WALLET`** | same as SOL, but the 10% dev fee is sent **in the same token** to the dev wallet's ATA |
| Vendor booth ($30) | **no discount**, 100% burned | 90% swap+burn, 10% SOL to `DEV_WALLET` | same as SOL |

* `MINT_DEV_FEE=0` turns mints into 100% buyback & burn on SOL too (the default follows the brief: mints = 100% burn on $VWFEST, 90/10 on SOL).
  INTERFACES.md §0 says avatar mint has *no dev fee*: the §1 facade lets the caller choose (`devPct: 0`), the native API follows `MINT_DEV_FEE`.
* USD -> token amounts come from live prices; the quote shows the full breakdown (`paidUsd`, `discountPct`, `devPct`, `devLamports`/`devTokenRaw`, `swapInRaw`, `burnRaw`, `burnMin`, price sources).
* Slippage guard: `SLIPPAGE_BPS` (default 3%) on the Jupiter swap, price-impact cap 5%, `burnMin` = 99% of Jupiter's min-out, the tx is **rebuilt from a fresh quote** and refused if min-out fell below `burnMin`; the on-chain swap itself fails if min-out is not delivered.
* Everything the client could tamper with is decided server-side: amounts, receivers, NFT URI, collection, burn size.

## Native HTTP API (`createRouter({ solana, express, rateLimit, allowedOrigins, refOf })`, mount at `/api/solana`)

```js
const { Solana, createRouter } = require('./solana');
const solana = await new Solana({
  env: process.env,
  onGrant: async (receipt) => { /* grant the item. Called exactly once per verified payment (retry via solana.retryGrants()) */ },
  onMinted: async ({ quoteId, kind, wallet, asset, uri, ref }) => {},
  shopPrice: (itemId) => usdOrNull,                   // server-side shop catalog; the client never sends a price
  rideImage: async (rideRec) => svgStringOrHttpsUrl,   // renders the rolled ride (UI worker's lib/ridesvg)
  roller: require('./solana').rides.adaptShared(require('./shared/rides')), // optional: use the UI's trait tables for rides
  allowedDomains: ['vwfest.github.io'],                // hostnames allowed in the sign-in message
}).init();
app.use('/api/solana', createRouter({ solana, express, rateLimit, allowedOrigins: ['https://vwfest.github.io'], refOf: (req) => profileIdFromYourOwnSession(req) }));
```

| Route | Auth | |
|---|---|---|
| `GET /config` `GET /odds` `GET /burns` `GET /price` | – | flags, prices, collections, public RPC url, published odds, Burn Tracker (totals + Solscan links) |
| `POST /auth/challenge {wallet}` -> `{nonce,message}`; `POST /auth/verify {wallet,nonce,signature(base64)}` -> `{token}` | origin | wallet sign-in (`signMessage`), nonce single-use, 5 min TTL; session token 12 h, HMAC-signed |
| `POST /quote {kind:'avatar'\|'ride'\|'shop'\|'vendor', method:'vwfest'\|'sol'\|'spl', payTokenMint?, item?, nft?}` | Bearer | breakdown + memo. Avatar: `nft:{traits, name?, imageSvg \| image(https/ipfs), fingerprint?}` |
| `POST /tx/pay {quoteId}` | Bearer | unsigned v0 tx: `[budget][dev fee][swap][burnChecked][memo]` (audited server-side first) |
| `POST /pay/confirm {quoteId, signature, nick?}` | Bearer | verifies on-chain, **grants once**, records burn; ride is rolled here |
| `POST /tx/mint {quoteId}` / `POST /mint/confirm {quoteId, signature}` | Bearer | Core NFT creation tx (player pays ~0.003 SOL rent; authority co-signs) / verifies the asset account state |
| `GET /nfts`, `POST /nft/use {asset}` | Bearer | NFTs owned by the signed-in wallet; re-verifies ownership when chosen as avatar |
| `POST /onramp/session {provider, usd?}` | Bearer | card/Apple Pay/Google Pay -> SOL in the player's own wallet |
| `GET /nft/meta/:id.json`, `/nft/img/:id.svg`, `/nft/collection/:kind.(json\|svg)` | – | server-hosted metadata (default storage; SVG served inert with `CSP: sandbox`) |
| `POST /devnet/faucet` | Bearer | test networks only: mints test $VWFEST |

Client: `createClient({base, wallet})` -> `signIn()` -> `purchase({kind, method, ...}, {onQuote, onStep, nick})` runs quote -> audit -> wallet signs -> own RPC sends ->
`/pay/confirm` -> (NFT kinds) mint tx -> `/mint/confirm`. `simulatePay(quote)` works while mainnet is disarmed (build + audit + `simulateTransaction`, never signs).
Wallet adapters: `phantomAdapter`, `walletStandardAdapter` (+ `discoverWallets()`), `embeddedAdapter` (Web3Auth/Privy objects with signMessage/signTransaction), `keypairAdapter`.

### INTERFACES.md §1 facade (`require('./solana')`)
`init({env, db}) · config() · quote({kind,usd,method,discountPct,devPct,devWalletOk,entry}) · solUsd() · verifyPurchase({sig,swapSig,nonce,pid,nick,kind,item,rideId,expect}) ·
burns.stats()/codes/badge() · auth.challenge()/verify() · onramp.providers()/session() · mountRoutes(app,...) · __test.fakeVerify() / CHAIN_FAKE=1 (ignored on mainnet)`.
`db` = the host's single pg Pool (we never create our own); without it the store is memory-only. `verifyPurchase` reserves sig + avatar code synchronously before any `await` and releases on failure.

## Ride randomness (commit-reveal, published odds)
Common 55% · Rare 25% · Epic 12% · Legendary 6% · Mythic 2% (`GET /odds`). Mythics are always **lowrider** VWs (candy paint, pinstripes, hydraulics, wire wheels, **DIAMOND** plate); every ride has a `VWFEST` plate.
`serverSeed = HMAC(SERVER_SECRET,"ride:"+quoteId)`; `commit = SHA256(serverSeed)` is shown in the quote **and written into the payment tx memo** (on-chain before the roll).
`roll = f(SHA256(serverSeed ":" paymentSignature))` — the signature doesn't exist until the player signs. The seed is revealed in the NFT metadata (`fairness`); anyone can run `verifyRide()`.
`SERVER_SECRET` must be persistent env (>=32 chars): it is **never random per boot**; without it the module reports itself off.

## One mint per unique trait set
Avatar: the asset address is a keypair derived from `HMAC(SERVER_SECRET, collection+fingerprint)`, so a second mint of the same trait set **fails on-chain** (account exists); plus a synchronous off-chain reservation (per wallet, TTL) and `minted` ledger for friendly errors. Rides: every roll is checked against taken trait codes (deterministic re-roll counter).

## Security model (what a reviewer should check)
* (a) Replay/double-grant: `Store.reserve()` is a synchronous put-if-absent; `confirmPayment` / `verifyPurchase` reserve the signature and quote/code before the first `await` and release on failure. Tested with 5–6 concurrent confirms -> exactly one grant (`test/e2e`, `test/compat`).
* (b) No server broadcast: there is no route, helper or client call that sends a transaction through the server (`/tx/send`, `/rpc`, `/relay` are tested to 404). The browser uses `PUBLIC_RPC_URL` (never `RPC_URL`, which may hold a private key).
* (c) Postgres TLS: `pgBackend` keeps `rejectUnauthorized:true` (provider CA via `PG_CA`); `PGSSL=off` throws in production. The §1 facade reuses the host's pool.
* (d) Wallet auth: server nonce, 5 min TTL, single-use (burnt even on a failed attempt), message includes domain + nonce + expiry, ed25519 verify, per-wallet nonce cap, HMAC session.
* (e) `SERVER_SECRET` from env, mandatory, >=32 chars; no random fallback.
* Transactions are audited by program allow-list + exact amounts/accounts both server-side before returning and client-side before signing (and again on what the wallet returns). Jupiter's instructions are allow-listed (programs, token/system instruction types, SOL bounded to the quote, accounts only the user's).
* Verification only counts **top-level** instructions (no burn smuggled in a CPI), checks fee payer == quote wallet == signer, memo == quote memo, mint, authority, amounts (`>= burnMin`, dev fee `>= 99%`), and for NFTs reads the asset **account state** (owner, collection, URI).
* The `AUTHORITY_SECRET_KEY` only co-signs collection mints; it holds no user funds (keep ~0.05 SOL on it on mainnet for collection creation only; rent for each mint is paid by the player).
* Metadata SVGs are sanitized (no script/foreignObject/external hrefs/entities) and served with `CSP: sandbox`; trait text is stripped of control chars/angle brackets; NFT-avatar URLs only `https:`/`ipfs:`.

## Env vars
| Var | Default | |
|---|---|---|
| `SOLANA_NETWORK` (alias `MINT_NETWORK`) | `devnet` | `devnet` \| `mainnet-beta` \| `localnet` |
| `MAINNET_ARMED` (alias `MINT_MAINNET`) | off | **second switch** for mainnet. While off: quote/build/simulate work, confirm/grant is refused, client refuses to send |
| `SOLANA_ENABLED` / (`MINT_ENABLED=1` for the facade) | on / off | master switch |
| `SERVER_SECRET` | – (**required**) | >=32 chars, persistent. Signs sessions, seeds ride commit-reveal, derives asset addresses |
| `AUTHORITY_SECRET_KEY` | – (required for NFT mints) | base58 or JSON-array key of the collection update authority |
| `AVATAR_COLLECTION`, `RIDE_COLLECTION` | – | Core collection addresses (`scripts/create-collections.js`) |
| `VWFEST_MINT` | `9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump` on mainnet | on test networks use `DEVNET_VWFEST_MINT` (test token from `testnet-setup.js`) |
| `DEV_WALLET` | `DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok` | |
| `DEV_FEE_PCT` / `VWFEST_DISCOUNT_PCT` / `MINT_DEV_FEE` | 10 / 50 / 1 | |
| `AVATAR_MINT_USD` `RIDE_MINT_USD` `VENDOR_FEE_USD` | 5 / 5 / 30 | shop price comes from `shopPrice()` (max `MAX_SHOP_USD`=100) |
| `RPC_URL` | public cluster | server-side reads/verification. Use a paid/private RPC on mainnet (e.g. Helius) |
| `PUBLIC_RPC_URL` | public cluster | what browsers use to send. Domain-restrict any key you put here |
| `DAS_URL` | = `RPC_URL` | DAS-capable RPC for "use NFT as avatar" (falls back to `getProgramAccounts` for Core assets, which works on any RPC) |
| `JUPITER_BASE` / `JUPITER_API_KEY` | `https://lite-api.jup.ag` / – | **the free lite-api rate-limits (HTTP 429) quickly; get a key at portal.jup.ag for mainnet** |
| `SLIPPAGE_BPS` | 300 | |
| `PAY_TOKENS` | USDC, USDT, BONK, JUP | JSON `[{"sym","mint","dec"}]` |
| `PUBLIC_BASE_URL` | – | needed for server-hosted NFT metadata URIs |
| `NFT_STORAGE` / `PINATA_JWT` / `PINATA_GATEWAY` | `server` | `pinata` = free IPFS pinning (1 GB free tier). `server` stores metadata in the store and serves it from `/nft/meta/*` |
| `DATABASE_URL`, `PG_CA`, `SOLANA_STORE_FILE` | – | persistence (Postgres w/ verified TLS, or JSONL on a persistent disk). **Render free has an ephemeral disk: use Postgres** |
| `FIXED_SOL_USD`, `DEVNET_TOKENS_PER_USD` (10) | – | test-network pricing |
| `FEATURE_MINT_AVATAR/_MINT_RIDE/_SHOP/_VENDOR/_PAY_SOL/_PAY_SPL/_NFT_AVATAR/_ONRAMP/_EMBEDDED_WALLET` | on | feature flags |
| `MOONPAY_API_KEY`+`MOONPAY_SECRET_KEY` (+`MOONPAY_ENV=live`) · `CDP_API_KEY_ID`+`CDP_API_KEY_SECRET` · `STRIPE_SECRET_KEY`+`STRIPE_PUBLISHABLE_KEY` | – | each on-ramp turns on when its keys exist |
| `WEB3AUTH_CLIENT_ID` (+`WEB3AUTH_NETWORK`) or `PRIVY_APP_ID` | – | Google-login embedded wallet (public config returned by `/config`) |

## Setup
1. `cd solana && npm install`
2. **Devnet:** `SOLANA_NETWORK=devnet PUBLIC_BASE_URL=https://<your host> node scripts/testnet-setup.js` -> prints `AUTHORITY_SECRET_KEY`, `DEVNET_VWFEST_MINT`, `AVATAR_COLLECTION`, `RIDE_COLLECTION`, `SERVER_SECRET`. Put them in the server env. (`https://api.devnet.solana.com` was unreachable from the build box, so devnet was validated through the local validator instead; the script needs a reachable devnet RPC, or the airdrop faucet at faucet.solana.com.)
3. Mount the router / facade (see above), call `solana.init()`. Players on devnet get test $VWFEST from `POST /devnet/faucet`.
4. **Mainnet checklist (nothing here spends money until you do it):** fund `AUTHORITY` with ~0.05 SOL -> `SOLANA_NETWORK=mainnet-beta node scripts/create-collections.js --yes` -> set `AVATAR_COLLECTION/RIDE_COLLECTION`, `JUPITER_API_KEY`, private `RPC_URL`, `DATABASE_URL` -> run `node scripts/mainnet-sim.js` (simulation only) -> only then set `MAINNET_ARMED=1`.

## Accounts the user must create (nothing else is needed)
| Account | Why | Required? |
|---|---|---|
| **Jupiter API key** (portal.jup.ag, free tier) | the keyless lite-api returns 429 under load (observed repeatedly while testing) | **Yes for mainnet** |
| **Paid/private Solana RPC** (Helius / Triton / QuickNode; free tier OK to start) | reliable `getTransaction` verification + DAS NFT lookup | Strongly recommended |
| **Authority wallet** (new keypair, ~0.05 SOL) | co-signs collection mints; creates the 2 collections | Yes for NFT mints |
| **Postgres** (existing Supabase) + its CA cert as `PG_CA` | persistent ledger/replay protection | Yes (Render free disk is ephemeral) |
| **Web3Auth / MetaMask Embedded Wallets** dashboard project with Google connection -> `WEB3AUTH_CLIENT_ID` (the UI already uses it) *or* Privy app (`PRIVY_APP_ID`) | "Sign in with Google" wallet | For Google login |
| **MoonPay** partner account (`pk_` + secret) **or** **Coinbase CDP** API key (Onramp) **or** **Stripe** Crypto Onramp (needs Stripe approval) | card / Apple Pay / Google Pay -> SOL | One is enough; optional |
| **Pinata** free account (JWT) | only if you want metadata on IPFS instead of `/nft/meta` | Optional |

## Tests (`npm test`, ~1 min; needs `~/solana-bin/solana-release/bin/solana-test-validator`, otherwise chain tests skip)
* `test/unit.test.js` — config/flags, pricing maths, odds + commit-reveal + lowrider Mythics, auth (nonce/TTL/replay/tamper), store atomicity, pg TLS, SVG sanitizer, onramp signatures/JWTs, Jupiter + tx audit negatives, parsed-tx verification negatives, price fallbacks.
* `test/e2e.test.js` — real validator + real mpl-core: HTTP router + client lib + wallet adapter: sign-in, faucet, avatar mint in $VWFEST (25 tokens burned on-chain), uniqueness, shop in SOL (10% to dev wallet, 90% burned), vendor $30, ride mint with on-chain commit and public verification, NFT-as-avatar lookup, attacks (underpaid burn, wrong memo, replayed sig, wrong wallet, 5x concurrent confirm = 1 grant, failed verify releases lock), restart persistence, mainnet-disarmed behaviour.
* `test/compat.test.js` — §1 facade single-tx flow, incl. concurrent same-sig/same-code races and pool persistence.
* `test/bundle.test.js` — the browser entry bundles with esbuild without Node builtins.
* `scripts/mainnet-sim.js` — live Jupiter route + audit + `simulateTransaction` on mainnet (never signs, `sigVerify:false`). Result on 2026-10-31: avatar $5 paid in SOL = real Jupiter route (SOL -> $VWFEST on Pump.fun AMM), dev-fee transfer, swap, burn, memo: **simulation succeeded** (~110k CU, tx 750 B). USDC path built + audited; its simulation stopped at the sample wallet's *frozen* USDC account (not a tx problem). Other cases were throttled by the keyless Jupiter tier (HTTP 429): use `JUPITER_API_KEY`.
* Fixture `test/fixtures/mpl_core.so` is the Metaplex Core program dumped from mainnet (loaded into the local validator).

## Gaps / honest notes
* **Not live-tested:** Jupiter swap *execution* (mainnet only; simulated), Web3Auth/Privy login, MoonPay/Coinbase/Stripe live sessions (signature/JWT/request shapes unit-tested against mocks), Pinata upload (mocked path only), DAS lookup (needs a DAS RPC; the `getProgramAccounts` fallback is tested on the validator).
* Mint is two wallet prompts (pay+burn tx, then Core create tx) because Metaplex Core requires the collection authority to co-sign and rarity must be known before the URI exists. The pay step is recoverable: if a player pays and closes the tab, `POST /tx/mint` for that quote still works.
* Dev fee for SPL-token payments is paid in that token (not SOL) to avoid forcing the payer to also hold SOL.
* `client.js` provides `hasInjected/connectInjected/balances/onrampUrl/bridgeLinks` + native client; it does **not** implement §2 `prepare/signAndSend` (WS-quote flow) or `connectEmbedded/resumeEmbedded` — the UI's `src/pay.js` / `src/wallet.js` keep doing that; they can be switched to the native client later.
* `§1 verifyPurchase` does not check the Jupiter swap tx beyond ownership (the burn is what counts).
