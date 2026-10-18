#!/usr/bin/env bash
# Runs before Anvil starts (stokvel-anvil.service) and from the nightly reset (stokvel-reset).
#
#   anvil-state.sh check   an unreadable state file is set aside and the armed snapshot put back,
#                          so a chain killed mid-save comes back instead of failing every 2 seconds
#   anvil-state.sh reset   put the armed snapshot back: the seeded state arm.sh left, every night
#
# armed.json is the chain as arm.sh seeded it, saved once right after arming. The contract
# address, the deployment file and the mock bank's ledger all match it, so nothing else changes.
set -uo pipefail
DIR=/var/lib/stokvel
STATE=$DIR/anvil.json
ARMED=$DIR/armed.json

valid() { [[ -s $1 ]] && node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$1" 2>/dev/null; }

case ${1:-check} in
  check)
    if [[ -e $STATE ]] && ! valid "$STATE"; then
      rm -f "$DIR"/anvil.json.unreadable
      mv "$STATE" "$DIR/anvil.json.unreadable"
      echo "anvil.json was unreadable (killed while saving?): set aside as anvil.json.unreadable"
    fi
    if [[ ! -e $STATE ]] && valid "$ARMED"; then
      cp "$ARMED" "$STATE"
      echo "restored the armed snapshot"
    fi
    ;;
  reset)
    if valid "$ARMED"; then
      cp "$ARMED" "$STATE"
      echo "reset to the armed snapshot"
    else
      echo "no armed snapshot (run deploy/netcup/arm.sh): left the chain as it is"
    fi
    ;;
  *) echo "usage: anvil-state.sh check|reset" >&2; exit 2 ;;
esac
exit 0
