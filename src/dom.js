// Tiny DOM helpers. No innerHTML anywhere: every string from the server is rendered via textContent.
export const $ = (s, r = document) => r.querySelector(s);
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) { const v = attrs[k]; if (v === undefined || v === null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'style') Object.assign(e.style, v); else e.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat()) if (c !== undefined && c !== null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
export const clear = (e) => { while (e.firstChild) e.removeChild(e.firstChild); return e; };
export const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
export const ago = (ms) => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago'; };
export function toast(text, ms = 3500) { const box = $('#toasts'); const t = h('div', { class: 'toast', text }); box.append(t); setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 400); }
export function modal(title, body, opts = {}) {
  const root = $('#modals'); const close = () => { m.remove(); if (opts.onclose) opts.onclose(); };
  const m = h('div', { class: 'modal-back', onpointerdown: (e) => { if (e.target === m && !opts.sticky) close(); } }, h('div', { class: 'modal ' + (opts.cls || ''), role: 'dialog', 'aria-label': title }, h('div', { class: 'modal-head' }, h('b', { text: title }), h('button', { class: 'x', 'aria-label': 'Close', onclick: close, text: '✕' })), h('div', { class: 'modal-body' }, body)));
  root.append(m); return { el: m, close, body: m.querySelector('.modal-body') };
}
export const swatch = (hex, on, onclick, title) => h('button', { class: 'sw' + (on ? ' on' : ''), style: { background: '#' + hex }, title, 'aria-label': title, onclick });
