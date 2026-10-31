// Pre-sign audit (pure ESM, no web3 import so it can be unit-tested in node). Mirrors solana/src/audit.js + jupiter.js, and is run on the EXACT bytes about to be signed.
//  audit(list, maxLamports, opts)   Jupiter instruction JSON ({programId, accounts:[{pubkey}], data(base64)}): program allow-list, SOL cap, token-op allow-list, and the swap's own spend bound
//  auditMessage(m, c)                the whole compiled transaction: payer, programs, memo, exactly one burnChecked of the expected amount, creator fee, Core create, then the Jupiter part via audit()
//  sameMessage(a, b)                 the wallet must return byte-identical message bytes
const SYSTEM = '11111111111111111111111111111111', TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROG = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', BUDGET = 'ComputeBudget111111111111111111111111111111', JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
export const ALLOWED = new Set([BUDGET, SYSTEM, TOKEN, TOKEN22, ATA_PROG, JUP]);
// Same set as the server (solana/src/jupiter.js TOKEN_OK): initializeAccount, closeAccount, initializeAccount2, syncNative, initializeAccount3. No transfers, approves, burns, mints, InitializeMint (0/20)...
export const TOKEN_OK = new Set([1, 9, 16, 17, 18]);
const MAX_PRIORITY_LAMPORTS = 3000000n; // priority fee ceiling (0.003 SOL)
// Jupiter v6 route instructions end with [amount u64][quoted amount u64][slippage_bps u16][platform_fee_bps u8]. ExactIn: amount = exact input spent. ExactOut: quoted amount = quoted input (max spend = that + slippage).
const hex = (d) => Array.from(d.subarray(0, 8), (x) => x.toString(16).padStart(2, '0')).join('');
const EXACT_IN = new Set(['e517cb977ae3ad2a', 'c1209b3341d69c81']); // route, shared_accounts_route
const EXACT_OUT = new Set(['d033ef977b2bed5c', 'b0d169a89a7d453e']); // exact_out_route, shared_accounts_exact_out_route
export function jupSpend(d) {
  if (d.length < 8 + 19) throw new Error('Unrecognised swap instruction. Aborted for your safety.'); const dv = new DataView(d.buffer, d.byteOffset, d.byteLength); const h = hex(d), o = d.length - 19;
  const a = dv.getBigUint64(o, true), b = dv.getBigUint64(o + 8, true), slip = BigInt(dv.getUint16(o + 16, true));
  if (EXACT_IN.has(h)) return a; // the program spends exactly this much
  if (EXACT_OUT.has(h)) return b + (b * slip + 9999n) / 10000n; // quoted input + slippage
  throw new Error('Unrecognised swap route type. Aborted for your safety.'); // includes the token-ledger variants
}
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const acct = (i, n) => (i.accounts && i.accounts[n] ? String(i.accounts[n].pubkey) : null);
// list: Jupiter instruction JSON. opts: { user, wsolAta, maxSwapIn }  maxSwapIn: the most the route may spend (SOL lamports for a SOL swap, raw token units for a token swap).
export function audit(list, maxLamports, opts = {}) {
  const user = opts.user || null; let out = 0n, spend = 0n, hasSwap = false, price = 0n, units = 1400000n;
  for (const i of list) {
    if (!ALLOWED.has(i.programId)) throw new Error('Swap route used an unexpected program (' + String(i.programId).slice(0, 6) + '…). Aborted for your safety.');
    const d = bytes(i.data); const dv = new DataView(d.buffer);
    if (i.programId === SYSTEM) { const kind = d.length >= 4 ? dv.getUint32(0, true) : -1;
      if (kind === 2) { if (d.length < 12) throw new Error('Bad system instruction in swap route.'); if (opts.wsolAta && acct(i, 1) !== opts.wsolAta) throw new Error('Swap route tried to send SOL somewhere unexpected. Aborted.'); out += dv.getBigUint64(4, true); }
      else if (kind === 0) { if (d.length < 12) throw new Error('Bad system instruction in swap route.'); out += dv.getBigUint64(4, true); } // createAccount (rent of a temp account), bounded below. Allocate (8/9) is not allowed.
      else throw new Error('Unexpected system instruction in swap route.'); }
    else if (i.programId === TOKEN || i.programId === TOKEN22) { const op = d[0];
      if (!TOKEN_OK.has(op)) throw new Error('Unexpected token instruction in swap route (' + op + ').');
      if (op === 9 && user && acct(i, 1) !== user) throw new Error('Swap route would send reclaimed SOL elsewhere. Aborted.'); }
    else if (i.programId === ATA_PROG) { if (d.length > 1 || (d.length === 1 && d[0] > 1)) throw new Error('Unexpected account instruction in swap route.'); if (user && acct(i, 2) !== user) throw new Error('Swap route would create an account for someone else. Aborted.'); }
    else if (i.programId === BUDGET) { const k = d[0]; if (k === 2 && d.length >= 5) units = BigInt(dv.getUint32(1, true)); else if (k === 3 && d.length >= 9) price = dv.getBigUint64(1, true); else if (k !== 1 && k !== 4 && k !== 2 && k !== 3) throw new Error('Unexpected compute-budget instruction.'); }
    else if (i.programId === JUP) { hasSwap = true; spend += jupSpend(d); }
  }
  if (out > maxLamports) throw new Error('Swap route would move more SOL than quoted. Aborted.');
  if (price * units / 1000000n > MAX_PRIORITY_LAMPORTS) throw new Error('Priority fee is unreasonably high. Aborted.');
  if (hasSwap) { if (opts.maxSwapIn === undefined) throw new Error('No spend limit for this swap. Aborted.'); if (spend > BigInt(opts.maxSwapIn)) throw new Error('Swap route would spend more than quoted. Aborted.'); }
}
const u64 = (d, o) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(o, true);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function decodeCreate(d) { // Core CreateV1: [0][dataState 0][name str][uri str][plugins None=0], exact length
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength); if (d.length < 14 || d[0] !== 0 || d[1] !== 0) throw new Error('Unexpected NFT instruction.'); let o = 2;
  const rs = () => { const n = dv.getUint32(o, true); o += 4; if (n > 1000 || o + n > d.length) throw new Error('Bad NFT instruction.'); const s = new TextDecoder().decode(d.subarray(o, o + n)); o += n; return s; };
  const name = rs(), uri = rs(); if (o + 1 !== d.length || d[o] !== 0) throw new Error('NFT instruction carries plugins or trailing data.'); return { name, uri };
}
// m: { keys: string[] (static + lookup-table keys, in message order), ixs: [{ p, a: number[], d: Uint8Array }], numSigners }
// c: { user, mint, decimals, burn (BigInt, exact), memo, devWallet, devLamports (BigInt), asset (string|null), name, uri, swap: null | { maxLamports, maxSwapIn, wsolAta } }
export function auditMessage(m, c) {
  const k = m.keys; if (k[0] !== c.user) throw new Error('Transaction fee payer is not your wallet.');
  if (m.numSigners > (c.asset ? 2 : 1)) throw new Error('Transaction asks for an unexpected extra signature.');
  let burns = 0, burned = 0n, dev = 0n, memoOk = false, core = 0; const jup = [];
  const asJson = (ix, pid) => ({ programId: pid, accounts: ix.a.map((i) => ({ pubkey: k[i] })), data: btoa(String.fromCharCode(...ix.d)) });
  for (const ix of m.ixs) {
    const pid = k[ix.p]; const a = (n) => k[ix.a[n]]; const d = ix.d;
    if (pid === MEMO) { if (new TextDecoder().decode(d) !== c.memo) throw new Error('Memo does not match your purchase.'); memoOk = true; }
    else if ((pid === TOKEN || pid === TOKEN22) && d[0] === 15) { // burnChecked [15][amount u64][decimals u8], accounts [account, mint, authority]
      if (d.length !== 10 || a(1) !== c.mint || a(2) !== c.user || d[9] !== c.decimals) throw new Error('Burn instruction does not match your purchase.'); burns++; burned += u64(d, 1); }
    else if ((pid === TOKEN || pid === TOKEN22) && d[0] === 8) throw new Error('Unchecked burn is not allowed.');
    else if (pid === SYSTEM && c.devWallet && a(1) === c.devWallet && d.length === 12 && new DataView(d.buffer, d.byteOffset).getUint32(0, true) === 2) { if (a(0) !== c.user) throw new Error('Creator fee comes from an unexpected account.'); dev += u64(d, 4); }
    else if (pid === CORE) {
      if (!c.asset) throw new Error('Unexpected NFT instruction.'); const dec = decodeCreate(d);
      if (a(0) !== c.asset || a(3) !== c.user || a(1) !== CORE || a(2) !== CORE || a(4) !== CORE || a(5) !== CORE || a(6) !== SYSTEM || a(7) !== CORE) throw new Error('NFT accounts do not match what you were shown.');
      if (dec.name !== c.name || dec.uri !== c.uri) throw new Error('NFT name/metadata do not match what you were shown.'); core++; }
    else if (pid === BUDGET || pid === SYSTEM || pid === TOKEN || pid === TOKEN22 || pid === ATA_PROG || pid === JUP) jup.push(asJson(ix, pid));
    else throw new Error('Transaction uses an unexpected program.');
  }
  if (!memoOk) throw new Error('Missing memo.'); if (burns !== 1 || burned !== c.burn) throw new Error('Burn amount does not match your purchase.');
  if (dev !== c.devLamports) throw new Error('Creator fee does not match your quote.'); if (core !== (c.asset ? 1 : 0)) throw new Error('NFT instruction count does not match your purchase.');
  if (c.swap) audit(jup, c.swap.maxLamports, { user: c.user, wsolAta: c.swap.wsolAta, maxSwapIn: c.swap.maxSwapIn });
  else { if (jup.some((x) => x.programId !== BUDGET)) throw new Error('Unexpected instructions in a purchase without a swap.'); audit(jup, 0n, { user: c.user }); }
  return true;
}
// The wallet must hand back exactly the transaction we showed it (a wallet/extension that swaps the message would otherwise be broadcast as-is).
export function sameMessage(a, b) { if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i]; return x === 0; }
