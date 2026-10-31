#!/usr/bin/env node
'use strict';
// Creates the two Core collections with the AUTHORITY key as update authority (mainnet costs ~0.003 SOL each; the authority must hold a little SOL).
// Dry-run by default on mainnet: pass --yes to actually send. Prints AVATAR_COLLECTION / RIDE_COLLECTION.
const { Connection } = require('@solana/web3.js');
const { loadConfig } = require('../src/config');
const setup = require('../src/setup');
(async () => {
  const cfg = loadConfig(process.env); if (!cfg.authority) throw new Error('Set AUTHORITY_SECRET_KEY');
  if (cfg.mainnet && !process.argv.includes('--yes')) { console.error('Mainnet: re-run with --yes to spend ~0.006 SOL from the authority wallet', cfg.authority.publicKey.toBase58()); process.exit(2); }
  if (!cfg.publicBase) throw new Error('Set PUBLIC_BASE_URL');
  const conn = new Connection(cfg.rpcUrl, 'confirmed'); const cols = await setup.createCollections(conn, cfg, cfg.publicBase);
  console.log(`AVATAR_COLLECTION=${cols.avatar}\nRIDE_COLLECTION=${cols.ride}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
