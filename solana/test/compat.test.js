'use strict';
// INTERFACES.md §1 facade against a real local validator (single-tx flow: burn + dev fee + memo + Core NFT in ONE transaction).
const test = require('node:test'); const assert = require('node:assert/strict'); const nacl = require('tweetnacl');
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction, sendAndConfirmTransaction } = require('@solana/web3.js'); const spl = require('@solana/spl-token');
const { startValidator, testEnv } = require('./helpers'); const setup = require('../src/setup'); const C = require('../src/config'); const chainMod = require('../');
const { Facade } = require('../src/compat'); const ctx = {}; let skip = false;
const str = (s) => { const e = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(e.length); return Buffer.concat([l, e]); };
const coreIx = (asset, owner, name, uri) => { const P = new PublicKey(C.MPL_CORE_PROGRAM); const none = { pubkey: P, isSigner: false, isWritable: false };
  return new TransactionInstruction({ programId: P, keys: [{ pubkey: asset, isSigner: true, isWritable: true }, none, none, { pubkey: owner, isSigner: true, isWritable: true }, none, none, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, none], data: Buffer.concat([Buffer.from([0, 0]), str(name), str(uri), Buffer.from([0])]) }); };
const memo = (t) => new TransactionInstruction({ programId: new PublicKey(C.MEMO_PROGRAM), keys: [], data: Buffer.from(t) });
test.before(async () => {
  const v = await startValidator(); if (!v) { skip = true; return; } ctx.v = v; ctx.conn = new Connection(v.rpc, 'confirmed'); const authority = Keypair.generate(); await setup.airdrop(ctx.conn, authority.publicKey, 3);
  ctx.mint = await setup.createTestMint(ctx.conn, authority, 6); ctx.authority = authority; ctx.dev = Keypair.generate().publicKey.toBase58();
  ctx.env = { MINT_NETWORK: 'localnet', MINT_ENABLED: '1', VWFEST_MINT: ctx.mint.toBase58(), DEV_WALLET: ctx.dev, SERVER_SECRET: 'z'.repeat(40), FIXED_SOL_USD: '100', DEVNET_TOKENS_PER_USD: '10' };
  ctx.F = await new Facade().init({ env: ctx.env, conn: ctx.conn }); ctx.user = Keypair.generate(); await setup.airdrop(ctx.conn, ctx.user.publicKey, 3);
  const ata = await spl.getOrCreateAssociatedTokenAccount(ctx.conn, authority, ctx.mint, ctx.user.publicKey); await spl.mintTo(ctx.conn, authority, ctx.mint, ata.address, authority, 1_000_000_000n); ctx.ata = ata.address;
});
test.after(() => { if (ctx.v) ctx.v.stop(); });
const burnTx = (q, o = {}) => { const u = o.user || ctx.user; const ixs = []; if (BigInt(q.devLamports) > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: u.publicKey, toPubkey: new PublicKey(q.devWallet), lamports: BigInt(q.devLamports) }));
  ixs.push(spl.createBurnCheckedInstruction(ctx.ata, ctx.mint, u.publicKey, BigInt(o.burn || q.burnRaw), 6)); const signers = [u]; let asset = null;
  if (o.uri) { asset = Keypair.generate(); ixs.push(coreIx(asset.publicKey, u.publicKey, 'VW', o.uri)); signers.push(asset); } ixs.push(memo(o.memo || 'vwfest:' + q.nonce)); return { tx: new Transaction().add(...ixs), signers, asset }; };
const send = async (t) => sendAndConfirmTransaction(ctx.conn, t.tx, t.signers, { commitment: 'confirmed' });

test('facade surface matches INTERFACES.md §1', (t) => {
  for (const k of ['init', 'config', 'quote', 'solUsd', 'verifyPurchase', 'burns', 'auth', 'onramp', 'mountRoutes', '__test']) assert.ok(k in chainMod, k);
  const c = ctx.F.config(); assert.equal(c.enabled, !skip); assert.equal(c.network, 'localnet'); assert.equal(c.devWalletOk, true); assert.ok(Array.isArray(c.payTokens));
});
test('quote: vwfest 50% off / sol with 10% dev cut / avatar no dev fee', async (t) => {
  if (skip) return t.skip('no validator'); const F = ctx.F;
  const a = await F.quote({ kind: 'shop', usd: 4, method: 'vwfest', discountPct: 50, devPct: 10 }); assert.equal(a.paidUsd, 2); assert.equal(a.devPct, 0); assert.equal(a.burnUi, 20); assert.equal(a.devLamports, '0');
  const b = await F.quote({ kind: 'shop', usd: 4, method: 'sol', discountPct: 50, devPct: 10 }); assert.equal(b.discountPct, 0); assert.equal(b.devPct, 10); assert.equal(b.devLamports, String(0.004 * 1e9)); assert.equal(b.devWallet, ctx.dev); assert.equal(b.burnUi, 36);
  const m = await F.quote({ kind: 'avatar', usd: 5, method: 'sol', discountPct: 0, devPct: 0 }); assert.equal(m.devWallet, null); assert.equal(m.burnUi, 50);
  await assert.rejects(F.quote({ kind: 'x', usd: -1, method: 'sol' })); assert.equal(typeof (await F.solUsd()), 'number');
});
test('verifyPurchase: honest NFT purchase verified once; replay, underburn, wrong wallet, wrong memo, wrong uri, dev fee short all rejected', async (t) => {
  if (skip) return t.skip('no validator'); const F = ctx.F; const w = ctx.user.publicKey.toBase58();
  const q = { ...(await F.quote({ kind: 'avatar', usd: 5, method: 'sol', discountPct: 0, devPct: 10 })), nonce: 'qn1' }; const uri = 'https://x.test/nft/abc.json';
  const exp = (o = {}) => ({ code: 'code-1', uri, burnMin: BigInt(q.burnMin), devMin: BigInt(q.devMin), devWallet: ctx.dev, wallet: w, ...o });
  const good = burnTx(q, { uri }); const sig = await send(good); const dev0 = await ctx.conn.getBalance(new PublicKey(ctx.dev));
  const r = await F.verifyPurchase({ sig, nonce: 'qn1', pid: 'p1', nick: 'Zed', kind: 'mint', expect: exp() }); assert.equal(r.ok, true); assert.equal(r.rec.wallet, w); assert.equal(r.rec.asset, good.asset.publicKey.toBase58()); assert.equal(r.rec.amount, q.burnRaw); assert.ok(dev0 >= Number(q.devLamports));
  assert.equal((await F.verifyPurchase({ sig, nonce: 'qn1', pid: 'p1', nick: 'Zed', kind: 'mint', expect: exp() })).dup, true, 'replay of the same signature');
  const s2 = await send(burnTx({ ...q, nonce: 'qn2' }, { uri })); assert.equal((await F.verifyPurchase({ sig: s2, nonce: 'qn2', pid: 'p2', kind: 'mint', expect: exp() })).dup, true, 'same avatar code cannot be minted twice');
  const under = await send(burnTx(q, { burn: 1_000_000, uri })); assert.match((await F.verifyPurchase({ sig: under, nonce: 'qn1', kind: 'mint', expect: exp({ code: 'c2' }) })).why, /lower than the quote/);
  const other = Keypair.generate(); assert.match((await F.verifyPurchase({ sig: under, nonce: 'qn1', kind: 'mint', expect: exp({ code: 'c2', wallet: other.publicKey.toBase58() }) })).why, /not signed by your proven wallet/);
  const badMemo = await send(burnTx(q, { uri, memo: 'vwfest:other' })); assert.match((await F.verifyPurchase({ sig: badMemo, nonce: 'qn1', kind: 'mint', expect: exp({ code: 'c3' }) })).why, /code mismatch/);
  const badUri = await send(burnTx(q, { uri: 'https://evil.test/x.json' })); assert.match((await F.verifyPurchase({ sig: badUri, nonce: 'qn1', kind: 'mint', expect: exp({ code: 'c4' }) })).why, /does not match your quote/);
  const noDev = await send(burnTx({ ...q, devLamports: '0' }, { uri })); assert.match((await F.verifyPurchase({ sig: noDev, nonce: 'qn1', kind: 'mint', expect: exp({ code: 'c5' }) })).why, /creator fee/i);
  assert.equal((await F.verifyPurchase({ sig: 'bad', nonce: 'x', kind: 'shop', expect: {} })).ok, false);
  // failures released their reservation: a correct tx for code c2 still works afterwards
  const fine = await send(burnTx({ ...q, nonce: 'qn9' }, { uri: 'https://x.test/nft/def.json' })); assert.equal((await F.verifyPurchase({ sig: fine, nonce: 'qn9', pid: 'p9', kind: 'mint', expect: exp({ code: 'c2', uri: 'https://x.test/nft/def.json' }) })).ok, true);
  const st = F.burnsApi.stats(); assert.equal(st.count, 2); assert.ok(st.codes.has('code-1') && st.codes.has('c2')); assert.equal(F.burnsApi.badge('p1'), true); assert.equal(F.burnsApi.badge('nobody'), false); assert.equal(st.top[0].nick.length > 0, true);
});
test('verifyPurchase: concurrent double-submit (same sig, and same code with different sigs) grants exactly once', async (t) => {
  if (skip) return t.skip('no validator'); const F = ctx.F; const w = ctx.user.publicKey.toBase58(); const q = { ...(await F.quote({ kind: 'shop', usd: 4, method: 'vwfest', discountPct: 50 })), nonce: 'qc1' };
  const sig = await send(burnTx(q)); const exp = { burnMin: BigInt(q.burnMin), wallet: w };
  const res = await Promise.all(Array.from({ length: 6 }, () => F.verifyPurchase({ sig, nonce: 'qc1', pid: 'pp', kind: 'shop', item: 'halo', expect: exp }))); assert.equal(res.filter((x) => x.ok).length, 1); assert.ok(res.filter((x) => !x.ok).every((x) => x.dup));
  const qa = { ...q, nonce: 'qc2' }, qb = { ...q, nonce: 'qc3' }; const sa = await send(burnTx(qa)), sb = await send(burnTx(qb));
  const both = await Promise.all([F.verifyPurchase({ sig: sa, nonce: 'qc2', kind: 'mint', expect: { ...exp, code: 'RACE' } }), F.verifyPurchase({ sig: sb, nonce: 'qc3', kind: 'mint', expect: { ...exp, code: 'RACE' } })]); assert.equal(both.filter((x) => x.ok).length, 1, 'one avatar code, one winner');
});
test('auth facade + persistence via a pg-like pool + fake hook is disabled on mainnet', async (t) => {
  const F = ctx.F; const kp = Keypair.generate(); const c = F.authApi.challenge(kp.publicKey.toBase58()); assert.match(c.message, /sign in with your Solana account/); const sig = Buffer.from(nacl.sign.detached(Buffer.from(c.message), kp.secretKey)).toString('base64');
  assert.deepEqual(await F.authApi.verify({ pubkey: kp.publicKey.toBase58(), signature: sig, nonce: c.nonce }), { ok: true, pubkey: kp.publicKey.toBase58() }); assert.equal((await F.authApi.verify({ pubkey: kp.publicKey.toBase58(), signature: sig, nonce: c.nonce })).ok, false);
  const rows = new Map(); const pool = { query: async (sql, p) => { if (/^SELECT ns,k,v/.test(sql)) return { rows: [...rows.values()] }; if (/INSERT/.test(sql)) rows.set(p[0] + '/' + p[1], { ns: p[0], k: p[1], v: JSON.parse(p[2]) }); return { rows: [] }; } };
  const F2 = await new Facade().init({ env: { ...ctx.env, CHAIN_FAKE: '1' }, db: pool, conn: ctx.conn }); assert.equal(F2.fake, true); const r = await F2.verifyPurchase({ sig: '5'.repeat(88), nonce: 'n', pid: 'p', nick: 'T', kind: 'shop', expect: { burnMin: 5n, wallet: 'W' } }); assert.equal(r.ok, true); await F2.store.flush();
  const F3 = await new Facade().init({ env: ctx.env, db: pool, conn: ctx.conn }); assert.equal(F3.burnsApi.stats().count, 1, 'ledger reloaded from the shared pool');
  const M = await new Facade().init({ env: { MINT_NETWORK: 'mainnet-beta', MINT_ENABLED: '1', CHAIN_FAKE: '1', SERVER_SECRET: 'z'.repeat(40) } }); assert.equal(M.fake, false, 'CHAIN_FAKE ignored on mainnet'); assert.equal(M.config().enabled, false); assert.equal(M.config().reason, 'mainnet not armed');
});
