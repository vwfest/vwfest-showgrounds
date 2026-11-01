'use strict';
// Jupiter swap-instruction fetch + audit. The user's wallet signs whatever we build, so every instruction Jupiter returns is checked
// against an allowlist (programs, instruction types, and SOL movement) BEFORE it is placed in a transaction.
const { PublicKey, TransactionInstruction, AddressLookupTableAccount, SystemProgram, ComputeBudgetProgram } = require('@solana/web3.js');
const C = require('./config'); const { JupClient } = require('./jupclient');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');

const ALLOWED_PROGRAMS = new Set([SystemProgram.programId.toBase58(), ComputeBudgetProgram.programId.toBase58(), C.TOKEN_PROGRAM, C.TOKEN_2022_PROGRAM, C.ATA_PROGRAM, C.JUPITER_PROGRAM]);
const TOKEN_OK = new Set([1, 9, 16, 17, 18]); // initializeAccount, closeAccount, initializeAccount2, syncNative, initializeAccount3
// Jupiter v6 route instructions end with [amount u64][quoted amount u64][slippage_bps u16][platform_fee_bps u8]: ExactIn spends exactly `amount`; ExactOut spends at most quoted input + slippage.
const EXACT_IN = new Set(['e517cb977ae3ad2a', 'c1209b3341d69c81']), EXACT_OUT = new Set(['d033ef977b2bed5c', 'b0d169a89a7d453e']); // route, shared_accounts_route | exact_out_route, shared_accounts_exact_out_route
function jupSpend(d) {
  if (d.length < 27) throw new Error('Unrecognised swap instruction. Aborted.'); const h = d.subarray(0, 8).toString('hex'), o = d.length - 19;
  const a = d.readBigUInt64LE(o), b = d.readBigUInt64LE(o + 8), slip = BigInt(d.readUInt16LE(o + 16));
  if (EXACT_IN.has(h)) return a; if (EXACT_OUT.has(h)) return b + (b * slip + 9999n) / 10000n; throw new Error('Unrecognised swap route type. Aborted.'); // token-ledger variants are refused too
}
// Index of the SOURCE token account in each ExactIn route layout: route [token_program, user_transfer_authority, user_source_token_account, ...], shared_accounts_route [token_program, program_authority, user_transfer_authority, source_token_account, ...].
const SOURCE_IDX = { e517cb977ae3ad2a: 2, c1209b3341d69c81: 3 };
function jupSource(ix, d) { const idx = SOURCE_IDX[d.subarray(0, 8).toString('hex')]; if (idx === undefined) throw new Error('Unrecognised swap route type. Aborted.'); return ix.accounts[idx] ? ix.accounts[idx].pubkey : null; }
// Rewrites a route so its input comes from `account` (the isolated temp account). `expected` = the player's own token account that Jupiter picked by default; anything else is refused.
function pinSource(ix, account, expected) {
  const idx = SOURCE_IDX[dataOf(ix).subarray(0, 8).toString('hex')]; if (idx === undefined || !ix.accounts[idx]) throw new Error('Unrecognised swap route type. Aborted.');
  if (expected && ix.accounts[idx].pubkey !== expected) throw new Error('Swap route does not take its input from your own token account. Aborted.');
  // Jupiter lists the source account again inside the per-hop AMM accounts (first leg's "user source" slot): EVERY reference to the player's own token account must be redirected to the temp account,
  // otherwise the first hop would still debit the player's main account (and our audit, correctly, refuses such a route). Found by the first real mainnet USDC swap test.
  const from = expected || ix.accounts[idx].pubkey;
  return { ...ix, accounts: ix.accounts.map((a, n) => (n === idx || a.pubkey === from ? { ...a, pubkey: account } : a)) };
}
// Route layouts from the Jupiter v6 IDL: route [.., 3 user_destination_token_account, 4 destination_token_account (optional: program id when unused), 5 destination_mint, 6 platform_fee_account ..]; shared_accounts_route [.., 6 destination_token_account, .., 9 platform_fee_account ..].
const DEST_IDX = { e517cb977ae3ad2a: 3, c1209b3341d69c81: 6 };
// The route's OUTPUT must land in the player's own $VWFEST account and its guaranteed minimum must cover what the transaction burns. dest, minOut (BigInt), maxSlippageBps, quotedOut (BigInt, optional).
function checkRoute(ix, d, opts) {
  const h = d.subarray(0, 8).toString('hex'), di = DEST_IDX[h]; if (di === undefined) throw new Error('Unrecognised swap route type. Aborted.'); if (!opts.dest) throw new Error('No destination pinned for this swap. Aborted.');
  const at = (n) => (ix.accounts[n] ? ix.accounts[n].pubkey : null);
  if (at(di) !== opts.dest) throw new Error('Swap route would send the $VWFEST somewhere other than your own account. Aborted.');
  if (h === 'e517cb977ae3ad2a') { const x = at(4); if (x !== C.JUPITER_PROGRAM && x !== opts.dest) throw new Error('Swap route names a second destination account. Aborted.'); }
  const o = d.length - 19, quoted = d.readBigUInt64LE(o + 8), slip = BigInt(d.readUInt16LE(o + 16)), fee = d[o + 18];
  if (fee !== 0) throw new Error('Swap route carries a platform fee. Aborted.');
  if (opts.maxSlippageBps !== undefined && slip > BigInt(opts.maxSlippageBps)) throw new Error('Swap route allows more slippage than quoted. Aborted.');
  if (opts.quotedOut !== undefined && quoted !== BigInt(opts.quotedOut)) throw new Error('Swap route promises a different output than quoted. Aborted.');
  if (opts.minOut === undefined) throw new Error('No minimum output for this swap. Aborted.');
  if ((quoted * (10000n - slip) + 9999n) / 10000n < BigInt(opts.minOut)) throw new Error('Swap route guarantees less $VWFEST than this purchase burns. Aborted.');
}
const dataOf = (ix) => Buffer.from(ix.data, 'base64');

// source: the ONLY token account the route may take its input from (wSOL account for SOL swaps, the isolated temp account for token swaps); forbid: accounts no route instruction may reference (the player's own token account of the pay token).
function auditJupiterIxs(list, { user, maxLamports, maxSwapIn, source, forbid, dest, minOut, maxSlippageBps, quotedOut }) {
  let lamports = 0n, spend = 0n;
  const u = new PublicKey(user);
  const wsolAta = getAssociatedTokenAddressSync(new PublicKey(C.WSOL), u, true).toBase58();
  for (const ix of list) {
    if (!ALLOWED_PROGRAMS.has(ix.programId)) throw new Error('Swap route used an unexpected program (' + ix.programId.slice(0, 6) + '...). Aborted.');
    const d = dataOf(ix);
    if (forbid) for (const f of forbid) if (ix.accounts.some((a) => a.pubkey === f)) throw new Error('Swap route touches a token account of yours it must not use. Aborted.');
    if (ix.programId === SystemProgram.programId.toBase58()) {
      const kind = d.length >= 4 ? d.readUInt32LE(0) : -1;
      if (kind === 2) { // transfer: only user -> own wSOL account, bounded
        const dest = ix.accounts[1] && ix.accounts[1].pubkey; if (dest !== wsolAta) throw new Error('Swap route tried to send SOL somewhere unexpected. Aborted.');
        lamports += d.readBigUInt64LE(4);
      } else if (kind === 0) { lamports += d.readBigUInt64LE(4); } // createAccount (rent for temp accounts)
      else throw new Error('Unexpected system instruction in swap route. Aborted.'); // no allocate/assign/etc.
    } else if (ix.programId === C.TOKEN_PROGRAM || ix.programId === C.TOKEN_2022_PROGRAM) {
      if (!TOKEN_OK.has(d[0])) throw new Error('Unexpected token instruction in swap route. Aborted.');
      if (d[0] === 9) { const dest = ix.accounts[1] && ix.accounts[1].pubkey; if (dest !== user) throw new Error('Swap route would close an account to someone else. Aborted.'); }
    } else if (ix.programId === C.JUPITER_PROGRAM && maxSwapIn !== undefined) { spend += jupSpend(d); if (!source) throw new Error('No source account pinned for this swap. Aborted.'); if (jupSource(ix, d) !== source) throw new Error('Swap route would take its input from a different account than the one prepared for it. Aborted.'); { const sp = jupSpend(d); if (sp > BigInt(maxSwapIn)) throw new Error('Swap route would spend more than quoted. Aborted.'); if (sp !== BigInt(maxSwapIn)) throw new Error('Swap route does not spend exactly the quoted input. Aborted.'); } checkRoute(ix, d, { dest, minOut, maxSlippageBps, quotedOut }); // the route's own amount fields bound what it can take from the player (SOL swaps and token swaps alike)
    } else if (ix.programId === C.ATA_PROGRAM) {
      const owner = ix.accounts[2] && ix.accounts[2].pubkey; if (owner !== user) throw new Error('Swap route would create an account for someone else. Aborted.');
    }
  }
  if (lamports > maxLamports) throw new Error('Swap route would move more SOL than quoted. Aborted.');
  if (maxSwapIn !== undefined && spend > BigInt(maxSwapIn)) throw new Error('Swap route would spend more than quoted. Aborted.');
  return true;
}
const toIx = (j) => new TransactionInstruction({ programId: new PublicKey(j.programId), keys: j.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(j.data, 'base64') });

// Returns { instructions, alts, quote } for swapping `amount` of inputMint into $VWFEST (ExactIn).
// Defence in depth on top of the instruction audit: Jupiter's route carries ~30 opaque AMM accounts. None of them may be a token account OWNED BY THE PLAYER except `allowed` (the isolated temp account, the $VWFEST account, the wSOL account),
// because the route executes with the player's signature and could otherwise be pointed at another balance. Needs RPC; `strict` (default) refuses when the check cannot run.
async function assertNoStrayUserTokenAccounts(conn, ixs, user, allowed) {
  const keys = new Set(); for (const i of ixs) for (const a of i.accounts) keys.add(a.pubkey); for (const x of allowed) keys.delete(x); keys.delete(user); const list = [...keys];
  for (let o = 0; o < list.length; o += 100) {
    const infos = await conn.getMultipleAccountsInfo(list.slice(o, o + 100).map((k) => new PublicKey(k)), 'confirmed'); const ub = new PublicKey(user).toBuffer();
    infos.forEach((info) => { if (info && (info.owner.toBase58() === C.TOKEN_PROGRAM || info.owner.toBase58() === C.TOKEN_2022_PROGRAM) && info.data.length >= 165 && Buffer.from(info.data).subarray(32, 64).equals(ub)) throw new Error('Swap route touches another token account of yours. Aborted for your safety.'); });
  }
}
// iso: { temp, main } for token-funded swaps (input comes from the isolated temp account only); omit for SOL swaps (input comes from the wSOL account only). allow: extra accounts of the player that the route may reference ($VWFEST account).
async function swapInstructions({ cfg, prices, conn, user, inputMint, amount, maxSolLamports, iso, allow = [], dest, fetchImpl = fetch }) {
  if (!dest) throw new Error('No destination account for the swap output');
  const quote = await prices.jupQuote({ inputMint, outputMint: cfg.vwfestMint, amount: amount.toString(), extra: '&maxAccounts=40' });
  if (!quote || !quote.outAmount) throw new Error('No swap route available right now');
  if (Number(quote.priceImpactPct || 0) > 0.05) throw new Error('Price impact too high right now. Try a smaller amount or later.');
  const jup = fetchImpl !== fetch ? JupClient.for(cfg, fetchImpl) : (prices && prices.jup) || JupClient.for(cfg); // same gateway as the quote above: key header, pacing, 429 reset handling
  let j; try { j = await jup.post(`${jup.swap}/swap-instructions`, { quoteResponse: quote, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }); } catch (e) { throw new Error('Swap service error (' + (e.status || 'unreachable') + ')'); }
  if (j.error) throw new Error('Swap service: ' + String(j.error).slice(0, 80));
  const wsolAta = getAssociatedTokenAddressSync(new PublicKey(C.WSOL), new PublicKey(user), true).toBase58();
  const swapIx = iso ? pinSource(j.swapInstruction, iso.temp, iso.main) : j.swapInstruction; // token swaps: take the input from the isolated account, never the player's own
  const list = [...(j.setupInstructions || []), swapIx, ...(j.cleanupInstruction ? [j.cleanupInstruction] : [])];
  const budget = j.computeBudgetInstructions || [];
  auditJupiterIxs([...budget, ...list], { user, maxLamports: maxSolLamports === undefined ? 0n : maxSolLamports, maxSwapIn: amount, source: iso ? iso.temp : wsolAta, forbid: iso ? [iso.main] : undefined, dest, minOut: BigInt(quote.otherAmountThreshold), maxSlippageBps: cfg.slippageBps, quotedOut: BigInt(quote.outAmount) });
  await assertNoStrayUserTokenAccounts(conn, [swapIx], user, [wsolAta, ...allow, ...(iso ? [iso.temp] : [])]);
  const alts = [];
  for (const a of j.addressLookupTableAddresses || []) { const acc = await conn.getAccountInfo(new PublicKey(a)); if (acc) alts.push(new AddressLookupTableAccount({ key: new PublicKey(a), state: AddressLookupTableAccount.deserialize(acc.data) })); }
  return { instructions: list.map(toIx), computeBudget: budget.map(toIx), alts, quote, outAmount: BigInt(quote.outAmount), minOut: BigInt(quote.otherAmountThreshold) };
}
module.exports = { checkRoute, auditJupiterIxs, swapInstructions, assertNoStrayUserTokenAccounts, jupSpend, jupSource, pinSource, ALLOWED_PROGRAMS };
