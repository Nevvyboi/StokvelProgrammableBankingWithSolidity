"use client";

import type { BankState } from "@/lib/useStage";
import { formatRands } from "@/lib/members";

/** The left page: a bank statement. Ruled rows, figures to the right, a running balance. */
export function BankPanel({ bank, up, mode }: { bank: BankState | null; up: boolean; mode: "mock" | "sandbox" }) {
  const cents = bank ? Math.round(bank.balance.currentBalance * 100) : null;
  const rows = (bank?.transactions ?? []).slice(0, 7);
  return (
    <section className="page flex h-full min-h-0 flex-col overflow-hidden">
      <div className="running-head">
        <span>
          <b>Investec</b> · Private Bank Account · The Q4 Stokvel
        </span>
        <span className="font-mono text-sm">{mode === "sandbox" ? "sandbox" : "sandbox mirror"}{up ? "" : " · offline"}</span>
      </div>

      <div className="mt-8 flex items-baseline justify-between">
        <div className="text-lg text-muted">Balance</div>
        <div className="font-mono text-sm text-muted">{bank ? `as at ${new Date(bank.at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}</div>
      </div>
      <div className="font-display tnum text-[5.2rem] font-medium leading-none tracking-tight">{cents === null ? "" : formatRands(cents)}</div>

      <table className="ledger mt-6 text-[1.3rem]">
        <thead>
          <tr>
            <th className="w-28">Date</th>
            <th>Reference</th>
            <th className="num w-44">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => (
            <tr key={t.uuid ?? `${t.postedOrder}-${i}`} className="slide-in">
              <td className="font-mono text-base text-muted">{t.transactionDate.slice(8, 10)}/{t.transactionDate.slice(5, 7)}</td>
              <td className="truncate pr-4">{t.description || <span className="text-muted">(no reference)</span>}</td>
              <td className={`num ${t.type === "DEBIT" ? "text-muted" : ""}`}>
                {t.type === "DEBIT" ? "−" : ""}
                {formatRands(Math.round(t.amount * 100))}
              </td>
            </tr>
          ))}
          {bank && rows.length === 0 && (
            <tr>
              <td colSpan={3} className="text-muted">
                No transactions yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-auto flex justify-between pt-4 text-sm text-muted">
        <span>Statement lines arrive by polling the Private Banking API.</span>
        <span className="font-mono">page 1 of 2</span>
      </div>
    </section>
  );
}
