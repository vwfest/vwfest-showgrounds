#!/usr/bin/env node
'use strict';
// MAINNET SIMULATION ONLY. Never signs, never sends, never spends. Builds real payment transactions (live Jupiter route, live prices),
// runs them through our audit, then asks the RPC to simulateTransaction with sigVerify:false against a funded wallet of your choice.
//   SIM_WALLET=<any mainnet address holding SOL> [RPC_URL=...] node scripts/mainnet-sim.js
const { Keypair } = require('@solana/web3.js');
const { Solana } = require('../src/index'); const audit = require('../src/audit'); const C = require('../src/config');
(async () => {
  const wallet = process.env.SIM_WALLET || '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
  const env = { ...process.env, SOLANA_NETWORK: 'mainnet-beta', SERVER_SECRET: 's'.repeat(40), AUTHORITY_SECRET_KEY: require('bs58').default ? require('bs58').default.encode(Keypair.generate().secretKey) : require('bs58').encode(Keypair.generate().secretKey) };
  delete env.MAINNET_ARMED; const sg = new Solana({ env, shopPrice: () => 4 }); await sg.init();
  console.log('flags', JSON.stringify(sg.flags())); const out = [];
  const cases = [['shop paid in SOL', { kind: 'shop', item: 'x', method: 'sol' }], ['vendor paid in SOL', { kind: 'vendor', method: 'sol' }], ['avatar paid in SOL', { kind: 'avatar', method: 'sol', nft: { traits: { a: 1 }, imageSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>' } }], ['ride paid in SOL', { kind: 'ride', method: 'sol' }], ['shop paid in USDC', { kind: 'shop', item: 'x', method: 'spl', payTokenMint: sg.cfg.payTokens[0].mint }]];
  for (const [name, o] of cases) {
    if (process.env.SIM_ONLY && !new RegExp(process.env.SIM_ONLY, 'i').test(name)) continue;
    await new Promise((r) => setTimeout(r, +process.env.SIM_DELAY_MS || 5000)); // be polite to the free Jupiter tier (set JUPITER_API_KEY for more)
    try {
      const q = await sg.quote({ wallet, ...o }); const b = await sg.buildPay({ quoteId: q.id, wallet }); const tx = audit.decodeTx(b.tx); audit.auditPayTx(tx, b.quote, sg.cfg, await audit.fetchAlts(sg.conn, tx));
      const sim = await sg.conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
      out.push({ name, usd: q.usd, burnUi: q.burnUi, burnMin: q.burnMin, devSol: q.devSol, devToken: q.devTokenRaw, txBytes: b.tx.length, swap: b.swap, simErr: sim.value.err, units: sim.value.unitsConsumed, tail: (sim.value.logs || []).slice(-3) });
    } catch (e) { out.push({ name, error: e.message }); }
  }
  console.log(JSON.stringify(out, null, 1)); await sg.close(); process.exit(0);
})();
