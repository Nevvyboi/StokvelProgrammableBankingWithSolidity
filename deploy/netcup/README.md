# The talk on the netcup server, and taking it off again

The netcup vServer (152.53.135.28, Debian 13, ssh alias `floati`) already serves three live sites
through DataBrew's nginx container: databrew.works, floati.life and redlineclause.com. This plan
puts the talk on it at **`https://stokvel.nevvy.studio`** without touching any of them, and
removes every trace after the talk with one script.

`nevvy.studio` itself points at Squarespace and stays that way. Only the `stokvel` subdomain is
used.

## The rule: nothing shared changes

| Shared thing | What we do | What we never do |
|---|---|---|
| DataBrew's nginx | add **one marked line** to `/opt/DataBrew/nginx/nginx.conf` that includes our own file; `nginx -t`, then `nginx -s reload` (no restart, no dropped connections) | edit their server blocks, `git checkout` the file (it has uncommitted edits), restart or recreate the container |
| Docker | nothing | add containers, networks, volumes or mounts |
| Firewall | nothing (ufw stays inactive) | `ufw enable`: `deploy/setup.sh` does this, which is why we don't run it here |
| Ports 80/443 | stay nginx's | install Caddy |
| certbot | one more certificate under its own name, using the same webroot and the existing reload hook | touch the other certificates |
| RAM | temporary swap only while building, removed straight after | leave swap or `/etc/fstab` changes behind |

## Everything the talk adds (and therefore everything teardown removes)

| On the server | What |
|---|---|
| `/opt/stokvel` | the repo checkout and its `node_modules`, `.next` |
| `/etc/stokvel/stokvel.env` | RPC key, relayer and attestor keys (chmod 600) |
| user `stokvel` | system user the services run as |
| `/etc/systemd/system/stokvel-{stage,relayer,mock}.service` (+ `.d/netcup.conf`) | the three services, bound to `172.18.0.1` |
| `/etc/letsencrypt/stokvel/site.conf`, `htpasswd` | our nginx server block and the presenter login (this folder is already mounted into the nginx container, so no new mount) |
| `/etc/letsencrypt/{live,archive,renewal}/stokvel.nevvy.studio*` | the certificate |
| one line in `/opt/DataBrew/nginx/nginx.conf` | `include /etc/letsencrypt/stokvel/site.conf;  # stokvel-talk: remove after the talk` |
| `/opt/DataBrew/nginx/nginx.conf.bak-stokvel` | the file as it was before that line |
| `nodejs` apt package + `/etc/apt/sources.list.d/nodesource.list` | Node 22 (nothing else on the host uses Node; the sites run in Docker) |

| Elsewhere | What |
|---|---|
| Squarespace DNS | `A stokvel → 152.53.135.28` (no AAAA: the 443 blocks on this nginx are IPv4) |
| Base Sepolia | the contract (stays on chain forever; that's fine, it's a testnet) |
| RPC provider, Basescan | one API key each |
| This laptop | this repo, `cards/out/` (card keys, gitignored), Foundry |

## How the traffic flows

```
phone / projector ─▶ stokvel.nevvy.studio:443 ─▶ databrew-nginx-1 (container)
                                                   │ server_name stokvel.nevvy.studio
                                                   │   /presenter, /relayer/admin/*, /mock/* … → auth_basic
                                                   ├─▶ 172.18.0.1:3000  stage app   (systemd)
                                                   ├─▶ 172.18.0.1:4000  relayer     (systemd) ─▶ Base Sepolia
                                                   └─▶ 172.18.0.1:4100  mock bank   (systemd)
```

`172.18.0.1` is the host's address on the `databrew_backend` Docker network, the same way
nginx already reaches floati on `172.18.0.1:8001`. Services bound there are reachable by the
nginx container but not from the internet, so no firewall change is needed. The server block
copies `deploy/Caddyfile` exactly: the same public paths, the same password-protected levers.

## Resources

2 vCPU, 3.8 GB RAM with ~1.9 GB available, 19 GB disk free. Running, the three services need
about 400 MB. The `next build` peaks around 1 to 1.5 GB, so the setup script adds a 2 GB
`/swapfile-stokvel` for the build and removes it right after. The talk's traffic (a room of
phones polling every 1 to 3 s) is small next to the existing sites.

## Files here

| File | Does |
|---|---|
| [`setup.sh`](setup.sh) | the parts of `deploy/setup.sh` that are safe here (Node, clone, user, env file, build, systemd), plus temporary swap for the build, the systemd drop-ins that bind to `172.18.0.1`, and the nginx include. HTTP-only block first, then a certbot dry run, the real certificate, and the full HTTPS block. If `nginx -t` fails it takes our line out again; if databrew.works, floati.life or redlineclause.com stop answering 200 it does the same. `--no-nginx` stops after the services, with nothing public |
| [`nginx-http.conf`](nginx-http.conf), [`nginx-https.conf`](nginx-https.conf) | our server blocks: the challenge and redirect; then `deploy/Caddyfile`'s routing with `auth_basic` |
| [`teardown.sh`](teardown.sh) | removes everything in the table above, nginx line first, then re-checks the three sites and lists anything left over. Safe to rerun |

`deploy/check.sh` works unchanged against `https://stokvel.nevvy.studio`.

Two details that matter on this server: DataBrew's `nginx.conf` reaches the container through a
single-file bind mount, so both scripts write it in place (an editor or `sed -i` that saves a new
file would leave nginx on the old one); and the services find each other on `172.18.0.1` too
(`INVESTEC_BASE_URL`, `RELAYER_WEBHOOK_URL` in the drop-ins), since nothing listens on `127.0.0.1`.

## Runbook

**At least a week before the talk**

1. **DNS:** Squarespace → Domains → nevvy.studio → DNS → add `A`, host `stokvel`, data
   `152.53.135.28`, TTL 5 min. Wait for `dig +short stokvel.nevvy.studio` to show the IP.
2. **Laptop tools:** `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
3. **Cards (once):** `cd cards && pip install -r requirements.txt && python3 generate.py`. Back up
   `cards/out/` somewhere outside the repo; send `cards.pdf` to print.
4. **Keys:** three throwaway keys (deployer, relayer, attestor) from a Base Sepolia faucet; an
   Alchemy (or similar) Base Sepolia key; a Basescan API key.
5. **Deploy the contract** (`deploy/README.md` step 5, with `TIMELOCK=30` and
   `FIRST_ROUND_ENDS_AT` from `TZ=Africa/Johannesburg date -j -f "%Y-%m-%d %H:%M" "<talk date> <time>" +%s`).
   Commit and push `contracts/deployments/84532.json`.
6. **Server:** `ssh floati`, then:

   ```bash
   git clone https://github.com/Nevvyboi/StokvelProgrammableBankingWithSolidity.git /opt/stokvel
   /opt/stokvel/deploy/netcup/setup.sh          # creates /etc/stokvel/stokvel.env and stops
   nano /etc/stokvel/stokvel.env                # RPC_URL, RELAYER_PK, ATTESTOR_PK, SPARE_ADDRESS
   /opt/stokvel/deploy/netcup/setup.sh          # builds, starts, asks for the presenter password
   ```

   Until this branch is merged, put `BRANCH=deploy/netcup` in front of the setup commands and add
   `--branch deploy/netcup` to the clone. Updating later: push, then run `setup.sh` again.
7. **Check:** `PRESENTER_USER=presenter PRESENTER_PASS=… ./deploy/check.sh https://stokvel.nevvy.studio`
   from your phone's hotspot. Then open `/watch` on your phone over mobile data.
8. **QR:** `brew install qrencode && ./deploy/qr.sh https://stokvel.nevvy.studio`.
9. **Rehearse** the whole run sheet against the server once, including DEMO 9 (stop the relayer).

**On the day:** `check.sh` an hour before. No pushes. Local `./scripts/demo.sh --mock` open as
the fallback tab.

## After the talk: take it all off

1. **Server:** `ssh -t floati /opt/stokvel/deploy/netcup/teardown.sh`. It stops and deletes the
   services, removes the include line (and checks the file matches the `.bak-stokvel` copy apart
   from that line), reloads nginx, deletes the certificate (`certbot delete --cert-name
   stokvel.nevvy.studio`), `/etc/letsencrypt/stokvel`, `/etc/stokvel`, `/opt/stokvel`, the
   `stokvel` user, Node and the NodeSource list, and confirms databrew.works, floati.life and
   redlineclause.com still return 200.
2. **DNS:** delete the `stokvel` A record in Squarespace.
3. **Accounts:** delete the RPC provider key and the Basescan key.
4. **Keys:** the card, relayer, attestor and deployer keys are burned (they've been on stage). Never
   reuse them; there's nothing to recover from them.
5. **This laptop:** make sure everything worth keeping is pushed to GitHub, then delete
   `cards/out/` and this folder (`~/Coding/StokvelProgrammableBankingWithSolidity`). Optionally
   `foundryup --uninstall` / `rm -rf ~/.foundry`.
