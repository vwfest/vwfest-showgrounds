'use strict';
// Go-live blocker: a Jupiter route runs with the player's signature, so it must never be able to reach more of the player's tokens than the quote.
// Token-funded swaps are ISOLATED: [createAccountWithSeed temp] [InitializeAccount3] [transferChecked main -> temp, EXACTLY the quoted input] [route, source = temp] [closeAccount temp -> player].
// These tests build real transactions (web3.js builders, REAL Jupiter route bytes) and (litesvm) execute them on the real SPL Token program.
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('crypto');
const { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, TransactionInstruction } = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const C = require('../src/config'); const jup = require('../src/jupiter'); const audit = require('../src/audit');
const TOKEN = new PublicKey(C.TOKEN_PROGRAM); const REAL_IN = '5RfLl3rjrSoBAAAAsgFkAAGA8PoCAAAAACU+SQAAAAAAZAAA'; // REAL Jupiter `route` (ExactIn) bytes; in_amount is patched per test
const AMOUNT = 5_000_000n, DEC = 6;
const routeData = (amt) => { const d = Buffer.from(REAL_IN, 'base64'); d.writeBigUInt64LE(BigInt(amt), d.length - 19); return d; };
async function rig() {
  const user = Keypair.generate(), inMint = Keypair.generate().publicKey, vwMint = Keypair.generate().publicKey, attacker = Keypair.generate().publicKey;
  const main = spl.getAssociatedTokenAddressSync(inMint, user.publicKey), vwAta = spl.getAssociatedTokenAddressSync(vwMint, user.publicKey), wsol = spl.getAssociatedTokenAddressSync(new PublicKey(C.WSOL), user.publicKey, true);
  const seed = crypto.randomBytes(8).toString('hex'); const temp = await PublicKey.createWithSeed(user.publicKey, seed, TOKEN); const amm = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
  const key = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  const route = (src = temp, amt = AMOUNT, extra = []) => new TransactionInstruction({ programId: new PublicKey(C.JUPITER_PROGRAM), keys: [key(TOKEN), key(user.publicKey, true), key(src, false, true), key(vwAta, false, true), key(new PublicKey(C.JUPITER_PROGRAM)), key(vwMint), key(new PublicKey(C.JUPITER_PROGRAM)), key(amm[0]), key(new PublicKey(C.JUPITER_PROGRAM)), ...amm.map((a) => key(a, false, true)), ...extra.map((a) => key(a, false, true))], data: routeData(amt) });
  const create = (o = {}) => SystemProgram.createAccountWithSeed({ fromPubkey: user.publicKey, newAccountPubkey: temp, basePubkey: user.publicKey, seed, lamports: o.lamports ?? 2039280, space: o.space ?? 165, programId: o.owner || TOKEN });
  const init = () => new TransactionInstruction({ programId: TOKEN, keys: [key(temp, false, true), key(inMint)], data: Buffer.concat([Buffer.from([18]), user.publicKey.toBuffer()]) });
  const xfer = (amt = AMOUNT, dest = temp) => spl.createTransferCheckedInstruction(main, inMint, dest, user.publicKey, amt, DEC);
  const close = (dest = user.publicKey) => new TransactionInstruction({ programId: TOKEN, keys: [key(temp, false, true), key(dest, false, true), key(user.publicKey, true)], data: Buffer.from([9]) });
  const burn = spl.createBurnCheckedInstruction(vwAta, vwMint, user.publicKey, 1000n, 6);
  const memo = new TransactionInstruction({ programId: new PublicKey(C.MEMO_PROGRAM), keys: [key(user.publicKey, true)], data: Buffer.from('vwfest:qi1') });
  const q = { id: 'qi1', wallet: user.publicKey.toBase58(), burnMin: '1000', burnRaw: '1000', devLamports: '0', devTokenRaw: '0', devTokenMint: null, devWallet: attacker.toBase58(), swap: true, swapInputMint: inMint.toBase58(), swapInRaw: AMOUNT.toString(), payToken: { mint: inMint.toBase58(), sym: 'TKN', dec: DEC } };
  const cfg = { vwfestMint: vwMint.toBase58(), devWallet: C.DEV_WALLET };
  const build = (ixs) => new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message());
  const honest = () => [create(), init(), xfer(), route(), close(), burn, memo];
  return { user, inMint, vwMint, attacker, main, vwAta, wsol, temp, amm, route, create, init, xfer, close, burn, memo, q, cfg, build, honest, key };
}

test('server audit: an isolated token swap passes; the route must use the temp account as its only source', async () => {
  const r = await rig(); assert.ok(audit.auditPayTx(r.build(r.honest()), r.q, r.cfg));
});

test('MALICIOUS ROUTE: route still takes its input from the player\'s own token account (not isolated) is refused', async () => {
  const r = await rig(); assert.throws(() => audit.auditPayTx(r.build([r.create(), r.init(), r.xfer(), r.route(r.main), r.close(), r.burn, r.memo]), r.q, r.cfg), /different account|must not use/);
});

test('MALICIOUS ROUTE: CPI accounts smuggle the player\'s own token account into the route (so it could take MORE than quoted) is refused', async () => {
  const r = await rig(); assert.throws(() => audit.auditPayTx(r.build([r.create(), r.init(), r.xfer(), r.route(r.temp, AMOUNT, [r.main]), r.close(), r.burn, r.memo]), r.q, r.cfg), /must not use/);
});

test('MALICIOUS ROUTE: in_amount larger than quoted is refused (spend bound), and so is moving more than the quote into the temp account', async () => {
  const r = await rig(); assert.throws(() => audit.auditPayTx(r.build([r.create(), r.init(), r.xfer(), r.route(r.temp, AMOUNT + 1n), r.close(), r.burn, r.memo]), r.q, r.cfg), /spend more/);
  assert.throws(() => audit.auditPayTx(r.build([r.create(), r.init(), r.xfer(AMOUNT + 1n), r.route(), r.close(), r.burn, r.memo]), r.q, r.cfg), /does not match your quote/);
  assert.throws(() => audit.auditPayTx(r.build([r.create(), r.init(), r.xfer(AMOUNT - 1n), r.route(), r.close(), r.burn, r.memo]), r.q, r.cfg), /does not match your quote/);
});

test('isolation steps: extra transfer from the player\'s account, second transfer, missing/misordered/misdirected close, foreign-owner or oversized temp account are all refused', async () => {
  const r = await rig(); const A = (ixs, re) => assert.throws(() => audit.auditPayTx(r.build(ixs), r.q, r.cfg), re);
  A([r.create(), r.init(), r.xfer(), r.route(), r.close(), r.xfer(1n, r.attacker), r.burn, r.memo], /does not match your quote|token instruction/i); // a second transferChecked main -> attacker
  A([r.create(), r.init(), r.xfer(), r.xfer(), r.route(), r.close(), r.burn, r.memo], /Duplicate token transfer/);
  A([r.create(), r.init(), r.xfer(), r.route(), r.burn, r.memo], /isolation steps are missing/);
  A([r.create(), r.init(), r.xfer(), r.close(), r.route(), r.burn, r.memo], /out of order/);
  A([r.create(), r.init(), r.xfer(), r.route(), r.close(r.attacker), r.burn, r.memo], /closed to someone else/);
  A([r.create({ owner: new PublicKey(C.JUPITER_PROGRAM) }), r.init(), r.xfer(), r.route(), r.close(), r.burn, r.memo], /not what was prepared/);
  A([r.create({ lamports: 9_000_000_000 }), r.init(), r.xfer(), r.route(), r.close(), r.burn, r.memo], /more rent|more SOL/);
  A([r.init(), r.xfer(), r.route(), r.close(), r.burn, r.memo], /isolation steps are missing|Unexpected|unexpected|does not match your quote/i); // no temp account created
  A([r.route(r.main), r.burn, r.memo], /isolation steps are missing/); // legacy un-isolated token swap
});

test('SOL swaps: the route may only take its input from the player\'s wSOL account', async () => {
  const r = await rig(); const solQ = { ...r.q, swapInputMint: C.WSOL, swapInRaw: '4500000', payToken: null }; const wrap = SystemProgram.transfer({ fromPubkey: r.user.publicKey, toPubkey: r.wsol, lamports: 4500000 });
  const solRoute = (src, amt = 4500000n) => r.route(src, amt); const sync = spl.createSyncNativeInstruction(r.wsol);
  assert.ok(audit.auditPayTx(r.build([wrap, sync, solRoute(r.wsol), r.burn, r.memo]), solQ, r.cfg));
  assert.throws(() => audit.auditPayTx(r.build([wrap, sync, solRoute(r.main), r.burn, r.memo]), solQ, r.cfg), /different account/);
});

test('jupiter.pinSource: moves the route input to the temp account, refuses an unexpected original source or an unknown route type', async () => {
  const r = await rig(); const j = (ix) => ({ programId: ix.programId.toBase58(), accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: ix.data.toString('base64') });
  const orig = j(r.route(r.main)); const pinned = jup.pinSource(orig, r.temp.toBase58(), r.main.toBase58()); assert.equal(pinned.accounts[2].pubkey, r.temp.toBase58()); assert.equal(orig.accounts[2].pubkey, r.main.toBase58(), 'input not mutated'); assert.equal(pinned.accounts[2].isWritable, true);
  assert.throws(() => jup.pinSource(orig, r.temp.toBase58(), r.attacker.toBase58()), /own token account/);
  const weird = { ...orig, data: Buffer.concat([Buffer.from('96564774a75d0e68', 'hex'), Buffer.alloc(30)]).toString('base64') }; assert.throws(() => jup.pinSource(weird, r.temp.toBase58()), /Unrecognised/);
  const shared = { ...orig, data: Buffer.concat([Buffer.from('c1209b3341d69c81', 'hex'), Buffer.alloc(30)]).toString('base64'), accounts: [0, 1, 2, 3, 4].map((n) => ({ pubkey: 'x' + n })) }; assert.equal(jup.pinSource(shared, 'TEMP').accounts[3].pubkey, 'TEMP'); // shared_accounts_route: source is index 3
  assert.equal(jup.jupSource(orig, Buffer.from(orig.data, 'base64')), r.main.toBase58());
});

test('jupiter.pinSource: EVERY reference to the player\'s own token account is redirected (multi-hop routes list the source again inside the AMM accounts); the audit then accepts the route (mainnet regression)', async () => {
  const r = await rig(); const j = (ix) => ({ programId: ix.programId.toBase58(), accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: ix.data.toString('base64') });
  const orig = j(r.route(r.main, AMOUNT, [r.main])); assert.equal(orig.accounts.filter((a) => a.pubkey === r.main.toBase58()).length, 2);
  const pinned = jup.pinSource(orig, r.temp.toBase58(), r.main.toBase58()); assert.equal(pinned.accounts.filter((a) => a.pubkey === r.main.toBase58()).length, 0); assert.equal(pinned.accounts.filter((a) => a.pubkey === r.temp.toBase58()).length, 2);
  assert.ok(pinned.accounts.filter((a) => a.pubkey === r.temp.toBase58()).every((a) => a.isWritable), 'writable flag preserved');
  const d = routeData(AMOUNT), quoted = d.readBigUInt64LE(d.length - 19 + 8), slip = BigInt(d.readUInt16LE(d.length - 19 + 16)); const opts = { user: r.user.publicKey.toBase58(), maxLamports: 0n, maxSwapIn: AMOUNT, source: r.temp.toBase58(), forbid: [r.main.toBase58()], dest: r.vwAta.toBase58(), minOut: quoted * (10000n - slip) / 10000n, maxSlippageBps: Number(slip), quotedOut: quoted };
  assert.equal(jup.auditJupiterIxs([pinned], opts), true);
  assert.throws(() => jup.auditJupiterIxs([orig], opts), /must not use|different account/);
});

test('assertNoStrayUserTokenAccounts: a route that references ANOTHER token account owned by the player is refused (needs RPC)', async () => {
  const r = await rig(); const stray = Keypair.generate().publicKey, pool = Keypair.generate().publicKey; const data = (owner) => { const b = Buffer.alloc(165); owner.toBuffer().copy(b, 32); return b; };
  const store = { [stray.toBase58()]: { owner: TOKEN, data: data(r.user.publicKey) }, [pool.toBase58()]: { owner: TOKEN, data: data(Keypair.generate().publicKey) } };
  const conn = { getMultipleAccountsInfo: async (keys) => keys.map((k) => store[k.toBase58()] || null) }; const ix = (...pks) => ({ accounts: pks.map((p) => ({ pubkey: p.toBase58() })) });
  await jup.assertNoStrayUserTokenAccounts(conn, [ix(r.temp, r.vwAta, pool, r.amm[0])], r.user.publicKey.toBase58(), [r.temp.toBase58(), r.vwAta.toBase58()]);
  await assert.rejects(jup.assertNoStrayUserTokenAccounts(conn, [ix(r.temp, stray)], r.user.publicKey.toBase58(), [r.temp.toBase58()]), /another token account of yours/);
});

test('swapInstructions end to end (mock Jupiter): token swap pins the route to the temp account; a hostile Jupiter reply is refused', async () => {
  const r = await rig(); const j = (ix) => ({ programId: ix.programId.toBase58(), accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: ix.data.toString('base64') });
  const prices = { jupQuote: async () => ({ outAmount: '4800037', otherAmountThreshold: '4752037', priceImpactPct: '0' }) }; const conn = { getAccountInfo: async () => null, getMultipleAccountsInfo: async (k) => k.map(() => null) };
  const reply = (swapIx) => async () => ({ ok: true, status: 200, json: async () => ({ computeBudgetInstructions: [], setupInstructions: [], swapInstruction: swapIx, cleanupInstruction: null, addressLookupTableAddresses: [] }) });
  const iso = { temp: r.temp.toBase58(), main: r.main.toBase58() }; const cfg = { vwfestMint: r.vwMint.toBase58(), jupiterBase: 'http://x', slippageBps: 100 }; const dest = r.vwAta.toBase58();
  const ok = await jup.swapInstructions({ cfg, prices, conn, user: r.q.wallet, inputMint: r.q.swapInputMint, amount: AMOUNT, maxSolLamports: 10_000_000n, iso, allow: [r.vwAta.toBase58()], dest, fetchImpl: reply(j(r.route(r.main))) });
  assert.equal(ok.instructions[0].keys[2].pubkey.toBase58(), r.temp.toBase58(), 'route input rewritten to the isolated account');
  await assert.rejects(jup.swapInstructions({ cfg, prices, conn, user: r.q.wallet, inputMint: r.q.swapInputMint, amount: AMOUNT, maxSolLamports: 10_000_000n, iso, allow: [], dest, fetchImpl: reply(j(r.route(Keypair.generate().publicKey))) }), /own token account/); // hostile: input from some other account
  await assert.rejects(jup.swapInstructions({ cfg, prices, conn, user: r.q.wallet, inputMint: r.q.swapInputMint, amount: AMOUNT, maxSolLamports: 10_000_000n, iso, allow: [], dest, fetchImpl: reply(j(r.route(r.main, AMOUNT * 3n))) }), /spend more/); // hostile: in_amount x3
  const multi = await jup.swapInstructions({ cfg, prices, conn, user: r.q.wallet, inputMint: r.q.swapInputMint, amount: AMOUNT, maxSolLamports: 10_000_000n, iso, allow: [], dest, fetchImpl: reply(j(r.route(r.main, AMOUNT, [r.main]))) }); // Jupiter itself lists the source again in the first hop's accounts (real mainnet USDC route): ALL such references are redirected to the temp account
  assert.equal(multi.instructions[0].keys.filter((k) => k.pubkey.equals(r.main)).length, 0, 'no reference to the player\'s own token account survives'); assert.equal(multi.instructions[0].keys.filter((k) => k.pubkey.equals(r.temp)).length, 2);
});

test('swapInstructions: a hostile Jupiter reply that redirects the OUTPUT (route idx 3 / idx 4) or inflates slippage is refused; a missing dest is a programming error', async () => {
  const r = await rig(); const j = (ix, f) => { const o = { programId: ix.programId.toBase58(), accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), data: ix.data.toString('base64') }; f && f(o); return o; };
  const prices = { jupQuote: async () => ({ outAmount: '4800037', otherAmountThreshold: '4752037', priceImpactPct: '0' }) }; const conn = { getAccountInfo: async () => null, getMultipleAccountsInfo: async (k) => k.map(() => null) };
  const reply = (swapIx) => async () => ({ ok: true, status: 200, json: async () => ({ computeBudgetInstructions: [], setupInstructions: [], swapInstruction: swapIx, cleanupInstruction: null, addressLookupTableAddresses: [] }) });
  const iso = { temp: r.temp.toBase58(), main: r.main.toBase58() }; const cfg = { vwfestMint: r.vwMint.toBase58(), jupiterBase: 'http://x', slippageBps: 100 }; const dest = r.vwAta.toBase58(); const att = r.attacker.toBase58();
  const go = (swapIx, d = dest) => jup.swapInstructions({ cfg, prices, conn, user: r.q.wallet, inputMint: r.q.swapInputMint, amount: AMOUNT, maxSolLamports: 10_000_000n, iso, allow: [], dest: d, fetchImpl: reply(swapIx) });
  await go(j(r.route(r.main))); await assert.rejects(go(j(r.route(r.main), (o) => (o.accounts[3].pubkey = att))), /somewhere other than your own account/); await assert.rejects(go(j(r.route(r.main), (o) => (o.accounts[4].pubkey = att))), /second destination/);
  await assert.rejects(go(j(r.route(r.main), (o) => { const d = Buffer.from(o.data, 'base64'); d.writeUInt16LE(3000, d.length - 3); o.data = d.toString('base64'); })), /more slippage/); await assert.rejects(go(j(r.route(r.main)), null), /No destination account|somewhere other/);
});
test('server audit: a pay tx whose route output goes to an account other than the burn account is refused; the burn must come from the player\'s own $VWFEST ATA', async () => {
  const r = await rig(); const bad = (o) => { const x = r.route(); x.keys[3] = { ...x.keys[3], pubkey: o }; return x; };
  assert.throws(() => audit.auditPayTx(r.build([r.create(), r.init(), r.xfer(), bad(r.attacker), r.close(), r.burn, r.memo]), r.q, r.cfg), /somewhere other than your own account/);
  const burnOther = spl.createBurnCheckedInstruction(r.attacker, r.vwMint, r.user.publicKey, 1000n, 6); assert.throws(() => audit.auditPayTx(r.build([r.create(), r.init(), r.xfer(), r.route(), r.close(), burnOther, r.memo]), r.q, r.cfg), /Burn instruction does not match/);
  assert.throws(() => audit.auditPayTx(r.build([r.create(), r.init(), r.xfer(), r.route(), r.close(), r.burn, r.memo]), r.q, { ...r.cfg, slippageBps: 50 }), /more slippage/); // the route says 100 bps; the server allows 50
});
test('server audit: the isolated temp account may cost at most ~rent-exempt, not the whole route cushion', async () => {
  const r = await rig(); assert.throws(() => audit.auditPayTx(r.build([r.create({ lamports: 3_000_000 }), r.init(), r.xfer(), r.route(), r.close(), r.burn, r.memo]), r.q, r.cfg), /more rent/);
});

// ---- on-chain: the real SPL Token program (litesvm). The "route" stand-in is a token transfer the player signs, i.e. the most a hostile CPI could ever do with the player's authority.
let svmMod = null; try { svmMod = { ...require('litesvm'), ...require('@solana/transactions') }; } catch { /* litesvm optional */ }
const run = svmMod ? test : test.skip;
run('ON-CHAIN (litesvm, real Token program): isolation caps what a hostile route can take; without isolation it takes everything', async () => {
  const { LiteSVM, getTransactionDecoder } = svmMod; const r = await rig();
  const mk = () => { const svm = new LiteSVM().withDefaultPrograms(); svm.airdrop(r.user.publicKey.toBase58(), 10n ** 10n);
    const md = Buffer.alloc(82); md.writeUInt32LE(0, 0); md.writeBigUInt64LE(10n ** 12n, 36); md[44] = DEC; md[45] = 1; svm.setAccount({ address: r.inMint.toBase58(), data: md, executable: false, lamports: 1461600n, programAddress: TOKEN.toBase58(), space: 82n });
    const acc = (addr, owner, amt) => { const b = Buffer.alloc(165); r.inMint.toBuffer().copy(b, 0); owner.toBuffer().copy(b, 32); b.writeBigUInt64LE(amt, 64); b[108] = 1; svm.setAccount({ address: addr.toBase58(), data: b, executable: false, lamports: 2039280n, programAddress: TOKEN.toBase58(), space: 165n }); };
    const sink = spl.getAssociatedTokenAddressSync(r.inMint, r.attacker); acc(r.main, r.user.publicKey, 20_000_000n); acc(sink, r.attacker, 0n); return { svm, sink }; };
  const bal = (svm, a) => Buffer.from(svm.getAccount(a.toBase58()).data).readBigUInt64LE(64);
  const send = (svm, ixs) => { const tx = r.build(ixs); const m = new TransactionMessage({ payerKey: r.user.publicKey, recentBlockhash: svm.latestBlockhash(), instructions: ixs }).compileToV0Message(); const v = new VersionedTransaction(m); v.sign([r.user]); return svm.sendTransaction(getTransactionDecoder().decode(v.serialize())); };
  const stealFrom = (src, sink, amt) => spl.createTransferCheckedInstruction(src, r.inMint, sink, r.user.publicKey, amt, DEC);
  { // honest: the stand-in route spends exactly the quoted input from the temp account
    const { svm, sink } = mk(); const res = send(svm, [r.create(), r.init(), r.xfer(), stealFrom(r.temp, sink, AMOUNT), r.close()]); assert.equal(res.constructor.name, 'TransactionMetadata', String(res.toString && res.toString()));
    assert.equal(bal(svm, r.main), 20_000_000n - AMOUNT); assert.equal(bal(svm, sink), AMOUNT); assert.equal(svm.getAccount(r.temp.toBase58()).exists, false, 'temp account closed (rent returned)'); }
  { // hostile route tries to take 1 more than quoted from the isolated account: the token program refuses, nothing moves
    const { svm, sink } = mk(); const res = send(svm, [r.create(), r.init(), r.xfer(), stealFrom(r.temp, sink, AMOUNT + 1n), r.close()]); assert.equal(res.constructor.name, 'FailedTransactionMetadata'); assert.equal(bal(svm, r.main), 20_000_000n); assert.equal(bal(svm, sink), 0n); }
  { // hostile route that reaches for the player's own account is not executable in the isolated design: the audit refuses the transaction before it is ever shown to the wallet
    const hostile = [r.create(), r.init(), r.xfer(), r.route(r.temp, AMOUNT, [r.main]), r.close(), r.burn, r.memo]; assert.throws(() => audit.auditPayTx(r.build(hostile), r.q, r.cfg), /must not use/); }
  { // control: the OLD un-isolated design, same hostile route, executes on-chain and takes far more than the quote
    const { svm, sink } = mk(); const res = send(svm, [stealFrom(r.main, sink, 20_000_000n)]); assert.equal(res.constructor.name, 'TransactionMetadata'); assert.equal(bal(svm, r.main), 0n); assert.equal(bal(svm, sink), 20_000_000n); }
});
