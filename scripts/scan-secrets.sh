#!/usr/bin/env bash
# Secret scan: run before every commit. Exits non-zero on any hit.
#   ./scripts/scan-secrets.sh          scan tracked + staged + new files
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
# the fallback snapshot holds public transaction hashes and event refs (32 byte hex, but not keys)
files=$(git ls-files -co --exclude-standard | grep -vE '\.(png|jpg|jpeg|pdf|pptx|ttf|woff2?|ico)$' | grep -v 'stage/public/fallback/snapshot.json' || true)

if command -v gitleaks >/dev/null 2>&1; then
  if ! gitleaks git --no-banner --redact -l warn . ; then fail=1; fi
  if ! gitleaks dir --no-banner --redact -l warn --config .gitleaks.toml . ; then fail=1; fi
else
  echo "gitleaks not installed, running the grep checks only"
fi

check() {
  local label="$1" pattern="$2"
  local hits
  hits=$(echo "$files" | xargs -r grep -nIE "$pattern" 2>/dev/null | grep -v 'scan:allow' || true)
  if [[ -n "$hits" ]]; then
    echo "possible $label:"
    echo "$hits" | head -20
    fail=1
  fi
}

check "private key or 32 byte secret" '0x[0-9a-fA-F]{64}([^0-9a-fA-F]|$)'
check "bearer token" 'Bearer [A-Za-z0-9._~+/=-]{20,}'
check "client secret" '(client_?secret|clientSecret|CLIENT_SECRET|x-api-key|API_KEY)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9+/=_-]{12,}'
check "mnemonic other than the public Anvil one" '\b([a-z]{3,8} ){11}[a-z]{3,8}\b.*mnemonic'

if [[ $fail -eq 0 ]]; then echo "secret scan: clean"; fi
exit $fail
