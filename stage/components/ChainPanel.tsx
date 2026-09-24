"use client";

import type { BlockInfo, ChainState } from "@/lib/chain";
import { MEMBERS, formatRands } from "@/lib/members";
import { Patch } from "@/lib/quilt";

/** A short chain of blocks, drawn as linked boxes. The newest slides in on the left. */
export function Blocks({ blocks }: { blocks: BlockInfo[] }) {
  return (
    <div className="flex items-center overflow-hidden">
      {blocks.slice(0, 7).map((b, i) => (
        <div key={b.hash} className="slide-in flex items-center">
          <div className={`font-mono border px-2.5 py-1 text-sm leading-tight ${i === 0 ? "border-text text-text" : "border-rule text-muted"}`}>
            <div>#{b.number.toString()}</div>
            <div className="text-[10px] opacity-70">{b.hash.slice(2, 8)}</div>
          </div>
          {i < Math.min(blocks.length, 7) - 1 && <div className="h-px w-3 bg-rule" />}
        </div>
      ))}
    </div>
  );
}

/** Reserves as an auditor's reconciliation: two figures and a verdict, not a progress bar. */
export function Reconciliation({ state }: { state: ChainState }) {
  const owed = state.pot + state.unsettled;
  const held = state.reservesCents;
  const short = held < owed;
  const stale = !state.fresh;
  const age = Math.max(0, state.blockTime - state.reservesAt);
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-6">
      <table className="ledger text-[1.15rem]">
        <tbody>
          <tr>
            <td>Bank holds, signed by the attestor</td>
            <td className="num">{formatRands(held)}</td>
          </tr>
          <tr>
            <td>Club is owed, pot plus payouts in flight</td>
            <td className="num">{formatRands(owed)}</td>
          </tr>
          <tr>
            <td className="text-muted">Attested</td>
            <td className="num text-muted">{state.reservesAt ? `${age}s ago` : "never"}</td>
          </tr>
        </tbody>
      </table>
      <div className={`stamp text-2xl ${stale ? "soft text-muted" : short ? "text-danger" : "text-success"}`}>
        {stale ? "Stale" : short ? `Short ${formatRands(owed - held)}` : "Covered"}
      </div>
    </div>
  );
}

/** The roster: six numbered rows in rotation order, with the month's stamp on each. */
export function Roster({ state, compact = false }: { state: ChainState; compact?: boolean }) {
  return (
    <table className={`ledger roster ${compact ? "text-base" : "text-[1.25rem]"}`}>
      <tbody>
        {state.members.map((m) => {
          const info = MEMBERS[m.memberId]!;
          const paid = m.paidThisRound >= state.contributionCents;
          const partial = !paid && m.paidThisRound > 0n;
          const next = m.memberId === state.recipient;
          return (
            <tr key={m.memberId}>
              <td className={`font-display w-12 ${compact ? "text-xl" : "text-2xl"} font-medium text-muted`}>{info.number}</td>
              <td className="w-14">
                <Patch colour={info.colour} seed={`member:${info.number}`} size={compact ? 30 : 34} />
              </td>
              <td className="font-display font-medium">
                {info.name}
                {!m.joined && <span className="ml-2 text-sm font-normal text-muted">not signed</span>}
              </td>
              <td className="margin-note" style={{ color: info.colour }}>
                {next ? "← this month's payout" : ""}
              </td>
              <td className="num text-muted">{partial ? formatRands(m.paidThisRound) : ""}</td>
              <td className="w-24 text-right">
                {paid ? <span className="stamp soft text-base text-success">Paid</span> : <span className="text-base text-muted">due</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function PotLine({ state }: { state: ChainState }) {
  const ends = new Date(state.roundEndsAt * 1000);
  const over = state.blockTime >= state.roundEndsAt;
  const who = MEMBERS[state.recipient]!;
  return (
    <div className="flex items-end justify-between gap-8">
      <div>
        <div className="text-lg text-muted">Pot, round {(state.round + 1n).toString()}</div>
        <div className="font-display tnum text-[5.2rem] font-medium leading-none tracking-tight">{formatRands(state.pot)}</div>
      </div>
      <div className="mb-2 text-right text-[1.2rem] leading-snug">
        <div className="text-muted">{over ? "Round over. Waiting for reserves and a close." : "Pays out to"}</div>
        {!over && (
          <div className="font-display text-2xl font-medium">
            {who.number} {who.name} on {ends.toLocaleDateString("en-ZA", { day: "numeric", month: "long" })}
          </div>
        )}
        {state.unsettled > 0n && <div className="font-mono text-base text-lerato">{formatRands(state.unsettled)} on its way through the bank</div>}
      </div>
    </div>
  );
}
