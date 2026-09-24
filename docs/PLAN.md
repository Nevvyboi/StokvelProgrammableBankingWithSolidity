# Build plan: The Treasurer Is a Smart Contract

The kit for a 25 minute live-demo talk at the Investec developer community Q4 2026 event.
One sentence to hold on to while reading any of this:

> Investec holds the rand, the blockchain holds the rulebook, and the relayer carries
> messages between them but can't make decisions. The contract never holds funds.

## Phases

Each phase ends with its own checks, a commit, and a push.

| # | Phase | Output | Check before commit |
|---|---|---|---|
| 1 | Plan and scaffold | this file, `.gitignore`, `LICENSE`, guard scripts | secret scan, dash grep |
| 2 | Contracts | `contracts/`: `Stokvel.sol`, `StokvelV1Vulnerable.sol`, tests, scripts | `forge test` green on V2, invariant suite red on V1, Slither |
| 3 | Relayer, mock bank, card code | `relayer/`, `card/`, `docs/INVESTEC_API_NOTES.md` | typecheck, relayer unit tests, end to end against Anvil + mock bank |
| 4 | Stage app and launcher | `stage/`, `scripts/demo.sh` | `next build`, all 8 demos driven from `/presenter` with no network |
| 5 | Member cards | `cards/` generator, previews in `assets/cards/` | PDF opens, sizes measured, previews use visibly fake keys |
| 6 | Diagrams, fonts, screenshots | `assets/` | every PNG looked at |
| 7 | Talk | `talk/` | word count per segment against the run sheet timing |
| 8 | Decks | `slides/` (dark, light, PDF), `deck/index.html` | every slide rendered to PNG and inspected, fixes repeated until clean |
| 9 | README and final QA | `README.md`, PR | secret scan, dash grep, full test run, fresh clone demo run |

## Architecture in one breath

```
 member card (QR key) --sign--> signing station --POST--> relayer --voteBySig--> Stokvel.sol
 Investec card swipe --afterTransaction--> round-up transfer STK-03 --> stokvel account
 stokvel account <--poll transactions / balance-- relayer --recordContribution / postReserves--> Stokvel.sol
 Stokvel.sol --PayoutDue event--> relayer --paymultiple / transfermultiple--> member's bank account
 Stokvel.sol events --> stage dashboard, audience page (no database anywhere)
```

Roles on chain:

- **relayer** records contributions and confirms payouts. It can't choose a recipient and can't invent reserves.
- **attestor** signs the Investec balance (EIP-712). A different key from the relayer, so a compromised relayer can't fake reserves.
- **anyone** can call `closeRound`. The recipient is `round % members.length`, always.
- **members** vote with gasless EIP-712 signatures. A strict majority starts a timelock.

## Decisions

- Money is integer cents everywhere: `uint128` per member, `uint256` for totals. No tokens, no ETH held.
- The chain is the database. The stage app and the relayer both rebuild state from events on start, which is what makes "kill the server" a demo instead of a risk.
- The relayer is stateless. On restart it re-reads the bank and asks the contract `seen(ref)` before sending anything. The contract refuses duplicates anyway.
- The attestor stamps each balance with the latest block timestamp, not the laptop clock, so Anvil time travel ("skip to month end") and Base Sepolia both work with the same code.
- Demo mode on Anvil: rounds last 30 days but the presenter can warp time. Timelock is 120 seconds. Production values are documented next to each constructor parameter.
- `forge test` runs the V2 suites. The V1 invariant suite lives behind `FOUNDRY_PROFILE=v1` so the default run stays green and the fuzzer demo is one command: `./scripts/fuzz.sh`.

## Deviations

Things in the brief that turned out to be wrong, blocked, or better done another way. Each one is the closest honest alternative.

1. **Branch name.** The brief says `claude/build-stokvel-talk`. This cloud session is locked to `claude/cool-wright-qlwd47`, so the work and the PR live there.
2. **The GitHub repo was empty**, with no `main`. The first commit on the branch holds only `LICENSE`; it is published as `main` so the PR has a base and its diff contains the whole kit.
3. **Blocked hosts.** This session's network policy denies `openapisandbox.investec.com`, `developer.investec.com`, `investec.gitbook.io`, Postman, `sepolia.base.org`, `fonts.google.com` and `foundry.paradigm.xyz`. Workarounds:
   - Investec shapes were verified from the community code that is reachable (the Investec developer community's API simulator, the two tutorials, published npm clients) and recorded with sources in `docs/INVESTEC_API_NOTES.md`. The live sandbox run is scripted (`relayer/scripts/sandbox-smoke.ts`) for the owner to run, because it can't be run from here.
   - Foundry and solc came from their GitHub release binaries. Fonts came from the Fontsource npm packages (same Google Fonts files, same OFL licence).
4. **Member numbering.** Cards say member 01 to 06 and "Turn in rotation: n of 6", while the contract's `memberId` is 0 based (`idOf[key] = memberId + 1`, recipient `round % 6`). Bank references use the human number, so `STK-03` means member 03 (Aisha), which is `memberId` 2. The conversion lives in exactly one function, `parseReference`, with its own tests.
5. **Contribution size.** The brief pitches investment stokvels at R2,000 to R10,000 a month, then demos a vote from R500 to R600. An Investec room will notice the mismatch, so the demo stokvel contributes R5,000 and the vote raises it to R6,000. One constant (`CONTRIBUTION_CENTS` in `DemoState.s.sol`) changes it back.
6. **`closeRound` check order.** Staleness and the reserves check run before the "round still open" check. A short treasury is the more important fact, and it lets DEMO 4 show `ReservesShort` on Base Sepolia, where time can't be warped.
7. **`confirmPayout` claims, it doesn't prove.** The beneficiary hash check stops the relayer from confirming a payout to anyone other than the registered beneficiary. It can't prove what the bank actually did. The recipient's own statement, the public `PayoutSettled` event with its Investec reference, and the vote to replace the relayer cover that gap. `docs/SECURITY.md` says so plainly instead of overclaiming.
8. **Two small contract additions.** `joinBySig` lets each member sign the stokvel's constitution hash on stage (DEMO 1 then exercises the same card and signing path that DEMO 7 and 8 depend on). `ReplaceAttestor` joins the governance kinds, because without it a leaked attestor key could never be rotated out.
9. **Fonts in PowerPoint.** Neither python-pptx nor pptxgenjs can embed fonts. The decks reference Space Grotesk, Inter and JetBrains Mono by name, the TTFs and licences ship in `assets/fonts/` with an install script, and the PDF export embeds them for machines without the fonts.
