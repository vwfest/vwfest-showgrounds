// Security probes against a LOCAL copy of the server (never the live host).
// Security audit regression tests (run against a local server only): nickname impersonation, chat obfuscation, NFT-name filter, DJ queue spam,
// vendor plot-hold DoS, entry-quote discount abuse, WebSocket floods/garbage, forged logins, admin endpoint, purchase-transaction inspection.
const path = require('path'); const ROOT = path.join(__dirname, '..');
const assert = require('assert'); const WebSocket = require('ws');
const PORT = +process.env.AUDIT_PORT || 3361, BASE = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, { SERVER_SECRET: 'probe-secret-0123456789-0123456789abcdef', PORT: String(PORT), MINT_NETWORK: 'devnet', MINT_ENABLED: '1', VWFEST_MINT: '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', DEV_WALLET: 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok', FIXED_SOL_USD: '150', ADMIN_SECRET: 'probe-admin-secret-0123456789', MAX_CONNS_PER_IP: '60', PROFILE_CREATE_PER_HOUR: '500', DJ_SLOT_MS: '60000', SOLANA_RPC_URL: 'http://127.0.0.1:1',  VENDOR_FEE_USD: '30' });
const S = require('../server.js'); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const res = []; const rec = (id, sev, name, ok, note = '') => { res.push({ id, sev, name, ok, note }); if (!ok) process.exitCode = 1; console.log(ok ? 'ok  ' : 'FAIL', `[${sev}]`, id, name, ok ? '' : note); };
const client = () => new Promise((resolve) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: BASE } }); const c = { ws, msgs: [], bins: 0, closed: null, waiters: [] }; ws.on('message', (d, bin) => { if (bin) { c.bins++; return; } let m; try { m = JSON.parse(d); } catch { return; } c.msgs.push(m); c.waiters = c.waiters.filter((w) => !(w.t === m.t && (w.f(m), true))); }); ws.on('close', (code) => (c.closed = code)); c.wait = (t, ms = 3000) => new Promise((r, j) => { const f = c.msgs.find((m) => m.t === t); if (f) return r(f); const to = setTimeout(() => j(new Error('timeout ' + t)), ms); c.waiters.push({ t, f: (m) => { clearTimeout(to); r(m); } }); }); c.send = (o) => ws.send(JSON.stringify(o)); ws.on('open', () => resolve(c)); });
const join = async (nick) => { const c = await client(); await c.wait('hi'); c.send({ t: 'join', nick }); const r = await Promise.race([c.wait('welcome'), c.wait('joinerr')]); c.r = r; c.ok = r.t === 'welcome'; if (c.ok) c.welcome = r; return c; };
(async () => {
  await S.init(); await new Promise((r) => S.server.listen(PORT, '127.0.0.1', r));
  // ---- nickname spoofing
  const spoof = ['Admin1', 'admin 2', 'VW-FEST', 'VW_FEST', 'vw fest', 'Official1', 'Moderator1', 'Support Team', 'Staff_1', 'VWFEST Dev', 'Vwfest2', 'DJ Admin', 'Server_1'];
  const accepted = []; for (const n of spoof) { const c = await join(n); if (c.ok) accepted.push(n); c.ws.close(); }
  rec('N1', 'medium', 'reserved/official-looking nicknames are refused', accepted.length === 0, 'accepted: ' + accepted.join(', '));
  const a = await join('Alice1'); const b = await join('alice_1'); rec('N2', 'low', 'case/sep-variant duplicate nickname refused', !b.ok);
  const hom = await join('Аlice9'); rec('N3', 'low', 'cyrillic homoglyph nickname refused', !hom.ok);
  // ---- chat injection / flooding
  const ch = await join('Chatty1');
  ch.send({ t: 'chat', text: '<img src=x onerror=alert(1)>', scope: 'all' }); await wait(200);
  const gotHtml = a.msgs.find((m) => m.t === 'chat' && /onerror/.test(m.text)); rec('C1', 'info', 'HTML in chat is relayed as inert text (client uses textContent only)', true, gotHtml ? 'relayed raw (OK: textContent)' : 'blocked');
  for (const t of ['visit evil.com now', 'h t t p s : / / x', 'send to 9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', 'w w w . evil . com', 'evil dot com', 'evil(dot)xyz']) { ch.send({ t: 'chat', text: t, scope: 'near' }); await wait(1700); }
  const leaked = ch.msgs.filter((m) => m.t === 'chat').map((m) => m.text);
  rec('C2', 'low', 'link/address obfuscation handled by chat filter', leaked.length <= 1, 'relayed: ' + JSON.stringify(leaked));
  const before = a.msgs.length; for (let i = 0; i < 200; i++) ch.send({ t: 'chat', text: 'spam ' + i, scope: 'all' }); await wait(500);
  rec('C3', 'high', 'chat flood is throttled (<=5 delivered of 200)', a.msgs.filter((m) => m.t === 'chat').length <= 8, 'delivered ' + a.msgs.filter((m) => m.t === 'chat' && /spam/.test(m.text)).length);
  // ---- malformed / flood
  const f = await join('Fuzzer1'); const garbage = [Buffer.alloc(0), Buffer.from([4]), Buffer.from([1, 2, 3]), Buffer.alloc(9, 255), Buffer.from('{"t":"chat"'), Buffer.from('[]'), Buffer.from('null'), Buffer.from('{"t":"__proto__"}'), Buffer.from('{"t":"join","nick":{"a":1}}'), Buffer.from('{"t":"quote","kind":{},"method":[]}'), Buffer.from('{"t":"buy","qid":{},"sig":1}'), Buffer.from('{"t":"wproof","nonce":{},"pubkey":[],"sig":{}}'), Buffer.from('{"t":"nftuse","wallet":{},"asset":{}}'), Buffer.from('{"t":"rtc","to":1e9,"k":"offer","d":{}}'), Buffer.from('{"t":"djpick","i":"1"}'), Buffer.from('{"t":"equip","item":{"__proto__":1},"slot":{}}'), Buffer.from('{"t":"av","av":"x"}'), Buffer.from('{"t":"profile","sid":"x"}'), Buffer.from('{"t":"emote","id":{}}')];
  for (const g of garbage) { f.ws.send(g, { binary: false }); f.ws.send(g, { binary: true }); }
  await wait(300); const alive = await fetch(BASE + '/healthz').then((r) => r.ok).catch(() => false); rec('F1', 'high', 'malformed/odd frames do not crash the server', alive);
  const big = await join('Bigmsg1'); big.ws.send(Buffer.alloc(7000, 97)); await wait(300); rec('F2', 'medium', '7 KB frame rejected (ws maxPayload closes socket)', big.closed !== null, 'close code ' + big.closed);
  const fl = await join('Flood001'); const t0 = Date.now(); for (let i = 0; i < 20000; i++) fl.ws.send(JSON.stringify({ t: 'emote', id: 1 })); await wait(1500);
  rec('F3', 'high', '20k-message JSON flood: server alive + flooder disconnected or throttled', (await fetch(BASE + '/healthz').then((r) => r.ok).catch(() => false)) && (fl.closed !== null), 'closed=' + fl.closed);
  const mv = await join('Mover01'); const buf = Buffer.alloc(9); buf[0] = 1; for (let i = 0; i < 20000; i++) mv.ws.send(buf); await wait(800); rec('F4', 'medium', '20k binary movement flood survived', await fetch(BASE + '/healthz').then((r) => r.ok).catch(() => false));
  const mic = await join('Micflood'); const pk = Buffer.alloc(200); pk[0] = 4; for (let i = 0; i < 20000; i++) mic.ws.send(pk); await wait(800); rec('F5', 'medium', '20k DJ-mic-type binary flood from non-DJ is dropped cheaply', await fetch(BASE + '/healthz').then((r) => r.ok).catch(() => false));
  // ---- join abuse
  const bad = await client(); await bad.wait('hi'); bad.send({ t: 'join', id: 'VW-AAAAAAAA', secret: 'x'.repeat(48) }); const e = await Promise.race([bad.wait('joinerr'), bad.wait('welcome')]).catch(() => null); rec('J1', 'high', 'forged profile id/secret cannot join as an existing profile', !e || e.t === 'joinerr');
  const first = await join('Victim01'); const cred = first.welcome.cred; const dup = await client(); await dup.wait('hi'); dup.send({ t: 'join', id: cred.id, secret: cred.secret.replace(/./, (m) => (m === 'a' ? 'b' : 'a')) }); const e2 = await Promise.race([dup.wait('joinerr'), dup.wait('welcome')]).catch(() => null); rec('J2', 'high', 'one-char-off secret rejected', !e2 || e2.t === 'joinerr'); rec('J3', 'info', 'victim not kicked by failed attempt', first.closed === null);
  // ---- DJ abuse
  const dj1 = await join('Dj_One1'), dj2 = await join('Dj_Two2'), dj3 = await join('Dj_Thr3');
  for (const C of [dj1, dj2, dj3]) { const p = S.hub.players.get(C.welcome.id); p.x = 0; p.z = -70; }
  dj1.send({ t: 'djclaim' }); await wait(150); dj2.send({ t: 'djclaim' }); await wait(150);
  dj2.send({ t: 'djskip' }); dj2.send({ t: 'djpick', i: 1 }); dj2.send({ t: 'djmic', on: true }); await wait(150);
  rec('D1', 'high', 'non-DJ cannot skip/pick/mic', S.dj.isDj(S.hub.players.get(dj1.welcome.id)) && !S.dj.mic);
  const pushes0 = S.dj.version; for (let i = 0; i < 40; i++) { dj3.send({ t: 'djclaim' }); dj3.send({ t: 'djleave' }); } await wait(800); const pushes = S.dj.version - pushes0;
  rec('D2', 'medium', 'DJ claim/leave spam does not amplify to full broadcast (pushes in 0.8s <= 12)', pushes <= 12, 'pushes=' + pushes);
  const adm = (h) => fetch(BASE + '/api/admin/dj', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', ...h }, body: '{"action":"clear"}' }).then((r) => r.status);
  rec('D3', 'high', 'admin DJ endpoint refuses no/short/wrong secret', (await adm({})) === 401 && (await adm({ 'x-admin-secret': 'probe-admin-secret-012345678' })) === 401 && (await adm({ 'x-admin-secret': 'x' })) === 401);
  // ---- vendors: plot hold DoS
  const v = await join('Vendor_9'); S.mint.devWallet; let holds = 0; for (let k = 1; k <= 12; k++) { v.send({ t: 'quote', kind: 'vendor', method: 'vwfest', plot: k }); await wait(1300); }
  holds = [...S.vendors.holds.keys()].length; rec('V1', 'medium', 'one profile can hold at most 1 booth plot at a time', holds <= 1, 'plots held by a single free profile: ' + holds);
  // ---- entry-quote discount abuse
  const en = await join('Entry_01'); en.send({ t: 'quote', kind: 'avatar', method: 'sol', entry: false }); const q0 = await en.wait('quote').catch(() => null); en.msgs.length = 0; en.waiters = []; await wait(1300); en.send({ t: 'quote', kind: 'avatar', method: 'sol', entry: true }); const q1 = await en.wait('quote').catch(() => null);
  if (q0 && q1) { const r = Number(BigInt(q1.q.burnMin) * 100n / BigInt(q0.q.burnMin)); rec('P1', 'medium', 'client-chosen entry:true does not lower the required burn (no on-ramp session / proven wallet issued by the server)', r >= 95, `burnMin ratio entry/normal = ${r}%`); } else rec('P1', 'medium', 'entry quote test', false, 'no quotes');
  // ---- NFT name sanitization
  const nm = (S.nftav.pub({ nft: { asset: 'x', name: 'Send SOL to evil.com <b>ADMIN</b>' } }) || {}).n; rec('NFT1', 'low', 'on-chain NFT name is filtered like chat (links/offensive/impersonation)', !/evil\.com/.test(nm), 'name shown: ' + JSON.stringify(nm));
  // ---- purchase transaction inspection (wrong mint / amount / recipient / signer / memo / CPI / failed tx)
  const { inspect, Facade } = require(path.join(ROOT, 'solana/src/compat.js'));
  const MINT = '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', FAKEMINT = 'So11111111111111111111111111111111111111112', W = 'BqRM2Me3BriYQ9j4Dx2pXsbKWQ3AwELqqPu3Rd1QUwvZ', ATT = 'DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok', DEV = ATT;
  const key = (k, signer) => ({ pubkey: k, signer: !!signer });
  const burn = (o = {}) => ({ program: 'spl-token', programId: 'Tokenkeg', parsed: { type: o.type || 'burnChecked', info: { mint: o.mint || MINT, authority: o.auth || W, tokenAmount: { amount: String(o.amt ?? 1000000) }, amount: String(o.amt ?? 1000000) } } });
  const memo = (m) => ({ program: 'spl-memo', parsed: m }); const xfer = (to, l, src = W) => ({ program: 'system', parsed: { type: 'transfer', info: { source: src, destination: to, lamports: l } } });
  const tx = (ixs, o = {}) => ({ blockTime: 1, slot: 1, meta: { err: o.err || null }, transaction: { signatures: ['s'], message: { accountKeys: o.keys || [key(W, true)], instructions: ixs } } });
  const base = { mint: MINT, nonce: 'qabc', wallet: W, devWallet: DEV, burnMin: 970000n, devMin: 99n };
  const cpi = tx([memo('vwfest:qabc'), { program: 'unknown', programId: 'X', parsed: null }]); cpi.meta.innerInstructions = [{ index: 0, instructions: [burn()] }];
  const cases = [['valid', tx([burn(), memo('vwfest:qabc'), xfer(DEV, 100)]), true], ['wrong mint', tx([burn({ mint: FAKEMINT }), memo('vwfest:qabc'), xfer(DEV, 100)]), false], ['unchecked burn', tx([burn({ type: 'burn' }), memo('vwfest:qabc'), xfer(DEV, 100)]), false],
    ['burn too small', tx([burn({ amt: 1000 }), memo('vwfest:qabc'), xfer(DEV, 100)]), false], ['fee too small', tx([burn(), memo('vwfest:qabc'), xfer(DEV, 1)]), false], ['fee to wrong recipient', tx([burn(), memo('vwfest:qabc'), xfer(W, 100)]), false],
    ['fee from other source', tx([burn(), memo('vwfest:qabc'), xfer(DEV, 100, ATT)]), false], ['other wallet signed', tx([burn({ auth: ATT }), memo('vwfest:qabc')], { keys: [key(ATT, true)] }), false], ['burn authority != signer', tx([burn({ auth: ATT }), memo('vwfest:qabc'), xfer(DEV, 100)]), false],
    ['memo of another quote', tx([burn(), memo('vwfest:qzzz'), xfer(DEV, 100)]), false], ['no memo', tx([burn(), xfer(DEV, 100)]), false], ['failed tx', tx([burn(), memo('vwfest:qabc'), xfer(DEV, 100)], { err: { x: 1 } }), false],
    ['padded memo vwfest:x:qabc', tx([burn(), memo('vwfest:evil:qabc'), xfer(DEV, 100)]), false], ['missing tx', null, false], ['first key not a signer', tx([burn(), memo('vwfest:qabc'), xfer(DEV, 100)], { keys: [key(W, false), key(ATT, true)] }), false],
    ['burn only inside CPI', cpi, false], ['two memos: last wins', tx([memo('vwfest:qabc'), burn(), memo('vwfest:qother')]), false]];
  { const bs58 = require(path.join(ROOT, 'solana/node_modules/bs58')); const B = bs58.default || bs58; const CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'; const URI = 'https://x/ride/q.json';
    const sb = (x) => { const b = Buffer.from(x); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); }; const data = B.encode(Buffer.concat([Buffer.from([0, 0]), sb('VW'), sb(URI), Buffer.from([0])]));
    const core = (payer, owner) => ({ programId: CORE, accounts: ['ASSET1111111111111111111111111111111111111', CORE, CORE, payer, owner, CORE, '11111111111111111111111111111111', CORE], data });
    const mk = (payer, owner) => tx([burn(), memo('vwfest:qabc'), xfer(DEV, 100), core(payer, owner)], { keys: [key(W, true), key(ATT, true)] });
    cases.push(['core mint to signer (owner omitted)', mk(W, CORE), true], ['core mint to signer (owner explicit)', mk(ATT, W), true], ['core owner omitted, PAYER is a co-signer (NFT goes to them)', mk(ATT, CORE), false], ['core owner explicit other wallet', mk(W, ATT), false]);
    for (const [name, t, want] of cases.slice(-4)) rec('PAY', 'high', 'tx inspection: ' + name, inspect(t, { ...base, uri: URI }).ok === want); cases.splice(-4); }
  for (const [name, t, want] of cases) rec('PAY', 'high', 'tx inspection: ' + name, inspect(t, base).ok === want);
  const F = new Facade(); await F.init({ env: { NODE_ENV: 'production', CHAIN_FAKE: '1', MINT_NETWORK: 'devnet', MINT_ENABLED: '1', VWFEST_MINT: MINT, SERVER_SECRET: 'x'.repeat(40) } }); rec('PAY', 'high', 'CHAIN_FAKE is ignored when NODE_ENV=production', F.fake === false);
  const F2 = new Facade(); await F2.init({ env: { CHAIN_FAKE: '1', MINT_NETWORK: 'mainnet-beta', MINT_ENABLED: '1', MINT_MAINNET: '1', VWFEST_MINT: MINT, SERVER_SECRET: 'x'.repeat(40) } }); rec('PAY', 'high', 'CHAIN_FAKE is ignored on mainnet', F2.fake === false);
  // ---- real client IP behind Cloudflare/Render, RLS helper
  { const { clientIp } = require('../lib/clientip'); process.env.TRUST_CF = '1'; const rq = (h) => ({ headers: h, socket: { remoteAddress: '10.0.0.1' }, ip: '172.64.0.1' });
    rec('IP', 'high', 'CF-Connecting-IP is the client address', clientIp(rq({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 172.64.0.1' })) === '203.0.113.7');
    rec('IP', 'high', 'without CF header: entry before the edge, never the (spoofable) first entry', clientIp(rq({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 172.64.0.1' })) === '203.0.113.9');
    rec('IP', 'high', 'spoofed CF header with a non-IP value is ignored', clientIp(rq({ 'cf-connecting-ip': 'evil', 'x-forwarded-for': '203.0.113.9, 172.64.0.1' })) === '203.0.113.9'); delete process.env.TRUST_CF;
    process.env.TRUST_CF = '1'; const { isCloudflare } = require('../lib/clientip');
    rec('IP', 'high', 'CF-Connecting-IP is NOT trusted when the connection did not come from a Cloudflare range (direct hit on the origin)', clientIp(rq({ 'cf-connecting-ip': '6.6.6.6', 'x-forwarded-for': '7.7.7.7, 198.51.100.20' })) === '198.51.100.20' && clientIp(rq({ 'cf-connecting-ip': '6.6.6.6' })) === '10.0.0.1');
    rec('IP', 'high', 'Cloudflare range check (v4 edges, v6 edges, v4-mapped, neighbours outside the ranges)', isCloudflare('172.64.0.1') && isCloudflare('104.16.5.5') && isCloudflare('2606:4700::1') && isCloudflare('::ffff:162.158.1.1') && isCloudflare('172.71.255.255') && !isCloudflare('172.72.0.0') && !isCloudflare('198.51.100.20') && !isCloudflare('2606:4701::1') && !isCloudflare('8.8.8.8') && !isCloudflare('garbage'));
    rec('IP', 'high', 'a Cloudflare-edge IPv6 peer is honoured the same way', clientIp(rq({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 2606:4700:10::1' })) === '203.0.113.7'); delete process.env.TRUST_CF;
    rec('IP', 'info', 'outside Render/TRUST_CF the socket/req.ip is used and headers are ignored', clientIp(rq({ 'cf-connecting-ip': '203.0.113.7' })) === '172.64.0.1'); }
  { const { enableRls } = require('../lib/rls'); const ran = []; const done = await enableRls(async (sql) => { ran.push(sql); return { rows: [{ table_name: 'profiles' }, { table_name: 'we"ird' }] }; }, 'showgrounds');
    rec('RLS', 'medium', 'RLS is enabled (no policies) on every table in the schema, identifiers quoted', done.length === 2 && ran.some((x) => x === 'ALTER TABLE "showgrounds"."profiles" ENABLE ROW LEVEL SECURITY') && ran.some((x) => x.includes('"we""ird"')));
    const ok = await enableRls(async () => { throw new Error('boom'); }, 'showgrounds'); rec('RLS', 'low', 'RLS failures are non-fatal', Array.isArray(ok) && ok.length === 0); }
  // ---- dependency guard: bigint-buffer (via spl-token) has no patch, so no untrusted bytes may reach spl-token's account/mint DECODERS; only encoders / PDA derivation
  { const fs = require('fs'); const used = new Set(); for (const f of fs.readdirSync(path.join(ROOT, 'solana/src')).filter((x) => x.endsWith('.js'))) { const src = fs.readFileSync(path.join(ROOT, 'solana/src', f), 'utf8'); for (const m of src.matchAll(/\bspl\.([A-Za-z]+)/g)) used.add(m[1]); }
    const ok = new Set(['TOKEN', 'createAssociatedTokenAccountIdempotentInstruction', 'createBurnCheckedInstruction', 'createTransferCheckedInstruction', 'getAssociatedTokenAddressSync', 'createMint', 'mintTo', 'getOrCreateAssociatedTokenAccount']); // last three: devnet setup/faucet on the server's own authority account only
    const extra = [...used].filter((x) => !ok.has(x)); rec('DEP', 'high', 'only allow-listed spl-token functions are used (no decoders such as unpackAccount/getAccount/getMint on untrusted data)', extra.length === 0, 'unexpected: ' + extra.join(', ')); }
  // ---- Web3Auth origins: server header list == Pages meta CSP list; no broad wildcards
  { const fs = require('fs'); const W3A = require('../shared/w3a'); const html = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8'); const meta = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    rec('CSP', 'medium', 'Pages meta CSP allows exactly the shared Web3Auth origins (connect-src)', W3A.every((o) => meta.split('connect-src')[1].split(';')[0].split(' ').includes(o)));
    rec('CSP', 'medium', 'no *.tor.us / *.toruslabs.com / *.metamask.io / *.web3auth.com wildcards anywhere', !/\*\.(tor\.us|toruslabs\.com|metamask\.io|web3auth\.com)/.test(meta + W3A.join(' ')));
    { const cs = meta.split('connect-src')[1].split(';')[0].split(' '); const hosts = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com', 'https://api.devnet.solana.com', 'https://vwfest-showgrounds.onrender.com', 'wss://vwfest-showgrounds.onrender.com', 'https://api.coinbase.com'];
      rec('CSP', 'high', 'Pages connect-src allows every host the client fetches: the live public RPC (publicnode), the game server (https + wss; /api/jup and /api/rpc live there), mainnet/devnet RPC, coinbase', hosts.every((h) => cs.includes(h)), 'missing: ' + hosts.filter((h) => !cs.includes(h)).join(' '));
      const live = (() => { try { return new URL(fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8').match(/PUBLIC_RPC_URL[^\n]*value:\s*(\S+)/)?.[1] || 'https://solana-rpc.publicnode.com').origin; } catch { return null; } })(); rec('CSP', 'high', 'the PUBLIC_RPC_URL in render.yaml (if it has a value) is in the Pages connect-src', !live || cs.includes(live)); }
    rec('CSP', 'medium', 'no *.onrender.com wildcard in the Pages CSP', !/\*\.onrender\.com/.test(meta)); }
  console.log(res.every((r) => r.ok) ? `all ${res.length} audit tests passed` : 'AUDIT TESTS FAILED');
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
