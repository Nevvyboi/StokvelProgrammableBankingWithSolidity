import { readFileSync, existsSync } from "node:fs";
import type { Account, Balance, Beneficiary, Transaction } from "../investec/types.js";

/**
 * An in-memory bank. Balances are integer cents inside; the API layer converts to rands, exactly the
 * way the real API presents them. The demo needs two accounts: the stokvel's pool account and the
 * treasurer's personal account (where stolen money goes), plus one saved beneficiary per member.
 */
export type LedgerTx = Transaction & { id: string; cents: bigint; at: number };

export type SeedLine = {
  type: "CREDIT" | "DEBIT";
  id: string;
  cents: number;
  description: string;
  at: number;
};

export const PROFILE_ID = "10000000000001";
export const POOL_ACCOUNT_ID = "1111122222333334444455555";
export const TREASURER_ACCOUNT_ID = "1111122222333334444466666";

const MEMBER_NAMES = ["Lerato", "Thabo", "Aisha", "Johan", "Priya", "Sipho"];

export class Ledger {
  accounts: Account[] = [
    {
      accountId: POOL_ACCOUNT_ID,
      accountNumber: "10010010010",
      accountName: "Mr N Tom",
      referenceName: "The Q4 Stokvel",
      productName: "Private Bank Account",
      kycCompliant: true,
      profileId: PROFILE_ID,
      profileName: "N Tom",
    },
    {
      accountId: TREASURER_ACCOUNT_ID,
      accountNumber: "10010010011",
      accountName: "Mr N Tom",
      referenceName: "Treasurer personal",
      productName: "Private Bank Account",
      kycCompliant: true,
      profileId: PROFILE_ID,
      profileName: "N Tom",
    },
  ];

  beneficiaries: Beneficiary[] = MEMBER_NAMES.map((name, i) => ({
    beneficiaryId: `beneficiary:${name}`,
    accountNumber: `6200000000${i + 1}`,
    code: "250655",
    bank: "FIRST NATIONAL BANK",
    beneficiaryName: name.toUpperCase(),
    lastPaymentAmount: "0.00",
    lastPaymentDate: "01/01/2026",
    cellNo: null,
    emailAddress: null,
    name,
    referenceAccountNumber: "STOKVEL",
    referenceName: "STOKVEL",
    categoryId: "10000000000009",
    profileId: PROFILE_ID,
    fasterPaymentAllowed: true,
  }));

  txs = new Map<string, LedgerTx[]>([
    [POOL_ACCOUNT_ID, []],
    [TREASURER_ACCOUNT_ID, []],
  ]);
  balances = new Map<string, bigint>([
    [POOL_ACCOUNT_ID, 0n],
    [TREASURER_ACCOUNT_ID, 250_000_00n],
  ]);
  private counter = 0;
  listeners: Array<(accountId: string, tx: LedgerTx) => void> = [];

  /** Load the bank side of what contracts/script/DemoState.s.sol did, so bank and chain agree. */
  seed(path: string): number {
    if (!existsSync(path)) return 0;
    let n = 0;
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const s = JSON.parse(line) as SeedLine;
      if (this.find(POOL_ACCOUNT_ID, s.id)) continue;
      this.post(POOL_ACCOUNT_ID, s.type, BigInt(s.cents), s.description, {
        id: s.id,
        at: s.at * 1000,
        transactionType: s.type === "CREDIT" ? "OnlineBankingPayments" : "Transfer",
        silent: true,
      });
      n += 1;
    }
    return n;
  }

  find(accountId: string, id: string): LedgerTx | undefined {
    return this.txs.get(accountId)?.find((t) => t.id === id);
  }

  balance(accountId: string): Balance {
    const cents = this.balances.get(accountId);
    if (cents === undefined) throw new Error("unknown account");
    const rands = Number(cents) / 100;
    return {
      accountId,
      currentBalance: rands,
      availableBalance: rands,
      budgetBalance: 0,
      straightBalance: 0,
      cashBalance: rands,
      currency: "ZAR",
    };
  }

  transactions(accountId: string, fromDate?: string, toDate?: string): Transaction[] {
    const list = this.txs.get(accountId);
    if (!list) throw new Error("unknown account");
    return list
      .filter((t) => (!fromDate || t.postingDate! >= fromDate) && (!toDate || t.postingDate! <= toDate))
      .map(({ id: _id, cents: _c, at: _a, ...t }) => t);
  }

  /** Post one leg. Returns the row as the API would show it. */
  post(
    accountId: string,
    type: "CREDIT" | "DEBIT",
    cents: bigint,
    description: string,
    opts: { id?: string; at?: number; transactionType?: string; cardNumber?: string; silent?: boolean } = {},
  ): LedgerTx {
    const list = this.txs.get(accountId);
    if (!list) throw new Error("unknown account");
    const bal = this.balances.get(accountId)!;
    const next = type === "CREDIT" ? bal + cents : bal - cents;
    this.balances.set(accountId, next);
    const at = opts.at ?? Date.now();
    const day = new Date(at).toISOString().slice(0, 10);
    const postedOrder = ++this.counter;
    const id = opts.id ?? `${accountId.slice(-5)}${day.replace(/-/g, "")}${String(postedOrder).padStart(7, "0")}`;
    const tx: LedgerTx = {
      id,
      cents,
      at,
      accountId,
      type,
      transactionType: opts.transactionType ?? "OnlineBankingPayments",
      status: "POSTED",
      description: description.slice(0, 40),
      cardNumber: opts.cardNumber ?? "",
      postedOrder,
      postingDate: day,
      valueDate: day,
      actionDate: day,
      transactionDate: day,
      amount: Number(cents) / 100,
      runningBalance: Number(next) / 100,
      uuid: id,
    };
    list.push(tx);
    if (!opts.silent) for (const l of this.listeners) l(accountId, tx);
    return tx;
  }

  /** transfermultiple / paymultiple: debit the source, credit the destination if it is ours. */
  transfer(
    fromAccountId: string,
    toAccountIdOrBeneficiaryId: string,
    cents: bigint,
    myReference: string,
    theirReference: string,
  ): { debit: LedgerTx; credit?: LedgerTx; paymentReference: string } {
    const debit = this.post(fromAccountId, "DEBIT", cents, myReference, { transactionType: "Transfer" });
    let credit: LedgerTx | undefined;
    if (this.txs.has(toAccountIdOrBeneficiaryId)) {
      credit = this.post(toAccountIdOrBeneficiaryId, "CREDIT", cents, theirReference, {
        transactionType: "Transfer",
      });
    } else {
      const b = this.beneficiaries.find((x) => x.beneficiaryId === toAccountIdOrBeneficiaryId);
      if (!b) throw new Error("unknown beneficiary");
      b.lastPaymentAmount = (Number(cents) / 100).toFixed(2);
      b.lastPaymentDate = ddmmyyyy(new Date());
    }
    return { debit, credit, paymentReference: `UBP${String(this.counter).padStart(10, "0")}` };
  }

  reset() {
    this.txs = new Map([
      [POOL_ACCOUNT_ID, []],
      [TREASURER_ACCOUNT_ID, []],
    ]);
    this.balances = new Map([
      [POOL_ACCOUNT_ID, 0n],
      [TREASURER_ACCOUNT_ID, 250_000_00n],
    ]);
    this.counter = 0;
  }
}

export function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
