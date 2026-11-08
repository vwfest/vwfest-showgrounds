// /api/config is fetched before the join form is drawn. A sleeping host can hold that
// connection open with no bytes (free-tier wake). Bound each attempt so the form can appear,
// and keep trying in the background until a real config arrives.

export const CFG_FALLBACK = Object.freeze({
  enabled: false, shop: [], odds: [], iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  voiceRange: 15, rideUsd: 5, feeUsd: 5, discountPct: 50, decimals: 6, network: 'mainnet-beta',
});

// First attempt is short so the join form is not blank. Later attempts wait longer for a host that is still waking.
export function configAttemptPlan() {
  return [
    { timeoutMs: 8000, waitBefore: 0 },
    { timeoutMs: 12000, waitBefore: 3000 },
    { timeoutMs: 12000, waitBefore: 5000 },
    { timeoutMs: 15000, waitBefore: 8000 },
    { timeoutMs: 15000, waitBefore: 10000 },
    { timeoutMs: 15000, waitBefore: 10000 },
  ];
}

export function isConfig(j) {
  return !!(j && typeof j === 'object' && Array.isArray(j.shop) && Array.isArray(j.odds) && typeof j.network === 'string' && typeof j.voiceRange === 'number');
}

export function fallbackConfig() {
  const f = CFG_FALLBACK;
  return { ...f, shop: [], odds: [], iceServers: f.iceServers.map((s) => ({ ...s })) };
}

export async function loadConfig(fetchImpl, url, { timeoutMs = 8000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ac.signal });
    if (!r || !r.ok) return { ok: false, status: r && r.status, aborted: false };
    let j;
    try { j = await r.json(); } catch { return { ok: false, status: r.status, why: 'json' }; }
    if (!isConfig(j)) return { ok: false, status: r.status, why: 'shape' };
    return { ok: true, cfg: j };
  } catch (e) {
    const aborted = !!(ac.signal.aborted || (e && e.name === 'AbortError'));
    return { ok: false, aborted, why: aborted ? 'timeout' : 'network' };
  } finally { clearTimeout(t); }
}

// Runs attempt 0, then (if asked) the rest. `onAttempt` is called with each result. Stops on the first ok.
export async function loadConfigAttempts(fetchImpl, url, { plan = configAttemptPlan(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), onAttempt = () => {}, from = 0 } = {}) {
  for (let i = from; i < plan.length; i++) {
    if (plan[i].waitBefore) await wait(plan[i].waitBefore);
    const r = await loadConfig(fetchImpl, url, { timeoutMs: plan[i].timeoutMs });
    onAttempt(r, i);
    if (r.ok) return r;
  }
  return { ok: false };
}
