// "Did this transaction really die?" Deciding that a payment EXPIRED means telling a player that nothing was spent, so it must never rest on one RPC's say-so.
// Real incident: publicnode answered getBlockHeight('confirmed') with the SLOT number (463,929,944 instead of 441,951,720, flipping between the two), which is "above lastValidBlockHeight",
// so a transaction that then FINALIZED was reported as "expired, nothing was spent" and its pending record was deleted.
// Rules (all must hold, otherwise the answer is "unknown": keep polling / say it may still land):
//   1. getSignatureStatuses with searchTransactionHistory shows NO status on EVERY reader (an error or an odd reply from any reader = unknown);
//   2. the block height at FINALIZED commitment (it can only lag, never run ahead, so waiting for it is the conservative choice) is above lastValidBlockHeight on a reader;
//   3. that height is plausible: not more than MAX_OVERSHOOT blocks past lastValidBlockHeight (a slot number, or any garbage, is ~22 million past and is ignored), and no plausible reader says "not yet".
export const MAX_OVERSHOOT = 5000;
const landedOk = (v) => !!v && !v.err && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized');
// One reader's height at finalized commitment -> a plausible number or null.
export async function plausibleHeight(conn, lastValidBlockHeight) {
  try { const h = await conn.getBlockHeight('finalized'); return Number.isSafeInteger(h) && h > 0 && h <= lastValidBlockHeight + MAX_OVERSHOOT ? h : null; } catch { return null; }
}
// -> { state: 'landed' | 'failed' | 'expired' | 'unknown', err?, why? }
export async function checkExpiry({ conns, sig, lastValidBlockHeight }) {
  if (lastValidBlockHeight == null || !Number.isFinite(Number(lastValidBlockHeight))) return { state: 'unknown', why: 'no lastValidBlockHeight' };
  const lv = Number(lastValidBlockHeight); let silent = 0;
  for (const c of conns) {
    let v; try { v = (await c.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]; } catch { return { state: 'unknown', why: 'a reader did not answer' }; }
    if (v && v.err) return { state: 'failed', err: v.err }; if (landedOk(v)) return { state: 'landed' }; if (v) return { state: 'unknown', why: 'processed but not confirmed yet' }; silent++;
  }
  if (!silent) return { state: 'unknown', why: 'no readers' };
  let past = 0, notYet = 0; for (const c of conns) { const h = await plausibleHeight(c, lv); if (h === null) continue; if (h > lv) past++; else notYet++; }
  if (past && !notYet) return { state: 'expired' };
  return { state: 'unknown', why: past ? 'readers disagree about the block height' : 'no plausible block height above lastValidBlockHeight yet' };
}
