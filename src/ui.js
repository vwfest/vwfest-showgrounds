// Modals: profile card, shop, garage + ride mint, burn tracker, voice panel, players, purchase flow. All text via textContent.
import { h, clear, modal, toast, fmt, ago, swatch, $ } from './dom.js';
import { Preview, getPreview } from './editor.js';
import { VIBES, NAMES, DEFAULT } from '../shared/traits.js';
import RIDES from '../shared/rides.js';
import { framed, FRAME_MSG, openDirect } from './frame.js';
import { pendingStore, replay } from './pending.mjs';
const store = () => { try { return pendingStore(localStorage); } catch { return pendingStore({ getItem: () => null, setItem: () => { throw new Error('no storage'); } }); } };

export const packAv = (av, FIELDS) => { const b = FIELDS.map((k) => av[k]); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const solscan = (cfg, id, kind = 'tx') => (cfg.network === 'localnet' ? null : `https://solscan.io/${kind}/${id}${cfg.network === 'devnet' ? '?cluster=devnet' : ''}`);
const link = (href, text) => (href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', text }) : h('span', { text }));
const tierChip = (t) => h('span', { class: 'tier t' + t, text: RIDES.TIERS[t] });

export function profileCardModal(ctx, m) {
  const { cfg, voice } = ctx; const v = VIBES[m.av.vibe] || VIBES[0]; const key = m.nick.toLowerCase().replace(/[ _-]+/g, '');
  const body = h('div', { class: 'pcard', style: { '--vc': v.color } });
  body.append(h('img', { class: 'portrait', src: `${ctx.server}/nft/${ctx.pack(m.av)}.svg`, alt: `${m.nick}'s avatar`, width: 160, height: 160 }));
  const info = h('div', { class: 'pinfo' }, h('h3', { text: m.nick }), h('div', { class: 'badge', text: `${v.icon} ${v.name}` }), h('div', { class: 'muted', text: `Profile ${m.pid}` }), h('div', { class: 'muted', text: 'Joined ' + new Date(m.created).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }));
  if (m.minted && m.minted.length) { const mm = h('div', { class: 'minted' }, h('b', { text: '★ Minted avatar NFT' })); for (const x of m.minted.slice(0, 3)) mm.append(h('div', { class: 'small' }, link(x.assetUrl || x.url, x.asset ? 'View NFT ↗' : 'View mint tx ↗'))); info.append(mm); }
  if (m.nf) info.append(h('div', { class: 'minted' }, h('img', { src: `${ctx.server}/api/nft-img/${m.nf.a}`, alt: m.nf.n, width: 56, height: 56, referrerpolicy: 'no-referrer', style: { borderRadius: '8px', float: 'left', marginRight: '8px' } }), h('b', { text: '🖼 NFT avatar ✓ verified' }), h('div', { class: 'small', text: m.nf.n })));
  if (m.items) info.append(h('div', { class: 'muted', text: `👕 ${m.items} shop item${m.items > 1 ? 's' : ''} owned` }));
  body.append(info);
  if (m.rides && m.rides.length) { const g = h('div', { class: 'ridegrid' }); for (const r of m.rides.slice(0, 6)) g.append(h('div', { class: 'ridemini' }, h('img', { src: `${ctx.server}/ride/${r.id}.svg`, alt: r.desc.model, width: 96, height: 96 }), tierChip(r.spec.tier), h('div', { class: 'small', text: r.desc.model + (r.desc.lowrider ? ' · LOWRIDER' : '') }))); body.append(h('div', { class: 'wide' }, h('b', { text: '🚗 Rides' }), g)); }
  if (m.sid !== ctx.state.me.id && voice) { const pr = voice.pref(key); const vol = h('input', { type: 'range', min: 0, max: 2, step: 0.1, value: pr.vol, 'aria-label': 'Voice volume', oninput: () => { pr.vol = +vol.value; voice.savePrefs(); } });
    const mute = h('button', { class: 'chip' + (pr.mute ? ' on' : ''), text: pr.mute ? '🔇 Muted' : '🔈 Mute voice', onclick: () => { pr.mute = !pr.mute; voice.savePrefs(); mute.className = 'chip' + (pr.mute ? ' on' : ''); mute.textContent = pr.mute ? '🔇 Muted' : '🔈 Mute voice'; } });
    const block = h('button', { class: 'chip' + (pr.block ? ' on' : ''), text: pr.block ? '⛔ Blocked' : '⛔ Block', onclick: () => { pr.block = !pr.block; voice.savePrefs(); block.className = 'chip' + (pr.block ? ' on' : ''); block.textContent = pr.block ? '⛔ Blocked' : '⛔ Block'; toast(pr.block ? `${m.nick} is blocked (voice + chat).` : `${m.nick} unblocked.`); } });
    body.append(h('div', { class: 'wide voicectl' }, h('b', { text: 'Voice for this player' }), h('div', { class: 'row' }, h('span', { text: 'Volume' }), vol), h('div', { class: 'row' }, mute, block))); }
  else if (m.sid === ctx.state.me.id) body.append(h('div', { class: 'wide row' }, h('button', { class: 'btn', text: '🧍 Edit my avatar', onclick: () => { ctx.closeTop(); ctx.openEditor(); } })));
  return modal('Player profile', body, { cls: 'pcm' });
}

export function burnModal(ctx) {
  const { cfg } = ctx; const s = ctx.state.burns || { totalBurned: 0, count: 0, recent: [] }; const b = h('div', { class: 'burn' });
  b.append(h('div', { class: 'bigburn' }, h('div', { class: 'n', text: fmt(s.totalBurned, 0) }), h('div', { text: '$VWFEST burned forever 🔥' })), h('p', { class: 'muted', text: cfg.enabled ? `Every avatar mint, mystery ride and booth or shop purchase burns $VWFEST: paying in $VWFEST burns it straight from your wallet; paying in SOL (shop and booths) sends ${cfg.devFeePct || 0}% to the creator wallet as a fee and buys back and burns the rest; avatars and rides are 100% buyback and burn. ${s.count} verified burn${s.count === 1 ? '' : 's'} so far.` : 'Purchases are not open yet. When they open, every avatar mint, ride and outfit buys back and burns $VWFEST. Each burn will be listed here with its Solscan link.' }));
  if (cfg.network !== 'mainnet-beta') b.append(h('p', { class: 'warn', text: `Test network: ${cfg.network}. These are not real burns.` }));
  const list = h('div', { class: 'burnlist' }); for (const r of s.recent) list.append(h('div', { class: 'burnrow' }, h('span', { class: 'who', text: r.nick }), h('span', { class: 'amt', text: '🔥 ' + fmt(r.amount, 0) }), h('span', { class: 'what', text: r.what.startsWith('shop:') ? 'outfit' : r.what === 'ride' ? 'ride' : 'avatar' }), h('span', { class: 'when', text: ago(r.ts) }), link(r.url, 'Solscan ↗')));
  if (!s.recent.length) list.append(h('p', { class: 'muted', text: 'No burns yet. Be the first!' })); b.append(list);
  b.append(h('p', { class: 'small muted', text: `Mint: ${cfg.mint || '(not set)'} · ledger ${s.persistent ? 'saved' : 'in memory'} · each entry is verified on-chain by the server before it is shown.` }));
  return modal('🔥 Burn Tracker', b);
}

export function playersModal(ctx) {
  const list = h('div', { class: 'plist' }); const all = [...ctx.state.roster.values(), ctx.state.me].sort((a, b) => a.nick.localeCompare(b.nick));
  for (const p of all) { const v = VIBES[p.av.vibe] || VIBES[0]; list.append(h('button', { class: 'prow', style: { '--vc': v.color }, onclick: () => { ctx.net.json({ t: 'profile', sid: p.id }); } }, h('span', { text: v.icon }), h('b', { text: p.nick + (p.m ? ' ★' : '') }), h('span', { class: 'muted', text: p.id === ctx.state.me.id ? 'you' : v.name }))); }
  return modal(`Players here (${all.length})`, list);
}

export function voiceModal(ctx) {
  const { voice, cfg } = ctx; const body = h('div', { class: 'voicep' }); let m; const draw = () => {
    clear(body); const st = voice;
    body.append(h('p', { class: 'muted', text: `Talk to players within ~${cfg.voiceRange || 15} m. Voices get quieter with distance and come from the speaker's direction. Audio goes peer-to-peer (WebRTC), and the other player can see your network address. Your microphone stays off until you turn it on.` }));
    body.append(h('div', { class: 'row' }, h('button', { class: 'btn' + (st.on ? ' primary' : ''), text: st.on ? '🎧 Voice ON: tap to leave' : '🎧 Join voice (listen)', onclick: () => { st.on ? st.stop() : st.start(); draw(); } }), h('button', { class: 'btn', text: st.micStream ? '🎙 Mic enabled ✓' : '🎙 Enable microphone', disabled: !!st.micStream, onclick: async () => { await st.enableMic(); draw(); } })));
    if (st.err) body.append(h('p', { class: 'warn', text: st.err }));
    body.append(h('div', { class: 'row' }, h('span', { text: 'Mic mode' }), ...['ptt', 'open', 'off'].map((md) => h('button', { class: 'chip' + (st.mode === md ? ' on' : ''), text: md === 'ptt' ? 'Push-to-talk (V)' : md === 'open' ? 'Open mic' : 'Muted', onclick: () => { st.setMode(md); draw(); } }))));
    body.append(h('div', { class: 'row' }, h('button', { class: 'chip' + (st.deaf ? ' on' : ''), text: st.deaf ? '🔇 Everything muted' : '🔈 Mute everyone', onclick: () => { st.deaf = !st.deaf; draw(); } })));
    body.append(h('div', { class: 'muted small', text: `Connected to ${st.connected()} of up to 8 nearby players. ${cfg.turn ? 'A relay (TURN) server is configured for strict networks.' : 'No TURN relay is configured: players on some strict corporate/mobile networks may not be able to connect.'}` }));
    body.append(h('div', { class: 'muted small', text: 'Per-player volume, mute and block: open a player\'s profile card (click them).' }));
  }; draw(); m = modal('🎙 Proximity voice', body, { onclose: () => { voice.onChange = () => {}; } }); voice.onChange = () => { if (m.el.isConnected) draw(); ctx.voiceChanged(); }; return m;
}

// ---------- shop ----------
export function shopModal(ctx) {
  const { cfg, state } = ctx; const root = h('div', { class: 'shop' }); const pv = getPreview(); const left = h('div', { class: 'pvbox' }); const grid = h('div', { class: 'shopgrid' }); const eq = { ...(state.inv.equipped || {}) };
  root.append(left, h('div', { class: 'shopcol' }, h('div', { class: 'banner', text: cfg.enabled ? `🔥 ${cfg.discountPct}% OFF when you pay with $VWFEST · every purchase burns $VWFEST` : '🛍 Browse the catalog. Purchases open soon (every purchase burns $VWFEST).' }), grid));
  pv.set(state.me.av, eq, 'person'); pv.mount(left);
  const draw = () => { clear(grid); for (const it of cfg.shop) { const own = state.inv.items.includes(it.id), on = state.inv.equipped && state.inv.equipped[it.slot] === it.id;
    const card = h('div', { class: 'item' + (own ? ' own' : '') }, h('div', { class: 'ico', text: it.emoji }), h('b', { text: it.name }), h('div', { class: 'small muted', text: it.desc }), h('span', { class: 'slot', text: it.slot }));
    if (own) card.append(h('button', { class: 'btn' + (on ? '' : ' primary'), text: on ? 'Unequip' : 'Equip', onclick: () => ctx.net.json({ t: 'equip', item: on ? null : it.id, slot: it.slot }) }));
    else { card.append(h('div', { class: 'prices' }, h('div', { class: 'pvp' }, h('span', { class: 'off', text: `${cfg.discountPct}% OFF with $VWFEST` }), h('b', { text: '$' + it.vwfestUsd.toFixed(2) }), h('span', { class: 'small', text: ' in $VWFEST' })), h('div', { class: 'ps small', text: `or $${it.usd.toFixed(2)} in SOL` + (cfg.solShopEnabled ? '' : ' (unavailable)') })),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Buy with $VWFEST', onclick: () => ctx.purchase('shop', { item: it, method: 'vwfest' }) }), h('button', { class: 'btn', text: 'Buy with SOL', disabled: !cfg.solShopEnabled, onclick: () => ctx.purchase('shop', { item: it, method: 'sol' }) })),
      h('button', { class: 'chip', text: 'Try on', onclick: () => { eq[it.slot] = it.id; pv.set(state.me.av, eq, 'person'); } })); }
    grid.append(card); } };
  draw(); const m = modal('👕 Outfit Shop', root, { cls: 'wide', onclose: () => { ctx.shopRedraw = null; } }); ctx.shopRedraw = () => { if (m.el.isConnected) draw(); }; return m;
}

// ---------- garage / showroom / ride mint ----------
export function garageModal(ctx) {
  const { cfg, state } = ctx; const root = h('div', { class: 'garage' }); let m;
  const draw = () => {
    clear(root); const rides = state.inv.rides || [];
    root.append(h('div', { class: 'row between' }, h('b', { text: `Your rides (${rides.length})` }), h('button', { class: 'btn primary', text: `🎁 Mint a mystery ride · $${cfg.rideUsd}`, onclick: () => rideMintDialog(ctx) })));
    const g = h('div', { class: 'ridegrid big' });
    for (const r of rides) { const eqd = state.inv.ride === r.id; g.append(h('div', { class: 'ridecard t' + r.spec.tier }, h('img', { src: `${ctx.server}/ride/${r.id}.svg`, alt: r.desc.model, width: 160, height: 160 }), h('div', {}, tierChip(r.spec.tier), h('b', { text: ` ${r.desc.model}` })), h('div', { class: 'small muted', text: `${r.desc.paint} · ${r.desc.wheels} · ${r.desc.stance} · plate ${r.desc.plate}` }), h('div', { class: 'small', text: r.desc.build }),
      h('div', { class: 'row' }, h('button', { class: 'btn' + (eqd ? '' : ' primary'), text: eqd ? 'Equipped ✓' : 'Drive this ride', onclick: () => ctx.net.json({ t: 'ride:equip', id: eqd ? null : r.id }) }), r.url ? link(r.url, 'Mint tx ↗') : null), h('details', { class: 'small' }, h('summary', { text: 'Verify the roll' }), h('div', { class: 'mono', text: `commit ${r.commit}\nseed ${r.seed}\nsig ${r.sig}${r.reroll ? '\nreroll #' + r.reroll : ''}` })))); }
    if (!rides.length) g.append(h('p', { class: 'muted', text: 'No rides yet. Every ride is a mystery NFT with its own VWFEST plate. Chase a Mythic LOWRIDER!' }));
    root.append(g);
    root.append(h('div', { class: 'odds' }, h('b', { text: 'Published odds' }), h('div', { class: 'row wrap' }, ...cfg.odds.map((o, i) => h('span', { class: 'tier t' + i, text: `${o.tier} ${o.pct}%` })))), h('p', { class: 'small muted', text: 'Controls: E to drive/exit your ride, hold Space for lowrider hydraulics (hop), P to park. Parked rides stay visible while you are online.' }));
  };
  draw(); m = modal('🚗 Garage & Showroom', root, { cls: 'wide', onclose: () => { ctx.garageRedraw = null; } }); ctx.garageRedraw = () => { if (m.el.isConnected) draw(); }; return m;
}
export function rideMintDialog(ctx) {
  const { cfg } = ctx; const b = h('div', { class: 'ridemint' });
  b.append(h('p', { text: `Mint a unique VW from the VW Fest Show Grounds Rides collection: model (Beetle, Bus, Karmann Ghia, Thing, Squareback, Baja), paint (candy, metallic, flake, two-tone, patina), wheels, stance and extras. Every ride has a VWFEST plate; some are DIAMOND. The rarest are Mythic LOWRIDERS with candy paint, murals, wire wheels and working hydraulics.` }), h('div', { class: 'row wrap' }, ...cfg.odds.map((o, i) => h('span', { class: 'tier t' + i, text: `${o.tier} ${o.pct}%` }))));
  b.append(h('details', { class: 'small' }, h('summary', { text: 'How the random reveal works (the server can\'t rig it)' }), h('p', { text: 'Before you pay, the server shows a commitment: SHA-256 of a secret seed. Your wallet signature on the mint transaction does not exist until you sign, so nobody can predict it. The ride is rolled from SHA-256(seed + ":" + your transaction signature). After the mint the seed is revealed with the NFT metadata, and anyone can recompute it and check it matches the commitment.' })));
  b.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', text: `Pay in $VWFEST (${cfg.discountPct}% OFF) · $${(cfg.rideUsd * (1 - cfg.discountPct / 100)).toFixed(2)}`, onclick: () => { ctx.closeTop(); ctx.purchase('ride', { method: 'vwfest' }); } }), h('button', { class: 'btn', text: `Pay in SOL · $${cfg.rideUsd}`, disabled: !cfg.enabled, // rides are 100% buyback & burn (no creator fee), so no DEV_WALLET is needed
 onclick: () => { ctx.closeTop(); ctx.purchase('ride', { method: 'sol' }); } })));
  return modal('🎁 Mint a mystery ride', b);
}
export function revealModal(ctx, r) {
  const b = h('div', { class: 'reveal t' + r.spec.tier }, h('img', { src: `${ctx.server}/ride/${r.id}.svg`, alt: r.desc.model, width: 240, height: 240 }), h('h3', { text: `${r.desc.tier.toUpperCase()}${r.desc.lowrider ? ' LOWRIDER' : ''}` }), h('div', { text: `${r.desc.model} · ${r.desc.paint} ${r.desc.color}` }), h('div', { class: 'small', text: `${r.desc.wheels} · ${r.desc.stance} · ${r.desc.plate} plate · ${r.desc.build}` }), r.desc.extras.length ? h('div', { class: 'small muted', text: r.desc.extras.join(' · ') }) : null, h('div', { class: 'row' }, link(r.url, 'Mint tx ↗'), link(r.assetUrl, 'NFT ↗')), h('div', { class: 'row' }, h('button', { class: 'btn primary', text: '🚗 Drive it (E)', onclick: () => { ctx.net.json({ t: 'ride:equip', id: r.id }); ctx.closeTop(); } })));
  return modal('🎉 Your new ride!', b);
}

// ---------- purchase flow ----------
export const waitFor = (ctx, type, ms = 20000) => { let cancel; const p = new Promise((res) => { const prev = ctx.waiters[type] || []; const drop = () => { clearTimeout(t); ctx.waiters[type] = (ctx.waiters[type] || []).filter((f) => f !== done); }; const done = (m) => { clearTimeout(t); res(m); }; const t = setTimeout(() => { drop(); res(null); }, ms); ctx.waiters[type] = [...prev, done]; cancel = () => { drop(); res(null); }; }); p.cancel = cancel; return p; };
// First of several message types; the losing waiters are removed so they cannot swallow the NEXT message of their type.
export const waitAny = async (ctx, types, ms = 20000) => { const ps = types.map((t) => waitFor(ctx, t, ms)); try { return await Promise.race(ps); } finally { ps.forEach((p) => p.cancel()); } };
export async function purchaseFlow(ctx, kind, opts) {
  if (framed) { toast('⚠ ' + FRAME_MSG); openDirect(); return; } // framed pages never show wallet / pay UI (clickjacking)
  const { cfg } = ctx; const body = h('div', { class: 'buy' }); const m = modal(opts.title || 'Purchase', body, { sticky: true });
  const say = (t, cls) => { clear(body); body.append(h('p', { class: cls || '', text: t })); };
  if (!cfg.enabled) { say('Purchases are not open yet. Everything you can see here is free to enjoy, and when purchases open, every one burns $VWFEST. Check back soon!'); return; }
  try {
    say('Getting your price…'); ctx.net.json({ t: 'quote', kind, item: opts.item && opts.item.id, method: opts.method, plot: opts.plot }); const r = await waitAny(ctx, ['quote', 'quoteerr']);
    if (!r) return say('The price service did not answer. Try again in a moment.', 'bad'); if (r.t === 'quoteerr') return say(r.why, 'bad'); const q = r.q;
    const pay = await import('./pay.js'); const rows = (items) => items.map(([k, v, c]) => h('div', { class: 'brow ' + (c || '') }, h('span', { text: k }), h('b', { text: v })));
    let payTok = null; const swapL = (prep) => (prep && prep.swapInfo && prep.swapInfo.swapLamports ? prep.swapInfo.swapLamports : BigInt(q.swapLamports));
    const draw = (prep, extra) => { clear(body);
      const solUsd = q.solUsd, tot = (prep && prep.swapInfo && prep.swapInfo.swapLamports ? prep.swapInfo.swapLamports : BigInt(q.swapLamports)) + BigInt(q.devLamports);
      body.append(h('div', { class: 'bd' }, h('h4', { text: (opts.item ? opts.item.name : q.name || 'VW FEST NFT') + ` · $${q.usd.toFixed(2)}` })));
      const lines = [];
      if (q.method === 'vwfest') lines.push([q.discountPct > 0 ? `Pay in $VWFEST (${q.discountPct}% OFF → $${q.paidUsd.toFixed(2)})` : `Pay in $VWFEST ($${q.paidUsd.toFixed(2)})`, `${fmt(q.burnUi, 2)} $VWFEST`, 'hl'], ['100% of it is burned', '🔥 burned from your wallet']);
      else if (payTok) { lines.push([`Pay with ${payTok.sym} (≈ $${q.paidUsd.toFixed(2)})`, prep ? `up to ${fmt(Number(prep.swapInfo.maxIn) / 10 ** payTok.dec, 4)} ${payTok.sym}` : `≈ $${(q.paidUsd * (1 - q.devPct / 100)).toFixed(2)} of ${payTok.sym}`, 'hl'], [`↳ swapped to $VWFEST via Jupiter and burned`, `≈ ${fmt(q.burnUi * 0.995, 2)} $VWFEST 🔥`]); if (BigInt(q.devLamports) > 0n) lines.push([`↳ ${q.devPct}% creator fee (SOL) to the creator wallet (full address below)`, `${fmt(Number(BigInt(q.devLamports)) / 1e9, 4)} SOL`]); }
      else { lines.push([`Pay in SOL (SOL = $${solUsd.toFixed(2)})`, `${fmt(Number(tot) / 1e9, 4)} SOL`, 'hl']); const sw = Number(swapL(prep)) / 1e9; if (q.swap) lines.push([`↳ ${fmt(sw, 4)} SOL swapped to $VWFEST via Jupiter and burned`, `≈ ${fmt(Number(prep ? prep.swapInfo.minOut : BigInt(q.burnMin)) / 10 ** cfg.decimals, 2)}+ $VWFEST 🔥`]); else lines.push([`↳ ${cfg.network} test mode: burns test tokens you hold`, `${fmt(q.burnUi, 2)} 🔥`]); if (BigInt(q.devLamports) > 0n) lines.push([`↳ ${q.devPct}% creator fee (SOL) to the creator wallet (full address below)`, `${fmt(Number(BigInt(q.devLamports)) / 1e9, 4)} SOL`]); else lines.push(['↳ 100% goes to buying back & burning $VWFEST', '']); }
      if (prep && prep.spentLamports !== null) { const net = prep.spentLamports - (q.method === 'sol' && !payTok ? tot : 0n); lines.push(['Network fees' + (q.uri ? ' + NFT account rent' : ''), `≈ ${fmt(Number(net) / 1e9, 5)} SOL`]); lines.push(['Total leaving your wallet', `≈ ${fmt(Number(prep.spentLamports) / 1e9, 4)} SOL` + (q.method === 'vwfest' ? ` + ${fmt(q.burnUi, 2)} $VWFEST` : ''), 'hl']); }
      if (!prep && q.method === 'sol' && q.swap && cfg.payTokens && cfg.payTokens.length) { const sel = h('select', { class: 'sel', 'aria-label': 'Pay with' }, h('option', { value: '', text: 'Pay with: SOL' }), ...cfg.payTokens.map((t) => h('option', { value: t.mint, text: 'Pay with: ' + t.sym }))); sel.value = payTok ? payTok.mint : ''; sel.onchange = () => { payTok = cfg.payTokens.find((t) => t.mint === sel.value) || null; draw(null); }; body.append(sel); }
      body.append(...rows(lines));
      if (q.devWallet && BigInt(q.devLamports || 0) > 0n) { const cb = h('button', { class: 'chip', text: 'Copy', 'aria-label': 'Copy creator wallet address' }); cb.onclick = () => copy(q.devWallet, cb); body.append(h('div', { class: 'brow addr' }, h('span', { text: 'Creator-fee wallet (full address, compare before you sign)' }), h('code', { text: q.devWallet }), cb)); }
      if (q.commit) body.append(h('p', { class: 'small mono', text: `Randomness commitment (SHA-256 of secret seed):\n${q.commit}` }), h('p', { class: 'small muted', text: 'Your ride is rolled from this seed + your transaction signature, so it cannot be rigged. The seed is revealed after minting.' }));
      if (q.method === 'sol' && q.swap) body.append(h('p', { class: 'small muted', text: `Slippage tolerance ${cfg.slippageBps / 100}%. If the swap returns slightly more than the guaranteed minimum, the small leftover stays in your wallet.` }));
      if (cfg.network !== 'mainnet-beta') body.append(h('p', { class: 'warn', text: `Test network (${cfg.network}). Not real money.` }));
      if (extra) body.append(extra); };
    draw(null);
    const status = h('p', { class: 'status' }); const btns = h('div', { class: 'row' }); body.append(status, btns);
    const step = (t) => { status.textContent = t; };
    let wallet = null;
    const gate = ageGate(); body.append(gate.el); const connectBtn = h('button', { class: 'btn primary', text: opts.wallet ? 'Review my purchase' : 'Connect wallet & review', onclick: async () => { if (!gate.on()) return; connectBtn.disabled = true; try {
      if (opts.wallet) wallet = { provider: opts.wallet.provider, pubkey: opts.wallet.pubkey }; else { step('Connecting your wallet…'); wallet = await pay.connectWallet(); } step('Proving wallet ownership (free signature)…'); await proveWallet(ctx, wallet); const prep = await pay.prepare({ q, cfg, server: ctx.server, pubkey: wallet.pubkey, onStep: step, payToken: payTok });
      draw(prep); const st2 = h('p', { class: 'status' }); const b2 = h('div', { class: 'row' }); body.append(st2, b2);
      const go = h('button', { class: 'btn primary', text: 'Sign & pay', onclick: async () => { go.disabled = true; try { const sig = await pay.signAndSend(prep, wallet.provider, (t) => { st2.textContent = t; }, (s) => store().add({ qid: q.id, sig: s, wallet: wallet.pubkey.toBase58() })); await record(sig, st2); } catch (e) { if (e.expired) store().remove(q.id); /* it never landed: nothing was spent, nothing to replay */ st2.textContent = '⚠ ' + (e.message || 'Cancelled'); st2.className = 'status bad'; if (e.pending && e.sig) b2.append(h('button', { class: 'btn', text: 'Retry recording', onclick: () => record(e.sig, st2) })); go.disabled = false; } } });
      b2.append(go, h('button', { class: 'btn', text: 'Cancel', onclick: () => m.close() }));
    } catch (e) { step('⚠ ' + (e.message || 'Could not prepare')); status.className = 'status bad'; connectBtn.disabled = false; } } });
    async function record(sig, st) { st.className = 'status'; st.textContent = 'Verifying on-chain…'; for (let i = 0; i < 6; i++) { ctx.net.json({ t: 'buy', qid: q.id, sig, wallet: wallet.pubkey.toBase58() }); const r2 = await waitFor(ctx, 'buyres', 25000); if (r2 && r2.ok) { store().remove(q.id); clear(body); body.append(h('h3', { text: '✅ Done!' }), h('p', { text: `Burned ${r2.burned} $VWFEST 🔥` }), h('div', { class: 'row' }, link(solscan(cfg, sig), 'View on Solscan ↗'), h('button', { class: 'btn primary', text: 'Close', onclick: () => m.close() }))); return; } if (!r2 || !r2.retry) { if (r2 && !r2.needProof) store().remove(q.id); /* a final answer: nothing left to replay (the reply carries the reason) */ st.textContent = '⚠ ' + (r2 ? r2.why : 'No answer from the server'); st.className = 'status bad'; return; } st.textContent = 'Waiting for the chain to confirm…'; await new Promise((r) => setTimeout(r, 2500)); } st.textContent = '⚠ Could not verify yet. Your payment went through; try recording it again from the Garage/Shop later.'; st.className = 'status bad'; }
    btns.append(connectBtn, h('button', { class: 'btn', text: 'Cancel', onclick: () => m.close() }));
  } catch (e) { say('Something went wrong: ' + (e.message || e), 'bad'); }
}

// 18+ / risk acknowledgement shown before any purchase or card payment.
function ageGate() {
  const cb = h('input', { type: 'checkbox' }); const el = h('label', { class: 'agegate' }, cb, h('span', { text: ' I am 18 or older. I understand this is a purchase of a digital item (an avatar or ride NFT, an outfit, or a vendor booth) that burns $VWFEST: not an investment, with no promise of value or returns, and crypto can lose value.' }));
  return { el, on() { if (cb.checked) return true; toast('Please tick the box to confirm first.'); el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 600); return false; } };
}
// Challenge-response: the server sends a nonce message, the wallet signs it (no funds involved), the server verifies the ed25519 signature.
export async function proveWallet(ctx, wallet) {
  const pk = wallet.pubkey.toBase58(); ctx.net.json({ t: 'wauth', pubkey: pk }); const ch = await waitFor(ctx, 'wchal', 10000); if (!ch || ch.pubkey !== pk) throw new Error('Could not start wallet verification. Try again.');
  if (!wallet.provider.signMessage) throw new Error('This wallet cannot sign a verification message. Try Phantom, Solflare or Backpack.');
  { const msg = String(ch.message); if (!msg.includes('\nDomain: ' + location.origin + '\n') || !msg.includes('\nWallet: ' + pk + '\n')) throw new Error('The verification message is not for this site and wallet. Nothing was signed.'); } // domain-bound challenge
  const { signText } = await import('./wallet.js'); const sig = await signText(wallet.provider, ch.message); ctx.net.json({ t: 'wproof', pubkey: pk, nonce: ch.nonce, sig }); const ok = await waitFor(ctx, 'wok', 10000); if (!ok || !ok.ok) throw new Error((ok && ok.why) || 'Wallet verification failed.');
}
// ---------- Entry / Mint: no-wallet path (Google sign-in -> embedded wallet -> fund by card/crypto -> mint) ----------
const copy = async (t, btn) => { try { await navigator.clipboard.writeText(t); const o = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = o; }, 1500); } catch { prompt('Copy:', t); } };
export async function entryModal(ctx, o = {}) {
  if (framed) { toast('⚠ ' + FRAME_MSG); openDirect(); return; }
  const { cfg } = ctx; const vend = o.kind === 'vendor'; const need$ = vend ? Math.ceil(cfg.vendor.feeUsd * 1.08) : cfg.entryUsd; const minPct = vend ? 102 : cfg.entryMinBurnPct; const body = h('div', { class: 'entry' }); const m = modal(vend ? (cfg.onramp && cfg.onramp.length ? '🏪 Claim a booth with a card' : '🏪 Claim a booth with Google') : '🎟 Entry / Mint your avatar NFT', body, { cls: 'wide', onclose: () => { clearInterval(poll); } });
  let w = null, poll = 0, lamports = null, solUsd = null; const wl = () => import('./wallet.js'); const pay = () => import('./pay.js');
  const intro = vend ? h('div', {}, h('p', { text: `Claim Booth #${o.plot} without owning crypto: sign in with Google (or use your wallet), add about $${need$} of SOL${cfg.onramp && cfg.onramp.length ? ' by card' : ''}, and the booth fee ($${cfg.vendor.feeUsd}) is paid in SOL: ${cfg.vendor.devFeePct > 0 ? cfg.vendor.devFeePct + '% goes to the creator wallet as a fee and the other ' + (100 - cfg.vendor.devFeePct) + '% is swapped to $VWFEST and burned. ' : 'all of it is swapped to $VWFEST and burned. '}You will see every number before you sign.` })) : h('div', {}, h('p', { text: `Get your one-of-a-kind avatar as an NFT in a few minutes, even if you have never used crypto. You pay $${cfg.entryUsd.toFixed(2)} for your NFT ("Entry / Mint"). This is a purchase, not a donation: the whole payment, minus unavoidable network and on-ramp fees, buys back and burns $VWFEST, and the NFT is minted to a wallet that only you control.` }), cfg.network !== 'mainnet-beta' ? h('p', { class: 'warn', text: `Test network (${cfg.network}). Not real money.` }) : null);
  const gate = ageGate(); const area = h('div', {}); body.append(intro, gate.el, area);
  if (!cfg.enabled) { area.append(h('p', { text: 'Minting is not open yet. Check back soon!' })); return; }
  const rpcConn = async () => { const { Connection } = await import('@solana/web3.js'); return (await import('./rpc.mjs')).readConnection(Connection, ctx.server, cfg); };
  const needLamports = () => (solUsd ? BigInt(Math.ceil(((need$ * minPct) / 100 / solUsd) * 1e9)) + 6000000n : null);
  async function refresh() { try { const c = await rpcConn(); lamports = BigInt(await c.getBalance(w.pubkey, 'confirmed')); if (!solUsd) { const r = await fetch(ctx.server + '/api/mint/price'); const j = await r.json(); solUsd = j.usd; } } catch {} if (m.el.isConnected) drawWallet(); }
  function drawChoose(err) {
    clear(area); if (err) area.append(h('p', { class: 'status bad', text: '⚠ ' + err }));
    area.append(h('h4', { text: '1 · Get a wallet' }));
    const stay = h('input', { type: 'checkbox' }); if (cfg.embedded) area.append(h('label', { class: 'small muted' }, stay, h('span', { text: ' Keep me signed in on this device (leave off on a shared computer)' })));
    if (cfg.embedded) area.append(h('button', { class: 'btn primary big', text: '🔐 Continue with Google', onclick: async (e) => { if (!gate.on()) return; e.target.disabled = true; e.target.textContent = 'Opening Google sign-in…'; try { w = await (await wl()).connectEmbedded(cfg, ctx.server, 'google', stay.checked); start(); } catch (x) { drawChoose(x.message || 'Sign-in failed'); } } }), h('p', { class: 'small muted', text: 'We never see your Google password. A wallet is created for you through MetaMask Embedded Wallets (Web3Auth): its key is split so no single party, including us, can move your funds.' }));
    else area.append(h('p', { class: 'small muted', text: 'Google sign-in is not switched on yet. You can still use your own Solana wallet below.' }));
    area.append(h('button', { class: 'btn', text: '👛 I already have a Solana wallet (Phantom, Solflare…)', onclick: async () => { try { w = await (await wl()).connectInjected(); start(); } catch (x) { drawChoose(x.message || 'Could not connect'); } } }));
    area.append(h('p', { class: 'small muted', text: 'By continuing you confirm you are 18+ (or the age of majority where you live), this is a purchase of a digital collectible, and $VWFEST has no promised value. Not financial advice.' }));
  }
  function start() { refresh(); clearInterval(poll); poll = setInterval(() => { if (!m.el.isConnected) return clearInterval(poll); refresh(); }, 5000); drawWallet(); }
  function drawWallet() {
    clear(area); const addr = w.pubkey.toBase58(); const need = needLamports(); const ready = lamports !== null && need !== null && lamports >= need;
    area.append(h('h4', { text: '1 · Your wallet ✓' }), h('div', { class: 'brow' }, h('span', { text: w.kind === 'embedded' ? `Google wallet (${w.label})` : w.label }), h('b', { text: addr.slice(0, 6) + '…' + addr.slice(-6) })));
    const cb = h('button', { class: 'btn', text: 'Copy address', onclick: () => copy(addr, cb) }); area.append(h('div', { class: 'row' }, cb, h('button', { class: 'btn', text: 'Sign out', onclick: async () => { clearInterval(poll); try { await w.logout(); } catch {} w = null; lamports = null; drawChoose(); } })));
    area.append(h('div', { class: 'brow hl' }, h('span', { text: 'Balance' }), h('b', { text: lamports === null ? 'checking…' : fmt(Number(lamports) / 1e9, 4) + ' SOL' + (solUsd ? ` (≈ $${fmt(Number(lamports) / 1e9 * solUsd, 2)})` : '') })));
    if (!ready) {
      area.append(h('h4', { text: `2 · Add about $${need$.toFixed(2)} of SOL` }), h('p', { class: 'small muted', text: `Pick any option. This page notices the moment the SOL arrives (checks every few seconds)${need ? ` and needs about ${fmt(Number(need) / 1e9, 3)} SOL` : ''}. On-ramp and network fees are charged by those services and reduce what is burned.` }));
      for (const p of cfg.onramp || []) { const b = h('button', { class: 'btn primary', text: `💳 Pay $${need$.toFixed(2)} with card / Apple Pay / Google Pay · ${p.name}`, onclick: async () => { if (!gate.on()) return; b.disabled = true; try { await proveWallet(ctx, w); ctx.net.json({ t: 'onramp', provider: p.id, purpose: vend ? 'vendor' : 'entry' }); const j = await waitAny(ctx, ['onrampres', 'onramperr'], 15000); if (!j || j.t === 'onramperr' || !/^https:\/\//.test(j.url || '')) throw new Error((j && j.why) || 'On-ramp unavailable'); // the server decides the delivery address: only this session's PROVEN wallet
          window.open(j.url, '_blank', 'noopener,noreferrer'); toast('Checkout opened in a new tab. Come back here when it finishes.'); } catch (x) { toast('⚠ ' + (x.message || 'On-ramp unavailable')); } b.disabled = false; } }); area.append(b, h('div', { class: 'small muted', text: p.how + '. They may ask you to verify your identity (KYC) and charge their own fee.' })); }
      if (!(cfg.onramp || []).length) area.append(h('p', { class: 'small muted', text: 'Card payments are not switched on yet. Use one of the options below.' }));
      area.append(h('details', { class: 'opt' }, h('summary', { text: 'Send SOL from an exchange or another wallet' }), h('p', { class: 'small', text: 'Withdraw SOL (network: Solana) to your address:' }), h('p', { class: 'mono small', text: addr })),
        h('details', { class: 'opt' }, h('summary', { text: 'Other crypto (ETH, BTC, USDC on other chains…)' }), h('p', { class: 'small', text: 'Use a cross-chain swap/bridge to deliver SOL to your address above, then come back here. These are independent third-party services:' }), h('div', { class: 'row' }, ...[['Mayan', 'https://swap.mayan.finance'], ['deBridge', 'https://app.debridge.finance'], ['Jupiter (Solana tokens)', 'https://jup.ag']].map(([n, u]) => h('a', { class: 'btn', href: u, target: '_blank', rel: 'noopener noreferrer', text: n + ' ↗' })), h('p', { class: 'small muted', text: 'Already hold USDC/BONK/JUP… on Solana? Skip this: use a regular wallet and pick the token in the avatar mint dialog.' }))));
    } else {
      area.append(h('h4', { text: '3 · Mint your avatar' }), h('p', { text: 'Your SOL has arrived. Next you will see exactly how much is swapped to $VWFEST and burned, and the network fee, before anything is signed.' }), h('button', { class: 'btn primary big', text: vend ? '🏪 Review & claim' : '✨ Review & mint', onclick: () => { clearInterval(poll); m.close(); (vend ? purchaseFlow(ctx, 'vendor', { method: 'sol', wallet: w, plot: o.plot, title: '🏪 Booth #' + o.plot }) : purchaseFlow(ctx, 'avatar', { method: 'sol', wallet: w, title: 'Entry / Mint' })); } }));
    }
    area.append(h('details', { class: 'opt', open: false }, h('summary', { text: '🔑 You own this wallet: backup & recovery' }), recovery(w)));
  }
  function recovery(w) {
    const d = h('div', { class: 'small' });
    d.append(h('p', { text: w.kind === 'embedded' ? 'Your wallet is tied to your Google sign-in. If you can still sign in with the same Google account on this site, you can always get back to it. To use it anywhere else, or if you ever want to be safe from any service shutting down, export your private key and import it into Phantom, Solflare or Backpack ("Add wallet → Import private key").' : 'This is your own wallet app. Keep its recovery phrase safe; we cannot recover it.' }));
    if (w.exportKey) { const out = h('div', {}); d.append(h('p', { class: 'warn', text: 'Anyone who sees your private key can take everything in this wallet. Never share it, never paste it into a website, and do not screenshot it.' }), h('button', { class: 'btn', text: 'Reveal my private key', onclick: async () => { if (!confirm('Show your private key? Make sure nobody is looking at your screen.')) return; clear(out); let key = ''; try { key = await w.exportKey(); } catch (x) { out.append(h('p', { class: 'warn', text: x.message || 'Could not export the key.' })); return; }
      const inp = h('input', { type: 'text', readonly: true, class: 'mono small', value: key, 'aria-label': 'Private key', autocomplete: 'off', spellcheck: 'false' }); key = ''; const wipe = () => { inp.value = ''; clear(out); document.removeEventListener('visibilitychange', onvis); clearTimeout(tm); }; const onvis = () => { if (document.hidden) wipe(); }; const tm = setTimeout(wipe, 15000);
      document.addEventListener('visibilitychange', onvis); const c = h('button', { class: 'btn', text: 'Copy', onclick: () => copy(inp.value, c) }); out.append(inp, c, h('button', { class: 'btn', text: 'Hide', onclick: wipe }), h('p', { class: 'small muted', text: 'Hides itself after 15 seconds or when you leave this tab.' })); inp.select(); } }), out); }
    return d;
  }
  // restore a previous Google session silently
  if (cfg.embedded) { drawChoose(); wl().then((x) => x.resumeEmbedded(cfg, ctx.server)).then((r) => { if (r && m.el.isConnected && !w) { w = r; start(); } }).catch(() => {}); } else drawChoose();
}

// ---------- finish purchases that were paid but never credited (closed tab, crash, restart, flaky connection) ----------
let resuming = false;
export async function resumePurchases(ctx) {
  const ps = store(); if (resuming || !ps.list().length || !ctx.cfg.enabled) return; resuming = true;
  try {
    for (let round = 0; round < 6; round++) {
      const res = await replay(ps, async (e) => { ctx.net.json({ t: 'buy', qid: e.qid, sig: e.sig, wallet: e.wallet }); const r = await waitFor(ctx, 'buyres', 25000); return r && (!r.qid || r.qid === e.qid) ? r : null; });
      for (const e of res.credited) toast('✅ Your earlier payment was credited (' + e.sig.slice(0, 8) + '…)');
      for (const f of res.failed) toast('⚠ A payment could not be credited: ' + f.why + ' Transaction ' + f.sig.slice(0, 12) + '…', 12000);
      if (!ps.list().length) return;
      if (res.needProof.length && !res.retry.length) return proofPrompt(ctx, res.needProof);
      await new Promise((r) => setTimeout(r, 5000 * (round + 1)));
    }
  } finally { resuming = false; }
}
function proofPrompt(ctx, entries) {
  resuming = false; const body = h('div', { class: 'buy' }); const m = modal('Finish your purchase', body, { sticky: false }); const st = h('p', { class: 'status' });
  const want = entries[0].wallet; body.append(h('p', { text: 'You paid for something earlier that was not recorded yet. Verify the wallet you paid from (a free signature) and it will be credited.' }), h('p', { class: 'small mono', text: 'Wallet ' + want.slice(0, 6) + '…' + want.slice(-4) }), st);
  body.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Verify wallet & finish', onclick: async (ev) => { ev.target.disabled = true; try { const pay = await import('./pay.js'); const w = await pay.connectWallet(); if (w.pubkey.toBase58() !== want) throw new Error('Connect the wallet that paid (' + want.slice(0, 6) + '…' + want.slice(-4) + ').'); st.textContent = 'Proving wallet ownership (free signature)…'; await proveWallet(ctx, w); m.close(); resumePurchases(ctx); } catch (e) { st.textContent = '⚠ ' + (e.message || 'Could not verify'); st.className = 'status bad'; ev.target.disabled = false; } } }), h('button', { class: 'btn', text: 'Later', onclick: () => m.close() })));
}
