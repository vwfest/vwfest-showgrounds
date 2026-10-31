// Browser-side facade for wallets + purchase building (see INTERFACES.md §2). Today re-exports the original implementation;
// the Solana-payments worker's browser build (solana/client.js) will replace it behind the same names.
export { hasInjected, connectInjected, connectEmbedded, resumeEmbedded, balances } from './wallet.js';
export { prepare, signAndSend } from './pay.js';
