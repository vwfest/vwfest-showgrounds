// Send a signed transaction and keep re-sending the SAME bytes every `everyMs` until it is confirmed or its blockhash can no longer land (public RPCs drop transactions under load;
// a rebroadcast of identical bytes is harmless: the signature is the same, so it can only land once). Pure of any browser API: the caller injects `conn`, `sleep` and `now`.
import { checkExpiry, plausibleHeight } from './expiry.mjs';
// `readers`: more RPC connections (a different provider than `conn`) used ONLY to double-check before we call a payment expired: a payment is declared expired only when checkExpiry() says so on all of them, twice in a row.
export async function sendAndConfirm({ conn, readers = [], raw, lastValidBlockHeight, everyMs = 2000, pollMs = 1000, maxMs = 120000, onSent, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, onStep }) {
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 }); // first send is pre-flighted (a doomed tx fails here, not silently)
  if (onSent) { try { onSent(sig); } catch { /* bookkeeping must never stop a payment */ } } // the signature is known now: the caller can save it before we wait for confirmation
  const t0 = now(); let lastSend = t0, sends = 1, expiredSeen = 0; const all = [conn, ...readers]; let anyRoom = true;
  const failed = (err) => new Error('Transaction failed on-chain: ' + JSON.stringify(err).slice(0, 120));
  for (;;) {
    let v = null; try { v = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: false })).value[0]; } catch { /* RPC hiccup: keep going */ }
    if (v && v.err) throw failed(v.err);
    if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) return { sig, sends };
    const t = now();
    if (t - t0 > maxMs) throw Object.assign(new Error('Still confirming. Your transaction was sent and may still land: do not pay again. Check Solscan, then press Retry to record it.'), { sig, pending: true });
    // Expiry is only even considered once a plausible FINALIZED height is past lastValidBlockHeight; then every reader must agree, on two polls in a row.
    if (lastValidBlockHeight != null && anyRoom) {
      const h = await plausibleHeight(conn, Number(lastValidBlockHeight));
      if (h !== null && h > Number(lastValidBlockHeight)) {
        const c = await checkExpiry({ conns: all, sig, lastValidBlockHeight });
        if (c.state === 'landed') return { sig, sends };
        if (c.state === 'failed') throw failed(c.err);
        if (c.state === 'expired' && ++expiredSeen >= 2) throw Object.assign(new Error('The transaction expired before it was confirmed, so it was not processed and nothing was spent. Start the purchase again.'), { sig, expired: true });
        if (c.state !== 'expired') expiredSeen = 0;
      } else expiredSeen = 0;
    }
    if (t - lastSend >= everyMs) { lastSend = t; sends++; onStep && onStep('Confirming on Solana… (re-sending ' + sends + ')'); try { await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch { /* already known / rate limited: fine */ } }
    await sleep(pollMs);
  }
}
