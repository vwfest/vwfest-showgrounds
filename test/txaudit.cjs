// Client pre-sign audit (src/txaudit.mjs): program allow-list, SOL cap, token-op allow-list (server TOKEN_OK), swap spend bound read from the Jupiter instruction itself
// (checked against REAL Jupiter swap-instructions output), full-message audit (payer, memo, exactly one burnChecked, creator fee, Core create), signed-message identity.
const assert = require('assert'); const path = require('path'); const { pathToFileURL } = require('url');
const U = 'BqRM2Me3BriYQ9j4Dx2pXsbKWQ3AwELqqPu3Rd1QUwvZ', X = 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok', W = 'WsoLAta1111111111111111111111111111111111111', MINT = '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', ASSET = 'AssetKey111111111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', SYS = '11111111111111111111111111111111', JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', BUD = 'ComputeBudget111111111111111111111111111111';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const b64 = (arr) => Buffer.from(arr).toString('base64'); const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return [...b]; };
const tIx = (op, accts, extra = []) => ({ programId: TOKEN, accounts: accts.map((pubkey) => ({ pubkey })), data: b64([op, ...extra]) });
const sysIx = (kind, lamports, dest = W) => ({ programId: SYS, accounts: [{ pubkey: U }, { pubkey: dest }], data: b64([kind, 0, 0, 0, ...u64(lamports)]) });
// REAL Jupiter swap-instructions output (lite-api.jup.ag, 2026-10-31): ExactIn 0.05 SOL -> USDC (route), ExactOut USDC -> 10 USDC-equivalent (exact_out_route)
const REAL_IN = '5RfLl3rjrSoBAAAAsgFkAAGA8PoCAAAAACU+SQAAAAAAZAAA', REAL_OUT = '0DPvl3sr7VwBAAAAEQBkAAGAlpgAAAAAADOlDgAAAAAAZAAA'; // in: 50,000,000 exact | out: quoted input 959,795 @100bps
const jupIx = (data, src = W) => ({ programId: JUP, accounts: [{ pubkey: TOKEN }, { pubkey: U }, { pubkey: src }], data }); // `route` layout: input account at index 2
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
(async () => {
  const { audit, auditMessage, sameMessage, jupSpend, TOKEN_OK } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'txaudit.mjs')).href);
  const bad = (f, re) => assert.throws(f, re);
  await t('SOL: wrap transfer within the cap passes, above it is refused, and it may only go to the player\'s own wSOL account', () => { audit([sysIx(2, 1000)], 2000n, { user: U, wsolAta: W }); bad(() => audit([sysIx(2, 5000)], 2000n, { user: U, wsolAta: W }), /more SOL/); bad(() => audit([sysIx(2, 1000), sysIx(0, 1500)], 2000n, { user: U, wsolAta: W }), /more SOL/); bad(() => audit([sysIx(2, 10, X)], 2000n, { user: U, wsolAta: W }), /somewhere unexpected/); });
  await t('system allocate (8/9) and assign are refused (server parity: client has no use for them)', () => { for (const k of [8, 9, 1, 3, 10]) bad(() => audit([sysIx(k, 0)], 0n, { user: U, wsolAta: W }), /Unexpected system/); });
  await t('token ops = server TOKEN_OK {1,9,16,17,18}: everything else (transfer, approve, burn, InitializeMint 0/20, mintTo, freeze, setAuthority ...) is refused', () => {
    assert.deepStrictEqual([...TOKEN_OK].sort((a, b) => a - b), [1, 9, 16, 17, 18]); for (const op of [0, 20, 3, 12, 4, 6, 8, 13, 15, 7, 14, 10, 11, 2, 5]) bad(() => audit([tIx(op, ['a', 'b', U], [0, 0, 0, 0, 0, 0, 0, 0, 6])], 0n, { user: U }), /Unexpected token instruction/);
    for (const op of [1, 16, 17, 18]) audit([tIx(op, ['a', 'b', U])], 0n, { user: U });
  });
  await t('closeAccount (9) may only return SOL to the player', () => { audit([tIx(9, ['a', U, U])], 0n, { user: U }); bad(() => audit([tIx(9, ['a', X, U])], 0n, { user: U }), /elsewhere/); });
  await t('ATA program: create / createIdempotent for the player only; recoverNested and other owners refused', () => { const a = (data, owner) => ({ programId: ATA, accounts: [{ pubkey: U }, { pubkey: 'x' }, { pubkey: owner }, { pubkey: 'm' }], data }); audit([a(b64([1]), U), a(b64([]), U)], 0n, { user: U }); bad(() => audit([a(b64([1]), X)], 0n, { user: U }), /someone else/); bad(() => audit([a(b64([2]), U)], 0n, { user: U }), /Unexpected account/); });
  await t('unknown program refused', () => { bad(() => audit([{ programId: 'EvilProgram1111111111111111111111111111111', accounts: [], data: b64([0]) }], 0n), /unexpected program/); });
  await t('Jupiter spend bound is read from the REAL instruction data: ExactIn = exact input, ExactOut = quoted input + slippage', () => {
    assert.strictEqual(jupSpend(Buffer.from(REAL_IN, 'base64')), 50000000n); assert.strictEqual(jupSpend(Buffer.from(REAL_OUT, 'base64')), 969393n); // matches Jupiter's otherAmountThreshold 969393
    audit([jupIx(REAL_IN)], 0n, { user: U, maxSwapIn: 50000000n, source: W }); bad(() => audit([jupIx(REAL_IN)], 0n, { user: U, maxSwapIn: 49999999n, source: W }), /spend more/);
    bad(() => audit([jupIx(REAL_OUT)], 0n, { user: U, maxSwapIn: 969393n, source: W }), /Unrecognised swap route/); // ExactOut routes have no pinned-source layout: no longer accepted (swaps are ExactIn)
    bad(() => audit([jupIx(REAL_IN)], 0n, { user: U, source: W }), /No spend limit/);
  });
  await t('a tampered route amount, an unknown route type (incl. token-ledger variants) and short data are refused', () => {
    const d = Buffer.from(REAL_IN, 'base64'); d.writeBigUInt64LE(9000000000n, d.length - 19); bad(() => audit([jupIx(d.toString('base64'))], 0n, { user: U, maxSwapIn: 50000000n, source: W }), /spend more/);
    const l = Buffer.from(REAL_IN, 'base64'); Buffer.from('96564774a75d0e68', 'hex').copy(l, 0); bad(() => jupSpend(l), /Unrecognised swap route/); bad(() => jupSpend(Buffer.alloc(10)), /Unrecognised/); bad(() => jupSpend(Buffer.alloc(40)), /Unrecognised swap route/);
  });
  await t('priority fee ceiling (compute unit price x limit)', () => { const price = (p) => ({ programId: BUD, accounts: [], data: b64([3, ...u64(p)]) }); const lim = { programId: BUD, accounts: [], data: b64([2, 0x40, 0x0d, 0x03, 0]) }; audit([lim, price(100000)], 0n); bad(() => audit([lim, price(50000000)], 0n), /Priority fee/); });
  // ---- full message
  const burnIx = (amt, mint = MINT, auth = U, dec = 6) => ({ p: 'tok', a: ['ata', mint, auth], d: Uint8Array.from([15, ...u64(amt), dec]) });
  const mk = (extra = [], over = {}) => { const keys = [U, 'ata', MINT, X, TOKEN, MEMO, CORE, SYS, ASSET, BUD, JUP, ATA, W]; const ixs = [{ p: BUD, a: [], d: Uint8Array.from([2, 0x40, 0x0d, 0x03, 0]) }, { p: TOKEN, a: ['ata', MINT, U], d: Uint8Array.from([15, ...u64(1000), 6]) }, { p: MEMO, a: [], d: new TextEncoder().encode('vwfest:q1') }, ...extra];
    const idx = (x) => keys.indexOf(x); return { keys, ixs: ixs.map((i) => ({ p: idx(i.p), a: i.a.map(idx), d: i.d })), numSigners: 1, ...over }; };
  const C = { user: U, mint: MINT, decimals: 6, burn: 1000n, memo: 'vwfest:q1', devWallet: '', devLamports: 0n, asset: null, name: '', uri: '', swap: null };
  await t('whole transaction: payer, memo, exactly one burnChecked of the exact amount from the player\'s account', () => {
    assert(auditMessage(mk(), C)); const m = mk(); m.keys[0] = X; bad(() => auditMessage(m, C), /fee payer/); bad(() => auditMessage(mk(), { ...C, memo: 'vwfest:other' }), /Memo/); bad(() => auditMessage(mk(), { ...C, burn: 999n }), /Burn amount/);
    bad(() => auditMessage(mk([{ p: TOKEN, a: ['ata', MINT, U], d: Uint8Array.from([15, ...u64(1), 6]) }]), C), /Burn amount/); bad(() => auditMessage(mk(), { ...C, decimals: 9 }), /Burn instruction/); bad(() => auditMessage(mk(), { ...C, mint: X }), /Burn instruction/);
    bad(() => auditMessage(mk([{ p: TOKEN, a: ['ata', MINT, U], d: Uint8Array.from([8, ...u64(1)]) }]), C), /Unchecked burn/); bad(() => auditMessage(mk([], { numSigners: 2 }), C), /extra signature/);
  });
  await t('whole transaction: creator fee exactly as quoted, only to the quoted wallet; any other SOL movement refused in a non-swap purchase', () => {
    const fee = { p: SYS, a: [U, X], d: Uint8Array.from([2, 0, 0, 0, ...u64(500)]) }; const c2 = { ...C, devWallet: X, devLamports: 500n }; assert(auditMessage(mk([fee]), c2));
    bad(() => auditMessage(mk([fee]), { ...c2, devLamports: 400n }), /Creator fee/); bad(() => auditMessage(mk([]), c2), /Creator fee/); bad(() => auditMessage(mk([{ p: SYS, a: [U, W], d: fee.d }]), c2), /Creator fee|Unexpected instructions|unexpected/i); bad(() => auditMessage(mk([fee]), C), /Unexpected instructions|Creator fee|unexpected/i);
  });
  await t('whole transaction: Core NFT create must match asset, payer, name and uri exactly; unknown programs refused', () => {
    const str = (s) => { const e = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(e.length); return [...l, ...e]; }; const core = (name, uri, payer = U) => ({ p: CORE, a: [ASSET, CORE, CORE, payer, CORE, CORE, SYS, CORE], d: Uint8Array.from([0, 0, ...str(name), ...str(uri), 0]) });
    const c3 = { ...C, asset: ASSET, name: 'My Ride', uri: 'https://x/y.json' }; const ok = mk([core('My Ride', 'https://x/y.json')], { numSigners: 2 }); assert(auditMessage(ok, c3));
    bad(() => auditMessage(mk([core('Other', 'https://x/y.json')], { numSigners: 2 }), c3), /name\/metadata/); bad(() => auditMessage(mk([core('My Ride', 'https://evil/y.json')], { numSigners: 2 }), c3), /name\/metadata/); bad(() => auditMessage(mk([core('My Ride', 'https://x/y.json', X)], { numSigners: 2 }), c3), /accounts/);
    bad(() => auditMessage(mk([], { numSigners: 2 }), c3), /count/); bad(() => auditMessage(mk([core('My Ride', 'https://x/y.json')]), C), /Unexpected NFT/);
    const m = mk(); m.keys.push('Evil11111111111111111111111111111111111111'); m.ixs.push({ p: m.keys.length - 1, a: [], d: Uint8Array.of(1) }); bad(() => auditMessage(m, C), /unexpected program/);
  });
  await t('whole transaction with a Jupiter swap: setup/swap/cleanup audited, spend bounded by the quote, wSOL funding only from the player to their own wSOL account', () => {
    const sw = { maxLamports: 50000000n + 6000000n, maxSwapIn: 50000000n, wsolAta: W }; const wrap = { p: SYS, a: [U, W], d: Uint8Array.from([2, 0, 0, 0, ...u64(50000000)]) }; const route = { p: JUP, a: [TOKEN, U, W], d: Buffer.from(REAL_IN, 'base64') }; const sync = { p: TOKEN, a: [W], d: Uint8Array.of(17) };
    assert(auditMessage(mk([wrap, sync, route]), { ...C, swap: sw })); bad(() => auditMessage(mk([wrap, sync, route]), { ...C, swap: { ...sw, maxSwapIn: 49000000n } }), /spend more/);
    bad(() => auditMessage(mk([{ ...wrap, a: [U, X] }, route]), { ...C, swap: sw }), /Creator fee|somewhere unexpected|unexpected/i); bad(() => auditMessage(mk([route]), C), /Unexpected instructions/);
    bad(() => auditMessage(mk([wrap, { p: TOKEN, a: ['ata', 'tmp', U], d: Uint8Array.from([3, ...u64(5)]) }, route]), { ...C, swap: sw }), /Unexpected token instruction/);
  });
  await t('the wallet must return the exact message that was audited', () => { assert(sameMessage(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))); assert(!sameMessage(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))); assert(!sameMessage(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))); assert(!sameMessage(null, Uint8Array.of(1))); });
  await t('pay.js source: emits burnChecked (15) with decimals, never the unchecked burn (8), and re-audits the exact bytes right before signing', () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'pay.js'), 'utf8'); assert(/Uint8Array\.of\(15\)\], u64\(burn\), Uint8Array\.of\(cfg\.decimals\)/.test(src)); assert(!/Uint8Array\.of\(8\)/.test(src));
    assert(src.indexOf('auditTx(toSign, prep.auditCtx)') > 0 && src.indexOf('auditTx(toSign, prep.auditCtx)') < src.indexOf('provider.signTransaction(toSign)'), 'audit precedes signing');
    const w = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'wallet.js'), 'utf8'); assert(!/exportPair\(\)[^\n]*\bsign\b/.test(w)); const body = w.slice(w.indexOf('const signTransaction'), w.indexOf('return { kind'));
    assert(!/exportPair|solana_privateKey|nacl/.test(body), 'signing never exports the key');
  });
  console.log(process.exitCode ? 'TXAUDIT TESTS FAILED' : `all ${n} tx audit tests passed`);
})();
