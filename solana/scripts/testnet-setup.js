#!/usr/bin/env node
'use strict';
// Creates everything needed to run the module on devnet/localnet and prints the env lines to use:
//   SOLANA_NETWORK=devnet|localnet RPC_URL=... PUBLIC_BASE_URL=https://your.site node scripts/testnet-setup.js
// Reuses AUTHORITY_SECRET_KEY if set, else generates one (printed once: save it as a secret).
const { Connection, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const { loadConfig } = require('../src/config');
const setup = require('../src/setup');
(async () => {
  const env = { ...process.env }; if (!env.SOLANA_NETWORK) env.SOLANA_NETWORK = 'devnet';
  if (env.SOLANA_NETWORK === 'mainnet-beta') { console.error('Refusing: this script is for test networks only.'); process.exit(1); }
  const authority = env.AUTHORITY_SECRET_KEY ? Keypair.fromSecretKey(bs58.decode(env.AUTHORITY_SECRET_KEY)) : Keypair.generate();
  env.AUTHORITY_SECRET_KEY = bs58.encode(authority.secretKey);
  const cfg = loadConfig(env); const conn = new Connection(cfg.rpcUrl, 'confirmed');
  const base = cfg.publicBase || 'http://localhost:3000';
  console.error('authority', authority.publicKey.toBase58());
  const bal = await conn.getBalance(authority.publicKey); if (bal < 0.1e9) { console.error('airdropping 2 SOL...'); await setup.airdrop(conn, authority.publicKey, 2); }
  const mint = env.DEVNET_VWFEST_MINT || (await setup.createTestMint(conn, authority, cfg.decimals)).toBase58();
  const cols = await setup.createCollections(conn, cfg, base);
  console.log(`SOLANA_NETWORK=${env.SOLANA_NETWORK}\nAUTHORITY_SECRET_KEY=${env.AUTHORITY_SECRET_KEY}\nDEVNET_VWFEST_MINT=${mint}\nAVATAR_COLLECTION=${cols.avatar}\nRIDE_COLLECTION=${cols.ride}\nSERVER_SECRET=${require('crypto').randomBytes(32).toString('hex')}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
