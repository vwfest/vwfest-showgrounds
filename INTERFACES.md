# INTERFACES — what the UI / game server needs from the `solana/` module

Owner of this file: **World/UI worker** (3D world, graphics, avatars/quiz, multiplayer, voice, chat, shop/vendor/info UI).
Owner of `solana/`: **Solana payments worker**. Nothing in the UI touches keys, RPC details or transaction building directly: it only
goes through the two facades below. If you change a signature, edit this file in the same commit.

* Server facade: `lib/chain.js` (CommonJS). Today it delegates to the existing implementation (`lib/pay.js`, `lib/burns.js`, `lib/onramp.js`);
  as soon as `solana/index.js` exists it will `require('../solana')` and use its exports instead. **Your module should export exactly the names in §1.**
* Browser facade: `src/chain.js` (ESM, lazy chunk). Today it re-exports `src/pay.js` + `src/wallet.js`. **Your browser build should export the names in §2.**
* Config values are env vars read by `server.js` and passed in (do not read `process.env` for the shared ones — see §5).

Hard rules the UI relies on (please keep):
1. Non-custodial: no project/server key ever holds user funds or signs for the user. Embedded wallet keys never leave the browser.
2. **Nothing is granted until the server has verified the confirmed tx on-chain** (`verifyPurchase`). The client only *reports* a signature.
3. Every amount is derived server-side from USD config + live price; the client can't choose amounts, receivers, NFT URI or burn size.
4. Vendor booths: no token discount, creator fee only on SOL/other-token payment. Avatar mint: 100% of the fee is swapped and burned (no dev fee).

---------------------------------------------------------------------------------------------------------------------------------

## 1. Server API (`lib/chain.js` ⇄ `solana/index.js`, CommonJS)

```js
const chain = require('./lib/chain');          // facade; same shape as require('./solana')
await chain.init({ env, db })                  // db = pg Pool or null (memory fallback must work). Creates tables in schema `showgrounds` (burns tables).
chain.config()                                 // -> { enabled:boolean, reason?:string, network:'mainnet-beta'|'devnet'|'localnet', mint:string, decimals:number,
                                               //      devWalletOk:boolean, embedded:{ provider:'web3auth', clientId, network }|null,
                                               //      onramp:[{id,name,sandbox?}], payTokens:[{symbol,mint,decimals}] }
```
### Quote (called from WS `quote`, already rate-limited by the game server)
```js
await chain.quote({
  kind: 'avatar'|'shop'|'ride'|'vendor',
  usd: number,               // from config: MINT_FEE_USD / item.usd / RIDE_FEE_USD / VENDOR_FEE_USD
  method: 'vwfest'|'sol',    // 'vwfest' = pay directly with $VWFEST (burn only); 'sol' = swap SOL(or token) -> $VWFEST then burn
  discountPct: number,       // 50 for shop/ride paid in $VWFEST (VWFEST_DISCOUNT_PCT), 0 for vendor/avatar
  devPct: number,            // DEV_FEE_PCT (10) when method==='sol' for shop/ride/vendor; 0 for avatar
  devWalletOk: boolean,
}) // -> { usd, paidUsd, solUsd, discountPct, devPct, swap:boolean, totalLamports, swapLamports, devLamports, devWallet|null,
   //      burnRaw:string, burnMin:string, burnUi:number, devMin:string, ... }   (all bigint amounts as decimal strings)
chain.solUsd()   // -> number (cached SOL/USD), used by GET /api/mint/price
```
### Verify (called from WS `buy` after the client reports its signature)
```js
await chain.verifyPurchase({
  sig: string, swapSig?: string,       // confirmed tx signature(s) reported by the client
  nonce: string,                       // quote id (memo in tx must contain it; replay-protected)
  pid: string, nick: string,           // profile id / display name (for the burn feed)
  kind: 'mint'|'shop'|'ride'|'vendor',
  item?: string, rideId?: string,
  expect: { code?: string, uri?: string, burnMin: bigint, devMin: bigint, devWallet?: string }
}) // -> { ok:true, rec:{ sig, amount:string, wallet, asset?, kind, ts } } | { ok:false, dup?:true, why:string }
```
Requirements: fetch tx at `confirmed`/`finalized`, check signer == buyer wallet, SPL **burn** of `mint` >= `expect.burnMin`, SOL transfer to `expect.devWallet`
>= `expect.devMin`, NFT created with `expect.uri` when given, memo contains `nonce`; idempotent (`dup:true` for a repeat of the same sig).
### Burn tracker (Burn Tracker UI + feed)
```js
chain.burns.stats()    // -> { total:string, count:number, usd?:number, top:[{nick,amount}], recent:[{nick,kind,amount,sig,ts}], codes: Set<string> }
chain.burns.codes      // Set of avatar codes already minted (uniqueness check)
chain.burns.badge(pid) // -> boolean (has minted avatar/ride)    // optional
```
Express routes used by the UI (mount with `chain.mountRoutes(app)` or leave in `server.js`; paths must stay):
`GET /api/burns` (stats JSON, cacheable 5 s) · `GET /api/mint/config` · `GET /api/mint/price` · `POST /api/rpc` (JSON-RPC proxy, method allow-list, hides the RPC key) ·
`GET /nft/:code.json` and `GET /ride/:id.json` (Metaplex metadata, CORS open) · `POST /api/onramp/session`.
### Wallet sign-in / ownership proof (optional, used if the UI offers "sign in with wallet")
```js
chain.auth.challenge(pubkey)                 // -> { nonce, message, expires }
await chain.auth.verify({ pubkey, signature, nonce }) // ed25519 verify of `message`; -> { ok, pubkey } (server then issues its own profile token)
```
### Fiat on-ramp (card / Apple Pay / Google Pay → SOL in the user's wallet)
```js
await chain.onramp.providers()               // -> [{ id:'moonpay'|'coinbase'|'custom', name, sandbox }]
await chain.onramp.session({ provider, address, usd, currency:'SOL', redirect, origin }) // -> { url } (signed hosted-checkout URL)
```
Env: `MOONPAY_API_KEY`, `MOONPAY_SECRET_KEY`, `MOONPAY_ENV`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `ONRAMP_URL_TEMPLATE`, `ONRAMP_URL_NAME`.

---------------------------------------------------------------------------------------------------------------------------------

## 2. Browser API (`src/chain.js` ⇄ `solana/client.js`, ESM)

All functions lazy-load their heavy deps (`@solana/web3.js`, Web3Auth ≈3.7 MB) so the 3D world boots without them.
```js
// ---- wallets ----
hasInjected()                                          // -> boolean  (Phantom / Solflare / Backpack present)
await connectInjected()                                // -> Wallet
await connectEmbedded(cfg, serverUrl, 'google')        // Google sign-in -> non-custodial wallet; -> Wallet
await resumeEmbedded(cfg, serverUrl)                   // silent restore after reload; -> Wallet|null
Wallet = {
  kind:'injected'|'embedded', pubkey:PublicKey, label:string,
  signTransaction(tx:VersionedTransaction): Promise<VersionedTransaction>,
  logout(): Promise<void>,
  exportPrivateKey?(): Promise<string>                 // embedded only: user-initiated backup/recovery screen; MUST be explicit-click only
}
await balances(conn, pubkey)                           // -> bigint lamports
// ---- purchase ----
const prep = await prepare({ q, cfg, server, pubkey, onStep, payToken?, sweep?, reserveLamports? })
//   q = the server's quote object (WS {t:'quote'}), payToken = {mint,decimals,symbol} for "pay with any SPL token" (Jupiter ExactOut),
//   sweep = Entry/Mint: burn the whole on-ramp balance minus simulated fees. onStep(string) is shown as progress text.
//   -> prep = { tx, conn, spentLamports, swapInfo, ... }  (opaque to the UI except tx/conn)
const { sig, swapSig? } = await signAndSend(prep, wallet, onStep)   // wallet.signTransaction + send + confirm; throws Error(userMessage)
// ---- on-ramp / bridge links ----
await onrampUrl(server, { provider, address, usd })    // -> url   (POST /api/onramp/session)
bridgeLinks(address)                                   // -> [{name,url}]  cross-chain bridge deep links (Jupiter/deBridge/Wormhole) – static
```
The UI then sends WS `{t:'buy', qid:q.id, sig, swapSig}` and waits for `{t:'buyres', ok, why?, burned}`.

Error contract: throw `Error` with a **user-readable** message (shown in a toast). Rejected-by-user must be `err.code==='USER_REJECTED'`.

---------------------------------------------------------------------------------------------------------------------------------

## 3. WebSocket messages (owned by `server.js`, listed so the Solana module knows the flow)

| client → server | server → client |
|---|---|
| `{t:'quote', kind, method, item?, plot?, entry?}` | `{t:'quote', q:{id, kind, usd, paidUsd, method, burnRaw, burnMin, swapLamports, devLamports, devWallet, uri, expires, ...}}` or `{t:'quoteerr', why}` |
| `{t:'buy', qid, sig, swapSig?}` | `{t:'buyres', ok, qid, kind?, burned?, why?, retry?}`, then `{t:'inv', ...}` and (ride) `{t:'reveal', ...}` / (vendor) `{t:'vendor', ...}` |
| — | `{t:'burn', ...}` live burn feed entries (from `burns`) |

## 4. What each UI screen calls (so you can test against the real UI)
* **Avatar editor → "Mint avatar NFT"** (`src/ui.js purchaseFlow({kind:'avatar'})`): quote(avatar) → `prepare` → `signAndSend` → WS buy.
* **"🎟 No wallet? Entry / Mint with Google + card"** (`entryModal`): `connectEmbedded` → show address + QR → `onrampUrl` (or send SOL / bridge links) → poll `balances` → `prepare({sweep:true})` → `signAndSend` → WS buy → backup screen (`exportPrivateKey`).
* **Shop / Garage mystery ride** (`purchaseFlow({kind:'shop'|'ride'})`): method picker (Phantom/own wallet, $VWFEST direct, SOL, any SPL token via `payToken`).
* **Vendor booth claim/renew** (`src/vendors.js`): quote(vendor,{plot}) → same flow; server grants the booth only after `verifyPurchase`.
* **Burn Tracker** panel + world sign: `GET /api/burns` and WS `burn` events.

## 5. Shared config (single source of truth = `server.js` `mint`/`vcfg`; also rendered into the in-world Info Booth by `lib/guide.js`)
`MINT_FEE_USD=5` `DEV_FEE_PCT=10` `VWFEST_DISCOUNT_PCT=50` `VENDOR_FEE_USD=30` `VENDOR_DAYS=30` `VENDOR_BOOTHS=24` `ENTRY_ONRAMP_USD`
`DEV_WALLET` `VWFEST_MINT=9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump` `MINT_NETWORK` `RPC_URL`/`RPC_*` `PAY_TOKENS` `WEB3AUTH_CLIENT_ID` `WEB3AUTH_NETWORK`.
**If you add or rename a user-visible number, add it to `lib/guide.js values()` and run `npm run test:guide`** — the Info Booth must never go stale.

## 6. Test hooks
`MINT_NETWORK=devnet|localnet` must work without mainnet funds; provide a `chain.__test.fakeVerify()` (or env `CHAIN_FAKE=1`) that makes `verifyPurchase` accept a signed-by-test-key tx so the UI e2e (`test/e2e.cjs`) can run without a validator.
Current tests: `npm run test:unit`, `test/api.cjs`, `test/guide.cjs`.

## 7. Security contract added after the review (server.js / lib/*, owned by the World/UI worker; `solana/` must keep honouring it)
* **No transaction relay** (decided with the Solana worker): the server never sends or simulates transactions for a client. `POST /api/rpc` is a READ-ONLY, origin-locked proxy
  (getLatestBlockhash, getBalance, getAccountInfo, token-account reads, getSignatureStatuses ...); `sendTransaction`/`simulateTransaction`/`requestAirdrop` return 400 (tested).
  The browser builds the transaction (`src/pay.js prepare`), the wallet signs it, and the browser broadcasts through `PUBLIC_RPC_URL` (published in `/api/config` as `publicRpcUrl`;
  defaults to the public cluster endpoint; a CORS-enabled keyless/limited-key endpoint is expected). The server only verifies the reported signature (`chain.verifyPurchase`).
  Server wiring: `lib/chain.js` = `require('../solana')`; `server.js init()` calls `chain.init({ env, db: lib/db pool })` + `chain.mountRoutes(router, ...)`; quotes come from `chain.quote`
  (ride and avatar quotes pass `devPct = 0`; `MINT_DEV_FEE` defaults to `0` so mints are 100% buyback & burn; the 10% creator fee is only on shop/vendor SOL/token payments);
  purchases are verified by `chain.verifyPurchase` and the returned receipt is written to the Burn Tracker ledger with `Burns.record(rec)` (idempotent by signature).
* **Wallet ownership proof** (WS): `{t:'wauth', pubkey}` → `{t:'wchal', nonce, message, exp}` → wallet `signMessage(message)` → `{t:'wproof', pubkey, nonce, sig(base64)}` → `{t:'wok', ok}`.
  Nonce is single-use, 5-min TTL, bound to the profile. The proof lives in the WS session (30 min). `{t:'buy', qid, sig, wallet}` is refused unless `wallet` is proven
  (`REQUIRE_WALLET_PROOF=0` disables for tests), and `verifyPurchase` receives `expect.wallet` and MUST fail if the tx signer differs. Server helpers: `lib/walletauth.js` `challenge()/verify()`.
  Your `chain.auth.*` can replace `lib/walletauth.js`; keep the message format human-readable and the one-time-nonce semantics.
* **verifyPurchase must be race-safe**: reserve `sig` and avatar `code` synchronously before any `await` and release on failure (`solana/` does this; `Burns.submit` keeps the same guarantee for the legacy ledger path; see `test/security.cjs`).
* **Grants after a verified burn are never silent**: failure returns `{t:'buyres', ok:false, final:true, why}` containing the first 12 chars of the signature; granting is idempotent by signature.
* **Database**: one shared pool from `lib/db.js` with TLS verification (`PG_CA_CERT` / `PG_CA_FILE` for Supabase's CA; `PGSSL_INSECURE=1` is an emergency escape hatch). Do not create your own `Pool`.
* **Secrets**: `lib/secret.js` — `SERVER_SECRET` (≥16 chars) is mandatory when `NODE_ENV=production`.
* **TURN** credentials are only sent over the authenticated WS (`welcome.iceServers`), never in `/api/config`.
