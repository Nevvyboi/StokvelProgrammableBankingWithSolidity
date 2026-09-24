/**
 * The relayer's own diary: what it did, what the contract said. The stage dashboard reads the chain
 * for truth and this feed for narration ("bank -> chain", "refused").
 */
export type FeedItem = {
  seq: number;
  at: number;
  kind: "bank->chain" | "chain->bank" | "refused" | "info" | "reserves" | "vote";
  title: string;
  detail?: string;
  hash?: string;
  error?: string;
};

export class Feed {
  private items: FeedItem[] = [];
  private seq = 0;
  private waiters: Array<(i: FeedItem) => void> = [];

  push(item: Omit<FeedItem, "seq" | "at">) {
    const full: FeedItem = { ...item, seq: ++this.seq, at: Date.now() };
    this.items.push(full);
    if (this.items.length > 500) this.items.shift();
    for (const w of this.waiters.splice(0)) w(full);
    return full;
  }

  since(seq: number): FeedItem[] {
    return this.items.filter((i) => i.seq > seq);
  }

  last(n = 50): FeedItem[] {
    return this.items.slice(-n);
  }

  onNext(cb: (i: FeedItem) => void) {
    this.waiters.push(cb);
  }
}
