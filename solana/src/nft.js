'use strict';
// Metaplex Core helpers (hand-encoded instructions: no Umi dependency), metadata, uniqueness, ownership lookup.
//  * Collections 'VW Fest Show Grounds Avatars' / 'VW Fest Show Grounds Rides' are Core collections whose update authority is the server's
//    AUTHORITY key. That key only co-signs mints (Core requires the collection authority to sign adding an asset). It holds no user funds.
//  * One mint per unique trait set is enforced ON-CHAIN: the asset address is a keypair derived from HMAC(SERVER_SECRET, collection+fingerprint),
//    so a second mint of the same trait set fails because the account already exists (plus the off-chain reservation for a friendly error).
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const https = require('https');
const { PublicKey, Keypair, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const C = require('./config');
const CORE = new PublicKey(C.MPL_CORE_PROGRAM);

const strEnc = (s) => { const e = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32LE(e.length); return Buffer.concat([l, e]); };
const NONE = { pubkey: CORE, isSigner: false, isWritable: false }; // Core's convention for an omitted optional account

// CreateCollectionV1: accounts collection(signer,w), updateAuthority(opt), payer(signer,w), systemProgram
function createCollectionIx({ collection, payer, name, uri, updateAuthority }) {
  return new TransactionInstruction({ programId: CORE, keys: [
    { pubkey: collection, isSigner: true, isWritable: true }, updateAuthority ? { pubkey: updateAuthority, isSigner: false, isWritable: false } : NONE,
    { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }],
  data: Buffer.concat([Buffer.from([1]), strEnc(name), strEnc(uri), Buffer.from([0])]) });
}
// CreateV1 into a collection: asset(signer,w), collection(w), authority(signer: collection update authority), payer(signer,w), owner, updateAuthority(opt), systemProgram, logWrapper(opt)
function createAssetIx({ asset, collection, authority, payer, owner, name, uri }) {
  return new TransactionInstruction({ programId: CORE, keys: [
    { pubkey: asset, isSigner: true, isWritable: true }, { pubkey: collection, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: owner, isSigner: false, isWritable: false }, NONE,
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, NONE],
  data: Buffer.concat([Buffer.from([0, 0]), strEnc(name), strEnc(uri), Buffer.from([0])]) });
}

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const fingerprintOf = (traits) => crypto.createHash('sha256').update(JSON.stringify(canon(traits))).digest('hex');
// Deterministic asset keypair: the same (collection, key) always yields the same address.
function assetKeypair(secret, collection, key) {
  const seed = crypto.createHmac('sha256', secret).update('asset:' + collection + ':' + key).digest();
  return Keypair.fromSeed(seed);
}

function cleanText(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max); }
function attributesFromTraits(traits) {
  if (Array.isArray(traits)) return traits.slice(0, 40).map((t) => ({ trait_type: cleanText(t.trait_type, 32), value: cleanText(t.value, 64) }));
  if (!traits || typeof traits !== 'object') throw new Error('traits required');
  return Object.keys(traits).sort().slice(0, 40).map((k) => ({ trait_type: cleanText(k, 32), value: cleanText(Array.isArray(traits[k]) ? traits[k].join(', ') : traits[k], 64) }));
}
// SVG safety: we host user-influenced SVG, so reject anything active.
function checkSvg(svg) {
  if (typeof svg !== 'string' || svg.length > 120000 || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) throw new Error('image must be an SVG under 120 KB');
  if (/<script|<foreignObject|<iframe|<object|<embed|<!ENTITY|<!DOCTYPE|\son[a-z]+\s*=|javascript:|@import|url\(\s*["']?\s*(?!#)/i.test(svg)) throw new Error('SVG contains disallowed content');
  for (const m of svg.matchAll(/href\s*=\s*(["'])(.*?)\1/gi)) if (!/^(#|data:image\/(png|jpeg|webp);base64,)/i.test(m[2].trim())) throw new Error('SVG contains disallowed content');
  return svg;
}
function safeUrl(u) { try { const x = new URL(u); return ['https:', 'ipfs:'].includes(x.protocol) ? x.toString() : null; } catch { return null; } }

function buildMetadata({ kind, cfg, id, name, description, image, attributes, extra = {} }) {
  const col = cfg.collections[kind];
  return {
    name, symbol: col.symbol, description: cleanText(description, 400), image, external_url: cfg.publicBase || undefined,
    attributes, properties: { category: 'image', files: [{ uri: image, type: image.endsWith('.svg') ? 'image/svg+xml' : 'image/png' }] },
    collection: { name: col.name, family: 'VW Fest Show Grounds' }, ...extra,
  };
}


// ---------- SSRF-safe fetch of user-controlled metadata URIs (NFT-as-avatar) ----------
// https only (ipfs:// is mapped to a public gateway), port 443, every address the name resolves to must be public (checked inside the
// connection's own DNS lookup, so DNS rebinding cannot swap it afterwards), redirects re-validated hop by hop (max 3), 8 s timeout, 200 KB cap,
// JSON only. Optional host allowlist (NFT_METADATA_HOSTS).
function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;           // this-net, private, loopback, multicast/reserved
    if (a === 100 && b >= 64 && b <= 127) return false;                        // CGNAT
    if (a === 169 && b === 254) return false;                                  // link-local incl. 169.254.169.254 cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false; if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false; if (a === 198 && (b === 18 || b === 19)) return false; // IETF protocol / benchmarking
    return true;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l); if (m) return isPublicIp(m[1]);
    const h = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(l); if (h) { const x = parseInt(h[1], 16), y = parseInt(h[2], 16); return isPublicIp(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`); }
    if (l === '::' || l === '::1') return false;
    if (/^f[cd]/.test(l) || /^fe[89ab]/.test(l) || /^ff/.test(l)) return false; // ULA, link-local, multicast
    if (l.startsWith('64:ff9b:') || l.startsWith('2001:db8') || l.startsWith('2002:')) return false; // NAT64 / docs / 6to4 (can embed private v4)
    return true;
  }
  return false;
}
function pinnedLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || !addrs.every((a) => isPublicIp(a.address))) return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
    if (options && options.all) return cb(null, addrs); cb(null, addrs[0].address, addrs[0].family);
  });
}
function resolveMetaUrl(u, gateway) {
  let x; try { x = new URL(u); } catch { throw new Error('bad url'); }
  if (x.protocol === 'ipfs:') return new URL(`${gateway || 'https://gateway.pinata.cloud'}/ipfs/${(x.hostname + x.pathname).replace(/^\/+/, '')}`);
  if (x.protocol !== 'https:') throw new Error('https only');
  return x;
}
function checkMetaTarget(x, allowHosts) {
  if (x.username || x.password) throw new Error('credentials in url');
  if (x.port && x.port !== '443') throw new Error('port not allowed');
  const host = x.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('blocked host');
  if (net.isIP(host) && !isPublicIp(host)) throw new Error('blocked address');
  if (allowHosts && allowHosts.length && !allowHosts.some((h) => host === h || host.endsWith('.' + h))) throw new Error('host not allowed');
}
// opts: { gateway, allowHosts, transport (tests), lookup (tests), maxBytes, timeoutMs, maxRedirects }
async function safeGetJson(url, opts = {}) {
  const { gateway, allowHosts, transport = https, lookup = pinnedLookup, maxBytes = 200000, timeoutMs = 8000, maxRedirects = 3 } = opts;
  let x = resolveMetaUrl(url, gateway);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    checkMetaTarget(x, allowHosts);
    const res = await new Promise((resolve, reject) => {
      const req = transport.request({ protocol: 'https:', hostname: x.hostname.replace(/^\[|\]$/g, ''), port: 443, path: x.pathname + x.search, method: 'GET', lookup, timeout: timeoutMs, headers: { accept: 'application/json', 'user-agent': 'vwfest-showgrounds' } }, resolve);
      const t = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs); req.on('close', () => clearTimeout(t));
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end();
    });
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); x = resolveMetaUrl(new URL(res.headers.location, x).toString(), gateway); continue; }
    if (res.statusCode !== 200) { res.resume(); throw new Error('http ' + res.statusCode); }
    if (!/json/i.test(String(res.headers['content-type'] || ''))) { res.resume(); throw new Error('not json'); }
    if (+(res.headers['content-length'] || 0) > maxBytes) { res.destroy(); throw new Error('too large'); }
    const chunks = []; let n = 0;
    await new Promise((resolve, reject) => { res.on('data', (c) => { n += c.length; if (n > maxBytes) { res.destroy(); reject(new Error('too large')); } else chunks.push(c); }); res.on('end', resolve); res.on('error', reject); res.on('aborted', () => reject(new Error('aborted'))); });
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  throw new Error('too many redirects');
}

// ---- AssetV1 account parsing (Borsh): key u8(1) | owner 32 | update_authority enum(u8 [+32]) | name str | uri str ----
function parseAsset(data) {
  const b = Buffer.from(data); if (b[0] !== 1) return null;
  let o = 1; const owner = new PublicKey(b.subarray(o, o + 32)).toBase58(); o += 32;
  const t = b[o++]; let ua = null; if (t === 1 || t === 2) { ua = { type: t === 1 ? 'address' : 'collection', address: new PublicKey(b.subarray(o, o + 32)).toBase58() }; o += 32; }
  const rs = () => { const n = b.readUInt32LE(o); o += 4; const s = b.toString('utf8', o, o + n); o += n; return s; };
  return { owner, updateAuthority: ua, name: rs(), uri: rs() };
}

// ---- Ownership lookup: DAS if the RPC supports it, else getProgramAccounts on Core (works on any RPC) ----
async function rpcCall(url, method, params, fetchImpl = fetch) {
  const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12000) });
  const j = await r.json(); if (j.error) { const e = new Error(j.error.message || 'rpc error'); e.code = j.error.code; throw e; } return j.result;
}
async function ownedNfts({ cfg, conn, wallet, limit = 60, fetchImpl = fetch }) {
  const out = []; const w = new PublicKey(wallet).toBase58();
  if (cfg.dasUrl) {
    try {
      const r = await rpcCall(cfg.dasUrl, 'getAssetsByOwner', { ownerAddress: w, page: 1, limit, displayOptions: { showCollectionMetadata: false } }, fetchImpl);
      for (const a of r.items || []) {
        if (a.burnt || (a.interface !== 'V1_NFT' && a.interface !== 'MplCoreAsset' && a.interface !== 'ProgrammableNFT')) continue;
        const image = safeUrl((a.content && a.content.links && a.content.links.image) || (a.content && a.content.files && a.content.files[0] && a.content.files[0].uri) || '');
        out.push({ asset: a.id, name: cleanText(a.content && a.content.metadata && a.content.metadata.name, 64), image, standard: a.interface, collection: (a.grouping || []).find((g) => g.group_key === 'collection')?.group_value || null });
      }
      return { source: 'das', items: out };
    } catch (e) { if (e.code !== -32601 && !/method/i.test(e.message)) throw e; /* no DAS: fall through */ }
  }
  // Fallback: Core assets owned by wallet. Filter: key byte 1 (AssetV1) at offset 0 and owner at offset 1.
  const accs = await conn.getProgramAccounts(CORE, { filters: [{ memcmp: { offset: 0, bytes: '2' } }, { memcmp: { offset: 1, bytes: w } }], dataSlice: undefined });
  for (const a of accs.slice(0, limit)) { const p = parseAsset(a.account.data); if (!p) continue; out.push({ asset: a.pubkey.toBase58(), name: cleanText(p.name, 64), uri: safeUrl(p.uri), image: null, standard: 'MplCoreAsset', collection: p.updateAuthority && p.updateAuthority.type === 'collection' ? p.updateAuthority.address : null }); }
  return { source: 'core-gpa', items: out };
}
// Re-verify at selection time that `wallet` owns `asset` (never trust the client).
async function verifyOwnership({ cfg, conn, wallet, asset, fetchImpl = fetch }) {
  if (!C.isKey(asset)) return null;
  const info = await conn.getAccountInfo(new PublicKey(asset), 'confirmed'); if (!info) return null;
  if (info.owner.equals(CORE)) { const p = parseAsset(info.data); if (!p || p.owner !== wallet) return null; return { asset, name: cleanText(p.name, 64), standard: 'MplCoreAsset', uri: safeUrl(p.uri), collection: p.updateAuthority && p.updateAuthority.type === 'collection' ? p.updateAuthority.address : null }; }
  // Legacy NFT (SPL mint, supply 1, decimals 0): confirm the wallet holds exactly 1 via the largest token account.
  try {
    const big = await conn.getTokenLargestAccounts(new PublicKey(asset)); const top = big.value[0]; if (!top || top.uiAmount !== 1 || top.decimals !== 0) return null;
    const acc = await conn.getParsedAccountInfo(top.address); const owner = acc.value && acc.value.data && acc.value.data.parsed && acc.value.data.parsed.info.owner; if (owner !== wallet) return null;
    let name = '', image = null; if (cfg.dasUrl) { try { const a = await rpcCall(cfg.dasUrl, 'getAsset', { id: asset }, fetchImpl); name = cleanText(a.content?.metadata?.name, 64); image = safeUrl(a.content?.links?.image || ''); } catch {} }
    return { asset, name, image, standard: 'LegacyNFT', collection: null };
  } catch { return null; }
}
module.exports = { isPublicIp, safeGetJson, pinnedLookup, createCollectionIx, createAssetIx, fingerprintOf, assetKeypair, attributesFromTraits, checkSvg, safeUrl, cleanText, buildMetadata, parseAsset, ownedNfts, verifyOwnership, rpcCall, CORE };
