# Investec API notes

What the relayer and the card code rely on, where each fact was checked, and what could not be
checked from the build environment. The rule for this file: nothing in the code depends on a shape
that is not written down here with a source.

## How this was verified

The build ran in a cloud session whose network policy blocked `developer.investec.com`,
`openapisandbox.investec.com`, the Postman collections and `investec.gitbook.io`. So the shapes below
were taken from sources that are public on GitHub and npm, cross-checked against each other, and the
relayer was tested against a mock that reproduces them. The one thing that still needs the owner's
laptop is the live sandbox run at the bottom.

| Source | What it is | Pinned |
|---|---|---|
| `Investec-Developer-Community/investec-swagger` | Investec's own OpenAPI files, published for community input | commit `3681108`, swagger files dated 2026-05-07 |
| `Investec-Developer-Community/ai-sandbox` | an older copy of the same spec with full release notes | commit `6285627` |
| `devinpearson/programmable-banking-sim` | the community's stateful local simulator, plus a Postman collection with responses captured from the real sandbox (April 2023) and production (transfermultiple) | commit `73b278f` |
| `petersmythe/investec-swipe-n-save`, `petersmythe/invapi-dual-auth` | the two community card tutorials this talk credits | main, cloned 2026-09-24 |
| npm `investec-pb-api`, `investec-ipb` and others | client libraries; used only where they agree with the spec | latest on 2026-09-24 |

Confidence: **verified** means two or more independent sources agree. **one source** means exactly
that. **inferred** means it follows from the sources but no source states it.

## The shapes the code uses

### OAuth (verified)

```
POST /identity/v2/oauth2/token
Authorization: Basic base64(clientId:clientSecret)
x-api-key: <api key>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

Response `{ access_token, token_type: "Bearer", expires_in: 1799, scope }`. Tokens last 30 minutes;
there is no refresh for client credentials, you ask again. `x-api-key` is needed on the token call
only. Data calls send `Authorization: Bearer <token>` and nothing else. The relayer refreshes a minute
early (`relayer/src/investec/client.ts`).

### Accounts (verified)

`GET /za/pb/v1/accounts` returns `{ data: { accounts: [...] }, links: { self }, meta: { totalPages } }`.
Every response uses that envelope. Account fields: `accountId` (an opaque 25 digit string, used in
every path), `accountNumber`, `accountName`, `referenceName`, `productName`, `kycCompliant` (boolean),
`profileId`, `profileName`. The April 2023 sandbox capture has no `profileName`, so the relayer treats
it as optional.

### Balance (verified)

`GET /za/pb/v1/accounts/{accountId}/balance` returns `data: { accountId, currentBalance,
availableBalance, budgetBalance, straightBalance, cashBalance, currency }`. **Amounts are rands as JSON
numbers**, for example `28857.76`. The relayer converts with `Math.round(rands * 100)` and posts
`currentBalance` as the reserves figure. The three extra balances were added in August 2023; the
relayer only reads `currentBalance` and `currency`.

### Transactions (verified, with one caveat)

`GET /za/pb/v1/accounts/{accountId}/transactions?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD`. Fields:
`accountId`, `type` (`CREDIT` or `DEBIT`, the direction), `transactionType`, `status` (`POSTED` or
`PENDING`), `description` (max 40 characters), `cardNumber`, `postedOrder`, `postingDate`,
`valueDate`, `actionDate`, `transactionDate`, `amount`, `runningBalance`, `uuid`.

**`amount` is rands, positive, as a number. The sign is in `type`.** A client README shows a
negative amount; the spec and the captured data disagree with it.

The caveat is the transaction id. `uuid` was added in November 2024 and is built by Investec as
`last 5 characters of accountId + postingDate as YYYYMMDD + postedOrder padded to 7 digits`. The
release note says it "is not a backend banking generated ID and will change if any of the properties
making it up changes". It is empty for pending rows and for products other than Private Bank
Accounts, and the community FAQ warns that `postedOrder` can start at 0 and change on settlement.
Whether the sandbox returns it today is **not verified** (the only sandbox capture predates it).

So `relayer/src/investec/reference.ts` does this: use `uuid` when the row is `POSTED` with
`postedOrder > 0`, otherwise a hash of `accountId | type | transactionDate | postingDate | amount |
description | postedOrder`. Rows with `postedOrder === 0` are skipped until they settle. The on-chain
ref is `keccak256(thatId)`, and the contract refuses a ref it has seen.

The **reference** a payer types shows up on the receiving account as `description`. For a transfer,
the receiver's `description` is `theirReference` (one source: the simulator's code and the Postman
collection's comments, consistent with the docs' wording "reference displayed on your recipient's
statement"). The relayer parses `STK-nn` out of `description` with a regex that tolerates `STK-03`,
`STK 03`, `stk-3` and text around it.

### Transfers and payments (verified)

`POST /za/pb/v1/accounts/{accountId}/transfermultiple` with
`{ transferList: [{ beneficiaryAccountId, amount: "150.00", myReference, theirReference }], profileId }`.
`amount` is a **rand string**. `beneficiaryAccountId` is another account's `accountId` on the same
login. There is no `/v2/` in the path; "Transfer Multiple v2" is this account-scoped path, and the
older `POST /za/pb/v1/accounts/transfermultiple` was removed from the docs in May 2026.

`POST /za/pb/v1/accounts/{accountId}/paymultiple` with
`{ paymentList: [{ beneficiaryId, amount: "500.00", myReference, theirReference }] }` pays a saved
beneficiary. At most 50 per call. The community wiki spells the key `paymentsList`; that is a typo,
the spec and every client use `paymentList`. Beneficiaries can't be created through the API and must
have been paid once through Investec Online first.

Both return `data: { TransferResponses: [{ PaymentReferenceNumber, PaymentDate, Status,
BeneficiaryName, BeneficiaryAccountId, AuthorisationRequired }], ErrorMessage }`. Keys are
PascalCase. `PaymentDate` is `DD/MM/YYYY`. `Status` is free text that can contain `<BR>`. The relayer
uses `PaymentReferenceNumber` as the payout's Investec reference on chain.

`GET /za/pb/v1/accounts/beneficiaries` returns `data` as the array itself (no wrapper), with
`beneficiaryId`, `accountNumber`, `code`, `bank`, `beneficiaryName`, `lastPaymentAmount` (a string,
sometimes with a thousands separator), `lastPaymentDate` (`DD/MM/YYYY`), `cellNo` and `emailAddress`
(often null), `name`, `referenceAccountNumber`, `referenceName`, `categoryId`, `profileId`,
`fasterPaymentAllowed`.

### Programmable card (verified)

`afterTransaction(transaction)` receives `{ accountNumber, dateTime, centsAmount, currencyCode: "zar",
type: "card", reference, card: { id }, merchant: { name, city, country: { code, alpha3, name },
category: { code, key, name } } }`. `centsAmount` is an integer in cents. `merchant.category.code` is
a string (`"6011"` is an ATM). `merchant.country` is an object, not a string. `reference` is
`"simulation"` in the simulator.

`beforeTransaction` has about 2 seconds, after which the network auto-approves; the simulator does
not enforce it. `afterTransaction` has about 15 seconds. The card code here does nothing in `before`.

`env.json` values arrive as **strings** in production (numbers and booleans included), while the
simulator keeps their types. `card/main.js` coerces every value. `fetch` is available in card code.
Whether `Buffer` is available is disputed between sources, so the code falls back to `btoa`.
`investec.helpers.format.decimal` exists in production but not in the community emulators, so the
code uses `(cents / 100).toFixed(2)` instead.

## What the sandbox does that the docs don't say

1. **The sandbox is stateless.** From the spec's own quickstart: "balances won't be updated when
   transfers are made in the sandbox", and "all actions are immutable and can be run multiple times".
   A `transfermultiple` returns a real `PaymentReferenceNumber` and then nothing changes. No new
   transaction appears on either account. This is the reason `relayer/src/mock` exists: the demos
   where money moves (round-up lands, payout drops the balance, treasurer theft) need a stateful bank.
   The mock reproduces the sandbox's routes and shapes exactly, and the relayer can't tell them
   apart. `INVESTEC_SHADOW=sandbox` sends every payout to the real sandbox as well and logs the
   response, so the talk can show a real Investec answer next to the moving balance.
2. **No transaction webhooks.** The PB API is poll only. The mock adds a push to the relayer's
   `/webhook/transaction` because the "double webhook" story needs one; it is labelled as a mock
   convenience in the code and on the slide.
3. **The community simulator differs from the real API** in ways the relayer tolerates: numbers come
   back as strings (`amount: "40.99"`), `availableBalance` is always 0, beneficiaries are wrapped in
   `data.result`, and the transfer endpoints echo the request instead of returning `TransferResponses`.
   The client coerces numbers and unwraps `result`; the mock in this repo follows the real shapes, not
   the simulator's.
4. `profileName` is missing from the 2023 sandbox capture and present in the current spec.
5. Mixed conventions to keep straight: response amounts are rand numbers, request amounts are rand
   strings, card amounts are integer cents; transaction dates are `YYYY-MM-DD`, payment dates are
   `DD/MM/YYYY`, card `dateTime` is ISO 8601; PB responses are camelCase, `TransferResponses` are
   PascalCase, `currencyCode` on cards is lowercase.

## Sandbox credentials

The sandbox base URL is `https://openapisandbox.investec.com`. The client id, secret and `x-api-key`
are published by Investec in the "Sandbox" section of the SA PB Account Information documentation on
developer.investec.com, and repeated in the `info.description` of the community swagger file. They
are not copied into this repository. Put them in `relayer/.env` and `card/env.json`, both gitignored.

## Sandbox run

To be filled in by the owner, from a machine that can reach the sandbox:

```bash
cd relayer
INVESTEC_CLIENT_ID=... INVESTEC_CLIENT_SECRET=... INVESTEC_API_KEY=... npm run smoke:sandbox
```

The script prints one line per check: token, accounts (with `profileName` present or not), balance
fields and types, transaction fields, how many rows carry `uuid`, how many have `postedOrder` 0, a
R3.00 `transfermultiple` with its `PaymentReferenceNumber`, and whether the balance or the receiving
account changed afterwards (they should not). Paste the output here and note anything that disagrees
with the sections above.

_Result: not yet run. The build environment could not reach `openapisandbox.investec.com`._
