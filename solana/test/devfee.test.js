'use strict';
// Creator fee on SOL / other-token payments is EXACTLY 50% to DEV_WALLET (the other 50% is swapped to $VWFEST and burned): defaults, caps, quote split, and the on-chain validator (accepts 50%, rejects any other split).
const test = require('node:test'); const assert = require('node:assert/strict');
const C = require('../src/config'); const Q = require('../src/quotes'); const { inspect } = require('../src/compat');
const MINT = C.VWFEST_MINT, DEV = C.DEV_WALLET, USER = 'BqRM2Me3BriYQ9j4Dx2pXsbKWQ3AwELqqPu3Rd1QUwvZ';
const P = { solUsd: 100, vwfestUsd: 0.00002 };
test('default creator fee is 50%, env can lower it but never raise it above 50', () => {
  assert.equal(C.DEFAULT_DEV_FEE_PCT, 50); assert.equal(C.loadConfig({}).devFeePct, 50); assert.equal(C.loadConfig({ DEV_FEE_PCT: '80' }).devFeePct, 50); assert.equal(C.loadConfig({ DEV_FEE_PCT: '20' }).devFeePct, 20); assert.equal(C.DEV_WALLET, 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok'); assert.equal(C.loadConfig({}).devWallet, DEV); });
test('quote split: 50% of a SOL payment to DEV_WALLET and 50% swapped+burned; $VWFEST payments burn 100% with no creator fee', () => {
  const cfg = C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta' });
  for (const kind of ['avatar', 'vendor']) { const s = Q.breakdown(cfg, { kind, method: 'sol', prices: P }); assert.equal(s.devPct, 50, kind); assert.equal(s.devWallet, DEV); assert.equal(BigInt(s.devLamports) * 2n, BigInt(s.devLamports) + BigInt(s.swapInRaw), kind + ': dev == swap (50/50)'); assert(BigInt(s.devLamports) > 0n); }
  const v = Q.breakdown(cfg, { kind: 'vendor', method: 'vwfest', prices: P }); assert.equal(v.devPct, 0); assert.equal(v.devLamports, '0'); });
const tx = (devLamports, { burn = 1000n, to = DEV, extraDev = 0n } = {}) => ({ blockTime: 1, slot: 1, meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: USER, signer: true }],
  instructions: [{ program: 'spl-memo', parsed: 'vwfest:qX' }, { program: 'spl-token', parsed: { type: 'burnChecked', info: { mint: MINT, authority: USER, tokenAmount: { amount: String(burn) } } } },
    ...(devLamports > 0n ? [{ program: 'system', parsed: { type: 'transfer', info: { source: USER, destination: to, lamports: Number(devLamports) } } }] : []), ...(extraDev ? [{ program: 'system', parsed: { type: 'transfer', info: { source: USER, destination: DEV, lamports: Number(extraDev) } } }] : [])] } } });
test('server-side verification of the burn tx: the quoted 50% creator fee is accepted; 49%/51%-style deviations and a hidden fee on a fee-free purchase are rejected', () => {
  const total = 100_000_000n, quoted = total / 2n, devMin = quoted * 99n / 100n; const chk = (t) => inspect(t, { mint: MINT, nonce: 'qX', devWallet: DEV, burnMin: 1000n, devMin });
  assert.equal(chk(tx(quoted)).ok, true, 'exactly 50%'); assert.equal(chk(tx(quoted * 1005n / 1000n)).ok, true, 'within the 1% rounding band');
  assert.match(chk(tx(total * 40n / 100n)).why, /lower than the quote/); assert.match(chk(tx(total * 49n / 100n - total / 100n)).why, /lower than the quote/); assert.match(chk(tx(0n)).why, /lower than the quote/);
  assert.match(chk(tx(total * 60n / 100n)).why, /higher than the quote/); assert.match(chk(tx(total * 90n / 100n)).why, /higher than the quote/, 'the old 90/10 split inverted is refused too'); assert.match(chk(tx(quoted, { extraDev: quoted })).why, /higher than the quote/, 'two transfers cannot add up past the quote');
  assert.equal(chk(tx(quoted, { to: 'SomeoneElse1111111111111111111111111111111' })).ok, false, 'fee sent to another wallet does not count');
  const free = (t) => inspect(t, { mint: MINT, nonce: 'qX', devWallet: DEV, burnMin: 1000n, devMin: 0n }); assert.equal(free(tx(0n)).ok, true); assert.match(free(tx(5_000n)).why, /no creator fee/); });
