// Pre-sign audit of the instructions Jupiter returns (pure ESM, no web3 import so it can be unit-tested in node). Mirrors solana/src/audit.js + jupiter.js.
const SYSTEM = '11111111111111111111111111111111', TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROG = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', BUDGET = 'ComputeBudget111111111111111111111111111111', JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const ALLOWED = new Set([BUDGET, SYSTEM, TOKEN, TOKEN22, ATA_PROG, JUP]);
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const acct = (i, n) => (i.accounts && i.accounts[n] ? String(i.accounts[n].pubkey) : null);
// list: Jupiter instruction JSON ({programId, accounts:[{pubkey}], data(base64)}).
// opts: { user, maxTokenIn }  maxTokenIn: most SPL tokens (raw units) the route may take from the player's token accounts (0n for SOL-funded swaps).
export function audit(list, maxLamports, opts = {}) {
  const user = opts.user || null, maxTok = opts.maxTokenIn === undefined ? 0n : BigInt(opts.maxTokenIn); let out = 0n, tok = 0n;
  for (const i of list) {
    if (!ALLOWED.has(i.programId)) throw new Error('Swap route used an unexpected program (' + String(i.programId).slice(0, 6) + '…). Aborted for your safety.');
    const d = bytes(i.data); const dv = new DataView(d.buffer);
    if (i.programId === SYSTEM) { const kind = d.length >= 4 ? dv.getUint32(0, true) : -1;
      if (kind === 2 || kind === 0) { if (d.length < 12) throw new Error('Bad system instruction in swap route.'); out += dv.getBigUint64(4, true); } else if (kind !== 8 && kind !== 9) throw new Error('Unexpected system instruction in swap route.'); }
    else if (i.programId === TOKEN || i.programId === TOKEN22) { const op = d[0];
      // 3 transfer [src,dst,authority] | 12 transferChecked [src,mint,dst,authority]: amounts the PLAYER signs for are bounded by what the quote allows
      if (op === 3 || op === 12) { if (d.length < 9) throw new Error('Bad token instruction in swap route.'); const authority = op === 3 ? acct(i, 2) : acct(i, 3); if (!user || authority === user) tok += dv.getBigUint64(1, true); }
      // approve (4), setAuthority (6), approveChecked (13), burn (8/15), closeAccount only to the player (9), mintTo/freeze etc.: never part of a swap route
      else if ([4, 6, 8, 13, 15, 7, 14, 10, 11].includes(op)) throw new Error('Unexpected token instruction in swap route (' + op + ').');
      else if (op === 9 && user && acct(i, 1) !== user) throw new Error('Swap route would send reclaimed SOL elsewhere. Aborted.'); }
  }
  if (out > maxLamports) throw new Error('Swap route would move more SOL than quoted. Aborted.');
  if (tok > maxTok) throw new Error('Swap route would move more tokens than quoted. Aborted.');
}
// The wallet must hand back exactly the transaction we showed it (a wallet/extension that swaps the message would otherwise be broadcast as-is).
export function sameMessage(a, b) { if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i]; return x === 0; }
