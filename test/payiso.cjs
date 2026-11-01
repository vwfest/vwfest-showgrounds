// End-to-end of the CLIENT token-pay builder (src/pay.js, bundled for node) against a mock RPC + mock Jupiter: the built transaction is the isolated swap, passes the pre-sign audit,
// and a hostile Jupiter reply (route spends more / input from another account / smuggled player account / stray user token account in the route) is refused before anything is shown to a wallet.
const assert = require('assert'); const http = require('http'); const path = require('path'); const fs = require('fs'); const os = require('os');
const { Keypair, PublicKey, VersionedTransaction } = require('@solana/web3.js');
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), TOK = new PublicKey(TOKEN);
const bud = (d) => ({ programId: 'ComputeBudget111111111111111111111111111111', accounts: [], data: Buffer.from(d).toString('base64') }); const JUPBUD = [bud([2, 0x50, 0xc3, 0, 0]), bud([3, 0xe8, 0x03, 0, 0, 0, 0, 0, 0])]; // Jupiter's swap-only limit (50k units) + a 1000 microlamport price
const REAL_IN = '5RfLl3rjrSoBAAAAsgFkAAGA8PoCAAAAACU+SQAAAAAAZAAA'; const MAXIN = 5000000n, HAVE = 20000000n;
const ata = (o, m) => PublicKey.findProgramAddressSync([o.toBytes(), TOK.toBytes(), m.toBytes()], ATA)[0];
(async () => {
  const out = path.join(os.tmpdir(), 'sg-pay-bundle-' + process.pid + '.cjs');
  await require('esbuild').build({ entryPoints: [path.join(__dirname, '..', 'src', 'pay.js')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent', define: { global: 'globalThis' }, external: [] });
  globalThis.window = {}; const pay = require(out);
  const user = Keypair.generate().publicKey, payMint = Keypair.generate().publicKey, vwMint = Keypair.generate().publicKey, amm = [1, 2, 3].map(() => Keypair.generate().publicKey), dest = Keypair.generate().publicKey;
  const main = ata(user, payMint), vwAta = ata(user, vwMint); let mode = 'honest', stray = null, simUnits = 200000; const calls = [];
  const tokenAcctData = (owner, amt) => { const b = Buffer.alloc(165); owner.toBuffer().copy(b, 32); b.writeBigUInt64LE(amt, 64); return b; };
  const acc = (data, owner = TOKEN) => ({ data: [Buffer.from(data).toString('base64'), 'base64'], executable: false, lamports: 1461600, owner, rentEpoch: 0 });
  const key = (p, s = false, w = false) => ({ pubkey: p.toBase58(), isSigner: s, isWritable: w });
  const routeIx = () => { const src = mode === 'foreign' ? dest : main; const d = Buffer.from(REAL_IN, 'base64'); d.writeBigUInt64LE(mode === 'overspend' ? MAXIN * 3n : MAXIN, d.length - 19); d.writeBigUInt64LE(996000000n, d.length - 11); d.writeUInt16LE(mode === 'slippage' ? 3000 : 50, d.length - 3); // quoted_out_amount / slippage_bps as the mock quote says
    const extra = mode === 'multihop' ? [key(main, false, true)] : mode === 'smuggle' ? [key(main, false, true)] : mode === 'stray' ? [key(stray, false, true)] : [];
    return { programId: JUP, accounts: [key(TOK), key(user, true), key(src, false, true), key(mode === 'redirect' ? dest : vwAta, false, true), key(mode === 'second' ? dest : new PublicKey(JUP)), key(vwMint), key(new PublicKey(JUP)), ...amm.map((a) => key(a, false, true)), ...extra], data: d.toString('base64') }; };
  const rpc = (m, p) => { calls.push(m); switch (m) {
    case 'getAccountInfo': { const k = p[0]; if (k === vwMint.toBase58() || k === payMint.toBase58()) return acc(Buffer.alloc(82)); return null; }
    case 'getTokenAccountBalance': return { amount: HAVE.toString(), decimals: 6, uiAmount: 20, uiAmountString: '20' };
    case 'getMinimumBalanceForRentExemption': return 2039280;
    case 'getMultipleAccounts': return p[0].map((k) => (stray && k === stray.toBase58() ? acc(tokenAcctData(user, 777n)) : null));
    case 'getLatestBlockhash': return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1000 };
    case 'getBalance': return 1000000000;
    case 'simulateTransaction': return { err: null, logs: [], accounts: [acc(Buffer.alloc(0)), acc(tokenAcctData(user, HAVE - MAXIN))], unitsConsumed: simUnits };
    default: throw new Error('mock rpc: ' + m); } };
  const srv = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => (b += c)); rq.on('end', () => { const u = new URL(rq.url, 'http://x'); rs.setHeader('content-type', 'application/json');
    if (u.pathname === '/quote') { const exactOut = u.searchParams.get('swapMode') === 'ExactOut'; return rs.end(JSON.stringify(exactOut ? { inAmount: '4975000', outAmount: u.searchParams.get('amount'), otherAmountThreshold: MAXIN.toString() } : { inAmount: u.searchParams.get('amount'), outAmount: '996000000', otherAmountThreshold: '991000000' })); }
    if (u.pathname === '/swap-instructions') return rs.end(JSON.stringify({ computeBudgetInstructions: JUPBUD, setupInstructions: [], swapInstruction: routeIx(), cleanupInstruction: null, addressLookupTableAddresses: [] }));
    const j = JSON.parse(b); const one = (r) => { try { const v = rpc(r.method, r.params || []); const wrap = ['getAccountInfo', 'getTokenAccountBalance', 'getMultipleAccounts', 'getBalance', 'getLatestBlockhash', 'simulateTransaction'].includes(r.method); return { jsonrpc: '2.0', id: r.id, result: wrap ? { context: { slot: 1 }, value: v } : v }; } catch (e) { return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: e.message } }; } };
    rs.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j))); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const q = { id: 'qp1', swap: true, burnRaw: '1000000000', burnMin: '990000000', devLamports: '0', devWallet: Keypair.generate().publicKey.toBase58(), swapLamports: '0', totalLamports: '0' };
  const cfg = { jupiter: base, mint: vwMint.toBase58(), decimals: 6, slippageBps: 50, network: 'mainnet-beta', publicRpcUrl: base }; const pt = { mint: payMint.toBase58(), sym: 'TKN', dec: 6 };
  let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
  const go = () => pay.prepare({ q, cfg, server: base, pubkey: user, payToken: pt });
  await t('honest Jupiter reply: token pay builds the isolated swap (create, init, transferChecked exactly maxIn, route on temp, close), burn = ExactIn minOut, audit passes', async () => {
    mode = 'honest'; const p = await go(); const tx = VersionedTransaction.deserialize(p.tx.serialize()); const ak = tx.message.getAccountKeys(); const progs = tx.message.compiledInstructions.map((i) => ak.get(i.programIdIndex).toBase58().slice(0, 4));
    assert.deepStrictEqual(progs, ['Comp', 'Comp', '1111', 'Toke', 'Toke', 'JUP6', 'Toke', 'Toke', 'Memo']); /* our limit first, Jupiter's price kept, Jupiter's 50k limit dropped */ // create-with-seed, InitializeAccount3, transferChecked, route, closeAccount, burnChecked, memo
    assert.strictEqual(p.swapInfo.maxIn, MAXIN); assert.strictEqual(p.burn, 991000000n); assert(pay.auditTx(tx, p.auditCtx)); assert(p.auditCtx.c.swap.iso && p.auditCtx.c.swap.iso.amount === MAXIN);
    const route = tx.message.compiledInstructions.find((i) => ak.get(i.programIdIndex).toBase58() === JUP); assert.notStrictEqual(ak.get(route.accountKeyIndexes[2]).toBase58(), main.toBase58(), 'route source is NOT the player\'s own account');
    assert(!tx.message.compiledInstructions.some((i) => ak.get(i.programIdIndex).toBase58() === JUP && Array.from(i.accountKeyIndexes).some((x) => ak.get(x).toBase58() === main.toBase58())), 'player\'s own token account is in no route instruction'); });
  await t('CU limit: Jupiter\'s swap-only limit (50k) is dropped; ours is simulated units x 1.3 + 20k (200000 -> 280000), the audit accepts it, and the memo fits', async () => {
    mode = 'honest'; const p = await go(); const tx = VersionedTransaction.deserialize(p.tx.serialize()); const ak = tx.message.getAccountKeys();
    const lim = tx.message.compiledInstructions.filter((i) => ak.get(i.programIdIndex).toBase58().startsWith('Comp') && i.data[0] === 2); assert.strictEqual(lim.length, 1, 'exactly one SetComputeUnitLimit'); const units = Buffer.from(lim[0].data).readUInt32LE(1);
    assert.strictEqual(units, 280000); assert.strictEqual(p.cuLimit, 280000); assert(units > 50000 + 24000 + 20000, 'room for the memo (~24k) beyond a swap-only limit'); assert(pay.auditTx(tx, p.auditCtx)); });
  await t('CU limit, no-swap paths (pay in $VWFEST, avatar NFT mint / ride): our limit is first, = units x 1.3 + 20k, floored at 100k and capped at 1.4M; no measurement -> 400k floor', async () => {
    const lim = async (units, extra) => { simUnits = units; const qq = { ...q, swap: false, method: 'vwfest', burnRaw: '1000000', burnMin: '1000000', uri: 'https://x.example/nft/C1.json', name: 'VW FEST Avatar', ...extra }; const p = await pay.prepare({ q: qq, cfg, server: base, pubkey: user }); const tx = VersionedTransaction.deserialize(p.tx.serialize()); const ak = tx.message.getAccountKeys();
      const i0 = tx.message.compiledInstructions[0]; assert.strictEqual(ak.get(i0.programIdIndex).toBase58(), 'ComputeBudget111111111111111111111111111111'); assert.strictEqual(i0.data[0], 2); assert(pay.auditTx(tx, p.auditCtx)); return Buffer.from(i0.data).readUInt32LE(1); };
    assert.strictEqual(await lim(60000), 100000, 'CU_MIN'); assert.strictEqual(await lim(150000), 215000); assert.strictEqual(await lim(1390000), 1400000, 'cap'); assert.strictEqual(await lim(undefined), 400000, 'no measurement -> floor'); simUnits = 200000; });
  await t('real multi-hop route: Jupiter lists the player\'s source account again inside the AMM accounts; every reference is moved to the temp account and the build passes the audit', async () => {
    mode = 'multihop'; const p = await go(); const tx = VersionedTransaction.deserialize(p.tx.serialize()); const ak = tx.message.getAccountKeys();
    assert(!tx.message.compiledInstructions.some((i) => ak.get(i.programIdIndex).toBase58() === JUP && Array.from(i.accountKeyIndexes).some((x) => ak.get(x).toBase58() === main.toBase58())), 'no route instruction references the player\'s own token account'); assert(pay.auditTx(tx, p.auditCtx)); });
  await t('MALICIOUS Jupiter: in_amount x3 is refused before anything is shown to the wallet', async () => { mode = 'overspend'; await assert.rejects(go(), /spend more/); });
  await t('MALICIOUS Jupiter: route input from a different account than the player\'s own is refused', async () => { mode = 'foreign'; await assert.rejects(go(), /own token account/); });
  await t('MALICIOUS Jupiter: ANOTHER token account owned by the player in the route is refused (RPC owner check)', async () => { mode = 'stray'; stray = Keypair.generate().publicKey; await assert.rejects(go(), /another token account of yours/); stray = null; });
  await t('MALICIOUS Jupiter: output redirected to the attacker (route idx 3), a second destination (idx 4), or more slippage than the quote is refused', async () => {
    mode = 'redirect'; await assert.rejects(go(), /somewhere other than your own account/); mode = 'second'; await assert.rejects(go(), /second destination/); mode = 'slippage'; await assert.rejects(go(), /more slippage/); });
  await t('tampered tx after build: bumping the transfer amount makes the re-audit (run right before signing) refuse it', async () => {
    mode = 'honest'; const p = await go(); const tx = VersionedTransaction.deserialize(p.tx.serialize()); const ix = tx.message.compiledInstructions.find((i) => i.data.length === 10 && i.data[0] === 12); new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).setBigUint64(1, MAXIN * 2n, true); assert.throws(() => pay.auditTx(tx, p.auditCtx), /does not match your quote/); });
  srv.close(); fs.rmSync(out, { force: true }); console.log(process.exitCode ? 'PAYISO TESTS FAILED' : `all ${n} client token-pay tests passed`); process.exit(process.exitCode || 0);
})();
