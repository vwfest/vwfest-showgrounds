'use strict';
// Transaction audit shared by the SERVER (before returning a tx) and the BROWSER client (before asking the wallet to sign).
// Pure: takes a VersionedTransaction + the public quote, throws if anything differs from what the player was shown.
const { PublicKey, VersionedTransaction, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const C = require('./config');
const { ALLOWED_PROGRAMS, auditJupiterIxs } = require('./jupiter');

const RENT_CUSHION = 6000000n; // lamports allowed for temp/rent accounts created by a swap route (matches txbuild and the client): three accounts' worth
const TEMP_RENT_MAX = 2100000n; // the isolated temp token account (165 bytes) costs 2,039,280 lamports rent-exempt
const EXTRA_OK = new Set([C.MEMO_PROGRAM, C.MPL_CORE_PROGRAM]);
const u64 = (b, o) => Buffer.from(b).readBigUInt64LE(o);

function decodeTx(txB64) { return VersionedTransaction.deserialize(Buffer.from(txB64, 'base64')); }

// quote: public quote view; cfg: { vwfestMint, devWallet, decimals }; kind: 'pay'
function auditPayTx(tx, q, cfg, alts = []) {
  const m = tx.message; const keys = m.staticAccountKeys.map((k) => k.toBase58());
  const ak = m.getAccountKeys({ addressLookupTableAccounts: alts }); const keyAt = (i) => { const k = ak.get(i); return k ? k.toBase58() : null; }; // resolves keys that live in address lookup tables
  if (keys[0] !== q.wallet) throw new Error('Transaction fee payer is not your wallet');
  const burnMint = cfg.vwfestMint; let burn = 0n, dev = 0n, devTok = 0n, memoOk = false, burnAta = null;
  const jupList = []; let sysLamports = 0n; // every non-fee instruction when swapping, re-audited below exactly like the server did
  const asJup = (ix, pid, d) => ({ programId: pid, accounts: ix.accountKeyIndexes.map((i) => ({ pubkey: keyAt(i) })), data: Buffer.from(d).toString('base64') });
  const memoExpected = 'vwfest:' + q.id + (q.commit ? ':' + q.commit : '');
  const progs = new Set(ALLOWED_PROGRAMS); EXTRA_OK.forEach((p) => progs.add(p));
  const wsolAta = getAssociatedTokenAddressSync(new PublicKey(C.WSOL), new PublicKey(q.wallet), true).toBase58();
  const ata = (owner, mint, prog) => getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, new PublicKey(prog || C.TOKEN_PROGRAM)).toBase58();
  // Token-funded swaps run from an ISOLATED account: [createAccountWithSeed temp] [InitializeAccount3] [transferChecked main -> temp, exactly swapInRaw] [route, source = temp] [closeAccount temp -> player].
  const tokenSwap = !!q.swap && q.swapInputMint !== C.WSOL; const isoMain = tokenSwap ? ata(q.wallet, q.swapInputMint, C.TOKEN_PROGRAM) : null; let temp = null; let at = -1;
  const st = { create: -1, init: -1, xfer: -1, close: -1, jupFirst: -1, jupLast: -1 }; const once = (key, what) => { if (st[key] !== -1) throw new Error('Duplicate ' + what + ' in the swap'); st[key] = at; };
  const userB = new PublicKey(q.wallet).toBuffer(), tokenB = new PublicKey(C.TOKEN_PROGRAM).toBuffer();
  for (const ix of m.compiledInstructions) {
    at++; const pid = keyAt(ix.programIdIndex); if (!pid || !progs.has(pid)) throw new Error('Transaction uses an unexpected program');
    const d = Buffer.from(ix.data); const acct = (i) => keyAt(ix.accountKeyIndexes[i]);
    if (pid === C.JUPITER_PROGRAM) { if (st.jupFirst === -1) st.jupFirst = at; st.jupLast = at; }
    if (pid === C.MEMO_PROGRAM) { if (d.toString('utf8') !== memoExpected) throw new Error('Memo does not match your quote'); memoOk = true; }
    else if (tokenSwap && pid === SystemProgram.programId.toBase58() && d.length >= 4 && d.readUInt32LE(0) === 3) { // createAccountWithSeed [3][base 32][seed len u64][seed][lamports u64][space u64][owner 32]
      const sl = d.length >= 44 ? Number(d.readBigUInt64LE(36)) : -1; if (temp || sl < 0 || sl > 32 || d.length !== 4 + 32 + 8 + sl + 8 + 8 + 32) throw new Error('Bad temporary-account instruction');
      const o = 44 + sl; if (acct(0) !== q.wallet || !d.subarray(4, 36).equals(userB) || d.readBigUInt64LE(o + 8) !== 165n || !d.subarray(o + 16, o + 48).equals(tokenB)) throw new Error('Temporary account is not what was prepared for you');
      if (d.readBigUInt64LE(o) > TEMP_RENT_MAX) throw new Error('Temporary account would cost more rent than expected'); sysLamports += d.readBigUInt64LE(o); temp = acct(1); once('create', 'temporary account'); }
    else if (temp && pid === C.TOKEN_PROGRAM && d[0] === 18 && acct(0) === temp) { if (d.length !== 33 || acct(1) !== q.swapInputMint || !d.subarray(1, 33).equals(userB)) throw new Error('Temporary account is not owned by you / wrong token'); once('init', 'account initialisation'); }
    else if (temp && pid === C.TOKEN_PROGRAM && d[0] === 12 && acct(2) === temp) { if (d.length !== 10 || acct(0) !== isoMain || acct(1) !== q.swapInputMint || acct(3) !== q.wallet || (q.payToken && d[9] !== q.payToken.dec) || u64(d, 1) !== BigInt(q.swapInRaw)) throw new Error('Token transfer into the swap does not match your quote'); once('xfer', 'token transfer'); }
    else if (temp && pid === C.TOKEN_PROGRAM && d[0] === 9 && acct(0) === temp) { if (d.length !== 1 || acct(1) !== q.wallet || acct(2) !== q.wallet) throw new Error('Temporary account would be closed to someone else'); once('close', 'account close'); }
    else if (pid === SystemProgram.programId.toBase58()) {
      const kind = d.length >= 4 ? d.readUInt32LE(0) : -1;
      if (kind === 2 && acct(0) === q.wallet && acct(1) === q.devWallet && q.devWallet) { const l = u64(d, 4); dev += l; sysLamports += l; }
      else if (q.swap && kind === 2 && acct(0) === q.wallet && acct(1) === wsolAta) { sysLamports += u64(d, 4); jupList.push(asJup(ix, pid, d)); } // wrap SOL for the swap: bounded below
      else if (q.swap && kind === 0) { sysLamports += u64(d, 4); jupList.push(asJup(ix, pid, d)); } // temp accounts from the route: bounded below
      else throw new Error('Transaction moves SOL somewhere unexpected');
    }
    else if ((pid === C.TOKEN_PROGRAM || pid === C.TOKEN_2022_PROGRAM) && (d[0] === 15 || d[0] === 8)) { // burnChecked | burn
      if (d[0] === 15) { if (acct(1) !== burnMint || acct(2) !== q.wallet || acct(0) !== ata(q.wallet, burnMint, pid) || (burnAta && burnAta !== acct(0))) throw new Error('Burn instruction does not match your quote'); burnAta = acct(0); burn += u64(d, 1); }
      else throw new Error('Unchecked burn is not allowed');
    } else if ((pid === C.TOKEN_PROGRAM || pid === C.TOKEN_2022_PROGRAM) && d[0] === 12) { // transferChecked (dev fee in SPL)
      const mint = acct(1), dest = acct(2), auth = acct(3);
      if (!q.devTokenMint || mint !== q.devTokenMint || auth !== q.wallet || dest !== ata(q.devWallet, mint, pid)) throw new Error('Token transfer does not match your quote');
      devTok += u64(d, 1);
    } else if (pid === C.TOKEN_PROGRAM || pid === C.TOKEN_2022_PROGRAM) { // any other token instruction: only wrap/unwrap plumbing of a swap, audited below
      if (!q.swap) throw new Error('Unexpected token instruction'); jupList.push(asJup(ix, pid, d));
    } else if (pid === C.ATA_PROGRAM) {
      const owner = acct(2), mintA = acct(3);
      if (owner === q.devWallet && q.devTokenMint && mintA === q.devTokenMint && acct(0) === q.wallet) { /* creates the dev wallet's ATA for the SPL dev fee (payer = player) */ }
      else if (q.swap) jupList.push(asJup(ix, pid, d));
      else throw new Error('Unexpected account creation');
    } else if (q.swap && (pid === C.JUPITER_PROGRAM || pid === 'ComputeBudget111111111111111111111111111111')) jupList.push(asJup(ix, pid, d));
    else if (pid === C.JUPITER_PROGRAM) throw new Error('Unexpected swap in a non-swap payment');
  }
  if (q.swap) { // HIGH-2: the browser re-runs the same allow-list audit the server ran on Jupiter's instructions, bounded by the quote
    const maxLamports = (q.swapInputMint === C.WSOL ? BigInt(q.swapInRaw) : 0n) + RENT_CUSHION;
    if (tokenSwap) { if (st.create === -1 || st.init === -1 || st.xfer === -1 || st.close === -1 || st.jupFirst === -1) throw new Error('Swap isolation steps are missing');
      if (!(st.create < st.init && st.init < st.xfer && st.xfer < st.jupFirst && st.jupLast < st.close)) throw new Error('Swap isolation steps are out of order'); }
    auditJupiterIxs(jupList, { user: q.wallet, maxLamports, maxSwapIn: BigInt(q.swapInRaw), source: tokenSwap ? temp : wsolAta, forbid: tokenSwap ? [isoMain] : undefined, dest: burnAta, minOut: burn, maxSlippageBps: cfg.slippageBps }); // ExactIn: the route may spend exactly the quoted input (SOL via the wSOL account, or the pay-token), whatever the input mint is
    const cap = BigInt(q.devLamports) * 101n / 100n + 1n + maxLamports; // total SOL that may leave the wallet via System transfer/createAccount
    if (sysLamports > cap) throw new Error('Transaction moves more SOL than your quote allows');
  }
  if (!memoOk) throw new Error('Missing memo');
  if (burn < BigInt(q.burnMin)) throw new Error('Burn amount is lower than your quote');
  if (burn > BigInt(q.burnRaw) * 12n / 10n + 1n && !q.swap) throw new Error('Burn amount is higher than your quote');
  if (BigInt(q.devLamports) > 0n && dev < BigInt(q.devLamports) * 99n / 100n) throw new Error('Creator fee is lower than your quote');
  if (dev > BigInt(q.devLamports) * 101n / 100n + 1n) throw new Error('Creator fee is higher than your quote');
  if (BigInt(q.devTokenRaw) > 0n && devTok < BigInt(q.devTokenRaw) * 99n / 100n) throw new Error('Creator fee (token) is lower than your quote');
  if (devTok > BigInt(q.devTokenRaw) * 101n / 100n + 1n) throw new Error('Creator fee (token) is higher than your quote');
  return { burn, dev, devTok };
}
// Fetches the lookup tables a v0 transaction references (needed by the audit when Jupiter routes use them).
async function fetchAlts(conn, tx) {
  const out = []; for (const l of tx.message.addressTableLookups || []) { const r = await conn.getAddressLookupTable(l.accountKey); if (!r.value) throw new Error('Lookup table not found'); out.push(r.value); } return out;
}
// Decodes Core CreateV1 data: [0][dataState 0][name str][uri str][plugins None=0]; strict, exact length.
function decodeCreateV1(data) {
  const b = Buffer.from(data); if (b.length < 14 || b[0] !== 0 || b[1] !== 0) throw new Error('Unexpected Core instruction data');
  let o = 2; const rs = () => { const n = b.readUInt32LE(o); o += 4; if (n > 1000 || o + n > b.length) throw new Error('Bad Core instruction data'); const x = b.toString('utf8', o, o + n); o += n; return x; };
  const name = rs(), uri = rs(); if (o + 1 !== b.length || b[o] !== 0) throw new Error('Core instruction carries plugins or trailing data'); return { name, uri };
}
// Mint tx: only Core create (+ compute budget); payer = wallet; the asset/collection accounts, NAME and URI must be exactly what /tx/mint returned.
function auditMintTx(tx, { wallet, asset, collection, name, uri }) {
  const m = tx.message; const keys = m.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== wallet) throw new Error('Transaction fee payer is not your wallet');
  if (typeof name !== 'string' || typeof uri !== 'string') throw new Error('name and uri are required to audit a mint');
  let created = 0;
  for (const ix of m.compiledInstructions) {
    const pid = keys[ix.programIdIndex];
    if (pid === C.MPL_CORE_PROGRAM) {
      const a = (i) => keys[ix.accountKeyIndexes[i]];
      const dec = decodeCreateV1(ix.data);
      if (a(0) !== asset || a(1) !== collection || a(3) !== wallet || a(4) !== wallet) throw new Error('NFT accounts do not match what you were shown');
      if (dec.name !== name || dec.uri !== uri) throw new Error('NFT name/metadata in the transaction do not match what you were shown');
      created++;
    } else if (pid !== 'ComputeBudget111111111111111111111111111111') throw new Error('Mint transaction uses an unexpected program');
  }
  if (created !== 1) throw new Error('Mint transaction must create exactly one NFT');
  return true;
}
module.exports = { auditPayTx, auditMintTx, decodeTx, fetchAlts, decodeCreateV1 };
