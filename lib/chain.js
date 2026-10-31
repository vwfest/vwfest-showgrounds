// Server-side facade between the game server and the Solana payments module (see INTERFACES.md §1).
// When ../solana exists (built by the Solana-payments worker) it is used; until then we delegate to the original implementation in lib/pay.js, lib/burns.js, lib/onramp.js.
let impl = null;
try { impl = require('../solana'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND' || !/solana/.test(e.message)) throw e; }
const legacy = { Pay: require('./pay').Pay, Burns: require('./burns').Burns, onramp: require('./onramp') };
module.exports = { impl, legacy, usingSolanaModule: !!impl };
