# Security model

The contract never holds money. There is no token, no ETH, nothing on chain to steal. What it holds is
the rulebook and the record, so every attack below is an attack on the record: make the club believe
something the bank did not do, or pay someone the rules did not choose.

Two keys matter. The **relayer** records what the bank did. The **attestor** signs what the bank holds.
They are different keys on purpose, so that a compromised relayer cannot also fake the reserves that
would cover its lies. Six **member** keys vote, and can replace either of the other two.

## Threat model

| Attacker | Attack | Defence |
|---|---|---|
| Dodgy treasurer | "Pay me this month" | No recipient setter anywhere. The recipient is `round % members`, and moving a membership to a new key takes a majority vote plus the timelock |
| Dodgy treasurer | Takes rand out of the Investec account | Proof of reserves: `closeRound` needs a signed balance under an hour old that covers `pot + unsettled`, or it reverts with `ReservesShort(held, owed)` and payouts freeze |
| Compromised relayer | Records the same payment twice | `seen[ref]` is set forever on first use, the second call reverts with `AlreadyRecorded` |
| Compromised relayer | Invents a huge contribution | `AmountTooLarge` caps every credit at R10,000, and at close the reserves are short by exactly the invented amount |
| Compromised relayer | Pays the wrong person | `confirmPayout` only succeeds for the registered `beneficiaryHash` of the member who is due. Every `PayoutDue` and `PayoutSettled` is public with its Investec reference, and members can vote to replace the relayer |
| Vote thief | Replays an old signed vote | EIP-712 domain (name, version, chain id, contract address) plus a per-signer nonce, so a signature works once, on one proposal, on one deployment |
| Stolen member card | Votes as the victim | Social recovery: `RotateKey` removes the old key from `idOf` and maps the spare card. Votes are counted per member id, so the old and new key together still count once |

## What the code enforces, and what it can't

Enforced on chain:

- Every credit is counted once (`seen`), for one known member, under the cap.
- Money is conserved: `totalIn - settledOut == pot + unsettled` at all times.
- A round only closes when the round is over and fresh signed reserves cover everything owed.
- The recipient of round `n` is member `n % 6`. There is no function that takes a recipient.
- A payout can only be confirmed against the beneficiary the club registered for that member.
- Governance needs a strict majority (4 of 6) and then a timelock (120 seconds in the demo, 48 hours in production), with a 7 day voting window and a 7 day execution window.

Not enforced, and said out loud on the "honest limits" slide:

- **The relayer is trusted to report the truth about what the bank did.** `confirmPayout` is a claim, not a proof. The beneficiary hash check stops the relayer from confirming a payout to someone else, but it cannot see the bank's ledger. The recipient's own statement, the public event trail and the vote to replace the relayer are the controls.
- **The attestor is trusted to sign the real balance.** A dishonest attestor can lie in either direction. In production the attestor would run on separate infrastructure from the relayer, and `ReplaceAttestor` exists so members can rotate it out.
- **The Investec account is a normal account.** Nothing on chain can stop a signatory from moving money. The chain can only refuse to pay out once it knows, which is the point of proof of reserves.

## Invariants

`test/Invariant.t.sol` drives the contract through 10,000 random actions (100 runs of 100 calls) using
`test/Handler.sol`: contributions, duplicate webhooks, invented amounts, honest and dishonest
attestations, theft and refund, time warps, closes, correct and wrong confirmations. The handler keeps
its own ledger of what the bank really did. Five properties must hold after every call:

1. `sum(members[i].paidCents) == totalIn`
2. `totalIn - settledOut == pot + unsettled`
3. No Investec reference is ever recorded twice
4. `closeRound` never succeeds while `reserves < pot + unsettled`
5. `totalIn` equals what the bank actually received

All five hold on `Stokvel.sol`. On `StokvelV1Vulnerable.sol`, which is the same contract minus the
`seen` check in `recordContribution`, the fuzzer breaks properties 3 and 5 within seconds, with a two
call reproduction:

```
[FAIL: an Investec ref was recorded twice: 2 != 1]
    calldata=contribute(uint8,uint128) args=[156, 2592000]
    calldata=duplicateWebhook(uint256) args=[3]
[FAIL: totalIn != what the bank actually received: 1184000 != 592000]
```

Run it yourself: `./scripts/fuzz.sh` (V1, fails) and `./scripts/fuzz.sh v2` (V2, passes).
`test/V1Exploit.t.sol` is the same reproduction written out by hand, with the V2 refusal next to it.

## Static analysis

Slither 0.11.6, run with `slither . --filter-paths "lib/|test/|script/" --exclude-informational --exclude-optimization`
on the final code. Every finding was read:

| Detector | Finding | Verdict |
|---|---|---|
| `unused-return` | `ECDSA.tryRecover` returns a third value (the malleability argument) that we ignore | Accepted. We check the `RecoverError` and the recovered address, which is what matters |
| `timestamp` | `block.timestamp` is compared in `postReserves`, `closeRound`, `voteBySig`, `execute`, `health` | Accepted. Every window is an hour or longer, and a validator can nudge a timestamp by seconds, not hours |
| `shadowing-local` | An interface parameter named `round` shadowed the `round()` getter | Fixed, renamed to `closedRound` |

No high or medium findings. `forge lint` flags the same timestamp comparisons and the `uint8` casts of
member ids, which are bounded by the constructor's cap of 64 members. Both lints are excluded in
`foundry.toml` with that reason.

## Keys and operational rules

- The talk uses the Investec **sandbox** and **testnets** only (local Anvil, Base Sepolia). Nothing here touches real money.
- Member cards carry throwaway testnet keys generated by `cards/`. The output folder is gitignored. Treat a printed card as cash anyway: the card says so on the back.
- The signing station holds a scanned key in memory for one signature and wipes it. It never sends a key anywhere.
- The audience page is read only. It shows events and Basescan links. It never sees or accepts a key.
- The relayer and attestor keys live in `relayer/.env`, which is gitignored. `scripts/scan-secrets.sh` runs before every commit.
- Out of scope, listed on the "what's next" slide: rage quit, late penalties, tokenised rand, passkeys for production members.
