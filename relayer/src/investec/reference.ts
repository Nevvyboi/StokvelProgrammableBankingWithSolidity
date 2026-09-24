import { keccak256, toBytes, type Hex } from "viem";
import type { Transaction } from "./types.js";

/**
 * Bank references look like STK-03 (member 03). Members are numbered 01 to 06 on their cards and in
 * bank references; the contract's memberId is zero based, so STK-03 is memberId 2. This is the only
 * place that conversion happens.
 */
export function parseReference(description: string): number | null {
  const m = /\bSTK[- ]?0*(\d{1,2})\b/i.exec(description ?? "");
  if (!m) return null;
  const number = Number(m[1]);
  if (number < 1 || number > 64) return null;
  return number - 1;
}

export function memberNumber(memberId: number): string {
  return String(memberId + 1).padStart(2, "0");
}

/** Rands as the API returns them (a number like 87.5) to integer cents. */
export function randsToCents(rands: number | string): bigint {
  const n = typeof rands === "string" ? Number(rands.replace(/,/g, "")) : rands;
  if (!Number.isFinite(n)) throw new Error(`bad amount: ${rands}`);
  return BigInt(Math.round(n * 100));
}

/** Integer cents to the rand string the transfer endpoints want ("150.00"). */
export function centsToRandString(cents: bigint | number): string {
  const c = BigInt(cents);
  const whole = c / 100n;
  const frac = c % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

export function formatRands(cents: bigint | number): string {
  const c = BigInt(cents);
  const whole = (c / 100n).toLocaleString("en-ZA");
  const frac = (c % 100n).toString().padStart(2, "0");
  return `R${whole}.${frac}`.replace(/ /g, ",");
}

/**
 * A stable id for a bank transaction. The API's `uuid` is built from accountId + postingDate +
 * postedOrder and only exists for posted rows, so we use it when it is there and fall back to a hash
 * of the fields that do not change. Pending rows (postedOrder 0) are skipped by the caller.
 */
export function stableTxId(t: Transaction): string {
  if (t.uuid && t.status === "POSTED" && Number(t.postedOrder) > 0) return t.uuid;
  const parts = [
    t.accountId,
    t.type,
    t.transactionDate,
    t.postingDate ?? "",
    Number(t.amount).toFixed(2),
    (t.description ?? "").trim(),
    String(t.postedOrder ?? ""),
  ];
  return `h:${parts.join("|")}`;
}

/** The on-chain reference for a bank transaction: keccak256 of its stable id. */
export function refOf(txId: string): Hex {
  return keccak256(toBytes(txId));
}

/** The bytes32 the contract compares against beneficiaryHash: keccak256 of the Investec id. */
export function beneficiaryId32(investecId: string): Hex {
  return keccak256(toBytes(investecId));
}
