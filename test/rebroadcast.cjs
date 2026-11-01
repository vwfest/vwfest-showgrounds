// Browser client re-broadcasts the signed transaction every 2s until confirmed or the blockhash expires; also: pre-sign quote expiry in src/pay.js.
const assert = require('assert'); const path = require('path'); const { pathToFileURL } = require('url'); const fs = require('fs');
(async () => {
  const { sendAndConfirm } = await import(pathToFileURL(path.join(__dirname, '../src/rebroadcast.mjs')).href); let n = 0; const t = async (name, f) => { try { await f(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.stack || e); process.exitCode = 1; } };
  const rig = (o) => { let clock = 0, h = 100; const sends = []; const conn = {
    async sendRawTransaction(raw, opt) { sends.push({ at: clock, opt }); if (o.dropFirstN && sends.length <= o.dropFirstN) return 'SIG'; return 'SIG'; },
    async getSignatureStatuses() { return { value: [o.landAfterSends && sends.length >= o.landAfterSends ? { confirmationStatus: 'confirmed', err: o.err || null } : null] }; },
    async getBlockHeight() { return h; } };
    return { conn, sends, sleep: async (ms) => { clock += ms; h += o.blocksPerSleep || 0; }, now: () => clock, at: () => clock }; };
  await t('re-sends the same signed bytes every 2s while unconfirmed, stops when it lands', async () => {
    const r = rig({ landAfterSends: 4 }); const res = await sendAndConfirm({ conn: r.conn, raw: Buffer.from([1]), lastValidBlockHeight: 10 ** 9, sleep: r.sleep, now: r.now });
    assert.strictEqual(res.sig, 'SIG'); assert.strictEqual(res.sends, 4); assert.deepStrictEqual(r.sends.map((s) => s.at), [0, 2000, 4000, 6000]); assert.strictEqual(r.sends[0].opt.skipPreflight, false, 'first send is pre-flighted'); assert(r.sends.slice(1).every((s) => s.opt.skipPreflight === true)); });
  await t('no re-send once confirmed (confirmed on first poll = exactly one send)', async () => { const r = rig({ landAfterSends: 1 }); const res = await sendAndConfirm({ conn: r.conn, raw: Buffer.from([1]), lastValidBlockHeight: 10 ** 9, sleep: r.sleep, now: r.now }); assert.strictEqual(res.sends, 1); });
  await t('stops re-sending when the blockhash expires and says nothing was spent', async () => {
    const r = rig({ blocksPerSleep: 10 }); await assert.rejects(sendAndConfirm({ conn: r.conn, raw: Buffer.from([1]), lastValidBlockHeight: 150, sleep: r.sleep, now: r.now }), (e) => e.expired === true && /expired/.test(e.message)); const last = r.sends.length; assert(last >= 2 && last <= 8, 'bounded rebroadcasts: ' + last); });
  await t('an on-chain error is surfaced, not retried', async () => { const r = rig({ landAfterSends: 1, err: { InstructionError: [0, 'Custom'] } }); await assert.rejects(sendAndConfirm({ conn: r.conn, raw: Buffer.from([1]), sleep: r.sleep, now: r.now }), /failed on-chain/); });
  await t('a rebroadcast that the RPC rejects (already processed / rate limit) does not abort the wait', async () => {
    const r = rig({ landAfterSends: 3 }); const orig = r.conn.sendRawTransaction; let calls = 0; r.conn.sendRawTransaction = async (raw, opt) => { calls++; const s = await orig(raw, opt); if (calls > 1) throw new Error('429 Too Many Requests'); return s; };
    const res = await sendAndConfirm({ conn: r.conn, raw: Buffer.from([1]), lastValidBlockHeight: 10 ** 9, sleep: r.sleep, now: r.now }); assert.strictEqual(res.sig, 'SIG'); });
  await t('signAndSend/prepare refuse a stale quote before opening the wallet; signAndSend uses the rebroadcaster', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/pay.js'), 'utf8'); assert(/sendAndConfirm\(\{ conn: prep\.conn, raw: signed\.serialize\(\), lastValidBlockHeight: prep\.lastValidBlockHeight/.test(src)); assert(/quote has expired/.test(src.split('export async function signAndSend')[1].split('provider.signTransaction')[0]), 'expiry checked before sign'); assert(/quote has expired/.test(src.split('export async function prepare')[1].split('assertTop')[0]) || /quote has expired/.test(src.split('export async function prepare')[1].slice(0, 400))); });
  if (!process.exitCode) console.log('all rebroadcast tests passed');
})();
