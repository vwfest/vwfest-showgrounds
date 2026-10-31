// Nickname + chat text rules: profanity/leet aware, no links, no impersonation.
const BAD = ['fuck','shit','bitch','cunt','dick','cock','pussy','nigg','fag','whore','slut','rape','nazi','hitler','asshole','bastard','retard','penis','vagina','porn','kike','spic','chink','twat','wank','tits','boob','dildo','molest','pedo','kkk','isis','coon','tranny','wetback','gook','fuk','fck','fvck','phuck','jizz'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '+': 't' };
// Confusable folding for CHECKS only (the text we relay is untouched): NFKC, strip accents/combining marks, map common Cyrillic/Greek look-alikes to Latin, unify dot-like characters.
const CONF = {}; const addConf = (to, from) => { for (const ch of from) CONF[ch] = to; };
addConf('a', 'аɑαάа'); addConf('b', 'вβЬ'); addConf('c', 'сϲс'); addConf('d', 'ԁ'); addConf('e', 'еєεέ'); addConf('g', 'ɡ'); addConf('h', 'һнη'); addConf('i', 'іїιíıӏ|'); addConf('j', 'ј'); addConf('k', 'кκ'); addConf('l', 'ӏⅼ');
addConf('m', 'м'); addConf('n', 'ո'); addConf('o', 'оοόօ'); addConf('p', 'рρ'); addConf('q', 'ԛ'); addConf('s', 'ѕ'); addConf('t', 'тτ'); addConf('u', 'υսμ'); addConf('v', 'νѵ'); addConf('w', 'ԝω'); addConf('x', 'хχ'); addConf('y', 'уγү'); addConf('z', 'ᴢ');
const DOTS = /[\u3002\uff61\u2024\u2027\ufe52\uff0e\u00b7\u2022\u30fb\u0589\u06d4\u0701\u0702\u1803\u1809]/g;
const INVIS = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
const fold = (s) => String(s).normalize('NFKC').replace(INVIS, '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\x00-\x7f]/g, (ch) => CONF[ch] || ch).replace(DOTS, '.').replace(/\s+/g, ' ');
const flat = (s) => s.toLowerCase().replace(/[0134578@$!+]/g, (c) => LEET[c]).replace(/[^a-z]/g, '');
const squash = (s) => s.replace(/(.)\1+/g, '$1');
const BADS = BAD.map(squash);
function dirty(s) {
  const a = flat(fold(s)), b = squash(a);
  return BAD.some((w) => a.includes(w)) || BADS.some((w) => w.length >= 4 && b.includes(w));
}
const RESERVED = /^(admin|administrator|mod|moderator|staff|support|system|server|vwfest|vw fest|vwfestlive|bot|null|undefined|guest|you|everyone|all|dev|team|showgrounds|show grounds|host|official)$/i;
// Impersonation guard: compare the SEPARATOR-FREE key so "VW-FEST", "vw_fest", "Admin 2", "Staff_1" and "Official1" cannot slip past the exact-word list above.
const RES_PREFIX = /^(admin|moderator|vwfest|vwfestlive|showgrounds|official|support)/;                                  // anything that STARTS with these is refused
const RES_EXACT = /^(mod|staff|system|server|host|team|dev|developer|bot|guest|null|undefined|you|everyone|all|owner|ceo|elon|elonmusk|musk|djadmin)\d*$/; // these words (+ optional digits) are refused
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,12}[A-Za-z0-9]$/.test(n)) return null;
  if (RESERVED.test(n) || dirty(n) || linky(n)) return null;
  const k = nickKey(n).replace(/[^a-z0-9]/g, ''); if (RES_PREFIX.test(k) || RES_EXACT.test(k)) return null;
  return n;
}
const nickKey = (n) => n.toLowerCase().replace(/[ _-]+/g, '');
// Chat: strip control/zero-width/bidi chars, collapse spaces, block links & contract-looking strings, mask profanity.
const LINK = /(https?:|www\.|\bt\.me|discord\.gg|\bdiscord\s*(\.|dot|\(dot\)|\[dot\])?\s*(gg|com|app)\b|\bdsc\s*\.?\s*gg\b|\bdiscord\s+(invite|server)\b|\b[a-z0-9-]{2,}\s?(\.|\(dot\)|\[dot\])\s?(com|net|org|io|xyz|gg|ly|app|me|co|fun|gift|info|site|online|tk|ml|cc|to|sh)\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b)/i;
const linky = (t) => { const f = fold(t); return LINK.test(f) || LINK.test(f.replace(/[\s_*'"`~|]+/g, '')) || SPOKEN_DOT.test(f) || SPOKEN_DOT.test(f.replace(/[_*'"`~|]+/g, ' ')); };
const SPOKEN_DOT = /\b[a-z0-9-]{2,}\s+dot\s+(com|net|org|io|xyz|gg|ly|app|me|co|fun|gift|info|site|online|tk|ml|cc|to|sh)\b/i; // "evil dot com"
function cleanChat(raw) {
  if (typeof raw !== 'string') return { ok: false, why: 'bad' };
  let t = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, why: 'empty' };
  if (t.length > 140) t = t.slice(0, 140);
  if (linky(t)) return { ok: false, why: 'Links and addresses are blocked in chat' };
  if (dirty(t)) return { ok: false, why: 'Keep it friendly, please' };
  return { ok: true, text: t };
}
// Free text for vendor booths (names, descriptions, captions): same bad-word rules, no links/addresses (the one external link has its own field).
function cleanText(raw, max, { multiline = false } = {}) {
  if (typeof raw !== 'string') return null;
  let t = raw.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
  t = multiline ? t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : t.replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max).trim(); if (linky(t) || dirty(t)) return null; return t;
}
module.exports = { cleanName, cleanChat, cleanText, dirty, nickKey, fold, linky };
