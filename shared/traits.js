// Trait definitions shared by the server (uniqueness, NFT metadata, SVG portrait) and the browser (3D avatars + editor). Pure, no Node APIs.
const PAL = {
  skin: ['f6d2b0', 'f2c9a0', 'e0a878', 'c68642', 'a8693a', '8d5524', '6b3f1d', '4a2c15'],
  hair: ['1b1b1b', '3b2314', '5a3a1e', '8b5a2b', 'c8903a', 'e4c26a', 'b5392a', 'c9c9c9', '3a86ff', 'ff5da2', '2ec4b6', '7b2cbf'],
  shirt: ['d62828', 'f77f00', 'fcbf49', '2a9d8f', '1d8fe1', '7b2cbf', 'ff4fa3', 'f1faee', '2b2d42', '6a994e', '00c2a8', 'e9c46a', '9d0208', '48cae4', 'adb5bd', '0b6e4f'],
  pants: ['264653', '3d405b', '1b4332', '6b4423', '8d99ae', '14213d', '5c2a2a', 'bfa88a', '343a40', '2f6690'],
  eyes: ['5b3a29', '3a2418', '8a6a2f', '4a8f4f', '3f7fd6', '8b99a6', 'c58b2a', '8a5ad6'],
  car: ['e63946', 'f4a261', 'ffd166', '06d6a0', '118ab2', '9b5de5', 'f15bb5', 'f8f9fa', 'fb8500', '2a9d8f', '80ed99', '3a0ca3', '1d3557', 'a8dadc', 'bc4749', '212529'],
};
const NAMES = {
  skin: ['Fair', 'Light', 'Tan', 'Olive', 'Bronze', 'Brown', 'Deep', 'Ebony'],
  body: ['Slim', 'Average', 'Stocky'],
  hairStyle: ['Short', 'Long', 'Bun', 'Mohawk', 'Afro', 'Ponytail', 'Bald', 'Curly'],
  hair: ['Black', 'Dark brown', 'Brown', 'Chestnut', 'Sandy', 'Blonde', 'Ginger', 'Silver', 'Blue', 'Pink', 'Teal', 'Purple'],
  shirt: ['Red', 'Orange', 'Yellow', 'Teal', 'Blue', 'Purple', 'Pink', 'Cream', 'Navy', 'Green', 'Aqua', 'Sand', 'Maroon', 'Sky', 'Grey', 'Forest'],
  pattern: ['Solid', 'Stripes', 'Peace logo', 'Bug logo'],
  pants: ['Teal denim', 'Slate', 'Forest', 'Brown', 'Grey-blue', 'Navy', 'Maroon', 'Khaki', 'Charcoal', 'Blue jeans'],
  outfit: ['T-shirt only', 'Mechanic overalls', 'Hawaiian shirt', 'Denim jacket', 'Swap-meet vest'],
  hat: ['None', 'Ball cap', 'Bucket hat', 'Cowboy hat', 'Beanie', 'Flower', 'Bandana', 'Straw hat'],
  glasses: ['None', 'Aviators', 'Round specs', 'Shades'],
  acc: ['None', 'Peace sign necklace', 'Wrench', 'Scarf', 'Headphones', 'VW badge'],
  car: ['Beetle', 'Bus', 'Karmann Ghia', 'Thing'],
  carColor: ['Red', 'Orange', 'Yellow', 'Mint', 'Ocean', 'Purple', 'Pink', 'White', 'Tangerine', 'Teal', 'Lime', 'Indigo', 'Navy', 'Sky', 'Brick', 'Black'],
  carColor2: ['Red', 'Orange', 'Yellow', 'Mint', 'Ocean', 'Purple', 'Pink', 'White', 'Tangerine', 'Teal', 'Lime', 'Indigo', 'Navy', 'Sky', 'Brick', 'Black', 'Single color'],
  stripe: ['None', 'Racing stripes', 'Beltline stripe', 'Flames', 'Checkers'],
  sex: ['Male', 'Female', 'Non-binary / other'],
  eyes: ['Brown', 'Dark brown', 'Hazel', 'Green', 'Blue', 'Grey', 'Amber', 'Violet'],
  facial: ['Clean-shaven', 'Stubble', 'Mustache', 'Goatee', 'Full beard', 'Mutton chops'],
  age: ['Young', 'Adult', 'Seasoned', 'Elder'],
  height: ['Short', 'Average', 'Tall'],
  vibe: ['Chill Cruiser', 'Wrench Head', 'Party Animal', 'Hippie Soul', 'Speed Demon', 'Show Pro', 'Mystic', 'Surf Rat', 'Road Tripper', 'Swap Meet Hustler'],
  freckles: ['None', 'Freckles'],
  tattoo: ['None', 'Anchor', 'Flame', 'Bug', 'Peace'],
  accSide: ['Left', 'Right'],
};
// Personality drives walk style, idle animation, name-tag color and the emote set (client animates these).
const VIBES = [
  { name: 'Chill Cruiser', icon: '😎', color: '#59d8ff', walk: 'smooth', idle: 'sway', emotes: ['Wave', 'Shaka', 'Lean back', 'Cheer', 'Honk'] },
  { name: 'Wrench Head', icon: '🔧', color: '#ffb703', walk: 'stomp', idle: 'tinker', emotes: ['Wave', 'Wrench spin', 'Thumbs up', 'Cheer', 'Honk'] },
  { name: 'Party Animal', icon: '🎉', color: '#ff4fa3', walk: 'bounce', idle: 'dance', emotes: ['Wave', 'Dance', 'Party jump', 'Cheer', 'Honk'] },
  { name: 'Hippie Soul', icon: '☮️', color: '#7bd88f', walk: 'float', idle: 'sway', emotes: ['Peace sign', 'Dance', 'Meditate', 'Cheer', 'Honk'] },
  { name: 'Speed Demon', icon: '🏁', color: '#ff4d4d', walk: 'sprint', idle: 'rev', emotes: ['Wave', 'Rev it', 'Fist pump', 'Cheer', 'Honk'] },
  { name: 'Show Pro', icon: '🏆', color: '#ffd166', walk: 'proud', idle: 'pose', emotes: ['Wave', 'Bow', 'Judge nod', 'Cheer', 'Honk'] },
  { name: 'Mystic', icon: '🔮', color: '#b46bff', walk: 'float', idle: 'float', emotes: ['Wave', 'Cast', 'Meditate', 'Cheer', 'Honk'] },
  { name: 'Surf Rat', icon: '🏄', color: '#2ec4b6', walk: 'bounce', idle: 'sway', emotes: ['Shaka', 'Dance', 'Surf pose', 'Cheer', 'Honk'] },
  { name: 'Road Tripper', icon: '🧭', color: '#f4a261', walk: 'smooth', idle: 'look', emotes: ['Wave', 'Point', 'Thumbs up', 'Cheer', 'Honk'] },
  { name: 'Swap Meet Hustler', icon: '💰', color: '#80ed99', walk: 'swagger', idle: 'tinker', emotes: ['Wave', 'Deal', 'Thumbs up', 'Cheer', 'Honk'] },
];
const FIELDS = ['skin', 'body', 'hairStyle', 'hair', 'shirt', 'pattern', 'pants', 'outfit', 'hat', 'glasses', 'acc', 'car', 'carColor', 'carColor2', 'stripe', 'sex', 'eyes', 'facial', 'age', 'height', 'vibe', 'freckles', 'tattoo', 'accSide'];
const MAX = {}; for (const k of FIELDS) MAX[k] = NAMES[k].length;
const DEFAULT = { skin: 1, body: 1, hairStyle: 0, hair: 1, shirt: 3, pattern: 0, pants: 0, outfit: 0, hat: 1, glasses: 0, acc: 0, car: 0, carColor: 0, carColor2: 16, stripe: 0, sex: 2, eyes: 1, facial: 0, age: 1, height: 1, vibe: 0, freckles: 0, tattoo: 0, accSide: 0 };
// The profile quiz (asked once when a profile is created); the rest of the look is rolled from the profile ID hash.
const QUIZ = ['sex', 'skin', 'hairStyle', 'hair', 'eyes', 'facial', 'age', 'body', 'height', 'vibe', 'car'];
const GROUPS = [
  ['Identity', ['sex', 'age', 'height', 'body', 'vibe']],
  ['Face & hair', ['skin', 'eyes', 'hairStyle', 'hair', 'facial', 'freckles']],
  ['Outfit', ['shirt', 'pattern', 'outfit', 'pants']],
  ['Style', ['hat', 'glasses', 'acc', 'accSide', 'tattoo']],
  ['Your VW', ['car', 'carColor', 'carColor2', 'stripe']],
];
const LABEL = { skin: 'Skin', body: 'Build', hairStyle: 'Hair style', hair: 'Hair color', shirt: 'Shirt color', pattern: 'Shirt print', pants: 'Pants', outfit: 'Outfit', hat: 'Hat', glasses: 'Eyewear', acc: 'Accessory', car: 'Model', carColor: 'Paint', carColor2: 'Second tone', stripe: 'Graphics', sex: 'Body type', eyes: 'Eye color', facial: 'Facial hair', age: 'Age vibe', height: 'Height', vibe: 'Personality', freckles: 'Freckles', tattoo: 'Tattoo', accSide: 'Accessory side' };
function clean(a) {
  const o = {};
  for (const k of FIELDS) { const v = a && typeof a === 'object' ? a[k] : undefined; o[k] = Number.isInteger(v) && v >= 0 && v < MAX[k] ? v : DEFAULT[k]; }
  return o;
}
const hex = (k, i) => '#' + PAL[k][i];
module.exports = { VIBES, QUIZ, PAL, NAMES, FIELDS, MAX, DEFAULT, GROUPS, LABEL, clean, hex };
