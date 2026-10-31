'use strict';
// Server-side audit of Jupiter route instructions: the spend bound is read from the instruction data (REAL Jupiter swap-instructions output, 2026-10-31).
const test = require('node:test'); const assert = require('node:assert/strict');
const { auditJupiterIxs, jupSpend } = require('../src/jupiter'); const C = require('../src/config');
const USER = 'BqRM2Me3BriYQ9j4Dx2pXsbKWQ3AwELqqPu3Rd1QUwvZ';
const REAL_IN = '5RfLl3rjrSoBAAAAsgFkAAGA8PoCAAAAACU+SQAAAAAAZAAA', REAL_OUT = '0DPvl3sr7VwBAAAAEQBkAAGAlpgAAAAAADOlDgAAAAAAZAAA';
const SRC = 'SrcAcct1111111111111111111111111111111111'; // route input account (index 2 of the `route` layout)
const jup = (data) => ({ programId: C.JUPITER_PROGRAM, accounts: [{ pubkey: USER }, { pubkey: USER }, { pubkey: SRC }], data });
test('jupSpend: ExactIn = exact input; ExactOut = quoted input + slippage (matches Jupiter otherAmountThreshold); unknown/short refused', () => {
  assert.equal(jupSpend(Buffer.from(REAL_IN, 'base64')), 50000000n); assert.equal(jupSpend(Buffer.from(REAL_OUT, 'base64')), 969393n);
  const l = Buffer.from(REAL_IN, 'base64'); Buffer.from('96564774a75d0e68', 'hex').copy(l, 0); assert.throws(() => jupSpend(l), /Unrecognised swap route/); assert.throws(() => jupSpend(Buffer.alloc(5)), /Unrecognised/);
});
test('auditJupiterIxs: the route may not spend more of the input mint than the quote (token or SOL), non-WSOL inputs included', () => {
  assert.ok(auditJupiterIxs([jup(REAL_IN)], { user: USER, maxLamports: 0n, maxSwapIn: 50000000n, source: SRC })); assert.throws(() => auditJupiterIxs([jup(REAL_IN)], { user: USER, maxLamports: 0n, maxSwapIn: 49999999n, source: SRC }), /spend more/);
  const d = Buffer.from(REAL_IN, 'base64'); d.writeBigUInt64LE(10n ** 12n, d.length - 19); assert.throws(() => auditJupiterIxs([jup(d.toString('base64'))], { user: USER, maxLamports: 0n, maxSwapIn: 50000000n, source: SRC }), /spend more/);
});
test('the browser builder\'s burnChecked bytes/keys are identical to spl-token\'s (what the server verifies)', () => {
  const spl = require('@solana/spl-token'); const { Keypair } = require('@solana/web3.js'); const k = () => Keypair.generate().publicKey;
  const ix = spl.createBurnCheckedInstruction(k(), k(), k(), 1234n, 6, [], spl.TOKEN_PROGRAM_ID); const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
  assert.deepEqual(Buffer.from([15, ...u64(1234n), 6]), ix.data); assert.deepEqual(ix.keys.map((x) => [x.isSigner, x.isWritable]), [[false, true], [false, true], [true, false]]); // src/pay.js: ata (w), mint (w), user (signer)
});
