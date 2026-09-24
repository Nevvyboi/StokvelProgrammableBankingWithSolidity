#!/usr/bin/env bash
# DEMO 6: 10,000 random months against V1, watch the fuzzer find the double-credit bug.
#   ./scripts/fuzz.sh        V1, expected to FAIL with a two-call reproduction
#   ./scripts/fuzz.sh v2     V2, expected to pass
set -uo pipefail
cd "$(dirname "$0")/../contracts"
if [[ "${1:-v1}" == "v2" ]]; then
  forge test --match-contract InvariantV2 -vv
else
  FOUNDRY_PROFILE=v1 forge test --match-contract InvariantV1 -vv
  echo
  echo "That failure is the point. The same suite passes on V2:  ./scripts/fuzz.sh v2"
fi
