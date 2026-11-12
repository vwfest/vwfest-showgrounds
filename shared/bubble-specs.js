// STEP 1 test-car specs for the photoreal Bubble (model index 0).
// Display name is original: "Bubble". Codes still encode the model INDEX (0).
// These are review fixtures, not a change to roll().
const BUBBLE = 'Bubble';
const SPECS = {
  common: {
    // Solid/patina, stock wheels, stock stance, standard plate.
    serial: 101, tier: 0, model: 0, paint: 5, c1: 2, c2: 16, wheels: 0, stance: 0, plate: 0, extras: 0,
  },
  rare: {
    // Metallic two-tone, custom chrome-slotted rims, lowered, hood stripe, chrome plate.
    serial: 404, tier: 1, model: 0, paint: 4, c1: 4, c2: 7, wheels: 3, stance: 1, plate: 1, extras: 1 << 4,
  },
  epic: {
    // Candy paint, gold wire, hydraulics (lowrider stance), chrome trim, underglow, gold diamond VWFEST plate.
    serial: 777, tier: 2, model: 0, paint: 2, c1: 5, c2: 16, wheels: 5, stance: 4, plate: 2, extras: (1 << 7) | (1 << 9),
  },
};
module.exports = { BUBBLE, SPECS };
