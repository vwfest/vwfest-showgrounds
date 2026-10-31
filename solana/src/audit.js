'use strict';
// Transaction audit shared by the SERVER (before returning a tx) and the BROWSER client (before asking the wallet to sign).
// Pure: takes a VersionedTransaction + the public quote, throws if anything differs from what the player was shown.
const { PublicKey, VersionedTransaction, SystemProgram } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const C = require('./config');
const { ALLOWED_PROGRAMS } = require('./jupiter');

const EXTRA_OK = new Set([C.MEMO_PROGRAM, C.MPL_CORE_PROGRAM]);
const u64 = (b, o) => Buffer.from(b).readBigUInt64LE(o);

function decodeTx(txB64) { return VersionedTransaction.deserialize(Buffer.from(txB64, 'base64')); }

// quote: public quote view; cfg: { vwfestMint, devWallet, decimals }; kind: 'pay'
function auditPayTx(tx, q, cfg, alts = []) {
  const m = tx.message; const keys = m.staticAccountKeys.map((k) => k.toBase58());
  const ak = m.getAccountKeys({ addressLookupTableAccounts: alts }); const keyAt = (i) => { const k = ak.get(i); return k ? k.toBase58() : null; }; // resolves keys that live in address lookup tables
  if (keys[0] !== q.wallet) throw new Error('Transaction fee payer is not your wallet');
  const burnMint = cfg.vwfestMint; let burn = 0n, dev = 0n, devTok = 0n, memoOk = false;
  const memoExpected = 'vwfest:' + q.id + (q.commit ? ':' + q.commit : '');
  const progs = new Set(ALLOWED_PROGRAMS); EXTRA_OK.forEach((p) => progs.add(p));
  const wsolAta = getAssociatedTokenAddressSync(new PublicKey(C.WSOL), new PublicKey(q.wallet), true).toBase58();
  const ata = (owner, mint, prog) => getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, new PublicKey(prog || C.TOKEN_PROGRAM)).toBase58();
  for (const ix of m.compiledInstructions) {
    const pid = keyAt(ix.programIdIndex); if (!pid || !progs.has(pid)) throw new Error('Transaction uses an unexpected program');
    const d = Buffer.from(ix.data); const acct = (i) => keyAt(ix.accountKeyIndexes[i]);
    if (pid === C.MEMO_PROGRAM) { if (d.toString('utf8') !== memoExpected) throw new Error('Memo does not match your quote'); memoOk = true; }
    else if (pid === SystemProgram.programId.toBase58()) {
      const kind = d.length >= 4 ? d.readUInt32LE(0) : -1;
      if (kind === 2 && acct(0) === q.wallet && acct(1) === q.devWallet && q.devWallet) dev += u64(d, 4);
      else if (q.swap && kind === 2 && acct(0) === q.wallet && acct(1) === wsolAta) { /* wrap SOL for the Jupiter swap (bounded by the server-side Jupiter audit) */ }
      else if (q.swap && (kind === 0 || kind === 8)) { /* temp accounts from the Jupiter route */ }
      else throw new Error('Transaction moves SOL somewhere unexpected');
    }
    else if ((pid === C.TOKEN_PROGRAM || pid === C.TOKEN_2022_PROGRAM) && (d[0] === 15 || d[0] === 8)) { // burnChecked | burn
      if (d[0] === 15) { if (acct(1) !== burnMint || acct(2) !== q.wallet) throw new Error('Burn instruction does not match your quote'); burn += u64(d, 1); }
      else throw new Error('Unchecked burn is not allowed');
    } else if ((pid === C.TOKEN_PROGRAM || pid === C.TOKEN_2022_PROGRAM) && d[0] === 12) { // transferChecked (dev fee in SPL)
      const mint = acct(1), dest = acct(2), auth = acct(3);
      if (!q.devTokenMint || mint !== q.devTokenMint || auth !== q.wallet || dest !== ata(q.devWallet, mint, pid)) throw new Error('Token transfer does not match your quote');
      devTok += u64(d, 1);
    } else if ((pid === C.TOKEN_PROGRAM || pid === C.TOKEN_2022_PROGRAM) && [3, 4, 6, 7, 11, 13, 14, 22].includes(d[0])) throw new Error("Unexpected token instruction");
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
// Mint tx: only Core create (+ compute budget) and a memo; payer = wallet; the asset account is the expected one.
function auditMintTx(tx, { wallet, asset, collection, uriMemo }) {
  const m = tx.message; const keys = m.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== wallet) throw new Error('Transaction fee payer is not your wallet');
  let created = false;
  for (const ix of m.compiledInstructions) {
    const pid = keys[ix.programIdIndex];
    if (pid === C.MPL_CORE_PROGRAM) {
      const a = (i) => keys[ix.accountKeyIndexes[i]];
      if (Buffer.from(ix.data)[0] !== 0) throw new Error('Unexpected Core instruction');
      if (a(0) !== asset || a(1) !== collection || a(3) !== wallet || a(4) !== wallet) throw new Error('NFT accounts do not match what you were shown');
      created = true;
    } else if (pid !== 'ComputeBudget111111111111111111111111111111' && pid !== C.MEMO_PROGRAM && pid !== SystemProgram.programId.toBase58()) throw new Error('Mint transaction uses an unexpected program');
    else if (pid === SystemProgram.programId.toBase58()) throw new Error('Mint transaction must not move SOL directly');
  }
  if (!created) throw new Error('Mint transaction has no NFT creation');
  return true;
}
module.exports = { auditPayTx, auditMintTx, decodeTx, fetchAlts };
