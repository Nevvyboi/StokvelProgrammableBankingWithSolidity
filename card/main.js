// The Q4 Stokvel: round-up card code for Investec Programmable Banking.
//
// Every card purchase is rounded up to the next R10 and the difference is transferred to the
// stokvel's account with the reference STK-<member number>. The relayer sees that reference on the
// stokvel account and records the contribution on chain.
//
// Only afterTransaction does work. beforeTransaction has about 2 seconds before Visa auto-approves,
// which is not enough for an OAuth round trip, so it just returns true.
//
// Pattern credit: petersmythe/investec-swipe-n-save (transfer after a swipe) and
// petersmythe/invapi-dual-auth (env.json handling, the 2 second rule).

// env.json values arrive as strings in production, even numbers and booleans. Coerce everything.
const cfg = () => ({
  baseUrl: process.env.baseUrl || "https://openapisandbox.investec.com",
  clientId: process.env.clientId,
  secret: process.env.secret,
  apiKey: process.env.apiKey,
  profileId: process.env.profileId,
  fromAccountId: process.env.fromAccountId,
  toAccountId: process.env.toAccountId,
  memberNumber: String(process.env.memberNumber || "01").padStart(2, "0"),
  roundUpToCents: Number(process.env.roundUpToCents || 1000),
  minRoundUpCents: Number(process.env.minRoundUpCents || 100),
  allowSimulation: String(process.env.allowSimulation) === "true",
});

function basicAuth(clientId, secret) {
  const raw = `${clientId}:${secret}`;
  if (typeof Buffer !== "undefined") return Buffer.from(raw).toString("base64");
  return btoa(raw);
}

async function getAccessToken(c) {
  const response = await fetch(`${c.baseUrl}/identity/v2/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + basicAuth(c.clientId, c.secret),
      "x-api-key": c.apiKey,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = await response.json();
  if (!body.access_token) throw new Error("no access token: " + JSON.stringify(body));
  return body.access_token;
}

async function transferRoundUp(c, token, cents) {
  const reference = `STK-${c.memberNumber}`;
  const response = await fetch(`${c.baseUrl}/za/pb/v1/accounts/${c.fromAccountId}/transfermultiple`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      transferList: [
        {
          beneficiaryAccountId: c.toAccountId,
          amount: (cents / 100).toFixed(2),
          myReference: `${reference} round-up`,
          theirReference: reference,
        },
      ],
      profileId: c.profileId,
    }),
  });
  return response.json();
}

// The next R10 up. R87.00 gives R3.00, R90.00 gives R0.00 and nothing is sent.
function roundUpCents(centsAmount, step) {
  return (step - (centsAmount % step)) % step;
}

const beforeTransaction = async (authorization) => {
  return true;
};

const afterTransaction = async (transaction) => {
  const c = cfg();
  if (transaction.reference === "simulation" && !c.allowSimulation) {
    console.log("simulation, skipping (set allowSimulation to true to test)");
    return;
  }
  if (String(transaction.merchant.category.code) === "6011") {
    console.log("ATM withdrawal, skipping");
    return;
  }
  const cents = roundUpCents(Number(transaction.centsAmount), c.roundUpToCents);
  if (cents < c.minRoundUpCents) {
    console.log(`round-up of ${cents} cents is under the minimum, skipping`);
    return;
  }
  const token = await getAccessToken(c);
  const result = await transferRoundUp(c, token, cents);
  console.log(`STK-${c.memberNumber}: rounded ${transaction.centsAmount} up by ${cents} cents`);
  console.log(JSON.stringify(result));
};

const afterDecline = async (transaction) => {
  console.log("declined: " + transaction.merchant.name);
};

const afterReversal = async (transaction) => {
  console.log("reversed: " + transaction.merchant.name);
};

const afterAdjustment = async (transaction) => {
  console.log("adjusted: " + transaction.merchant.name);
};
