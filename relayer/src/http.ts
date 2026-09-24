import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { Hex, PublicClient } from "viem";
import type { StokvelContract } from "./chain.js";
import { errorText } from "./chain.js";
import type { Feed } from "./feed.js";
import type { Logger } from "./log.js";
import type { Config } from "./config.js";
import type { ContributionLoop } from "./loops/contributions.js";
import type { Transaction } from "./investec/types.js";
import type { InvestecClient } from "./investec/client.js";

/** BigInts don't survive JSON.stringify; the admin routes return loop results that carry them. */
const safe = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export type HttpDeps = {
  cfg: Config;
  contract: StokvelContract;
  contractV1: StokvelContract | null;
  publicClient: PublicClient;
  contributions: ContributionLoop;
  reservesTick: () => Promise<unknown>;
  payoutsTick: () => Promise<unknown>;
  feed: Feed;
  log: Logger;
  status: () => Record<string, unknown>;
  investec: InvestecClient;
  accountId: string;
  onKill?: () => void;
};

/**
 * Loop 4 lives here: gasless votes. The signing station posts a signature, the relayer pays the gas.
 * Plus the webhook the mock bank pushes to, and the presenter's admin routes.
 */
export function createHttpApp(d: HttpDeps) {
  const { cfg, contract, feed, log } = d;
  const app = new Hono();
  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true, ...d.status() }));

  /** What the dashboard's left half shows. The stage app never holds Investec credentials. */
  app.get("/bank", async (c) => {
    try {
      const [balance, transactions] = await Promise.all([d.investec.balance(d.accountId), d.investec.transactions(d.accountId)]);
      return c.json({ accountId: d.accountId, balance, transactions: transactions.slice(-15).reverse(), at: Date.now() });
    } catch (err) {
      return c.json({ error: String(err).split("\n")[0] }, 502);
    }
  });
  app.get("/feed", (c) => c.json(feed.since(Number(c.req.query("since") ?? 0))));
  app.get("/feed/stream", (c) =>
    streamSSE(c, async (stream) => {
      for (const item of feed.last(50)) await stream.writeSSE({ data: JSON.stringify(item), id: String(item.seq) });
      let alive = true;
      stream.onAbort(() => {
        alive = false;
      });
      while (alive) {
        const next = await new Promise<import("./feed.js").FeedItem | null>((res) => {
          const t = setTimeout(() => res(null), 15_000);
          feed.onNext((i) => {
            clearTimeout(t);
            res(i);
          });
        });
        if (next) await stream.writeSSE({ data: JSON.stringify(next), id: String(next.seq) });
        else await stream.writeSSE({ event: "ping", data: "" });
      }
    }),
  );

  // ---------------------------------------------------------- gasless signatures
  app.post("/join", async (c) => {
    const { signature } = (await c.req.json()) as { signature: Hex };
    try {
      const hash = await contract.write.joinBySig([signature]);
      feed.push({ kind: "vote", title: "Member joined", detail: "signed the constitution", hash });
      return c.json({ ok: true, hash });
    } catch (err) {
      const text = errorText(err);
      feed.push({ kind: "refused", title: "Join refused", detail: text, error: text });
      return c.json({ ok: false, error: text }, 400);
    }
  });

  app.post("/votes", async (c) => {
    const { proposalId, nonce, signature } = (await c.req.json()) as { proposalId: string; nonce: string; signature: Hex };
    try {
      const hash = await contract.write.voteBySig([BigInt(proposalId), BigInt(nonce), signature]);
      feed.push({ kind: "vote", title: "Vote counted", detail: `proposal ${proposalId}`, hash });
      return c.json({ ok: true, hash });
    } catch (err) {
      const text = errorText(err);
      log.warn({ err: text }, "vote refused");
      feed.push({ kind: "refused", title: "Vote refused", detail: text, error: text });
      return c.json({ ok: false, error: text }, 400);
    }
  });

  app.post("/propose", async (c) => {
    const b = (await c.req.json()) as { kind: number; value?: string; memberId?: number; newAddr?: Hex };
    try {
      const hash = await contract.write.propose([b.kind, BigInt(b.value ?? 0), b.memberId ?? 0, b.newAddr ?? "0x0000000000000000000000000000000000000000"]);
      const receipt = await d.publicClient.waitForTransactionReceipt({ hash });
      const id = (await contract.read.proposalCount()) - 1n;
      feed.push({ kind: "vote", title: "Proposal opened", detail: `#${id}`, hash });
      return c.json({ ok: true, hash, proposalId: id.toString(), block: receipt.blockNumber.toString() });
    } catch (err) {
      const text = errorText(err);
      return c.json({ ok: false, error: text }, 400);
    }
  });

  app.post("/execute", async (c) => {
    const { proposalId } = (await c.req.json()) as { proposalId: string };
    try {
      const hash = await contract.write.execute([BigInt(proposalId)]);
      feed.push({ kind: "vote", title: "Proposal executed", detail: `#${proposalId}`, hash });
      return c.json({ ok: true, hash });
    } catch (err) {
      const text = errorText(err);
      return c.json({ ok: false, error: text }, 400);
    }
  });

  app.get("/nonce/:address", async (c) => {
    const n = await contract.read.nonces([c.req.param("address") as Hex]);
    return c.json({ nonce: n.toString() });
  });

  // ---------------------------------------------------------- webhook from the (mock) bank
  // Trusts the push and sends straight to the contract: the contract is the one that says no.
  app.post("/webhook/transaction", async (c) => {
    const body = (await c.req.json()) as { accountId: string; transaction: Transaction; target?: "v1" | "v2" };
    const target = body.target === "v1" && d.contractV1 ? d.contractV1 : contract;
    const result = await d.contributions.record(body.transaction, { via: "webhook", target });
    return c.json({ result });
  });

  // ---------------------------------------------------------- presenter admin
  const admin = new Hono();
  admin.post("/tick", async (c) => {
    const [r, p] = await Promise.all([d.reservesTick(), d.payoutsTick()]);
    return c.json(safe({ reserves: r, payouts: p }));
  });
  admin.post("/poll", async (c) => c.json(safe(await d.contributions.poll())));

  /** Anvil only: move the clock to the end of the round and mine a block. */
  admin.post("/warp", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { seconds?: number; toRoundEnd?: boolean };
    if (cfg.CHAIN_ID !== 31337) return c.json({ ok: false, error: "time travel only works on Anvil" }, 400);
    let seconds = Number(b.seconds ?? 0);
    if (b.toRoundEnd || !seconds) {
      const [block, endsAt] = await Promise.all([d.publicClient.getBlock(), contract.read.roundEndsAt()]);
      seconds = Math.max(1, Number(BigInt(endsAt) - block.timestamp) + 1);
    }
    await d.publicClient.request({ method: "evm_increaseTime" as never, params: [seconds] as never });
    await d.publicClient.request({ method: "evm_mine" as never, params: [] as never });
    feed.push({ kind: "info", title: "Clock moved", detail: `${seconds} seconds, to month end` });
    return c.json({ ok: true, seconds });
  });

  /** DEMO 5 on demand: push a transaction to the contract again, choosing V1 or V2. */
  admin.post("/replay", async (c) => {
    const b = (await c.req.json()) as { transaction: Transaction; target?: "v1" | "v2" };
    const target = b.target === "v1" && d.contractV1 ? d.contractV1 : contract;
    return c.json({ result: await d.contributions.record(b.transaction, { via: "webhook", target }) });
  });

  /** DEMO "kill the server": exit, and let the launcher's restart loop bring a fresh process up. */
  admin.post("/kill", (c) => {
    feed.push({ kind: "info", title: "Relayer stopped", detail: "by the presenter" });
    setTimeout(() => (d.onKill ? d.onKill() : process.exit(0)), 200);
    return c.json({ ok: true });
  });

  app.route("/admin", admin);
  return app;
}
