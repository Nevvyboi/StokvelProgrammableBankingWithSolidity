import type { PrivateKeyAccount, PublicClient, Address } from "viem";
import type { InvestecClient } from "../investec/client.js";
import { randsToCents } from "../investec/reference.js";
import type { StokvelContract } from "../chain.js";
import { eip712Domain, errorText, types } from "../chain.js";
import type { Logger } from "../log.js";
import type { Feed } from "../feed.js";

/**
 * Loop 2: proof of reserves. Read the account balance, sign it with the attestor key, post it.
 * The timestamp is the latest block's, not the laptop's, so Anvil time travel and Base Sepolia both
 * work. The contract refuses a timestamp that does not increase, so a quiet chain is not re-signed.
 */
export function createReservesLoop(o: {
  investec: InvestecClient;
  accountId: string;
  contract: StokvelContract;
  publicClient: PublicClient;
  attestor: PrivateKeyAccount;
  chainId: number;
  address: Address;
  log: Logger;
  feed: Feed;
}) {
  const { investec, contract, publicClient, attestor, log, feed } = o;
  const domain = eip712Domain(o.chainId, o.address);

  async function sign(cents: bigint, at: bigint) {
    return attestor.signTypedData({ domain, types, primaryType: "Reserves", message: { cents, at } });
  }

  async function tick(): Promise<{ posted: boolean; cents: bigint; at: bigint; reason?: string }> {
    const [balance, block, last] = await Promise.all([
      investec.balance(o.accountId),
      publicClient.getBlock(),
      contract.read.reservesAt(),
    ]);
    const cents = randsToCents(balance.currentBalance);
    const at = block.timestamp;
    if (at <= BigInt(last)) return { posted: false, cents, at, reason: "no new block since last attestation" };
    const sig = await sign(cents, at);
    try {
      const hash = await contract.write.postReserves([cents, at, sig]);
      const owed = (await contract.read.pot()) + (await contract.read.unsettled());
      log.info({ cents: String(cents), owed: String(owed), at: String(at), hash }, "postReserves");
      feed.push({
        kind: "reserves",
        title: owed > cents ? "Reserves short" : "Reserves attested",
        detail: `bank holds ${String(cents)} cents, club is owed ${String(owed)}`,
        hash,
        ...(owed > cents ? { error: `ReservesShort(${cents}, ${owed})` } : {}),
      });
      return { posted: true, cents, at };
    } catch (err) {
      const text = errorText(err);
      log.warn({ err: text }, "postReserves refused");
      return { posted: false, cents, at, reason: text };
    }
  }

  return { tick, sign };
}
