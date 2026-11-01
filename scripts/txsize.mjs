// Measures the serialized size of the purchase transaction the browser builds (src/pay.js build()), against the 1232-byte packet limit, with REAL Jupiter routes (read-only quote + swap-instructions
// for a throw-away user key; nothing is signed or sent) and real address lookup tables fetched over RPC. Usage: node scripts/txsize.mjs [usd=2] [tokenMint=USDC] [maxAccounts=40]
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
import { Connection, PublicKey, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram, ComputeBudgetProgram, AddressLookupTableAccount } from '@solana/web3.js';
const quoteid = require('../lib/quoteid.js');
const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com', JUP = process.env.JUP || 'https://api.jup.ag/swap/v1';
const MINT = '9ktd1qdiu9wRFhxHPczWKrKRGmJb9nkanv2Zz27Rpump', WSOL = 'So11111111111111111111111111111111111111112', USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), ATA_PROG = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const usd = +(process.argv[2] || 2), tokenMint = process.argv[3] || USDC, maxAccounts = +(process.argv[4] || 40);
const conn = new Connection(RPC, 'confirmed'); const user = Keypair.generate().publicKey, devWallet = new PublicKey('DV4gtG2VpnDtFUVFnnrE5YM3A6LrV5qAcdfaaUwLFRok');
let last = 0; const GAP = +(process.env.JUP_GAP_MS || 2200); // keyless Jupiter is 0.5 req/s; set JUP_GAP_MS=1100 with a free key (x-api-key via JUP_KEY)
const j = async (u, init = {}) => { for (let i = 0; i < 5; i++) { const w = last + GAP - Date.now(); if (w > 0) await new Promise((r2) => setTimeout(r2, w)); last = Date.now(); if (process.env.JUP_KEY) init = { ...init, headers: { ...(init.headers || {}), 'x-api-key': process.env.JUP_KEY } }; const r = await fetch(u, init); if (r.status === 429) { await new Promise((r2) => setTimeout(r2, 3000)); continue; } if (!r.ok) throw new Error(u.slice(0, 80) + ' -> ' + r.status); return r.json(); } throw new Error('rate limited'); };
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const cat = (...a) => { const f = a.flat(); const n = f.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of f) { o.set(x, p); p += x.length; } return o; };
const str = (s) => { const e = new TextEncoder().encode(s); const l = new Uint8Array(4); new DataView(l.buffer).setUint32(0, e.length, true); return [l, e]; };
const ix = (i) => new TransactionInstruction({ programId: new PublicKey(i.programId), keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(i.data, 'base64') });
async function measure({ label, kind, memo, nft }) {
  // price the burn: $usd, half to the creator fee, half swapped (SOL pays), exactly like a shop/booth purchase paid with a token
  const sol = (await j(`https://api.jup.ag/price/v3?ids=${WSOL}`))[WSOL].usdPrice; const total = BigInt(Math.ceil((usd / sol) * 1e9)), dev = total / 2n;
  const burnQ = await j(`${JUP}/quote?inputMint=${WSOL}&outputMint=${MINT}&amount=${total - dev}&slippageBps=50&onlyDirectRoutes=true&restrictIntermediateTokens=true`); const target = BigInt(burnQ.outAmount) * 995n / 1000n;
  // Jupiter has NO ExactOut route for $VWFEST (pump AMM), so price discovery is an ExactIn probe: 1 unit of the pay token gives the rate, then maxIn = target / rate + 3%.
  const dTok = (await conn.getParsedAccountInfo(new PublicKey(tokenMint))).value.data.parsed.info.decimals; const probe = await j(`${JUP}/quote?inputMint=${tokenMint}&outputMint=${MINT}&amount=${10n ** BigInt(dTok)}&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true&maxAccounts=${maxAccounts}`);
  const maxIn = (target * BigInt(10 ** dTok) * 103n) / (BigInt(probe.outAmount) * 100n) + 1n;
  const qs = await j(`${JUP}/quote?inputMint=${tokenMint}&outputMint=${MINT}&amount=${maxIn}&swapMode=ExactIn&slippageBps=50&restrictIntermediateTokens=true&maxAccounts=${maxAccounts}`);
  const sw = await j(`${JUP}/swap-instructions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: qs, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: false }) });
  const tmint = new PublicKey(tokenMint), tata = PublicKey.findProgramAddressSync([user.toBytes(), TOKEN.toBytes(), tmint.toBytes()], ATA_PROG)[0], seed = '0123456789abcdef', temp = await PublicKey.createWithSeed(user, seed, TOKEN);
  const mintPk = new PublicKey(MINT), ata = PublicKey.findProgramAddressSync([user.toBytes(), TOKEN.toBytes(), mintPk.toBytes()], ATA_PROG)[0]; const dec = 6;
  const ixs = []; for (const i of sw.computeBudgetInstructions || []) ixs.push(ix(i));
  ixs.push(SystemProgram.createAccountWithSeed({ fromPubkey: user, newAccountPubkey: temp, basePubkey: user, seed, lamports: 2039280, space: 165, programId: TOKEN }),
    new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: temp, isSigner: false, isWritable: true }, { pubkey: tmint, isSigner: false, isWritable: false }], data: cat([Uint8Array.of(18)], [user.toBytes()]) }),
    new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: tata, isSigner: false, isWritable: true }, { pubkey: tmint, isSigner: false, isWritable: false }, { pubkey: temp, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: cat([Uint8Array.of(12)], u64(maxIn), Uint8Array.of(6)) }));
  for (const i of sw.setupInstructions || []) ixs.push(ix(i)); ixs.push(ix(sw.swapInstruction)); if (sw.cleanupInstruction) ixs.push(ix(sw.cleanupInstruction));
  ixs.push(new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: temp, isSigner: false, isWritable: true }, { pubkey: user, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: Uint8Array.of(9) }));
  ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: devWallet, lamports: dev }));
  ixs.push(new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: ata, isSigner: false, isWritable: true }, { pubkey: mintPk, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: cat([Uint8Array.of(15)], u64(BigInt(qs.otherAmountThreshold)), Uint8Array.of(dec)) }));
  let asset = null; if (nft) { asset = Keypair.generate(); const none = { pubkey: CORE, isSigner: false, isWritable: false }; ixs.push(new TransactionInstruction({ programId: CORE, keys: [{ pubkey: asset.publicKey, isSigner: true, isWritable: true }, none, none, { pubkey: user, isSigner: true, isWritable: true }, none, none, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, none], data: cat(Uint8Array.of(0, 0), ...str('VW FEST Avatar'), ...str(nft), Uint8Array.of(0)) })); }
  ixs.push(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: user, isSigner: true, isWritable: false }], data: new TextEncoder().encode(memo) }));
  const alts = []; for (const a of sw.addressLookupTableAddresses || []) { const acc = await conn.getAccountInfo(new PublicKey(a)); if (acc) alts.push(new AddressLookupTableAccount({ key: new PublicKey(a), state: AddressLookupTableAccount.deserialize(acc.data) })); }
  const msg = new TransactionMessage({ payerKey: user, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message(alts); const hops = qs.routePlan.length; let size;
  try { const tx = new VersionedTransaction(msg); if (asset) tx.sign([asset]); size = tx.serialize().length; } catch (e) { return { label, hops, alts: alts.length, ixs: ixs.length, memoBytes: memo.length, size: null, spare: null, note: 'TOO LARGE: web3.js cannot serialize the message (it overruns the 1232-byte packet)' }; }
  return { label, hops, alts: alts.length, ixs: ixs.length, memoBytes: memo.length, size, spare: 1232 - size, userSigPlaceholder: 'included (64B)' };
}
const secret = 'x'.repeat(40), exp = Date.now() + 6e5;
const ids = { shop: quoteid.sign(secret, { kind: 'shop', method: 'sol', pid: 'VW-ABCDEFGH', item: 'rainbow_beanie', burnMin: '104238952477', devMin: '4900000', expires: exp }), vendor: quoteid.sign(secret, { kind: 'vendor', method: 'sol', pid: 'VW-ABCDEFGH', plot: 12, burnMin: '104238952477', devMin: '4900000', expires: exp }),
  avatar: quoteid.sign(secret, { kind: 'avatar', method: 'sol', pid: 'VW-ABCDEFGH', code: 'BgEABg4AAAEGAQMDARABAgQEAgEGAAQA', burnMin: '104238952477', devMin: '0', expires: exp }) };
const out = []; const run = async (o) => { try { return await measure(o); } catch (e) { return { label: o.label, error: String(e.message).slice(0, 120) }; } }; out.push(await run({ label: 'shop item', kind: 'shop', memo: 'vwfest:' + ids.shop })); out.push(await run({ label: 'booth', kind: 'vendor', memo: 'vwfest:' + ids.vendor }));
out.push(await run({ label: 'avatar NFT (token pay)', kind: 'avatar', memo: 'vwfest:' + ids.avatar, nft: 'https://vwfestmemecoin.com/nft/BgEABg4AAAEGAQMDARABAgQEAgEGAAQA.json' }));
out.push(await run({ label: 'shop item, OLD short memo (reference)', kind: 'shop', memo: 'vwfest:' + 'a'.repeat(16) }));
console.log(JSON.stringify({ usd, tokenMint, maxAccounts, memo: { shop: ids.shop.length + 7, vendor: ids.vendor.length + 7, avatar: ids.avatar.length + 7 }, results: out }, null, 1));
