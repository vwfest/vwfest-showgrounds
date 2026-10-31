// "Use my NFT as my avatar" picker. Wallet sign-in path = the same one the purchase flows use (own wallet or Google embedded wallet) + a free signMessage proof.
// No transaction and no burn: the server verifies on-chain that the proven wallet owns the NFT, shows it to everyone, and re-checks ownership regularly.
import { h, clear, modal, toast } from './dom.js';
import { waitFor, proveWallet } from './ui.js';
const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);
export async function nftAvatarModal(ctx) {
  const { cfg, state } = ctx; const body = h('div', { class: 'nftpick' }); const m = modal('🖼 Use my NFT as my avatar', body, { cls: 'wide' });
  const wl = () => import('./wallet.js'); let w = null, items = [], pick = null;
  const intro = h('p', { class: 'muted', text: 'Show an NFT you already own on your avatar: the picture goes on your chest and in a gold frame above your head, with a ✓ verified tag. It is free: no transaction, no burning. We check on-chain that the wallet you sign in with really owns it, and check again regularly. If you sell or move it, your avatar goes back to normal.' });
  const area = h('div', {}); body.append(intro, area);
  if (!cfg || !cfg.nftAvatars) { area.append(h('p', { text: 'NFT avatars are not switched on yet.' })); return; }
  const cur = () => state.me && state.me.nf;
  function drawConnect(err) {
    clear(area); if (err) area.append(h('p', { class: 'status bad', text: '⚠ ' + err }));
    if (cur()) area.append(h('div', { class: 'ok' }, h('span', { text: `Now showing: ${cur().n}  ` }), h('button', { class: 'btn', text: 'Remove NFT avatar', onclick: () => { ctx.net.json({ t: 'nftclear' }); toast('Back to your normal avatar.'); m.close(); } })));
    area.append(h('h4', { text: 'Sign in with the wallet that holds your NFT' }));
    if (cfg.embedded) area.append(h('button', { class: 'btn primary big', text: '🔐 Continue with Google', onclick: async (e) => { e.target.disabled = true; try { w = await (await wl()).connectEmbedded(cfg, ctx.server, 'google'); load(); } catch (x) { drawConnect(x.message || 'Sign-in failed'); } } }));
    area.append(h('button', { class: 'btn' + (cfg.embedded ? '' : ' primary'), text: '👛 My Solana wallet (Phantom, Solflare, Backpack…)', onclick: async (e) => { e.target.disabled = true; try { w = await (await wl()).connectInjected(); load(); } catch (x) { drawConnect(x.message || 'Could not connect'); } } }));
    area.append(h('p', { class: 'small muted', text: 'You will be asked for one free signature to prove the wallet is yours. It cannot move funds.' }));
  }
  async function load() {
    clear(area); const status = h('p', { class: 'status', text: 'Proving wallet ownership (free signature)…' }); area.append(status);
    try { await proveWallet(ctx, w); status.textContent = 'Looking for NFTs in your wallet…'; ctx.net.json({ t: 'nfts', wallet: w.pubkey.toBase58() }); const r = await waitFor(ctx, 'nfts', 30000); if (!r) throw new Error('No answer from the server. Try again.'); if (!r.ok) throw new Error(r.why || 'Could not read your wallet.'); items = r.items; drawPick(r.truncated); }
    catch (x) { drawConnect(x.message || 'Something went wrong'); }
  }
  function drawPick(truncated) {
    clear(area); const addr = w.pubkey.toBase58(); const use = h('button', { class: 'btn primary', text: 'Use as my avatar', disabled: true }); const msg = h('span', { class: 'muted', text: items.length ? 'Choose an NFT…' : '' });
    area.append(h('div', { class: 'row' }, h('span', { class: 'pill', text: '● Wallet ' + short(addr) + ' verified' }), h('button', { class: 'btn', text: 'Use another wallet', onclick: async () => { try { await w.logout(); } catch {} w = null; drawConnect(); } })));
    if (!items.length) { area.append(h('p', { text: 'No NFTs with a picture were found in this wallet (Metaplex Core and standard NFTs are supported). Mint your avatar NFT from the Avatar menu, or try another wallet.' })); return; }
    const grid = h('div', { class: 'nftgrid' });
    for (const it of items) { const c = h('div', { class: 'nftcard', tabindex: 0, role: 'button', 'aria-label': it.name }, h('img', { src: ctx.server + it.img, alt: it.name, loading: 'lazy', referrerpolicy: 'no-referrer', width: 140, height: 140 }), h('b', { text: it.name || 'NFT' }), h('small', { text: (it.standard === 'MplCoreAsset' ? 'Core' : 'NFT') + ' · ' + short(it.asset) }));
      const sel = () => { pick = it; [...grid.children].forEach((x) => x.classList.remove('sel')); c.classList.add('sel'); use.disabled = false; msg.textContent = 'Selected: ' + it.name; }; c.onclick = sel; c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel(); } }; grid.append(c); }
    use.onclick = async () => { use.disabled = true; msg.textContent = 'Checking ownership on-chain…'; ctx.net.json({ t: 'nftuse', wallet: addr, asset: pick.asset }); const r = await waitFor(ctx, 'nftres', 30000);
      if (r && r.ok) { toast('✓ ' + pick.name + ' verified. Look up: it is above your head.'); m.close(); } else { msg.textContent = (r && r.why) || 'Could not verify that NFT.'; use.disabled = false; } };
    area.append(grid, h('div', { class: 'row' }, msg, use)); if (truncated) area.append(h('p', { class: 'small muted', text: 'Showing the first NFTs found.' }));
  }
  drawConnect();
  // resume a Google session quietly
  if (cfg.embedded) wl().then((x) => x.resumeEmbedded(cfg, ctx.server)).then((r) => { if (r && m.el.isConnected && !w) { w = r; load(); } }).catch(() => {});
}
