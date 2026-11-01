// How much of a pay token buys the burn amount. Jupiter has NO ExactOut route for $VWFEST on mainnet (its pools only quote ExactIn), so price discovery by ExactOut fails with "No routes found" there.
// This tries ExactOut first (it works for tokens/pools that support it) and otherwise estimates the input from an ExactIn probe: the rate of ONE whole token gives maxIn = target / rate + 3%, then the real
// ExactIn quote of exactly that maxIn is fetched (and, if price impact left it short of the guaranteed minimum, scaled once and re-quoted). Either way the swap that gets signed is an ExactIn of a number fixed
// up front, so the player's exposure is the same bounded `maxIn`, and the caller still requires minOut >= burnMin. Pure: the caller injects `get(url) -> json` (it throws on a non-2xx).
export async function tokenQuotes({ get, jup, payMint, vwMint, dec, target, burnMin, slippageBps, maxAccounts = 40 }) {
  const base = `${jup}/quote?inputMint=${payMint}&outputMint=${vwMint}`; const tail = `&slippageBps=${slippageBps}&restrictIntermediateTokens=true&maxAccounts=${maxAccounts}`;
  const exactIn = (amount) => get(`${base}&amount=${amount}&swapMode=ExactIn${tail}`);
  let maxIn = null, how = 'exactout';
  try { const qo = await get(`${base}&amount=${target}&swapMode=ExactOut${tail}`); maxIn = BigInt(qo.otherAmountThreshold); } catch (e) { how = 'probe'; if (e && e.status && ![400, 404].includes(e.status)) throw e; }
  if (maxIn === null) {
    const unit = 10n ** BigInt(dec); const pr = await exactIn(unit); const out = BigInt(pr.outAmount || 0); if (out <= 0n) throw new Error('Price error. Please start again.');
    maxIn = (target * unit * 103n + out * 100n - 1n) / (out * 100n);
  }
  if (maxIn <= 0n) throw new Error('Price error. Please start again.');
  let qs = await exactIn(maxIn);
  if (how === 'probe' && BigInt(qs.otherAmountThreshold) < BigInt(burnMin)) { const out = BigInt(qs.otherAmountThreshold); if (out <= 0n) throw new Error('Price error. Please start again.'); maxIn = (maxIn * BigInt(burnMin) * 101n + out * 100n - 1n) / (out * 100n); qs = await exactIn(maxIn); } // price impact at this size: scale once
  return { maxIn, qs, how };
}
