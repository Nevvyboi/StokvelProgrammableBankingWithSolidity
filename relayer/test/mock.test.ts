import { describe, expect, it, beforeEach } from "vitest";
import pino from "pino";
import { Ledger, POOL_ACCOUNT_ID, TREASURER_ACCOUNT_ID } from "../src/mock/ledger.js";
import { createMockApp } from "../src/mock/server.js";
import { InvestecClient } from "../src/investec/client.js";
import { resolve } from "node:path";

const log = pino({ level: "silent" });

function setup() {
  const ledger = new Ledger();
  const app = createMockApp({ ledger, log, selfUrl: "http://mock", cardDir: resolve(process.cwd(), "..", "card") });
  const fetchImpl: typeof fetch = (input, init) => Promise.resolve(app.request(input as string, init as RequestInit));
  const client = new InvestecClient({ baseUrl: "http://mock", clientId: "id", clientSecret: "s", apiKey: "k", log, fetchImpl });
  return { ledger, app, client, fetchImpl };
}

describe("the mock looks like the Investec sandbox", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("issues a token only with Basic auth and an x-api-key", async () => {
    const bad = await t.app.request("http://mock/identity/v2/oauth2/token", { method: "POST", body: "grant_type=client_credentials" });
    expect(bad.status).toBe(401);
    const token = await t.client.accessToken();
    expect(token).toBe("mock-access-token");
  });

  it("refuses data calls without a bearer token", async () => {
    const res = await t.app.request("http://mock/za/pb/v1/accounts");
    expect(res.status).toBe(401);
  });

  it("returns accounts in the {data, links, meta} envelope", async () => {
    const res = await t.app.request("http://mock/za/pb/v1/accounts", { headers: { Authorization: "Bearer mock-access-token" } });
    const body = await res.json();
    expect(body.data.accounts[0].accountId).toBe(POOL_ACCOUNT_ID);
    expect(body.links.self).toContain("/za/pb/v1/accounts");
    expect(body.meta.totalPages).toBe(1);
    expect(typeof body.data.accounts[0].kycCompliant).toBe("boolean");
  });

  it("balance is rands as a number", async () => {
    t.ledger.post(POOL_ACCOUNT_ID, "CREDIT", 8750n, "STK-03");
    const b = await t.client.balance(POOL_ACCOUNT_ID);
    expect(b.currentBalance).toBe(87.5);
    expect(b.currency).toBe("ZAR");
  });

  it("transactions carry uuid, positive amounts and type for direction", async () => {
    t.ledger.post(POOL_ACCOUNT_ID, "CREDIT", 8750n, "STK-03");
    t.ledger.post(POOL_ACCOUNT_ID, "DEBIT", 50n, "Fees");
    const list = await t.client.transactions(POOL_ACCOUNT_ID);
    expect(list).toHaveLength(2);
    expect(list[0]!.type).toBe("CREDIT");
    expect(list[0]!.amount).toBe(87.5);
    expect(list[1]!.type).toBe("DEBIT");
    expect(list[1]!.amount).toBe(0.5);
    expect(list[1]!.runningBalance).toBe(87);
    expect(list[0]!.uuid).toMatch(/^55555\d{8}\d{7}$/);
  });

  it("beneficiaries: data is the array itself", async () => {
    const list = await t.client.beneficiaries();
    expect(list.map((b) => b.name)).toEqual(["Lerato", "Thabo", "Aisha", "Johan", "Priya", "Sipho"]);
    expect(list[0]!.cellNo).toBeNull();
  });

  it("transfermultiple debits the source and credits the destination with theirReference", async () => {
    const r = await t.client.transfer(TREASURER_ACCOUNT_ID, [{ beneficiaryAccountId: POOL_ACCOUNT_ID, amount: "3.00", myReference: "STK-03 round-up", theirReference: "STK-03" }], "10000000000001");
    expect(r.ErrorMessage).toBeNull();
    expect(r.TransferResponses[0]!.PaymentReferenceNumber).toMatch(/^UBP\d{10}$/);
    expect(r.TransferResponses[0]!.PaymentDate).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    const pool = await t.client.transactions(POOL_ACCOUNT_ID);
    expect(pool[0]!.description).toBe("STK-03");
    expect(pool[0]!.amount).toBe(3);
    expect((await t.client.balance(TREASURER_ACCOUNT_ID)).currentBalance).toBe(250_000 - 3);
  });

  it("paymultiple pays a saved beneficiary and only writes the debit leg", async () => {
    t.ledger.post(POOL_ACCOUNT_ID, "CREDIT", 3_000_000n, "seed");
    const r = await t.client.pay(POOL_ACCOUNT_ID, [{ beneficiaryId: "beneficiary:Lerato", amount: "30000.00", myReference: "Stokvel payout to Lerato", theirReference: "Stokvel round 1" }]);
    expect(r.TransferResponses[0]!.BeneficiaryAccountId).toBe("beneficiary:Lerato");
    expect((await t.client.balance(POOL_ACCOUNT_ID)).currentBalance).toBe(0);
    const lerato = (await t.client.beneficiaries())[0]!;
    expect(lerato.lastPaymentAmount).toBe("30000.00");
  });

  it("rejects an unknown account the way the sandbox does, with a bare string", async () => {
    const res = await t.app.request("http://mock/za/pb/v1/accounts/nope/balance", { headers: { Authorization: "Bearer mock-access-token" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatch(/invalid/);
  });
});

describe("presenter stories", () => {
  it("steal moves money to the treasurer's own account", async () => {
    const t = setup();
    t.ledger.post(POOL_ACCOUNT_ID, "CREDIT", 2_000_000n, "seed");
    const res = await t.app.request("http://mock/__mock/steal", { method: "POST", body: JSON.stringify({ cents: 100_000 }), headers: { "content-type": "application/json" } });
    const body = await res.json();
    expect(body.balance.currentBalance).toBe(19_000);
    expect(body.debit.description).toBe("Admin fees");
  });

  it("double-webhook pushes the same credit twice to the relayer", async () => {
    const t = setup();
    const received: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      received.push(JSON.parse(init!.body as string).transaction.uuid);
      return new Response("{}", { status: 200 });
    };
    const app = createMockApp({ ledger: t.ledger, log, selfUrl: "http://mock", relayerWebhookUrl: "http://relayer/webhook/transaction", fetchImpl });
    t.ledger.post(POOL_ACCOUNT_ID, "CREDIT", 8750n, "STK-03");
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toHaveLength(1);
    await app.request("http://mock/__mock/double-webhook", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(received).toHaveLength(3);
    expect(new Set(received).size).toBe(1);
  });

  it("swipe runs the real card code: R87 becomes a R3 round-up with reference STK-03", async () => {
    const t = setup();
    const res = await t.app.request("http://mock/__mock/swipe", { method: "POST", body: JSON.stringify({ memberNumber: "03", centsAmount: 8700 }), headers: { "content-type": "application/json" } });
    const body = await res.json();
    expect(body.cardCode).toBe("ok");
    expect(body.roundUpCents).toBe(300);
    expect(body.logs.join("\n")).toContain("STK-03: rounded 8700 up by 300 cents");
    const pool = await t.client.transactions(POOL_ACCOUNT_ID);
    expect(pool[0]!.description).toBe("STK-03");
  });

  it("swipe of an exact R10 multiple sends nothing", async () => {
    const t = setup();
    const res = await t.app.request("http://mock/__mock/swipe", { method: "POST", body: JSON.stringify({ memberNumber: "03", centsAmount: 9000 }), headers: { "content-type": "application/json" } });
    const body = await res.json();
    expect(body.roundUpCents).toBe(0);
    expect(body.logs.join("\n")).toContain("under the minimum");
  });

  it("swipe at an ATM sends nothing", async () => {
    const t = setup();
    const res = await t.app.request("http://mock/__mock/swipe", { method: "POST", body: JSON.stringify({ memberNumber: "03", centsAmount: 8700, mcc: "6011" }), headers: { "content-type": "application/json" } });
    const body = await res.json();
    expect(body.roundUpCents).toBe(0);
  });

  it("seed loads the DemoState ledger once", async () => {
    const t = setup();
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(resolve(tmpdir(), "ledger-"));
    const file = resolve(dir, "demo-ledger.jsonl");
    writeFileSync(file, '{"type":"CREDIT","id":"demo-0-Lerato","cents":500000,"description":"STK-01","at":1790265265}\n{"type":"DEBIT","id":"demo-payout-0","cents":300000,"description":"payout","at":1790265266}\n');
    expect(t.ledger.seed(file)).toBe(2);
    expect(t.ledger.seed(file)).toBe(0);
    expect(t.ledger.balance(POOL_ACCOUNT_ID).currentBalance).toBe(2000);
    expect(t.ledger.find(POOL_ACCOUNT_ID, "demo-0-Lerato")!.uuid).toBe("demo-0-Lerato");
  });
});
