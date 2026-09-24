#!/usr/bin/env bash
# House style: no em dashes or en dashes anywhere in the repo.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
hits=$(git ls-files -co --exclude-standard | grep -vE '\.(png|jpg|jpeg|pdf|pptx|ttf|woff2?|ico)$' \
  | LC_ALL=C xargs -r grep -nIP '\xe2\x80[\x93\x94]' 2>/dev/null || true)
if [[ -n "$hits" ]]; then
  echo "em or en dashes found:"
  echo "$hits"
  exit 1
fi
echo "dash check: clean"
