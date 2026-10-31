// Realtime hardening (local server only): DJ mic relay range + byte cap + pre-copy token bucket, TURN only after voice opt-in (per-session HMAC),
// WebRTC signaling gates (voice on both sides, field allow-list, size/rate), chat/nick filter folding, admin mute/kick/ban, async handler safety, joining guard.
const assert = require('assert'); const crypto = require('crypto'); const WebSocket = require('ws');
const PORT = 3302, BASE = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { SERVER_SECRET: 'rt-secret-0123456789-0123456789abcdef', PORT: String(PORT), MINT_NETWORK: 'devnet', DJ_SLOT_MS: '60000', ADMIN_SECRET: 'rt-admin-secret-0123456789', TURN_URL: 'turn:turn.example.com:3478', ONRAMP_URL_TEMPLATE: 'https://ramp.example/buy?wallet={address}&amount={usd}&ref={ref}', TURN_SECRET: 'rt-turn-secret-0123456789', TURN_USERNAME: 'static', TURN_CREDENTIAL: 'shared', MAX_CONNS_PER_IP: '200', PROFILE_CREATE_PER_HOUR: '100' });
const S = require('../server.js'); const { cleanChat, cleanName } = require('../lib/names');
let n = 0; const t = async (name, f) => { try { await f(); n++; console.log('ok  ', name); } catch (e) { console.error('FAIL', name, e.stack.split('\n').slice(0, 3).join(' | ')); process.exitCode = 1; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const client = () => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: BASE } }); const c = { ws, msgs: [], bins: [], closed: null, waiters: [] }; ws.on('message', (d, bin) => { if (bin) { c.bins.push(Buffer.from(d)); return; } const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter((w) => !(w.t === m.t && (w.f(m), true))); }); ws.on('close', (code) => (c.closed = code)); c.wait = (ty, ms = 3000) => new Promise((r2, j2) => { const old = c.msgs.find((m) => m.t === ty && !m._seen); if (old) { old._seen = true; return r2(old); } const to = setTimeout(() => j2(new Error('timeout ' + ty)), ms); c.waiters.push({ t: ty, f: (m) => { clearTimeout(to); m._seen = true; r2(m); } }); }); c.send = (o) => ws.send(JSON.stringify(o)); ws.on('open', () => res(c)); ws.on('error', rej); });
const join = async (nick) => { const c = await client(); await c.wait('hi'); c.send({ t: 'join', nick }); const r = await Promise.race([c.wait('welcome'), c.wait('joinerr')]); c.r = r; c.ok = r.t === 'welcome'; if (c.ok) c.welcome = r; return c; };
const setPos = (C, x, z) => { const p = S.hub.players.get(C.welcome.id); p.x = x; p.z = z; };
const adm = (path, body, secret = process.env.ADMIN_SECRET) => fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { origin: BASE, 'content-type': 'application/json', 'x-admin-secret': secret }, body: body ? JSON.stringify(body) : undefined });
const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';
const CAND = { candidate: 'candidate:1 1 udp 2122260223 192.168.1.2 54321 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abcd' };
process.on('unhandledRejection', (e) => { console.error('UNHANDLED REJECTION', e); process.exitCode = 1; });
(async () => {
  await S.init(); await new Promise((r) => S.server.listen(PORT, '127.0.0.1', r)); const dj = S.dj;
  const A = await join('DeeJay7'), B = await join('Near007'), D = await join('Far0007'), E = await join('Eve0007');
  await t('DJ mic relay: only listeners within earshot of the stage receive audio; far players get nothing', async () => {
    setPos(A, 0, -73); await wait(1100); A.send({ t: 'djclaim' }); await A.wait('djres'); await wait(1100); A.send({ t: 'djmic', on: true }); await wait(250); assert(dj.mic);
    setPos(B, 5, -60); setPos(D, 100, 100); const pkt = Buffer.concat([Buffer.from([4, 1]), Buffer.alloc(600, 0xd5)]); A.ws.send(pkt); await wait(250);
    assert.strictEqual(B.bins.filter((b) => b[0] === 4).length, 1, 'near listener hears'); assert.strictEqual(D.bins.filter((b) => b[0] === 4).length, 0, 'far player is not sent audio');
  });
  await t('DJ mic relay: hard byte cap per second (4 KB frames), then back to normal next second', async () => {
    await wait(1100); B.bins.length = 0; const big = Buffer.concat([Buffer.from([4, 2]), Buffer.alloc(4000, 1)]); for (let i = 0; i < 20; i++) A.ws.send(big); await wait(400);
    const got = B.bins.filter((b) => b[0] === 4).length; assert(got >= 1 && got <= 6, 'bytes capped, got ' + got); await wait(1100); B.bins.length = 0; A.ws.send(Buffer.concat([Buffer.from([4, 3]), Buffer.alloc(300, 1)])); await wait(250); assert.strictEqual(B.bins.length, 1);
  });
  await t('binary 0x04 flood is cut by a per-connection token bucket BEFORE any Buffer copy, and a persistent flooder is disconnected', async () => {
    const orig = Buffer.from; let copies = 0; Buffer.from = function (...a) { if (a[0] && a[0].length === 100 && a[0][0] === 4) copies++; return orig.apply(this, a); };
    try { const pk = Buffer.alloc(100); pk[0] = 4; for (let i = 0; i < 3000; i++) E.ws.send(pk); await wait(600); assert.strictEqual(copies, 0, 'non-DJ frames are never copied'); } finally { Buffer.from = orig; }
    for (let i = 0; i < 5000; i++) if (E.ws.readyState === 1) E.ws.send(Buffer.from([4, 0, 0, 0, 0, 0, 0, 0, 0])); await wait(600); assert.strictEqual(E.closed, 1008, 'flooder closed (' + E.closed + ')');
  });
  await t('TURN: not in welcome, no static shared credential ever; per-session short-lived HMAC only after voice opt-in', async () => {
    assert(A.welcome.iceServers.every((s) => !s.credential && !s.username)); const all = JSON.stringify(S.iceServers(null)); assert(!all.includes('shared') && !all.includes('static') && !all.includes('turn.example.com'), 'no TURN for sessions that did not opt in');
    A.send({ t: 'voice', on: true }); const ia = await A.wait('ice'); const ta = ia.iceServers.find((s) => s.credential); assert(ta && ta.username.endsWith(':s' + A.welcome.id));
    assert.strictEqual(ta.credential, crypto.createHmac('sha1', process.env.TURN_SECRET).update(ta.username).digest('base64')); assert(+ta.username.split(':')[0] - Date.now() / 1000 <= 900 + 2, 'ttl <= 15 min');
    B.send({ t: 'voice', on: true }); const tb = (await B.wait('ice')).iceServers.find((s) => s.credential); assert.notStrictEqual(tb.credential, ta.credential);
  });
  await t('rtc: requires voice ON on both sides, proximity, and rebuilds the payload from an allow-list', async () => {
    setPos(A, 0, 0); setPos(B, 3, 3); setPos(D, 4, 4); D.msgs.length = 0; B.msgs.length = 0;
    A.send({ t: 'rtc', to: D.welcome.id, k: 'ice', d: CAND }); await wait(200); assert(!D.msgs.some((m) => m.t === 'rtc'), 'target without voice gets nothing');
    A.send({ t: 'rtc', to: B.welcome.id, k: 'offer', d: { type: 'offer', sdp: SDP, evil: 'x', __proto__: { y: 1 } } }); const o = await B.wait('rtc'); assert.deepStrictEqual(Object.keys(o.d).sort(), ['sdp', 'type']); assert.strictEqual(o.from, A.welcome.id);
    A.send({ t: 'rtc', to: B.welcome.id, k: 'ice', d: { ...CAND, extra: { a: 1 } } }); const i = await B.wait('rtc'); assert.deepStrictEqual(Object.keys(i.d).sort(), ['candidate', 'sdpMLineIndex', 'sdpMid', 'usernameFragment']);
    B.msgs.length = 0; const bad = [{ k: 'offer', d: { type: 'answer', sdp: SDP } }, { k: 'offer', d: { type: 'offer', sdp: SDP + 'm=video 9 RTP/AVP 96\r\n' } }, { k: 'offer', d: { type: 'offer', sdp: SDP + 'm=application 9 DTLS/SCTP 5000\r\n' } }, { k: 'offer', d: { type: 'offer', sdp: 'x'.repeat(4001) } }, { k: 'offer', d: 'str' }, { k: 'ice', d: { candidate: 'x'.repeat(401) } }, { k: 'ice', d: { candidate: 'candidate:1', sdpMLineIndex: 99 } }, { k: 'ice', d: { candidate: 'notcandidate' } }, { k: 'ice', d: [CAND] }, { k: 'answer', d: null }];
    for (const b of bad) { A.send({ t: 'rtc', to: B.welcome.id, ...b }); await wait(60); } await wait(200); assert(!B.msgs.some((m) => m.t === 'rtc'), 'malformed signaling dropped: ' + JSON.stringify(B.msgs.filter((m) => m.t === 'rtc').map((m) => m.k)));
    setPos(D, 100, 100); D.send({ t: 'voice', on: true }); await D.wait('ice'); A.send({ t: 'rtc', to: D.welcome.id, k: 'ice', d: CAND }); await wait(200); assert(!D.msgs.some((m) => m.t === 'rtc'), 'out of range');
  });
  await t('rtc: oversize frame and signaling flood are throttled (flooder disconnected)', async () => {
    const F = await join('Sigflood'); setPos(F, 3, 4); F.send({ t: 'voice', on: true }); await F.wait('ice'); B.msgs.length = 0;
    for (let i = 0; i < 400; i++) if (F.ws.readyState === 1) F.send({ t: 'rtc', to: B.welcome.id, k: 'ice', d: CAND }); await wait(600); assert(B.msgs.filter((m) => m.t === 'rtc').length <= 25, 'relayed ' + B.msgs.filter((m) => m.t === 'rtc').length);
    F.ws.close();
  });
  await t('chat/nick filter: confusables, ideographic dot, spaced "discord gg", spoken domains in nicks', () => {
    for (const x of ['evil。com', 'evіl.com', 'ｅｖｉｌ．ｃｏｍ', 'discord gg/abc', 'join discord  gg', 'd i s c o r d . g g', 'dsc.gg/x', 'fuсk', 'ѕhit', 'évil。com', 'evil·com']) assert(!cleanChat(x).ok, 'should block: ' + x);
    for (const x of ['hello friends', 'Привет друзья', 'see you at the stage', 'good game']) assert(cleanChat(x).ok, 'should allow: ' + x);
    for (const x of ['Evil dot io', 'Discord gg', 'Cool Dot Com']) assert.strictEqual(cleanName(x), null, 'nick: ' + x); assert.strictEqual(cleanName('Alice9'), 'Alice9');
  });
  await t('admin: unauthenticated / wrong secret refused (digest compare), list works', async () => {
    assert.strictEqual((await adm('/api/admin/mod', null, 'wrong')).status, 401); assert.strictEqual((await adm('/api/admin/mod', null, process.env.ADMIN_SECRET + 'x')).status, 401); const j = await (await adm('/api/admin/mod')).json(); assert(j.ok && j.online.some((o) => o.nick === 'Near007'));
  });
  await t('admin mute: blocks chat, voice signaling and the DJ mic; unmute restores', async () => {
    const pid = B.welcome.pid; B.msgs.length = 0; assert((await adm('/api/admin/mod', { action: 'mute', pid, minutes: 5 })).ok); await wait(100);
    B.send({ t: 'chat', text: 'hello there', scope: 'near' }); const e = await B.wait('chaterr'); assert(/muted/i.test(e.why)); A.msgs.length = 0; B.send({ t: 'rtc', to: A.welcome.id, k: 'ice', d: CAND }); await wait(200); assert(!A.msgs.some((m) => m.t === 'rtc'));
    B.send({ t: 'voice', on: true }); await wait(200); assert(!B.msgs.some((m) => m.t === 'ice'), 'no TURN creds while muted');
    assert.strictEqual(S.mod.muted(pid), true); S.mod.mute(A.welcome.pid, 1); A.bins.length = 0; B.bins.length = 0; await wait(1100); A.ws.send(Buffer.concat([Buffer.from([4, 9]), Buffer.alloc(200, 1)])); await wait(250); assert.strictEqual(B.bins.filter((b) => b[0] === 4).length, 0, 'muted DJ mic is not relayed'); S.mod.unmute(A.welcome.pid);
    assert((await adm('/api/admin/mod', { action: 'unmute', pid })).ok); assert.strictEqual(S.mod.muted(pid), false);
  });
  await t('admin kick removes the player; ban refuses re-join by profile AND by IP until it expires; unban restores', async () => {
    const K = await join('Kick007'); const kpid = K.welcome.pid; assert((await adm('/api/admin/mod', { action: 'kick', pid: K.welcome.id })).ok); await K.wait('kick'); await wait(300); console.log(JSON.stringify(K.r).slice(0,200)); assert(K.closed !== null && !S.hub.find(kpid));
    const R = await client(); await R.wait('hi'); R.send({ t: 'join', id: K.welcome.cred.id, secret: K.welcome.cred.secret }); assert.strictEqual((await Promise.race([R.wait('welcome'), R.wait('joinerr')])).t, 'welcome', 'kick is not a ban'); await wait(100);
    assert((await adm('/api/admin/mod', { action: 'ban', pid: kpid, minutes: 10 })).ok); await wait(300); assert(!S.hub.find(kpid));
    const R2 = await client(); await R2.wait('hi'); R2.send({ t: 'join', id: K.welcome.cred.id, secret: K.welcome.cred.secret }); const j2 = await Promise.race([R2.wait('welcome'), R2.wait('joinerr')]); assert(j2.t === 'joinerr' && j2.err === 'banned');
    const N = await client(); await N.wait('hi'); N.send({ t: 'join', nick: 'Fresh007' }); const j3 = await Promise.race([N.wait('welcome'), N.wait('joinerr')]); assert(j3.t === 'joinerr' && j3.err === 'banned', 'same IP, new profile: refused');
    assert((await adm('/api/admin/mod', { action: 'unban', pid: kpid, ip: '127.0.0.1' })).ok); const N2 = await join('Fresh008'); assert(N2.ok, 'allowed after unban');
    assert.strictEqual((await adm('/api/admin/mod', { action: 'nuke', pid: kpid })).status, 400); assert.strictEqual((await adm('/api/admin/mod', { action: 'ban', pid: '../x' })).status, 400);
  });
  await t('wallet proof challenge is domain-bound: message names the site + network, verify requires the same origin, nonce is single-use', () => {
    const wa = require('../lib/walletauth'); const nacl = require('tweetnacl'); const bs58 = require('bs58').default || require('bs58'); const kp = nacl.sign.keyPair(); const pk = bs58.encode(kp.publicKey);
    const sign = (msg) => Buffer.from(nacl.sign.detached(Buffer.from(msg), kp.secretKey)).toString('base64');
    let ch = wa.challenge(pk, 'VW-1', 'https://vwfest.github.io', 'devnet'); assert(ch.message.includes('\nDomain: https://vwfest.github.io\n') && ch.message.includes('\nNetwork: devnet\n') && ch.message.includes('\nWallet: ' + pk + '\n'));
    assert.strictEqual(wa.verify({ nonce: ch.nonce, pubkey: pk, signature: sign(ch.message), pid: 'VW-1', origin: 'https://evil.example' }), false, 'other origin refused'); assert.strictEqual(wa.verify({ nonce: ch.nonce, pubkey: pk, signature: sign(ch.message), pid: 'VW-1', origin: 'https://vwfest.github.io' }), false, 'nonce already burned');
    ch = wa.challenge(pk, 'VW-1', 'https://vwfest.github.io', 'devnet'); assert.strictEqual(wa.verify({ nonce: ch.nonce, pubkey: pk, signature: sign(ch.message), pid: 'VW-1', origin: 'https://vwfest.github.io' }), true);
    ch = wa.challenge(pk, 'VW-1', 'https://vwfest.github.io', 'devnet'); assert.strictEqual(wa.verify({ nonce: ch.nonce, pubkey: pk, signature: sign(ch.message), pid: 'VW-2', origin: 'https://vwfest.github.io' }), false, 'other profile refused');
  });
  await t('on-ramp: HTTP route is gone; over the socket the delivery address is ONLY the session\'s proven wallet (client-supplied address ignored)', async () => {
    const r = await fetch(BASE + '/api/onramp/session', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'custom', address: 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok' }) }); assert.strictEqual(r.status, 410);
    const nacl = require('tweetnacl'); const bs58 = require('bs58').default || require('bs58'); const kp = nacl.sign.keyPair(); const pk = bs58.encode(kp.publicKey); const evil = 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok';
    const O = await join('Ramp007'); O.send({ t: 'onramp', provider: 'custom', purpose: 'entry', address: evil }); const e = await O.wait('onramperr'); assert(e.needProof, 'no proven wallet -> refused');
    O.send({ t: 'wauth', pubkey: pk }); const ch = await O.wait('wchal'); assert(ch.message.includes('Domain: ' + BASE)); O.send({ t: 'wproof', pubkey: pk, nonce: ch.nonce, sig: Buffer.from(nacl.sign.detached(Buffer.from(ch.message), kp.secretKey)).toString('base64') }); assert((await O.wait('wok')).ok);
    O.send({ t: 'onramp', provider: 'custom', purpose: 'entry', address: evil }); const ok = await O.wait('onrampres'); assert(ok.url.includes('wallet=' + pk) && !ok.url.includes(evil), ok.url); assert.strictEqual(ok.address, pk);
    O.send({ t: 'onramp', provider: 'nope', purpose: 'entry' }); assert((await O.wait('onramperr')).why);
  });
  await t('headers: CSP frame-ancestors none (nobody may frame the pages Render serves)', async () => { const r = await fetch(BASE + '/'); const csp = r.headers.get('content-security-policy') || ''; assert(/frame-ancestors 'none'/.test(csp), csp); });
  await t('entry discount: entry:true is honoured only after the server issued an on-ramp session to this session\'s proven wallet', async () => {
    const E2 = await join('Entry007'); const ask = async (entry) => { E2.msgs.length = 0; E2.waiters = []; await wait(1300); E2.send({ t: 'quote', kind: 'avatar', method: 'sol', entry }); return Promise.race([E2.wait('quote'), E2.wait('quoteerr')]); };
    const pl = S.hub.find(E2.welcome.pid); assert(!pl.rampAt); const q = await ask(true); if (q.t === 'quote') assert(!q.q.entry, 'no discount without an on-ramp session'); else assert(q.t === 'quoteerr'); // (purchases may be disabled in this test env: then there is no quote at all)
    assert(!(S.hub.find(E2.welcome.pid).rampAt), 'still no session');
  });
  await t('headers: Permissions-Policy locks camera/geolocation/payment/usb..., microphone only for self', async () => { const r = await fetch(BASE + '/healthz'); const pp = r.headers.get('permissions-policy') || ''; assert(/camera=\(\)/.test(pp) && /geolocation=\(\)/.test(pp) && /payment=\(\)/.test(pp) && /microphone=\(self\)/.test(pp) && /usb=\(\)/.test(pp), pp); });
  await t('client source guards: __sg only on localhost, framed pages refuse wallet/pay UI, creator-fee address shown in full with a copy button, no key export in signing', () => {
    const fs = require('fs'); const rd = (f) => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
    assert(/if \(\/\^\(localhost\|127\\\.0\\\.0\\\.1\|\\\[::1\\\]\)\$\/\.test\(location\.hostname\)\) window\.__sg =/.test(rd('src/main.js')), '__sg gated');
    for (const f of ['src/pay.js', 'src/wallet.js']) assert(/assertTop\(\)/.test(rd(f)), f + ' framed guard'); assert(/if \(framed\)[^\n]*FRAME_MSG/.test(rd('src/ui.js')) && (rd('src/ui.js').match(/if \(framed\)/g) || []).length >= 2);
    const ui = rd('src/ui.js'); assert(!/devWallet\.slice\(0, 4\)/.test(ui) && /text: q\.devWallet/.test(ui) && /Copy creator wallet address/.test(ui)); assert(!/fetch\(ctx\.server \+ '\/api\/onramp/.test(ui) && /t: 'onramp'/.test(ui));
  });
  await t('ban expires by itself', async () => { let now = 1000; const { Moderation } = require('../lib/moderation'); const m = new Moderation(() => now); m.ban('p1', 1, '1.2.3.4'); assert(m.banned('p1', null) && m.banned(null, '1.2.3.4')); now += 61000; assert(!m.banned('p1', null) && !m.banned(null, '1.2.3.4')); assert.strictEqual(Moderation.minutes('abc', 60), 60); assert.strictEqual(Moderation.minutes(1e12, 60), 525600); });
  await t('async handler rejection never crashes the process; c.joining is cleared even when join throws', async () => {
    const orig = S.profiles.login; S.profiles.login = () => { throw new Error('boom'); }; const X = await client(); await X.wait('hi'); X.send({ t: 'join', nick: 'Boom007' }); await wait(300); S.profiles.login = orig;
    assert(await fetch(BASE + '/healthz').then((r) => r.ok), 'server alive'); X.send({ t: 'join', nick: 'Boom007' }); const r = await Promise.race([X.wait('welcome'), X.wait('joinerr')]); assert.strictEqual(r.t, 'welcome', JSON.stringify(r) + ' a retry on the same socket works (joining cleared)');
  });
  console.log(process.exitCode ? 'REALTIME TESTS FAILED' : `all ${n} realtime tests passed`); setTimeout(() => process.exit(process.exitCode || 0), 100);
})();
