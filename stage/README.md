# stage

The screens for the talk. Next.js, Tailwind, viem. Every page reads its truth from the contract
(state and events) and its colour from the relayer's feed. There is no database: kill the relayer
and the pages keep reading the chain.

| Route | Who sees it | What it is |
|---|---|---|
| `/` | the projector | The treasurer's book, kept in public. Left page: the Investec statement. Right page: the rulebook, with the pot, the auditor's reconciliation of reserves, the roster in rotation order, and the quilt. Bottom: the minute book of messages crossing between bank and chain. `FROZEN` and `REFUSED` stamp the whole screen red when the contract says no |
| `/sign` | the signing station laptop | Scan a member card (USB scanner or webcam), read the EIP-712 message as one English sentence on a paper slip, press Sign. The key is dropped from memory afterwards and never leaves the page |
| `/watch` | the room's phones | Read only passbook: pot, roster, quilt, and every event with a Basescan link. Never shows or accepts a key |
| `/presenter` | the presenter's second screen | One button per demo step, a log of every call, and the fallback toggle. Keep it off the projector |

## Run it

`scripts/demo.sh --mock` at the repo root starts everything. On its own:

```bash
cp .env.example .env.local   # optional, every value has a demo default
npm install
npm run dev                  # http://localhost:3000
```

Configuration is read at runtime from `/api/config` (env plus `contracts/deployments/<chainId>.json`),
so a redeploy needs no rebuild. For Base Sepolia set `CHAIN_ID=84532` and, if the deployment file is
elsewhere, `STOKVEL_ADDRESS`; the explorer links switch to Basescan on their own.

## The design

Not a dashboard. A ledger: ruled rows, tabular figures, a running balance, rubber stamps for state,
a pencil note in the margin for whose turn it is, and the quilt as fabric rather than decoration.
Space Grotesk for numerals and headings, Inter for sentences, JetBrains Mono for anything a bank
would print. Red is reserved for the contract saying no.

The quilt patch for member 03 here is drawn by the same code that draws it on the printed card and
in the deck: `lib/quilt.tsx` is the source, `cards/generate.py` and `slides/generator` port it.

## Fallback mode

If the chain or the relayer dies on stage, the presenter panel flips the dashboard to fallback mode
(or open `/?fallback=1`). It loads `public/fallback/snapshot.json`, a capture of the seeded state,
and the presenter steps through `public/fallback/script.json`, which replays every demo as feed
lines, ledger changes and stamps. `scripts/fallback-snapshot.mjs` recaptures the snapshot from a
running stack.

## Screenshots

`scripts/screenshots.mjs` drives the running stack with Playwright and captures every state in
`assets/screenshots/`.
