// Non-custodial purchase builder (lazy chunk). The player's own wallet signs; no project wallet ever holds funds.
//  tx = [compute budget] + [Jupiter swap SOL -> $VWFEST for the swap share] + [SOL fee to creator wallet, if any] + SPL burn + [Core NFT create] + memo
import { audit, auditMessage, sameMessage, pinSource } from './txaudit.mjs';
import { rpcFetch } from './rpc.mjs';
import { assertTop } from './frame.js';
import { Connection, PublicKey, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram, ComputeBudgetProgram, AddressLookupTableAccount } from '@solana/web3.js';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), TOKEN22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROG = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', WSOL = 'So11111111111111111111111111111111111111112';
const WSOL_MINT = new PublicKey(WSOL);
// Flatten a compiled (v0) transaction for the pure auditor: every account key (lookup tables resolved), each instruction's program/accounts/data.
function decompile(tx, alts) {
  const m = tx.message; const ak = m.getAccountKeys({ addressLookupTableAccounts: alts }); const keys = []; for (let i = 0; i < ak.length; i++) keys.push(ak.get(i).toBase58());
  return { keys, ixs: m.compiledInstructions.map((ix) => ({ p: ix.programIdIndex, a: Array.from(ix.accountKeyIndexes), d: ix.data })), numSigners: m.header.numRequiredSignatures };
}
// Runs on the exact transaction object that is about to be signed (build time AND again right before the wallet prompt, from a fresh decode of its bytes).
export function auditTx(tx, ctx) { return auditMessage(decompile(tx, ctx.alts), ctx.c); }
// Defence in depth on top of the instruction audit: Jupiter's route carries ~30 opaque AMM accounts, and none of them may be a token account OWNED BY THE PLAYER except `allowed`
// (isolated temp account, $VWFEST account, wSOL account). Refuses if the check cannot run. 25 keys per call = the /api/rpc getMultipleAccounts cap.
export async function assertNoStrayUserTokenAccounts(conn, ixs, user, allowed) {
  const keys = new Set(); for (const i of ixs) for (const a of i.accounts) keys.add(a.pubkey); for (const x of allowed) keys.delete(x); keys.delete(user.toBase58()); const list = [...keys]; const ub = user.toBytes();
  for (let o = 0; o < list.length; o += 25) { const infos = await conn.getMultipleAccountsInfo(list.slice(o, o + 25).map((k) => new PublicKey(k)), 'confirmed');
    for (const info of infos) if (info && (info.owner.equals(TOKEN) || info.owner.equals(TOKEN22)) && info.data.length >= 165 && info.data.subarray(32, 64).every((x, n) => x === ub[n])) throw new Error('Swap route touches another token account of yours. Aborted for your safety.'); }
}
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const str = (s) => { const e = new TextEncoder().encode(s); const l = new Uint8Array(4); new DataView(l.buffer).setUint32(0, e.length, true); return [l, e]; };
const cat = (...a) => { const f = a.flat(); const n = f.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of f) { o.set(x, p); p += x.length; } return o; };

export function getProvider() { return (window.phantom && window.phantom.solana) || window.solana || window.solflare || null; }
export async function connectWallet() { assertTop(); const p = getProvider(); if (!p) throw new Error('No Solana wallet found. Install Phantom (phantom.app) and reload.'); const r = await p.connect(); const pk = r && r.publicKey ? r.publicKey : p.publicKey; return { provider: p, pubkey: new PublicKey(pk.toString()) }; }

const ix = (j) => new TransactionInstruction({ programId: new PublicKey(j.programId), keys: j.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Uint8Array.from(atob(j.data), (c) => c.charCodeAt(0)) });
async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error('Price service error (' + r.status + ')'); return r.json(); }

// Funding sources: 'sol' (Jupiter ExactIn SOL -> $VWFEST), 'token' (Jupiter ExactOut: any SPL token -> exactly the burn amount), 'direct' ($VWFEST already held / test mode).
//  opts.payToken: { mint, sym, dec } to pay with an SPL token instead of SOL (e.g. USDC, BONK).
async function build({ q, cfg, conn, user, mint, tokenProg, ata, swapLamports, payToken, onStep }) {
  const ixs = []; const alts = []; let burn = BigInt(q.burnRaw), swapInfo = null, simTok = null;
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 });
  const wsolAta = PublicKey.findProgramAddressSync([user.toBytes(), TOKEN.toBytes(), WSOL_MINT.toBytes()], ATA_PROG)[0].toBase58(); let swapCtx = null;
  const isoPre = [], isoPost = []; // isolation prelude/postlude for token-funded swaps (see below)
  // iso (token-funded swaps only): { temp, main, mint, dec, amount, maxRent }. Jupiter's route is rewritten to take its input from the isolated temp account; the player's own token account (main) may appear in no route instruction.
  const swapIxs = async (qs, maxLamports, maxSwapIn, iso) => {
    const res = await fetch(`${cfg.jupiter}/swap-instructions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: qs, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: false }) });
    if (!res.ok) throw new Error('Swap service error (' + res.status + ')'); const j = await res.json(); if (j.error) throw new Error('Swap service: ' + j.error);
    const swapIx = iso ? pinSource(j.swapInstruction, iso.temp, iso.main) : j.swapInstruction; // the route as Jupiter built it must have used the player's own account; we move it to the isolated one
    const all = [...(j.computeBudgetInstructions || []), ...(j.setupInstructions || []), swapIx, ...(j.cleanupInstruction ? [j.cleanupInstruction] : [])]; const route = { dest: ata.toBase58(), minOut: BigInt(qs.otherAmountThreshold), maxSlippageBps: cfg.slippageBps, quotedOut: BigInt(qs.outAmount) }; // the output must land in the player's own $VWFEST account and cover the burn
    audit(all, maxLamports, { user: user.toBase58(), wsolAta, maxSwapIn, source: iso ? iso.temp : wsolAta, forbid: iso ? [iso.main] : undefined, ...route }); swapCtx = { maxLamports, maxSwapIn, wsolAta, dest: route.dest, maxSlippageBps: route.maxSlippageBps, quotedOut: route.quotedOut, iso: iso || null };
    await assertNoStrayUserTokenAccounts(conn, [swapIx], user, [wsolAta, ata.toBase58(), ...(iso ? [iso.temp] : [])]);
    for (const a of j.addressLookupTableAddresses || []) { const acc = await conn.getAccountInfo(new PublicKey(a)); if (acc) alts.push(new AddressLookupTableAccount({ key: new PublicKey(a), state: AddressLookupTableAccount.deserialize(acc.data) })); }
    for (const i of j.computeBudgetInstructions || []) ixs.push(ix(i)); for (const i of isoPre) ixs.push(i); for (const i of j.setupInstructions || []) ixs.push(ix(i)); ixs.push(ix(swapIx)); if (j.cleanupInstruction) ixs.push(ix(j.cleanupInstruction)); for (const i of isoPost) ixs.push(i);
  };
  if (payToken) {
    if (!q.swap) throw new Error('Paying with other tokens needs mainnet liquidity (test networks have none).');
    onStep && onStep(`Getting the best ${payToken.sym} → $VWFEST route from Jupiter…`);
    const target = BigInt(q.burnRaw) * 995n / 1000n; if (target < BigInt(q.burnMin)) throw new Error('Price error. Please start again.');
    // 1) price discovery (ExactOut): how much of the token buys the burn amount. 2) the swap itself is ExactIn of exactly that quoted maximum, so the player's exposure is a number we fix up front.
    const qo = await jget(`${cfg.jupiter}/quote?inputMint=${payToken.mint}&outputMint=${cfg.mint}&amount=${target}&swapMode=ExactOut&slippageBps=${cfg.slippageBps}&restrictIntermediateTokens=true&maxAccounts=40`);
    const maxIn = BigInt(qo.otherAmountThreshold); if (maxIn <= 0n) throw new Error('Price error. Please start again.');
    const qs = await jget(`${cfg.jupiter}/quote?inputMint=${payToken.mint}&outputMint=${cfg.mint}&amount=${maxIn}&swapMode=ExactIn&slippageBps=${cfg.slippageBps}&restrictIntermediateTokens=true&maxAccounts=40`);
    const minOut = BigInt(qs.otherAmountThreshold); if (BigInt(qs.inAmount) !== maxIn || minOut < BigInt(q.burnMin)) throw new Error('Swap route returned too little $VWFEST. Aborted.');
    const tmint = new PublicKey(payToken.mint); const tinfo = await conn.getAccountInfo(tmint); if (!tinfo) throw new Error(payToken.sym + ' mint not found.');
    if (!tinfo.owner.equals(TOKEN)) throw new Error(payToken.sym + ' cannot be used to pay (only standard SPL tokens are supported for swaps).');
    const [tata] = PublicKey.findProgramAddressSync([user.toBytes(), TOKEN.toBytes(), tmint.toBytes()], ATA_PROG);
    const bal = await conn.getTokenAccountBalance(tata).catch(() => null); const have = bal ? BigInt(bal.value.amount) : 0n;
    if (have < maxIn) throw new Error(`You need up to ${Number(maxIn) / 10 ** payToken.dec} ${payToken.sym} in this wallet (you have ${Number(have) / 10 ** payToken.dec}).`);
    // Isolation: exactly maxIn moves into a temporary account (createAccountWithSeed from the player: no extra signer), the route runs on THAT account only, and it is closed (rent back) afterwards.
    const rnd = crypto.getRandomValues(new Uint8Array(8)); const seed = Array.from(rnd, (x) => x.toString(16).padStart(2, '0')).join(''); const temp = await PublicKey.createWithSeed(user, seed, TOKEN); const rent = await conn.getMinimumBalanceForRentExemption(165);
    isoPre.push(SystemProgram.createAccountWithSeed({ fromPubkey: user, newAccountPubkey: temp, basePubkey: user, seed, lamports: rent, space: 165, programId: TOKEN }),
      new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: temp, isSigner: false, isWritable: true }, { pubkey: tmint, isSigner: false, isWritable: false }], data: cat([Uint8Array.of(18)], [user.toBytes()]) }), // InitializeAccount3 (owner = the player)
      new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: tata, isSigner: false, isWritable: true }, { pubkey: tmint, isSigner: false, isWritable: false }, { pubkey: temp, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: cat([Uint8Array.of(12)], u64(maxIn), Uint8Array.of(payToken.dec)) })); // transferChecked: the ONE move of the pay token
    isoPost.push(new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: temp, isSigner: false, isWritable: true }, { pubkey: user, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: Uint8Array.of(9) })); // closeAccount (balance is 0 after an ExactIn swap), rent back to the player
    simTok = { addr: tata, before: have, max: maxIn }; await swapIxs(qs, BigInt(rent) + 6000000n, maxIn, { temp: temp.toBase58(), main: tata.toBase58(), mint: payToken.mint, dec: payToken.dec, amount: maxIn, maxRent: BigInt(rent) + 1000n });
    burn = minOut; swapInfo = { expectOut: BigInt(qs.outAmount), minOut, inSym: payToken.sym, maxIn, inDec: payToken.dec };
  } else if (q.method === 'sol' && q.swap) {
    onStep && onStep('Getting the best $VWFEST route from Jupiter…');
    const sw = swapLamports;
    const qs = await jget(`${cfg.jupiter}/quote?inputMint=${WSOL}&outputMint=${cfg.mint}&amount=${sw}&slippageBps=${cfg.slippageBps}&onlyDirectRoutes=true&restrictIntermediateTokens=true`);
    const minOut = BigInt(qs.otherAmountThreshold); if (minOut < BigInt(q.burnMin)) throw new Error('The $VWFEST price moved, or your wallet holds too little SOL for this purchase. Please start again.');
    await swapIxs(qs, sw + 6000000n, sw); burn = minOut; swapInfo = { expectOut: BigInt(qs.outAmount), minOut, swapLamports: sw };
  } else {
    ixs.push(budget);
    if (q.method === 'vwfest' || !q.swap) { // paying in tokens you already hold (or test-network mode)
      const bal = await conn.getTokenAccountBalance(ata).catch(() => null); const have = bal ? BigInt(bal.value.amount) : 0n;
      if (have < burn) throw new Error(cfg.network !== 'mainnet-beta' && !q.swap ? `Test network (${cfg.network}): purchases burn TEST $VWFEST (no real money, and no swap exists on a test network). This wallet holds ${Number(have) / 10 ** cfg.decimals} test $VWFEST and needs ${Number(burn) / 10 ** cfg.decimals}. Ask the team for test tokens.` : `You need ${Number(burn) / 10 ** cfg.decimals} $VWFEST in this wallet, but it holds ${Number(have) / 10 ** cfg.decimals}.`);
    }
  }
  if (BigInt(q.devLamports) > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(q.devWallet), lamports: BigInt(q.devLamports) }));
  ixs.push(new TransactionInstruction({ programId: tokenProg, keys: [{ pubkey: ata, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: cat([Uint8Array.of(15)], u64(burn), Uint8Array.of(cfg.decimals)) })); // burnChecked: the only burn the server verifies (and the mint decimals are enforced on-chain)
  let asset = null;
  if (q.uri) { asset = Keypair.generate(); const P = CORE; const none = { pubkey: P, isSigner: false, isWritable: false };
    ixs.push(new TransactionInstruction({ programId: CORE, keys: [{ pubkey: asset.publicKey, isSigner: true, isWritable: true }, none, none, { pubkey: user, isSigner: true, isWritable: true }, none, none, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, none], data: cat(Uint8Array.of(0, 0), ...str(q.name || 'VW FEST NFT'), ...str(q.uri), Uint8Array.of(0)) })); }
  ixs.push(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: user, isSigner: true, isWritable: false }], data: new TextEncoder().encode('vwfest:' + q.id) }));
  onStep && onStep('Checking the transaction…');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts); const tx = new VersionedTransaction(msg); if (asset) tx.sign([asset]);
  const auditCtx = { alts, c: { user: user.toBase58(), mint: cfg.mint, ata: ata.toBase58(), decimals: cfg.decimals, burn, memo: 'vwfest:' + q.id, devWallet: BigInt(q.devLamports) > 0n ? q.devWallet : '', devLamports: BigInt(q.devLamports), asset: asset ? asset.publicKey.toBase58() : null, name: q.name || 'VW FEST NFT', uri: q.uri || '', swap: swapCtx } };
  auditTx(tx, auditCtx); // 1st audit: the compiled transaction, before it is simulated or shown
  const size = tx.serialize().length; if (size > 1232) throw new Error(`Transaction too large (${size} bytes). Try again; the route may have changed.`);
  const pre = await conn.getBalance(user, 'confirmed'); const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [user.toBase58(), ...(simTok ? [simTok.addr.toBase58()] : [])] } });
  if (sim.value.err) throw new Error('This purchase would fail on-chain: ' + JSON.stringify(sim.value.err).slice(0, 140) + (sim.value.logs ? ' · ' + (sim.value.logs.filter((l) => /error|insufficient|failed/i.test(l)).slice(-1)[0] || '') : ''));
  if (simTok) { const a1 = sim.value.accounts && sim.value.accounts[1]; if (!a1 || !a1.data) throw new Error('Could not check how much of your token the swap uses. Aborted.'); const raw = Uint8Array.from(atob(a1.data[0]), (c) => c.charCodeAt(0)); const after = new DataView(raw.buffer).getBigUint64(64, true); if (simTok.before - after > simTok.max) throw new Error('Simulation shows the swap taking more of your token than quoted. Aborted.'); } // belt and braces on top of the instruction-data bound
  const post = sim.value.accounts && sim.value.accounts[0] ? sim.value.accounts[0].lamports : null; const spentLamports = post === null ? null : pre - post;
  return { auditCtx, tx, asset, conn, burn, blockhash, lastValidBlockHeight, swapInfo, spentLamports, size, units: sim.value.unitsConsumed, user, ata, balance: BigInt(pre) };
}
export async function prepare({ q, cfg, server, pubkey, onStep, payToken }) {
  assertTop();
  // The browser talks to the public RPC directly (simulate + broadcast): the game server has no transaction relay by design. Reads could use /api/rpc, but one endpoint keeps it simple.
  const cbase = { commitment: 'confirmed', disableRetryOnRateLimit: true }; // simulate + broadcast MUST go to the public RPC (the proxy is read-only); the proxy (with the session token) is only a fallback for reads when no public RPC is configured
  const conn = cfg.publicRpcUrl ? new Connection(cfg.publicRpcUrl, cbase) : new Connection(server + '/api/rpc', { ...cbase, fetch: rpcFetch });
  const mint = new PublicKey(cfg.mint), user = pubkey; const mintInfo = await conn.getAccountInfo(mint); if (!mintInfo) throw new Error('$VWFEST mint not found on this network.');
  const tokenProg = mintInfo.owner.equals(TOKEN22) ? TOKEN22 : TOKEN;
  const [ata] = PublicKey.findProgramAddressSync([user.toBytes(), tokenProg.toBytes(), mint.toBytes()], ATA_PROG);
  const base = { q, cfg, conn, user, mint, tokenProg, ata, payToken, onStep };
  return build({ ...base, swapLamports: BigInt(q.swapLamports) });
}
export async function signAndSend(prep, provider, onStep) {
  assertTop();
  onStep && onStep('Approve in your wallet…');
  // Re-audit the EXACT bytes that go to the wallet: decode them afresh, audit that, sign that, and require the wallet to return the same message.
  const toSign = VersionedTransaction.deserialize(prep.tx.serialize()); auditTx(toSign, prep.auditCtx); const audited = toSign.message.serialize();
  const signed = await provider.signTransaction(toSign);
  if (!signed || !signed.message || !sameMessage(signed.message.serialize(), audited)) throw new Error('Your wallet returned a different transaction than the one shown. Nothing was sent.');
  onStep && onStep('Sending…');
  const raw = signed.serialize(); const sig = await prep.conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
  onStep && onStep('Confirming on Solana…'); const t0 = Date.now();
  for (;;) {
    const st = await prep.conn.getSignatureStatuses([sig], { searchTransactionHistory: false }); const v = st.value[0];
    if (v && v.err) throw new Error('Transaction failed on-chain: ' + JSON.stringify(v.err).slice(0, 120));
    if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) return sig;
    if (Date.now() - t0 > 75000) throw Object.assign(new Error('Still confirming. Your transaction was sent; check Solscan, then press Retry to record it.'), { sig, pending: true });
    await new Promise((r) => setTimeout(r, 1500));
  }
}
