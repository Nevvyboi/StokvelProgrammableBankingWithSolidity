"use client";

import type { ChainState, StokvelEvent } from "@/lib/chain";
import { MEMBERS, short } from "@/lib/members";
import { Patch } from "@/lib/quilt";

/** The constitution's text, split into its title and its numbered rules. */
function parse(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rules = lines.filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, ""));
  const title = lines.find((l) => !/^\d+\.\s/.test(l)) ?? "The constitution";
  return { title, rules };
}

/**
 * The constitution as a page of the book: the rules the contract holds the hash of, and six
 * signature lines that fill in as each member signs it with their card.
 */
export function ConstitutionPage({ text, state, events }: { text: string; state: ChainState | null; events: StokvelEvent[] }) {
  const { title, rules } = parse(text);
  const joins = new Map(events.filter((e) => e.name === "MemberJoined").map((e) => [Number(e.args.memberId), e]));
  const signed = state?.members.filter((m) => m.joined).length ?? 0;
  return (
    <section className="flex h-full flex-col bg-paper px-14 py-10 text-ink">
      <div className="flex items-baseline justify-between border-b border-ink/25 pb-4">
        <div className="font-mono text-[15px] tracking-[0.2em] text-ink/70">{title}</div>
        <div className="font-mono text-[15px] text-ink/60">{signed} of 6 signed</div>
      </div>
      <ol className="mt-6 space-y-3">
        {rules.map((r, i) => (
          <li key={i} className="flex gap-4 text-[23px] leading-snug">
            <span className="font-display w-7 shrink-0 font-medium text-ink/50">{i + 1}.</span>
            <span>{r}</span>
          </li>
        ))}
      </ol>
      <div className="mt-auto grid grid-cols-3 gap-x-10 gap-y-7 pt-8">
        {MEMBERS.map((m) => {
          const joined = state?.members[m.memberId]?.joined ?? false;
          const ev = joins.get(m.memberId);
          return (
            <div key={m.number} className={joined ? "sig-in" : ""}>
              <div className="flex h-[54px] items-end gap-3 border-b-2 border-ink/40 pb-1">
                {joined ? (
                  <>
                    <Patch colour={m.colour} seed={`member:${m.number}`} size={40} base="#e9e4d8" />
                    <span className="font-display text-[34px] font-medium italic leading-none" style={{ color: m.colour }}>
                      {m.name}
                    </span>
                    <span className="ml-auto pb-1 text-[15px] font-medium text-success">✓ signed</span>
                  </>
                ) : (
                  <span className="pb-1 text-[15px] text-ink/40">awaiting signature</span>
                )}
              </div>
              <div className="font-mono mt-1 flex justify-between text-[12px] text-ink/50">
                <span>
                  member {m.number} · {m.name}
                </span>
                <span>{ev ? short(ev.txHash, 6) : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The moment the sixth signature lands: the club exists, in everyone's own hand. */
export function SignedPopup({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-bg/70 backdrop-blur-sm" onClick={onDismiss} role="status">
      <div className="sig-pop w-[1180px] bg-paper px-16 py-12 text-center text-ink shadow-2xl">
        <div className="stamp mx-auto inline-block text-[64px] leading-none text-success" style={{ borderWidth: 5 }}>
          Signed
        </div>
        <div className="font-display mt-8 text-[52px] font-medium leading-tight">Everyone has signed the constitution</div>
        <div className="mt-3 text-[24px] text-ink/70">All six members of The Q4 Stokvel, each with their own card. Nobody signed for anyone.</div>
        <div className="mt-10 flex justify-center gap-10">
          {MEMBERS.map((m) => (
            <div key={m.number} className="flex flex-col items-center gap-2">
              <Patch colour={m.colour} seed={`member:${m.number}`} size={64} base="#e9e4d8" />
              <div className="font-display text-[26px] font-medium" style={{ color: m.colour }}>
                {m.name}
              </div>
              <div className="font-mono text-[13px] text-ink/50">member {m.number}</div>
            </div>
          ))}
        </div>
        <div className="font-mono mt-10 text-[14px] text-ink/50">the club's rules now live where nobody can quietly rewrite them</div>
      </div>
    </div>
  );
}
