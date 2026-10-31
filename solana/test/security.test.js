'use strict';
// Regression tests for the security review (HIGH 1-2, MED 3-6, LOW 7-9). No validator needed.
const test = require('node:test'); const assert = require('node:assert/strict'); const EventEmitter = require('events'); const { PassThrough } = require('stream');
const nacl = require('tweetnacl'); const { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, TransactionInstruction } = require('@solana/web3.js'); const spl = require('@solana/spl-token');
const C = require('../src/config'); const { Auth } = require('../src/auth'); const { Store } = require('../src/store'); const nft = require('../src/nft'); const audit = require('../src/audit'); const verify = require('../src/verify');
const { Solana } = require('../src/index'); const compat = require('../src/compat'); const SECRET = 'x'.repeat(40);

// ---------- HIGH 1: atomic avatar trait reservation ----------
test('HIGH-1 trait reservation: synchronous put-if-absent, no await window, 2nd wallet refused, same-wallet refresh supersedes', async () => {
  const store = new Store(); const self = { store }; const res = (fp, q) => Solana.prototype._reserveTrait.call(self, fp, q);
  const mk = (id, wallet, extra = {}) => { const q = { id, wallet, expires: Date.now() + 600000, state: 'open', ...extra }; store.set('quote', id, q); return q; };
  const A = 'A'.repeat(32), B = 'B'.repeat(32);
  // 50 "concurrent" wallets race for one fingerprint (each runs in its own microtask): exactly one wins
  const results = await Promise.all(Array.from({ length: 50 }, async (_, i) => { await null; try { res('fp1', mk('q' + i, i % 2 ? A : B + i)); return 'ok'; } catch (e) { return e.message; } }));
  const holder = store.get('trait', 'fp1').wallet; const winners = results.map((r, i) => (r === 'ok' ? (i % 2 ? A : B + i) : null)).filter(Boolean);
  assert.ok(winners.length >= 1); assert.ok(winners.every((w) => w === holder), 'only the holding wallet ever got a payable quote (same-wallet refreshes allowed)');
  if (holder.startsWith(B)) assert.equal(winners.length, 1, 'a B-wallet holder has no refreshes (distinct wallets)');
  // a second wallet cannot take it while held; error is thrown at QUOTE time so it never reaches payment
  assert.throws(() => res('fp1', mk('qx', 'C'.repeat(32))), /Someone else is minting/);
  // same-wallet refresh supersedes the old open quote
  const q1 = mk('r1', A); res('fp2', q1); const q2 = mk('r2', A); res('fp2', q2); assert.equal(store.get('quote', 'r1').state, 'superseded'); assert.equal(store.get('trait', 'fp2').quoteId, 'r2');
  // ...unless a pay tx for the old quote was just built (burn could still land: never strand it)
  const q3 = mk('r3', A); q3.builtAt = Date.now(); store.set('quote', 'r3', q3); res('fp3', q3); assert.throws(() => res('fp3', mk('r4', A)), /payment in progress/);
  assert.equal(store.get('trait', 'fp3').quoteId, 'r3');
  // an expired reservation can be taken over by another wallet
  store.set('trait', 'fp4', { quoteId: 'old', wallet: A, exp: Date.now() - 1, paid: false }); res('fp4', mk('r5', B)); assert.equal(store.get('trait', 'fp4').wallet, B);
  // paid reservations are permanent: nobody (not even the payer, not a refresh) can re-quote
  store.set('trait', 'fp5', { quoteId: 'p', wallet: A, exp: Number.MAX_SAFE_INTEGER, paid: true }); assert.throws(() => res('fp5', mk('r6', B)), /already taken/); assert.throws(() => res('fp5', mk('r7', A)), /already paid/);
  store.set('minted', 'fp6', 1); assert.throws(() => res('fp6', mk('r8', A)), /already been minted/);
});

// ---------- HIGH 2: client audit of Jupiter/wrap amounts ----------
test('HIGH-2 client pay-audit bounds Jupiter/wrap/createAccount lamports and instructions when q.swap', () => {
  const user = Keypair.generate(); const mint = Keypair.generate().publicKey; const cfg = { vwfestMint: mint.toBase58(), devWallet: C.DEV_WALLET };
  const devWallet = Keypair.generate().publicKey.toBase58();
  const q = { id: 'qs1', wallet: user.publicKey.toBase58(), burnMin: '1000', burnRaw: '1000', devLamports: '500000', devTokenRaw: '0', devTokenMint: null, devWallet, swap: true, swapInputMint: C.WSOL, swapInRaw: '4500000' };
  const wsolAta = spl.getAssociatedTokenAddressSync(new PublicKey(C.WSOL), user.publicKey, true); const ata = spl.getAssociatedTokenAddressSync(mint, user.publicKey);
  const memo = new TransactionInstruction({ programId: new PublicKey(C.MEMO_PROGRAM), keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: false }], data: Buffer.from('vwfest:qs1') });
  const build = (ixs) => new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message());
  const dev = SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: new PublicKey(devWallet), lamports: 500000 }); const burn = spl.createBurnCheckedInstruction(ata, mint, user.publicKey, 1000n, 6);
  const wrap = (l) => SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: wsolAta, lamports: l });
  const good = () => [dev, spl.createAssociatedTokenAccountIdempotentInstruction(user.publicKey, wsolAta, user.publicKey, new PublicKey(C.WSOL)), wrap(4500000), spl.createSyncNativeInstruction(wsolAta), burn, memo];
  assert.ok(audit.auditPayTx(build(good()), q, cfg), 'honest swap tx passes');
  assert.throws(() => audit.auditPayTx(build([dev, wrap(4500000 + 20_000_000), burn, memo]), q, cfg), /more SOL/, 'over-wrapping beyond the quote is refused');
  const temp = Keypair.generate(); assert.throws(() => audit.auditPayTx(build([dev, SystemProgram.createAccount({ fromPubkey: user.publicKey, newAccountPubkey: temp.publicKey, lamports: 3_000_000_000, space: 165, programId: spl.TOKEN_PROGRAM_ID }), burn, memo]), q, cfg), /more SOL/, 'huge createAccount refused');
  assert.throws(() => audit.auditPayTx(build([dev, SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 10 }), burn, memo]), q, cfg), /somewhere unexpected/, 'transfer to a stranger refused');
  assert.throws(() => audit.auditPayTx(build([dev, spl.createCloseAccountInstruction(wsolAta, Keypair.generate().publicKey, user.publicKey), burn, memo]), q, cfg), /close an account/, 'closing WSOL to someone else refused');
  assert.throws(() => audit.auditPayTx(build([...good(), spl.createApproveInstruction(ata, Keypair.generate().publicKey, user.publicKey, 1n)]), q, cfg), /token instruction/i, 'approve/delegate refused');
  assert.throws(() => audit.auditPayTx(build([dev, new TransactionInstruction({ programId: new PublicKey(C.JUPITER_PROGRAM), keys: [{ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }], data: Buffer.from([1]) }), burn, memo].slice(0, 2).concat([burn, memo])), { ...q, swap: false }, cfg), /moves SOL|Unexpected swap|unexpected/i, 'swap ix in a non-swap quote refused');
  // non-swap quotes: no stray token plumbing either (closeAccount / approve), no foreign ATA creation
  const qn = { ...q, swap: false, swapInputMint: null, swapInRaw: '0' };
  assert.throws(() => audit.auditPayTx(build([dev, burn, spl.createCloseAccountInstruction(ata, Keypair.generate().publicKey, user.publicKey), memo]), qn, cfg), /token instruction/i);
  assert.throws(() => audit.auditPayTx(build([dev, spl.createAssociatedTokenAccountIdempotentInstruction(user.publicKey, spl.getAssociatedTokenAddressSync(mint, Keypair.generate().publicKey), Keypair.generate().publicKey, mint), burn, memo]), qn, cfg), /account creation/i);
});

// ---------- MED 3 / MED 6: secrets ----------
test('MED-3/6 secrets: compat requires >=32 chars with no padding; Solana has no fallback secret', async () => {
  const base = { MINT_ENABLED: '1', CHAIN_FAKE: '1', DEVNET_VWFEST_MINT: C.VWFEST_MINT };
  const short = await new compat.Facade().init({ env: { ...base, SERVER_SECRET: 'y'.repeat(20) } }); assert.equal(short.config().enabled, false); assert.match(short.config().reason, /SERVER_SECRET/); assert.equal(short.authLib, null, 'no padded Auth for a short secret');
  const ok = await new compat.Facade().init({ env: { ...base, SERVER_SECRET: 'y'.repeat(32) } }); assert.ok(ok.authLib); assert.equal(ok.authLib.secret === 'y'.repeat(32) || !ok.authLib.secret.includes('\0'), true);
  assert.throws(() => new Auth({ store: new Store(), secret: 'y'.repeat(31) }), /SERVER_SECRET/);
  const s = new Solana({ env: {} }); assert.throws(() => s.seedOf('q1'), /SERVER_SECRET/, 'no x.repeat(32) fallback');
  assert.equal(s.ready, false);
  const s2 = new Solana({ env: { SERVER_SECRET: 'q'.repeat(40) } }); assert.equal(s2.seedOf('q1').commit.length, 64);
});

// ---------- MED 4: mint tx name/uri ----------
test('MED-4 mint audit decodes CreateV1 name+uri and requires them to match /tx/mint', () => {
  const wallet = Keypair.generate(), asset = Keypair.generate(), collection = Keypair.generate(), auth = Keypair.generate();
  const name = 'Alice Avatar', uri = 'https://site.test/api/solana/nft/meta/abc';
  const ix = nft.createAssetIx({ asset: asset.publicKey, collection: collection.publicKey, authority: auth.publicKey, payer: wallet.publicKey, owner: wallet.publicKey, name, uri });
  const build = (i) => new VersionedTransaction(new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: '11111111111111111111111111111111', instructions: [i] }).compileToV0Message());
  const args = { wallet: wallet.publicKey.toBase58(), asset: asset.publicKey.toBase58(), collection: collection.publicKey.toBase58(), name, uri };
  assert.deepEqual(audit.decodeCreateV1(ix.data), { name, uri }); assert.ok(audit.auditMintTx(build(ix), args));
  assert.throws(() => audit.auditMintTx(build(ix), { ...args, name: 'Other' }), /do not match/);
  assert.throws(() => audit.auditMintTx(build(ix), { ...args, uri: 'https://evil.test/m.json' }), /do not match/);
  assert.throws(() => audit.auditMintTx(build(ix), { ...args, name: undefined }), /required/);
  const evil = nft.createAssetIx({ asset: asset.publicKey, collection: collection.publicKey, authority: auth.publicKey, payer: wallet.publicKey, owner: wallet.publicKey, name, uri: 'https://evil.test/m.json' });
  assert.throws(() => audit.auditMintTx(build(evil), args), /do not match/, 'tampered uri in the tx is caught');
  const withPlugins = Buffer.concat([Buffer.from(ix.data).subarray(0, ix.data.length - 1), Buffer.from([1, 0, 0, 0])]); assert.throws(() => audit.decodeCreateV1(withPlugins), /plugins|trailing/);
});

// ---------- MED 5: SSRF ----------
test('MED-5 SSRF: IP classification', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::a00:1', 'not-an-ip']) assert.equal(nft.isPublicIp(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(nft.isPublicIp(ip), true, ip);
});
function fakeTransport(routes, seen = []) { // routes: host -> {status, headers, body|stream fn}
  return { request(opts, cb) {
    const req = new EventEmitter(); req.destroy = (e) => { req.destroyed = true; if (e) setImmediate(() => req.emit('error', e)); }; req.setTimeout = () => {};
    req.end = () => { seen.push(opts); const r = routes[opts.hostname]; if (!r) return setImmediate(() => req.emit('error', new Error('ENOTFOUND')));
      // emulate the pinned lookup the real socket would run
      opts.lookup(opts.hostname, {}, (err) => { if (err) return setImmediate(() => req.emit('error', err));
        if (r.hang) return; const res = new PassThrough(); res.statusCode = r.status || 200; res.headers = { 'content-type': 'application/json', ...(r.headers || {}) }; res.destroy = () => { res.destroyed = true; };
        setImmediate(() => { cb(res); if (r.chunks) r.chunks.forEach((c) => res.write(c)); else res.write(r.body || '{}'); res.end(); }); }); };
    return req; } };
}
test('MED-5 SSRF: safeGetJson refuses non-https, private literals, private DNS answers, bad redirects, huge bodies, timeouts', async (t) => {
  // use the REAL pinnedLookup logic with an injected resolver by stubbing dns.lookup
  const dns = require('dns'); const realLookup = dns.lookup; dns.lookup = (h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]); t.after(() => { dns.lookup = realLookup; });
  const withDns = async (fn, answer) => { dns.lookup = (h, o, cb) => cb(null, answer); try { return await fn(); } finally { dns.lookup = (h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]); } };
  const ok = { transport: fakeTransport({ 'good.test': { body: '{"image":"https://x/y.png"}' } }) };
  assert.deepEqual(await withDns(() => nft.safeGetJson('https://good.test/m.json', ok), [{ address: '93.184.216.34', family: 4 }]), { image: 'https://x/y.png' });
  await assert.rejects(nft.safeGetJson('http://good.test/m.json', ok), /https only/);
  await assert.rejects(nft.safeGetJson('file:///etc/passwd', ok), /https only/);
  await assert.rejects(nft.safeGetJson('https://169.254.169.254/latest/meta-data', ok), /blocked/);
  await assert.rejects(nft.safeGetJson('https://[::1]/x', ok), /blocked/);
  await assert.rejects(nft.safeGetJson('https://localhost/x', ok), /blocked/); await assert.rejects(nft.safeGetJson('https://metadata.google.internal/x', ok), /blocked/);
  await assert.rejects(nft.safeGetJson('https://good.test:8443/x', ok), /port/); await assert.rejects(nft.safeGetJson('https://u:p@good.test/x', ok), /credentials/);
  await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', ok), [{ address: '10.0.0.5', family: 4 }]), /blocked address/, 'DNS resolving to a private IP');
  await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', ok), [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]), /blocked address/, 'any private answer blocks');
  await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', ok), [{ address: '::ffff:127.0.0.1', family: 6 }]), /blocked address/);
  // redirects re-validated
  const redir = { transport: fakeTransport({ 'good.test': { status: 302, headers: { location: 'https://169.254.169.254/latest' } } }) }; await assert.rejects(nft.safeGetJson('https://good.test/m.json', redir), /blocked/);
  const redir2 = { transport: fakeTransport({ 'good.test': { status: 302, headers: { location: 'http://good.test/x' } } }) }; await assert.rejects(nft.safeGetJson('https://good.test/m.json', redir2), /https only/);
  const loop = { transport: fakeTransport({ 'good.test': { status: 302, headers: { location: 'https://good.test/again' } } }) }; await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', loop), [{ address: '93.184.216.34', family: 4 }]), /too many redirects/);
  // redirect to a hostname that resolves private is blocked by the pinned lookup on the second hop
  const redir3 = { transport: fakeTransport({ 'good.test': { status: 301, headers: { location: 'https://rebind.test/x' } }, 'rebind.test': { body: '{}' } }) };
  let n = 0; dns.lookup = (h, o, cb) => cb(null, h === 'rebind.test' ? [{ address: '192.168.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]); try { await assert.rejects(nft.safeGetJson('https://good.test/m.json', redir3), /blocked address/); } finally { dns.lookup = (h, o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }]); }
  // size cap (header and streamed) + content type + status
  const big = { transport: fakeTransport({ 'good.test': { body: '{}', headers: { 'content-length': '999999' } } }), maxBytes: 1000 }; await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', big), [{ address: '93.184.216.34', family: 4 }]), /too large/);
  const stream = { transport: fakeTransport({ 'good.test': { chunks: ['{"a":"', 'x'.repeat(600), 'x'.repeat(600), '"}'] } }), maxBytes: 1000 }; await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', stream), [{ address: '93.184.216.34', family: 4 }]), /too large/);
  const html = { transport: fakeTransport({ 'good.test': { headers: { 'content-type': 'text/html' }, body: '<html>' } }) }; await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', html), [{ address: '93.184.216.34', family: 4 }]), /not json/);
  const nf = { transport: fakeTransport({ 'good.test': { status: 500 } }) }; await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', nf), [{ address: '93.184.216.34', family: 4 }]), /http 500/);
  // timeout
  const slow = { transport: fakeTransport({ 'good.test': { hang: true } }), timeoutMs: 80 }; const t0 = Date.now(); await assert.rejects(withDns(() => nft.safeGetJson('https://good.test/m.json', slow), [{ address: '93.184.216.34', family: 4 }]), /timeout/); assert.ok(Date.now() - t0 < 2000);
  // allowlist + ipfs mapping
  await assert.rejects(nft.safeGetJson('https://good.test/m.json', { ...ok, allowHosts: ['arweave.net'] }), /host not allowed/);
  const seen = []; await withDns(() => nft.safeGetJson('ipfs://bafy123/meta.json', { transport: fakeTransport({ 'gateway.pinata.cloud': { body: '{}' } }, seen) }), [{ address: '93.184.216.34', family: 4 }]); assert.equal(seen[0].path, '/ipfs/bafy123/meta.json');
});

// ---------- LOW 7: burnChecked only ----------
test('LOW-7 unchecked burn is not accepted (verify.js and compat.js)', () => {
  const w = Keypair.generate().publicKey.toBase58(); const mint = Keypair.generate().publicKey.toBase58();
  const tx = (type, info) => ({ blockTime: 1, slot: 1, meta: { err: null }, transaction: { signatures: ['s'], message: { accountKeys: [{ pubkey: w, signer: true }], instructions: [{ program: 'spl-token', programId: C.TOKEN_PROGRAM, parsed: { type, info: { mint, authority: w, ...info } } }, { program: 'spl-memo', parsed: 'vwfest:q1' }] } } });
  const q = { id: 'q1', wallet: w, devWallet: C.DEV_WALLET, burnMin: '100', devLamports: '0', devTokenRaw: '0', devTokenMint: null };
  assert.equal(verify.inspectPayTx(tx('burnChecked', { tokenAmount: { amount: '150' } }), q, { vwfestMint: mint }).ok, true);
  assert.match(verify.inspectPayTx(tx('burn', { amount: '150' }), q, { vwfestMint: mint }).why, /No \$VWFEST burn/);
  assert.equal(compat.inspect(tx('burnChecked', { tokenAmount: { amount: '150' } }), { mint, nonce: 'q1', wallet: w, burnMin: 100n }).ok, true);
  assert.match(compat.inspect(tx('burn', { amount: '150' }), { mint, nonce: 'q1', wallet: w, burnMin: 100n }).why, /No \$VWFEST burn/);
});

// ---------- LOW 8: session revocation ----------
test('LOW-8 logout revokes the session token (denylist), other sessions unaffected, survives via the store', () => {
  let now = 1e12; const store = new Store(); const a = new Auth({ store, secret: SECRET, allowedDomains: ['site.test'], now: () => now });
  const kp = Keypair.generate(); const w = kp.publicKey.toBase58(); const issue = () => a.issue(w);
  const t1 = issue(), t2 = issue(); const tok = (t) => (typeof t === 'string' ? t : t.token);
  assert.ok(a.session(tok(t1)) && a.session(tok(t2)));
  assert.equal(a.revoke(tok(t1)), true); assert.equal(a.session(tok(t1)), null, 'revoked token refused'); assert.ok(a.session(tok(t2)), 'other session still valid');
  assert.equal(a.revoke('garbage'), false);
  const a2 = new Auth({ store, secret: SECRET, allowedDomains: ['site.test'], now: () => now }); assert.equal(a2.session(tok(t1)), null, 'denylist lives in the (persisted) store');
  now += 13 * 3600 * 1000; a.revoke(tok(t2)); assert.equal(store.entries('revoked').length <= 1, true, 'expired denylist entries are pruned');
});
