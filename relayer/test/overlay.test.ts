/**
 * The overlay makes a stateless bank stateful without inventing anything.
 * The mock runs in stateless mode here, which is exactly how the real sandbox behaves: a transfer
 * returns a PaymentReferenceNumber and nothing changes. The proxy sits in front and remembers.
 */
import { describe, expect, it, beforeEach } from "vitest";
import pino from "pino";
import { resolve } from "node:path";
import { Ledger, POOL_ACCOUNT_ID, TREASURER_ACCOUNT_ID } from "../src/mock/ledger.js";
import { createMockApp } from "../src/mock/server.js";
import { createOverlayApp } from "../src/overlay/server.js";
import { OverlayStore } from "../src/overlay/store.js";
import { InvestecClient } from "../src/investec/client.js";

const log = pino({ level: "silent" });

function setup() {
  const ledger = new Ledger();
  ledger.post(POOL_ACCOUNT_ID, "CREDIT", 2_000_000n, "seed", { silent: true });
  const sandbox = createMockApp({ ledger, log, selfUrl: "http://sandbox", stateless: true });
  const sandboxFetch: typeof fetch = (u, i) => Promise.resolve(sandbox.request(u as string, i as RequestInit));
  const pushed: string[] = [];
  const store = new OverlayStore();
  const proxy = createOverlayApp({
    sandboxUrl: "http://sandbox",
    store,
    log,
    clientId: "id",
    clientSecret: "s",
    apiKey: "k",
    selfUrl: "http://proxy",
    cardDir: resolve(process.cwd(), "..", "card"),
    relayerWebhookUrl: "http://relayer/webhook/transaction",
    fetchImpl: async (u, i) => {
      const url = String(u);
      if (url.startsWith("http://relayer")) {
        pushed.push(JSON.parse(i!.body as string).transaction.uuid);
        return new Response("{}", { status: 200 });
      }
      return sandboxFetch(u, i);
    },
  });
  const client = new InvestecClient({ baseUrl: "http://proxy", clientId: "id", clientSecret: "s", apiKey: "k", log, fetchImpl: (u, i) => Promise.resolve(proxy.request(u as string, i as RequestInit)) });
  const direct = new InvestecClient({ baseUrl: "http://sandbox", clientId: "id", clientSecret: "s", apiKey: "k", log, fetchImpl: sandboxFetch });
  return { proxy, client, direct, store, pushed, ledger };
}

describe("a stateless sandbox behind the overlay", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("the sandbox itself forgets a transfer", async () => {
    const before = (await t.direct.balance(POOL_ACCOUNT_ID)).currentBalance;
    const r = await t.direct.transfer(TREASURER_ACCOUNT_ID, [{ beneficiaryAccountId: POOL_ACCOUNT_ID, amount: "3.00", myReference: "STK-03 round-up", theirReference: "STK-03" }]);
    expect(r.TransferResponses[0]!.PaymentReferenceNumber).toMatch(/^UBP/);
    expect((await t.direct.balance(POOL_ACCOUNT_ID)).currentBalance).toBe(before);
    expect((await t.direct.transactions(POOL_ACCOUNT_ID)).some((x) => x.description === "STK-03")).toBe(false);
  });

  it("through the overlay, the same transfer is remembered under the sandbox's reference", async () => {
    const before = (await t.client.balance(POOL_ACCOUNT_ID)).currentBalance;
    const r = await t.client.transfer(TREASURER_ACCOUNT_ID, [{ beneficiaryAccountId: POOL_ACCOUNT_ID, amount: "3.00", myReference: "STK-03 round-up", theirReference: "STK-03" }]);
    const ref = r.TransferResponses[0]!.PaymentReferenceNumber;
    expect((await t.client.balance(POOL_ACCOUNT_ID)).currentBalance).toBe(before + 3);
    const txs = await t.client.transactions(POOL_ACCOUNT_ID);
    const credit = txs.find((x) => x.description === "STK-03")!;
    expect(credit.type).toBe("CREDIT");
    expect(credit.amount).toBe(3);
    expect(credit.uuid).toBe(`${ref}:CREDIT`);
    expect(credit.runningBalance).toBe(before + 3);
    // the sandbox's own rows come first, untouched
    expect(txs[0]!.description).toBe("seed");
    expect((await t.client.balance(TREASURER_ACCOUNT_ID)).currentBalance).toBe(250_000 - 3);
  });

  it("the auth path passes straight through", async () => {
    const bad = await t.proxy.request("http://proxy/za/pb/v1/accounts");
    expect(bad.status).toBe(401);
    expect(await t.client.accessToken()).toBe("mock-access-token");
  });

  it("paymultiple to a beneficiary debits the pool and updates the beneficiary's last payment", async () => {
    const r = await t.client.pay(POOL_ACCOUNT_ID, [{ beneficiaryId: "beneficiary:Lerato", amount: "20000.00", myReference: "Stokvel payout to Lerato", theirReference: "Stokvel round 1" }]);
    expect(r.TransferResponses[0]!.PaymentReferenceNumber).toMatch(/^UBP/);
    expect((await t.client.balance(POOL_ACCOUNT_ID)).currentBalance).toBe(0);
    expect((await t.client.beneficiaries())[0]!.lastPaymentAmount).toBe("20000.00");
  });

  it("the presenter stories are real sandbox calls: credit, steal, refund, double webhook", async () => {
    const post = async (path: string, body: unknown = {}) => {
    const r = await t.proxy.request(`http://proxy/__mock/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.json();
  };
    const credit = await post("credit", { memberNumber: "05", cents: 500_000 });
    expect(credit.sandbox.PaymentReferenceNumber).toMatch(/^UBP/);
    expect(credit.transaction.description).toBe("STK-05");
    await new Promise((r) => setTimeout(r, 10));
    expect(t.pushed).toHaveLength(1);
    expect((await t.client.balance(POOL_ACCOUNT_ID)).currentBalance).toBe(25_000);

    const steal = await post("steal", { cents: 100_000 });
    expect(steal.balance.currentBalance).toBe(24_000);
    const refund = await post("refund", { cents: 100_000 });
    expect(refund.balance.currentBalance).toBe(25_000);

    await post("double-webhook", { times: 2 });
    expect(t.pushed).toHaveLength(3);
    expect(new Set(t.pushed).size).toBe(1);
  });

  it("the card code's round-up is a real sandbox transfer, seen by the overlay", async () => {
    const r = await (await t.proxy.request("http://proxy/__mock/swipe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberNumber: "03", centsAmount: 8700 }) })).json();
    expect(r.cardCode).toBe("ok");
    expect(r.roundUpCents).toBe(300);
    expect(r.sandboxRef).toMatch(/^UBP/);
    expect((await t.client.transactions(POOL_ACCOUNT_ID)).at(-1)!.description).toBe("STK-03");
  });

  it("a restart keeps what the sandbox accepted, because the store is keyed by its references", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const file = resolve(mkdtempSync(resolve(tmpdir(), "overlay-")), "overlay.json");
    const a = new OverlayStore(file);
    a.record({ paymentRef: "UBP1", fromAccountId: "T", toAccountId: "P", cents: 300, myReference: "x", theirReference: "STK-03" });
    a.record({ paymentRef: "UBP1", fromAccountId: "T", toAccountId: "P", cents: 300, myReference: "x", theirReference: "STK-03" }); // same reference twice: once
    const b = new OverlayStore(file);
    expect(b.snapshot().refs).toEqual(["UBP1"]);
    expect(b.mergeBalance({ accountId: "P", currentBalance: 10, availableBalance: 10, currency: "ZAR" }).currentBalance).toBe(13);
  });
});
