// "Lost your profile?" Recover it on this device by signing a free message with the wallet that minted one of its NFTs (avatar or Mystery Ride).
// Server side: lib/recovery.js. The signed text is domain-bound and checked here too: we refuse to sign a message for another site or wallet.
import { $, h, clear, modal } from './dom.js';
import { waitFor } from './ui.js';
import { framed } from './frame.js';
export function recoverModal(ctx, onCred) {
  const body = h('div', {}); const st = h('p', { class: 'status' }); const m = modal('🔑 Recover my profile', body);
  const say = (t, bad) => { st.textContent = t; st.className = 'status' + (bad ? ' bad' : ''); };
  body.append(h('p', { text: 'Cleared your browser or switched devices? If your profile minted an avatar or a Mystery Ride NFT, connect the wallet that received it and sign a free message (not a transaction, costs nothing) to bring the profile and its rides back here.' }),
    h('p', { class: 'small muted', text: 'Your profile then moves to this device: any other browser still holding it is signed out.' }), st);
  if (framed) { say('⚠ Open the Show Grounds directly (not inside another site) to use your wallet.', true); return; }
  const go = h('button', { class: 'btn primary', text: 'Connect wallet & sign', onclick: async () => { go.disabled = true; try {
    if (!ctx.net.ready) throw new Error('Still connecting to the server. Try again in a few seconds.');
    say('Connecting your wallet…'); const { connectWallet } = await import('./pay.js'); const w = await connectWallet(); const pk = w.pubkey.toBase58();
    if (!w.provider.signMessage) throw new Error('This wallet cannot sign a message. Try Phantom, Solflare or Backpack.');
    ctx.net.json({ t: 'rauth', pubkey: pk }); const ch = await Promise.race([waitFor(ctx, 'rchal', 10000), waitFor(ctx, 'rres', 10000)]);
    if (!ch || ch.t !== 'rchal' || ch.pubkey !== pk) throw new Error((ch && ch.why) || 'Could not start recovery. Try again.');
    const msg = String(ch.message); if (!msg.includes('\nDomain: ' + location.origin + '\n') || !msg.includes('\nWallet: ' + pk + '\n') || !msg.includes('Recover my Show Grounds profile')) throw new Error('The message is not for this site and wallet. Nothing was signed.');
    say('Sign the message in your wallet…'); const { signText } = await import('./wallet.js'); const sig = await signText(w.provider, ch.message);
    ctx.net.json({ t: 'rproof', pubkey: pk, nonce: ch.nonce, sig }); const r = await waitFor(ctx, 'rres', 15000);
    if (!r || !r.ok) throw new Error((r && r.why) || 'No answer from the server.');
    if (!r.profiles.length) throw new Error(r.why || 'No profile found for this wallet.');
    clear(body); body.append(h('p', { text: r.profiles.length === 1 ? 'Found your profile:' : 'This wallet owns NFTs of these profiles. Pick one:' }), st); say('');
    for (const p of r.profiles) body.insertBefore(h('button', { class: 'btn primary', text: `${p.nick} · ${p.id}${p.rides ? ` · ${p.rides} ride${p.rides === 1 ? '' : 's'}` : ''}`, onclick: async (e) => { for (const b of body.querySelectorAll('button')) b.disabled = true; ctx.net.json({ t: 'rclaim', id: p.id }); const c = await waitFor(ctx, 'rcred', 10000);
      if (!c || !c.ok) { say('⚠ ' + ((c && c.why) || 'No answer from the server.'), true); return; } m.close(); onCred({ id: c.id, secret: c.secret, nick: c.nick }); } }), st);
  } catch (e) { say('⚠ ' + (e.message || 'Cancelled'), true); go.disabled = false; } } });
  body.append(h('div', { class: 'row' }, go));
}
