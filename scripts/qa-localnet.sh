#!/usr/bin/env bash
# Real-chain purchase E2E: starts a throwaway solana-test-validator (mpl-core cloned from devnet), runs test/e2e-localnet.cjs, stops it.
# Needs the Agave CLI (sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)") and `npm ci` in . and solana/. Devnet's faucet is closed, so a local validator is used.
set -euo pipefail
RPC_PORT=${RPC_PORT:-18899}; LEDGER=$(mktemp -d)
solana-test-validator --reset --quiet --ledger "$LEDGER" --rpc-port "$RPC_PORT" --faucet-port $((RPC_PORT+1001)) --gossip-port $((RPC_PORT-898)) --dynamic-port-range $((RPC_PORT-897))-$((RPC_PORT-869)) \
  --url https://api.devnet.solana.com --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d >/dev/null 2>&1 & VP=$!
trap 'kill $VP 2>/dev/null; rm -rf "$LEDGER"' EXIT
for i in $(seq 60); do curl -sf -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://127.0.0.1:$RPC_PORT" >/dev/null && break; sleep 1; done
LOCALNET_RPC="http://127.0.0.1:$RPC_PORT" node test/e2e-localnet.cjs
