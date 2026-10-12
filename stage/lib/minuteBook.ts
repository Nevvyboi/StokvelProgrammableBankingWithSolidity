import type { FeedItem } from "./useStage";

/**
 * The lines worth a row in the minute book. The attestor signs every 20 seconds whether or not
 * anything changed, and with four rows on the projector those repeats push a "Member joined" off
 * the page in under a minute. An attestation keeps its row only when it says something new: the
 * first one, or a different balance or verdict from the attestation before it. That the attestor
 * is still alive is the right page's job ("Attested 6s ago").
 */
export function minuteBook(feed: FeedItem[]): FeedItem[] {
  let last: string | null = null;
  return feed.filter((i) => {
    if (i.kind !== "reserves") return true;
    const said = `${i.title}|${i.detail ?? ""}`;
    const fresh = said !== last;
    last = said;
    return fresh;
  });
}

/**
 * The full screen stamp is for the contract refusing something: a payout frozen, a transaction
 * counted twice, a vote from a card that isn't a member. A short attestation is not a refusal, it
 * is the auditor's note, and the reconciliation line already turns red for it (SHORT R1,000.00).
 * Raising FROZEN for it too would stamp the screen before DEMO 4's "try to close the round", and
 * again with every attestation while the money is out.
 */
export function raisesAlarm(i: FeedItem): boolean {
  return !!i.error && i.kind !== "reserves";
}
