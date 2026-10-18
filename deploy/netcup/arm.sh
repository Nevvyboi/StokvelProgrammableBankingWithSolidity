#!/usr/bin/env bash
# Arms the talk: a fresh chain on the server with the contract deployed and two settled months and a
# mid-month round seeded, the same state ./scripts/demo.sh --mock gives you locally. Run it from your
# laptop the day before the talk, after every rehearsal, or whenever you want a clean start.
#
#   ./deploy/netcup/arm.sh            # seeded months (the run sheet)
#   ./deploy/netcup/arm.sh --fresh    # round 1, nobody paid
#
# The card keys never leave this laptop: Foundry deploys through an SSH tunnel to the server's
# Anvil, and only the deployment file and the mock bank's ledger are copied over. Needs Foundry,
# cards/out/members.json and `ssh floati` working (deploy/netcup/README.md).
set -euo pipefail
cd "$(dirname "$0")/../.."
SSH_HOST=${SSH_HOST:-floati}
DOMAIN=${DOMAIN:-stokvel.nevvy.studio}
APP=/opt/stokvel
TUNNEL_PORT=18545
RPC=http://127.0.0.1:$TUNNEL_PORT
SEED=1
[[ ${1:-} == --fresh ]] && SEED=0

step() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
export PATH=$HOME/.foundry/bin:$PATH FOUNDRY_OFFLINE=false
for t in forge cast ssh scp; do command -v $t >/dev/null || die "missing $t"; done
[[ -f cards/out/members.json ]] || die "cards/out/members.json not found: the printed cards are the members"
MEMBERS=../cards/out/members.json

step "server: a fresh chain"
ssh "$SSH_HOST" "grep -qE '^CHAIN_ID=31337' /etc/stokvel/stokvel.env || { echo 'stokvel.env is not CHAIN_ID=31337'; exit 1; }
  systemctl stop stokvel-relayer stokvel-mock stokvel-anvil
  rm -f /var/lib/stokvel/anvil.json /var/lib/stokvel/armed.json $APP/contracts/deployments/31337.json $APP/contracts/deployments/demo-ledger.jsonl
  systemctl start stokvel-anvil"

step "tunnel to the server's Anvil"
ssh -o ExitOnForwardFailure=yes -N -L "$TUNNEL_PORT:127.0.0.1:8545" "$SSH_HOST" & TUNNEL=$!
trap 'kill $TUNNEL 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do [[ $(cast chain-id --rpc-url $RPC 2>/dev/null) == 31337 ]] && break; sleep 1; done
[[ $(cast chain-id --rpc-url $RPC 2>/dev/null) == 31337 ]] || die "Anvil did not answer through the tunnel (journalctl -u stokvel-anvil)"
[[ $(cast block-number --rpc-url $RPC) -lt 1000 ]] || die "that chain isn't fresh; refusing to deploy over it"

step "deploying Stokvel (V2) and StokvelV1Vulnerable, members from the printed cards"
rm -f contracts/deployments/31337.json contracts/deployments/demo-ledger.jsonl
(cd contracts && MEMBERS_FILE=$MEMBERS forge script script/Deploy.s.sol --rpc-url $RPC --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 2>&1 | grep -E "Stokvel|written|Error" || true) # scan:allow Anvil account 0
[[ -f contracts/deployments/31337.json ]] || die "the deploy wrote no contracts/deployments/31337.json"

if [[ $SEED -eq 1 ]]; then
  step "seeding two settled months and a mid-month round (as scripts/demo.sh does)"
  warp() { cast rpc --rpc-url $RPC evm_increaseTime "$1" >/dev/null; cast rpc --rpc-url $RPC evm_mine >/dev/null; }
  fs() { (cd contracts && MEMBERS_FILE=$MEMBERS MEMBERS_KEYS_FILE=$MEMBERS forge script script/DemoState.s.sol --rpc-url $RPC --broadcast "$@" 2>&1 | grep -E "^  [a-z]|Error|revert" || true); }
  # nobody signs the constitution: DEMO 1 is the volunteers doing it on stage
  fs --sig "month(uint256)" 0
  warp 2592000
  fs --sig "closeAndSettle()"
  fs --sig "month(uint256)" 1
  warp 2592000
  fs --sig "closeAndSettle()"
  fs --sig "midMonth()"
fi

step "server: save this chain as the armed snapshot (the nightly reset and a broken state file go back to it)"
kill $TUNNEL 2>/dev/null || true
ssh "$SSH_HOST" "systemctl stop stokvel-anvil   # a normal stop saves the state file
  cp -p /var/lib/stokvel/anvil.json /var/lib/stokvel/armed.json
  node -e 'JSON.parse(require(\"fs\").readFileSync(process.argv[1], \"utf8\"))' /var/lib/stokvel/armed.json && echo '  armed.json saved'
  systemctl start stokvel-anvil"

step "server: the deployment and the bank's ledger, then the relayer and the bank"
files=(contracts/deployments/31337.json)
[[ -f contracts/deployments/demo-ledger.jsonl ]] && files+=(contracts/deployments/demo-ledger.jsonl)
scp -q "${files[@]}" "$SSH_HOST:$APP/contracts/deployments/"
ssh "$SSH_HOST" "chown stokvel:stokvel $APP/contracts/deployments/*
  B=\$(docker network inspect databrew_backend -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
  systemctl start stokvel-mock stokvel-relayer && systemctl restart stokvel-stage
  for i in \$(seq 1 30); do systemctl is-active -q stokvel-relayer && curl -sf -o /dev/null http://\$B:4000/health && break; sleep 2; done
  for s in stokvel-anvil stokvel-mock stokvel-relayer stokvel-stage; do printf '  %-16s %s\n' \$s \$(systemctl is-active \$s); done"

echo
echo "  Armed: $(python3 -c 'import json;d=json.load(open("contracts/deployments/31337.json"));print("contract", d["stokvel"])')"
step "check from outside"
./deploy/check.sh "https://$DOMAIN" || true
