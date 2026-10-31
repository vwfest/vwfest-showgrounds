// VW Fest Show Grounds Rides: trait tables, published odds and the pure roll function (no Node/browser APIs).
// roll(bytes): bytes = 64 random bytes derived from HMAC-SHA256(seed, "0"|"1"). Same bytes -> same ride, anywhere.
const MODELS = ['Beetle', 'Bus', 'Karmann Ghia', 'Thing', 'Squareback', 'Baja Bug'];
const PAINTS = ['Solid', 'Metallic', 'Candy', 'Flake', 'Two-tone', 'Patina'];
const COLORS = ['e63946', 'f4a261', 'ffd166', '06d6a0', '118ab2', '9b5de5', 'f15bb5', 'f8f9fa', 'fb8500', '2a9d8f', '80ed99', '3a0ca3', '1d3557', 'a8dadc', 'bc4749', '212529'];
const COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Mint', 'Ocean', 'Purple', 'Pink', 'White', 'Tangerine', 'Teal', 'Lime', 'Indigo', 'Navy', 'Sky', 'Brick', 'Black'];
const CANDY = [0, 5, 6, 8, 4, 9]; // bright, saturated candy-friendly colors
const PATINA = ['8a7f5c', '7d6b52', '6b8f7a', '9a6b4f', '8f8f86'];
const WHEELS = ['Stock hubcaps', 'Steelies', 'Fuchs-style', 'Chrome slotted', 'Wire spoke whitewall', 'Gold wire spoke'];
const STANCES = ['Stock', 'Lowered', 'Slammed', 'Lifted', 'Lowrider'];
const EXTRAS = ['Roof rack', 'Surfboard', 'Pinstripes', 'Mural', 'Hood stripes', 'Fog lights', 'Spoiler', 'Chrome trim', 'Flame decals'];
const PLATES = ['Standard', 'Chrome', 'DIAMOND'];
const TIERS = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const ODDS = [55, 25, 12, 6, 2]; // percent, published
const TIER_COLORS = ['#b8c0cc', '#4ea8ff', '#b46bff', '#ffb703', '#ff3d8b'];
const bit = (i) => 1 << i;
function roll(b) {
  let o = 0; const u8 = () => b[o++ % b.length]; const pickOf = (arr) => arr[u8() % arr.length]; const chance = (p) => u8() / 256 < p;
  const r = ((b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0) / 4294967296 * 100; o = 4;
  let acc = 0, tier = 0; for (let i = 0; i < ODDS.length; i++) { acc += ODDS[i]; if (r < acc) { tier = i; break; } tier = i; }
  const s = { serial: 0, tier, model: 0, paint: 0, c1: 0, c2: 16, wheels: 0, stance: 0, plate: 0, extras: 0 };
  const addExtras = (n, pool) => { const p = pool.slice(); for (let i = 0; i < n && p.length; i++) { const k = u8() % p.length; s.extras |= bit(p.splice(k, 1)[0]); } };
  const col = () => u8() % 16;
  if (tier === 0) { s.model = pickOf([0, 0, 1, 2, 3]); s.paint = pickOf([0, 0, 0, 5]); s.c1 = col(); s.wheels = pickOf([0, 0, 1]); s.stance = pickOf([0, 0, 1]); addExtras(u8() % 2, [0, 5]); }
  else if (tier === 1) { s.model = u8() % 6; s.paint = pickOf([0, 1, 4]); s.c1 = col(); s.c2 = s.paint === 4 ? col() : 16; s.wheels = pickOf([1, 2, 3]); s.stance = s.model === 5 ? 3 : pickOf([0, 1, 1]); s.plate = chance(0.3) ? 1 : 0; addExtras(1 + (u8() % 2), [0, 1, 4, 5, 6, 7]); }
  else if (tier === 2) { s.model = u8() % 6; s.paint = pickOf([1, 2, 3, 4]); s.c1 = col(); s.c2 = s.paint === 4 ? col() : 16; s.wheels = pickOf([2, 3, 4]); s.stance = s.model === 5 ? 3 : pickOf([1, 2, 2]); s.plate = chance(0.3) ? 2 : 1; addExtras(2 + (u8() % 2), [0, 1, 2, 4, 5, 6, 7, 8]); }
  else if (tier === 3) { s.model = u8() % 6; s.paint = pickOf([2, 3, 3]); s.c1 = pickOf(CANDY); s.c2 = chance(0.5) ? col() : 16; s.wheels = pickOf([2, 4, 5]); s.stance = s.model === 5 ? 3 : 2; s.plate = chance(0.7) ? 2 : 1; s.extras = bit(2); addExtras(2 + (u8() % 2), [0, 1, 3, 4, 5, 6, 7, 8]); }
  else { s.model = pickOf([0, 0, 1, 2, 4]); s.paint = 2; s.c1 = pickOf(CANDY); s.c2 = col(); s.wheels = pickOf([4, 5]); s.stance = 4; s.plate = 2; s.extras = bit(2) | bit(3) | bit(7); if (chance(0.5)) s.extras |= bit(8); if (chance(0.4)) s.extras |= bit(5); }
  if (s.c2 === s.c1 && s.c2 !== 16) s.c2 = 16;
  s.serial = ((u8() << 8) | u8()) % 10000; // build number: makes every ride unique even inside the small Common trait space
  return s;
}
const FIELDS = ['tier', 'model', 'paint', 'c1', 'c2', 'wheels', 'stance', 'plate'];
const code = (s) => Buffer_from([...FIELDS.map((k) => s[k]), s.extras & 255, (s.extras >> 8) & 255, s.serial & 255, (s.serial >> 8) & 255]);
function Buffer_from(a) { return typeof Buffer !== 'undefined' ? Buffer.from(a) : Uint8Array.from(a); }
function describe(s) {
  const ex = EXTRAS.filter((_, i) => s.extras & bit(i));
  return { build: '#' + String(s.serial).padStart(4, '0'), tier: TIERS[s.tier], model: MODELS[s.model], paint: PAINTS[s.paint], color: COLOR_NAMES[s.c1], second: s.c2 === 16 ? 'None' : COLOR_NAMES[s.c2], wheels: WHEELS[s.wheels], stance: STANCES[s.stance], plate: PLATES[s.plate], extras: ex, lowrider: s.stance === 4 };
}
module.exports = { MODELS, PAINTS, COLORS, COLOR_NAMES, CANDY, PATINA, WHEELS, STANCES, EXTRAS, PLATES, TIERS, ODDS, TIER_COLORS, FIELDS, roll, code, describe, bit };
