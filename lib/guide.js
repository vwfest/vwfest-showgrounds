// In-world Info Booth content. docs/info.json (+ CHANGELOG.md) hold the words; every number is a {token} filled here from the server's LIVE config,
// so the guide cannot drift from the real prices, fees, odds and durations. test/guide.cjs enforces that.
const fs = require('fs'); const path = require('path');
const usd = (n) => '$' + (Number.isInteger(+n) ? String(+n) : (+n).toFixed(2));
const pct = (n) => `${+(+n).toFixed(2)}%`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function values({ mint, vendor, shop, R, voiceRange, maxPlayers }) {
  const prices = shop.map((i) => i.usd); const v = {
    maxPlayers: String(maxPlayers), voiceRange: String(voiceRange), feeUsd: usd(mint.feeUsd), rideUsd: usd(mint.rideUsd), entryUsd: usd(mint.entryUsd),
    discountPct: pct(mint.discountPct), devFeePct: pct(mint.devFeePct), burnPct: pct(100 - mint.devFeePct), avatarBurnPct: '100%',
    itemCount: String(shop.length), shopMin: usd(Math.min(...prices)), shopMax: usd(Math.max(...prices)),
    vendorFeeUsd: usd(vendor.feeUsd), vendorDays: plural(vendor.days, 'day'), boothCount: String(vendor.plots), maxProducts: String(vendor.maxProducts), imgKb: String(vendor.imgKb), reportsToHide: String(vendor.autoHide),
  };
  R.TIERS.forEach((t, i) => { v['odds.' + t] = pct(R.ODDS[i]); });
  return v;
}
const fill = (s, v, missing) => String(s).replace(/\{([A-Za-z0-9_.]+)\}/g, (m, k) => { if (!(k in v)) { missing && missing.push(k); return m; } return v[k]; });
function render(info, v, { R, games = [] } = {}) {
  const miss = []; const f = (s) => fill(s, v, miss);
  const sections = info.sections.map((s) => ({ id: s.id, icon: s.icon, title: f(s.title), blocks: s.blocks.map((b) => {
    if (b.p) return { p: f(b.p) }; if (b.ul) return { ul: b.ul.map(f) }; if (b.q) return { q: f(b.q), a: f(b.a) };
    if (b.odds) return { odds: R.TIERS.map((t, i) => [t, v['odds.' + t]]) }; if (b.games) return { games: games.map((g) => ({ name: g.name, icon: g.icon, url: g.url })) };
    return b; }) }));
  return { sections, missing: miss };
}
function changelog(md, v) {
  const out = []; let cur = null; for (const line of fill(md, v).split(/\r?\n/)) { const h = /^##\s+(.+)/.exec(line); if (h) { cur = { date: h[1].trim(), items: [] }; out.push(cur); } else if (cur && /^[-*]\s+/.test(line)) cur.items.push(line.replace(/^[-*]\s+/, '').trim()); }
  return out;
}
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function load() { return { info: JSON.parse(read('docs/info.json')), md: read('CHANGELOG.md') }; }
module.exports = { values, render, changelog, load, fill };
