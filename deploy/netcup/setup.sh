#!/usr/bin/env bash
# Sets up, or updates, the talk on the shared netcup server, beside DataBrew, floati and redline,
# without changing anything they use. Run as root, as often as you like:
#
#   /opt/stokvel/deploy/netcup/setup.sh              # everything: services, nginx, certificate
#   /opt/stokvel/deploy/netcup/setup.sh --no-nginx   # services only, nothing public yet
#
# First time, before the repo is on the server:
#   git clone https://github.com/Nevvyboi/StokvelProgrammableBankingWithSolidity.git /opt/stokvel
#
# Unlike deploy/setup.sh it installs no Caddy, touches no firewall and changes nothing in Docker.
# What it adds is listed in deploy/netcup/README.md, and teardown.sh removes exactly that.
set -euo pipefail

DOMAIN=${DOMAIN:-stokvel.nevvy.studio}
REPO_URL=${REPO_URL:-https://github.com/Nevvyboi/StokvelProgrammableBankingWithSolidity.git}
BRANCH=${BRANCH:-main}
PRESENTER_USER=${PRESENTER_USER:-presenter}
APP=/opt/stokvel
ETC=/etc/stokvel
# DataBrew's, never ours: read, and changed only by the one marked include line
NGINX_CTR=databrew-nginx-1
NGINX_CONF=/opt/DataBrew/nginx/nginx.conf
DOCKER_NET=databrew_backend
WEBROOT=/var/lib/docker/volumes/databrew_certbot_www/_data
# ours. /etc/letsencrypt is already mounted into the nginx container, so no new mount is needed
SITE=/etc/letsencrypt/stokvel
MARK="# stokvel-talk: remove after the talk (deploy/netcup/teardown.sh)"
INCLUDE="include $SITE/*.conf;  $MARK"
SWAP=/swapfile-stokvel
NEIGHBOURS=(https://databrew.works https://floati.life https://redlineclause.com)

nginx_on=1
[[ ${1:-} == --no-nginx ]] && nginx_on=0

step() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"
HERE=$APP/deploy/netcup

# ---------------------------------------------------------------- preflight
step "preflight: the shared nginx and its network"
docker inspect -f '{{.State.Running}}' "$NGINX_CTR" 2>/dev/null | grep -q true || die "$NGINX_CTR is not running"
[[ -f $NGINX_CONF ]] || die "$NGINX_CONF not found"
BIND=$(docker network inspect "$DOCKER_NET" -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
[[ $BIND =~ ^[0-9.]+$ ]] || die "no gateway address for $DOCKER_NET"
echo "  services will listen on $BIND (reachable by nginx, not by the internet)"
for p in 3000 4000 4100 4200 8545; do
  if ss -ltnp "sport = :$p" | grep -q LISTEN && ! ss -ltnp "sport = :$p" | grep -qE 'node|next|anvil'; then die "port $p is taken by something else"; fi
done

declare -A before
neighbours() { for u in "${NEIGHBOURS[@]}"; do curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u" || true; echo " $u"; done; }
while read -r code url; do before[$url]=$code; done < <(neighbours)
printf '  %s\n' "neighbours now: $(for u in "${NEIGHBOURS[@]}"; do printf '%s=%s ' "${u#https://}" "${before[$u]}"; done)"

# ---------------------------------------------------------------- packages: Node only
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  step "Node.js 22 (NodeSource); nothing else on this server uses Node"
  command -v node >/dev/null && die "an older Node is installed; not replacing something we didn't install"
  # NodeSource's installer may add helper packages too; remember which were new, for teardown.sh
  helpers=(apt-transport-https ca-certificates curl gnupg)
  mkdir -p "$ETC"
  for p in "${helpers[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || echo "$p"; done > "$ETC/.we-installed-node"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
node -v

# ---------------------------------------------------------------- code
step "code: $REPO_URL ($BRANCH) in $APP"
id stokvel >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin stokvel
# safe.directory per command, so root's global git config is left as it is
g() { git -c safe.directory="$APP" -C "$APP" "$@"; }
if [[ -d $APP/.git ]]; then
  g fetch --quiet origin "$BRANCH"
  g checkout --quiet "$BRANCH"
  g reset --quiet --hard "origin/$BRANCH"   # the server never carries local edits
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP"
fi
chown -R stokvel:stokvel "$APP"
g log -1 --format='  at %h %s'

# ---------------------------------------------------------------- configuration
mkdir -p "$ETC" && chmod 750 "$ETC"
if [[ ! -f $ETC/stokvel.env ]]; then
  install -m 600 "$APP/deploy/stokvel.env.example" "$ETC/stokvel.env"
  cat <<EOF

  Created $ETC/stokvel.env. Fill in RPC_URL, RELAYER_PK, ATTESTOR_PK and SPARE_ADDRESS
  (deploy/README.md, step 6), then run this script again:

    nano $ETC/stokvel.env
    $HERE/setup.sh

EOF
  exit 0
fi
chain_id=$(grep -E '^CHAIN_ID=' "$ETC/stokvel.env" | cut -d= -f2)
# 31337: the talk's own Anvil on this server (stokvel-anvil). The relayer uses Anvil's funded
# accounts, so its keys may stay empty, and arm.sh deploys, so there's no deployments file yet
anvil=0; [[ $chain_id == 31337 ]] && anvil=1
required=(RPC_URL SPARE_ADDRESS); [[ $anvil -eq 1 ]] || required+=(RELAYER_PK ATTESTOR_PK)
missing=()
for v in "${required[@]}"; do grep -qE "^$v=.+" "$ETC/stokvel.env" || missing+=("$v"); done
grep -q "YOUR_KEY" "$ETC/stokvel.env" && missing+=("RPC_URL still has YOUR_KEY")
[[ ${#missing[@]} -eq 0 ]] || die "not filled in yet in $ETC/stokvel.env: ${missing[*]}"
chmod 600 "$ETC/stokvel.env"; chown root:root "$ETC/stokvel.env"
if [[ $anvil -eq 0 && ! -f $APP/contracts/deployments/${chain_id:-84532}.json ]] && ! grep -qE '^STOKVEL_ADDRESS=0x' "$ETC/stokvel.env"; then
  die "contracts/deployments/${chain_id:-84532}.json is not in the repo and STOKVEL_ADDRESS is empty. Deploy and commit it first."
fi
sandbox=0; grep -qE '^INVESTEC_MODE=sandbox' "$ETC/stokvel.env" && sandbox=1

# ---------------------------------------------------------------- build, with swap only while it runs
step "install and build (as the stokvel user, at low priority so the other sites don't notice)"
made_swap=0
cleanup_swap() { if [[ $made_swap -eq 1 ]]; then swapoff "$SWAP" 2>/dev/null || true; rm -f "$SWAP"; echo "  temporary swap removed"; fi; }
trap cleanup_swap EXIT
if [[ -z $(swapon --noheadings) ]]; then
  fallocate -l 2G "$SWAP" && chmod 600 "$SWAP" && mkswap -q "$SWAP" && swapon "$SWAP" && made_swap=1
  echo "  2 GB temporary swap at $SWAP for the build (not in /etc/fstab)"
fi
build="export NODE_OPTIONS=--max-old-space-size=1536 NEXT_TELEMETRY_DISABLED=1
  cd $APP/relayer && npm ci --no-audit --no-fund --loglevel=error
  cd $APP/stage && npm ci --no-audit --no-fund --loglevel=error && npx next build >/dev/null"
runuser -u stokvel -- env HOME="$APP" nice -n 15 ionice -c3 bash -c "$build"
cleanup_swap; made_swap=0

if [[ $anvil -eq 1 && ! -x $APP/.foundry/bin/anvil ]]; then
  step "Foundry's anvil, inside $APP (gone with it at teardown)"
  runuser -u stokvel -- env HOME="$APP" FOUNDRY_DIR="$APP/.foundry" bash -c \
    "curl -fsSL https://foundry.paradigm.xyz | bash >/dev/null 2>&1; $APP/.foundry/bin/foundryup >/dev/null 2>&1"
  [[ -x $APP/.foundry/bin/anvil ]] || die "Foundry did not install into $APP/.foundry"
fi

# ---------------------------------------------------------------- services, on the Docker gateway
step "services: stage, relayer, $([[ $sandbox -eq 1 ]] && echo 'sandbox overlay' || echo 'mock bank')"
install -m 644 "$APP"/deploy/systemd/stokvel-*.service /etc/systemd/system/
[[ $anvil -eq 1 ]] && install -m 644 "$HERE/stokvel-anvil.service" /etc/systemd/system/
dropin() { install -d "/etc/systemd/system/$1.service.d"; cat > "/etc/systemd/system/$1.service.d/netcup.conf"; }
# the units bind to 127.0.0.1 for Caddy; here nginx lives in a container, so they bind to the
# host's address on its network instead, and find each other there
bank_port=$([[ $sandbox -eq 1 ]] && echo 4200 || echo 4100)
dropin stokvel-stage <<EOF
# deploy/netcup: listen where the nginx container can reach it
[Unit]
After=docker.service
[Service]
ExecStart=
ExecStart=$APP/stage/node_modules/.bin/next start -H $BIND -p 3000
EOF
dropin stokvel-relayer <<EOF
# deploy/netcup: listen where the nginx container can reach it, and find the bank there
[Unit]
After=docker.service stokvel-anvil.service
[Service]
Environment=BIND_HOST=$BIND INVESTEC_BASE_URL=http://$BIND:$bank_port
EOF
for s in stokvel-mock stokvel-overlay; do
  dropin "$s" <<EOF
# deploy/netcup: listen where the nginx container can reach it, and find the relayer there
[Unit]
After=docker.service
[Service]
Environment=BIND_HOST=$BIND RELAYER_WEBHOOK_URL=http://$BIND:4000/webhook/transaction
EOF
done
systemctl daemon-reload
services=(stokvel-stage stokvel-relayer)
if [[ $sandbox -eq 1 ]]; then
  services+=(stokvel-overlay); systemctl disable --now stokvel-mock >/dev/null 2>&1 || true
else
  services+=(stokvel-mock); systemctl disable --now stokvel-overlay >/dev/null 2>&1 || true
fi
armed=1
if [[ $anvil -eq 1 ]]; then
  # the chain only starts here; restarting it would be harmless (it reloads its state file) but
  # there's no need. Without a deployment the relayer has nothing to watch: arm.sh starts it
  systemctl enable --quiet --now stokvel-anvil
  [[ -f $APP/contracts/deployments/31337.json ]] || armed=0
fi
systemctl enable --quiet "${services[@]}"
if [[ $armed -eq 1 ]]; then
  systemctl restart "${services[@]}"
else
  systemctl stop stokvel-relayer stokvel-mock stokvel-overlay 2>/dev/null || true
  systemctl restart stokvel-stage
  echo "  no contract on the chain yet: from your laptop, run ./deploy/netcup/arm.sh"
fi
for i in $(seq 1 30); do { [[ $armed -eq 0 ]] || curl -sf -o /dev/null "http://$BIND:4000/health"; } && curl -sf -o /dev/null "http://$BIND:3000/" && break; sleep 2; done
for s in $([[ $anvil -eq 1 ]] && echo stokvel-anvil) "${services[@]}"; do printf '  %-18s %s\n' "$s" "$(systemctl is-active "$s")"; done
curl -sf -o /dev/null "http://$BIND:3000/" || die "the stage app does not answer on $BIND:3000 (journalctl -u stokvel-stage -n 50)"

if [[ $nginx_on -eq 0 ]]; then
  echo; echo "  Services are up on $BIND, nothing public yet (--no-nginx)."; exit 0
fi

# ---------------------------------------------------------------- nginx: one marked line, our own file
ngx() { docker exec "$NGINX_CTR" nginx "$@"; }
# the container sees nginx.conf through a single-file bind mount: write it in place, never
# replace it (sed -i or an editor's save-as-new-file would leave the container on the old copy)
include_off() { local t; t=$(mktemp); grep -vF "$MARK" "$NGINX_CONF" > "$t" || true; cat "$t" > "$NGINX_CONF"; rm -f "$t"; }
include_on() { grep -qF "$MARK" "$NGINX_CONF" || printf '%s\n' "$INCLUDE" >> "$NGINX_CONF"; }
render() { sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__BIND__|$BIND|g" "$@"; }
apply() { # apply <what>: test, then reload, or put everything back as it was and stop
  local out; out=$(ngx -t -q 2>&1) && { ngx -s reload; echo "  nginx reloaded ($1)"; return; }
  printf '%s\n' "$out" >&2
  include_off; rm -f "$SITE/site.conf"; ngx -t -q && ngx -s reload
  die "nginx rejected $1; the include line and our file are removed, the other sites are untouched"
}

step "DNS: $DOMAIN must point here before Let's Encrypt is asked"
me=$(ip -4 route get 1.1.1.1 | grep -oP 'src \K[0-9.]+')
getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | grep -qx "$me" \
  || die "$DOMAIN does not resolve to $me yet (dig +short $DOMAIN). Add the A record, wait, run again."
echo "  $DOMAIN → $me"

step "nginx: our server block, included from $SITE"
[[ -f $NGINX_CONF.bak-stokvel ]] || cp -p "$NGINX_CONF" "$NGINX_CONF.bak-stokvel"
install -d -m 755 "$SITE"
if [[ ! -f $SITE/htpasswd ]]; then
  pass=${PRESENTER_PASS:-}
  if [[ -z $pass ]]; then read -rsp "  presenter password for $PRESENTER_USER: " pass; echo; fi
  [[ ${#pass} -ge 12 ]] || die "use a presenter password of at least 12 characters"
  # apr1: nginx checks it itself, whatever the container's libc supports
  printf '%s:%s\n' "$PRESENTER_USER" "$(openssl passwd -apr1 "$pass")" > "$SITE/htpasswd"
  chmod 644 "$SITE/htpasswd"   # the nginx workers (uid 101 in the container) read it
fi
have_cert=0; [[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]] && have_cert=1
{ render "$HERE/nginx-http.conf"; [[ $have_cert -eq 1 ]] && render "$HERE/nginx-https.conf"; } > "$SITE/site.conf"
include_on
docker exec "$NGINX_CTR" grep -qF "$MARK" /etc/nginx/conf.d/default.conf || die "the container doesn't see the include line (bind mount)"
apply "$([[ $have_cert -eq 1 ]] && echo 'HTTP + HTTPS' || echo 'HTTP only, for the challenge')"

if [[ $have_cert -eq 0 ]]; then
  step "certificate: a dry run first, so a mistake doesn't spend Let's Encrypt's rate limit"
  cb=(certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --cert-name "$DOMAIN" --non-interactive --agree-tos)
  "${cb[@]}" --dry-run -q || die "certbot dry run failed (is port 80 reaching nginx for $DOMAIN?)"
  "${cb[@]}" -q
  { render "$HERE/nginx-http.conf"; render "$HERE/nginx-https.conf"; } > "$SITE/site.conf"
  apply "HTTP + HTTPS"
fi

# ---------------------------------------------------------------- did we disturb anyone?
step "neighbours: the same answers as before"
sleep 2
worse=0
while read -r code url; do
  printf '  %-28s %s → %s\n' "${url#https://}" "${before[$url]}" "$code"
  [[ ${before[$url]} == 200 && $code != 200 ]] && worse=1
done < <(neighbours)
if [[ $worse -eq 1 ]]; then
  include_off; ngx -t -q && ngx -s reload
  die "a neighbour stopped answering 200; the include line is removed and nginx reloaded. Investigate before trying again."
fi

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/")
echo "  https://$DOMAIN/ → $code"
cat <<EOF

  Done. From your laptop, check what the public can and can't reach:

    PRESENTER_USER=$PRESENTER_USER PRESENTER_PASS=... ./deploy/check.sh https://$DOMAIN

  Logs:  journalctl -u stokvel-relayer -f   (or stokvel-stage, stokvel-mock)
  Off again, completely:  $HERE/teardown.sh
EOF
