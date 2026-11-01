// REAL-CHAIN purchase E2E: a local solana-test-validator (with mpl-core cloned from devnet) + the real server.js, real signed transactions, no CHAIN_FAKE.
// Run: scripts/qa-localnet.sh (starts the validator) or LOCALNET_RPC=http://127.0.0.1:18899 node test/e2e-localnet.cjs. Skips (exit 0) when no validator is reachable.
'use strict';
const assert = require('assert'); const WebSocket = require('ws'); const nacl = require('tweetnacl');
const w3 = require('@solana/web3.js'); const spl = require('../solana/node_modules/@solana/spl-token');
const { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, LAMPORTS_PER_SOL } = w3;
const RPC = process.env.LOCALNET_RPC || 'http://127.0.0.1:18899'; const PORT = +(process.env.QA_PORT || 3471), BASE = `http://127.0.0.1:${PORT}`;
const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const conn = new Connection(RPC, 'confirmed'); const DEC = 6;
let n = 0, failed = 0; const results = [];
const t = async (name, f) => { try { await f(); n++; results.push([name, 'PASS']); console.log('ok  ', name); } catch (e) { failed++; results.push([name, 'FAIL: ' + e.message]); console.error('FAIL', name, (e.stack || '').split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const air = async (pk, sol) => { const s = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL); await conn.confirmTransaction(s, 'confirmed'); };
const u64 = (x) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(x)); return b; };
const str = (s) => { const e = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(e.length); return Buffer.concat([l, e]); };

(async () => {
  try { await conn.getVersion(); } catch { console.log('SKIP: no local validator at ' + RPC); return; }
  if (!(await conn.getAccountInfo(CORE))) { console.log('SKIP: mpl-core not loaded on the validator (start it with --clone-upgradeable-program CoRE…)'); return; }
  // ---- chain fixtures: a stand-in $VWFEST mint, a decoy mint, the creator wallet ----
  const auth = Keypair.generate(); await air(auth.publicKey, 10);
  const mint = await spl.createMint(conn, auth, auth.publicKey, null, DEC); const decoy = await spl.createMint(conn, auth, auth.publicKey, null, DEC);
  const dev = Keypair.generate(); await air(dev.publicKey, 1); const other = Keypair.generate(); await air(other.publicKey, 1);
  Object.assign(process.env, { SERVER_SECRET: 'qa-localnet-secret-0123456789abcdef', PORT: String(PORT), MINT_NETWORK: 'localnet', SOLANA_NETWORK: 'localnet', MINT_ENABLED: '1', RPC_URL: RPC, PUBLIC_RPC_URL: '', FIXED_SOL_USD: '150', DEV_WALLET: dev.publicKey.toBase58(), DEVNET_VWFEST_MINT: mint.toBase58(), VWFEST_MINT: mint.toBase58(), VWFEST_DECIMALS: String(DEC), JOIN_COOLDOWN_MS: '0', MAX_CONNS_PER_IP: '200', PROFILE_CREATE_PER_HOUR: '100', PUBLIC_BASE_URL: BASE, DATABASE_URL: '' });
  delete process.env.CHAIN_FAKE;
  const S = require('../server.js'); const chain = require('../lib/chain'); const F = chain.__test.facade; const quoteid = require('../lib/quoteid');
  await S.init(); await new Promise((r) => S.server.listen(PORT, '127.0.0.1', r));
  assert(S.mint.enabled, 'purchases armed on localnet: ' + S.mint.reason); assert(!chain.fake, 'real chain, not CHAIN_FAKE');

  const buyer = async (nick, tokens = 100000) => {
    const kp = Keypair.generate(); await air(kp.publicKey, 5);
    const ata = await spl.getOrCreateAssociatedTokenAccount(conn, auth, mint, kp.publicKey); await spl.mintTo(conn, auth, mint, ata.address, auth, BigInt(tokens) * 10n ** BigInt(DEC));
    const dat = await spl.getOrCreateAssociatedTokenAccount(conn, auth, decoy, kp.publicKey); await spl.mintTo(conn, auth, decoy, dat.address, auth, BigInt(tokens) * 10n ** BigInt(DEC));
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: BASE } }); const c = { ws, kp, ata: ata.address, dat: dat.address, msgs: [], waiters: [] };
    ws.on('message', (d, bin) => { if (bin) return; const m = JSON.parse(d); c.msgs.push(m); const w = c.waiters.find((x) => [].concat(x.t).includes(m.t) && (!x.f || x.f(m))); if (w) { c.waiters.splice(c.waiters.indexOf(w), 1); m._seen = true; w.r(m); } });
    c.wait = (tt, ms = 30000, f) => new Promise((r, j) => { const old = c.msgs.find((m) => [].concat(tt).includes(m.t) && !m._seen && (!f || f(m))); if (old) { old._seen = true; return r(old); } const to = setTimeout(() => j(new Error('timeout ' + tt)), ms); c.waiters.push({ t: tt, f, r: (m) => { clearTimeout(to); r(m); } }); });
    c.send = (o) => ws.send(JSON.stringify(o)); await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    await c.wait('hi'); c.send({ t: 'join', nick, quiz: {} }); const wel = await Promise.race([c.wait('welcome'), c.wait('joinerr').then((m) => { throw new Error('joinerr ' + m.why); })]); c.pid = wel.pid;
    c.prof = () => S.profiles.byId.get(S.hub.players.get(c.pid) ? S.hub.players.get(c.pid).prof.id : null) || [...S.hub.players.values()].find((p) => p.conn && p.conn.ws === undefined) ;
    c.player = () => [...S.hub.players.values()].find((p) => p.nick === nick);
    const pk = kp.publicKey.toBase58(); c.send({ t: 'wauth', pubkey: pk }); const ch = await c.wait('wchal');
    c.send({ t: 'wproof', pubkey: pk, nonce: ch.nonce, sig: Buffer.from(nacl.sign.detached(Buffer.from(ch.message), kp.secretKey)).toString('base64') }); assert((await c.wait('wok')).ok, 'wallet proof');
    c.quote = async (m) => { await sleep(1300); c.send({ t: 'quote', ...m }); const x = await c.wait(['quote', 'quoteerr']); if (x.t === 'quoteerr') throw new Error('quoteerr ' + x.why); return x.q; };
    c.buy = async (qid, sig, wallet = pk) => { c.send({ t: 'buy', qid, sig, wallet }); return c.wait('buyres', 60000, (m) => m.qid === qid); };
    return c;
  };
  // Builds the same transaction shape as src/pay.js build() on a test network (no Jupiter swap): [CU] [SOL fee -> creator] burnChecked [Core create] memo.
  const pay = async (c, q, o = {}) => {
    const signer = o.signer || c.kp; const user = signer.publicKey; const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 })];
    const devL = o.devLamports !== undefined ? BigInt(o.devLamports) : BigInt(q.devLamports);
    if (devL > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: o.devTo || new PublicKey(q.devWallet), lamports: devL }));
    const useMint = o.mint || mint; const ata = o.ata || (o.mint ? c.dat : spl.getAssociatedTokenAddressSync(useMint, user));
    ixs.push(spl.createBurnCheckedInstruction(ata, useMint, user, BigInt(o.burn !== undefined ? o.burn : q.burnRaw), DEC));
    let asset = null; if (q.uri && !o.noNft) { asset = Keypair.generate(); const none = { pubkey: CORE, isSigner: false, isWritable: false };
      ixs.push(new TransactionInstruction({ programId: CORE, keys: [{ pubkey: asset.publicKey, isSigner: true, isWritable: true }, none, none, { pubkey: user, isSigner: true, isWritable: true }, none, none, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, none], data: Buffer.concat([Buffer.from([0, 0]), str(q.name || 'VW FEST NFT'), str(o.uri || q.uri), Buffer.from([0])]) })); }
    ixs.push(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: user, isSigner: true, isWritable: false }], data: Buffer.from('vwfest:' + (o.memo || q.id)) }));
    const { blockhash } = await conn.getLatestBlockhash('confirmed'); const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    tx.sign([signer, ...(asset ? [asset] : [])]); assert(tx.serialize().length <= 1232, 'tx fits a packet'); const sig = await conn.sendRawTransaction(tx.serialize()); await conn.confirmTransaction(sig, 'confirmed'); return { sig, asset };
  };
  const tokBal = async (a) => BigInt((await conn.getTokenAccountBalance(a, 'confirmed')).value.amount);
  const supply = async () => BigInt((await conn.getTokenSupply(mint, 'confirmed')).value.amount);
  const assetOwner = async (a) => { const i = await conn.getAccountInfo(a, 'confirmed'); assert(i && i.owner.equals(CORE), 'Core asset exists'); return new PublicKey(i.data.subarray(1, 33)).toBase58(); };
  const prof = (c) => c.player().prof;

  const A = await buyer('QaAlice'); const B = await buyer('QaBob');

  // ================= HAPPY PATHS (money first) =================
  let avatarSig;
  await t('avatar mint (SOL): exact burn, no creator fee, NFT minted to buyer, minted badge', async () => {
    const q = await A.quote({ kind: 'avatar', method: 'sol' }); assert.strictEqual(q.devLamports, '0'); assert.strictEqual(q.devPct, 0);
    assert.strictEqual(q.burnRaw, String(Math.round(S.mint.feeUsd * S.mint.devnetTokensPerUsd * 10 ** DEC)), 'burn = fee USD * tokens/USD');
    const s0 = await supply(), d0 = await conn.getBalance(dev.publicKey); const { sig, asset } = await pay(A, q); avatarSig = sig; const r = await A.buy(q.id, sig); assert(r.ok, r.why);
    assert.strictEqual(s0 - (await supply()), BigInt(q.burnRaw), 'supply burned exactly'); assert.strictEqual(await conn.getBalance(dev.publicKey), d0, 'creator got nothing');
    assert.strictEqual(await assetOwner(asset.publicKey), A.kp.publicKey.toBase58(), 'NFT owned by buyer'); assert(A.player().minted || S.burns.forProfile(prof(A).id).length >= 1);
  });
  let rideQ, rideSig;
  await t('Mystery Ride (SOL): burn exact, ride revealed + equipped, NFT to buyer', async () => {
    const q = await A.quote({ kind: 'ride', method: 'sol' }); rideQ = q; assert.strictEqual(q.devLamports, '0'); assert(q.uri && q.uri.endsWith('/ride/' + q.id + '.json'));
    const s0 = await supply(); const { sig, asset } = await pay(A, q); rideSig = sig; const r = await A.buy(q.id, sig); assert(r.ok, r.why);
    const rev = await A.wait('reveal'); assert(rev.ride && rev.ride.id === q.id); assert.strictEqual(s0 - (await supply()), BigInt(q.burnRaw));
    assert.strictEqual(S.rides.byId.get(q.id).pid, prof(A).id); assert.strictEqual(S.rides.byId.get(q.id).asset, asset.publicKey.toBase58(), 'ride bound to the minted asset');
    assert.strictEqual(prof(A).ride, q.id, 'equipped'); assert.strictEqual(await assetOwner(asset.publicKey), A.kp.publicKey.toBase58());
    const meta = await (await fetch(BASE + '/ride/' + q.id + '.json')).json(); assert(meta.name && meta.image, 'metadata served');
  });
  await t('Mystery Ride ($VWFEST): discounted burn, granted', async () => {
    const q = await B.quote({ kind: 'ride', method: 'vwfest' }); assert.strictEqual(q.devLamports, '0'); assert.strictEqual(q.discountPct, S.mint.discountPct);
    assert.strictEqual(BigInt(q.burnRaw), BigInt(Math.ceil(S.mint.rideUsd * (1 - q.discountPct / 100) * S.mint.devnetTokensPerUsd * 10 ** DEC)), 'discounted burn');
    const b0 = await tokBal(B.ata); const { sig } = await pay(B, q); const r = await B.buy(q.id, sig); assert(r.ok, r.why); await B.wait('reveal');
    assert.strictEqual(b0 - (await tokBal(B.ata)), BigInt(q.burnRaw)); assert(S.rides.forProfile(prof(B).id).length === 1);
  });
  await t('Outfit Shop (SOL): 50/50 split, exact lamports to DEV_WALLET, item granted + equipped', async () => {
    const q = await A.quote({ kind: 'shop', item: 'halo', method: 'sol' }); assert.strictEqual(q.devWallet, dev.publicKey.toBase58()); assert.strictEqual(BigInt(q.devLamports) + BigInt(q.swapLamports), BigInt(q.totalLamports));
    const d0 = await conn.getBalance(dev.publicKey), s0 = await supply(); const { sig } = await pay(A, q); const r = await A.buy(q.id, sig); assert(r.ok, r.why);
    assert.strictEqual(BigInt(await conn.getBalance(dev.publicKey)) - BigInt(d0), BigInt(q.devLamports), 'creator received exactly the quoted fee'); assert.strictEqual(s0 - (await supply()), BigInt(q.burnRaw));
    assert(prof(A).items.has('halo')); assert.strictEqual(prof(A).equipped.hat, 'halo');
  });
  await t('Outfit Shop ($VWFEST): no creator fee, item granted', async () => {
    const q = await B.quote({ kind: 'shop', item: 'neon_shades', method: 'vwfest' }); assert.strictEqual(q.devLamports, '0');
    const { sig } = await pay(B, q); const r = await B.buy(q.id, sig); assert(r.ok, r.why); assert(prof(B).items.has('neon_shades'));
    await assert.rejects(B.quote({ kind: 'shop', item: 'neon_shades', method: 'vwfest' }), /already own/);
  });
  await t('Vendor booth (SOL, 30 days): fee split, plot granted for vcfg.days', async () => {
    const q = await B.quote({ kind: 'vendor', plot: 3, method: 'sol' }); assert.strictEqual(q.plot, 3); assert.strictEqual(q.days, S.vcfg.days);
    const d0 = await conn.getBalance(dev.publicKey); const { sig } = await pay(B, q); const r = await B.buy(q.id, sig); assert(r.ok, r.why); const v = await B.wait('vendor');
    assert.strictEqual(v.plot, 3); const days = (v.exp - Date.now()) / 86400e3; assert(Math.abs(days - S.vcfg.days) < 0.01, 'expires in ' + days + ' days');
    assert.strictEqual(BigInt(await conn.getBalance(dev.publicKey)) - BigInt(d0), BigInt(q.devLamports));
  });
  await t('Vendor booth ($VWFEST): full fee burned (no discount), plot granted', async () => {
    const q = await A.quote({ kind: 'vendor', plot: 5, method: 'vwfest' }); assert.strictEqual(q.discountPct, 0);
    const { sig } = await pay(A, q); const r = await A.buy(q.id, sig); assert(r.ok, r.why); assert.strictEqual((await A.wait('vendor')).plot, 5);
  });

  // ================= FAILURE PATHS =================
  const noGrant = async (c, name, setup) => { const items0 = prof(c).items.size, rides0 = S.rides.forProfile(prof(c).id).length, burns0 = F.tracker.all().length; const r = await setup(); assert(!r.ok, name + ' must be refused'); assert.strictEqual(prof(c).items.size, items0); assert.strictEqual(S.rides.forProfile(prof(c).id).length, rides0); assert.strictEqual(F.tracker.all().length, burns0, 'nothing recorded'); return r; };
  await t('replay: an already-credited signature on a NEW quote is refused', async () => { await noGrant(A, 'replay', async () => { const q = await A.quote({ kind: 'shop', item: 'top_hat', method: 'vwfest' }); return A.buy(q.id, rideSig); }); });
  await t('replay: the same sig+quote again does not grant twice', async () => { const rides0 = S.rides.forProfile(prof(A).id).length; const r = await A.buy(rideQ.id, rideSig); assert(!r.ok || r.ok && S.rides.forProfile(prof(A).id).length === rides0); assert.strictEqual(S.rides.forProfile(prof(A).id).length, rides0); });
  await t('quote reuse: a second real tx carrying a redeemed quote id is refused', async () => { await noGrant(A, 'reuse', async () => { const { sig } = await pay(A, rideQ); return A.buy(rideQ.id, sig); }); });
  await t('cross-player: B cannot redeem A\'s signature or quote id', async () => { await noGrant(B, 'xplayer', async () => B.buy(rideQ.id, rideSig)); });
  await t('underpayment: burn of burnMin-1 is refused', async () => { await noGrant(A, 'under', async () => { const q = await A.quote({ kind: 'shop', item: 'top_hat', method: 'vwfest' }); const { sig } = await pay(A, q, { burn: BigInt(q.burnMin) - 1n }); return A.buy(q.id, sig); }); });
  await t('wrong token: burning a decoy mint is refused', async () => { await noGrant(A, 'decoy', async () => { const q = await A.quote({ kind: 'shop', item: 'gold_bucket', method: 'vwfest' }); const { sig } = await pay(A, q, { mint: decoy }); return A.buy(q.id, sig); }); });
  await t('wrong recipient: creator fee sent elsewhere is refused', async () => { await noGrant(A, 'recipient', async () => { const q = await A.quote({ kind: 'shop', item: 'rainbow_beanie', method: 'sol' }); const { sig } = await pay(A, q, { devTo: other.publicKey }); return A.buy(q.id, sig); }); });
  await t('short creator fee is refused', async () => { await noGrant(A, 'shortfee', async () => { const q = await A.quote({ kind: 'shop', item: 'rainbow_beanie', method: 'sol' }); const { sig } = await pay(A, q, { devLamports: BigInt(q.devLamports) / 2n }); return A.buy(q.id, sig); }); });
  await t('memo mismatch: a burn tagged for another quote is refused', async () => { await noGrant(A, 'memo', async () => { const q = await A.quote({ kind: 'shop', item: 'rainbow_beanie', method: 'sol' }); const { sig } = await pay(A, q, { memo: 'qAAAA' }); return A.buy(q.id, sig); }); });
  await t('wrong signer: a tx paid by a different (unproven) wallet is refused', async () => { await noGrant(A, 'signer', async () => { const q = await A.quote({ kind: 'shop', item: 'rainbow_beanie', method: 'vwfest' }); const C = Keypair.generate(); await air(C.publicKey, 1); const cat = await spl.getOrCreateAssociatedTokenAccount(conn, auth, mint, C.publicKey); await spl.mintTo(conn, auth, mint, cat.address, auth, 10n ** 12n); const { sig } = await pay(A, q, { signer: C, ata: cat.address }); return A.buy(q.id, sig); }); });
  await t('NFT mismatch: ride paid but minted with another uri is refused', async () => { await noGrant(A, 'uri', async () => { const q = await A.quote({ kind: 'ride', method: 'sol' }); const { sig } = await pay(A, q, { uri: BASE + '/ride/fake.json' }); return A.buy(q.id, sig); }); });
  await t('NFT missing: ride paid without the Core mint is refused', async () => { await noGrant(A, 'nonft', async () => { const q = await A.quote({ kind: 'ride', method: 'sol' }); const { sig } = await pay(A, q, { noNft: true }); return A.buy(q.id, sig); }); });
  await t('expired quote: a tx confirmed after expiry+grace is refused', async () => { await noGrant(A, 'expired', async () => { const id = quoteid.sign(process.env.SERVER_SECRET, { kind: 'shop', method: 'vwfest', pid: prof(A).id, item: 'top_hat', burnMin: '1', devMin: '0', expires: Date.now() - 6 * 60e3 }); const { sig } = await pay(A, { id, burnRaw: '1000000', devLamports: '0' }); const r = await A.buy(id, sig); assert(/expired/i.test(r.why), r.why); return r; }); });
  await t('quote cache evicted (restart / pay.recover): a valid burn still credits once', async () => { const q = await A.quote({ kind: 'shop', item: 'top_hat', method: 'vwfest' }); const { sig } = await pay(A, q); S.pay.quotes.clear(); S.pay.active.clear(); const r = await A.buy(q.id, sig); assert(r.ok, r.why); assert(prof(A).items.has('top_hat')); const n0 = prof(A).items.size; const r2 = await A.buy(q.id, sig); assert.strictEqual(prof(A).items.size, n0, 'idempotent re-delivery, no second grant'); assert.strictEqual(F.tracker.all().filter((x) => x.sig === sig).length, 1); });
  await t('double submit: two concurrent buys of one tx grant exactly once', async () => { const q = await B.quote({ kind: 'shop', item: 'gold_bucket', method: 'vwfest' }); const { sig } = await pay(B, q); B.send({ t: 'buy', qid: q.id, sig, wallet: B.kp.publicKey.toBase58() }); B.send({ t: 'buy', qid: q.id, sig, wallet: B.kp.publicKey.toBase58() }); const a = await B.wait('buyres', 60000, (m) => m.qid === q.id); const b = await B.wait('buyres', 60000, (m) => m.qid === q.id); assert.strictEqual([a, b].filter((x) => x.ok).length, 1, JSON.stringify([a.why, b.why])); assert.strictEqual(F.tracker.all().filter((x) => x.sig === sig).length, 1); });
  await t('RPC outage: buy returns retry (no grant), then credits after RPC recovers', async () => { const q = await B.quote({ kind: 'shop', item: 'rainbow_beanie', method: 'vwfest' }); const { sig } = await pay(B, q); const real = F.conn; F.conn = new Connection('http://127.0.0.1:1', 'confirmed');
    try { const r = await B.buy(q.id, sig); assert(!r.ok && r.retry, 'retryable: ' + JSON.stringify(r)); assert(!prof(B).items.has('rainbow_beanie')); } finally { F.conn = real; } const r2 = await B.buy(q.id, sig); assert(r2.ok, r2.why); assert(prof(B).items.has('rainbow_beanie')); });
  await t('DB degraded: quotes and buys pause (retry), nothing credited', async () => { const q = await A.quote({ kind: 'shop', item: 'gold_bucket', method: 'vwfest' }); const { sig } = await pay(A, q); Object.defineProperty(S.burns, 'degraded', { get: () => true, configurable: true });
    try { const r = await A.buy(q.id, sig); assert(!r.ok && r.retry && /paused/i.test(r.why)); await assert.rejects(A.quote({ kind: 'shop', item: 'neon_shades', method: 'vwfest' }), /paused/i); } finally { delete S.burns.degraded; } const r2 = await A.buy(q.id, sig); assert(r2.ok, r2.why); });
  await t('purchases OFF (MINT_ENABLED=0 equivalent): quote refused, buy refused with retry, payment stays redeemable', async () => { const q = await B.quote({ kind: 'avatar', method: 'sol' }); const { sig } = await pay(B, q); S.mint.enabled = false;
    try { await assert.rejects(B.quote({ kind: 'ride', method: 'sol' }), /not open/); const r = await B.buy(q.id, sig); assert(!r.ok && r.retry); } finally { S.mint.enabled = true; } const r2 = await B.buy(q.id, sig); assert(r2.ok, r2.why); });
  await t('vendor replay: re-submitting the booth tx does not extend the booth again', async () => { const b = S.vendors.byPid.get(prof(A).id); const e0 = b.expiresAt; const sig = b.sigs[0]; const qid = F.tracker.all().find((x) => x.sig === sig).quoteId; await A.buy(qid, sig); assert.strictEqual(S.vendors.byPid.get(prof(A).id).expiresAt, e0); });
  await t('avatar code: the same avatar cannot be minted twice', async () => { await assert.rejects(A.quote({ kind: 'avatar', method: 'sol' }), /already been minted/); });
  await t('concurrent buyers: 4 players mint rides in parallel, all credited once', async () => { const P = await Promise.all([1, 2, 3, 4].map((i) => buyer('QaPar' + i))); const out = await Promise.all(P.map(async (c) => { const q = await c.quote({ kind: 'ride', method: 'sol' }); const { sig } = await pay(c, q); return c.buy(q.id, sig); }));
    assert(out.every((r) => r.ok), JSON.stringify(out.map((r) => r.why))); for (const c of P) assert.strictEqual(S.rides.forProfile(prof(c).id).length, 1); });

  await t('10-account batching: stray-account check works through an RPC that rejects >10 accounts (Allnodes -32602), and still catches a stray', async () => {
    const http = require('http'); let maxSeen = 0; const px = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', async () => { const j = JSON.parse(b);
      if (j.method === 'getMultipleAccounts') { maxSeen = Math.max(maxSeen, j.params[0].length); if (j.params[0].length > 10) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: { code: -32602, message: 'A maximum of 10 accounts is allowed' } })); } }
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b }); res.setHeader('content-type', 'application/json'); res.end(await r.text()); }); });
    await new Promise((r) => px.listen(PORT + 1, '127.0.0.1', r)); try { const pc = new Connection(`http://127.0.0.1:${PORT + 1}`, 'confirmed'); const { assertNoStrayUserTokenAccounts } = require('../solana/src/jupiter');
      const keys = Array.from({ length: 25 }, () => ({ pubkey: Keypair.generate().publicKey.toBase58() })); const user = A.kp.publicKey.toBase58();
      await assertNoStrayUserTokenAccounts(pc, [{ accounts: keys }], user, []); assert(maxSeen > 0 && maxSeen <= 10, 'batched: ' + maxSeen);
      await assert.rejects(assertNoStrayUserTokenAccounts(pc, [{ accounts: [...keys, { pubkey: A.dat.toBase58() }] }], user, []), /another token account/, 'the 26th (stray) account is still caught'); } finally { px.close(); } });
  console.log('\nMATRIX'); for (const [k, v] of results) console.log(' - ' + k + ' : ' + v);
  console.log(`\n${n} passed, ${failed} failed`); process.exit(process.exitCode || 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
