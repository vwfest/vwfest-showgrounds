// Compute-unit limit for the purchase transaction. Jupiter's own limit (dynamicComputeUnitLimit) is sized for the swap alone: it knows nothing about our memo (~24k units for 100+ bytes),
// the burn, the creator-fee transfer, the isolation account or the NFT mint, so a tx that carries it can die with "Memo exceeded CUs meter". We drop Jupiter's limit instruction and set our own:
// simulate under the protocol maximum, then limit = consumed * 1.3 + 20k (never below CU_MIN, never above CU_MAX). CU_FLOOR is the limit used when there is no measurement.
export const BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const CU_FLOOR = 400000, CU_MIN = 100000, CU_MAX = 1400000;
export const padUnits = (consumed) => { const n = Number(consumed); if (!Number.isFinite(n) || n <= 0) return CU_FLOOR; return Math.min(CU_MAX, Math.max(CU_MIN, Math.ceil(n * 1.3) + 20000)); };
// Jupiter instruction JSON ({ programId, data: base64 }): is it SetComputeUnitLimit (discriminator 2)?
export const isLimitIx = (j, dec = (s) => atob(s)) => !!j && j.programId === BUDGET_PROGRAM && typeof j.data === 'string' && dec(j.data).charCodeAt(0) === 2;
export const withoutLimit = (list, dec) => (list || []).filter((i) => !isLimitIx(i, dec));
