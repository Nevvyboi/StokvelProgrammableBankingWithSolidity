# Deploy

Two targets. Anvil for every rehearsal and, honestly, for the night. Base Sepolia when you want the
room to verify on Basescan from their own phones.

## Anvil (one command)

```bash
./scripts/demo.sh --mock
```

That starts Anvil, deploys V2 and V1, seeds two settled months and a mid-month round, starts the
mock Investec server, the relayer and the stage app. If `cards/out/members.json` exists (from
`cards/generate.py`), the printed cards' keys become the members.

## Base Sepolia

You need three throwaway keys with a little Base Sepolia ETH: a deployer, the relayer and the
attestor. Never a key that holds anything real. Faucets change; the current list is on
docs.base.org under "network faucets". A few hundredths of an ETH is plenty for the whole talk.

1. Generate the cards first, so the members are the printed keys:

   ```bash
   cd cards && python3 generate.py && cd ..
   ```

2. Set the environment. Pick `FIRST_ROUND_ENDS_AT` as a unix timestamp about twelve minutes into
   the talk (DEMO 3 is at 10:00 on the run sheet), because time can't be warped on a public chain:

   ```bash
   export BASE_SEPOLIA_RPC_URL=https://sepolia.base.org      # or your own RPC
   export DEPLOYER_PK=0x...                                    # throwaway, funded
   export RELAYER=0x...     ATTESTOR=0x...                     # addresses of the other two keys
   export FIRST_ROUND_ENDS_AT=$(date -d "2026-11-26 18:12 SAST" +%s)   # your talk's time
   export MEMBERS_FILE=../cards/out/members.json
   ```

3. Deploy and verify:

   ```bash
   cd contracts
   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --private-key $DEPLOYER_PK \
     --verify --etherscan-api-key $BASESCAN_API_KEY
   ```

   The script writes `contracts/deployments/84532.json`. Commit it: the stage app and the relayer
   read it, and the audience page links to it.

4. Sign the constitution before the night, or on stage in DEMO 1 (that is the point of DEMO 1):

   ```bash
   MEMBERS_KEYS_FILE=../cards/out/members.json RELAYER_PK=0x... \
     forge script script/DemoState.s.sol --sig "join()" --rpc-url base_sepolia --broadcast
   ```

   `month()` and `midMonth()` also work on Base Sepolia if you want a pre-filled month.
   `closeAndSettle()` needs the round to be over, so it only works after `FIRST_ROUND_ENDS_AT`.

5. Run the relayer against the chain and the mock bank:

   ```bash
   cd relayer
   RPC_URL=$BASE_SEPOLIA_RPC_URL CHAIN_ID=84532 RELAYER_PK=0x... ATTESTOR_PK=0x... INVESTEC_MODE=mock npm start
   ```

   and the stage app with `CHAIN_ID=84532`:

   ```bash
   cd stage && CHAIN_ID=84532 NEXT_PUBLIC_RPC_URL=$BASE_SEPOLIA_RPC_URL npm run dev
   ```

   The explorer links switch to `sepolia.basescan.org` on their own.

## What changes on Base Sepolia

| Demo | Anvil | Base Sepolia |
|---|---|---|
| 3, month end | "Skip to month end" warps the clock | the round ends at `FIRST_ROUND_ENDS_AT`; say the time and come back to it |
| 4, theft | as rehearsed | as rehearsed: `ReservesShort` fires before `RoundStillOpen`, on purpose |
| 7, vote | timelock warped | wait the real 120 seconds; the Execute button shows the countdown |
| 8, stolen card | as rehearsed | as rehearsed, with the same 120 seconds |
| 9, kill the server | as rehearsed | as rehearsed |

Everything else is identical. Gas: every relayer transaction is cheap, and the members never pay
any: their signatures are carried by the relayer.

## The Investec sandbox

`./scripts/demo.sh --sandbox` runs the relayer with `INVESTEC_MODE=sandbox` and the public sandbox
credentials in `relayer/.env`, through the sandbox overlay on :4200 (`relayer/src/overlay`). The
sandbox is stateless; the overlay forwards every call and remembers each transfer the sandbox
accepts, under the sandbox's own reference, so balances and transactions move on stage. Before the
run: `npm run smoke:sandbox` prints the sandbox's accounts and beneficiary ids; put those ids in
`MEMBERS_FILE`, deploy with matching `beneficiaryHash`es, and set `POOL_ACCOUNT_ID` and
`TREASURER_ACCOUNT_ID` if the first two sandbox accounts are not the ones you want. Paste the smoke
report into [INVESTEC_API_NOTES.md](INVESTEC_API_NOTES.md).

## Card code

`card/main.js` and a filled in `card/env.json` go into the Investec card IDE, one card per member
with its own `memberNumber`. `card/README.md` has the clicks. Test it in the simulator with amount
`8700`, merchant code `5462`; the logs should show `STK-03: rounded 8700 up by 300 cents`.

## Never

- Never point anything at `https://openapi.investec.com`.
- Never deploy `StokvelV1Vulnerable.sol` anywhere but a testnet. It's on the slide for a reason.
- Never reuse the card keys after the talk.
