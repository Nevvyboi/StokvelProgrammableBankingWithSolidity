#!/usr/bin/env bash
# Run both house checks. Wire it up with: ln -s ../../scripts/precommit.sh .git/hooks/pre-commit
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
./scripts/scan-secrets.sh
./scripts/check-dashes.sh
