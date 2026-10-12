# The talk on the netcup server, and taking it off again

The netcup vServer (152.53.135.28, Debian 13, ssh alias `floati`) already serves three live sites
through DataBrew's nginx container: databrew.works, floati.life and redlineclause.com. This plan
puts the talk on it at **`https://stokvel.nevvy.studio`** without touching any of them, and
removes every trace after the talk with one script.

`nevvy.studio` itself points at Squarespace and stays that way. Only the `stokvel` subdomain is
used.

**The chain is the talk's own.** With `CHAIN_ID=31337` the server runs Anvil next to the other
services, the same chain `./scripts/demo.sh --mock` runs on your laptop. No faucet, no accounts,
no public network, and "Skip to month end" really moves the clock, so nothing has to be timed to
the minute. The trade-off is the one `deploy/README.md` names: there's no public explorer to
check it on, so it explains the technology rather than proving it to the room. (Base Sepolia
still works with these scripts: `CHAIN_ID=84532`, see the end of this file.)

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
| `/etc/stokvel/stokvel.env` | chain id, RPC, spare card's address (chmod 600) |
| user `stokvel` | system user the services run as |
| `/etc/systemd/system/stokvel-{stage,relayer,mock}.service` (+ `.d/netcup.conf`) | the three services, bound to `172.18.0.1` |
| `/etc/systemd/system/stokvel-anvil.service`, `/opt/stokvel/.foundry`, `/var/lib/stokvel/anvil.json` | the chain: Anvil on `127.0.0.1:8545`, its binary, its state file |
| `/etc/letsencrypt/stokvel/site.conf` | our nginx server block (this folder is already mounted into the nginx container, so no new mount) |
| `/etc/letsencrypt/{live,archive,renewal}/stokvel.nevvy.studio*` | the certificate |
| one line in `/opt/DataBrew/nginx/nginx.conf` | `include /etc/letsencrypt/stokvel/site.conf;  # stokvel-talk: remove after the talk` |
| `/opt/DataBrew/nginx/nginx.conf.bak-stokvel` | the file as it was before that line |
| `nodejs` apt package + `/etc/apt/sources.list.d/nodesource.list` | Node 22 (nothing else on the host uses Node; the sites run in Docker) |

| Elsewhere | What |
|---|---|
| Squarespace DNS | `A stokvel → 152.53.135.28` (no AAAA: the 443 blocks on this nginx are IPv4) |
| This laptop | this repo, `cards/out/` (card keys, gitignored), Foundry |

Nothing on any public chain, and no accounts anywhere.

## How the traffic flows

```
phone / projector ─▶ stokvel.nevvy.studio:443 ─▶ databrew-nginx-1 (container)
                                                   │ server_name stokvel.nevvy.studio
                                                   ├─▶ 172.18.0.1:3000  stage app   (systemd)
                                                   ├─▶ 172.18.0.1:4000  relayer     (systemd) ─┐
                                                   └─▶ 172.18.0.1:4100  mock bank   (systemd)  │
                                         stage's /api/rpc (reads only) ─▶ 127.0.0.1:8545 Anvil ◀┘
```

`172.18.0.1` is the host's address on the `databrew_backend` Docker network, the same way
nginx already reaches floati on `172.18.0.1:8001`. Services bound there are reachable by the
nginx container but not from the internet, so no firewall change is needed. The server block
copies `deploy/Caddyfile`: the same paths. There are no logins: the run sheet on the projector
page pulls the levers, and the card keys are never on the server.

## Resources

2 vCPU, 3.8 GB RAM with ~1.9 GB available, 19 GB disk free. Running, the four services need
about 450 MB (Anvil about 40 MB; `MemoryMax=700M` caps it, and `--prune-history` keeps it flat). The `next build` peaks around 1 to 1.5 GB, so the setup script adds a 2 GB
`/swapfile-stokvel` for the build and removes it right after. The talk's traffic (a room of
phones polling every 1 to 3 s) is small next to the existing sites.

## Files here

| File | Does |
|---|---|
| [`setup.sh`](setup.sh) | the parts of `deploy/setup.sh` that are safe here (Node, clone, user, env file, build, systemd), plus temporary swap for the build, the systemd drop-ins that bind to `172.18.0.1`, and the nginx include. HTTP-only block first, then a certbot dry run, the real certificate, and the full HTTPS block. If `nginx -t` fails it takes our line out again; if databrew.works, floati.life or redlineclause.com stop answering 200 it does the same. `--no-nginx` stops after the services, with nothing public |
| [`nginx-http.conf`](nginx-http.conf), [`nginx-https.conf`](nginx-https.conf) | our server blocks: the challenge and redirect; then `deploy/Caddyfile`'s routing with `auth_basic` |
| [`arm.sh`](arm.sh) | from your laptop: a fresh chain on the server, the contract deployed through an SSH tunnel (the card keys stay on the laptop), the run sheet's months seeded, and `check.sh` |
| [`stokvel-anvil.service`](stokvel-anvil.service) | the chain |
| [`teardown.sh`](teardown.sh) | removes everything in the table above, nginx line first, then re-checks the three sites and lists anything left over. Safe to rerun |

`deploy/check.sh` works unchanged against `https://stokvel.nevvy.studio`.

Two details that matter on this server: DataBrew's `nginx.conf` reaches the container through a
single-file bind mount, so both scripts write it in place (an editor or `sed -i` that saves a new
file would leave nginx on the old one); and the services find each other on `172.18.0.1` too
(`INVESTEC_BASE_URL`, `RELAYER_WEBHOOK_URL` in the drop-ins), since nothing listens on `127.0.0.1`.

## Runbook

1. **DNS** (done 2026-10-12): Squarespace → Domains → nevvy.studio → DNS → `A`, host `stokvel`,
   data `152.53.135.28`, TTL 5 min.
2. **Laptop:** Foundry (done), and the cards once (done 2026-10-12, `cards/out/`; never rerun
   `generate.py`, it makes new keys). Back up `cards/out/` outside the repo, print `cards.pdf`.
3. **Server** (done 2026-10-12), `ssh floati`:

   ```bash
   git clone https://github.com/Nevvyboi/StokvelProgrammableBankingWithSolidity.git /opt/stokvel
   /opt/stokvel/deploy/netcup/setup.sh     # creates /etc/stokvel/stokvel.env and stops
   nano /etc/stokvel/stokvel.env           # RPC_URL=http://127.0.0.1:8545, CHAIN_ID=31337, SPARE_ADDRESS
   /opt/stokvel/deploy/netcup/setup.sh
   ```

   `SPARE_ADDRESS` is in `cards/out/talk-secrets.env`. The relayer's
   keys stay empty: on Anvil it uses Anvil's funded accounts. Updating later: push, then
   `git -C /opt/stokvel pull` and `setup.sh` again.
4. **Arm**, from the laptop, the day before the talk and after every rehearsal:

   ```bash
   ./deploy/netcup/arm.sh            # fresh chain, contract, two settled months, mid-month round
   ```

   It ends with `check.sh`; every line should say `ok`.
5. **QR:** `brew install qrencode && ./deploy/qr.sh https://stokvel.nevvy.studio`.
6. **Rehearse** the whole run sheet against the server, including DEMO 9 (stop the relayer), then
   arm again.

**On the day:** `arm.sh` in the morning, no pushes. Local `./scripts/demo.sh --mock` open as the
fallback tab.

## After the talk: take it all off

1. **Server:** `ssh -t floati /opt/stokvel/deploy/netcup/teardown.sh`. It stops and deletes the
   services, removes the include line (and checks the file matches the `.bak-stokvel` copy apart
   from that line), reloads nginx, deletes the certificate (`certbot delete --cert-name
   stokvel.nevvy.studio`), `/etc/letsencrypt/stokvel`, `/etc/stokvel`, `/opt/stokvel`, the
   `stokvel` user, the chain, Node and the NodeSource list, and confirms databrew.works, floati.life and
   redlineclause.com still return 200.
2. **DNS:** delete the `stokvel` A record in Squarespace.
3. **Keys:** the card keys are burned (they've been on stage). Never
   reuse them; there's nothing to recover from them.
4. **This laptop:** make sure everything worth keeping is pushed to GitHub, then delete
   `cards/out/` and this folder (`~/Coding/StokvelProgrammableBankingWithSolidity`). Optionally
   `foundryup --uninstall` / `rm -rf ~/.foundry`.

## Base Sepolia instead

The scripts still do the public-chain version: `CHAIN_ID=84532`, an `RPC_URL` that serves
`eth_getLogs` over the whole range (on 2026-10-12 the public `https://base-sepolia.gateway.tenderly.co`
did; `sepolia.base.org` caps it at 200 blocks), funded `RELAYER_PK` and `ATTESTOR_PK`, and the
contract deployed and committed as `contracts/deployments/84532.json` (`deploy/README.md`, step 5;
`--verify --verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/` needs no
key). The first month end is then fixed at deploy time, and the timelock waits in real time.
