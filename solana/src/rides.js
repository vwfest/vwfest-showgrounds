'use strict';
// Mystery Ride randomness: commit-reveal + published odds.
//   1. Quote time: serverSeed = HMAC(SERVER_SECRET, "ride:" + quoteId); the server publishes commit = SHA256(serverSeed). The commit is
//      also written into the payment tx memo, so it is on-chain BEFORE the roll. SERVER_SECRET must be persistent (env), never random per boot.
//   2. Player signs the payment tx. Its signature does not exist until the player signs, so the server cannot steer it.
//   3. Roll: final = SHA256(serverSeed ":" paymentSignature); bytes = HMAC(final,"0") || HMAC(final,"1"); spec = roll(bytes).
//   4. serverSeed is revealed in the NFT metadata, so anyone can recheck commit + roll with verifyRide().
// Re-roll only happens if the exact trait set already exists (counter in the seed, still deterministic and published).
const crypto = require('crypto');

const TIERS = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const ODDS = [55, 25, 12, 6, 2]; // percent, published
const MODELS = ['Beetle', 'Bus', 'Karmann Ghia', 'Thing', 'Squareback', 'Baja Bug'];
const LOWRIDERS = ['Lowrider Beetle', 'Lowrider Bus', 'Lowrider Karmann Ghia', 'Lowrider Squareback'];
// MODELS/LOWRIDERS above are LEGACY INTERNAL ids: they feed specCode() (sha256 of the spec) and verifyRide(), so they must never change.
// Only the user-facing name is mapped (trademark-safe display names).
const DISPLAY = { Beetle: 'Bug', Bus: 'Camper', 'Karmann Ghia': 'Ghia Coupe', Thing: 'Safari', Squareback: 'Wagon', 'Baja Bug': 'Baja Bug' };
const displayModel = (m) => { const s = String(m); if (s.startsWith('Lowrider ')) return 'Lowrider ' + (DISPLAY[s.slice(9)] || s.slice(9)); return DISPLAY[s] || s; };
const COLORS = ['Red', 'Orange', 'Yellow', 'Mint', 'Ocean', 'Purple', 'Pink', 'White', 'Tangerine', 'Teal', 'Lime', 'Indigo', 'Navy', 'Sky', 'Brick', 'Black'];
const CANDY = ['Candy Apple Red', 'Candy Purple', 'Candy Pink', 'Candy Tangerine', 'Candy Ocean', 'Candy Lime'];
const PAINTS_BY_TIER = [['Solid', 'Solid', 'Patina'], ['Solid', 'Metallic', 'Two-tone'], ['Metallic', 'Candy', 'Flake', 'Two-tone'], ['Candy', 'Flake', 'Flake'], ['Candy']];
const WHEELS_BY_TIER = [['Stock hubcaps', 'Steelies'], ['Steelies', 'Fuchs-style', 'Chrome slotted'], ['Fuchs-style', 'Chrome slotted', 'Wire spoke whitewall'], ['Chrome slotted', 'Wire spoke whitewall', 'Gold wire spoke'], ['Wire spoke whitewall', 'Gold wire spoke']];
const STANCE_BY_TIER = [['Stock', 'Lowered'], ['Stock', 'Lowered'], ['Lowered', 'Slammed'], ['Slammed'], ['Lowrider']];
const PLATE_BY_TIER = [['Standard'], ['Standard', 'Chrome'], ['Chrome', 'Chrome', 'DIAMOND'], ['Chrome', 'DIAMOND', 'DIAMOND'], ['DIAMOND']];
const EXTRAS = ['Roof rack', 'Surfboard', 'Pinstripes', 'Mural', 'Hood stripes', 'Fog lights', 'Spoiler', 'Chrome trim', 'Flame decals'];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const serverSeed = (secret, id) => crypto.createHmac('sha256', secret).update('ride:' + id).digest('hex');
const commitOf = (seedHex) => sha256(seedHex);
const finalSeed = (seedHex, sig, n = 0) => sha256(seedHex + ':' + (n ? sig + '#' + n : sig));
const rollBytes = (finalHex) => Buffer.concat([crypto.createHmac('sha256', finalHex).update('0').digest(), crypto.createHmac('sha256', finalHex).update('1').digest()]);

// Default roller (pure). Returns { tier, attributes:[{trait_type,value}], spec }.
function defaultRoll(b) {
  let o = 4; const u8 = () => b[o++ % b.length]; const pick = (a) => a[u8() % a.length];
  const r = ((b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0) / 4294967296 * 100;
  let acc = 0, tier = ODDS.length - 1; for (let i = 0; i < ODDS.length; i++) { acc += ODDS[i]; if (r < acc) { tier = i; break; } }
  const mythic = tier === 4;
  const model = mythic ? pick(LOWRIDERS) : pick(MODELS);
  const paint = pick(PAINTS_BY_TIER[tier]);
  const color = paint === 'Candy' ? pick(CANDY) : pick(COLORS);
  const pool = EXTRAS.slice(); const extras = [];
  const nExtra = [u8() % 2, 1 + (u8() % 2), 2 + (u8() % 2), 3 + (u8() % 2), 4][tier];
  if (mythic) extras.push('Pinstripes', 'Hydraulics', 'Chrome trim');
  for (let i = 0; i < nExtra && pool.length; i++) { const e = pool.splice(u8() % pool.length, 1)[0]; if (!extras.includes(e)) extras.push(e); }
  const serial = (((u8() << 8) | u8()) % 10000);
  const spec = { tier, model, paint, color, wheels: pick(WHEELS_BY_TIER[tier]), stance: pick(STANCE_BY_TIER[tier]), plate: pick(PLATE_BY_TIER[tier]), extras, serial };
  return spec;
}
const specCode = (s) => sha256(JSON.stringify([s.tier, s.model, s.paint, s.color, s.wheels, s.stance, s.plate, [...s.extras].sort(), s.serial]));
function specAttributes(s) {
  return [
    { trait_type: 'Rarity', value: TIERS[s.tier] }, { trait_type: 'Model', value: displayModel(s.model) }, { trait_type: 'Paint', value: s.paint }, { trait_type: 'Color', value: s.color },
    { trait_type: 'Wheels', value: s.wheels }, { trait_type: 'Stance', value: s.stance }, { trait_type: 'Plate', value: 'VWFEST' + (s.plate === 'DIAMOND' ? ' (Diamond lettering)' : s.plate === 'Chrome' ? ' (Chrome)' : '') },
    { trait_type: 'Lowrider', value: /Lowrider/.test(s.model) || s.stance === 'Lowrider' ? 'Yes' : 'No' },
    { trait_type: 'Extras', value: s.extras.length ? s.extras.join(', ') : 'None' }, { trait_type: 'Build', value: '#' + String(s.serial).padStart(4, '0') },
  ];
}
const defaultRoller = { roll: defaultRoll, code: specCode, attributes: specAttributes, tiers: TIERS, odds: ODDS };

// Adapter for the UI worker's shared/rides.js (roll/code/describe/TIERS/ODDS) so the NFT matches what the 3D world renders.
function adaptShared(R) {
  return {
    roll: (b) => R.roll(b), code: (s) => R.code(s).toString('base64url'), tiers: R.TIERS, odds: R.ODDS,
    attributes: (s) => { const d = R.describe(s); return [
      { trait_type: 'Rarity', value: d.tier }, { trait_type: 'Model', value: d.model }, { trait_type: 'Paint', value: d.paint }, { trait_type: 'Color', value: d.color }, { trait_type: 'Second Color', value: d.second },
      { trait_type: 'Wheels', value: d.wheels }, { trait_type: 'Stance', value: d.stance }, { trait_type: 'Plate', value: 'VWFEST' + (d.plate === 'DIAMOND' ? ' (Diamond lettering)' : d.plate === 'Chrome' ? ' (Chrome)' : '') },
      { trait_type: 'Lowrider', value: d.lowrider ? 'Yes' : 'No' }, { trait_type: 'Extras', value: d.extras.length ? d.extras.join(', ') : 'None' }, { trait_type: 'Build', value: d.build }]; },
    tierOf: (s) => s.tier,
  };
}
// Roll for a payment: returns { spec, code, reroll, final }. `taken(code)` says if the trait set already exists.
function rollRide({ seed, sig, roller = defaultRoller, taken = () => false }) {
  for (let n = 0; n < 50; n++) {
    const final = finalSeed(seed, sig, n); const spec = roller.roll(rollBytes(final)); const code = roller.code(spec);
    if (!taken(code)) return { spec, code, reroll: n, final };
  }
  throw new Error('could not roll a unique ride');
}
// Anyone can run this with the published {seed, commit, sig, reroll}.
function verifyRide({ seed, commit, sig, reroll = 0, spec }, roller = defaultRoller) {
  if (commitOf(seed) !== commit) return { ok: false, why: 'commit does not match seed' };
  const again = roller.roll(rollBytes(finalSeed(seed, sig, reroll)));
  return JSON.stringify(again) === JSON.stringify(spec) ? { ok: true } : { ok: false, why: 'roll does not match' };
}
const tierName = (roller, spec) => roller.tiers[typeof spec.tier === 'number' ? spec.tier : roller.tiers.indexOf(spec.tier)];
module.exports = { TIERS, ODDS, MODELS, LOWRIDERS, DISPLAY, displayModel, defaultRoller, defaultRoll, adaptShared, serverSeed, commitOf, finalSeed, rollBytes, rollRide, verifyRide, specCode, specAttributes, tierName };
