// Server-side facade to the Solana payments module (solana/, see INTERFACES.md §1 and solana/README.md).
// Everything money-related (quotes, on-chain verification, replay/race protection, wallet auth, on-ramp sessions) lives there.
module.exports = require('../solana');
