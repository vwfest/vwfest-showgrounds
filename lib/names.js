// Nickname + chat text rules: profanity/leet aware, no links, no impersonation.
const BAD = ['fuck','shit','bitch','cunt','dick','cock','pussy','nigg','fag','whore','slut','rape','nazi','hitler','asshole','bastard','retard','penis','vagina','porn','kike','spic','chink','twat','wank','tits','boob','dildo','molest','pedo','kkk','isis','coon','tranny','wetback','gook','fuk','fck','fvck','phuck','jizz'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '+': 't' };
const flat = (s) => s.toLowerCase().replace(/[0134578@$!+]/g, (c) => LEET[c]).replace(/[^a-z]/g, '');
const squash = (s) => s.replace(/(.)\1+/g, '$1');
const BADS = BAD.map(squash);
function dirty(s) {
  const a = flat(s), b = squash(a);
  return BAD.some((w) => a.includes(w)) || BADS.some((w) => w.length >= 4 && b.includes(w));
}
const RESERVED = /^(admin|administrator|mod|moderator|staff|support|system|server|vwfest|vw fest|vwfestlive|bot|null|undefined|guest|you|everyone|all|dev|team|showgrounds|show grounds|host|official)$/i;
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,12}[A-Za-z0-9]$/.test(n)) return null;
  if (RESERVED.test(n) || dirty(n)) return null;
  return n;
}
const nickKey = (n) => n.toLowerCase().replace(/[ _-]+/g, '');
// Chat: strip control/zero-width/bidi chars, collapse spaces, block links & contract-looking strings, mask profanity.
const LINK = /(https?:|www\.|\bt\.me|discord\.gg|\b[a-z0-9-]{2,}\s?(\.|\(dot\)|\[dot\])\s?(com|net|org|io|xyz|gg|ly|app|me|co|fun|gift|info|site|online|tk|ml|cc|to|sh)\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b)/i;
function cleanChat(raw) {
  if (typeof raw !== 'string') return { ok: false, why: 'bad' };
  let t = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, why: 'empty' };
  if (t.length > 140) t = t.slice(0, 140);
  if (LINK.test(t)) return { ok: false, why: 'Links and addresses are blocked in chat' };
  if (dirty(t)) return { ok: false, why: 'Keep it friendly, please' };
  return { ok: true, text: t };
}
// Free text for vendor booths (names, descriptions, captions): same bad-word rules, no links/addresses (the one external link has its own field).
function cleanText(raw, max, { multiline = false } = {}) {
  if (typeof raw !== 'string') return null;
  let t = raw.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '');
  t = multiline ? t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : t.replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max).trim(); if (LINK.test(t) || dirty(t)) return null; return t;
}
module.exports = { cleanName, cleanChat, cleanText, dirty, nickKey };
