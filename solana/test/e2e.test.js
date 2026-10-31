'use strict';
// End-to-end on a REAL local validator (solana-test-validator with the real mpl-core program): HTTP router + browser client lib + wallet adapter.
const test = require('node:test'); const assert = require('node:assert/strict'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const nacl = require('tweetnacl'); const { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const spl = require('@solana/spl-token'); const express = require('express'); const rateLimit = require('express-rate-limit');
const { startValidator, testEnv } = require('./helpers'); const setup = require('../src/setup'); const { Solana, createRouter } = Object.assign({}, require('../src/index'), require('../src/routes')); const R = require('../src/rides'); const C = require('../src/config'); const nft = require('../src/nft');

const ORIGIN = 'http://site.test'; const ctx = {}; let skip = false;
const SVG = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${t}</title><rect width="10" height="10" fill="#f0f"/></svg>`;
const traits = (n) => ({ Sex: 'Female', Hair: 'Teal ' + n, Personality: 'Chill Cruiser', Body: 'Average', 'Favorite VW': 'Bus' });
const supply = async (conn, mint) => BigInt((await conn.getTokenSupply(new PublicKey(mint))).value.amount);
const bal = async (conn, mint, owner) => { const a = spl.getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner)); return BigInt((await conn.getTokenAccountBalance(a)).value.amount); };
async function newUser(sol = 3) { const kp = Keypair.generate(); await setup.airdrop(ctx.conn, kp.publicKey, sol); const client = ctx.createClient({ base: ctx.base, origin: ORIGIN, connection: ctx.conn, wallet: ctx.keypairAdapter(kp, nacl) }); await client.connect(); await client.signIn(); return { kp, client, w: kp.publicKey.toBase58() }; }

test.before(async () => {
  const v = await startValidator(); if (!v) { skip = true; return; } ctx.v = v;
  const env = testEnv({ SOLANA_STORE_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vwst-')), 'store.jsonl'), DEV_WALLET: Keypair.generate().publicKey.toBase58(), RPC_URL: v.rpc, PUBLIC_RPC_URL: v.rpc });
  ctx.env = env; const cfg0 = C.loadConfig(env); ctx.conn = new Connection(v.rpc, 'confirmed');
  await setup.airdrop(ctx.conn, cfg0.authority.publicKey, 5);
  env.DEVNET_VWFEST_MINT = (await setup.createTestMint(ctx.conn, cfg0.authority, 6)).toBase58();
  const cols = await setup.createCollections(ctx.conn, C.loadConfig(env), env.PUBLIC_BASE_URL); env.AVATAR_COLLECTION = cols.avatar; env.RIDE_COLLECTION = cols.ride;
  ctx.grants = []; ctx.minted = [];
  const mk = () => new Solana({ env, onGrant: async (r) => { ctx.grants.push(r); }, onMinted: async (m) => { ctx.minted.push(m); }, shopPrice: (id) => ({ halo: 6, hat: 4 })[id] || null, rideImage: async (r) => SVG('ride ' + r.id), allowedDomains: ['site.test'] });
  ctx.mk = mk; ctx.sg = mk(); ctx.sg.verifyDelayMs = 300; ctx.sg.verifyTries = 6; await ctx.sg.init(); ctx.cfg = ctx.sg.cfg;
  const app = express(); app.use('/api/solana', createRouter({ solana: ctx.sg, express, rateLimit: (o) => rateLimit({ ...o, limit: 1000 }), allowedOrigins: [ORIGIN] }));
  ctx.srv = http.createServer(app); await new Promise((r) => ctx.srv.listen(0, r)); ctx.base = `http://127.0.0.1:${ctx.srv.address().port}/api/solana`;
  const m = await import('../src/client/index.mjs'); ctx.createClient = m.createClient; ctx.keypairAdapter = m.keypairAdapter;
  ctx.alice = await newUser(); ctx.bob = await newUser();
});
test.after(async () => { if (ctx.srv) ctx.srv.close(); if (ctx.sg) await ctx.sg.close(); if (ctx.v) ctx.v.stop(); });

test('config + auth gating', async (t) => {
  if (skip) return t.skip('no solana-test-validator');
  const cfg = await (await fetch(ctx.base + '/config')).json(); assert.equal(cfg.enabled, true); assert.equal(cfg.network, 'localnet'); assert.equal(cfg.discountPct, 50); assert.equal(cfg.devFeePct, 10); assert.equal(cfg.rpcUrl, ctx.v.rpc);
  assert.ok(!JSON.stringify(cfg).includes(Buffer.from(ctx.cfg.authority.secretKey).toString('hex')) && !JSON.stringify(cfg).includes('serverSecret'));
  assert.equal(cfg.odds.length, 5); assert.equal(cfg.collections.avatar, ctx.env.AVATAR_COLLECTION);
  const r = await fetch(ctx.base + '/quote', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{}' }); assert.equal(r.status, 401);
  const r2 = await fetch(ctx.base + '/auth/challenge', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.test' }, body: JSON.stringify({ wallet: ctx.alice.w }) }); assert.equal(r2.status, 403, 'POST from a foreign origin is refused');
  for (const p of ['/tx/send', '/send', '/rpc', '/relay']) assert.equal((await fetch(ctx.base + p, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' })).status, 404, 'no server-side send/relay: ' + p);
});

test('faucet + avatar mint paid in $VWFEST (50% off, burned), unique per trait set, NFT in the collection', async (t) => {
  if (skip) return t.skip('no solana-test-validator');
  const { client, w } = ctx.alice; await client.faucet(); const mint = ctx.cfg.vwfestMint;
  const s0 = await supply(ctx.conn, mint); let shown;
  const res = await client.purchase({ kind: 'avatar', method: 'vwfest', nft: { traits: traits('A'), name: 'Alice Avatar', imageSvg: SVG('alice') } }, { nick: 'Alice', onQuote: (q) => { shown = q; } });
  assert.equal(shown.paidUsd, 2.5); assert.equal(shown.discountPct, 50); assert.equal(shown.burnUi, 25); assert.equal(shown.devLamports, '0');
  assert.equal(await supply(ctx.conn, mint), s0 - 25_000_000n, 'exactly 25 test tokens burned on-chain'); assert.equal(res.receipt.burned, '25000000');
  assert.equal(ctx.grants.length, 1); assert.equal(ctx.grants[0].kind, 'avatar'); assert.equal(ctx.grants[0].wallet, w);
  const info = await ctx.conn.getAccountInfo(new PublicKey(res.mint.asset)); const a = nft.parseAsset(info.data); assert.equal(a.owner, w); assert.equal(a.updateAuthority.type, 'collection'); assert.equal(a.updateAuthority.address, ctx.env.AVATAR_COLLECTION); assert.equal(a.name, 'Alice Avatar');
  const meta = await (await fetch(a.uri.replace('http://localhost:3999', ctx.base.replace('/api/solana', '')))).json(); assert.equal(meta.collection.name, 'VW Fest Show Grounds Avatars'); assert.ok(meta.attributes.find((x) => x.trait_type === 'Hair' && x.value === 'Teal A')); assert.match(meta.image, /nft\/img\//);
  const col = await ctx.conn.getAccountInfo(new PublicKey(ctx.env.AVATAR_COLLECTION)); assert.ok(col.owner.equals(nft.CORE)); assert.ok(ctx.minted.length === 1 && ctx.minted[0].asset === res.mint.asset);
  // one mint per unique trait set
  await assert.rejects(ctx.bob.client.quote({ kind: 'avatar', method: 'vwfest', nft: { traits: traits('A'), imageSvg: SVG('x') } }), /already been minted/);
  await assert.rejects(client.quote({ kind: 'avatar', method: 'vwfest', nft: { traits: { ...traits('A') }, imageSvg: SVG('x') } }), /already been minted/);
  const q2 = await client.quote({ kind: 'avatar', method: 'vwfest', nft: { traits: traits('B'), imageSvg: SVG('b') } }); await assert.rejects(ctx.bob.client.quote({ kind: 'avatar', method: 'vwfest', nft: { traits: traits('B'), imageSvg: SVG('b') } }), /Someone else is minting/, 'trait set is reserved while another wallet holds a quote'); assert.ok(q2.id);
  await assert.rejects(client.quote({ kind: 'avatar', method: 'vwfest', nft: { traits: traits('C'), imageSvg: '<svg><script>1</script></svg>' } }), /disallowed/);
  // burn tracker + receipts
  const burns = await client.burns(); assert.equal(burns.totalBurned, 25); assert.equal(burns.count, 1); assert.equal(burns.recent[0].nick, 'Alice'); assert.equal(burns.recent[0].asset, res.mint.asset); assert.match(burns.recent[0].wallet, /…/);
});

test('shop paid in SOL: 10% to DEV_WALLET, 90% burned; vendor booth $30 no discount; shop price is server-side only', async (t) => {
  if (skip) return t.skip('no solana-test-validator');
  const { client, w } = ctx.alice; await new Promise((r) => setTimeout(r, 1100)); await client.faucet().catch(() => {}); const mint = ctx.cfg.vwfestMint; const dev = ctx.cfg.devWallet;
  const s0 = await supply(ctx.conn, mint), d0 = await ctx.conn.getBalance(new PublicKey(dev));
  const r = await client.purchase({ kind: 'shop', item: 'halo', method: 'sol' }); // halo = $6 -> dev 0.6 USD = 0.006 SOL, burn 5.4 USD = 54 tokens
  assert.equal(r.quote.usd, 6); assert.equal(r.quote.devPct, 10); assert.equal(r.quote.devLamports, String(0.006 * LAMPORTS_PER_SOL)); assert.equal(r.quote.burnUi, 54);
  assert.equal((await ctx.conn.getBalance(new PublicKey(dev))) - d0, 6_000_000); assert.equal(s0 - (await supply(ctx.conn, mint)), 54_000_000n); assert.equal(r.receipt.devLamports, '6000000'); assert.equal(r.mint, null);
  const g = ctx.grants.at(-1); assert.equal(g.kind, 'shop'); assert.equal(g.item, 'halo');
  const hv = await client.quote({ kind: 'shop', item: 'halo', method: 'vwfest' }); assert.equal(hv.paidUsd, 3);
  await assert.rejects(client.quote({ kind: 'shop', item: 'free-thing', method: 'sol' }), /Unknown shop item/);
  const vs = await client.quote({ kind: 'vendor', method: 'vwfest' }); assert.equal(vs.paidUsd, 30); assert.equal(vs.discountPct, 0); assert.equal(vs.burnUi, 300);
  const vsol = await client.quote({ kind: 'vendor', method: 'sol' }); assert.equal(vsol.devLamports, String(0.03 * LAMPORTS_PER_SOL)); assert.equal(vsol.burnUi, 270);
  const pre = ctx.grants.length; const pv = await client.pay(vs); assert.equal(pv.receipt.burned, '300000000'); assert.equal(ctx.grants.length, pre + 1);
  await assert.rejects(client.pay({ ...vs }), /already used|Unknown|already paid/);
  const spl_ = await client.quote({ kind: 'avatar', method: 'spl', payTokenMint: C.loadConfig({}).payTokens[0].mint, nft: { traits: traits('Z'), imageSvg: SVG('z') } }).catch((e) => e); assert.match(spl_.message, /mainnet liquidity/);
});

test('ride mint: commit-reveal, published odds, verifiable; Rides collection', async (t) => {
  if (skip) return t.skip('no solana-test-validator');
  const { client, w } = ctx.alice; await new Promise((r) => setTimeout(r, 1100)); await client.faucet().catch(() => {});
  const q = await client.quote({ kind: 'ride', method: 'vwfest' }); assert.equal(q.commit.length, 64); assert.equal(q.memo, 'vwfest:' + q.id + ':' + q.commit); assert.equal(q.seed, undefined, 'seed never leaves before the roll');
  const p = await client.pay(q); assert.ok(p.receipt.ride.seed && p.receipt.ride.commit === q.commit);
  assert.deepEqual(R.verifyRide({ seed: p.receipt.ride.seed, commit: q.commit, sig: p.signature, reroll: p.receipt.ride.reroll, spec: p.receipt.ride.spec }), { ok: true });
  // the commit really is on-chain in the memo, before the roll
  const tx = await ctx.conn.getParsedTransaction(p.signature, { maxSupportedTransactionVersion: 0 }); assert.ok(tx.transaction.message.instructions.some((i) => i.parsed === q.memo));
  const m = await client.mint(q); const a = nft.parseAsset((await ctx.conn.getAccountInfo(new PublicKey(m.asset))).data); assert.equal(a.updateAuthority.address, ctx.env.RIDE_COLLECTION); assert.match(a.name, new RegExp(p.receipt.ride.tier));
  const meta = await (await fetch(a.uri.replace('http://localhost:3999', ctx.base.replace('/api/solana', '')))).json(); assert.equal(meta.fairness.seed, p.receipt.ride.seed); assert.equal(meta.fairness.commit, q.commit); assert.equal(meta.collection.name, 'VW Fest Show Grounds Rides'); assert.ok(meta.attributes.find((x) => x.trait_type === 'Plate').value.startsWith('VWFEST'));
  assert.equal(R.verifyRide({ seed: meta.fairness.seed, commit: meta.fairness.commit, sig: meta.fairness.paymentSignature, reroll: meta.fairness.reroll, spec: p.receipt.ride.spec }).ok, true, 'anyone can verify from public metadata');
  await assert.rejects(client.mint(q), /Already minted/);
});

test('attacks: underpaid burn, wrong memo, replayed signature, wrong wallet, concurrent confirm, premature mint', async (t) => {
  if (skip) return t.skip('no solana-test-validator');
  const { client, w, kp } = ctx.alice; await new Promise((r) => setTimeout(r, 1100)); await client.faucet().catch(() => {}); const mint = new PublicKey(ctx.cfg.vwfestMint); const ata = spl.getAssociatedTokenAddressSync(mint, kp.publicKey);
  const memoIx = (t_) => new TransactionInstruction({ programId: new PublicKey(C.MEMO_PROGRAM), keys: [], data: Buffer.from(t_) });
  const q = await client.quote({ kind: 'shop', item: 'hat', method: 'vwfest' }); assert.equal(q.burnUi, 20);
  // premature mint for a non-NFT kind / unpaid quote
  const qr = await client.quote({ kind: 'ride', method: 'vwfest' }); await assert.rejects(client.mint(qr), /not been verified/);
  // (a) underpaid burn with the right memo
  const cheap = await sendAndConfirmTransaction(ctx.conn, new Transaction().add(spl.createBurnCheckedInstruction(ata, mint, kp.publicKey, 1_000_000n, 6), memoIx(q.memo)), [kp]);
  const r1 = await fetch(ctx.base + '/pay/confirm', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: 'Bearer ' + client.token }, body: JSON.stringify({ quoteId: q.id, signature: cheap }) }).then((r) => r.json()); assert.equal(r1.ok, false); assert.match(r1.error || r1.why, /lower than the quote/);
  const before = ctx.grants.length; assert.equal(ctx.grants.length, before);
  // (b) enough burn but the wrong memo
  const wrongMemo = await sendAndConfirmTransaction(ctx.conn, new Transaction().add(spl.createBurnCheckedInstruction(ata, mint, kp.publicKey, 20_000_000n, 6), memoIx('vwfest:qWRONG')), [kp]);
  const post = (path_, body, tok = client.token) => fetch(ctx.base + path_, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }).then((r) => r.json());
  assert.match((await post('/pay/confirm', { quoteId: q.id, signature: wrongMemo })).why, /memo/i);
  // (c) wrong wallet: Bob cannot confirm Alice's quote even with a valid signature
  assert.equal((await post('/pay/confirm', { quoteId: q.id, signature: cheap }, ctx.bob.client.token)).why, 'Unknown quote');
  // (d) the honest payment, confirmed concurrently 5x: exactly ONE grant
  const built = await post('/tx/pay', { quoteId: q.id }); assert.equal(built.ok, true);
  const { VersionedTransaction } = require('@solana/web3.js'); const tx = VersionedTransaction.deserialize(Buffer.from(built.tx, 'base64')); tx.sign([kp]); const sig = await ctx.conn.sendRawTransaction(tx.serialize()); await ctx.conn.confirmTransaction(sig, 'confirmed');
  const g0 = ctx.grants.length; const outs = await Promise.all(Array.from({ length: 5 }, () => post('/pay/confirm', { quoteId: q.id, signature: sig })));
  assert.equal(outs.filter((o) => o.ok && !o.repeat).length, 1, 'one winner'); assert.equal(ctx.grants.length, g0 + 1, 'double-grant race closed'); assert.ok(outs.every((o) => o.ok || /progress|already/i.test(o.why)));
  assert.equal((await post('/pay/confirm', { quoteId: q.id, signature: sig })).repeat, true, 'idempotent re-confirm returns the same receipt');
  // (e) replay the SAME signature against a fresh quote
  const q2 = await client.quote({ kind: 'shop', item: 'hat', method: 'vwfest' }); const rp = await post('/pay/confirm', { quoteId: q2.id, signature: sig }); assert.equal(rp.ok, false); assert.match(rp.why, /already used/);
  // (f) tx from another wallet that copies the memo: fee payer mismatch
  const evil = ctx.bob.kp; await client.faucet; await ctx.sg.devnetFaucet(ctx.bob.w).catch(() => {}); const bAta = spl.getAssociatedTokenAddressSync(mint, evil.publicKey);
  const bsig = await sendAndConfirmTransaction(ctx.conn, new Transaction().add(spl.createBurnCheckedInstruction(bAta, mint, evil.publicKey, 20_000_000n, 6), memoIx(q2.memo)), [evil]); assert.match((await post('/pay/confirm', { quoteId: q2.id, signature: bsig })).why, /not signed by the quoted wallet/);
  // failed verification must release the lock so the right tx can still be confirmed later
  const built2 = await post('/tx/pay', { quoteId: q2.id }); const tx2 = VersionedTransaction.deserialize(Buffer.from(built2.tx, 'base64')); tx2.sign([kp]); const sig2 = await ctx.conn.sendRawTransaction(tx2.serialize()); await ctx.conn.confirmTransaction(sig2, 'confirmed'); assert.equal((await post('/pay/confirm', { quoteId: q2.id, signature: sig2 })).ok, true);
});

test('NFT as avatar: ownership lookup (Core via getProgramAccounts) and re-verification', async (t) => {
  if (skip) return t.skip('no solana-test-validator');
  const { client } = ctx.alice; const list = await client.listNfts(); assert.ok(list.items.length >= 2); assert.ok(list.items.some((n) => n.collection === ctx.env.AVATAR_COLLECTION && n.name === 'Alice Avatar'));
  const mine = list.items.find((n) => n.collection === ctx.env.AVATAR_COLLECTION); const av = await client.useNft(mine.asset); assert.equal(av.wallet, ctx.alice.w); assert.equal(av.standard, 'MplCoreAsset');
  await assert.rejects(ctx.bob.client.useNft(mine.asset), /not in your wallet/); await assert.rejects(client.useNft(Keypair.generate().publicKey.toBase58()), /not in your wallet/); await assert.rejects(client.useNft('junk'), /not in your wallet/);
  assert.equal((await ctx.bob.client.listNfts()).items.length, 0);
});

test('restart: replay protection + burn tracker + minted traits survive via the persistent store', async (t) => {
  if (skip) return t.skip('no solana-test-validator');
  await ctx.sg.store.flush(); const sg2 = ctx.mk(); await sg2.init();
  assert.equal(sg2.burnTracker().count, ctx.sg.burnTracker().count); assert.ok(sg2.burnTracker().totalBurned > 0); assert.equal(sg2.store.size('sig'), ctx.sg.store.size('sig'));
  const prior = [...ctx.sg.store.entries('sig')][0]; const sess = ctx.sg.session(ctx.alice.client.token); assert.equal(sess.wallet, ctx.alice.w);
  const q = await sg2.quote({ wallet: ctx.alice.w, kind: 'shop', item: 'hat', method: 'vwfest' }); const r = await sg2.confirmPayment({ quoteId: q.id, signature: prior[0], wallet: ctx.alice.w }); assert.match(r.why, /already used/);
  await assert.rejects(sg2.quote({ wallet: ctx.bob.w, kind: 'avatar', method: 'vwfest', nft: { traits: traits('A'), imageSvg: SVG('x') } }), /already been minted/); await sg2.close();
});

test('mainnet disarmed: quoting allowed (simulation), confirming/granting refused', async (t) => {
  const env = testEnv({ SOLANA_NETWORK: 'mainnet-beta', FIXED_SOL_USD: '100' }); const sg = new Solana({ env, prices: { solUsd: async () => ({ usd: 100 }), vwfestUsd: async () => ({ usd: 0.00002 }), tokenUsd: async () => 1, jupQuote: async () => ({ outAmount: '1000000', otherAmountThreshold: '970000', priceImpactPct: '0' }) }, conn: {} });
  assert.equal(sg.flags().enabled, false); assert.equal(sg.flags().simulateOnly, true);
  const q = await sg.quote({ wallet: Keypair.generate().publicKey.toBase58(), kind: 'vendor', method: 'vwfest' }); assert.equal(q.paidUsd, 30);
  assert.equal((await sg.confirmPayment({ quoteId: q.id, signature: '1'.repeat(88), wallet: q.wallet })).ok, false);
  await assert.rejects(sg.buildMint({ quoteId: q.id, wallet: q.wallet }), /not armed|simulate/i);
});
