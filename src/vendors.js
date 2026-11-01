// Vendor Row UI (panel, directory, owner editor, leaving-site warning) and the Info Booth guide. All text is rendered with textContent (never innerHTML).
import { h, clear, modal, toast, fmt, $ } from './dom.js';
const money = (n) => '$' + (Number.isInteger(+n) ? n : (+n).toFixed(2));
const when = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const left = (ms) => { const d = (ms - Date.now()) / 86400000; return d > 1 ? `${Math.ceil(d)} days left` : d > 0 ? `${Math.max(1, Math.round(d * 24))} h left` : 'expired'; };
export const imgUrl = (ctx, id) => `${ctx.server}/vendor/img/${id}.jpg`;
const creds = (ctx) => (ctx.state.creds && ctx.state.creds.id ? { id: ctx.state.creds.id, secret: ctx.state.creds.secret } : null);
async function api(ctx, path, body) { const r = await fetch(ctx.server + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...creds(ctx), ...body }) }); const j = await r.json().catch(() => ({})); if (!r.ok && !j.why) j.why = j.error || 'Request failed'; return { ok: r.ok && j.ok !== false, ...j }; }

export const TERMS = 'Vendors are independent and fully responsible for their products, claims and links. VW FEST SHOW GROUNDS does not sell, endorse, inspect or guarantee anything on Vendor Row, and is not a party to any sale. Booth fees are non-refundable. Paying in $VWFEST burns the whole fee; paying with SOL or another token sends part of it to the creator wallet as a fee and burns the rest (the exact split is shown before you sign). Illegal, hateful, adult, deceptive or scam content is not allowed and booths can be hidden or removed by moderators without refund. Buy at your own risk, and never share your seed phrase with anyone.';

// ---- leaving-site warning ----
export function leaveWarning(url) {
  let host = ''; try { host = new URL(url).hostname; } catch { return; }
  const m = modal('⚠ You are leaving the show grounds', h('div', {}, h('p', { text: 'This link was added by a vendor and goes to another website:' }), h('p', { class: 'mono', text: host }), h('p', { class: 'small muted', text: 'VW FEST does not control or check that site. Never enter your seed phrase or private key there, and be careful connecting your wallet.' }),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Open it in a new tab', onclick: () => { window.open(url, '_blank', 'noopener,noreferrer'); m.close(); } }), h('button', { class: 'btn', text: 'Stay here', onclick: () => m.close() }))));
}
function lightbox(src) { const m = modal('', h('img', { src, alt: 'Product', class: 'lightimg' }), {}); return m; }

// ---- booth panel ----
export async function boothModal(ctx, plot) {
  const v = ctx.state.vendors || []; const card = v.find((b) => b.plot === plot); const cfg = ctx.cfg, vc = cfg.vendor || {};
  const mineNick = ctx.state.me && ctx.state.me.nick;
  if (!card || card.state !== 'open') {
    const body = h('div', {}); const mod = modal(`Booth #${plot}`, body);
    const mine = (v.find((b) => b.nick === mineNick) || null);
    if (card && card.state === 'grace') { body.append(h('p', { text: 'This booth is closed. The owner can still renew it.' })); if (card.nick === mineNick) body.append(h('button', { class: 'btn primary', text: 'Renew my booth', onclick: () => { mod.close(); renewFlow(ctx); } })); return; }
    body.append(h('h3', { text: 'Booth available!' }), h('p', { text: `Claim Booth #${plot} on Vendor Row for ${money(vc.feeUsd)}. It stays open for ${vc.days} days and you can renew it any time.` }), h('ul', { class: 'small' }, h('li', { text: `Paying in $VWFEST: the whole ${money(vc.feeUsd)} is burned straight from your wallet (no token discount on booths).` }), h('li', { text: vc.devFeePct > 0 ? `Paying with SOL or another token: ${vc.devFeePct}% goes to the creator wallet as a fee and the other ${100 - vc.devFeePct}% is swapped to $VWFEST and burned.` : 'Paying with SOL or another token: all of it is swapped to $VWFEST and burned.' }), h('li', { text: 'Customize it: name, banner, logo, up to ' + vc.maxProducts + ' product pictures, description, link and tent style.' })), h('p', { class: 'small muted', text: TERMS }));
    const agree = h('input', { type: 'checkbox', id: 'vagree' }); body.append(h('label', { class: 'row small' }, agree, ' I have read and accept these terms'));
    if (mine) body.append(h('p', { class: 'warn', text: 'You already have a booth on Vendor Row (one per player).' }));
    else if (!cfg.enabled) body.append(h('p', { class: 'warn', text: 'Purchases are not open yet.' }));
    else { const go = (m) => () => { if (!agree.checked) return toast('Please accept the terms first.'); mod.close(); ctx.purchase('vendor', { method: m, plot, title: `🏪 Booth #${plot}` }); }; body.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', text: `Claim with $VWFEST (${money(vc.feeUsd)} burned)`, onclick: go('vwfest') }), h('button', { class: 'btn', text: 'Claim with SOL / other token', disabled: !vc.solAvailable, onclick: go('sol') }), h('button', { class: 'btn', text: '💳 No wallet? Card', onclick: () => { if (!agree.checked) return toast('Please accept the terms first.'); mod.close(); ctx.entry({ kind: 'vendor', plot }); } }))); }
    return;
  }
  const body = h('div', { class: 'booth' }); const mod = modal(`${card.name}`, body, { cls: 'wide' });
  body.append(h('p', { class: 'muted', text: 'Loading…' }));
  let d = null; try { const r = await fetch(`${ctx.server}/api/vendors/${plot}`); d = (await r.json()).booth; } catch {}
  clear(body); if (!d) { body.append(h('p', { text: 'This booth is not available right now.' })); return; }
  if (d.banner) body.append(h('img', { class: 'bbanner', src: imgUrl(ctx, d.banner), alt: '' }));
  body.append(h('div', { class: 'bhead' }, d.logo ? h('img', { class: 'blogo', src: imgUrl(ctx, d.logo), alt: '' }) : null, h('div', {}, h('h3', { text: d.name }), h('div', { class: 'small muted', text: `by ${d.nick} · Booth #${d.plot} · open until ${when(d.exp)} (${left(d.exp)})` }))));
  if (d.pending) body.append(h('p', { class: 'small warn', text: 'Pictures are waiting for moderator approval.' }));
  if (d.desc) body.append(h('p', { class: 'bdesc', text: d.desc }));
  if (d.products.length) body.append(h('div', { class: 'bprods' }, ...d.products.map((p) => h('figure', {}, h('img', { src: imgUrl(ctx, p.img), alt: p.title || 'Product', loading: 'lazy', onclick: () => lightbox(imgUrl(ctx, p.img)) }), p.title ? h('figcaption', { text: p.title }) : null))));
  const row = h('div', { class: 'row' }); if (d.link) { let host = ''; try { host = new URL(d.link).hostname; } catch {} row.append(h('button', { class: 'btn primary', text: `Visit ${host} ↗`, onclick: () => leaveWarning(d.link) })); }
  if (d.nick === mineNick) row.append(h('button', { class: 'btn', text: '✏ Edit my booth', onclick: () => { mod.close(); editorModal(ctx); } }), h('button', { class: 'btn', text: `🔁 Renew (+${(vc.days)} days)`, onclick: () => { mod.close(); renewFlow(ctx); } }));
  else row.append(h('button', { class: 'btn', text: '🚩 Report', onclick: async () => { if (!confirm('Report this booth to the moderators?')) return; const r = await api(ctx, '/api/vendor/report', { plot }); toast(r.ok ? 'Thanks, we will take a look.' : '⚠ ' + (r.why || 'Could not report')); } }));
  body.append(row, h('p', { class: 'small muted', text: TERMS }));
}
export function renewFlow(ctx) { ctx.purchase('vendor', { method: ctx.cfg.vendor && ctx.cfg.vendor.solAvailable ? 'sol' : 'vwfest', title: '🏪 Renew booth' }); }

// ---- directory ----
export function vendorDirectory(ctx) {
  const list = (ctx.state.vendors || []).filter((b) => b.state === 'open'); const vc = ctx.cfg.vendor || {}; const body = h('div', { class: 'vdir' });
  body.append(h('p', { class: 'small muted', text: `Vendor Row is behind the stage (${(ctx.state.vendorPlots || vc.plots || 24)} plots). ${list.length} open now · booths cost ${money(vc.feeUsd)} for ${vc.days} days.` }));
  if (!list.length) body.append(h('p', { text: 'No vendors yet. Be the first: walk to Vendor Row and claim a booth!' }));
  const side = (p) => (p <= Math.ceil((ctx.state.vendorPlots || 24) / 2) ? 'left' : 'right');
  for (const b of list) body.append(h('div', { class: 'vrow', style: { borderLeft: `6px solid ${b.c1}` } }, b.logo ? h('img', { src: imgUrl(ctx, b.logo), alt: '' }) : h('div', { class: 'vlogo', text: '🏪' }), h('div', { class: 'grow' }, h('b', { text: b.name }), h('div', { class: 'small muted', text: `by ${b.nick} · #${b.plot} (${side(b.plot)} side) · ${left(b.exp)}` })), h('button', { class: 'btn', text: 'View', onclick: () => boothModal(ctx, b.plot) })));
  body.append(h('div', { class: 'row' }, h('button', { class: 'btn', text: 'My booth', onclick: () => { const mine = (ctx.state.vendors || []).find((b) => b.nick === (ctx.state.me && ctx.state.me.nick)); if (mine) boothModal(ctx, mine.plot); else toast('You do not have a booth yet. Walk to Vendor Row to claim one.'); } })), h('p', { class: 'small muted', text: TERMS }));
  return modal('🏪 Vendor directory', body, { cls: 'wide' });
}

// ---- owner editor ----
const TENTS = ['Striped', 'Valance', 'Gable', 'Checker', 'Pyramid'];
const SW = ['#e63946', '#ff7a1a', '#ffd166', '#06d6a0', '#2a9d8f', '#118ab2', '#4ea8ff', '#9b5de5', '#ff4fa3', '#f4f1ea', '#2b2d42', '#8a6a3f'];
// Resize + re-encode through a canvas: always a clean JPEG, metadata stripped, under the size limit.
export async function toJpeg(file, w, h2, kb, cover = true) {
  const bm = await createImageBitmap(file); const r = cover ? Math.max(w / bm.width, h2 / bm.height) : Math.min(w / bm.width, h2 / bm.height, 1); const cw = cover ? w : Math.round(bm.width * r), ch = cover ? h2 : Math.round(bm.height * r);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.drawImage(bm, (cw - bm.width * r) / 2, (ch - bm.height * r) / 2, bm.width * r, bm.height * r);
  for (let q = 0.86; q > 0.3; q -= 0.08) { const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', q)); if (blob.size <= kb * 1024) return blob; } throw new Error('Could not shrink that picture enough. Try a simpler image.');
}
const b64 = (blob) => new Promise((res) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.readAsDataURL(blob); });
export async function editorModal(ctx) {
  const vc = ctx.cfg.vendor || {}; const body = h('div', { class: 'vedit' }); const mod = modal('✏ Edit my booth', body, { cls: 'wide' }); body.append(h('p', { class: 'muted', text: 'Loading…' }));
  const r = await api(ctx, '/api/vendor/mine', {}); clear(body); if (!r.ok || !r.mine) { body.append(h('p', { text: 'You do not have an open booth. Claim or renew one on Vendor Row.' })); return; }
  const m = r.mine; const S = { name: m.name, desc: m.desc || '', link: m.link || '', tent: m.tent, c1: m.c1, c2: m.c2, logo: m.logo, banner: m.banner, products: (m.products || []).map((p) => ({ img: p.img, title: p.title || '' })) };
  const status = h('p', { class: 'status' }); const f = (label, el, hint) => h('label', { class: 'fld' }, h('span', { text: label }), el, hint ? h('small', { class: 'muted', text: hint }) : null);
  const name = h('input', { maxlength: 28, value: S.name }); const desc = h('textarea', { rows: 4, maxlength: 300 }); desc.value = S.desc; const link = h('input', { type: 'url', placeholder: 'https://…', maxlength: 200, value: S.link });
  const tent = h('select', { class: 'sel' }, ...TENTS.map((t, i) => h('option', { value: i, text: t }))); tent.value = S.tent;
  const sw = (key) => { const w = h('div', { class: 'swrow' }); const draw = () => { clear(w); for (const c of SW) w.append(h('button', { class: 'sw' + (S[key] === c ? ' on' : ''), style: { background: c }, 'aria-label': c, onclick: () => { S[key] = c; draw(); } })); }; draw(); return w; };
  const up = (label, w, hh, key, hint) => { const prev = h('div', { class: 'upprev' }); const draw = () => { clear(prev); if (S[key]) prev.append(h('img', { src: imgUrl(ctx, S[key]), alt: '' }), h('button', { class: 'chip', text: 'Remove', onclick: () => { S[key] = null; draw(); } })); }; draw();
    const inp = h('input', { type: 'file', accept: 'image/*', onchange: async () => { const file = inp.files[0]; if (!file) return; status.textContent = 'Uploading…'; status.className = 'status'; try { const blob = await toJpeg(file, w, hh, vc.imgKb); const rr = await api(ctx, '/api/vendor/img', { data: await b64(blob) }); if (!rr.ok) throw new Error(rr.why); S[key] = rr.id; status.textContent = ''; draw(); } catch (e) { status.textContent = '⚠ ' + e.message; status.className = 'status bad'; } inp.value = ''; } }); return f(label, h('div', {}, inp, prev), hint); };
  const prods = h('div', { class: 'prodedit' }); const drawProds = () => { clear(prods); S.products.forEach((p, i) => prods.append(h('div', { class: 'pe' }, h('img', { src: imgUrl(ctx, p.img), alt: '' }), h('input', { maxlength: 40, placeholder: 'Caption (optional)', value: p.title, oninput: (e) => { p.title = e.target.value; } }), h('button', { class: 'chip', text: '✕', onclick: () => { S.products.splice(i, 1); drawProds(); } })))); if (S.products.length < vc.maxProducts) { const inp = h('input', { type: 'file', accept: 'image/*', onchange: async () => { const file = inp.files[0]; if (!file) return; status.textContent = 'Uploading…'; status.className = 'status'; try { const blob = await toJpeg(file, 640, 640, vc.imgKb, false); const rr = await api(ctx, '/api/vendor/img', { data: await b64(blob) }); if (!rr.ok) throw new Error(rr.why); S.products.push({ img: rr.id, title: '' }); status.textContent = ''; drawProds(); } catch (e) { status.textContent = '⚠ ' + e.message; status.className = 'status bad'; } } }); prods.append(h('label', { class: 'addprod' }, `+ Add product picture (${S.products.length}/${vc.maxProducts})`, inp)); } }; drawProds();
  body.append(h('p', { class: 'small muted', text: `Open until ${when(m.exp)} (${left(m.exp)}). Pictures are shrunk to JPEGs under ${vc.imgKb} KB. Links must be https.` }), f('Booth name', name), f('Description', desc, 'Max 300 characters. No links here; use the link field.'), f('Link (https only)', link, 'Visitors see a "you are leaving the site" warning first.'), up('Banner (wide)', 1024, 384, 'banner'), up('Logo (square)', 256, 256, 'logo'), f('Products', prods), f('Tent style', tent), h('div', { class: 'fld' }, h('span', { text: 'Tent color 1' }), sw('c1')), h('div', { class: 'fld' }, h('span', { text: 'Tent color 2' }), sw('c2')), h('p', { class: 'small muted', text: TERMS }), status);
  body.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'Save booth', onclick: async (e) => { e.target.disabled = true; const rr = await api(ctx, '/api/vendor/save', { name: name.value, desc: desc.value, link: link.value.trim(), tent: +tent.value, c1: S.c1, c2: S.c2, logo: S.logo, banner: S.banner, products: S.products }); e.target.disabled = false; if (!rr.ok) { status.textContent = '⚠ ' + rr.why; status.className = 'status bad'; return; } toast('Booth saved!'); mod.close(); }, }), h('button', { class: 'btn', text: 'Cancel', onclick: () => mod.close() })));
}

// ---- Info Booth guide ----
export async function infoModal(ctx, startTab) {
  const body = h('div', { class: 'guide' }); const mod = modal('ℹ How it works', body, { cls: 'wide' }); body.append(h('p', { class: 'muted', text: 'Loading the guide…' }));
  let g; try { g = await (await fetch(ctx.server + '/api/guide')).json(); } catch {} clear(body); if (!g || !g.ok) { body.append(h('p', { text: 'The guide could not load. Try again in a moment.' })); return mod; }
  const tabs = h('div', { class: 'gtabs' }); const page = h('div', { class: 'gpage' }); body.append(tabs, page);
  const render = (blk) => {
    if (blk.p) return h('p', { text: blk.p }); if (blk.ul) return h('ul', {}, ...blk.ul.map((t) => h('li', { text: t })));
    if (blk.q) return h('details', { class: 'faq' }, h('summary', { text: blk.q }), h('p', { text: blk.a }));
    if (blk.odds) return h('table', { class: 'odds' }, ...blk.odds.map(([t, p]) => h('tr', {}, h('td', { text: t }), h('td', { text: p }))));
    if (blk.games) return h('div', { class: 'row' }, ...blk.games.map((x) => h('a', { class: 'btn', href: x.url, target: '_blank', rel: 'noopener noreferrer', text: `${x.icon} ${x.name} ↗` })));
    return null;
  };
  const all = [...g.sections.map((s) => ({ id: s.id, label: `${s.icon} ${s.title}`, draw: () => [h('h3', { text: s.title }), ...s.blocks.map(render)] })), { id: 'new', label: "🆕 What's new", draw: () => [h('h3', { text: "What's new" }), ...g.changelog.map((c) => h('div', { class: 'cl' }, h('b', { text: c.date }), h('ul', {}, ...c.items.map((i) => h('li', { text: i }))))) ] }];
  const show = (id) => { clear(page); const t = all.find((x) => x.id === id) || all[0]; page.append(...t.draw().filter(Boolean)); [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.id === t.id)); page.scrollTop = 0; };
  for (const t of all) tabs.append(h('button', { class: 'gtab', 'data-id': t.id, text: t.label, onclick: () => show(t.id) })); show(startTab || 'start'); return mod;
}
