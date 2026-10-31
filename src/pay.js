// Non-custodial purchase builder (lazy chunk). The player's own wallet signs; no project wallet ever holds funds.
//  tx = [compute budget] + [Jupiter swap SOL -> $VWFEST for the swap share] + [SOL fee to creator wallet, if any] + SPL burn + [Core NFT create] + memo
import { Connection, PublicKey, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram, ComputeBudgetProgram, AddressLookupTableAccount } from '@solana/web3.js';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), TOKEN22 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROG = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'), MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const CORE = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'), JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', WSOL = 'So11111111111111111111111111111111111111112';
const ALLOWED = new Set([ComputeBudgetProgram.programId.toBase58(), SystemProgram.programId.toBase58(), TOKEN.toBase58(), TOKEN22.toBase58(), ATA_PROG.toBase58(), JUP]);
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const str = (s) => { const e = new TextEncoder().encode(s); const l = new Uint8Array(4); new DataView(l.buffer).setUint32(0, e.length, true); return [l, e]; };
const cat = (...a) => { const f = a.flat(); const n = f.reduce((s, x) => s + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of f) { o.set(x, p); p += x.length; } return o; };

export function getProvider() { return (window.phantom && window.phantom.solana) || window.solana || window.solflare || null; }
export async function connectWallet() { const p = getProvider(); if (!p) throw new Error('No Solana wallet found. Install Phantom (phantom.app) and reload.'); const r = await p.connect(); const pk = r && r.publicKey ? r.publicKey : p.publicKey; return { provider: p, pubkey: new PublicKey(pk.toString()) }; }

const ix = (j) => new TransactionInstruction({ programId: new PublicKey(j.programId), keys: j.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Uint8Array.from(atob(j.data), (c) => c.charCodeAt(0)) });
async function jget(url) { const r = await fetch(url); if (!r.ok) throw new Error('Price service error (' + r.status + ')'); return r.json(); }

// Audit Jupiter's returned instructions before the wallet ever sees them.
function audit(list, maxLamports) {
  let out = 0n;
  for (const i of list) {
    if (!ALLOWED.has(i.programId)) throw new Error('Swap route used an unexpected program (' + i.programId.slice(0, 6) + '…). Aborted for your safety.');
    if (i.programId === SystemProgram.programId.toBase58()) { const d = Uint8Array.from(atob(i.data), (c) => c.charCodeAt(0)); const dv = new DataView(d.buffer); const kind = dv.getUint32(0, true);
      if (kind === 2) out += dv.getBigUint64(4, true); else if (kind === 0) out += dv.getBigUint64(4, true); else if (kind !== 8 && kind !== 9) throw new Error('Unexpected system instruction in swap route.'); }
  }
  if (out > maxLamports) throw new Error('Swap route would move more SOL than quoted. Aborted.');
}
// Funding sources: 'sol' (Jupiter ExactIn SOL -> $VWFEST), 'token' (Jupiter ExactOut: any SPL token -> exactly the burn amount), 'direct' ($VWFEST already held / test mode).
//  opts.sweepLamports: swap this much SOL instead of the quoted amount (Entry flow: burn what the on-ramp delivered, minus fees).
//  opts.payToken: { mint, sym, dec } to pay with an SPL token instead of SOL (e.g. USDC, BONK).
async function build({ q, cfg, conn, user, mint, tokenProg, ata, swapLamports, payToken, onStep }) {
  const ixs = []; const alts = []; let burn = BigInt(q.burnRaw), swapInfo = null;
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 });
  const swapIxs = async (qs, maxLamports) => {
    const res = await fetch(`${cfg.jupiter}/swap-instructions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: qs, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, dynamicSlippage: false }) });
    if (!res.ok) throw new Error('Swap service error (' + res.status + ')'); const j = await res.json(); if (j.error) throw new Error('Swap service: ' + j.error);
    const all = [...(j.computeBudgetInstructions || []), ...(j.setupInstructions || []), j.swapInstruction, ...(j.cleanupInstruction ? [j.cleanupInstruction] : [])]; audit(all, maxLamports);
    for (const a of j.addressLookupTableAddresses || []) { const acc = await conn.getAccountInfo(new PublicKey(a)); if (acc) alts.push(new AddressLookupTableAccount({ key: new PublicKey(a), state: AddressLookupTableAccount.deserialize(acc.data) })); }
    for (const i of j.computeBudgetInstructions || []) ixs.push(ix(i)); for (const i of j.setupInstructions || []) ixs.push(ix(i)); ixs.push(ix(j.swapInstruction)); if (j.cleanupInstruction) ixs.push(ix(j.cleanupInstruction));
  };
  if (payToken) {
    if (!q.swap) throw new Error('Paying with other tokens needs mainnet liquidity (test networks have none).');
    onStep && onStep(`Getting the best ${payToken.sym} → $VWFEST route from Jupiter…`);
    const target = BigInt(q.burnRaw) * 995n / 1000n; if (target < BigInt(q.burnMin)) throw new Error('Price error. Please start again.');
    const qs = await jget(`${cfg.jupiter}/quote?inputMint=${payToken.mint}&outputMint=${cfg.mint}&amount=${target}&swapMode=ExactOut&slippageBps=${cfg.slippageBps}&restrictIntermediateTokens=true&maxAccounts=40`);
    if (BigInt(qs.outAmount) < BigInt(q.burnMin)) throw new Error('Swap route returned too little $VWFEST. Aborted.');
    const maxIn = BigInt(qs.otherAmountThreshold); const tmint = new PublicKey(payToken.mint); const tinfo = await conn.getAccountInfo(tmint); if (!tinfo) throw new Error(payToken.sym + ' mint not found.');
    const tprog = tinfo.owner.equals(TOKEN22) ? TOKEN22 : TOKEN; const [tata] = PublicKey.findProgramAddressSync([user.toBytes(), tprog.toBytes(), tmint.toBytes()], ATA_PROG);
    const bal = await conn.getTokenAccountBalance(tata).catch(() => null); const have = bal ? BigInt(bal.value.amount) : 0n;
    if (have < maxIn) throw new Error(`You need up to ${Number(maxIn) / 10 ** payToken.dec} ${payToken.sym} in this wallet (you have ${Number(have) / 10 ** payToken.dec}).`);
    await swapIxs(qs, 6000000n); burn = target; swapInfo = { expectOut: target, minOut: target, inSym: payToken.sym, maxIn, inDec: payToken.dec };
  } else if (q.method === 'sol' && q.swap) {
    onStep && onStep('Getting the best $VWFEST route from Jupiter…');
    const sw = swapLamports;
    const qs = await jget(`${cfg.jupiter}/quote?inputMint=${WSOL}&outputMint=${cfg.mint}&amount=${sw}&slippageBps=${cfg.slippageBps}&onlyDirectRoutes=true&restrictIntermediateTokens=true`);
    const minOut = BigInt(qs.otherAmountThreshold); if (minOut < BigInt(q.burnMin)) throw new Error('The $VWFEST price moved, or your wallet holds too little SOL for this purchase. Please start again.');
    await swapIxs(qs, sw + 6000000n); burn = minOut; swapInfo = { expectOut: BigInt(qs.outAmount), minOut, swapLamports: sw };
  } else {
    ixs.push(budget);
    if (q.method === 'vwfest' || !q.swap) { // paying in tokens you already hold (or test-network mode)
      const bal = await conn.getTokenAccountBalance(ata).catch(() => null); const have = bal ? BigInt(bal.value.amount) : 0n;
      if (have < burn) throw new Error(`You need ${Number(burn) / 10 ** cfg.decimals} $VWFEST in this wallet, but it holds ${Number(have) / 10 ** cfg.decimals}.`);
    }
  }
  if (BigInt(q.devLamports) > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(q.devWallet), lamports: BigInt(q.devLamports) }));
  ixs.push(new TransactionInstruction({ programId: tokenProg, keys: [{ pubkey: ata, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: true }, { pubkey: user, isSigner: true, isWritable: false }], data: cat([Uint8Array.of(8)], u64(burn)) }));
  let asset = null;
  if (q.uri) { asset = Keypair.generate(); const P = CORE; const none = { pubkey: P, isSigner: false, isWritable: false };
    ixs.push(new TransactionInstruction({ programId: CORE, keys: [{ pubkey: asset.publicKey, isSigner: true, isWritable: true }, none, none, { pubkey: user, isSigner: true, isWritable: true }, none, none, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, none], data: cat(Uint8Array.of(0, 0), ...str(q.name || 'VW FEST NFT'), ...str(q.uri), Uint8Array.of(0)) })); }
  ixs.push(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: user, isSigner: true, isWritable: false }], data: new TextEncoder().encode('vwfest:' + q.id) }));
  onStep && onStep('Checking the transaction…');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(alts); const tx = new VersionedTransaction(msg); if (asset) tx.sign([asset]);
  const size = tx.serialize().length; if (size > 1232) throw new Error(`Transaction too large (${size} bytes). Try again; the route may have changed.`);
  const pre = await conn.getBalance(user, 'confirmed'); const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [user.toBase58()] } });
  if (sim.value.err) throw new Error('This purchase would fail on-chain: ' + JSON.stringify(sim.value.err).slice(0, 140) + (sim.value.logs ? ' · ' + (sim.value.logs.filter((l) => /error|insufficient|failed/i.test(l)).slice(-1)[0] || '') : ''));
  const post = sim.value.accounts && sim.value.accounts[0] ? sim.value.accounts[0].lamports : null; const spentLamports = post === null ? null : pre - post;
  return { tx, asset, conn, burn, blockhash, lastValidBlockHeight, swapInfo, spentLamports, size, units: sim.value.unitsConsumed, user, ata, balance: BigInt(pre) };
}
export async function prepare({ q, cfg, server, pubkey, onStep, payToken, sweep, reserveLamports }) {
  // The browser talks to the public RPC directly (simulate + broadcast): the game server has no transaction relay by design. Reads could use /api/rpc, but one endpoint keeps it simple.
  const conn = new Connection(cfg.publicRpcUrl || (server + '/api/rpc'), { commitment: 'confirmed', disableRetryOnRateLimit: true });
  const mint = new PublicKey(cfg.mint), user = pubkey; const mintInfo = await conn.getAccountInfo(mint); if (!mintInfo) throw new Error('$VWFEST mint not found on this network.');
  const tokenProg = mintInfo.owner.equals(TOKEN22) ? TOKEN22 : TOKEN;
  const [ata] = PublicKey.findProgramAddressSync([user.toBytes(), tokenProg.toBytes(), mint.toBytes()], ATA_PROG);
  const base = { q, cfg, conn, user, mint, tokenProg, ata, payToken, onStep };
  if (!sweep || payToken || !q.swap) return build({ ...base, swapLamports: BigInt(q.swapLamports) });
  // Entry / sweep: burn everything the on-ramp delivered except what the network + NFT rent will cost. Two passes: measure the real cost by simulation, then re-quote.
  const bal = BigInt(await conn.getBalance(user, 'confirmed')); const cap = BigInt(q.totalLamports) * 3n / 2n; const margin = 300000n; // 0.0003 SOL cushion
  let guess = bal - BigInt(reserveLamports || 6500000); if (guess < BigInt(q.totalLamports) / 3n) throw new Error(`Your wallet holds ${Number(bal) / 1e9} SOL, not enough yet. Add funds first.`);
  let p1 = await build({ ...base, swapLamports: guess > cap ? cap : guess }); const fees = p1.spentLamports - p1.swapInfo.swapLamports;
  let sw = bal - fees - margin; if (sw > cap) sw = cap; if (sw < BigInt(q.totalLamports) / 3n) throw new Error('Not enough SOL after network fees. Add a little more and try again.');
  if (sw === p1.swapInfo.swapLamports) return p1; const p2 = await build({ ...base, swapLamports: sw }); return p2;
}
export async function signAndSend(prep, provider, onStep) {
  onStep && onStep('Approve in your wallet…');
  const signed = await provider.signTransaction(prep.tx); onStep && onStep('Sending…');
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
