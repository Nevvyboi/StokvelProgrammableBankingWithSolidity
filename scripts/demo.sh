#!/usr/bin/env bash
# The whole demo in one command.
#
#   ./scripts/demo.sh --mock       Anvil + deploy + seeded state + mock Investec + relayer + stage app
#   ./scripts/demo.sh --sandbox    the same, but the relayer talks to the real Investec sandbox
#                                  (needs INVESTEC_* in relayer/.env; the sandbox is stateless, see docs)
#   ./scripts/demo.sh --fresh      skip the seeded months: start at round 1 with nobody paid
#
# Ctrl-C stops everything. Logs are in .demo/. The relayer runs in a restart loop so the
# "kill the server" demo brings it back on its own.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
MODE=mock
SEED=1
for a in "$@"; do
  case "$a" in
    --mock) MODE=mock ;;
    --sandbox) MODE=sandbox ;;
    --fresh) SEED=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option $a"; exit 1 ;;
  esac
done

for tool in anvil forge cast node npm; do
  command -v "$tool" >/dev/null || { echo "missing $tool. Foundry: https://getfoundry.sh, Node 20+: https://nodejs.org"; exit 1; }
done

mkdir -p .demo
: > .demo/pids
cleanup() {
  echo; echo "stopping"
  # every service runs in its own process group, so killing the group takes npm's children with it
  while read -r pid; do kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; done < .demo/pids
  sleep 1
  while read -r pid; do kill -KILL -- "-$pid" 2>/dev/null || true; done < .demo/pids
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

run() { # name, command...
  local name=$1; shift
  setsid "$@" > ".demo/$name.log" 2>&1 < /dev/null &
  echo $! >> .demo/pids
}

port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for p in 8545 4100 4000 3000; do
  if ! port_free "$p"; then
    echo "port $p is already in use. Stop whatever is on it (an old demo?) and run again."
    echo "  lsof -i :$p    or    fuser -k $p/tcp"
    exit 1
  fi
done

step() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- dependencies
[[ -d relayer/node_modules ]] || (step "installing relayer deps" && (cd relayer && npm install --no-audit --no-fund >/dev/null))
[[ -d stage/node_modules ]] || (step "installing stage deps" && (cd stage && npm install --no-audit --no-fund >/dev/null))

# ---------------------------------------------------------------- chain
step "starting Anvil on :8545"
run anvil anvil --port 8545 --block-time 2 --silent
for _ in $(seq 1 30); do cast chain-id --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break; sleep 0.5; done

step "deploying Stokvel (V2) and StokvelV1Vulnerable"
rm -f contracts/deployments/31337.json contracts/deployments/demo-ledger.jsonl
MEMBERS_FILE_ARG=""
if [[ -f cards/out/members.json ]]; then
  MEMBERS_FILE_ARG="../cards/out/members.json"
  echo "  using the printed cards' keys from cards/out/members.json"
fi
(cd contracts && MEMBERS_FILE="${MEMBERS_FILE_ARG}" forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 2>&1 | grep -E "Stokvel|written" || true) # scan:allow Anvil account 0

if [[ $SEED -eq 1 ]]; then
  step "seeding two settled months and a mid-month round"
  warp() { cast rpc --rpc-url http://127.0.0.1:8545 evm_increaseTime "$1" >/dev/null; cast rpc --rpc-url http://127.0.0.1:8545 evm_mine >/dev/null; }
  fs() { (cd contracts && MEMBERS_FILE="${MEMBERS_FILE_ARG}" MEMBERS_KEYS_FILE="${MEMBERS_FILE_ARG}" forge script script/DemoState.s.sol --rpc-url http://127.0.0.1:8545 --broadcast "$@" 2>&1 | grep -E "^  [a-z]|Error|revert" || true); }
  fs --sig "join()"
  fs --sig "month(uint256)" 0
  warp 2592000
  fs --sig "closeAndSettle()"
  fs --sig "month(uint256)" 1
  warp 2592000
  fs --sig "closeAndSettle()"
  fs --sig "midMonth()"
fi

# ---------------------------------------------------------------- bank and relayer
if [[ $MODE == mock ]]; then
  step "starting the mock Investec server on :4100"
  run mock env MOCK_PORT=4100 MOCK_SEED_FILE="$ROOT/contracts/deployments/demo-ledger.jsonl" \
    RELAYER_WEBHOOK_URL=http://127.0.0.1:4000/webhook/transaction LOG_PRETTY=true \
    npm --prefix relayer run --silent mock
fi

step "starting the relayer on :4000 (restart loop)"
run relayer bash -c "while true; do (cd relayer && env INVESTEC_MODE=$MODE RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 DEMO_MODE=true LOG_PRETTY=true PORT=4000 npx tsx src/index.ts) || true; echo 'relayer exited, restarting in 3s'; sleep 3; done"

# ---------------------------------------------------------------- stage
step "starting the stage app on :3000"
run stage env CHAIN_ID=31337 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 RELAYER_URL=http://127.0.0.1:4000 MOCK_URL=http://127.0.0.1:4100 INVESTEC_MODE=$MODE DEMO_MODE=true \
  npm --prefix stage run --silent dev
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:3000/api/config >/dev/null 2>&1 && break; sleep 1; done

cat <<EOF

  projector      http://localhost:3000/
  signing        http://localhost:3000/sign
  audience       http://localhost:3000/watch
  presenter      http://localhost:3000/presenter   (keep this one off the projector)

  relayer        http://localhost:4000/health
  mock bank      http://localhost:4100/__mock/state
  logs           .demo/*.log

  Ctrl-C stops everything.
EOF
wait
