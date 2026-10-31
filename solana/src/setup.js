'use strict';
// One-time setup helpers (used by scripts/ and the tests). The authority pays for collection creation; it holds no user funds.
const { Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const nft = require('./nft');

async function airdrop(conn, pubkey, sol = 2) {
  const sig = await conn.requestAirdrop(new PublicKey(pubkey), Math.round(sol * 1e9)); const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed'); return sig;
}
async function createTestMint(conn, authority, decimals = 6) { return spl.createMint(conn, authority, authority.publicKey, null, decimals, Keypair.generate(), { commitment: 'confirmed' }, spl.TOKEN_PROGRAM_ID); }
async function createCollections(conn, cfg, base) {
  const out = {};
  for (const kind of ['avatar', 'ride']) {
    const kp = Keypair.generate(); const col = cfg.collections[kind];
    const ix = nft.createCollectionIx({ collection: kp.publicKey, payer: cfg.authority.publicKey, name: col.name, uri: `${base}/api/solana/nft/collection/${kind}.json`, updateAuthority: cfg.authority.publicKey });
    await sendAndConfirmTransaction(conn, new Transaction().add(ix), [cfg.authority, kp], { commitment: 'confirmed' });
    out[kind] = kp.publicKey.toBase58();
  }
  return out;
}
module.exports = { airdrop, createTestMint, createCollections };
