import type { PublicClient } from "viem";
import type { InvestecClient } from "../investec/client.js";
import { beneficiaryId32, centsToRandString, formatRands, refOf } from "../investec/reference.js";
import type { StokvelContract } from "../chain.js";
import { decodeRevert, errorText } from "../chain.js";
import type { Logger } from "../log.js";
import type { Feed } from "../feed.js";
import type { Member } from "../config.js";

/**
 * Loop 3: payouts. When the round is over and the reserves are fresh, close it. For every PayoutDue
 * that is not settled, pay the member through Investec and confirm on chain with the bank's payment
 * reference. Idempotent: confirmPayout refuses a settled round and a reused reference, and we check
 * both before paying so a restart never pays twice.
 */
export function createPayoutLoop(o: {
  investec: InvestecClient;
  accountId: string;
  profileId?: string;
  method: "pay" | "transfer";
  members: Member[];
  contract: StokvelContract;
  publicClient: PublicClient;
  log: Logger;
  feed: Feed;
  shadow?: InvestecClient;
}) {
  const { investec, contract, publicClient, log, feed } = o;
  const inFlight = new Set<string>();
  let lastCloseError: string | null = null;

  /** Try to close the round. Returns the contract's reason when it can't. */
  async function tryClose(): Promise<{ closed: boolean; reason?: string }> {
    const [block, endsAt] = await Promise.all([publicClient.getBlock(), contract.read.roundEndsAt()]);
    if (block.timestamp < BigInt(endsAt)) return { closed: false, reason: "RoundStillOpen" };
    try {
      await contract.simulate.closeRound();
    } catch (err) {
      const d = decodeRevert(err);
      const text = errorText(err);
      if (text !== lastCloseError) {
        log.warn({ err: text }, "closeRound would revert");
        if (d?.name === "ReservesShort") {
          feed.push({ kind: "refused", title: "Payout frozen", detail: `bank holds ${d.args[0]}, club is owed ${d.args[1]}`, error: text });
        }
        lastCloseError = text;
      }
      return { closed: false, reason: text };
    }
    const hash = await contract.write.closeRound();
    lastCloseError = null;
    log.info({ hash }, "closeRound");
    feed.push({ kind: "info", title: "Round closed", detail: "the pot is due to the next member in rotation", hash });
    return { closed: true };
  }

  /** Pay and confirm every unsettled round. */
  async function settle(): Promise<number> {
    const round = await contract.read.round();
    let settled = 0;
    for (let r = 0n; r < round; r++) {
      const [memberId, isSettled, cents] = await contract.read.payouts([r]);
      if (isSettled || cents === 0n) continue;
      const key = r.toString();
      if (inFlight.has(key)) continue;
      inFlight.add(key);
      try {
        await payRound(r, memberId, cents);
        settled += 1;
      } catch (err) {
        log.error({ round: key, err: errorText(err) }, "payout failed");
      } finally {
        inFlight.delete(key);
      }
    }
    return settled;
  }

  async function payRound(round: bigint, memberId: number, cents: bigint) {
    const member = o.members[memberId];
    if (!member) throw new Error(`no bank details for memberId ${memberId}`);
    const amount = centsToRandString(cents);
    const myReference = `Stokvel payout to ${member.name}`.slice(0, 40);
    const theirReference = `Stokvel round ${round + 1n}`.slice(0, 40);

    const result =
      o.method === "pay"
        ? await investec.pay(o.accountId, [{ beneficiaryId: member.investecId, amount, myReference, theirReference }])
        : await investec.transfer(
            o.accountId,
            [{ beneficiaryAccountId: member.investecId, amount, myReference, theirReference }],
            o.profileId,
          );
    if (result.ErrorMessage) throw new Error(`Investec: ${result.ErrorMessage}`);
    const first = result.TransferResponses[0];
    if (!first) throw new Error("Investec returned no TransferResponses");
    const paymentRef = first.PaymentReferenceNumber || `round-${round}-${Date.now()}`;
    log.info({ round: String(round), member: member.name, amount, paymentRef }, "paid through Investec");
    feed.push({ kind: "chain->bank", title: `Paid ${member.name} ${formatRands(cents)}`, detail: `Investec ref ${paymentRef}` });

    if (o.shadow) void shadowPay(member, amount, myReference, theirReference);

    const hash = await contract.write.confirmPayout([round, beneficiaryId32(member.investecId), refOf(paymentRef)]);
    log.info({ round: String(round), hash }, "confirmPayout");
    feed.push({ kind: "bank->chain", title: "Payout settled", detail: `round ${round + 1n} confirmed on chain`, hash });
  }

  /** In mock mode with INVESTEC_SHADOW=sandbox: send the same call to the real sandbox and log its answer. */
  async function shadowPay(member: Member, amount: string, myReference: string, theirReference: string) {
    try {
      const accounts = await o.shadow!.accounts();
      const from = accounts[0]?.accountId;
      if (!from) return;
      const r = await o.shadow!.transfer(from, [
        { beneficiaryAccountId: accounts[1]?.accountId ?? from, amount, myReference, theirReference },
      ]);
      const first = r.TransferResponses[0];
      log.info({ sandbox: o.shadow!.baseUrl, paymentRef: first?.PaymentReferenceNumber, status: first?.Status }, "shadow: real sandbox accepted the same transfer");
      feed.push({ kind: "info", title: "Real sandbox accepted the same transfer", detail: `PaymentReferenceNumber ${first?.PaymentReferenceNumber ?? "?"} (the sandbox is stateless, so nothing moves there)` });
    } catch (err) {
      log.warn({ err: String(err) }, "shadow: sandbox call failed");
    }
  }

  return { tryClose, settle };
}
