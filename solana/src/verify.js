'use strict';
// Server-side on-chain verification. Nothing is granted until a CONFIRMED transaction is parsed and matches the quote:
// fee payer/signer == quote wallet, memo == quote memo, SPL burn of the $VWFEST mint by that wallet >= quote.burnMin,
// SOL / SPL dev-fee transfer to DEV_WALLET >= quote minimum. Only TOP-LEVEL instructions count (no CPI tricks).
const { PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
const C = require('./config');
const { memoFor, devMinLamports, devMinToken } = require('./quotes');
const nft = require('./nft');

const isSig = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s);

// Pure inspection of a jsonParsed getTransaction result.
function inspectPayTx(tx, q, cfg) {
  if (!tx || !tx.meta || !tx.transaction) return { ok: false, retry: true, why: 'Transaction not found yet' };
  if (tx.meta.err) return { ok: false, why: 'Transaction failed on-chain' };
  const msg = tx.transaction.message; const keys = msg.accountKeys.map((k) => (typeof k === 'string' ? k : String(k.pubkey)));
  const signerKeys = msg.accountKeys.filter((k) => typeof k !== 'string' && k.signer).map((k) => String(k.pubkey));
  if (keys[0] !== q.wallet || !signerKeys.includes(q.wallet)) return { ok: false, why: 'The transaction was not signed by the quoted wallet' };
  const memoWant = memoFor(q); let memo = null, burn = 0n, dev = 0n, devTok = 0n;
  const devAta = (mint, prog) => getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(q.devWallet), true, new PublicKey(String(prog))).toBase58();
  for (const ix of msg.instructions) {
    const p = ix.parsed;
    if ((ix.program === 'spl-memo') && typeof p === 'string') memo = p;
    else if (ix.program === 'system' && p && p.type === 'transfer' && q.devWallet && p.info.source === q.wallet && p.info.destination === q.devWallet) dev += BigInt(p.info.lamports);
    else if ((ix.program === 'spl-token' || ix.program === 'spl-token-2022') && p) {
      if (p.type === 'burnChecked' && p.info.mint === cfg.vwfestMint && p.info.authority === q.wallet) burn += BigInt(p.info.tokenAmount.amount);
      // unchecked `burn` is deliberately NOT accepted: only burnChecked (decimals verified by the token program)
      else if (p.type === 'transferChecked' && q.devTokenMint && p.info.mint === q.devTokenMint && p.info.authority === q.wallet && p.info.destination === devAta(q.devTokenMint, ix.programId)) devTok += BigInt(p.info.tokenAmount.amount);
    }
  }
  if (memo !== memoWant) return { ok: false, why: 'Quote code (memo) does not match' };
  if (burn <= 0n) return { ok: false, why: 'No $VWFEST burn found in that transaction' };
  if (burn < BigInt(q.burnMin)) return { ok: false, why: 'The burned amount was lower than the quote' };
  if (BigInt(q.devLamports) > 0n && dev < devMinLamports(q)) return { ok: false, why: 'The creator fee in that transaction was lower than the quote' };
  if (BigInt(q.devTokenRaw) > 0n && devTok < devMinToken(q)) return { ok: false, why: 'The creator fee (token) in that transaction was lower than the quote' };
  return { ok: true, wallet: q.wallet, burn: burn.toString(), devLamports: dev.toString(), devTokenRaw: devTok.toString(), blockTime: tx.blockTime || null, slot: tx.slot };
}

async function fetchTx(conn, sig, { tries = 8, delayMs = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (tx) return tx; if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
async function verifyPayment({ conn, cfg, q, sig, tries, delayMs }) {
  if (!isSig(sig)) return { ok: false, why: 'Bad signature' };
  const tx = await fetchTx(conn, sig, { tries, delayMs });
  if (tx && tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0] !== sig) return { ok: false, why: 'Signature mismatch' };
  return inspectPayTx(tx, q, cfg);
}
// The NFT is verified from on-chain account STATE (owner, collection, uri), not from instruction data.
async function verifyMint({ conn, cfg, kind, asset, wallet, uri, sig, tries = 6, delayMs = 1200 }) {
  const col = cfg.collections[kind].address;
  for (let i = 0; i < tries; i++) {
    const info = await conn.getAccountInfo(new PublicKey(asset), 'confirmed');
    if (info) {
      if (!info.owner.equals(nft.CORE)) return { ok: false, why: 'Asset is not a Core asset' };
      const p = nft.parseAsset(info.data);
      if (!p) return { ok: false, why: 'Bad asset account' };
      if (p.owner !== wallet) return { ok: false, why: 'The NFT is not owned by the paying wallet' };
      if (!p.updateAuthority || p.updateAuthority.type !== 'collection' || p.updateAuthority.address !== col) return { ok: false, why: 'The NFT is not in the expected collection' };
      if (p.uri !== uri) return { ok: false, why: 'The NFT metadata does not match' };
      if (sig && isSig(sig)) { const tx = await fetchTx(conn, sig, { tries: 2, delayMs: 800 }); if (!tx || tx.meta.err) return { ok: false, retry: true, why: 'Mint transaction not confirmed' }; const k = tx.transaction.message.accountKeys[0]; if (String(k.pubkey || k) !== wallet) return { ok: false, why: 'Mint was not signed by the wallet' }; }
      return { ok: true, name: p.name, uri: p.uri };
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, retry: true, why: 'NFT not found on-chain yet' };
}
module.exports = { inspectPayTx, verifyPayment, verifyMint, fetchTx, isSig };
