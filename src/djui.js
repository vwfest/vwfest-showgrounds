import { h, modal, toast, $ } from './dom.js';
const mmss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// "Now playing" chip (always visible once the DJ is live) and the DJ panel (claim, queue, tracks, volume, mic, hype).
export function mountChip(dj, ctx) {
  const chip = h('div', { id: 'djchip', class: 'hidden' }, h('span', { class: 'dji', text: '🎧' }), h('span', { class: 'djt' }), h('button', { class: 'djb', title: 'Hype! (H)', 'aria-label': 'Hype', text: '🙌', onclick: () => ctx.hype() }), h('button', { class: 'djb', title: 'DJ panel', 'aria-label': 'DJ panel', text: '🔊', onclick: () => djModal(ctx, dj) }));
  document.body.append(chip);
  const upd = () => { const st = dj.st; const live = st && st.on && st.dj && st.track; chip.classList.toggle('hidden', !live); if (!live) return; chip.querySelector('.djt').textContent = `${st.dj.nick} · ${st.track.title}`; chip.querySelector('.djb:last-child').textContent = dj.muted ? '🔇' : '🔊'; };
  return upd;
}

export function djModal(ctx, dj) {
  const body = h('div', { class: 'djp' }), dyn = h('div'); let m;
  const draw = () => {
    const st = dj.st; dyn.replaceChildren(); const body = dyn; if (!st || !st.on) { body.append(h('p', { class: 'muted', text: 'The DJ booth is switched off right now.' })); return; }
    const meId = ctx.state.me && ctx.state.me.id; const me = !!(st.dj && st.dj.id === meId); const q = st.queue || []; const inQ = q.findIndex((x) => x.id === meId); const now = dj.serverNow();
    // now playing
    if (st.dj && st.track) { const el = (now - st.track.at) / 1000; body.append(h('div', { class: 'djnow' }, h('div', { class: 'djnm', text: `🎧 ${st.dj.nick} is the DJ` }), h('div', { class: 'djtr', text: `♪ ${st.track.title} — ${st.track.artist}` }), h('div', { class: 'djbar' }, h('i', { style: { width: Math.min(100, el / st.track.dur * 100) + '%' } })), h('div', { class: 'muted small', text: `${mmss(el)} / ${mmss(st.track.dur)}` + (st.dj.until ? ` · set ends in ${mmss((st.dj.until - now) / 1000)}` : '') + (st.mic ? ' · 🎙 DJ is talking' : '') }))); }
    else body.append(h('div', { class: 'djnow' }, h('div', { class: 'djnm', text: '🎧 The decks are free' }), h('div', { class: 'muted', text: 'Walk up to the booth in front of the stage and press F to take them.' })));
    // actions
    const row = h('div', { class: 'row wrap' });
    if (me) row.append(h('button', { class: 'btn', text: '⏭ Skip track', onclick: () => dj.skip() }), h('button', { class: 'btn' + (dj.talking ? ' on' : ''), text: dj.talking ? '🎙 Mic ON (click to stop)' : '🎙 Open mic', onclick: () => dj.talk(!dj.talking) }), h('button', { class: 'btn ghost', text: 'Step down', onclick: () => dj.leave() }));
    else if (inQ >= 0) row.append(h('span', { class: 'muted', text: `You are #${inQ + 1} in the queue.` }), h('button', { class: 'btn ghost', text: 'Leave queue', onclick: () => dj.leave() }));
    else row.append(h('button', { class: 'btn', text: st.dj ? 'Join the queue' : '🎧 Take the decks', onclick: () => dj.claim() }));
    row.append(h('button', { class: 'btn', text: '🙌 Hype!', onclick: () => ctx.hype() })); body.append(row);
    if (dj.err) body.append(h('p', { class: 'warn', text: dj.err }));
    if (me) { const hold = h('button', { class: 'btn talk', text: 'Hold to talk (or hold T)' }); hold.addEventListener('pointerdown', (e) => { e.preventDefault(); dj.talk(true); }); hold.addEventListener('pointerup', () => dj.talk(false)); hold.addEventListener('pointerleave', () => dj.talk(false)); body.append(hold); }
    // queue
    if (q.length) body.append(h('div', { class: 'djq' }, h('b', { text: `Queue (${st.qn})` }), ...q.map((x, i) => h('div', { class: 'muted', text: `${i + 1}. ${x.nick}` }))));
    // playlist
    if (me && ctx.playlist) body.append(h('div', { class: 'djl' }, h('b', { text: 'Pick a track' }), ...ctx.playlist.map((t, i) => h('button', { class: 'djtrk' + (st.track && st.track.i === i ? ' on' : ''), onclick: () => dj.pick(i), text: `${i + 1}. ${t.title} — ${t.artist} (${mmss(t.dur)})` }))));
    if (dj.blocked) body.append(h('button', { class: 'btn', text: '🔊 Tap to enable DJ audio', onclick: () => dj.unlock() }));
  };
  const vol = h('input', { type: 'range', min: 0, max: 100, value: Math.round(dj.vol * 100), 'aria-label': 'DJ volume', oninput: (e) => dj.setVol(e.target.value / 100) });
  body.append(dyn, h('div', { class: 'row wrap djvol' }, h('b', { text: 'Your volume' }), vol, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: dj.muted, onchange: (e) => dj.setMuted(e.target.checked) }), ' Mute DJ')),
    h('p', { class: 'muted small', text: 'The music is loudest near the stage and gets quieter as you walk away. DJs: only play music you have the rights to.' }));
  m = modal('🎧 DJ booth', body, { cls: 'wide', onclose: () => { dj.panel = null; } }); dj.panel = draw; draw(); return m;
}
