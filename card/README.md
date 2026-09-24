# card: round-ups on an Investec programmable card

`main.js` runs on the member's Investec card. After every purchase it rounds the amount up to the next
R10 and transfers the difference to the stokvel account with the reference `STK-<member number>`.
R87.00 at the bakery becomes a R3.00 contribution. The relayer sees `STK-03` land on the stokvel
account and records it on chain for member 03.

Only `afterTransaction` does anything. `beforeTransaction` has about 2 seconds before the network
auto-approves, which is not enough for an OAuth round trip plus a transfer, so it just returns `true`.

## Paste it into the card IDE

1. Investec Online, Manage, Investec Developer, Programmable Card IDE, Manage Code.
2. Pick the card, toggle Enabled, hover the card and click `<programmable.../>`.
3. Replace `main.js` with this folder's `main.js`.
4. Replace `env.json` with a filled in copy of `env.json.example`:
   - `clientId`, `secret`, `apiKey`: the sandbox credentials from the "Sandbox" section of the
     SA PB Account Information docs on developer.investec.com. Sandbox only: this code should never
     see production credentials during the talk.
   - `fromAccountId`, `toAccountId`, `profileId`: from `GET /za/pb/v1/accounts` (the relayer prints
     them on start, or run `npm run smoke:sandbox` in `relayer/`).
   - `memberNumber`: `01` to `06`, one card per member.
   - `allowSimulation`: `true` while testing in the simulator, `false` on a real card.
5. Save. Then simulate: amount in cents `8700`, merchant code `5462`, merchant name `The Coders Bakery`.
   Event Logs, Simulator logs should show `STK-03: rounded 8700 up by 300 cents` and the transfer
   response.

Two production gotchas, both from the community tutorials credited below:

- `env.json` numbers and booleans arrive as **strings** in production (the simulator keeps their
  types). The code coerces every value, so `"roundUpToCents": 1000` and `"roundUpToCents": "1000"`
  both work.
- The 2 second `beforeTransaction` limit is not enforced by the simulator, so a slow `before` hook
  looks fine in testing and silently auto-approves on the street.

## Test it offline

The mock Investec server in `relayer/` runs this exact file on `POST /__mock/swipe`, in a sandbox
shaped like the card runtime (string env values, `fetch` available). The presenter panel's "card
swipe" button is that call. So the code on stage is the code that would run on the card.

```bash
cd relayer && npm run mock
curl -s -X POST localhost:4100/__mock/swipe -H 'content-type: application/json' \
  -d '{"memberNumber":"03","centsAmount":8700}' | python3 -m json.tool
```

## Credits

- [petersmythe/investec-swipe-n-save](https://github.com/petersmythe/investec-swipe-n-save): the
  swipe-then-transfer pattern this file follows.
- [petersmythe/invapi-dual-auth](https://github.com/petersmythe/invapi-dual-auth): `env.json`
  handling and the 2 second rule.
