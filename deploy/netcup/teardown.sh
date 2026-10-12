#!/usr/bin/env bash
# Takes the talk off the shared netcup server again: everything deploy/netcup/setup.sh added, and
# nothing else. DataBrew, floati and redline keep running throughout; nginx is only reloaded.
#
#   /opt/stokvel/deploy/netcup/teardown.sh          # asks you to type the domain first
#   /opt/stokvel/deploy/netcup/teardown.sh --yes
#
# Safe to rerun: each step skips what is already gone.
set -uo pipefail

DOMAIN=${DOMAIN:-stokvel.nevvy.studio}
APP=/opt/stokvel
ETC=/etc/stokvel
NGINX_CTR=databrew-nginx-1
NGINX_CONF=/opt/DataBrew/nginx/nginx.conf
SITE=/etc/letsencrypt/stokvel
MARK="# stokvel-talk: remove after the talk (deploy/netcup/teardown.sh)"
SWAP=/swapfile-stokvel
UNITS=(stokvel-stage stokvel-relayer stokvel-mock stokvel-overlay)
NEIGHBOURS=(https://databrew.works https://floati.life https://redlineclause.com)

step() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"

# this script lives in $APP, which it deletes: run from a copy
if [[ ${STOKVEL_TEARDOWN_COPY:-} != 1 ]]; then
  t=$(mktemp /tmp/stokvel-teardown.XXXXXX); cp "$0" "$t"; chmod 700 "$t"
  STOKVEL_TEARDOWN_COPY=1 exec bash "$t" "$@"
fi
trap 'rm -f "$0"' EXIT
cd /

if [[ ${1:-} != --yes ]]; then
  echo "This removes the talk ($DOMAIN) from this server: services, code, keys, certificate, nginx include."
  read -rp "Type $DOMAIN to go ahead: " answer
  [[ $answer == "$DOMAIN" ]] || die "nothing changed"
fi

declare -A before
neighbours() { for u in "${NEIGHBOURS[@]}"; do curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u" || true; echo " $u"; done; }
while read -r code url; do before[$url]=$code; done < <(neighbours)
ngx() { docker exec "$NGINX_CTR" nginx "$@"; }

# ---------------------------------------------------------------- nginx first, so nothing points at what follows
step "nginx: the include line"
if grep -qF "$MARK" "$NGINX_CONF"; then
  saved=$(mktemp); cp -p "$NGINX_CONF" "$saved"
  # in place: the container sees this file through a single-file bind mount
  t=$(mktemp); grep -vF "$MARK" "$NGINX_CONF" > "$t"; cat "$t" > "$NGINX_CONF"; rm -f "$t"
  if out=$(ngx -t -q 2>&1); then
    ngx -s reload && echo "  removed, nginx reloaded"
    rm -f "$saved"
  else
    cat "$saved" > "$NGINX_CONF"; rm -f "$saved"
    printf '%s\n' "$out" >&2
    die "nginx fails its test without our line, so something else is wrong in $NGINX_CONF. Put it back as it was; nothing removed."
  fi
else
  echo "  not there"
fi
if [[ -f $NGINX_CONF.bak-stokvel ]]; then
  # blank lines aside (older setup.sh runs added one before the include)
  if diff -q <(grep -v '^[[:space:]]*$' "$NGINX_CONF") <(grep -v '^[[:space:]]*$' "$NGINX_CONF.bak-stokvel") >/dev/null; then
    # nothing else changed since, so put it back byte for byte (in place; same content to nginx)
    cat "$NGINX_CONF.bak-stokvel" > "$NGINX_CONF"
    echo "  $NGINX_CONF is byte for byte as it was before the talk"
  else
    echo "  note: $NGINX_CONF differs from before the talk in other places too (DataBrew edits since?). Left as it is."
  fi
  rm -f "$NGINX_CONF.bak-stokvel"
fi

step "certificate and our nginx files"
if [[ -d /etc/letsencrypt/live/$DOMAIN ]]; then certbot delete --cert-name "$DOMAIN" --non-interactive -q && echo "  $DOMAIN certificate deleted"; else echo "  no certificate"; fi
rm -rf "$SITE" && echo "  $SITE removed"

# ---------------------------------------------------------------- services
step "services"
for u in "${UNITS[@]}"; do
  systemctl disable --now "$u" >/dev/null 2>&1 || true
  rm -rf "/etc/systemd/system/$u.service" "/etc/systemd/system/$u.service.d"
done
systemctl daemon-reload
systemctl reset-failed "${UNITS[@]}" >/dev/null 2>&1 || true
echo "  stopped and removed: ${UNITS[*]}"

# ---------------------------------------------------------------- swap, should a build have been interrupted
if [[ -f $SWAP ]]; then swapoff "$SWAP" 2>/dev/null; rm -f "$SWAP"; echo "  leftover $SWAP removed"; fi

# ---------------------------------------------------------------- Node, only if setup.sh installed it
step "Node.js"
if [[ -f $ETC/.we-installed-node ]]; then
  # nodejs, and the helper packages NodeSource's installer added (listed in the marker by setup.sh)
  mapfile -t extra < <(grep -vE '^\s*$' "$ETC/.we-installed-node")
  DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq nodejs "${extra[@]}" >/dev/null
  rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/sources.list.d/nodesource.sources \
        /etc/apt/keyrings/nodesource.gpg /usr/share/keyrings/nodesource.gpg /etc/apt/preferences.d/nodejs
  apt-get update -qq >/dev/null 2>&1 || true
  echo "  nodejs and the NodeSource repository removed"
else
  echo "  not installed by setup.sh, left alone"
fi

# ---------------------------------------------------------------- code, keys, user
step "code, keys and the stokvel user"
rm -rf "$APP" "$ETC" /var/lib/stokvel
id stokvel >/dev/null 2>&1 && userdel stokvel
echo "  $APP, $ETC (RPC and relayer keys), /var/lib/stokvel and the user removed"

# ---------------------------------------------------------------- did we disturb anyone?
step "neighbours"
sleep 2
worse=0
while read -r code url; do
  printf '  %-28s %s → %s\n' "${url#https://}" "${before[$url]}" "$code"
  [[ ${before[$url]} == 200 && $code != 200 ]] && worse=1
done < <(neighbours)
[[ $worse -eq 0 ]] || die "a neighbour stopped answering 200; check docker ps and docker logs $NGINX_CTR"

leftover=$(ls -d "$APP" "$ETC" "$SITE" /etc/systemd/system/stokvel-* "/etc/letsencrypt/live/$DOMAIN" 2>/dev/null; id stokvel 2>/dev/null; grep -F "$MARK" "$NGINX_CONF")
[[ -z $leftover ]] || die "still here: $leftover"
cat <<EOF

  The talk is off this server. Still to do, elsewhere:
    - Squarespace DNS: delete the 'stokvel' A record
    - if you made an RPC provider or Basescan key, delete it
    - your laptop: deploy/netcup/README.md, "After the talk"
EOF
