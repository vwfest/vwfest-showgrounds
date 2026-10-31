'use strict';
// Server-side audit of Jupiter route instructions: the spend bound is read from the instruction data (REAL Jupiter swap-instructions output, 2026-10-31).
const test = require('node:test'); const assert = require('node:assert/strict');
const { auditJupiterIxs, jupSpend } = require('../src/jupiter'); const C = require('../src/config');
const USER = 'BqRM2Me3BriYQ9j4Dx2pXsbKWQ3AwELqqPu3Rd1QUwvZ';
const REAL_IN = '5RfLl3rjrSoBAAAAsgFkAAGA8PoCAAAAACU+SQAAAAAAZAAA', REAL_OUT = '0DPvl3sr7VwBAAAAEQBkAAGAlpgAAAAAADOlDgAAAAAAZAAA';
const SRC = 'SrcAcct1111111111111111111111111111111111'; // route input account (index 2 of the `route` layout)
const DST = 'DestVwfestAta1111111111111111111111111111111'; const R = { dest: DST, minOut: 4752037n, maxSlippageBps: 100, quotedOut: 4800037n }; // what the REAL route bytes were issued for (outAmount 4800037, threshold 4752037, 100 bps)
const jup = (data, dest = DST, x4 = C.JUPITER_PROGRAM) => ({ programId: C.JUPITER_PROGRAM, accounts: [USER, USER, SRC, dest, x4, USER, C.JUPITER_PROGRAM].map((pubkey) => ({ pubkey })), data }); // `route` layout (Jupiter IDL): source 2, destination 3, optional 2nd destination 4
test('jupSpend: ExactIn = exact input; ExactOut = quoted input + slippage (matches Jupiter otherAmountThreshold); unknown/short refused', () => {
  assert.equal(jupSpend(Buffer.from(REAL_IN, 'base64')), 50000000n); assert.equal(jupSpend(Buffer.from(REAL_OUT, 'base64')), 969393n);
  const l = Buffer.from(REAL_IN, 'base64'); Buffer.from('96564774a75d0e68', 'hex').copy(l, 0); assert.throws(() => jupSpend(l), /Unrecognised swap route/); assert.throws(() => jupSpend(Buffer.alloc(5)), /Unrecognised/);
});
test('auditJupiterIxs: the route may not spend more of the input mint than the quote (token or SOL), non-WSOL inputs included', () => {
  assert.ok(auditJupiterIxs([jup(REAL_IN)], { user: USER, maxLamports: 0n, maxSwapIn: 50000000n, source: SRC, ...R })); assert.throws(() => auditJupiterIxs([jup(REAL_IN)], { user: USER, maxLamports: 0n, maxSwapIn: 49999999n, source: SRC, ...R }), /spend more/);
  const d = Buffer.from(REAL_IN, 'base64'); d.writeBigUInt64LE(10n ** 12n, d.length - 19); assert.throws(() => auditJupiterIxs([jup(d.toString('base64'))], { user: USER, maxLamports: 0n, maxSwapIn: 50000000n, source: SRC, ...R }), /spend more/);
});
test('the browser builder\'s burnChecked bytes/keys are identical to spl-token\'s (what the server verifies)', () => {
  const spl = require('@solana/spl-token'); const { Keypair } = require('@solana/web3.js'); const k = () => Keypair.generate().publicKey;
  const ix = spl.createBurnCheckedInstruction(k(), k(), k(), 1234n, 6, [], spl.TOKEN_PROGRAM_ID); const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
  assert.deepEqual(Buffer.from([15, ...u64(1234n), 6]), ix.data); assert.deepEqual(ix.keys.map((x) => [x.isSigner, x.isWritable]), [[false, true], [false, true], [true, false]]); // src/pay.js: ata (w), mint (w), user (signer)
});

test('swap DESTINATION is pinned (IDL: route idx 3 + optional idx 4, shared_accounts_route idx 6); slippage_bps, quoted_out_amount, platform fee, the burn guarantee and an exact ExactIn spend are audited against the quote', () => {
  const base = { user: USER, maxLamports: 0n, maxSwapIn: 50000000n, source: SRC, ...R }; const A = (ixs, o, re) => assert.throws(() => auditJupiterIxs(ixs, { ...base, ...o }), re); const tweak = (f) => { const d = Buffer.from(REAL_IN, 'base64'); f(d, d.length - 19); return jup(d.toString('base64')); };
  assert.ok(auditJupiterIxs([jup(REAL_IN)], base));
  A([jup(REAL_IN, 'AttackerAta11111111111111111111111111111111')], {}, /somewhere other than your own account/); A([jup(REAL_IN, DST, 'AttackerAta11111111111111111111111111111111')], {}, /second destination/); assert.ok(auditJupiterIxs([jup(REAL_IN, DST, DST)], base));
  A([jup(REAL_IN)], { dest: undefined }, /No destination pinned/);
  const sh = Buffer.from(REAL_IN, 'base64'); Buffer.from('c1209b3341d69c81', 'hex').copy(sh, 0); const shared = (d6) => ({ programId: C.JUPITER_PROGRAM, accounts: [USER, USER, USER, SRC, USER, USER, d6, USER, USER, USER].map((pubkey) => ({ pubkey })), data: sh.toString('base64') }); // shared_accounts_route: source 3, destination 6
  assert.ok(auditJupiterIxs([shared(DST)], base)); A([shared('AttackerAta11111111111111111111111111111111')], {}, /somewhere other than your own account/);
  A([tweak((d, o) => d.writeUInt16LE(2000, o + 16))], {}, /more slippage/); A([jup(REAL_IN)], { maxSlippageBps: 50 }, /more slippage/); A([tweak((d, o) => d.writeBigUInt64LE(1n, o + 8))], {}, /different output|guarantees less/); A([jup(REAL_IN)], { quotedOut: 4800038n }, /different output/);
  A([jup(REAL_IN)], { quotedOut: undefined, minOut: 4752038n }, /guarantees less/); A([tweak((d, o) => (d[o + 18] = 50))], {}, /platform fee/); A([jup(REAL_IN)], { maxSwapIn: 50000001n }, /exactly the quoted input/);
});
test('System allocate (kind 8) is no longer accepted in a swap route', () => {
  const sys = (kind) => ({ programId: '11111111111111111111111111111111', accounts: [], data: Buffer.from([kind, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64') });
  assert.throws(() => auditJupiterIxs([sys(8)], { user: USER, maxLamports: 0n }), /Unexpected system instruction/); assert.throws(() => auditJupiterIxs([sys(1)], { user: USER, maxLamports: 0n }), /Unexpected system instruction/);
});
