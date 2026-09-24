"use client";

import { useStage } from "@/lib/useStage";
import { MEMBERS, formatRands, short } from "@/lib/members";
import { explorerTx, explorerAddress } from "@/lib/config";
import { Patch } from "@/lib/quilt";
import { QuiltWall } from "@/components/QuiltWall";

function describe(name: string, args: Record<string, unknown>): string {
  const who = (k = "memberId") => (args[k] !== undefined ? (MEMBERS[Number(args[k])]?.name ?? `member ${args[k]}`) : "");
  const rands = (k: string) => formatRands(BigInt(args[k] as bigint));
  switch (name) {
    case "MemberJoined":
      return `${who()} signed the constitution`;
    case "ContributionRecorded":
      return `${who()} paid ${rands("cents")}`;
    case "ReservesPosted":
      return `bank holds ${rands("cents")}, club is owed ${rands("owed")}`;
    case "PayoutDue":
      return `${rands("cents")} due to ${who()}`;
    case "PayoutSettled":
      return `${rands("cents")} paid to ${who()}`;
    case "RoundOpened":
      return `round ${(BigInt(args.round as bigint) + 1n).toString()} opened, ${who("recipientId")} is next`;
    case "ProposalCreated":
      return `proposal #${String(args.id)} opened`;
    case "Voted":
      return `${who()} voted, ${String(args.yes)} yes so far`;
    case "ProposalQueued":
      return `majority reached, timelock running`;
    case "ProposalExecuted":
      return `proposal #${String(args.id)} applied`;
    case "KeyRotated":
      return `${who()} moved to a new card`;
    case "ContributionChanged":
      return `contribution ${rands("oldCents")} to ${rands("newCents")}`;
    case "RelayerReplaced":
      return "relayer replaced";
    case "AttestorReplaced":
      return "attestor replaced";
    default:
      return name;
  }
}

/** Read only. Never shows or accepts a key. A passbook for the room's phones. */
export default function Watch() {
  const s = useStage({ poll: 3000 });
  const events = [...s.events].reverse().slice(0, 40);
  return (
    <main className="mx-auto max-w-lg px-5 pb-16 pt-6">
      <header className="page">
        <div className="running-head">
          <span>
            <b>The Q4 Stokvel</b> · passbook
          </span>
          <span className="font-mono text-xs">read only</span>
        </div>
        <p className="mt-3 text-sm text-muted">Every line is an event on the chain. Tap a hash to check it on your own phone.</p>
      </header>

      {s.state ? (
        <>
          <section className="mt-6">
            <div className="text-sm text-muted">Pot, round {(s.state.round + 1n).toString()}</div>
            <div className="font-display tnum text-5xl font-medium tracking-tight">{formatRands(s.state.pot)}</div>
            <div className={`mt-1 text-sm ${!s.state.fresh ? "text-muted" : s.state.reservesCents < s.state.pot + s.state.unsettled ? "text-danger" : "text-success"}`}>
              bank attested {formatRands(s.state.reservesCents)}
              {s.state.fresh ? "" : " (stale)"}
            </div>
          </section>

          <table className="ledger mt-5 text-base">
            <tbody>
              {s.state.members.map((m) => {
                const info = MEMBERS[m.memberId]!;
                const paid = m.paidThisRound >= s.state!.contributionCents;
                const next = m.memberId === s.state!.recipient;
                return (
                  <tr key={m.memberId}>
                    <td className="font-display w-8 text-muted">{info.number}</td>
                    <td className="w-9">
                      <Patch colour={info.colour} seed={`member:${info.number}`} size={26} />
                    </td>
                    <td className="font-display font-medium">{info.name}</td>
                    <td className="margin-note text-xs" style={{ color: info.colour }}>
                      {next ? "← next payout" : ""}
                    </td>
                    <td className="text-right text-sm">{paid ? <span className="stamp soft text-xs text-success">Paid</span> : <span className="text-muted">due</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <section className="mt-6">
            <div className="mb-2 text-sm text-muted">The quilt</div>
            <QuiltWall events={s.events} size={28} max={72} />
          </section>

          <section className="page mt-7">
            <div className="running-head">
              <span>
                <b>Events</b>
              </span>
              <span className="font-mono text-xs">newest first</span>
            </div>
            <table className="ledger mt-1 text-sm">
              <tbody>
                {events.map((e) => {
                  const link = s.cfg ? explorerTx(s.cfg, e.txHash) : null;
                  return (
                    <tr key={`${e.txHash}:${e.logIndex}`}>
                      <td className="font-mono w-14 align-top text-xs text-muted">#{e.blockNumber.toString()}</td>
                      <td>
                        <div>{describe(e.name, e.args)}</div>
                        <div className="font-mono text-[11px] text-muted">
                          {e.name} ·{" "}
                          {link ? (
                            <a href={link} className="underline" target="_blank" rel="noreferrer">
                              {short(e.txHash, 6)} on Basescan
                            </a>
                          ) : (
                            short(e.txHash, 6)
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {s.cfg && (
            <footer className="font-mono mt-6 text-[11px] text-muted">
              contract {s.cfg.explorerUrl ? <a className="underline" href={explorerAddress(s.cfg, s.cfg.stokvel)!}>{short(s.cfg.stokvel, 6)}</a> : short(s.cfg.stokvel, 6)} · testnet only, no real value
            </footer>
          )}
        </>
      ) : (
        <p className="mt-6 text-muted">Connecting to the chain…</p>
      )}
    </main>
  );
}
