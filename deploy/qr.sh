#!/usr/bin/env bash
# The QR the room scans in DEMO 1 ("scan the QR on the screen"): your domain's /watch page.
# Put the PNG on the slide you show during DEMO 1, and print one for the lectern.
#
#   ./deploy/qr.sh https://stokvel.example.com          -> deploy/watch-qr.png
set -euo pipefail
BASE=${1:?usage: deploy/qr.sh https://your.domain}
cd "$(dirname "$0")/.."
[[ -x stage/node_modules/.bin/qrcode ]] || npm --prefix stage ci --no-audit --no-fund --loglevel=error
# dark on light, quiet zone of 4: the projector washes out a dark-mode QR at the back of the room
stage/node_modules/.bin/qrcode -o deploy/watch-qr.png -w 1200 -q 4 -e M -d 0B1426FF -l FFFFFFFF "${BASE%/}/watch" >/dev/null
echo "deploy/watch-qr.png -> ${BASE%/}/watch"
