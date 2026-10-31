// Outfit Shop catalog. Cosmetic only (never part of the unique avatar fingerprint). Prices are USD, adjustable by env:
//   SHOP_PRICE_MULT=1.5          multiply every price
//   SHOP_PRICES='{"halo":9}'     per-item override (USD)
const ITEMS = [
  { id: 'gold_bucket', slot: 'hat', name: 'Gold Bucket Hat', emoji: '🪣', usd: 4, desc: 'Shiny gold bucket hat for the swap-meet king.' },
  { id: 'rainbow_beanie', slot: 'hat', name: 'Rainbow Beanie', emoji: '🌈', usd: 3, desc: 'Striped knit beanie with a pom-pom.' },
  { id: 'top_hat', slot: 'hat', name: 'Concours Top Hat', emoji: '🎩', usd: 5, desc: 'For the judge of the best-in-show lineup.' },
  { id: 'halo', slot: 'hat', name: 'Golden Halo', emoji: '😇', usd: 6, desc: 'A floating glowing halo.' },
  { id: 'neon_shades', slot: 'face', name: 'Neon Shades', emoji: '😎', usd: 3, desc: 'Glowing synthwave visor shades.' },
  { id: 'heart_specs', slot: 'face', name: 'Heart Specs', emoji: '💖', usd: 2, desc: 'Pink heart-shaped party glasses.' },
  { id: 'surfboard', slot: 'back', name: 'Roof-Rack Surfboard', emoji: '🏄', usd: 4, desc: 'A surfboard strapped to your back (or your roof).' },
  { id: 'vw_wings', slot: 'back', name: 'Air-Cooled Wings', emoji: '🪽', usd: 8, desc: 'Big chrome-and-orange wings.' },
  { id: 'flame_aura', slot: 'aura', name: 'Flame Aura', emoji: '🔥', usd: 6, desc: 'Fire swirling around your feet.' },
  { id: 'peace_aura', slot: 'aura', name: 'Peace Aura', emoji: '☮️', usd: 5, desc: 'A spinning rainbow peace ring.' },
  { id: 'neon_underglow', slot: 'glow', name: 'Neon Underglow', emoji: '💜', usd: 5, desc: 'Glowing underbody light under you and your VW.' },
];
const SLOTS = ['hat', 'face', 'back', 'aura', 'glow'];
function catalog(env = process.env) {
  let over = {}; try { over = JSON.parse(env.SHOP_PRICES || '{}') || {}; } catch {}
  const mult = Number.isFinite(+env.SHOP_PRICE_MULT) && +env.SHOP_PRICE_MULT > 0 ? +env.SHOP_PRICE_MULT : 1;
  return ITEMS.map((i) => { const u = Number.isFinite(+over[i.id]) && +over[i.id] > 0 ? +over[i.id] : i.usd * mult; return { ...i, usd: Math.round(u * 100) / 100 }; });
}
module.exports = { catalog, SLOTS, ITEMS };
