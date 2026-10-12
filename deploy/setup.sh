#!/usr/bin/env bash
# Sets up, or updates, the talk on a fresh Ubuntu 24.04 server. Run as root, as often as you like:
#
#   curl -fsSL https://raw.githubusercontent.com/Nevvyboi/StokvelProgrammableBankingWithSolidity/main/deploy/setup.sh | sudo bash
#   sudo /opt/stokvel/deploy/setup.sh            # later runs: pull, rebuild, restart
#
# The first run stops after creating /etc/stokvel/*.env and asks you to fill them in.
# deploy/README.md walks through every step around it (server, DNS, keys, contract).
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/Nevvyboi/StokvelProgrammableBankingWithSolidity.git}
BRANCH=${BRANCH:-main}
APP=/opt/stokvel
ETC=/etc/stokvel

step() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)"; exit 1; }
. /etc/os-release
[[ ${ID:-} == ubuntu ]] || echo "warning: written for Ubuntu 24.04, this is ${PRETTY_NAME:-unknown}"

# ---------------------------------------------------------------- packages
step "packages: git, firewall, automatic security updates"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ufw gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades >/dev/null

if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  step "Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

if ! command -v caddy >/dev/null; then
  step "Caddy (official apt repository)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
caddy version

# ---------------------------------------------------------------- firewall
step "firewall: SSH, HTTP and HTTPS in, nothing else"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

# ---------------------------------------------------------------- code
step "code: $REPO_URL ($BRANCH) in $APP"
id stokvel >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin stokvel
if [[ -d $APP/.git ]]; then
  git config --global --add safe.directory "$APP"
  git -C "$APP" fetch --quiet origin "$BRANCH"
  git -C "$APP" checkout --quiet "$BRANCH"
  git -C "$APP" reset --quiet --hard "origin/$BRANCH"   # the server never carries local edits
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP"
fi
chown -R stokvel:stokvel "$APP"
git -C "$APP" log -1 --format='  at %h %s'

# ---------------------------------------------------------------- configuration
mkdir -p "$ETC"
chmod 750 "$ETC"
fresh=0
for f in stokvel.env caddy.env; do
  if [[ ! -f $ETC/$f ]]; then
    install -m 600 "$APP/deploy/$f.example" "$ETC/$f"
    fresh=1
  fi
done
if [[ $fresh -eq 1 ]]; then
  cat <<EOF

  Created $ETC/stokvel.env and $ETC/caddy.env from the examples.
  Fill them in (deploy/README.md, step 6), then run this script again:

    sudo nano $ETC/stokvel.env
    sudo nano $ETC/caddy.env
    sudo $APP/deploy/setup.sh

EOF
  exit 0
fi
# refuse to start half configured: an empty key or an unhashed password is a broken talk
missing=()
for v in RPC_URL RELAYER_PK ATTESTOR_PK SPARE_ADDRESS; do grep -qE "^$v=.+" "$ETC/stokvel.env" || missing+=("stokvel.env: $v"); done
for v in STOKVEL_DOMAIN ACME_EMAIL; do grep -qE "^$v=.+" "$ETC/caddy.env" || missing+=("caddy.env: $v"); done
grep -q "YOUR_KEY\|example.com" "$ETC/stokvel.env" "$ETC/caddy.env" && missing+=("a placeholder (YOUR_KEY or example.com) is still in $ETC")
if [[ ${#missing[@]} -gt 0 ]]; then
  printf '  not filled in yet:\n'; printf '    %s\n' "${missing[@]}"; exit 1
fi
chmod 600 "$ETC"/*.env
chown root:root "$ETC"/*.env

chain_id=$(grep -E '^CHAIN_ID=' "$ETC/stokvel.env" | cut -d= -f2)
if [[ ! -f $APP/contracts/deployments/${chain_id:-84532}.json ]] && ! grep -qE '^STOKVEL_ADDRESS=0x' "$ETC/stokvel.env"; then
  echo "  contracts/deployments/${chain_id:-84532}.json is not in the repo and STOKVEL_ADDRESS is empty."
  echo "  Deploy the contract and commit the file first (deploy/README.md, step 5)."
  exit 1
fi

# ---------------------------------------------------------------- build
step "install and build (as the stokvel user)"
sudo -u stokvel -H bash -c "cd $APP/relayer && npm ci --no-audit --no-fund --loglevel=error"
sudo -u stokvel -H bash -c "cd $APP/stage && npm ci --no-audit --no-fund --loglevel=error && NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null"

# ---------------------------------------------------------------- services
step "services: stage, relayer, mock bank, Caddy"
install -m 644 "$APP"/deploy/systemd/stokvel-*.service /etc/systemd/system/
install -d /etc/systemd/system/caddy.service.d
install -m 644 "$APP/deploy/systemd/caddy-stokvel.conf" /etc/systemd/system/caddy.service.d/stokvel.conf
install -m 644 "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload

services=(stokvel-stage stokvel-relayer)
if grep -qE '^INVESTEC_MODE=sandbox' "$ETC/stokvel.env"; then
  services+=(stokvel-overlay); systemctl disable --now stokvel-mock >/dev/null 2>&1 || true
else
  services+=(stokvel-mock); systemctl disable --now stokvel-overlay >/dev/null 2>&1 || true
fi
systemctl enable --quiet "${services[@]}" caddy
systemctl restart "${services[@]}"
# validate before reload so a typo can't take the site down. Read the file literally: sourcing it
# would expand the $2a$14$... in the bcrypt hash as shell variables
while IFS='=' read -r k v; do [[ $k =~ ^[A-Z_]+$ ]] && export "$k=$v"; done < "$ETC/caddy.env"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload-or-restart caddy

sleep 5
for s in "${services[@]}" caddy; do printf '  %-18s %s\n' "$s" "$(systemctl is-active "$s")"; done
cat <<EOF

  Done. From your laptop, check what the public can and can't reach:

    ./deploy/check.sh https://$STOKVEL_DOMAIN

  Logs:  journalctl -u stokvel-relayer -f   (or stokvel-stage, stokvel-mock, caddy)
EOF
