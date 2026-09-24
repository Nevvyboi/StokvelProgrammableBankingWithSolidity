import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Balance, Transaction } from "../investec/types.js";

/**
 * What the sandbox forgets, remembered under the sandbox's own references.
 *
 * Investec's sandbox accepts a transfer, returns a real PaymentReferenceNumber, and then changes
 * nothing. This store keeps one line per accepted transfer, keyed by that reference, and knows how
 * to fold those lines into the sandbox's own balance and transaction responses. Nothing is
 * invented: a line exists only because the sandbox said yes.
 */
export type OverlayTx = Transaction & { paymentRef: string; cents: number; at: number };

type State = {
  accounts: Record<string, { deltaCents: number; txs: OverlayTx[] }>;
  beneficiaries: Record<string, { lastPaymentAmount: string; lastPaymentDate: string }>;
  refs: string[];
};

export class OverlayStore {
  private state: State = { accounts: {}, beneficiaries: {}, refs: [] };
  private counter = 0;

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      this.state = JSON.parse(readFileSync(file, "utf8"));
      this.counter = this.state.refs.length;
    }
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  private account(id: string) {
    return (this.state.accounts[id] ??= { deltaCents: 0, txs: [] });
  }

  /** Record one accepted transfer. `toAccountId` is set when the destination is an account we serve. */
  record(o: { paymentRef: string; fromAccountId: string; toAccountId?: string; beneficiaryId?: string; cents: number; myReference: string; theirReference: string }) {
    if (this.state.refs.includes(o.paymentRef)) return; // the sandbox reference is the idempotency key
    this.state.refs.push(o.paymentRef);
    const at = Date.now();
    const day = new Date(at).toISOString().slice(0, 10);
    const line = (accountId: string, type: "CREDIT" | "DEBIT", description: string, running: number): OverlayTx => ({
      accountId,
      type,
      transactionType: "Transfer",
      status: "POSTED",
      description: description.slice(0, 40),
      cardNumber: "",
      postedOrder: ++this.counter,
      postingDate: day,
      valueDate: day,
      actionDate: day,
      transactionDate: day,
      amount: o.cents / 100,
      runningBalance: running / 100,
      uuid: `${o.paymentRef}:${type}`,
      paymentRef: o.paymentRef,
      cents: o.cents,
      at,
    });
    const from = this.account(o.fromAccountId);
    from.deltaCents -= o.cents;
    from.txs.push(line(o.fromAccountId, "DEBIT", o.myReference, from.deltaCents));
    if (o.toAccountId) {
      const to = this.account(o.toAccountId);
      to.deltaCents += o.cents;
      to.txs.push(line(o.toAccountId, "CREDIT", o.theirReference, to.deltaCents));
    }
    if (o.beneficiaryId) {
      const d = new Date(at);
      const p = (n: number) => String(n).padStart(2, "0");
      this.state.beneficiaries[o.beneficiaryId] = { lastPaymentAmount: (o.cents / 100).toFixed(2), lastPaymentDate: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}` };
    }
    this.save();
  }

  /** The sandbox's balance plus what it has accepted since. */
  mergeBalance(b: Balance): Balance {
    const delta = (this.state.accounts[b.accountId]?.deltaCents ?? 0) / 100;
    return { ...b, currentBalance: round2(b.currentBalance + delta), availableBalance: round2(b.availableBalance + delta), ...(b.cashBalance !== undefined ? { cashBalance: round2(b.cashBalance + delta) } : {}) };
  }

  /** The sandbox's transactions plus the accepted transfers, with running balances rebased on the sandbox's last one. */
  mergeTransactions(accountId: string, sandbox: Transaction[]): Transaction[] {
    const mine = this.state.accounts[accountId]?.txs ?? [];
    if (!mine.length) return sandbox;
    const base = sandbox.length ? Number(sandbox[sandbox.length - 1]!.runningBalance) : 0;
    const maxOrder = sandbox.reduce((m, t) => Math.max(m, Number(t.postedOrder) || 0), 0);
    return [
      ...sandbox,
      ...mine.map(({ paymentRef: _p, cents: _c, at: _a, ...t }, i) => ({ ...t, postedOrder: maxOrder + i + 1, runningBalance: round2(base + t.runningBalance) })),
    ];
  }

  latestCredit(accountId: string, test: (t: OverlayTx) => boolean = () => true): OverlayTx | undefined {
    return [...(this.state.accounts[accountId]?.txs ?? [])].reverse().find((t) => t.type === "CREDIT" && test(t));
  }

  beneficiaryPatch(id: string) {
    return this.state.beneficiaries[id];
  }

  snapshot() {
    return this.state;
  }

  reset() {
    this.state = { accounts: {}, beneficiaries: {}, refs: [] };
    this.counter = 0;
    this.save();
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
