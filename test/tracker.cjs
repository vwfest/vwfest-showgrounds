// Burn tracker: what it reads (ledger written by verified purchases) + the on-chain fallback for burns made outside the game + cluster isolation of persisted rows.
const assert = require('assert'); const os = require('os'); const fs = require('fs'); const path = require('path');
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.stack || e); process.exitCode = 1; } };
const MINT = '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', W = 'BqRM2Me3BriYQ9j4Dx2pXsbKWQ3AwELqqPu3Rd1QUwvZ', OTHER = 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok';
const sig = (c) => c.repeat(88);
const btx = ({ memo, mint = MINT, auth = W, amount = '5000000', err = null, checked = true } = {}) => ({ blockTime: 1_790_000_000, meta: { err }, transaction: { message: { accountKeys: [{ pubkey: W, signer: true }], instructions: [
  ...(memo ? [{ program: 'spl-memo', parsed: memo }] : []), { program: 'spl-token', parsed: checked ? { type: 'burnChecked', info: { mint, authority: auth, tokenAmount: { amount } } } : { type: 'burn', info: { mint, authority: auth, amount } } }] } } });
(async () => {
  const { Burns } = require('../lib/burns'); const mk = (network = 'mainnet-beta') => new Burns({ network, mint: MINT, decimals: 6, rpcUrl: 'x', explorer: (i) => 'https://solscan.io/tx/' + i, base: 'https://s.test' });
  await t('the /api/burns ledger reads ONLY burns the server verified (record/submit); an outside burn is invisible without the fallback', () => { const b = mk(); assert.strictEqual(b.summary().count, 0); });
  await t('on-chain fallback: lists burns of the mint from a watched wallet, skips failed txs, other mints, non-burns and the game\'s own purchase burns (memo vwfest:), records each signature once', async () => {
    const b = mk(); const txs = { [sig('1')]: btx(), [sig('2')]: btx({ memo: 'vwfest:qABC' }), [sig('3')]: btx({ mint: 'So11111111111111111111111111111111111111112' }), [sig('4')]: btx({ amount: '7', checked: false }) }; let sigCalls = 0, txCalls = 0;
    b.rpc = async (m, p) => { if (m === 'getSignaturesForAddress') { sigCalls++; assert.strictEqual(p[0], W); return [sig('1'), sig('2'), sig('3'), sig('4'), sig('5')].map((s) => ({ signature: s, err: s === sig('5') ? { InstructionError: [0, 'x'] } : null })); } txCalls++; return txs[p[0]] || null; };
    assert.strictEqual(await b.syncOnchain([W, W, 'not-a-key']), 2); assert.strictEqual(b.list.length, 2); assert.deepStrictEqual(b.list.map((x) => x.sig).sort(), [sig('1'), sig('4')].sort()); assert(b.list.every((x) => x.kind === 'external' && x.wallet === W && !x.pid && x.network === 'mainnet-beta'));
    const s = b.summary(); assert.strictEqual(s.count, 2); assert(s.recent.every((r) => r.what === 'burn')); assert.strictEqual(s.totalBurned, 5.000007); assert.strictEqual(b.forProfile('anyone').length, 0, 'no profile gets credit');
    const before = txCalls; assert.strictEqual(await b.syncOnchain([W]), 0); assert.strictEqual(txCalls, before, 'known / skipped signatures are not fetched again'); });
  await t('the game purchase path is NOT blocked by the fallback: a purchase burn recorded after a sync still records and grants once', async () => {
    const b = mk(); b.rpc = async (m, p) => (m === 'getSignaturesForAddress' ? [{ signature: sig('9'), err: null }] : btx({ memo: 'vwfest:qXYZ' })); assert.strictEqual(await b.syncOnchain([W]), 0);
    assert.strictEqual(b.record({ kind: 'shop', item: 'halo', pid: 'p', sig: sig('9'), wallet: W, amount: '5', devLamports: '0', nick: 'n' }), true); assert.strictEqual(b.list.length, 1); assert.strictEqual(b.list[0].kind, 'shop'); });
  await t('bounded work and no throw: RPC failures are swallowed, at most maxTx transactions are fetched per run', async () => {
    const b = mk(); b.rpc = async () => { throw new Error('rpc down'); }; assert.strictEqual(await b.syncOnchain([W]), 0);
    const many = Array.from({ length: 20 }, (_, i) => ({ signature: String.fromCharCode(65 + i).repeat(88), err: null })); let fetched = 0; b.rpc = async (m) => { if (m === 'getSignaturesForAddress') return many; fetched++; return btx({ memo: 'vwfest:q' }); }; await b.syncOnchain([W], { maxTx: 8 }); assert.strictEqual(fetched, 8); });
  await t('persisted rows are tagged with their cluster and a database shared with devnet tests never shows them on mainnet (and the reverse)', async () => {
    let pg; try { pg = require('@electric-sql/pglite'); } catch { console.log('     (pglite not installed: skipped)'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-')); process.env.USE_PGLITE = '1'; process.env.PGLITE_DIR = dir; delete process.env.DATABASE_URL;
    try {
      const dev = mk('devnet'); await dev.init(); assert.strictEqual(dev.record({ kind: 'shop', item: 'a', pid: 'p', sig: sig('7'), wallet: W, amount: '5', devLamports: '0', nick: 'dev' }), true); await new Promise((r) => setTimeout(r, 200)); dev.close && dev.close();
      const main = mk('mainnet-beta'); await main.init(); assert.strictEqual(main.list.length, 0, 'devnet row not shown on mainnet'); main.record({ kind: 'shop', item: 'b', pid: 'p', sig: sig('8'), wallet: W, amount: '9', devLamports: '0', nick: 'main' }); await new Promise((r) => setTimeout(r, 200)); main.close && main.close();
      const dev2 = mk('devnet'); await dev2.init(); assert.deepStrictEqual(dev2.list.map((x) => x.sig), [sig('7')], 'devnet sees only its own'); dev2.close && dev2.close();
    } finally { delete process.env.USE_PGLITE; delete process.env.PGLITE_DIR; fs.rmSync(dir, { recursive: true, force: true }); } });
  await t('/api/burns limit is clamped to 1..50 (0, negative and junk can no longer slice the whole list)', () => { const s = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'); assert(/Math\.min\(Math\.max\(1, Math\.floor\(\+req\.query\.limit\) \|\| 15\), 50\)/.test(s)); const b = mk(); for (let i = 0; i < 5; i++) b.add({ sig: String(i).repeat(88), kind: 'external', wallet: W, amount: '1', ts: i }); const lim = (v) => Math.min(Math.max(1, Math.floor(+v) || 15), 50); assert.strictEqual(b.summary(lim('-3')).recent.length, 1, 'negative clamps to 1 (slice(-(-3)) used to return everything-but-3)'); assert.strictEqual(b.summary(lim('0')).recent.length, 5, '0 -> default 15'); assert.strictEqual(b.summary(lim('1')).recent.length, 1); assert.strictEqual(b.summary(lim('999')).recent.length, 5); });
  console.log(process.exitCode ? 'TRACKER TESTS FAILED' : `all ${n} tracker tests passed`); process.exit(process.exitCode || 0);
})();
