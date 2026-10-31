'use strict';
// Test harness: boots a throwaway local solana-test-validator (with the real mpl-core program loaded) when the binary is available.
const { spawn, execSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Connection, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const BIN = process.env.SOLANA_TEST_VALIDATOR || path.join(os.homedir(), 'solana-bin/solana-release/bin/solana-test-validator');
const CORE_SO = path.join(__dirname, 'fixtures/mpl_core.so');

async function startValidator() {
  if (process.env.LOCAL_RPC) return { rpc: process.env.LOCAL_RPC, stop() {} };
  if (!fs.existsSync(BIN)) return null;
  const base = 20000 + Math.floor(Math.random() * 20000); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vwtv-'));
  const p = spawn(BIN, ['--reset', '--quiet', '--ledger', dir, '--rpc-port', String(base), '--faucet-port', String(base + 1), '--gossip-port', String(base + 2), '--dynamic-port-range', `${base + 10}-${base + 60}`, '--bpf-program', 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d', CORE_SO], { stdio: 'ignore' });
  const rpc = `http://127.0.0.1:${base}`; const conn = new Connection(rpc, 'confirmed');
  for (let i = 0; i < 90; i++) { try { await conn.getVersion(); await conn.getLatestBlockhash(); break; } catch { await new Promise((r) => setTimeout(r, 1000)); if (i === 89) throw new Error('validator failed to start'); } }
  return { rpc, stop() { p.kill('SIGKILL'); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
}
const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
function testEnv(extra = {}) { const authority = Keypair.generate(); return { SOLANA_NETWORK: 'localnet', SERVER_SECRET: SECRET, AUTHORITY_SECRET_KEY: bs58.encode(authority.secretKey), PUBLIC_BASE_URL: 'http://localhost:3999', FIXED_SOL_USD: '100', DEVNET_TOKENS_PER_USD: '10', ...extra }; }
module.exports = { startValidator, testEnv, SECRET };
