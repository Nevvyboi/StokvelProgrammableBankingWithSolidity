# relayer

The messenger between an Investec account and the Stokvel contract. It carries facts in both
directions and makes no decisions: it can't pick a recipient, can't invent reserves, and nothing it
sends is accepted twice.

Four loops, all idempotent, all logged:

| Loop | Direction | What it does |
|---|---|---|
| Contributions | bank to chain | Polls the stokvel account's transactions, finds credits with an `STK-nn` reference, calls `recordContribution(memberId, cents, keccak256(txId))`. Asks the contract `seen(ref)` first; the contract refuses repeats anyway |
| Reserves | bank to chain | Every 20 seconds (5 minutes outside demo mode) reads the balance, signs `Reserves(cents, at)` with the **attestor** key (EIP-712), calls `postReserves`. `at` is the latest block's timestamp |
| Payouts | chain to bank | Calls `closeRound()` when the round is over and reserves are fresh. For each `PayoutDue`, pays the member with `paymultiple` (or `transfermultiple`), then `confirmPayout(round, beneficiaryId, keccak256(PaymentReferenceNumber))` |
| Votes | station to chain | `POST /votes` and `POST /join` take EIP-712 signatures from the signing station and pay the gas |

Plus a webhook (`POST /webhook/transaction`) the mock bank pushes to. It goes straight to the
contract without the `seen` check: the point of DEMO 5 is that the contract, not the relayer, is the
thing that says no.

No database. On restart it re-reads the bank and the chain and carries on.

## Run it

```bash
cp .env.example .env
npm install
npm run mock     # the stateful mirror of the Investec sandbox, port 4100
npm start        # the relayer, port 4000
```

`scripts/demo.sh --mock` at the repo root does all of that, plus Anvil, the deploy, the seeded state
and the stage app.

## Modes

`INVESTEC_MODE=mock` (default) talks to `src/mock`: same routes and response shapes as the sandbox,
backed by an in-memory ledger with the stokvel's pool account, the treasurer's personal account and
six saved beneficiaries. It also runs the real `card/main.js` on `POST /__mock/swipe`.

`INVESTEC_MODE=sandbox` talks to the real sandbox, `https://openapisandbox.investec.com`, with the
public sandbox credentials. **The sandbox is stateless**: a transfer returns a real
`PaymentReferenceNumber` and then nothing changes. So sandbox mode goes through `src/overlay`, the
sandbox overlay (`npm run overlay`, port 4200): a transparent proxy that forwards every call to the
sandbox unchanged and keeps one line per transfer the sandbox accepted, keyed by the sandbox's own
`PaymentReferenceNumber`. On the way back it folds those lines into the sandbox's balance,
transaction and beneficiary responses. Nothing is invented: a line exists only because the sandbox
said yes, the reference on the row is the sandbox's, and the sandbox's own rows come first and
untouched. The relayer and the card code point at the overlay and can't tell.

The presenter stories (`/__mock/credit`, `steal`, `refund`, `swipe`, `double-webhook`) exist on the
overlay too, and each one is a real sandbox transfer between the two sandbox accounts that play the
pool and the treasurer (`POOL_ACCOUNT_ID`, `TREASURER_ACCOUNT_ID`, default: the first two accounts
the sandbox lists). The overlay's file, `.demo/sandbox-overlay.json`, survives a restart, and
`POST /__mock/reset` empties it. `npm run smoke:sandbox` still prints a report straight from the
sandbox, and `INVESTEC_BASE_URL=https://openapisandbox.investec.com` bypasses the overlay.

Two things the owner has to do before a sandbox run: put real sandbox `beneficiaryId`s in
`MEMBERS_FILE` (the smoke report prints them; `members.example.json` carries the mock's) and deploy
with matching `beneficiaryHash`es. Details in [`docs/INVESTEC_API_NOTES.md`](../docs/INVESTEC_API_NOTES.md).

## Presenter routes

| Route | For |
|---|---|
| `POST /admin/warp {toRoundEnd:true}` | DEMO 3 on Anvil: move the clock to month end |
| `POST /admin/replay {transaction, target:"v1"\|"v2"}` | DEMO 5: push a transaction to V1 or V2 again |
| `POST /admin/tick` | run the reserves and payouts loops now |
| `POST /propose`, `POST /execute` | DEMO 7 and 8 |
| `GET /feed`, `GET /feed/stream` | the relayer's diary, for the dashboard's event feed |
| `GET /health` | mode, addresses, last poll |

Bank routes, on port 4100 (mock) or 4200 (overlay) under `/__mock`: `swipe`, `credit`, `steal`, `refund`,
`double-webhook`, `seed`, `reset`, `state`.

## Tests

```bash
npm test            # reference parsing, amounts, the mock bank's shapes, the card code
npm run test:e2e    # all 8 demos against a real Anvil and the mock bank, in process
```
