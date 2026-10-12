# Hosting the talk on your own server and domain

This folder puts the whole demo on a small server behind your own domain. The projector, the
signing station, your presenter panel and the audience's phones all reach it over HTTPS. It
doesn't matter whether the room is on venue Wi-Fi or mobile data.

```
 Audience phones ─┐
 Projector laptop ┼─ https://stokvel.yourdomain.com ─▶ Caddy ─┬─▶ stage app   127.0.0.1:3000
 Signing station ─┤      (the only open door)                 ├─▶ relayer     127.0.0.1:4000 ─▶ Base Sepolia
 You (presenter) ─┘      /presenter needs a password          └─▶ mock bank   127.0.0.1:4100
```

| Address | Who opens it | Open to |
|---|---|---|
| `https://<domain>/` | the projector | everyone |
| `https://<domain>/watch` | the audience's phones, from the QR (`qr.sh`) | everyone |
| `https://<domain>/sign` | the signing station laptop | everyone (the key never leaves the page) |
| `https://<domain>/presenter` | you, on your second screen | **password** |

**Why Base Sepolia and not Anvil on the server.** The talk's promise is "you don't have to take my
word for any of this." A private chain on your own server is a database you control, so the room
would have to take your word for it. On Base Sepolia, every line on `/watch` links to Basescan,
and nobody has to trust your server. The cost is real time: month end happens at a time you choose
in advance, and votes wait out the actual timelock (step 5 keeps both short).

## What's public and what isn't

The stage app, the relayer and the mock bank listen on `127.0.0.1` only, and the firewall allows
only SSH, HTTP and HTTPS. Everything reaches them through Caddy, so [`Caddyfile`](Caddyfile) is the
whole public surface:

| Path | Public? | Why |
|---|---|---|
| `/`, `/watch`, `/sign`, `/api/config` | yes | the pages themselves |
| `/api/rpc` | yes, **read only** | browsers read the chain through the server. Only reads of the two Stokvel contracts are forwarded: no transactions, no calls to other contracts. Your RPC provider key stays on the server |
| `/relayer/feed`, `/bank`, `/health`, `/nonce/*` | yes | what the screens read |
| `/relayer/join`, `/relayer/votes` | yes | a member's signature. The contract decides if it's valid; a bad one fails before any gas is spent |
| `/presenter`, `/relayer/admin/*`, `/relayer/propose`, `/relayer/execute`, `/relayer/webhook/*`, `/mock/*` | **password** | the levers: steal, swipe, skip, propose, kill. Without the password, someone in the room could run your demos for you |
| `/api/keys` | **never** | the card keys are not on the server at all, and the route is off (`DEMO_MODE=false`) |

[`check.sh`](check.sh) tests every row of this table from the outside. Run it after every change.

## What you need

| | Notes | Cost |
|---|---|---|
| A domain you control | a subdomain such as `stokvel.yourdomain.co.za` is fine | what you already pay |
| A small Linux server | Ubuntu 24.04, 1 vCPU, **2 GB RAM** (the Next.js build fails on 1 GB) | about US$6 to 12 a month; delete it after the talk |
| An RPC provider key for Base Sepolia | Alchemy, QuickNode, Infura... The free tier is enough, but see step 5 | free |
| Three throwaway keys with Base Sepolia ETH | deployer, relayer, attestor. A few hundredths of an ETH | free (faucet) |
| The printed cards | `cards/generate.py`, **before** you deploy | print shop |
| Your laptop with Foundry and Node 20+ | for the deploy and the checks | |

Allow an evening the first time, and do it at least a week before the talk. DNS and certificates
are quick until they aren't.

---

## 1. Pick the name

Choose the address the room will type or scan, for example `stokvel.yourdomain.co.za`. Keep it
short: it goes on a slide. The rest of this guide calls it `<domain>`.

## 2. Rent the server

Any provider works. Create a server with:

- **Ubuntu 24.04 LTS**, at least **2 GB RAM**.
- **Region:** Johannesburg if your provider has it (Vultr, Azure, AWS af-south-1). Otherwise
  Europe is fine: the screens refresh every 1 to 3 seconds, and 150 ms of latency doesn't show.
- **Your SSH key** added at creation, so the server never needs a password login.

Write down the server's **IPv4** address, and its IPv6 address if it has one.

Log in once to make sure it works:

```bash
ssh root@<server-ip>
```

Check that password logins are off (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, or in a
file under `/etc/ssh/sshd_config.d/`). Most providers set this when you add a key; if yours
didn't, change it and run `systemctl restart ssh`.

## 3. Point the name at the server (DNS)

At whoever runs DNS for your domain (your registrar, Cloudflare, ...), add:

| Type | Name | Value | TTL |
|---|---|---|---|
| `A` | `stokvel` (the subdomain part) | `<server IPv4>` | 300 (5 minutes) |
| `AAAA` | `stokvel` | `<server IPv6>`, only if the server has one | 300 |

- **Cloudflare:** set the record to **DNS only** (grey cloud), not Proxied. Caddy gets its own
  certificate directly, and the orange-cloud proxy adds a hop and a second TLS setup you don't
  need for a 25-minute talk.
- A short TTL means that if you have to move servers on the day, the change spreads in minutes.
- Only add `AAAA` if IPv6 actually works on the server. A wrong `AAAA` record breaks phones on
  IPv6 networks, which includes most mobile data.

Check from your laptop, and wait until both show the server's address:

```bash
dig +short <domain>          # the IPv4
dig +short AAAA <domain>     # the IPv6, or nothing
```

**Don't go on to step 6 until this resolves.** Caddy requests the certificate as soon as it
starts, and Let's Encrypt only allows a few failed attempts per hour per name.

## 4. Generate the cards (if you haven't)

The contract's members are the printed keys, so the cards come first. On your laptop:

```bash
cd cards && pip install -r requirements.txt && python3 generate.py && cd ..
```

This writes `cards/out/` (gitignored, keep a backup): `cards.pdf` for the printer, `keys.json`, and
`members.json` for the deploy. **Generate once.** Every run makes new keys, and cards printed
before a rerun stop working.

## 5. Deploy the contract to Base Sepolia (from your laptop)

The full detail is in [`docs/DEPLOY.md`](../docs/DEPLOY.md). For the server, these are the choices
that matter:

```bash
export BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/<your key>
export DEPLOYER_PK=0x...                       # throwaway, funded
export RELAYER=0x...  ATTESTOR=0x...           # the addresses of the other two throwaway keys
export MEMBERS_FILE=../cards/out/members.json
export FIRST_ROUND_ENDS_AT=$(date -d "2026-11-26 18:12 SAST" +%s)   # about 12 min into your slot
export TIMELOCK=30                             # say "48 hours in real life" on stage

cd contracts
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast \
  --private-key $DEPLOYER_PK --verify --etherscan-api-key $BASESCAN_API_KEY
```

- **`FIRST_ROUND_ENDS_AT`** is when DEMO 3's month ends. Time can't be skipped on a public chain,
  so this is the minute "Skip to month end" really happens. Put it a few minutes before DEMO 3's
  slot on the run sheet. If you overrun, the payout simply waits for you.
- **`TIMELOCK`** sets how long DEMO 7 and DEMO 8 wait after the fourth vote. It's fixed at deploy
  time. The default 120 seconds is four minutes of dead air across two demos; 30 seconds is enough
  to make the point.
- **Don't run `DemoState.s.sol join()`.** Signing the constitution is DEMO 1. If the members are
  already signed in, the volunteers' cards show "Nothing to sign".
- **`--verify`** makes the contract source readable on Basescan, which is part of the
  "check it yourself" story. It needs a free Basescan API key.

Then **commit `contracts/deployments/84532.json` and push it** to the branch the server will run
(`main` by default). The server reads the contract address from that file.

**About the RPC key:** on first load, the dashboard reads every event since the deploy block in a
single `eth_getLogs` call. Some free plans limit how many blocks one call can cover. `check.sh`
tests exactly this. If it fails, deploy closer to the talk (fewer blocks to cover) or use a plan
without the limit. Find out now, not on stage.

## 6. Set up the server

On the server, as root:

```bash
curl -fsSL https://raw.githubusercontent.com/Nevvyboi/StokvelProgrammableBankingWithSolidity/main/deploy/setup.sh | bash
```

(To run a branch other than `main`, prefix it: `BRANCH=my-branch bash`.) The first run installs
Node 22, Caddy and the firewall, clones the repo to `/opt/stokvel`, creates two config files, and
stops so you can fill them in:

```bash
nano /etc/stokvel/stokvel.env      # RPC_URL, RELAYER_PK, ATTESTOR_PK, SPARE_ADDRESS
caddy hash-password                # type the presenter password, copy the $2a$... line
nano /etc/stokvel/caddy.env        # STOKVEL_DOMAIN, ACME_EMAIL, PRESENTER_USER, PRESENTER_HASH
```

- `RELAYER_PK` and `ATTESTOR_PK` are the throwaway keys behind the `RELAYER` and `ATTESTOR`
  addresses you deployed with. They need a little Base Sepolia ETH: the relayer pays the gas for
  every member's signature.
- `SPARE_ADDRESS` is card 06b's address, from `cards/out/members.json` under `"spares"`. DEMO 8
  proposes moving Sipho to it.
- Both files are `chmod 600`, readable by root only. They never go in the repo.

Then run the script again. This time it builds everything and starts the services:

```bash
/opt/stokvel/deploy/setup.sh
```

It refuses to start if anything is still empty or a placeholder, and it validates the Caddyfile
before reloading, so a typo can't take the site down. The first HTTPS request may take a few
seconds while Caddy fetches the certificate.

## 7. Check it from outside

From your laptop, ideally on your phone's hotspot so you're outside any network the server
trusts:

```bash
PRESENTER_USER=presenter PRESENTER_PASS='<the password>' ./deploy/check.sh https://<domain>
```

Every line should say `ok`: public pages open, presenter routes asking for a password, the chain
reading through the proxy (including the full event history), transactions refused, HTTP
redirecting to HTTPS, and the internal ports closed. Then open `https://<domain>/watch` on your
phone, on mobile data.

## 8. The QR code for the room

```bash
./deploy/qr.sh https://<domain>         # writes deploy/watch-qr.png
```

Put it on the slide you show during DEMO 1 ("scan the QR on the screen"), and print a copy for the
lectern. The deck doesn't have one yet: the QR on the closing slide is the repo link.

## 9. On the day

| Device | Opens | Notes |
|---|---|---|
| Projector laptop | `https://<domain>/` | full screen, extended display (not mirrored) |
| Signing station | `https://<domain>/sign` | USB scanner, or the webcam (which works because the site is HTTPS) |
| Your second screen | `https://<domain>/presenter` | log in once. Never on the projector |
| Phones | the QR | read only |

What's different from a local `demo.sh` run:

- **Members sign with their cards at `/sign`.** The card keys are never on the server, so the
  presenter panel has no "Lerato signs" buttons. That's deliberate: the old fallback keys aren't
  members on Base Sepolia and would only put a REFUSED stamp on the projector. If a card won't
  scan, type its key into the paste box on `/sign`.
- **DEMO 3:** the round ends at `FIRST_ROUND_ENDS_AT`. "Skip to month end" can't move time. Say
  when it ends and come back to it.
- **DEMO 7 and 8:** the Execute button counts down the real timelock.
- **DEMO 9:** "Stop the relayer" works the same: systemd restarts it after 3 seconds.
- **Your laptop needs internet.** Use your own hotspot, not the venue's Wi-Fi.
- **Fallback:** have `./scripts/demo.sh --mock` already running on the presenter laptop, with
  `http://localhost:3000/?fallback=1` open in a tab. If the server or the network dies, you switch
  tabs, not machines ([`talk/FALLBACK.md`](../talk/FALLBACK.md)).

Run `check.sh` once more an hour before. Don't push changes to the server on the day.

## Updating

Push to the branch, then on the server:

```bash
/opt/stokvel/deploy/setup.sh
```

It pulls, rebuilds and restarts, and it throws away any local edits on the server (the repo is the
source of truth). After a redeploy of the contract, commit the new `deployments/84532.json` first.

## When something's wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser: certificate error, or the site never loads | DNS isn't pointing here yet, port 80 is blocked, or Cloudflare is proxying | `dig +short <domain>`; `journalctl -u caddy -n 50`; set the record to DNS only |
| `502 Bad Gateway` | a service is down | `systemctl status stokvel-stage stokvel-relayer stokvel-mock`; `journalctl -u stokvel-relayer -n 100` |
| Projector says `chain down` | the RPC key is wrong, or its plan caps `eth_getLogs` | `check.sh` names which; `journalctl -u stokvel-stage` |
| Projector says `relayer down` | relayer crashed or is restarting | `journalctl -u stokvel-relayer -f` |
| Relayer log: `insufficient funds` | the relayer or attestor key ran out of Base Sepolia ETH | top it up from a faucet |
| Presenter asks for the password on every click | the browser didn't keep the login | log in on `/presenter` itself first; use a normal (not private) window |
| `/sign`: "Not a member" for a real card | the contract was deployed without `MEMBERS_FILE=../cards/out/members.json`, or the cards were regenerated after printing | redeploy with the printed cards' `members.json` |
| DEMO 8's propose button logs "no card 06b" | `SPARE_ADDRESS` is empty | set it in `stokvel.env`, run `setup.sh` |

Logs: `journalctl -u <service> -f` for `stokvel-stage`, `stokvel-relayer`, `stokvel-mock`, `caddy`.

## After the talk

- Stop it: `systemctl disable --now stokvel-stage stokvel-relayer stokvel-mock caddy`, or delete
  the server. It's billed until you do.
- Delete or revoke the RPC provider key.
- The card keys, relayer key and attestor key are burned: they've been on stage and in
  photographs. Never reuse them.
- Remove the DNS record, or point it somewhere else.

## Files here

| File | What it is |
|---|---|
| [`setup.sh`](setup.sh) | installs, configures, updates; safe to rerun |
| [`check.sh`](check.sh) | the outside-in test of what's public and what isn't |
| [`qr.sh`](qr.sh) | the `/watch` QR for the slide |
| [`Caddyfile`](Caddyfile) | HTTPS, the presenter password, and the routing |
| [`systemd/`](systemd/) | the services: stage, relayer, mock bank, sandbox overlay, Caddy's env |
| [`stokvel.env.example`](stokvel.env.example), [`caddy.env.example`](caddy.env.example) | the two config files `setup.sh` copies to `/etc/stokvel/` |

**Real Investec sandbox instead of the mock bank:** set `INVESTEC_MODE=sandbox` and the
`INVESTEC_*` values from [`relayer/README.md`](../relayer/README.md) in `stokvel.env`. `setup.sh`
then runs the sandbox overlay instead of the mock. The "steal" and "swipe" buttons are mock-only
levers; rehearse the sandbox path separately.
