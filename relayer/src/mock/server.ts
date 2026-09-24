import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { Ledger, POOL_ACCOUNT_ID, TREASURER_ACCOUNT_ID, PROFILE_ID, ddmmyyyy } from "./ledger.js";
import type { LedgerTx } from "./ledger.js";
import { randsToCents } from "../investec/reference.js";
import type { PaymentItem, TransferItem } from "../investec/types.js";
import type { Logger } from "../log.js";

export type MockOptions = {
  ledger: Ledger;
  log: Logger;
  /** where the relayer listens; every new pool credit is pushed there as a webhook */
  relayerWebhookUrl?: string;
  /** path to card/main.js and card/env.json, so "swipe" runs the real card code */
  cardDir?: string;
  fetchImpl?: typeof fetch;
  /** the URL card code should call, normally this server's own address */
  selfUrl: string;
};

const TOKEN = "mock-access-token";

function envelope<T>(c: { req: { url: string } }, data: T) {
  return { data, links: { self: c.req.url }, meta: { totalPages: 1 } };
}

/**
 * The stateful mirror of the Investec sandbox. Same routes, same response shapes, backed by the
 * in-memory ledger, plus /__mock/* routes the presenter panel uses to tell stories.
 */
export function createMockApp(o: MockOptions) {
  const { ledger, log } = o;
  const doFetch = o.fetchImpl ?? fetch;
  const app = new Hono();
  app.use("*", cors());

  // ---------------------------------------------------------- auth
  app.post("/identity/v2/oauth2/token", async (c) => {
    const auth = c.req.header("authorization") ?? "";
    const apiKey = c.req.header("x-api-key") ?? "";
    const body = await c.req.text();
    if (!auth.startsWith("Basic ") || !apiKey || !body.includes("grant_type=client_credentials")) {
      return c.json({ error: "invalid_client" }, 401);
    }
    return c.json({ access_token: TOKEN, token_type: "Bearer", expires_in: 1799, scope: "accounts" });
  });

  // only the API routes need a bearer token; /__mock and /health are the presenter's
  const authed = new Hono();
  authed.use("/za/*", async (c, next) => {
    if (c.req.header("authorization") !== `Bearer ${TOKEN}`) return c.json({ message: "Unauthorized" }, 401);
    await next();
  });

  // ---------------------------------------------------------- reads
  authed.get("/za/pb/v1/accounts", (c) => c.json(envelope(c, { accounts: ledger.accounts })));
  authed.get("/za/pb/v1/accounts/beneficiaries", (c) => c.json(envelope(c, ledger.beneficiaries)));
  authed.get("/za/pb/v1/accounts/:id/balance", (c) => {
    try {
      return c.json(envelope(c, ledger.balance(c.req.param("id"))));
    } catch {
      return c.json("The specified account is invalid. (Parameter 'accountId')", 400);
    }
  });
  authed.get("/za/pb/v1/accounts/:id/transactions", (c) => {
    try {
      const list = ledger.transactions(c.req.param("id"), c.req.query("fromDate"), c.req.query("toDate"));
      return c.json(envelope(c, { transactions: list }));
    } catch {
      return c.json("The specified account is invalid. (Parameter 'accountId')", 400);
    }
  });

  // ---------------------------------------------------------- writes
  authed.post("/za/pb/v1/accounts/:id/transfermultiple", async (c) => {
    const from = c.req.param("id");
    const body = (await c.req.json()) as { transferList: TransferItem[]; profileId?: string };
    return c.json(
      envelope(
        c,
        respond(
          body.transferList.map((t) =>
            ledger.transfer(from, t.beneficiaryAccountId, randsToCents(t.amount), t.myReference, t.theirReference),
          ),
          body.transferList.map((t) => [t.theirReference, t.beneficiaryAccountId] as const),
        ),
      ),
    );
  });
  authed.post("/za/pb/v1/accounts/:id/paymultiple", async (c) => {
    const from = c.req.param("id");
    const body = (await c.req.json()) as { paymentList: PaymentItem[] };
    if (body.paymentList.length > 50) return c.json("At most 50 payments per request", 400);
    return c.json(
      envelope(
        c,
        respond(
          body.paymentList.map((p) =>
            ledger.transfer(from, p.beneficiaryId, randsToCents(p.amount), p.myReference, p.theirReference),
          ),
          body.paymentList.map((p) => [p.theirReference, p.beneficiaryId] as const),
        ),
      ),
    );
  });
  app.route("/", authed);

  function respond(
    results: Array<{ paymentReference: string }>,
    refs: ReadonlyArray<readonly [string, string]>,
  ) {
    return {
      TransferResponses: results.map((r, i) => ({
        PaymentReferenceNumber: r.paymentReference,
        PaymentDate: ddmmyyyy(new Date()),
        Status: `- No authorisation necessary <BR>- Payment/Transfer effective date ${ddmmyyyy(new Date())}`,
        BeneficiaryName: refs[i]![0],
        BeneficiaryAccountId: refs[i]![1],
        AuthorisationRequired: false,
      })),
      ErrorMessage: null,
    };
  }

  // ---------------------------------------------------------- webhooks (a mock convenience)
  // Investec's PB API has no transaction webhooks; the relayer polls. The mock pushes as well, so the
  // "double webhook" story can be told on stage. See docs/INVESTEC_API_NOTES.md.
  async function push(tx: LedgerTx) {
    if (!o.relayerWebhookUrl) return;
    try {
      const res = await doFetch(o.relayerWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: tx.accountId, transaction: stripInternal(tx) }),
      });
      log.info({ id: tx.id, status: res.status }, "webhook delivered");
    } catch (err) {
      log.warn({ err: String(err) }, "webhook failed");
    }
  }
  ledger.listeners.push((accountId, tx) => {
    if (accountId === POOL_ACCOUNT_ID && tx.type === "CREDIT") void push(tx);
  });

  // ---------------------------------------------------------- presenter stories
  const admin = new Hono();

  admin.get("/state", (c) =>
    c.json({
      pool: { accountId: POOL_ACCOUNT_ID, balance: ledger.balance(POOL_ACCOUNT_ID), transactions: ledger.transactions(POOL_ACCOUNT_ID).slice(-12).reverse() },
      treasurer: { accountId: TREASURER_ACCOUNT_ID, balance: ledger.balance(TREASURER_ACCOUNT_ID) },
    }),
  );

  /** DEMO 2: a card swipe. Runs card/main.js the way the Investec card runtime would. */
  admin.post("/swipe", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      memberNumber?: string;
      centsAmount?: number;
      merchant?: string;
      mcc?: string;
    };
    const centsAmount = Number(body.centsAmount ?? 8700);
    const memberNumber = body.memberNumber ?? "03";
    const merchant = body.merchant ?? "The Coders Bakery";
    const transaction = {
      accountNumber: "10010010011",
      dateTime: new Date().toISOString(),
      centsAmount,
      currencyCode: "zar",
      type: "card",
      reference: "simulation",
      card: { id: "1234567" },
      merchant: {
        category: { code: body.mcc ?? "5462", key: "bakeries", name: "Bakeries" },
        name: merchant,
        city: "Johannesburg",
        country: { code: "ZA", alpha3: "ZAF", name: "South Africa" },
      },
    };
    // the purchase itself lands on the member's own account; only the round-up goes to the pool
    const before = ledger.balances.get(POOL_ACCOUNT_ID)!;
    const result = await runCardCode(transaction, memberNumber);
    const after = ledger.balances.get(POOL_ACCOUNT_ID)!;
    return c.json({ transaction, roundUpCents: Number(after - before), ...result });
  });

  /** DEMO 4: the treasurer moves money out of the pool to a personal account. */
  admin.post("/steal", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cents?: number };
    const cents = BigInt(body.cents ?? 100_000);
    const r = ledger.transfer(POOL_ACCOUNT_ID, TREASURER_ACCOUNT_ID, cents, "Admin fees", "Admin fees");
    log.warn({ cents: String(cents) }, "the treasurer took money out");
    return c.json({ debit: stripInternal(r.debit), balance: ledger.balance(POOL_ACCOUNT_ID) });
  });

  admin.post("/refund", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cents?: number };
    const cents = BigInt(body.cents ?? 100_000);
    const r = ledger.transfer(TREASURER_ACCOUNT_ID, POOL_ACCOUNT_ID, cents, "Returned", "Returned");
    return c.json({ credit: stripInternal(r.credit!), balance: ledger.balance(POOL_ACCOUNT_ID) });
  });

  /** DEMO 5: the same credit's webhook, delivered twice. */
  admin.post("/double-webhook", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: string; times?: number };
    const list = ledger.txs.get(POOL_ACCOUNT_ID)!;
    // the latest member contribution, not just any credit (a refund has no STK reference)
    const tx = body.id ? list.find((t) => t.id === body.id) : [...list].reverse().find((t) => t.type === "CREDIT" && /STK/i.test(t.description));
    if (!tx) return c.json({ error: "no credit to replay" }, 404);
    const times = Number(body.times ?? 2);
    for (let i = 0; i < times; i++) await push(tx);
    return c.json({ replayed: tx.id, times });
  });

  /** A plain credit with a reference, for rehearsals without the card code. */
  admin.post("/credit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { memberNumber?: string; cents?: number };
    const cents = BigInt(body.cents ?? 500_000);
    const tx = ledger.post(POOL_ACCOUNT_ID, "CREDIT", cents, `STK-${body.memberNumber ?? "05"}`);
    return c.json(stripInternal(tx));
  });

  admin.post("/seed", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string };
    const n = ledger.seed(body.path ?? resolve(process.cwd(), "..", "contracts", "deployments", "demo-ledger.jsonl"));
    return c.json({ loaded: n, balance: ledger.balance(POOL_ACCOUNT_ID) });
  });

  admin.post("/reset", (c) => {
    ledger.reset();
    return c.json({ ok: true });
  });

  app.route("/__mock", admin);
  app.get("/health", (c) => c.json({ ok: true, mode: "mock" }));

  /**
   * Run card/main.js in a sandbox shaped like the Investec card runtime: process.env from env.json
   * (values forced to strings, like production), fetch available, no Buffer surprises.
   */
  async function runCardCode(transaction: unknown, memberNumber: string) {
    const dir = o.cardDir ?? resolve(process.cwd(), "..", "card");
    const mainPath = resolve(dir, "main.js");
    if (!existsSync(mainPath)) return { cardCode: "missing", logs: [] as string[] };
    const envPath = existsSync(resolve(dir, "env.json")) ? resolve(dir, "env.json") : resolve(dir, "env.json.example");
    const rawEnv = JSON.parse(readFileSync(envPath, "utf8")) as Record<string, unknown>;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawEnv)) env[k] = String(v);
    // point the card at this mock and at the member whose card was swiped
    env.baseUrl = o.selfUrl;
    env.memberNumber = memberNumber;
    env.clientId = env.clientId || "mock";
    env.secret = env.secret || "mock";
    env.apiKey = env.apiKey || "mock";
    env.fromAccountId = TREASURER_ACCOUNT_ID;
    env.toAccountId = POOL_ACCOUNT_ID;
    env.profileId = PROFILE_ID;

    const logs: string[] = [];
    // calls to this server go straight to the app, everything else to the network
    const cardFetch = (url: string, init?: RequestInit) =>
      url.startsWith(o.selfUrl) ? Promise.resolve(app.request(url, init)) : doFetch(url, init);
    const sandbox = {
      process: { env },
      fetch: cardFetch,
      console: { log: (...a: unknown[]) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")) },
      Buffer,
      btoa,
      setTimeout,
    };
    const code = readFileSync(mainPath, "utf8") + "\n;({ beforeTransaction, afterTransaction })";
    try {
      const hooks = vm.runInNewContext(code, sandbox, { filename: "main.js", timeout: 15_000 }) as {
        afterTransaction: (t: unknown) => Promise<void>;
      };
      await hooks.afterTransaction(transaction);
      return { cardCode: "ok", logs };
    } catch (err) {
      logs.push(`error: ${String(err)}`);
      return { cardCode: "error", logs };
    }
  }

  return app;
}

function stripInternal(t: LedgerTx) {
  const { id: _id, cents: _c, at: _a, ...rest } = t;
  return rest;
}
