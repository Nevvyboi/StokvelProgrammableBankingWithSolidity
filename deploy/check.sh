#!/usr/bin/env bash
# Checks the server from the outside, the way the room will see it: what the public can reach,
# what it can't, and whether the chain reads work. Run it from your laptop, on mobile data if you
# can, after every setup.sh and again on the day.
#
#   ./deploy/check.sh https://stokvel.example.com
#   PRESENTER_USER=presenter PRESENTER_PASS=... ./deploy/check.sh https://stokvel.example.com
#
# Exits non-zero if anything is wrong. Needs curl only.
set -uo pipefail

BASE=${1:?usage: deploy/check.sh https://your.domain}
BASE=${BASE%/}
HOST=$(printf '%s' "$BASE" | sed -E 's#^[a-z]+://##; s#[:/].*$##')
fails=0
ok()  { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; fails=$((fails + 1)); }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
expect() { # expect <code> <label> <curl args...>
  local want=$1 label=$2; shift 2
  local got; got=$(code "$@")
  [[ $got == "$want" ]] && ok "$label ($got)" || bad "$label: expected $want, got $got"
}
rpc() { curl -s --max-time 15 -X POST -H 'content-type: application/json' --data "$1" "$BASE/api/rpc"; }

echo "public pages, open to anyone"
expect 200 "projector /"              "$BASE/"
expect 200 "audience /watch"          "$BASE/watch"
expect 200 "signing station /sign"    "$BASE/sign"
expect 200 "config /api/config"       "$BASE/api/config"
expect 200 "relayer feed"             "$BASE/relayer/feed"
expect 200 "relayer bank"             "$BASE/relayer/bank"
expect 200 "relayer health"           "$BASE/relayer/health"

echo "presenter only, must ask for the password"
expect 401 "presenter panel"          "$BASE/presenter"
expect 401 "card keys"                "$BASE/api/keys"
expect 401 "relayer admin (clock)"    -X POST "$BASE/relayer/admin/warp"
expect 401 "relayer admin (kill)"     -X POST "$BASE/relayer/admin/kill"
expect 401 "relayer propose"          -X POST "$BASE/relayer/propose"
expect 401 "relayer execute"          -X POST "$BASE/relayer/execute"
expect 401 "bank webhook"             -X POST "$BASE/relayer/webhook/transaction"
expect 401 "mock bank: steal"         -X POST "$BASE/mock/__mock/steal"
expect 401 "mock bank: state"         "$BASE/mock/__mock/state"

if [[ -n ${PRESENTER_USER:-} && -n ${PRESENTER_PASS:-} ]]; then
  echo "with the presenter login"
  expect 200 "presenter panel"        -u "$PRESENTER_USER:$PRESENTER_PASS" "$BASE/presenter"
  expect 403 "card keys stay off"     -u "$PRESENTER_USER:$PRESENTER_PASS" "$BASE/api/keys"
  expect 200 "mock bank state"        -u "$PRESENTER_USER:$PRESENTER_PASS" "$BASE/mock/__mock/state"
fi

echo "the chain, through the read-only proxy"
cfg=$(curl -s --max-time 10 "$BASE/api/config")
rpc_url=$(printf '%s' "$cfg" | grep -o '"rpcUrl":"[^"]*"' | cut -d'"' -f4)
stokvel=$(printf '%s' "$cfg" | grep -o '"stokvel":"0x[0-9a-fA-F]*"' | cut -d'"' -f4)
from=$(printf '%s' "$cfg" | grep -o '"deployedAtBlock":[0-9]*' | cut -d: -f2)
[[ $rpc_url == /api/rpc ]] && ok "browsers use /api/rpc, the provider key stays on the server" || bad "config hands browsers rpcUrl=$rpc_url (set PUBLIC_RPC_URL=/api/rpc)"
[[ -n $stokvel ]] && ok "contract $stokvel" || bad "no contract address in /api/config (deployments file or STOKVEL_ADDRESS)"
r=$(rpc '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}')
[[ $r == *'"result":"0x'* ]] && ok "block number reads" || bad "eth_blockNumber: $r"
if [[ -n $stokvel ]]; then
  r=$(rpc "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"eth_call\",\"params\":[{\"to\":\"$stokvel\",\"data\":\"0x146ca531\"},\"latest\"]}")
  [[ $r == *'"result":"0x'* ]] && ok "contract reads (round())" || bad "eth_call round(): $r"
  # the dashboard reads every event since the deploy block in one call on first load. Free RPC
  # tiers often cap the block range of eth_getLogs; this is where that shows up, not on stage
  r=$(rpc "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"eth_getLogs\",\"params\":[{\"address\":\"$stokvel\",\"fromBlock\":\"0x$(printf '%x' "${from:-0}")\",\"toBlock\":\"latest\"}]}")
  [[ $r == *'"result":['* ]] && ok "event history since block ${from:-0} in one call" || bad "eth_getLogs from the deploy block: $r (the RPC plan caps the range; use a provider or plan that allows it)"
fi
r=$(rpc '{"jsonrpc":"2.0","id":4,"method":"eth_sendRawTransaction","params":["0x00"]}')
[[ $r == *'not served here'* ]] && ok "transactions refused" || bad "eth_sendRawTransaction was not refused: $r"
r=$(rpc '{"jsonrpc":"2.0","id":5,"method":"eth_call","params":[{"to":"0x0000000000000000000000000000000000000001","data":"0x"},"latest"]}')
[[ $r == *'not served here'* ]] && ok "calls to other contracts refused" || bad "eth_call to another contract was not refused: $r"

echo "transport"
loc=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 10 "http://$HOST/")
[[ $loc == https://* ]] && ok "http redirects to https" || bad "http://$HOST/ does not redirect to https (got '$loc')"
for port in 3000 4000 4100 4200 8545; do
  if curl -s -o /dev/null --max-time 4 "http://$HOST:$port/" 2>/dev/null; then bad "port $port answers from outside (bind to 127.0.0.1, check the firewall)"; else ok "port $port closed"; fi
done

echo
if [[ $fails -eq 0 ]]; then echo "all good"; else echo "$fails problem(s)"; exit 1; fi
