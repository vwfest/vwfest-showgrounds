'use strict';
// Jupiter swap-instruction fetch + audit. The user's wallet signs whatever we build, so every instruction Jupiter returns is checked
// against an allowlist (programs, instruction types, and SOL movement) BEFORE it is placed in a transaction.
const { PublicKey, TransactionInstruction, AddressLookupTableAccount, SystemProgram, ComputeBudgetProgram } = require('@solana/web3.js');
const C = require('./config');
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
const dataOf = (ix) => Buffer.from(ix.data, 'base64');

function auditJupiterIxs(list, { user, maxLamports, maxSwapIn }) {
  let lamports = 0n, spend = 0n;
  const u = new PublicKey(user);
  const wsolAta = getAssociatedTokenAddressSync(new PublicKey(C.WSOL), u, true).toBase58();
  for (const ix of list) {
    if (!ALLOWED_PROGRAMS.has(ix.programId)) throw new Error('Swap route used an unexpected program (' + ix.programId.slice(0, 6) + '...). Aborted.');
    const d = dataOf(ix);
    if (ix.programId === SystemProgram.programId.toBase58()) {
      const kind = d.length >= 4 ? d.readUInt32LE(0) : -1;
      if (kind === 2) { // transfer: only user -> own wSOL account, bounded
        const dest = ix.accounts[1] && ix.accounts[1].pubkey; if (dest !== wsolAta) throw new Error('Swap route tried to send SOL somewhere unexpected. Aborted.');
        lamports += d.readBigUInt64LE(4);
      } else if (kind === 0) { lamports += d.readBigUInt64LE(4); } // createAccount (rent for temp accounts)
      else if (kind !== 8) throw new Error('Unexpected system instruction in swap route. Aborted.'); // allocate only
    } else if (ix.programId === C.TOKEN_PROGRAM || ix.programId === C.TOKEN_2022_PROGRAM) {
      if (!TOKEN_OK.has(d[0])) throw new Error('Unexpected token instruction in swap route. Aborted.');
      if (d[0] === 9) { const dest = ix.accounts[1] && ix.accounts[1].pubkey; if (dest !== user) throw new Error('Swap route would close an account to someone else. Aborted.'); }
    } else if (ix.programId === C.JUPITER_PROGRAM && maxSwapIn !== undefined) { spend += jupSpend(d); // the route's own amount fields bound what it can take from the player (SOL swaps and token swaps alike)
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
async function swapInstructions({ cfg, prices, conn, user, inputMint, amount, maxSolLamports, fetchImpl = fetch }) {
  const quote = await prices.jupQuote({ inputMint, outputMint: cfg.vwfestMint, amount: amount.toString(), extra: '&maxAccounts=40' });
  if (!quote || !quote.outAmount) throw new Error('No swap route available right now');
  if (Number(quote.priceImpactPct || 0) > 0.05) throw new Error('Price impact too high right now. Try a smaller amount or later.');
  const headers = { 'content-type': 'application/json', ...(cfg.jupiterApiKey ? { 'x-api-key': cfg.jupiterApiKey } : {}) };
  let r;
  for (let i = 0; i < 3; i++) { // free tiers rate-limit: brief back-off on 429/5xx
    r = await fetchImpl(`${cfg.jupiterBase}/swap/v1/swap-instructions`, { method: 'POST', headers, body: JSON.stringify({ quoteResponse: quote, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }), signal: AbortSignal.timeout(10000) });
    if (r.ok || (r.status !== 429 && r.status < 500)) break; await new Promise((res) => setTimeout(res, 1200 * (i + 1)));
  }
  if (!r.ok) throw new Error('Swap service error (' + r.status + ')');
  const j = await r.json(); if (j.error) throw new Error('Swap service: ' + String(j.error).slice(0, 80));
  const list = [...(j.setupInstructions || []), j.swapInstruction, ...(j.cleanupInstruction ? [j.cleanupInstruction] : [])];
  const budget = j.computeBudgetInstructions || [];
  auditJupiterIxs([...budget, ...list], { user, maxLamports: maxSolLamports === undefined ? 0n : maxSolLamports, maxSwapIn: amount });
  const alts = [];
  for (const a of j.addressLookupTableAddresses || []) { const acc = await conn.getAccountInfo(new PublicKey(a)); if (acc) alts.push(new AddressLookupTableAccount({ key: new PublicKey(a), state: AddressLookupTableAccount.deserialize(acc.data) })); }
  return { instructions: list.map(toIx), computeBudget: budget.map(toIx), alts, quote, outAmount: BigInt(quote.outAmount), minOut: BigInt(quote.otherAmountThreshold) };
}
module.exports = { auditJupiterIxs, swapInstructions, jupSpend, ALLOWED_PROGRAMS };
