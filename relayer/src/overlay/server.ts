import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { OverlayStore } from "./store.js";
import { InvestecClient } from "../investec/client.js";
import { randsToCents, centsToRandString } from "../investec/reference.js";
import type { Envelope, Balance, Beneficiary, PaymentItem, Transaction, TransferItem, TransferResult } from "../investec/types.js";
import type { Logger } from "../log.js";

export type OverlayOptions = {
  sandboxUrl: string;
  store: OverlayStore;
  log: Logger;
  /** credentials the proxy uses for its own calls (the presenter stories); the relayer's pass straight through */
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  /** which sandbox accounts play the pool and the treasurer; default: the first two the sandbox lists */
  poolAccountId?: string;
  treasurerAccountId?: string;
  relayerWebhookUrl?: string;
  cardDir?: string;
  selfUrl: string;
  fetchImpl?: typeof fetch;
};

/**
 * The stateful sandbox. A transparent proxy in front of openapisandbox.investec.com that records
 * every transfer the sandbox accepts, under the sandbox's own PaymentReferenceNumber, and folds
 * those into the sandbox's balance and transaction responses. Same routes, same shapes, same auth:
 * the relayer and the card code point here and can't tell.
 */
export function createOverlayApp(o: OverlayOptions) {
  const { store, log } = o;
  const doFetch = o.fetchImpl ?? fetch;
  const app = new Hono();
  app.use("*", cors());
  let accounts: string[] = [];

  async function forward(c: { req: { raw: Request; path: string; url: string } }) {
    const url = new URL(c.req.url);
    const target = o.sandboxUrl + url.pathname + url.search;
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");
    headers.delete("content-length");
    const body = ["GET", "HEAD"].includes(c.req.raw.method) ? undefined : await c.req.raw.text();
    return doFetch(target, { method: c.req.raw.method, headers, body });
  }

  const json = (r: Response, data: unknown) => new Response(JSON.stringify(data), { status: r.status, headers: { "content-type": "application/json" } });

  // reads: merge what the sandbox says with what it has accepted since
  app.get("/za/pb/v1/accounts", async (c) => {
    const r = await forward(c);
    if (!r.ok) return r;
    const body = (await r.json()) as Envelope<{ accounts: Array<{ accountId: string }> }>;
    accounts = body.data.accounts.map((a) => a.accountId);
    return json(r, body);
  });
  app.get("/za/pb/v1/accounts/beneficiaries", async (c) => {
    const r = await forward(c);
    if (!r.ok) return r;
    const body = (await r.json()) as Envelope<Beneficiary[]>;
    body.data = body.data.map((b) => ({ ...b, ...(store.beneficiaryPatch(b.beneficiaryId) ?? {}) }));
    return json(r, body);
  });
  app.get("/za/pb/v1/accounts/:id/balance", async (c) => {
    const r = await forward(c);
    if (!r.ok) return r;
    const body = (await r.json()) as Envelope<Balance>;
    body.data = store.mergeBalance(body.data);
    return json(r, body);
  });
  app.get("/za/pb/v1/accounts/:id/transactions", async (c) => {
    const r = await forward(c);
    if (!r.ok) return r;
    const body = (await r.json()) as Envelope<{ transactions: Transaction[] }>;
    body.data.transactions = store.mergeTransactions(c.req.param("id"), body.data.transactions);
    return json(r, body);
  });

  // writes: only what the sandbox accepted is recorded, under its own reference
  app.post("/za/pb/v1/accounts/:id/transfermultiple", async (c) => {
    const reqBody = JSON.parse(await c.req.raw.clone().text()) as { transferList: TransferItem[] };
    const r = await forward(c);
    if (!r.ok) return r;
    const body = (await r.json()) as Envelope<TransferResult>;
    body.data.TransferResponses.forEach((res, i) => {
      const t = reqBody.transferList[i];
      if (!t || body.data.ErrorMessage) return;
      store.record({ paymentRef: res.PaymentReferenceNumber, fromAccountId: c.req.param("id"), toAccountId: t.beneficiaryAccountId, cents: Number(randsToCents(t.amount)), myReference: t.myReference, theirReference: t.theirReference });
      log.info({ ref: res.PaymentReferenceNumber, amount: t.amount, to: t.beneficiaryAccountId }, "sandbox accepted a transfer, recorded");
    });
    return json(r, body);
  });
  app.post("/za/pb/v1/accounts/:id/paymultiple", async (c) => {
    const reqBody = JSON.parse(await c.req.raw.clone().text()) as { paymentList: PaymentItem[] };
    const r = await forward(c);
    if (!r.ok) return r;
    const body = (await r.json()) as Envelope<TransferResult>;
    body.data.TransferResponses.forEach((res, i) => {
      const p = reqBody.paymentList[i];
      if (!p || body.data.ErrorMessage) return;
      store.record({ paymentRef: res.PaymentReferenceNumber, fromAccountId: c.req.param("id"), beneficiaryId: p.beneficiaryId, cents: Number(randsToCents(p.amount)), myReference: p.myReference, theirReference: p.theirReference });
      log.info({ ref: res.PaymentReferenceNumber, amount: p.amount, beneficiary: p.beneficiaryId }, "sandbox accepted a payment, recorded");
    });
    return json(r, body);
  });

  // ---------------------------------------------------------- the presenter's stories, as real sandbox calls
  const own = o.clientId
    ? new InvestecClient({ baseUrl: o.selfUrl, clientId: o.clientId, clientSecret: o.clientSecret ?? "", apiKey: o.apiKey ?? "", log, fetchImpl: (u, i) => Promise.resolve(app.request(u as string, i as RequestInit)) })
    : null;
  async function roles(): Promise<{ pool: string; treasurer: string }> {
    if (!accounts.length && own) accounts = (await own.accounts()).map((a) => a.accountId);
    const pool: string | undefined = o.poolAccountId ?? accounts[0];
    if (!pool) throw new Error("no sandbox accounts");
    const treasurer: string = o.treasurerAccountId ?? accounts[1] ?? pool;
    return { pool, treasurer };
  }
  async function push(tx: Transaction) {
    if (!o.relayerWebhookUrl) return;
    try {
      const r = await doFetch(o.relayerWebhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: tx.accountId, transaction: tx }) });
      log.info({ id: tx.uuid, status: r.status }, "webhook delivered");
    } catch (err) {
      // the relayer being down is a demo (DEMO 6), not a reason for the bank to fall over: the poll picks it up
      log.warn({ id: tx.uuid, err: String(err) }, "webhook not delivered, the relayer will poll it");
    }
  }

  const admin = new Hono();
  admin.get("/state", async (c) => {
    const { pool, treasurer } = await roles();
    const [balance, transactions] = own ? await Promise.all([own.balance(pool), own.transactions(pool)]) : [null, []];
    return c.json({ pool: { accountId: pool, balance, transactions: transactions.slice(-12).reverse() }, treasurer: { accountId: treasurer }, overlay: store.snapshot().refs.length });
  });
  /** A member pays in: a real transfer from the treasurer's sandbox account to the pool, reference STK-nn. */
  admin.post("/credit", async (c) => {
    if (!own) return c.json({ error: "the proxy has no credentials for its own calls" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { memberNumber?: string; cents?: number };
    const { pool, treasurer } = await roles();
    const ref = `STK-${b.memberNumber ?? "05"}`;
    const r = await own.transfer(treasurer, [{ beneficiaryAccountId: pool, amount: centsToRandString(b.cents ?? 500_000), myReference: `${ref} contribution`, theirReference: ref }]);
    const tx = store.latestCredit(pool, (t) => t.description === ref);
    if (tx) void push(stripInternal(tx));
    return c.json({ sandbox: r.TransferResponses[0], transaction: tx ? stripInternal(tx) : null });
  });
  /** The treasurer takes money out: a real transfer from the pool to the treasurer's own account. */
  admin.post("/steal", async (c) => {
    if (!own) return c.json({ error: "the proxy has no credentials for its own calls" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { cents?: number };
    const { pool, treasurer } = await roles();
    const r = await own.transfer(pool, [{ beneficiaryAccountId: treasurer, amount: centsToRandString(b.cents ?? 100_000), myReference: "Admin fees", theirReference: "Admin fees" }]);
    log.warn({ ref: r.TransferResponses[0]?.PaymentReferenceNumber }, "the treasurer took money out, and the sandbox accepted it");
    return c.json({ sandbox: r.TransferResponses[0], balance: await own.balance(pool) });
  });
  admin.post("/refund", async (c) => {
    if (!own) return c.json({ error: "the proxy has no credentials for its own calls" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { cents?: number };
    const { pool, treasurer } = await roles();
    const r = await own.transfer(treasurer, [{ beneficiaryAccountId: pool, amount: centsToRandString(b.cents ?? 100_000), myReference: "Returned", theirReference: "Returned" }]);
    return c.json({ sandbox: r.TransferResponses[0], balance: await own.balance(pool) });
  });
  /** DEMO 5: the latest member credit's webhook, delivered twice. */
  admin.post("/double-webhook", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { times?: number };
    const { pool } = await roles();
    const tx = store.latestCredit(pool, (t) => /STK/i.test(t.description));
    if (!tx) return c.json({ error: "no member credit to replay" }, 404);
    for (let i = 0; i < Number(b.times ?? 2); i++) await push(stripInternal(tx));
    return c.json({ replayed: tx.uuid, times: Number(b.times ?? 2) });
  });
  /** DEMO 2: run the real card code against this proxy, so its round-up is a real sandbox transfer. */
  admin.post("/swipe", async (c) => {
    if (!own) return c.json({ error: "the proxy has no credentials for its own calls" }, 400);
    const b = (await c.req.json().catch(() => ({}))) as { memberNumber?: string; centsAmount?: number; merchant?: string; mcc?: string };
    const { pool, treasurer } = await roles();
    const transaction = { accountNumber: "sandbox", dateTime: new Date().toISOString(), centsAmount: Number(b.centsAmount ?? 8700), currencyCode: "zar", type: "card", reference: "simulation", card: { id: "1234567" }, merchant: { category: { code: b.mcc ?? "5462", key: "bakeries", name: "Bakeries" }, name: b.merchant ?? "The Coders Bakery", city: "Johannesburg", country: { code: "ZA", alpha3: "ZAF", name: "South Africa" } } };
    const before = store.snapshot().refs.length;
    const result = await runCardCode(transaction, b.memberNumber ?? "03", pool, treasurer);
    const tx = store.snapshot().refs.length > before ? store.latestCredit(pool) : undefined;
    if (tx) void push(stripInternal(tx));
    return c.json({ transaction, roundUpCents: tx?.cents ?? 0, sandboxRef: tx?.paymentRef ?? null, ...result });
  });
  admin.post("/reset", (c) => {
    store.reset();
    return c.json({ ok: true });
  });
  app.route("/__mock", admin);
  app.get("/health", (c) => c.json({ ok: true, mode: "sandbox-overlay", sandbox: o.sandboxUrl, recorded: store.snapshot().refs.length }));

  // everything else (the token endpoint included) passes straight through
  app.all("/*", (c) => forward(c));

  async function runCardCode(transaction: unknown, memberNumber: string, pool: string, treasurer: string) {
    const dir = o.cardDir ?? resolve(process.cwd(), "..", "card");
    const mainPath = resolve(dir, "main.js");
    if (!existsSync(mainPath)) return { cardCode: "missing", logs: [] as string[] };
    const env: Record<string, string> = { baseUrl: o.selfUrl, clientId: o.clientId ?? "", secret: o.clientSecret ?? "", apiKey: o.apiKey ?? "", memberNumber, fromAccountId: treasurer, toAccountId: pool, profileId: "", roundUpToCents: "1000", minRoundUpCents: "100", allowSimulation: "true" };
    const logs: string[] = [];
    const cardFetch = (url: string, init?: RequestInit) => (url.startsWith(o.selfUrl) ? Promise.resolve(app.request(url, init)) : doFetch(url, init));
    const sandbox = { process: { env }, fetch: cardFetch, console: { log: (...a: unknown[]) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")) }, Buffer, btoa, setTimeout };
    try {
      const hooks = vm.runInNewContext(readFileSync(mainPath, "utf8") + "\n;({ beforeTransaction, afterTransaction })", sandbox, { filename: "main.js", timeout: 15_000 }) as { afterTransaction: (t: unknown) => Promise<void> };
      await hooks.afterTransaction(transaction);
      return { cardCode: "ok", logs };
    } catch (err) {
      logs.push(`error: ${String(err)}`);
      return { cardCode: "error", logs };
    }
  }

  return app;
}

function stripInternal(t: { paymentRef: string; cents: number; at: number } & Transaction): Transaction {
  const { paymentRef: _p, cents: _c, at: _a, ...rest } = t;
  return rest;
}
