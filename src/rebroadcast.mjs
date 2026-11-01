// Send a signed transaction and keep re-sending the SAME bytes every `everyMs` until it is confirmed or its blockhash can no longer land (public RPCs drop transactions under load;
// a rebroadcast of identical bytes is harmless: the signature is the same, so it can only land once). Pure of any browser API: the caller injects `conn`, `sleep` and `now`.
export async function sendAndConfirm({ conn, raw, lastValidBlockHeight, everyMs = 2000, pollMs = 1000, maxMs = 120000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, onStep }) {
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 }); // first send is pre-flighted (a doomed tx fails here, not silently)
  const t0 = now(); let lastSend = t0, sends = 1;
  for (;;) {
    const st = await conn.getSignatureStatuses([sig], { searchTransactionHistory: false }); const v = st.value[0];
    if (v && v.err) throw new Error('Transaction failed on-chain: ' + JSON.stringify(v.err).slice(0, 120));
    if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) return { sig, sends };
    const t = now();
    if (t - t0 > maxMs) throw Object.assign(new Error('Still confirming. Your transaction was sent; check Solscan, then press Retry to record it.'), { sig, pending: true });
    let expired = false; try { expired = lastValidBlockHeight != null && (await conn.getBlockHeight('confirmed')) > lastValidBlockHeight; } catch { /* RPC hiccup: keep going */ }
    if (expired) { // one last look: it may have landed in the final slots
      const fin = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true }); const w = fin.value[0];
      if (w && !w.err && (w.confirmationStatus === 'confirmed' || w.confirmationStatus === 'finalized')) return { sig, sends };
      if (w && w.err) throw new Error('Transaction failed on-chain: ' + JSON.stringify(w.err).slice(0, 120));
      throw Object.assign(new Error('The transaction expired before it was confirmed, so it was not processed and nothing was spent. Start the purchase again.'), { sig, expired: true });
    }
    if (t - lastSend >= everyMs) { lastSend = t; sends++; onStep && onStep('Confirming on Solana… (re-sending ' + sends + ')'); try { await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }); } catch { /* already known / rate limited: fine */ } }
    await sleep(pollMs);
  }
}
