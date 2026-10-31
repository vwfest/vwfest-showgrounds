// Client pre-sign audit of the ISOLATED token swap (src/txaudit.mjs): a Jupiter route runs with the player's signature, so a token-funded swap must be
// [createAccountWithSeed temp] [InitializeAccount3] [transferChecked main -> temp, EXACTLY the quoted input] [route, source = temp] [closeAccount temp -> player],
// with the player's own token account referenced by no route instruction. Real web3.js builders + REAL Jupiter route bytes; hostile variants must be refused.
const assert = require('assert'); const path = require('path'); const crypto = require('crypto'); const { pathToFileURL } = require('url');
const { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, TransactionInstruction } = require('@solana/web3.js');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), JUP = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const REAL_IN = '5RfLl3rjrSoBAAAAsgFkAAGA8PoCAAAAACU+SQAAAAAAZAAA'; const AMOUNT = 5000000n, DEC = 6;
const ata = (owner, mint) => PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN.toBytes(), mint.toBytes()], ATA)[0];
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const routeData = (amt) => { const d = Buffer.from(REAL_IN, 'base64'); d.writeBigUInt64LE(BigInt(amt), d.length - 19); return d; };
const k = (pubkey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
(async () => {
  const { auditMessage, audit, pinSource, jupSource, b58 } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'txaudit.mjs')).href);
  const user = Keypair.generate().publicKey, inMint = Keypair.generate().publicKey, vwMint = Keypair.generate().publicKey, attacker = Keypair.generate().publicKey;
  const main = ata(user, inMint), vwAta = ata(user, vwMint), wsol = ata(user, WSOL); const seed = crypto.randomBytes(8).toString('hex'); const temp = await PublicKey.createWithSeed(user, seed, TOKEN); const amm = [1, 2, 3].map(() => Keypair.generate().publicKey);
  const route = (src = temp, amt = AMOUNT, extra = []) => new TransactionInstruction({ programId: JUP, keys: [k(TOKEN), k(user, true), k(src, false, true), k(vwAta, false, true), k(JUP), k(vwMint), k(JUP), k(amm[0]), k(JUP), ...amm.map((a) => k(a, false, true)), ...extra.map((a) => k(a, false, true))], data: routeData(amt) });
  const create = (o = {}) => SystemProgram.createAccountWithSeed({ fromPubkey: user, newAccountPubkey: temp, basePubkey: user, seed, lamports: o.lamports ?? 2039280, space: o.space ?? 165, programId: o.owner || TOKEN });
  const init = (o = {}) => new TransactionInstruction({ programId: TOKEN, keys: [k(temp, false, true), k(o.mint || inMint)], data: Buffer.concat([Buffer.from([18]), (o.owner || user).toBuffer()]) });
  const xfer = (amt = AMOUNT, dest = temp, src = main) => new TransactionInstruction({ programId: TOKEN, keys: [k(src, false, true), k(inMint), k(dest, false, true), k(user, true)], data: Buffer.concat([Buffer.from([12]), u64(amt), Buffer.from([DEC])]) });
  const close = (dest = user) => new TransactionInstruction({ programId: TOKEN, keys: [k(temp, false, true), k(dest, false, true), k(user, true)], data: Buffer.from([9]) });
  const burn = new TransactionInstruction({ programId: TOKEN, keys: [k(vwAta, false, true), k(vwMint, false, true), k(user, true)], data: Buffer.concat([Buffer.from([15]), u64(1000), Buffer.from([6])]) });
  const memo = new TransactionInstruction({ programId: MEMO, keys: [k(user, true)], data: Buffer.from('vwfest:qi1') });
  // same flattening as src/pay.js decompile()
  const flat = (ixs) => { const msg = new TransactionMessage({ payerKey: user, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message(); const ak = msg.getAccountKeys(); const keys = []; for (let i = 0; i < ak.length; i++) keys.push(ak.get(i).toBase58());
    return { keys, ixs: msg.compiledInstructions.map((ix) => ({ p: ix.programIdIndex, a: Array.from(ix.accountKeyIndexes), d: ix.data })), numSigners: msg.header.numRequiredSignatures }; };
  const iso = { temp: temp.toBase58(), main: main.toBase58(), mint: inMint.toBase58(), dec: DEC, amount: AMOUNT, maxRent: 2040280n };
  const C = { user: user.toBase58(), ata: vwAta.toBase58(), mint: vwMint.toBase58(), decimals: 6, burn: 1000n, memo: 'vwfest:qi1', devWallet: '', devLamports: 0n, asset: null, name: '', uri: '', swap: { maxLamports: 8039280n, maxSwapIn: AMOUNT, wsolAta: wsol.toBase58(), dest: vwAta.toBase58(), maxSlippageBps: 100, quotedOut: 4800037n, iso } };
  const A = (ixs, re, c = C) => assert.throws(() => auditMessage(flat(ixs), c), re); const ok = (ixs, c = C) => assert(auditMessage(flat(ixs), c));
  await t('an isolated token swap passes (REAL route bytes, real instruction builders)', () => ok([create(), init(), xfer(), route(), close(), burn, memo]));
  await t('MALICIOUS ROUTE: input still taken from the player\'s own token account (not isolated) is refused', () => A([create(), init(), xfer(), route(main), close(), burn, memo], /different account|must not use/));
  await t('MALICIOUS ROUTE: CPI accounts smuggle the player\'s own token account into the route (could take MORE than quoted) is refused', () => A([create(), init(), xfer(), route(temp, AMOUNT, [main]), close(), burn, memo], /must not use/));
  await t('MALICIOUS ROUTE: in_amount above the quote is refused; so is moving more (or less) than the quote into the temp account', () => {
    A([create(), init(), xfer(), route(temp, AMOUNT + 1n), close(), burn, memo], /spend more/); A([create(), init(), xfer(AMOUNT + 1n), route(), close(), burn, memo], /does not match your quote/); A([create(), init(), xfer(AMOUNT - 1n), route(), close(), burn, memo], /does not match your quote/); });
  await t('isolation steps: second transfer, transfer to a stranger, missing / misordered / misdirected close, wrong temp owner/size/rent, wrong mint/owner on init are all refused', () => {
    A([create(), init(), xfer(), xfer(), route(), close(), burn, memo], /Duplicate token transfer/); A([create(), init(), xfer(), route(), close(), xfer(1n, attacker), burn, memo], /Unexpected token instruction|must not use/);
    A([create(), init(), xfer(), route(), burn, memo], /isolation steps are missing/); A([create(), init(), xfer(), close(), route(), burn, memo], /out of order/); A([create(), init(), xfer(), route(), close(attacker), burn, memo], /closed to someone else/);
    A([create({ owner: JUP }), init(), xfer(), route(), close(), burn, memo], /not what was prepared/); A([create({ space: 200 }), init(), xfer(), route(), close(), burn, memo], /not what was prepared/); A([create({ lamports: 9000000000 }), init(), xfer(), route(), close(), burn, memo], /more rent/);
    A([create(), init({ mint: vwMint }), xfer(), route(), close(), burn, memo], /not owned by you|wrong token/); A([create(), init({ owner: attacker }), xfer(), route(), close(), burn, memo], /not owned by you|wrong token/);
    A([create(), create(), init(), xfer(), route(), close(), burn, memo], /Duplicate/); A([create(), init(), xfer(AMOUNT, temp, attacker), route(), close(), burn, memo], /does not match your quote/); });
  await t('a token-funded swap without isolation context is refused (legacy un-isolated path can no longer sign)', () => { A([route(main), burn, memo], /different account/, { ...C, swap: { ...C.swap, iso: null } }); });
  await t('SOL swaps: the route may only take its input from the player\'s own wSOL account', () => {
    const SC = { ...C, swap: { maxLamports: 4500000n + 6000000n, maxSwapIn: 4500000n, wsolAta: wsol.toBase58(), dest: vwAta.toBase58(), maxSlippageBps: 100, quotedOut: 4800037n, iso: null } }; const wrap = SystemProgram.transfer({ fromPubkey: user, toPubkey: wsol, lamports: 4500000 }); const sync = new TransactionInstruction({ programId: TOKEN, keys: [k(wsol, false, true)], data: Buffer.from([17]) });
    ok([wrap, sync, route(wsol, 4500000n), burn, memo], SC); A([wrap, sync, route(main, 4500000n), burn, memo], /different account/, SC); A([wrap, sync, route(temp, 4500000n), burn, memo], /different account/, SC); });
  await t('audit(): a route with no pinned source is refused; ExactOut routes cannot be pinned', () => {
    const j = (ix) => ({ programId: ix.programId.toBase58(), accounts: ix.keys.map((x) => ({ pubkey: x.pubkey.toBase58() })), data: ix.data.toString('base64') });
    assert.throws(() => audit([j(route())], 0n, { user: user.toBase58(), maxSwapIn: AMOUNT }), /No source account pinned/); audit([j(route())], 0n, { user: user.toBase58(), maxSwapIn: AMOUNT, source: temp.toBase58(), dest: vwAta.toBase58(), minOut: 1000n });
    const exactOut = Buffer.from('0DPvl3sr7VwBAAAAEQBkAAGAlpgAAAAAADOlDgAAAAAAZAAA', 'base64'); assert.throws(() => audit([{ ...j(route()), data: exactOut.toString('base64') }], 0n, { user: user.toBase58(), maxSwapIn: 969393n, source: temp.toBase58(), dest: vwAta.toBase58(), minOut: 1000n }), /Unrecognised swap route/); });
  await t('MALICIOUS ROUTE: output sent to the attacker\'s account (route idx 3), a second destination account (idx 4), a platform fee, more slippage, or a promise below the burn are all refused at message level', () => {
    const rt = (over) => { const r = route(); const keys = r.keys.map((x) => ({ ...x })); over.keys && over.keys(keys); const d = Buffer.from(r.data); over.data && over.data(d, d.length - 19); return new TransactionInstruction({ programId: JUP, keys, data: d }); };
    const sq = (ix) => [create(), init(), xfer(), ix, close(), burn, memo];
    ok(sq(route())); A(sq(rt({ keys: (k2) => (k2[3].pubkey = attacker) })), /somewhere other than your own account/); A(sq(rt({ keys: (k2) => (k2[4].pubkey = attacker) })), /second destination/);
    A(sq(rt({ data: (d, o) => (d[o + 18] = 30) })), /platform fee/); A(sq(rt({ data: (d, o) => d.writeUInt16LE(5000, o + 16) })), /more slippage/); { const big = new TransactionInstruction({ programId: TOKEN, keys: burn.keys, data: Buffer.concat([Buffer.from([15]), u64(4800000), Buffer.from([6])]) }); A([create(), init(), xfer(), route(), close(), big, memo], /guarantees less/, { ...C, burn: 4800000n }); } // burning more than the route guarantees would draw on the player's existing balance
    A(sq(route()), /different output/, { ...C, swap: { ...C.swap, quotedOut: 1n } }); A(sq(route()), /No destination pinned|not going to the account/, { ...C, swap: { ...C.swap, dest: undefined } }); });
  await t('pinSource moves the route input to the temp account, refuses an unexpected original source / unknown route; shared_accounts_route source is index 3', () => {
    const j = (ix) => ({ programId: ix.programId.toBase58(), accounts: ix.keys.map((x) => ({ pubkey: x.pubkey.toBase58(), isSigner: x.isSigner, isWritable: x.isWritable })), data: ix.data.toString('base64') }); const o = j(route(main)); const p = pinSource(o, temp.toBase58(), main.toBase58());
    assert.strictEqual(p.accounts[2].pubkey, temp.toBase58()); assert.strictEqual(o.accounts[2].pubkey, main.toBase58()); assert.strictEqual(p.accounts[2].isWritable, true); assert.throws(() => pinSource(o, temp.toBase58(), attacker.toBase58()), /own token account/);
    assert.throws(() => pinSource({ ...o, data: Buffer.concat([Buffer.from('96564774a75d0e68', 'hex'), Buffer.alloc(30)]).toString('base64') }, 'T'), /Unrecognised/);
    const sh = { programId: JUP.toBase58(), accounts: [0, 1, 2, 3, 4].map((x) => ({ pubkey: 'a' + x })), data: Buffer.concat([Buffer.from('c1209b3341d69c81', 'hex'), Buffer.alloc(30)]).toString('base64') }; assert.strictEqual(pinSource(sh, 'TEMP').accounts[3].pubkey, 'TEMP'); assert.strictEqual(jupSource(sh, Buffer.from(sh.data, 'base64')), 'a3'); });
  await t('b58 decodes pubkeys to their 32 bytes', () => { assert.deepStrictEqual(Buffer.from(b58(user.toBase58())), user.toBuffer()); assert.deepStrictEqual(Buffer.from(b58('11111111111111111111111111111111')), Buffer.alloc(32)); });
  console.log(process.exitCode ? 'SWAPISO TESTS FAILED' : `all ${n} swap-isolation tests passed`);
})();
