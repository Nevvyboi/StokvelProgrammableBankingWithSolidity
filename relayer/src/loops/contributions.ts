import type { Hex } from "viem";
import type { InvestecClient } from "../investec/client.js";
import type { Transaction } from "../investec/types.js";
import { parseReference, randsToCents, refOf, stableTxId } from "../investec/reference.js";
import type { StokvelContract } from "../chain.js";
import { errorText } from "../chain.js";
import type { Logger } from "../log.js";
import type { Feed } from "../feed.js";

export type ContributionLoop = ReturnType<typeof createContributionLoop>;

/**
 * Loop 1: contributions. Poll the stokvel account, find credits with an STK-nn reference, and record
 * each one on chain once. Idempotent by construction: the ref is keccak256 of the bank's stable
 * transaction id, and the contract refuses a ref it has seen. We also ask the contract before
 * sending, to save a failed transaction on a restart.
 */
export function createContributionLoop(o: {
  investec: InvestecClient;
  accountId: string;
  contract: StokvelContract;
  log: Logger;
  feed: Feed;
  fromDate?: string;
}) {
  const { investec, contract, log, feed } = o;
  const sent = new Set<string>();
  const inFlight = new Map<string, Promise<string>>();

  async function record(tx: Transaction, opts: { via: "poll" | "webhook"; target?: StokvelContract } = { via: "poll" }) {
    const target = opts.target ?? contract;
    if (tx.type !== "CREDIT" || tx.status !== "POSTED" || Number(tx.postedOrder) === 0) return "skipped";
    const memberId = parseReference(tx.description);
    if (memberId === null) return "no-reference";
    const id = stableTxId(tx);
    const ref = refOf(id);
    const cents = randsToCents(tx.amount);

    // the polling path checks first; the webhook path trusts the bank's push, so the contract's
    // own AlreadyRecorded is what stops a repeat (that is DEMO 5)
    if (opts.via === "poll") {
      if (sent.has(id)) return "already-sent";
      const pending = inFlight.get(id);
      if (pending) {
        await pending;
        return "already-sent";
      }
      if (await target.read.seen([ref])) {
        sent.add(id);
        return "already-on-chain";
      }
    }
    const work = (async () => {
      try {
        const hash = await target.write.recordContribution([memberId, cents, ref]);
        sent.add(id);
        log.info({ memberId, cents: String(cents), id, hash, via: opts.via }, "recordContribution");
        feed.push({ kind: "bank->chain", title: `Contribution recorded`, detail: `${tx.description}: ${String(cents)} cents`, hash });
        return "recorded";
      } catch (err) {
        const text = errorText(err);
        if (opts.via === "poll" && text.startsWith("AlreadyRecorded")) {
          // the webhook got there first; that is the contract doing its job, not news
          sent.add(id);
          log.debug({ id }, "already recorded via webhook");
          return "already-on-chain";
        }
        log.warn({ memberId, id, err: text, via: opts.via }, "recordContribution refused");
        feed.push({ kind: "refused", title: `Contract refused`, detail: text, error: text });
        return `refused:${text}`;
      }
    })();
    if (opts.via === "poll") inFlight.set(id, work);
    try {
      return await work;
    } finally {
      inFlight.delete(id);
    }
  }

  async function poll() {
    const list = await investec.transactions(o.accountId, o.fromDate ? { fromDate: o.fromDate } : {});
    let recorded = 0;
    for (const tx of list) {
      const r = await record(tx, { via: "poll" });
      if (r === "recorded") recorded += 1;
    }
    return { seen: list.length, recorded };
  }

  return { poll, record, sent };
}

export type RecordResult = Awaited<ReturnType<ContributionLoop["record"]>>;
export type { Hex };
