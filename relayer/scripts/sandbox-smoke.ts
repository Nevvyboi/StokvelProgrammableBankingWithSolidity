/**
 * Smoke test against the real Investec sandbox. Read only apart from one transfermultiple, which the
 * sandbox accepts and then forgets (it is stateless). Run it, then paste the printed report into
 * docs/INVESTEC_API_NOTES.md under "Sandbox run".
 *
 *   INVESTEC_CLIENT_ID=... INVESTEC_CLIENT_SECRET=... INVESTEC_API_KEY=... npm run smoke:sandbox
 */
import pino from "pino";
import { InvestecClient } from "../src/investec/client.js";
import { parseReference, randsToCents, stableTxId } from "../src/investec/reference.js";

const log = pino({ level: "warn" });
const base = process.env.INVESTEC_BASE_URL || "https://openapisandbox.investec.com";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set. The sandbox credentials are on developer.investec.com (SA PB Account Information, Sandbox).`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const client = new InvestecClient({
    baseUrl: base,
    clientId: need("INVESTEC_CLIENT_ID"),
    clientSecret: need("INVESTEC_CLIENT_SECRET"),
    apiKey: need("INVESTEC_API_KEY"),
    log,
  });
  const lines: string[] = [];
  const say = (s: string) => {
    lines.push(s);
    console.log(s);
  };
  say(`# Sandbox run ${new Date().toISOString()} against ${base}`);

  const t0 = Date.now();
  await client.accessToken();
  say(`- token: ok (${Date.now() - t0} ms)`);

  const accounts = await client.accounts();
  say(`- accounts: ${accounts.length}`);
  for (const a of accounts) {
    say(`  - ${a.accountId} ${a.productName} "${a.referenceName}" profile ${a.profileId}${a.profileName ? ` (${a.profileName})` : " (no profileName)"} kyc=${a.kycCompliant}`);
  }
  const acc = accounts[0];
  if (!acc) throw new Error("no accounts");

  const bal = await client.balance(acc.accountId);
  say(`- balance fields: ${Object.keys(bal).join(", ")}`);
  say(`  - currentBalance ${bal.currentBalance} (${typeof bal.currentBalance}) -> ${randsToCents(bal.currentBalance)} cents, currency ${bal.currency}`);

  const txs = await client.transactions(acc.accountId);
  say(`- transactions: ${txs.length}`);
  const first = txs[0];
  if (first) {
    say(`  - fields: ${Object.keys(first).join(", ")}`);
    say(`  - uuid present: ${txs.filter((t) => t.uuid).length} of ${txs.length}; postedOrder 0: ${txs.filter((t) => Number(t.postedOrder) === 0).length}; pending: ${txs.filter((t) => t.status === "PENDING").length}`);
    say(`  - sample: ${first.type} ${first.amount} "${first.description}" ${first.transactionDate} -> stable id ${stableTxId(first)}`);
    say(`  - STK references found: ${txs.filter((t) => parseReference(t.description) !== null).length}`);
  }

  try {
    const bens = await client.beneficiaries();
    say(`- beneficiaries: ${bens.length}${bens[0] ? `, first "${bens[0].name}" id ${bens[0].beneficiaryId}` : ""}`);
  } catch (err) {
    say(`- beneficiaries: FAILED ${String(err).split("\n")[0]}`);
  }

  const to = accounts[1]?.accountId ?? acc.accountId;
  try {
    const r = await client.transfer(acc.accountId, [{ beneficiaryAccountId: to, amount: "3.00", myReference: "STK-03 round-up", theirReference: "STK-03" }], acc.profileId);
    const x = r.TransferResponses[0];
    say(`- transfermultiple R3.00 -> ${to}: ${x ? `PaymentReferenceNumber ${x.PaymentReferenceNumber}, PaymentDate ${x.PaymentDate}, AuthorisationRequired ${x.AuthorisationRequired}` : "no TransferResponses"}${r.ErrorMessage ? `, ErrorMessage ${r.ErrorMessage}` : ""}`);
    const after = await client.balance(acc.accountId);
    say(`  - balance after: ${after.currentBalance} (was ${bal.currentBalance}) ${after.currentBalance === bal.currentBalance ? "unchanged: the sandbox is stateless" : "changed"}`);
    const txsAfter = await client.transactions(to);
    say(`  - the STK-03 credit is ${txsAfter.some((t) => t.description === "STK-03" && t.type === "CREDIT") ? "visible" : "not visible"} on the receiving account`);
  } catch (err) {
    say(`- transfermultiple: FAILED ${String(err).split("\n")[0]}`);
  }

  console.log("\nPaste the lines above into docs/INVESTEC_API_NOTES.md.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
