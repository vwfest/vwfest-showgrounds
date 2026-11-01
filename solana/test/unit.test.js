'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('crypto');
const nacl = require('tweetnacl'); const { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, TransactionInstruction } = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const C = require('../src/config'); const Q = require('../src/quotes'); const R = require('../src/rides'); const { Auth } = require('../src/auth'); const { Store, pgBackend } = require('../src/store');
const nft = require('../src/nft'); const onramp = require('../src/onramp'); const jup = require('../src/jupiter'); const audit = require('../src/audit'); const { Prices } = require('../src/prices'); const verify = require('../src/verify');
const SECRET = 'x'.repeat(40);
const P = { solUsd: 100, vwfestUsd: 0.00002 };

test('constants: mint + dev wallet', () => {
  assert.equal(C.VWFEST_MINT, '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump'); assert.equal(C.DEV_WALLET, 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok');
  assert.ok(C.isKey(C.VWFEST_MINT) && C.isKey(C.DEV_WALLET)); assert.ok(!C.isKey('nope')); assert.ok(!C.isKey('0OIl' + 'a'.repeat(30)));
});
test('config: defaults to devnet, mainnet disarmed unless MAINNET_ARMED', () => {
  const d = C.loadConfig({}); assert.equal(d.network, 'devnet'); assert.equal(d.mainnet, false);
  const m = C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta' }); assert.equal(m.mainnet, true); assert.equal(m.simulateOnly, true); assert.equal(m.vwfestMint, C.VWFEST_MINT);
  assert.equal(C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta', MAINNET_ARMED: '1' }).simulateOnly, false);
  assert.equal(C.loadConfig({ SOLANA_NETWORK: 'bogus' }).network, 'devnet');
  assert.ok(C.problems(C.loadConfig({})).some((p) => /SERVER_SECRET/.test(p)), 'SERVER_SECRET is mandatory (no random per-boot secret)');
  assert.equal(C.loadConfig({ RPC_URL: 'https://secret.rpc/?key=abc' }).publicRpcUrl, 'https://api.devnet.solana.com', 'private RPC_URL never leaks to the browser config');
});
test('pricing: $VWFEST pays 50% less, burns all, no dev fee', () => {
  const cfg = C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta' });
  const v = Q.breakdown(cfg, { kind: 'avatar', method: 'vwfest', prices: P }); assert.equal(v.paidUsd, 2.5); assert.equal(v.discountPct, 50); assert.equal(v.devPct, 0); assert.equal(v.devLamports, '0'); assert.equal(BigInt(v.burnRaw), 2.5 / 0.00002 * 1e6 | 0 ? BigInt(Math.ceil(2.5 / 0.00002 * 1e6)) : 0n);
  const s = Q.breakdown(cfg, { kind: 'avatar', method: 'sol', prices: P }); assert.equal(s.discountPct, 0); assert.equal(s.devPct, 50); assert.equal(s.devLamports, String(2.5 / 100 * 1e9)); assert.equal(s.swapInRaw, String(2.5 / 100 * 1e9)); assert.equal(s.devWallet, C.DEV_WALLET);
  const vend = Q.breakdown(cfg, { kind: 'vendor', method: 'vwfest', prices: P }); assert.equal(vend.paidUsd, 30, 'vendor booth has no discount'); assert.equal(vend.discountPct, 0);
  const vs = Q.breakdown(cfg, { kind: 'vendor', method: 'sol', prices: P }); assert.equal(vs.devPct, 50); assert.equal(vs.devLamports, String(15 / 100 * 1e9));
  const shop = Q.breakdown(cfg, { kind: 'shop', usd: 4, method: 'vwfest', prices: P }); assert.equal(shop.paidUsd, 2);
  assert.throws(() => Q.breakdown(cfg, { kind: 'shop', usd: 5000, method: 'sol', prices: P }), /shop price/); assert.throws(() => Q.breakdown(cfg, { kind: 'shop', usd: -1, method: 'sol', prices: P }));
});
test('pricing: MINT_DEV_FEE=0 makes SOL mints 100% buyback; spl pays dev fee in the same token', () => {
  const cfg = C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta', MINT_DEV_FEE: '0' });
  const s = Q.breakdown(cfg, { kind: 'ride', method: 'sol', prices: P }); assert.equal(s.devPct, 0); assert.equal(s.swapInRaw, String(5 / 100 * 1e9)); assert.equal(s.devWallet, null);
  const cfg2 = C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta' }); const t = cfg2.payTokens[0];
  const b = Q.breakdown(cfg2, { kind: 'avatar', method: 'spl', payToken: t, prices: { ...P, tokenUsd: 1 } }); assert.equal(b.swapInRaw, '2500000'); assert.equal(b.devTokenRaw, '2500000'); assert.equal(b.devTokenMint, t.mint); assert.equal(b.devLamports, '0');
});
test('rides: published odds, commit-reveal, verifiable, lowrider Mythics + diamond plates', () => {
  assert.deepEqual(R.ODDS, [55, 25, 12, 6, 2]); assert.equal(R.ODDS.reduce((a, b) => a + b), 100);
  const seed = R.serverSeed(SECRET, 'qabc'); const commit = R.commitOf(seed); assert.equal(commit.length, 64);
  assert.equal(R.serverSeed(SECRET, 'qabc'), seed, 'deterministic from the persistent secret'); assert.notEqual(R.serverSeed('y'.repeat(40), 'qabc'), seed);
  const r = R.rollRide({ seed, sig: 'sig1' }); assert.deepEqual(R.verifyRide({ seed, commit, sig: 'sig1', reroll: r.reroll, spec: r.spec }), { ok: true });
  assert.equal(R.verifyRide({ seed: 'dead', commit, sig: 'sig1', spec: r.spec }).ok, false, 'wrong seed fails the commit');
  assert.equal(R.verifyRide({ seed, commit, sig: 'other', spec: r.spec }).ok, false);
  const N = 40000, c = [0, 0, 0, 0, 0]; let lowMythic = 0, diamondMythic = 0;
  for (let i = 0; i < N; i++) { const s = R.defaultRoll(R.rollBytes(R.finalSeed('seed', 'sig' + i))); c[s.tier]++; if (s.tier === 4) { if (/Lowrider/.test(s.model) && s.stance === 'Lowrider') lowMythic++; if (s.plate === 'DIAMOND') diamondMythic++; } }
  R.ODDS.forEach((p, i) => assert.ok(Math.abs(c[i] / N * 100 - p) < 1.2, `tier ${i} ~${p}% got ${c[i] / N * 100}`));
  assert.equal(lowMythic, c[4], 'every Mythic is a lowrider'); assert.equal(diamondMythic, c[4], 'every Mythic has diamond plates');
  const taken = new Set(); const a = R.rollRide({ seed, sig: 's', taken: (x) => taken.has(x) }); taken.add(a.code); const b = R.rollRide({ seed, sig: 's', taken: (x) => taken.has(x) }); assert.notEqual(a.code, b.code); assert.equal(b.reroll, 1);
  const attrs = R.specAttributes(R.defaultRoll(R.rollBytes('0'.repeat(64)))); assert.ok(attrs.find((x) => x.trait_type === 'Plate').value.startsWith('VWFEST'));
});
test('rides: adapter for the UI worker shared/rides.js', () => {
  let shared; try { shared = require('../../shared/rides'); } catch { return; }
  const ad = R.adaptShared(shared); const spec = ad.roll(R.rollBytes('abc')); assert.ok(ad.attributes(spec).length >= 10); assert.deepEqual(ad.odds, R.ODDS);
});
test('auth: nonce single-use, TTL, wrong wallet, bad sig, tampered session', () => {
  let now = 1e12; const store = new Store(); const a = new Auth({ store, secret: SECRET, allowedDomains: ['site.test'], now: () => now });
  const kp = Keypair.generate(); const w = kp.publicKey.toBase58(); const sign = (m) => Buffer.from(nacl.sign.detached(Buffer.from(m), kp.secretKey)).toString('base64');
  assert.throws(() => a.challenge({ wallet: w, domain: 'evil.test' }), /domain/); assert.throws(() => a.challenge({ wallet: 'bad', domain: 'site.test' }));
  let ch = a.challenge({ wallet: w, domain: 'site.test' }); assert.match(ch.message, /site\.test wants you to sign in/); assert.match(ch.message, new RegExp(ch.nonce));
  const ok = a.verify({ wallet: w, nonce: ch.nonce, signature: sign(ch.message) }); assert.ok(ok.ok); assert.equal(a.session(ok.token).wallet, w);
  assert.equal(a.verify({ wallet: w, nonce: ch.nonce, signature: sign(ch.message) }).ok, false, 'replayed nonce rejected');
  ch = a.challenge({ wallet: w, domain: 'site.test' }); now += 5 * 60 * 1000 + 1; assert.equal(a.verify({ wallet: w, nonce: ch.nonce, signature: sign(ch.message) }).why, 'Challenge expired'); now -= 5 * 60 * 1000 + 1;
  ch = a.challenge({ wallet: w, domain: 'site.test' }); const other = Keypair.generate();
  assert.equal(a.verify({ wallet: other.publicKey.toBase58(), nonce: ch.nonce, signature: sign(ch.message) }).ok, false, 'wallet mismatch'); assert.equal(a.verify({ wallet: w, nonce: ch.nonce, signature: sign(ch.message) }).ok, false, 'nonce burnt even after a failed attempt');
  ch = a.challenge({ wallet: w, domain: 'site.test' }); assert.equal(a.verify({ wallet: w, nonce: ch.nonce, signature: Buffer.from(nacl.sign.detached(Buffer.from('other msg'), kp.secretKey)).toString('base64') }).ok, false, 'signature over a different message');
  const t = ok.token; assert.equal(a.session(t.slice(0, -2) + 'xx'), null); assert.equal(a.session(t.split('.')[0] + '.' + crypto.randomBytes(32).toString('base64url')), null);
  now += 13 * 3600 * 1000; assert.equal(a.session(t), null, 'session expires');
  assert.throws(() => new Auth({ store, secret: 'short' }), /SERVER_SECRET/);
  for (let i = 0; i < 9; i++) a.challenge({ wallet: w, domain: 'site.test' }); assert.ok(store.entries('nonce').filter(([, v]) => v.wallet === w).length <= 5, 'per-wallet pending nonce cap');
});
test('store: reserve is an atomic put-if-absent and replays from the backend', async () => {
  const s = new Store(); assert.equal(s.reserve('sig', 'a', 1), true); assert.equal(s.reserve('sig', 'a', 2), false); assert.equal(s.get('sig', 'a'), 1);
  const log = []; const be = { write: async (ns, k, v) => { log.push([ns, k, v]); }, load: async () => [['x', 'k', 5], ['x', 'gone', 1], ['x', 'gone', null]] }; const s2 = await new Store(be).init(); assert.equal(s2.get('x', 'k'), 5); assert.equal(s2.has('x', 'gone'), false);
  s2.reserve('x', 'n', 9); await s2.flush(); assert.deepEqual(log, [['x', 'n', 9]]);
});
test('store: Postgres TLS is verified (rejectUnauthorized:true), PGSSL=off refused in production', () => {
  const seen = []; const FakePool = class { constructor(o) { seen.push(o); } on() {} }; const pg = { Pool: FakePool };
  const b = pgBackend({ url: 'postgres://x', pg }); assert.equal(seen[0].ssl.rejectUnauthorized, true); assert.equal(b.sslOpt.rejectUnauthorized, true);
  pgBackend({ url: 'postgres://x', ca: Buffer.from('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----').toString('base64'), pg }); assert.match(seen[1].ssl.ca, /BEGIN CERTIFICATE/); assert.equal(seen[1].ssl.rejectUnauthorized, true);
  const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; try { assert.throws(() => pgBackend({ url: 'x', ssl: 'off', pg }), /not allowed in production/); } finally { process.env.NODE_ENV = prev; }
  assert.ok(!/rejectUnauthorized:\s*false/.test(require('fs').readFileSync(require.resolve('../src/store'), 'utf8')), 'no rejectUnauthorized:false anywhere in store.js');
});
test('nft: SVG sanitizer, metadata, deterministic unique asset address, fingerprint', () => {
  nft.checkSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  for (const bad of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"/>', '<svg><foreignObject/></svg>', '<svg><image href="https://evil/x.png"/></svg>', '<svg><a xlink:href="javascript:alert(1)"/></svg>', '<html></html>', '<svg><style>@import url(x)</style></svg>']) assert.throws(() => nft.checkSvg(bad), undefined, bad);
  const f1 = nft.fingerprintOf({ a: 1, b: [1, 2] }), f2 = nft.fingerprintOf({ b: [1, 2], a: 1 }); assert.equal(f1, f2, 'key order does not matter'); assert.notEqual(f1, nft.fingerprintOf({ a: 2, b: [1, 2] }));
  const k1 = nft.assetKeypair(SECRET, 'COL', f1), k2 = nft.assetKeypair(SECRET, 'COL', f1); assert.equal(k1.publicKey.toBase58(), k2.publicKey.toBase58()); assert.notEqual(k1.publicKey.toBase58(), nft.assetKeypair(SECRET, 'COL2', f1).publicKey.toBase58());
  const at = nft.attributesFromTraits({ Hair: 'Red', 'Evil<b>': 'x<y>' }); assert.deepEqual(at.map((x) => x.trait_type), ['Evil b', 'Hair'].map((x) => x === 'Evil b' ? 'Evilb' : x)); assert.equal(nft.safeUrl('javascript:alert(1)'), null); assert.ok(nft.safeUrl('https://x.test/a.png'));
  const cfg = C.loadConfig({}); const m = nft.buildMetadata({ kind: 'ride', cfg, id: 'x', name: 'N', description: 'D', image: 'https://x/i.svg', attributes: [{ trait_type: 'a', value: 'b' }] }); assert.equal(m.collection.name, 'VW Fest Show Grounds Rides'); assert.equal(nft.createAssetIx({ asset: k1.publicKey, collection: k2.publicKey, authority: k1.publicKey, payer: k2.publicKey, owner: k2.publicKey, name: 'n', uri: 'u' }).data[0], 0);
});
test('onramp: MoonPay URL signature, Coinbase JWT (Ed25519 + ES256), Coinbase/Stripe sessions with mock fetch', async () => {
  const cfg = C.loadConfig({ MOONPAY_API_KEY: 'pk_test_1', MOONPAY_SECRET_KEY: 'sk_test_secret', CDP_API_KEY_ID: 'kid1', CDP_API_KEY_SECRET: 'x', STRIPE_SECRET_KEY: 'sk_test_s' }); const env = { STRIPE_PUBLISHABLE_KEY: 'pk_test_s' };
  assert.deepEqual(onramp.providers(cfg, env).map((p) => p.id), ['moonpay', 'coinbase', 'stripe']); assert.deepEqual(onramp.providers(C.loadConfig({}), {}), []);
  const addr = Keypair.generate().publicKey.toBase58(); const mp = await onramp.createSession(cfg, 'moonpay', { address: addr, usd: 5.4, ref: 'r1' }, { env }); const u = new URL(mp.url); assert.equal(u.host, 'buy-sandbox.moonpay.com'); const sig = u.searchParams.get('signature'); const q = mp.url.slice(mp.url.indexOf('?'), mp.url.indexOf('&signature=')); assert.equal(crypto.createHmac('sha256', 'sk_test_secret').update(q).digest('base64'), sig); assert.equal(u.searchParams.get('walletAddress'), addr); assert.equal(u.searchParams.get('lockAmount'), 'true');
  const ed = crypto.generateKeyPairSync('ed25519'); const edPriv = ed.privateKey.export({ format: 'der', type: 'pkcs8' }); const raw = Buffer.concat([edPriv.subarray(16), ed.publicKey.export({ format: 'der', type: 'spki' }).subarray(12)]).toString('base64');
  const j = onramp.cdpJwt({ keyId: 'k', secret: raw }, 'POST', 'api.cdp.coinbase.com', '/platform/v2/onramp/sessions'); const [h, p, s] = j.split('.'); assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'EdDSA'); assert.ok(crypto.verify(null, Buffer.from(h + '.' + p), ed.publicKey, Buffer.from(s, 'base64url'))); assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')).uris, ['POST api.cdp.coinbase.com/platform/v2/onramp/sessions']);
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const pem = ec.privateKey.export({ format: 'pem', type: 'sec1' }); const j2 = onramp.cdpJwt({ keyId: 'k', secret: pem }, 'POST', 'h', '/p'); const [h2, p2, s2] = j2.split('.'); assert.equal(JSON.parse(Buffer.from(h2, 'base64url')).alg, 'ES256'); assert.ok(crypto.verify('sha256', Buffer.from(h2 + '.' + p2), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s2, 'base64url')));
  let seen; const cb = await onramp.createSession(cfg, 'coinbase', { address: addr, usd: 6, ip: '1.2.3.4' }, { env, fetchImpl: async (url, o) => { seen = { url, o }; return { ok: true, json: async () => ({ session: { onrampUrl: 'https://pay.coinbase.com/x' } }) }; } }).catch((e) => e); assert.ok(cb instanceof Error, 'bad CDP key fails safely'); // 'x' is not a valid key
  const cfg2 = C.loadConfig({ CDP_API_KEY_ID: 'k', CDP_API_KEY_SECRET: raw }); const cb2 = await onramp.createSession(cfg2, 'coinbase', { address: addr, usd: 6, ip: '1.2.3.4' }, { fetchImpl: async (url, o) => { seen = { url, o }; return { ok: true, json: async () => ({ session: { onrampUrl: 'https://pay.coinbase.com/x' } }) }; } }); assert.equal(cb2.url, 'https://pay.coinbase.com/x'); const body = JSON.parse(seen.o.body); assert.equal(body.destinationNetwork, 'solana'); assert.equal(body.destinationAddress, addr); assert.match(seen.o.headers.authorization, /^Bearer ey/);
  const st = await onramp.createSession(cfg, 'stripe', { address: addr, usd: 6 }, { env, fetchImpl: async (url, o) => { seen = { url, o }; return { ok: true, json: async () => ({ client_secret: 'cos_secret_1' }) }; } }); assert.equal(st.clientSecret, 'cos_secret_1'); assert.match(String(seen.o.body), /wallet_addresses%5Bsolana%5D=/); assert.equal(st.publishableKey, 'pk_test_s');
  await assert.rejects(onramp.createSession(cfg, 'moonpay', { address: 'bad', usd: 5 }, { env })); await assert.rejects(onramp.createSession(cfg, 'moonpay', { address: addr, usd: 5000 }, { env })); await assert.rejects(onramp.createSession(C.loadConfig({}), 'moonpay', { address: addr, usd: 5 }));
});
test('jupiter audit: rejects unknown programs, token transfers, SOL overspend, foreign accounts', () => {
  const user = Keypair.generate().publicKey.toBase58(); const wsolAta = spl.getAssociatedTokenAddressSync(new PublicKey(C.WSOL), new PublicKey(user), true).toBase58();
  const data = (b) => Buffer.from(b).toString('base64'); const sysTransfer = (lamports, dest) => { const d = Buffer.alloc(12); d.writeUInt32LE(2, 0); d.writeBigUInt64LE(BigInt(lamports), 4); return { programId: SystemProgram.programId.toBase58(), accounts: [{ pubkey: user }, { pubkey: dest }], data: data(d) }; };
  assert.ok(jup.auditJupiterIxs([sysTransfer(1000, wsolAta), { programId: C.TOKEN_PROGRAM, accounts: [{ pubkey: wsolAta }], data: data([17]) }, { programId: C.JUPITER_PROGRAM, accounts: [], data: data([1, 2]) }], { user, maxLamports: 5000n }));
  assert.throws(() => jup.auditJupiterIxs([{ programId: 'Evil1111111111111111111111111111111111111111', accounts: [], data: data([0]) }], { user, maxLamports: 0n }), /unexpected program/);
  assert.throws(() => jup.auditJupiterIxs([sysTransfer(1000, Keypair.generate().publicKey.toBase58())], { user, maxLamports: 5000n }), /somewhere unexpected/);
  assert.throws(() => jup.auditJupiterIxs([sysTransfer(9000, wsolAta)], { user, maxLamports: 5000n }), /more SOL/);
  assert.throws(() => jup.auditJupiterIxs([{ programId: C.TOKEN_PROGRAM, accounts: [], data: data([3, 1, 0, 0, 0, 0, 0, 0, 0]) }], { user, maxLamports: 0n }), /token instruction/);
  assert.throws(() => jup.auditJupiterIxs([{ programId: C.TOKEN_PROGRAM, accounts: [{ pubkey: wsolAta }, { pubkey: Keypair.generate().publicKey.toBase58() }], data: data([9]) }], { user, maxLamports: 0n }), /close an account/);
  assert.throws(() => jup.auditJupiterIxs([{ programId: C.ATA_PROGRAM, accounts: [{}, {}, { pubkey: Keypair.generate().publicKey.toBase58() }], data: data([1]) }], { user, maxLamports: 0n }), /someone else/);
});
test('prices: fallback chain + deviation guard', async () => {
  const cfg = C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta' }); const mk = (m) => async (url) => { const k = Object.keys(m).find((x) => url.includes(x)); if (!k || m[k] === null) throw new Error('down'); return { ok: true, json: async () => m[k] }; };
  let p = new Prices(cfg, mk({ 'jup.ag/price': null, 'coinbase.com': { data: { amount: '150.5' } } })); assert.deepEqual(await p.solUsd().then((x) => [x.usd, x.src]), [150.5, 'coinbase']);
  p = new Prices(cfg, mk({ 'jup.ag/price': null, 'coinbase.com': null, 'kraken.com': { result: { SOLUSD: { c: ['140.1'] } } } })); assert.equal((await p.solUsd()).src, 'kraken');
  p = new Prices(cfg, mk({ 'jup.ag/price': null, 'coinbase.com': null, 'kraken.com': null })); await assert.rejects(p.solUsd(), /unavailable/);
  const sol = C.WSOL, vw = cfg.vwfestMint;
  const good = { [`price/v3?ids=${sol}`]: { [sol]: { usdPrice: 100 } }, [`price/v3?ids=${vw}`]: { [vw]: { usdPrice: 0.00002 } }, 'swap/v1/quote': { outAmount: String(Math.round(0.1 * 100 / 0.00002 * 1e6)) } };
  p = new Prices(cfg, mk(good)); const v = await p.vwfestUsd(); assert.ok(Math.abs(v.usd - 0.00002) < 1e-9); assert.equal(v.src, 'jupiter-quote+price');
  p = new Prices(cfg, mk({ ...good, [`price/v3?ids=${vw}`]: { [vw]: { usdPrice: 0.00004 } } })); await assert.rejects(p.vwfestUsd(), /disagree/);
  const t = new Prices(C.loadConfig({}), mk({})); assert.equal((await t.vwfestUsd()).usd, 0.1, 'devnet fixed rate');
});
test('audit: pay tx must match the quote (payer, memo, burn, dev fee)', () => {
  const user = Keypair.generate(); const mint = Keypair.generate().publicKey; const cfg = { vwfestMint: mint.toBase58(), devWallet: C.DEV_WALLET };
  const q = { id: 'qaaaa', wallet: user.publicKey.toBase58(), burnMin: '1000', burnRaw: '1000', devLamports: '500', devTokenRaw: '0', devTokenMint: null, devWallet: C.DEV_WALLET, swap: false };
  const ata = spl.getAssociatedTokenAddressSync(mint, user.publicKey); const memo = (t) => new TransactionInstruction({ programId: new PublicKey(C.MEMO_PROGRAM), keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(t) });
  const build = (ixs, payer = user.publicKey) => new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message());
  const good = () => [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: new PublicKey(C.DEV_WALLET), lamports: 500 }), spl.createBurnCheckedInstruction(ata, mint, user.publicKey, 1000n, 6), memo('vwfest:qaaaa')];
  assert.ok(audit.auditPayTx(build(good()), q, cfg));
  assert.throws(() => audit.auditPayTx(build(good(), Keypair.generate().publicKey), q, cfg), /fee payer/);
  assert.throws(() => audit.auditPayTx(build([good()[0], spl.createBurnCheckedInstruction(ata, mint, user.publicKey, 999n, 6), memo('vwfest:qaaaa')]), q, cfg), /lower than your quote/);
  assert.throws(() => audit.auditPayTx(build([good()[0], good()[1], memo('vwfest:qOTHER')]), q, cfg), /Memo/);
  assert.throws(() => audit.auditPayTx(build([good()[1], memo('vwfest:qaaaa')]), q, cfg), /Creator fee/);
  assert.throws(() => audit.auditPayTx(build([SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: new PublicKey(C.DEV_WALLET), lamports: 5000 }), good()[1], memo('vwfest:qaaaa')]), q, cfg), /higher than/);
  assert.throws(() => audit.auditPayTx(build([...good(), SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })]), q, cfg), /moves SOL|unexpected/i);
  assert.throws(() => audit.auditPayTx(build([good()[0], spl.createBurnInstruction(ata, mint, user.publicKey, 1000n), memo('vwfest:qaaaa')]), q, cfg), /Unchecked burn/);
  assert.throws(() => audit.auditPayTx(build([good()[0], spl.createBurnCheckedInstruction(ata, Keypair.generate().publicKey, user.publicKey, 1000n, 6), memo('vwfest:qaaaa')]), q, cfg), /Burn instruction does not match/);
  assert.throws(() => audit.auditPayTx(build([...good(), spl.createTransferInstruction(ata, spl.getAssociatedTokenAddressSync(mint, Keypair.generate().publicKey), user.publicKey, 5n)]), q, cfg), /token instruction/i);
});
test('verify.inspectPayTx: parsed-tx checks (signer, memo, burn, dev fee, no CPI tricks)', () => {
  const w = Keypair.generate().publicKey.toBase58(); const mint = Keypair.generate().publicKey.toBase58(); const cfg = { vwfestMint: mint };
  const q = { id: 'q1', wallet: w, devWallet: C.DEV_WALLET, burnMin: '100', devLamports: '1000', devTokenRaw: '0', devTokenMint: null };
  const tx = (o = {}) => ({ blockTime: 1, slot: 1, meta: { err: null, innerInstructions: o.inner || [] }, transaction: { signatures: ['s'], message: { accountKeys: [{ pubkey: o.payer || w, signer: true }], instructions: o.ixs || [
    { program: 'system', parsed: { type: 'transfer', info: { source: w, destination: C.DEV_WALLET, lamports: 1000 } } }, { program: 'spl-token', programId: C.TOKEN_PROGRAM, parsed: { type: 'burnChecked', info: { mint, authority: w, tokenAmount: { amount: '150' } } } }, { program: 'spl-memo', parsed: 'vwfest:q1' }] } } });
  assert.equal(verify.inspectPayTx(tx(), q, cfg).ok, true);
  assert.equal(verify.inspectPayTx(tx({ payer: Keypair.generate().publicKey.toBase58() }), q, cfg).ok, false);
  assert.equal(verify.inspectPayTx(null, q, cfg).retry, true);
  const failed = tx(); failed.meta.err = {}; assert.match(verify.inspectPayTx(failed, q, cfg).why, /failed/);
  const lessBurn = tx(); lessBurn.transaction.message.instructions[1].parsed.info.tokenAmount.amount = '99'; assert.match(verify.inspectPayTx(lessBurn, q, cfg).why, /lower/);
  const wrongMint = tx(); wrongMint.transaction.message.instructions[1].parsed.info.mint = Keypair.generate().publicKey.toBase58(); assert.match(verify.inspectPayTx(wrongMint, q, cfg).why, /No \$VWFEST burn/);
  const wrongAuth = tx(); wrongAuth.transaction.message.instructions[1].parsed.info.authority = Keypair.generate().publicKey.toBase58(); assert.match(verify.inspectPayTx(wrongAuth, q, cfg).why, /No \$VWFEST burn/);
  const noDev = tx(); noDev.transaction.message.instructions.shift(); assert.match(verify.inspectPayTx(noDev, q, cfg).why, /creator fee/i);
  const badMemo = tx(); badMemo.transaction.message.instructions[2].parsed = 'vwfest:q2'; assert.match(verify.inspectPayTx(badMemo, q, cfg).why, /memo/i);
  const inner = tx({ ixs: [{ program: 'spl-memo', parsed: 'vwfest:q1' }], inner: [{ index: 0, instructions: [{ program: 'spl-token', parsed: { type: 'burnChecked', info: { mint, authority: w, tokenAmount: { amount: '150' } } } }] }] }); assert.match(verify.inspectPayTx(inner, { ...q, devLamports: '0' }, cfg).why, /No \$VWFEST burn/, 'burn hidden in a CPI does not count');
  assert.ok(!verify.isSig('abc'));
});

test('config: MAINNET_AUTHORITY_SECRET_KEY loads on mainnet only (JSON array or base58); a devnet deploy never picks it up', () => {
  const kp = Keypair.generate(); const json = JSON.stringify(Array.from(kp.secretKey)); const b58 = require('bs58'); const enc = (b58.default || b58).encode(kp.secretKey);
  for (const v of [json, enc]) {
    const m = C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta', MAINNET_AUTHORITY_SECRET_KEY: v }); assert.equal(m.authority.publicKey.toBase58(), kp.publicKey.toBase58()); assert.equal(m.simulateOnly, true, 'loading the key does not arm mainnet');
    assert.equal(C.loadConfig({ SOLANA_NETWORK: 'devnet', MAINNET_AUTHORITY_SECRET_KEY: v }).authority, null, 'devnet ignores the mainnet authority');
  }
  const dev = Keypair.generate(); assert.equal(C.loadConfig({ SOLANA_NETWORK: 'devnet', AUTHORITY_SECRET_KEY: JSON.stringify(Array.from(dev.secretKey)), MAINNET_AUTHORITY_SECRET_KEY: json }).authority.publicKey.toBase58(), dev.publicKey.toBase58());
  assert.throws(() => C.loadConfig({ SOLANA_NETWORK: 'mainnet-beta', MAINNET_AUTHORITY_SECRET_KEY: 'not-a-key' }), /not a valid/);
});
