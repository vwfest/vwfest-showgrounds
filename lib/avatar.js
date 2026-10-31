// Avatar traits on the server: deterministic signature look per profile, 15-byte fingerprint (also the NFT code), SVG portrait.
const crypto = require('crypto');
const T = require('../shared/traits');
const { PAL, FIELDS, MAX, NAMES } = T;
const cleanAvatar = T.clean;
const CODE_LEN = Math.ceil(FIELDS.length * 4 / 3);
const pack = (a) => Buffer.from(FIELDS.map((k) => a[k])).toString('base64url');           // one byte per trait
function unpack(code) {
  if (typeof code !== 'string' || code.length !== CODE_LEN || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  const b = Buffer.from(code, 'base64url'); if (b.length !== FIELDS.length) return null;
  const o = {}; FIELDS.forEach((k, i) => { o[k] = b[i]; }); const c = cleanAvatar(o);
  return FIELDS.every((k) => c[k] === o[k]) ? c : null;
}
// Signature avatar: hash(profileId) picks every trait; if the exact combination is already in use, re-hash with a counter.
const WEIGHT = { hat: [3, 2, 2, 1, 2, 1, 2, 1], glasses: [4, 2, 1, 2], acc: [4, 2, 1, 1, 1, 2], outfit: [4, 2, 2, 2, 2], stripe: [3, 2, 2, 1, 1], carColor2: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 6], hairStyle: [2, 2, 1, 1, 1, 1, 1, 1] };
function pick(k, r) { // r: uint16
  const w = WEIGHT[k]; if (!w) return r % MAX[k];
  const tot = w.reduce((s, x) => s + x, 0); let x = r % tot; for (let i = 0; i < w.length; i++) { if (x < w[i]) return i; x -= w[i]; } return 0;
}
// Personality nudges the outfit vibe (what the hash rolls from), never the quiz answers themselves.
const VIBE_BIAS = {
  1: { outfit: [1, 1], acc: [2, 2], hat: [1, 6], pattern: [0, 0] },            // Wrench Head: overalls, wrench, cap/bandana
  2: { outfit: [2, 2], glasses: [3, 3], pattern: [0, 3], hat: [7, 5] },          // Party Animal: hawaiian, shades
  3: { pattern: [2, 2], acc: [1, 1], glasses: [2, 2], hat: [5, 6], outfit: [0, 0] }, // Hippie Soul: peace print, necklace, round specs, flower
  4: { stripe: [1, 3], glasses: [3, 1], outfit: [3, 3], acc: [4, 5] },          // Speed Demon
  5: { outfit: [4, 4], hat: [0, 2], glasses: [0, 0], acc: [5, 5], pattern: [0, 0] }, // Show Pro: vest, VW badge
  6: { hat: [4, 3], acc: [3, 3], shirt: [5, 8], outfit: [3, 0] },               // Mystic
  7: { hat: [2, 7], glasses: [3, 3], outfit: [2, 0], acc: [0, 0] },             // Surf Rat
  8: { hat: [1, 7], glasses: [1, 1], acc: [5, 3] },                              // Road Tripper
  9: { outfit: [4, 4], hat: [2, 1], acc: [2, 5] },                                // Swap Meet Hustler
  0: { hat: [7, 2], glasses: [1, 3] },                                              // Chill Cruiser
};
function cleanQuiz(q) {
  const o = {}; for (const k of T.QUIZ) { const v = q && typeof q === 'object' ? q[k] : undefined; o[k] = Number.isInteger(v) && v >= 0 && v < MAX[k] ? v : T.DEFAULT[k]; } return o;
}
function generate(profileId, isTaken = () => false, quiz = null) {
  const qz = quiz ? cleanQuiz(quiz) : null;
  for (let n = 0; n < 500; n++) {
    const h = crypto.createHash('sha256').update(`vwfest-showgrounds:v2:${profileId}:${n}`).digest();
    const a = {}; FIELDS.forEach((k, i) => { a[k] = pick(k, h.readUInt16LE((i * 2) % 30) ^ (i >= 15 ? h[30 + (i % 2)] << 8 : 0)); });
    if (qz) {
      Object.assign(a, qz);
      const bias = VIBE_BIAS[qz.vibe] || {}; // 75% of the time, take the personality's preferred item for that slot
      Object.keys(bias).forEach((k, j) => { if (h[16 + j] < 192) a[k] = bias[k][h[24 + j] & 1]; });
      if (qz.age >= 2 && a.hairStyle !== 6 && h[28] < 170) a.hair = [7, 7, 5, 0][h[29] & 3];     // seasoned/elder: silver streaks
      if (qz.sex !== 0 && a.facial) a.facial = qz.facial;                                          // facial hair is always the player's own choice
    }
    if (a.carColor2 === a.carColor) a.carColor2 = 16;
    if (!isTaken(pack(a))) return a;
  }
  throw new Error('no free avatar');
}
const col = (k, i) => '#' + PAL[k][i];
function attrs(a) {
  const t = (trait_type, value) => ({ trait_type, value });
  return FIELDS.map((k) => t(T.LABEL[k], NAMES[k][a[k]])).concat([t('Favorite VW', NAMES.car[a.car]), t('Paint Hex', col('car', a.carColor))]);
}
// Standalone SVG portrait (also the NFT image): no scripts, no external refs.
function svg(a) {
  const skin = col('skin', a.skin), hair = col('hair', a.hair), shirt = col('shirt', a.shirt), pants = col('pants', a.pants), car = col('car', a.carColor), car2 = a.carColor2 === 16 ? car : col('car', a.carColor2);
  const bw = [50, 58, 68][a.body];
  let outfit = '';
  const bx = 160 - bw / 2;
  if (a.outfit === 1) outfit = `<rect x="${bx + 6}" y="190" width="${bw - 12}" height="46" fill="#2f5d9a"/><rect x="${bx + 8}" y="172" width="6" height="22" fill="#2f5d9a"/><rect x="${bx + bw - 14}" y="172" width="6" height="22" fill="#2f5d9a"/><circle cx="${bx + 11}" cy="196" r="3" fill="#ffd166"/><circle cx="${bx + bw - 11}" cy="196" r="3" fill="#ffd166"/>`;
  else if (a.outfit === 2) outfit = `<g fill="#ffd166"><circle cx="${bx + 12}" cy="190" r="4"/><circle cx="${bx + 30}" cy="205" r="4"/><circle cx="${bx + bw - 14}" cy="188" r="4"/><circle cx="${bx + bw - 24}" cy="214" r="4"/></g><path d="M160 168l-8 14 8 6 8-6z" fill="#fff"/>`;
  else if (a.outfit === 3) outfit = `<rect x="${bx}" y="170" width="${bw}" height="66" rx="12" fill="#3f6fa8"/><path d="M160 170v66" stroke="#274b78" stroke-width="3"/><rect x="${bx + 8}" y="196" width="12" height="10" fill="#274b78"/>`;
  else if (a.outfit === 4) outfit = `<path d="M${bx} 170h${bw / 2 - 6}l-6 66h-${bw / 2 - 6}zM${bx + bw} 170h-${bw / 2 - 6}l6 66h${bw / 2 - 6}z" fill="#8a5a2b"/>`;
  let pat = '';
  if (a.pattern === 1) pat = [180, 192, 204, 216, 228].map((y) => `<rect x="${bx}" y="${y}" width="${bw}" height="4" fill="#fff" opacity=".55"/>`).join('');
  else if (a.pattern === 2) pat = `<circle cx="160" cy="204" r="12" fill="none" stroke="#fff" stroke-width="3"/><path d="M160 192v24M160 204l-9 9M160 204l9 9" stroke="#fff" stroke-width="3"/>`;
  else if (a.pattern === 3) pat = `<ellipse cx="160" cy="206" rx="13" ry="9" fill="#fff" opacity=".85"/><circle cx="160" cy="196" r="5" fill="#fff" opacity=".85"/>`;
  const hs = a.hairStyle;
  const hairSvg = [
    `<path d="M120 124a40 40 0 0 1 80 0v8h-80z" fill="${hair}"/>`,
    `<path d="M114 140a46 46 0 0 1 92 0l8 56h-18v-52h-72v52h-18z" fill="${hair}"/>`,
    `<circle cx="160" cy="84" r="16" fill="${hair}"/><path d="M120 124a40 40 0 0 1 80 0v8h-80z" fill="${hair}"/>`,
    `<path d="M152 78h16l4 50h-24z" fill="${hair}"/>`,
    `<circle cx="160" cy="112" r="52" fill="${hair}"/>`,
    `<path d="M120 124a40 40 0 0 1 80 0v8h-80z" fill="${hair}"/><path d="M196 110q30 10 18 60q-14-30-30-40z" fill="${hair}"/>`,
    '',
    `<g fill="${hair}"><circle cx="132" cy="106" r="16"/><circle cx="150" cy="92" r="17"/><circle cx="172" cy="92" r="17"/><circle cx="190" cy="106" r="16"/></g>`,
  ][hs];
  let hat = '';
  const hc = shirt;
  if (a.hat === 1) hat = `<path d="M118 118a42 38 0 0 1 84 0z" fill="${hc}"/><rect x="156" y="108" width="52" height="9" rx="4" fill="${hc}"/>`;
  else if (a.hat === 2) hat = `<path d="M122 118l6-30h64l6 30z" fill="#e9dcc3"/><rect x="108" y="114" width="104" height="8" rx="4" fill="#e9dcc3"/>`;
  else if (a.hat === 3) hat = `<path d="M126 116q-4-34 34-30q38-4 34 30z" fill="#7a4b22"/><path d="M96 118q64 20 128 0q-6 12-64 12t-64-12z" fill="#7a4b22"/>`;
  else if (a.hat === 4) hat = `<path d="M118 122a42 42 0 0 1 84 0z" fill="${pants}"/><circle cx="160" cy="80" r="7" fill="#fff"/>`;
  else if (a.hat === 5) hat = `<circle cx="198" cy="108" r="9" fill="#ff4fa3"/><circle cx="198" cy="108" r="4" fill="#ffd166"/>`;
  else if (a.hat === 6) hat = `<path d="M118 118a42 38 0 0 1 84 0z" fill="#c1121f"/><path d="M118 118h84v7h-84z" fill="#c1121f"/><g fill="#fff"><circle cx="134" cy="106" r="2.5"/><circle cx="160" cy="94" r="2.5"/><circle cx="186" cy="106" r="2.5"/></g>`;
  else if (a.hat === 7) hat = `<path d="M124 116q4-26 36-26t36 26z" fill="#d9b44a"/><ellipse cx="160" cy="118" rx="58" ry="9" fill="#d9b44a"/>`;
  let gl = '';
  if (a.glasses === 1) gl = `<path d="M134 124h24v12q-12 8-24 0zM162 124h24v12q-12 8-24 0z" fill="#222" opacity=".9"/><path d="M158 126h4" stroke="#caa" stroke-width="2"/>`;
  else if (a.glasses === 2) gl = `<circle cx="146" cy="130" r="9" fill="none" stroke="#333" stroke-width="3"/><circle cx="174" cy="130" r="9" fill="none" stroke="#333" stroke-width="3"/><path d="M155 130h10" stroke="#333" stroke-width="3"/>`;
  else if (a.glasses === 3) gl = `<rect x="132" y="124" width="56" height="14" rx="5" fill="#111"/>`;
  let acc = '';
  if (a.acc === 1) acc = `<path d="M146 168q14 22 28 0" stroke="#ddd" stroke-width="2" fill="none"/><circle cx="160" cy="194" r="8" fill="none" stroke="#fff" stroke-width="2.5"/><path d="M160 186v16M160 194l-5 6M160 194l5 6" stroke="#fff" stroke-width="2.5"/>`;
  else if (a.acc === 2) acc = `<rect x="${bx + bw + 4}" y="190" width="6" height="42" rx="3" fill="#b0b7c3"/><circle cx="${bx + bw + 7}" cy="188" r="8" fill="none" stroke="#b0b7c3" stroke-width="5"/>`;
  else if (a.acc === 3) acc = `<rect x="140" y="160" width="40" height="12" rx="6" fill="#e63946"/><rect x="170" y="168" width="10" height="26" rx="4" fill="#e63946"/>`;
  else if (a.acc === 4) acc = `<path d="M118 126a42 42 0 0 1 84 0" stroke="#222" stroke-width="6" fill="none"/><rect x="110" y="122" width="14" height="22" rx="6" fill="#222"/><rect x="196" y="122" width="14" height="22" rx="6" fill="#222"/>`;
  else if (a.acc === 5) acc = `<circle cx="${bx + 14}" cy="188" r="9" fill="#1d8fe1"/><text x="${bx + 14}" y="192" text-anchor="middle" font-size="10" font-family="Arial" font-weight="900" fill="#fff">VW</text>`;
  const sexSvg = a.sex === 1 ? '<path d="M142 122l-6-3M178 122l6-3" stroke="#111" stroke-width="2"/><path d="M152 146q8 6 16 0" stroke="#d6336c" stroke-width="3" fill="none"/>' : '';
  const freck = a.freckles ? '<g fill="#a0522d" opacity=".7"><circle cx="142" cy="138" r="1.6"/><circle cx="148" cy="141" r="1.6"/><circle cx="172" cy="141" r="1.6"/><circle cx="178" cy="138" r="1.6"/><circle cx="160" cy="136" r="1.4"/></g>' : '';
  const age = a.age === 2 ? '<path d="M138 120q4-2 8 0M174 120q4-2 8 0" stroke="#0004" fill="none"/>' : a.age === 3 ? '<path d="M138 120q4-2 8 0M174 120q4-2 8 0M142 148q-4 6-2 12M178 148q4 6 2 12" stroke="#0005" fill="none"/>' : '';
  const hf = col('hair', a.hair);
  const facial = [ '', '<path d="M138 144q22 26 44 0q-6 18-22 20t-22-20z" fill="#0003"/>', `<path d="M148 142q12-6 24 0q-12 4-24 0z" fill="${hf}"/>`, `<path d="M148 142q12-6 24 0q-12 4-24 0z" fill="${hf}"/><path d="M154 152q6 14 12 0z" fill="${hf}"/>`, `<path d="M128 132q2 36 32 38q30-2 32-38q-8 20-32 20t-32-20z" fill="${hf}"/>`, `<path d="M126 124q-4 30 12 40l8-18zM194 124q4 30-12 40l-8-18z" fill="${hf}"/><path d="M148 142q12-6 24 0q-12 4-24 0z" fill="${hf}"/>` ][a.facial];
  const stripe = a.stripe === 1 ? `<rect x="130" y="${a.car === 1 ? 214 : 204}" width="60" height="6" fill="#fff" opacity=".8"/>` : a.stripe === 2 ? `<rect x="40" y="244" width="240" height="7" fill="#fff" opacity=".85"/>` : a.stripe === 3 ? `<path d="M50 252q30-18 56-6q-20-2-30 14zM100 254q30-18 56-6q-20-2-30 14z" fill="#ffb703"/>` : a.stripe === 4 ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${44 + i * 30}" y="246" width="15" height="6" fill="#111"/><rect x="${59 + i * 30}" y="252" width="15" height="6" fill="#111"/>`).join('') : '';
  const body = a.car === 1 ? `<rect x="40" y="206" width="240" height="58" rx="16" fill="${car}"/><rect x="40" y="238" width="240" height="26" rx="10" fill="${car2}"/><rect x="56" y="214" width="46" height="20" rx="4" fill="#9ad1ff"/><rect x="108" y="214" width="46" height="20" rx="4" fill="#9ad1ff"/><rect x="160" y="214" width="46" height="20" rx="4" fill="#9ad1ff"/><rect x="212" y="214" width="56" height="20" rx="4" fill="#9ad1ff"/>`
    : a.car === 3 ? `<rect x="50" y="214" width="220" height="44" rx="6" fill="${car}"/><rect x="50" y="240" width="220" height="18" fill="${car2}"/><rect x="62" y="196" width="6" height="22" fill="#222"/><rect x="170" y="196" width="6" height="22" fill="#222"/><rect x="62" y="194" width="114" height="5" fill="#222"/>`
    : a.car === 2 ? `<path d="M36 258q0-32 40-38l50-16q40-6 80 16l50 8q16 4 16 30z" fill="${car}"/><path d="M36 244h260v14H36z" fill="${car2}"/><path d="M130 208l40-4q22 4 40 18h-80z" fill="#9ad1ff"/>`
    : `<path d="M44 258q-6-52 52-58q40-30 120 0q56 8 62 58z" fill="${car}"/><path d="M44 244h234v14H44z" fill="${car2}"/><path d="M118 214q22-18 70-4l6 18h-84z" fill="#9ad1ff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a3d"/><stop offset=".55" stop-color="#7b2cbf"/><stop offset="1" stop-color="#1a1033"/></linearGradient></defs><rect width="320" height="320" fill="url(#s)"/><circle cx="160" cy="210" r="64" fill="#ffd166" opacity=".35"/><rect y="262" width="320" height="58" fill="#27343a"/>${body}${stripe}<circle cx="90" cy="262" r="16" fill="#111"/><circle cx="90" cy="262" r="7" fill="#ccc"/><circle cx="230" cy="262" r="16" fill="#111"/><circle cx="230" cy="262" r="7" fill="#ccc"/><rect x="${bx}" y="170" width="${bw}" height="64" rx="12" fill="${shirt}"/>${pat}${outfit}<rect x="${160 - bw / 2 + 6}" y="228" width="${bw / 2 - 8}" height="30" fill="${pants}"/><rect x="${160 + 2}" y="228" width="${bw / 2 - 8}" height="30" fill="${pants}"/><circle cx="160" cy="128" r="34" fill="${skin}"/>${hairSvg}<circle cx="148" cy="128" r="5" fill="#fff"/><circle cx="172" cy="128" r="5" fill="#fff"/><circle cx="148" cy="128" r="3.2" fill="${col('eyes', a.eyes)}"/><circle cx="172" cy="128" r="3.2" fill="${col('eyes', a.eyes)}"/><circle cx="148" cy="128" r="1.4" fill="#111"/><circle cx="172" cy="128" r="1.4" fill="#111"/>${sexSvg}${freck}${age}<path d="M148 146q12 10 24 0" stroke="#111" stroke-width="3" fill="none" stroke-linecap="round"/>${facial}${gl}${hat}${acc}<text x="160" y="26" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="20" font-weight="900" fill="#fff">$VWFEST</text><text x="160" y="46" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#ffd166" letter-spacing="3">SHOW GROUNDS AVATAR</text></svg>`;
}
module.exports = { ...T, cleanAvatar, cleanQuiz, pack, unpack, generate, svg, attrs, col, CODE_LEN };
