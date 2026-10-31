// Side-view SVG of a ride (NFT image). No scripts/external refs. DIAMOND plates get sparkles.
const R = require('../shared/rides');
const c = (i) => '#' + R.COLORS[i];
function ridesvg(s) {
  const tc = R.TIER_COLORS[s.tier], base = s.paint === 5 ? '#' + R.PATINA[s.c1 % R.PATINA.length] : c(s.c1), two = s.c2 === 16 ? base : c(s.c2);
  const low = s.stance === 4 ? 24 : s.stance === 2 ? 20 : s.stance === 1 ? 10 : s.stance === 3 ? -14 : 0;
  const ground = 250, wr = 22, wy = ground - wr, by = wy - 10 + low * 0.0, lift = -low * 0 + (s.stance === 4 ? 6 : 0);
  const bodyBottom = wy - 4 + (s.stance === 3 ? -12 : s.stance >= 1 ? 8 : 0) ;
  const top = bodyBottom - (s.model === 1 ? 76 : s.model === 3 ? 56 : 62);
  const W = [[40, 280], [34, 286], [48, 272], [46, 274], [40, 280], [42, 278]][s.model];
  const glass = '#a9d6ff';
  let body = '';
  if (s.model === 1) body = `<rect x="${W[0]}" y="${top}" width="${W[1] - W[0]}" height="${bodyBottom - top}" rx="16" fill="${base}"/><rect x="${W[0]}" y="${bodyBottom - 26}" width="${W[1] - W[0]}" height="26" rx="8" fill="${two}"/>${[0, 1, 2, 3].map((i) => `<rect x="${W[0] + 12 + i * 52}" y="${top + 10}" width="44" height="22" rx="4" fill="${glass}"/>`).join('')}`;
  else if (s.model === 3) body = `<rect x="${W[0]}" y="${top + 8}" width="${W[1] - W[0]}" height="${bodyBottom - top - 8}" rx="6" fill="${base}"/><rect x="${W[0]}" y="${bodyBottom - 22}" width="${W[1] - W[0]}" height="22" fill="${two}"/><rect x="${W[0] + 60}" y="${top - 6}" width="5" height="22" fill="#222"/><rect x="${W[0] + 140}" y="${top - 6}" width="5" height="22" fill="#222"/>`;
  else if (s.model === 2) body = `<path d="M${W[0]} ${bodyBottom}q0-34 36-38l40-14q40-14 90 0l56 10q24 4 24 42z" fill="${base}"/><path d="M${W[0]} ${bodyBottom - 14}h${W[1] - W[0]}v14h-${W[1] - W[0]}z" fill="${two}"/><path d="M130 ${top + 22}l36-8q30 0 52 16h-88z" fill="${glass}"/>`;
  else if (s.model === 4) body = `<path d="M${W[0]} ${bodyBottom}q-4-44 30-52q30-26 140-16q40 6 52 30q20 6 26 38z" fill="${base}"/><path d="M${W[0]} ${bodyBottom - 14}h${W[1] - W[0]}v14h-${W[1] - W[0]}z" fill="${two}"/><path d="M90 ${top + 18}h120l16 22h-146z" fill="${glass}"/>`;
  else body = `<path d="M${W[0]} ${bodyBottom}q-6-46 54-52q40-30 120 0q56 8 62 52z" fill="${base}"/><path d="M${W[0]} ${bodyBottom - 14}h${W[1] - W[0]}v14h-${W[1] - W[0]}z" fill="${two}"/><path d="M118 ${top + 20}q22-18 70-4l6 18h-84z" fill="${glass}"/>`;
  if (s.model === 5) body += `<rect x="260" y="${bodyBottom - 36}" width="30" height="5" fill="#222"/><rect x="44" y="${bodyBottom - 4}" width="12" height="6" fill="#222"/>`;
  let extra = '';
  if (s.extras & R.bit(0)) extra += `<rect x="90" y="${top - 8}" width="130" height="5" fill="#222"/><rect x="100" y="${top - 5}" width="4" height="6" fill="#222"/><rect x="206" y="${top - 5}" width="4" height="6" fill="#222"/>`;
  if (s.extras & R.bit(1)) extra += `<rect x="86" y="${top - 18}" width="150" height="9" rx="4" fill="#ffd166"/>`;
  if (s.extras & R.bit(2)) extra += `<rect x="46" y="${bodyBottom - 30}" width="236" height="2.5" fill="#ffe27a"/><rect x="46" y="${bodyBottom - 24}" width="236" height="1.5" fill="#fff"/>`;
  if (s.extras & R.bit(3)) extra += `<path d="M120 ${bodyBottom - 20}q20-26 44-10t50-6l-8 18z" fill="#ff4fa3" opacity=".85"/><circle cx="150" cy="${bodyBottom - 20}" r="6" fill="#06d6a0"/>`;
  if (s.extras & R.bit(4)) extra += `<rect x="60" y="${top + 24}" width="30" height="5" fill="#fff" opacity=".8"/>`;
  if (s.extras & R.bit(5)) extra += `<circle cx="${W[1] - 10}" cy="${bodyBottom - 12}" r="6" fill="#fff6a0"/>`;
  if (s.extras & R.bit(6)) extra += `<rect x="${W[0] - 4}" y="${top + 6}" width="30" height="5" fill="#222"/>`;
  if (s.extras & R.bit(8)) extra += `<path d="M58 ${bodyBottom - 12}q30-22 56-8q-20-2-30 14zM110 ${bodyBottom - 10}q30-22 56-8q-20-2-30 14z" fill="#ffb703"/>`;
  const wheel = (cx) => {
    const w = s.wheels; const rim = w === 5 ? '#e5b83a' : w === 1 ? '#8d99ae' : '#dfe6ee';
    let sp = ''; if (w >= 4) for (let a = 0; a < 16; a++) { const r = a * Math.PI / 8; sp += `<line x1="${cx}" y1="${wy}" x2="${(cx + 13 * Math.cos(r)).toFixed(1)}" y2="${(wy + 13 * Math.sin(r)).toFixed(1)}" stroke="${rim}" stroke-width="1"/>`; }
    return `<circle cx="${cx}" cy="${wy}" r="${wr}" fill="#111"/>${w >= 4 ? `<circle cx="${cx}" cy="${wy}" r="${wr - 4}" fill="#f4f1ea"/><circle cx="${cx}" cy="${wy}" r="14" fill="#111"/>` : ''}<circle cx="${cx}" cy="${wy}" r="${w >= 4 ? 13 : 12}" fill="${rim}"/>${sp}<circle cx="${cx}" cy="${wy}" r="3" fill="#555"/>`;
  };
  const dia = s.plate === 2, plateFill = s.plate === 1 ? '#d9dee6' : dia ? '#eaf6ff' : '#f2efe4';
  const sparkle = dia ? [[262, 232], [292, 246], [250, 252], [284, 228]].map(([x, y]) => `<path d="M${x} ${y - 5}l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" fill="#7fe9ff"/>`).join('') : '';
  const bg = `<defs><radialGradient id="g" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="${tc}" stop-opacity=".55"/><stop offset="1" stop-color="#120a26"/></radialGradient></defs><rect width="320" height="320" fill="url(#g)"/><rect y="${ground}" width="320" height="70" fill="#1c2430"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">${bg}<text x="160" y="30" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="18" font-weight="900" fill="#fff">$VWFEST RIDES</text><text x="160" y="50" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" letter-spacing="4" fill="${tc}">${R.TIERS[s.tier].toUpperCase()}${s.stance === 4 ? ' · LOWRIDER' : ''}</text>${body}${extra}${wheel(92)}${wheel(236)}<rect x="146" y="${bodyBottom - 18}" width="44" height="16" rx="2" fill="${plateFill}" stroke="#333" stroke-width="1"/><text x="168" y="${bodyBottom - 6}" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="9" font-weight="900" fill="${dia ? '#00a6d6' : '#1d3557'}">VWFEST</text>${sparkle}<text x="160" y="300" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#cfd8e6">${R.MODELS[s.model]} · ${R.PAINTS[s.paint]} · #${String(s.serial).padStart(4, '0')}</text></svg>`;
}
const placeholder = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320"><rect width="320" height="320" fill="#120a26"/><text x="160" y="150" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="64" fill="#ffd166">?</text><text x="160" y="200" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#fff" letter-spacing="3">MYSTERY RIDE</text><text x="160" y="224" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#9fb0c8">reveals when the mint confirms</text></svg>`;
module.exports = { ridesvg, placeholder };
