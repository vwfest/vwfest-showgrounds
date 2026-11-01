'use strict';
// Quote expiry is checked against the BURN's block time; replay protection must be durable (no purchases without a database in production/mainnet; pause + retry when a write fails).
const test = require('node:test'); const assert = require('node:assert/strict'); const { inspect, EXPIRY_GRACE_MS, Facade } = require('../src/compat'); const { Store } = require('../src/store');
const MINT = '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', W = 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok';
const tx = (blockTime, { memo = 'vwfest:q1', burn = 150 } = {}) => ({ blockTime, slot: 1, meta: { err: null }, transaction: { signatures: ['s'], message: { accountKeys: [{ pubkey: W, signer: true }], instructions: [{ program: 'spl-token', programId: 'x', parsed: { type: 'burnChecked', info: { mint: MINT, authority: W, tokenAmount: { amount: String(burn) } } } }, { program: 'spl-memo', parsed: memo }] } } });
const base = { mint: MINT, nonce: 'q1', wallet: W, burnMin: 100n };

test('inspect: a burn is only valid for a quote that was live when it was made (blockTime <= expires + 5 min)', () => {
  const exp = 2_000_000_000_000; const at = (ms) => Math.floor(ms / 1000);
  assert.equal(EXPIRY_GRACE_MS, 5 * 60 * 1000);
  assert.equal(inspect(tx(at(exp - 60_000)), { ...base, expires: exp }).ok, true, 'inside the window');
  assert.equal(inspect(tx(at(exp)), { ...base, expires: exp }).ok, true, 'at expiry');
  assert.equal(inspect(tx(at(exp + EXPIRY_GRACE_MS)), { ...base, expires: exp }).ok, true, 'at the end of the grace');
  const late = inspect(tx(at(exp + EXPIRY_GRACE_MS + 2000)), { ...base, expires: exp }); assert.equal(late.ok, false); assert.equal(late.expired, true); assert.match(late.why, /after its price quote expired/); assert.ok(!late.retry, 'final, not retryable');
  const none = inspect(tx(null), { ...base, expires: exp }); assert.equal(none.ok, false); assert.equal(none.retry, true, 'no block time yet: fail closed but retryable');
  assert.equal(inspect(tx(undefined), { ...base, expires: exp }).ok, false);
  assert.equal(inspect(tx(1), base).ok, true, 'callers that pass no expiry (native flow, unit helpers) are unchanged');
});

test('Store: a write the backend refuses is kept, retried until it lands, and the store is `degraded` meanwhile', async () => {
  let fail = true; const writes = []; const backend = { async write(ns, k, v) { if (fail) throw new Error('db down'); writes.push([ns, k, v]); } };
  const s = new Store(backend, { retryMs: 20 }); const log = console.error; console.error = () => {};
  try {
    assert.equal(s.durable, true); assert.equal(s.degraded, false); s.reserve('burn', 'sig1', { a: 1 }); await s.flush(); assert.equal(s.degraded, true, 'degraded after a refused write'); assert.equal(s.has('burn', 'sig1'), true, 'memory still has it (replay protection keeps working)');
    s.set('burn', 'sig1', { a: 2 }); await s.flush(); assert.equal(s.failed.size, 1, 'one entry per key (the latest value)');
    fail = false; await new Promise((r) => setTimeout(r, 120)); assert.equal(s.degraded, false, 'recovered'); assert.deepEqual(writes.at(-1), ['burn', 'sig1', { a: 2 }], 'the LATEST value was written, not the stale one');
    fail = true; s.set('x', 'k', 1); await s.flush(); fail = false; s.set('x', 'k', 2); await s.flush(); await new Promise((r) => setTimeout(r, 80)); assert.equal(s.degraded, false); assert.deepEqual(writes.filter((w) => w[0] === 'x').at(-1), ['x', 'k', 2], 'a later good write is never overwritten by an older failed one');
  } finally { console.error = log; await s.close(); }
  assert.equal(new Store(null).durable, false); assert.equal(new Store(null).degraded, false);
});

const env = (o) => ({ MINT_ENABLED: '1', VWFEST_MINT: MINT, DEV_WALLET: W, SERVER_SECRET: 'z'.repeat(40), FIXED_SOL_USD: '100', ...o });
const pool = (rows = []) => ({ async query(q) { if (/SELECT ns,k,v/i.test(q)) return { rows }; return { rows: [] }; } });
test('purchases are NOT armed on mainnet or in production without a working database; devnet/dev without one is allowed (memory only)', async () => {
  const prod = await new Facade().init({ env: env({ MINT_NETWORK: 'devnet', NODE_ENV: 'production' }), db: null }); assert.equal(prod.config().enabled, false); assert.match(prod.config().reason, /database is required/);
  const prodDb = await new Facade().init({ env: env({ MINT_NETWORK: 'devnet', NODE_ENV: 'production' }), db: pool() }); assert.equal(prodDb.config().enabled, true, 'production + database: armed');
  const dev = await new Facade().init({ env: env({ MINT_NETWORK: 'devnet' }), db: null }); assert.equal(dev.config().enabled, true, 'devnet without a database is fine (memory only)');
  const m = await new Facade().init({ env: env({ MINT_NETWORK: 'mainnet-beta', MINT_MAINNET: '1', MAINNET_ARMED: '1' }), db: null }); assert.equal(m.config().enabled, false); assert.match(m.config().reason || '', /database is required/, 'armed on mainnet but no database');
  const m2 = await new Facade().init({ env: env({ MINT_NETWORK: 'mainnet-beta', MINT_MAINNET: '1', MAINNET_ARMED: '1' }), db: pool() }); assert.equal(m2.config().enabled, true, 'mainnet + armed + database: on');
});
test('verifyPurchase fails closed while the database refuses writes, and credits only what a restart cannot lose', async () => {
  let fail = false; const writes = []; const db = { async query(q, p) { if (/SELECT ns,k,v/i.test(q)) return { rows: [] }; if (/INSERT INTO .*solana_kv/i.test(q)) { if (fail) throw new Error('db down'); writes.push(p); } return { rows: [] }; } };
  const F = await new Facade().init({ env: env({ MINT_NETWORK: 'devnet', CHAIN_FAKE: '1' }), db }); assert.equal(F.fake, true); assert.equal(F.store.retryMs, 3000); F.store.retryMs = 20; const log = console.error; console.error = () => {};
  const sig = (c) => c.repeat(88);
  try {
    const ok = await F.verifyPurchase({ sig: sig('A'), nonce: 'qa', pid: 'p1', nick: 'n', kind: 'shop', item: 'halo', expect: { burnMin: 1n, wallet: 'W1' } }); assert.equal(ok.ok, true); assert.ok(writes.length >= 1, 'the record was written before the credit was returned');
    fail = true; const bad = await F.verifyPurchase({ sig: sig('B'), nonce: 'qb', pid: 'p1', nick: 'n', kind: 'shop', item: 'top_hat', expect: { burnMin: 1n, wallet: 'W1' } });
    assert.equal(bad.ok, false); assert.equal(bad.retry, true); assert.equal(bad.paused, true, 'not credited: the record could not be saved'); assert.equal(F.degraded, true); assert.equal(F.config().enabled, false); assert.match(F.config().reason, /paused/);
    const next = await F.verifyPurchase({ sig: sig('C'), nonce: 'qc', pid: 'p2', nick: 'n', kind: 'shop', item: 'halo', expect: { burnMin: 1n, wallet: 'W2' } }); assert.equal(next.paused, true, 'new purchases are refused while degraded');
    const again = await F.verifyPurchase({ sig: sig('B'), nonce: 'qb', pid: 'p1', nick: 'n', kind: 'shop', item: 'top_hat', expect: { burnMin: 1n, wallet: 'W1' } }); assert.equal(again.paused, true, 'even the retry of the unsaved one waits');
    fail = false; await new Promise((r) => setTimeout(r, 150)); assert.equal(F.degraded, false, 'recovered');
    const rec = F.ledgerRec(sig('B')); assert.ok(rec && rec.quoteId === 'qb', 'the in-memory record survived and is what the retry re-delivers');
    const dup = await F.verifyPurchase({ sig: sig('B'), nonce: 'qb', pid: 'p1', nick: 'n', kind: 'shop', item: 'top_hat', expect: { burnMin: 1n, wallet: 'W1' } }); assert.equal(dup.dup, true, 'after recovery the retry is a duplicate -> the server re-runs the idempotent grant from the ledger');
    assert.ok(writes.some((w) => String(w[1]) === sig('B')), 'and it WAS persisted by the retry loop');
  } finally { console.error = log; await F.store.close(); }
});
