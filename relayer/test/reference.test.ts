import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import {
  beneficiaryId32,
  centsToRandString,
  formatRands,
  memberNumber,
  parseReference,
  randsToCents,
  refOf,
  stableTxId,
} from "../src/investec/reference.js";
import type { Transaction } from "../src/investec/types.js";

describe("parseReference: STK-03 is member 03, memberId 2", () => {
  it.each([
    ["STK-03", 2],
    ["stk-03", 2],
    ["STK-3", 2],
    ["STK 03", 2],
    ["STK-01", 0],
    ["STK-06", 5],
    ["STK-03 round-up", 2],
    ["Payment STK-04 from Johan", 3],
    ["STK-12", 11],
  ])("%s -> memberId %d", (desc, id) => {
    expect(parseReference(desc)).toBe(id);
  });

  it.each(["", "Salary", "STK-00", "STK-", "STOKVEL 03", "STK-999", "ASTK-03"])("%s -> null", (desc) => {
    expect(parseReference(desc)).toBeNull();
  });

  it("round trips memberNumber", () => {
    for (let id = 0; id < 6; id++) expect(parseReference(`STK-${memberNumber(id)}`)).toBe(id);
  });
});

describe("amounts", () => {
  it("rands to cents rounds to the cent", () => {
    expect(randsToCents(87.5)).toBe(8750n);
    expect(randsToCents(0.1 + 0.2)).toBe(30n);
    expect(randsToCents("2,000.00")).toBe(200_000n);
    expect(randsToCents(5000)).toBe(500_000n);
  });
  it("cents to the rand string the transfer endpoints want", () => {
    expect(centsToRandString(300n)).toBe("3.00");
    expect(centsToRandString(3_000_000n)).toBe("30000.00");
    expect(centsToRandString(5)).toBe("0.05");
  });
  it("formats for humans", () => {
    expect(formatRands(300n)).toBe("R3.00");
    expect(formatRands(3_000_000n)).toBe("R30,000.00");
  });
  it("rejects garbage", () => {
    expect(() => randsToCents("abc")).toThrow();
  });
});

describe("stable ids and refs", () => {
  const base: Transaction = {
    accountId: "1111122222333334444455555",
    type: "CREDIT",
    transactionType: "OnlineBankingPayments",
    status: "POSTED",
    description: "STK-03",
    cardNumber: "",
    postedOrder: 12,
    postingDate: "2026-10-03",
    valueDate: "2026-10-03",
    actionDate: "2026-10-03",
    transactionDate: "2026-10-03",
    amount: 5000,
    runningBalance: 10000,
    uuid: "55555202610030000012",
  };

  it("uses the API uuid when it is trustworthy", () => {
    expect(stableTxId(base)).toBe("55555202610030000012");
  });
  it("falls back to a field hash without a uuid", () => {
    const { uuid: _u, ...noUuid } = base;
    const id = stableTxId(noUuid);
    expect(id.startsWith("h:")).toBe(true);
    expect(stableTxId({ ...noUuid })).toBe(id);
    expect(stableTxId({ ...noUuid, amount: 5001 })).not.toBe(id);
  });
  it("ignores a uuid on a pending row", () => {
    expect(stableTxId({ ...base, status: "PENDING", postedOrder: 0 }).startsWith("h:")).toBe(true);
  });
  it("refOf is keccak256 of the id bytes, the same thing the contract tests use", () => {
    expect(refOf("tx-1")).toBe(keccak256(toBytes("tx-1")));
  });
  it("beneficiaryId32 matches Deploy.s.sol's default", () => {
    // Deploy.s.sol: keccak256(abi.encodePacked("beneficiary:", "Lerato"))
    expect(beneficiaryId32("beneficiary:Lerato")).toBe(keccak256(toBytes("beneficiary:Lerato")));
  });
});
