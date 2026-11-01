// Purchases that were SENT but not yet credited. After the wallet signs and the transaction is broadcast, {qid, sig, wallet} is written to localStorage; it is removed only when the server says the
// purchase is credited (or that it can never be). On the next join / page reload the entries are replayed over the socket, so a closed tab, a crash, a server restart or a flaky connection
// between "paid" and "credited" never leaves a burn without its item. Pure of any browser API: the caller injects `storage` (localStorage-like) and `now`.
export const KEY = 'vwfest-pending-buys';
// Entries are bound to the profile (pid) that paid: the signed quote is only valid for its owner, so another profile on the same browser must never see, replay (and so get a final
// "refused" that deletes) somebody else's pending purchase. list()/has()/remove() only touch the current profile's entries; add() and writes keep everybody else's.
export function pendingStore(storage, { pid = '', now = Date.now, ttlMs = 7 * 24 * 3600e3, max = 12, key = KEY } = {}) {
  const all = () => { try { const a = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(a) ? a.filter((e) => e && typeof e.qid === 'string' && typeof e.sig === 'string' && now() - (e.ts || 0) < ttlMs) : []; } catch { return []; } };
  const mine = (e) => !!pid && e.pid === pid;
  const read = () => all().filter(mine);
  const write = (a) => { try { storage.setItem(key, JSON.stringify(a.slice(-max))); return true; } catch { return false; } };
  return {
    list: read,
    add({ qid, sig, wallet }) { if (!pid || typeof qid !== 'string' || typeof sig !== 'string') return false; const a = all().filter((e) => !(mine(e) && e.qid === qid)); a.push({ qid, sig, wallet: wallet || '', pid, ts: now() }); return write(a); },
    remove(qid) { const a = all(); const b = a.filter((e) => !(mine(e) && e.qid === qid)); if (b.length !== a.length) write(b); return b.length !== a.length; },
    has(qid) { return read().some((e) => e.qid === qid); },
  };
}
// One replay pass. `send(entry)` resolves to the server's buyres (or null for "no answer"). Outcomes per entry:
//   credited (ok)            -> removed
//   retry (not found yet / paused / still verifying / no answer) -> kept, tried again later
//   needProof                -> kept; the UI must have the player verify the wallet, then replay again
//   anything else (final)    -> removed, reported in `failed` so the player can be told (with the signature)
export async function replay(store, send) {
  const out = { credited: [], retry: [], needProof: [], failed: [] };
  for (const e of store.list()) {
    let r = null; try { r = await send(e); } catch { r = null; }
    if (r && r.ok) { store.remove(e.qid); out.credited.push(e); }
    else if (!r || r.retry) out.retry.push(e);
    else if (r.needProof) out.needProof.push(e);
    else { store.remove(e.qid); out.failed.push({ ...e, why: r.why || 'Not credited' }); }
  }
  return out;
}
