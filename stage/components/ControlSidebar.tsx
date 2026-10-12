"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadStageConfig } from "@/lib/config";
import { FOCUS, type Focus } from "@/lib/focus";
import { MEMBERS, formatRands } from "@/lib/members";
import { anvilMember, nonceOf, relayerPost, signJoin, signVote } from "@/lib/signing";
import type { ProposalState } from "@/lib/chain";
import type { useStage } from "@/lib/useStage";

type Stage = ReturnType<typeof useStage>;
type CardKey = { label: string; name: string; privateKey: `0x${string}`; address: string; memberId?: number };
type Result = { ok: boolean; text: string };

/**
 * The run sheet, on the projector itself. Every button says what it does in a few words and,
 * underneath, the call it makes, so the room sees the command and then, on the board, what it
 * changed. On a server every lever sits behind the presenter password (Caddyfile, netcup nginx);
 * opening /presenter once logs the browser in and comes back here with the sidebar unlocked.
 */
export function ControlSidebar({
  s,
  open,
  onClose,
  focus,
  setFocus,
  fallback,
  setFallback,
}: {
  s: Stage;
  open: boolean;
  onClose: () => void;
  focus: Focus | null;
  setFocus: (f: Focus | null) => void;
  fallback: boolean;
  setFallback: (on: boolean) => void;
}) {
  const [log, setLog] = useState<{ at: string; cmd: string; result: Result }[]>([]);
  const [results, setResults] = useState<Record<string, Result | "running">>({});
  const [keys, setKeys] = useState<CardKey[]>([]);
  const [fallbackStep, setFallbackStep] = useState(0);
  const [script, setScript] = useState<Array<{ title: string; payload: unknown }>>([]);
  const loadedOnce = useRef(false);
  const cfg = s.cfg;

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    fetch("/fallback/script.json").then((r) => r.json()).then(setScript).catch(() => {});
    // scripts/demo.sh prints the board's URL with #k=<token>; the fragment never reaches a server log
    let token = "";
    try {
      const m = window.location.hash.match(/k=([0-9a-f]+)/);
      if (m) {
        sessionStorage.setItem("stokvel:presenter-token", m[1]!);
        history.replaceState(history.state, "", window.location.pathname + window.location.search);
      }
      token = sessionStorage.getItem("stokvel:presenter-token") ?? "";
    } catch {}
    fetch("/api/keys", { headers: { "x-presenter-token": token } })
      .then((r) => (r.ok ? r.json() : { error: r.status }))
      .then(async (d) => {
        if (d.keys) {
          setKeys(d.keys.map((k: { label: string; name: string; privateKey: `0x${string}`; memberId?: number }) => ({ ...k, address: privateKeyToAccount(k.privateKey).address })));
        } else if (await loadStageConfig().then((c) => c.chainId !== 31337 || c.spareAddress)) {
          // Anvil's test keys aren't members on a public chain, nor on a server's own Anvil armed
          // with the printed cards (SPARE_ADDRESS set): members sign with their cards
          setKeys([]);
        } else {
          const pk = (i: number) => toHex(anvilMember(i).getHdKey().privateKey!);
          setKeys([
            ...MEMBERS.map((m) => ({ label: m.number, name: m.name, privateKey: pk(m.memberId), address: anvilMember(m.memberId).address, memberId: m.memberId })),
            { label: "06b", name: "spare 06b", privateKey: pk(6), address: anvilMember(6).address },
            { label: "07", name: "spare 07", privateKey: pk(7), address: anvilMember(7).address },
          ]);
        }
      })
      .catch(() => {});
  }, []);

  const short = (v: unknown) => JSON.stringify(v).replace(/"(\w+)":/g, "$1:").slice(0, 120);
  const record = (id: string, cmd: string, result: Result) => {
    setResults((r) => ({ ...r, [id]: result }));
    setLog((l) => [{ at: new Date().toLocaleTimeString(), cmd, result }, ...l].slice(0, 40));
  };

  // the two kinds of call: the mock bank's levers, and the relayer
  const mock = async (path: string, body: unknown = {}): Promise<Result> => {
    if (!cfg) return { ok: false, text: "no config yet" };
    try {
      const res = await fetch(`${cfg.mockUrl}/__mock/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json().catch(() => ({}));
      return { ok: res.ok && !r.error, text: r.error ? String(r.error) : short(r) };
    } catch (err) {
      return { ok: false, text: String(err).split("\n")[0]! };
    }
  };
  const relayer = async (path: string, body: unknown = {}): Promise<Result> => {
    if (!cfg) return { ok: false, text: "no config yet" };
    try {
      const r = await relayerPost(cfg, path, body);
      return { ok: r.ok !== false && !r.error, text: r.error ? String(r.error) : short(r) };
    } catch (err) {
      return { ok: false, text: String(err).split("\n")[0]! };
    }
  };
  const signAs = async (k: CardKey, what: "join" | { proposalId: bigint }): Promise<Result> => {
    if (!cfg) return { ok: false, text: "no config yet" };
    const account = privateKeyToAccount(k.privateKey);
    if (what === "join") {
      const text = (await fetch("/api/constitution").then((r) => r.json())).text as string;
      return relayer("/join", { signature: await signJoin(account, cfg, text) });
    }
    const nonce = await nonceOf(cfg, account.address);
    return relayer("/votes", { proposalId: what.proposalId.toString(), nonce: nonce.toString(), signature: await signVote(account, cfg, what.proposalId, nonce) });
  };

  /** One run-sheet button: a few words, the call it makes, and what came back. */
  const run = async (id: string, cmd: string, steps: () => Promise<Result | Result[]>) => {
    setResults((r) => ({ ...r, [id]: "running" }));
    const out = await steps();
    const all = Array.isArray(out) ? out : [out];
    const bad = all.find((x) => !x.ok);
    record(id, cmd, bad ?? all[all.length - 1] ?? { ok: true, text: "done" });
  };

  const st = s.state;
  const openProps: ProposalState[] = (st?.proposals ?? []).filter((p) => !p.executed);
  const latest = openProps[openProps.length - 1];
  const unpaid = (st?.members ?? []).filter((m) => m.paidThisRound < (st?.contributionCents ?? 0n));
  const spare = keys.find((k) => k.label === "06b");
  const members = keys.filter((k) => k.memberId !== undefined);
  const chainOnly = cfg?.chainId !== 31337;
  const timelockLeft = latest && latest.eta ? Math.max(0, latest.eta - (st?.blockTime ?? 0)) : null;

  const Cmd = ({ id, label, cmd, tone = "", onRun }: { id: string; label: ReactNode; cmd: string; tone?: string; onRun: () => Promise<Result | Result[]> }) => {
    const r = results[id];
    return (
      <button onClick={() => run(id, cmd, onRun)} disabled={r === "running"} className={`group block w-full border border-line px-3 py-2 text-left hover:border-text disabled:opacity-60 ${tone}`}>
        <div className="flex items-baseline justify-between gap-2 text-[15px] leading-snug">
          <span>{label}</span>
          {r === "running" ? <span className="text-muted">…</span> : r ? <span className={r.ok ? "text-success" : "text-danger"}>{r.ok ? "✓" : "✗"}</span> : null}
        </div>
        <div className="font-mono mt-1 break-all text-[11px] leading-snug text-muted">{cmd}</div>
        {r && r !== "running" && <div className={`font-mono mt-1 break-all text-[11px] leading-snug ${r.ok ? "text-success/80" : "text-danger"}`}>{r.text}</div>}
      </button>
    );
  };
  const Group = ({ n, title, children }: { n: string; title: string; children: ReactNode }) => (
    <section className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted">
        <b className="text-text">{n}</b> · {title}
      </div>
      {children}
    </section>
  );
  // how the calls read on the projector: the public paths, the same on the server as in rehearsal
  const M = "/mock";
  const R = "/relayer";

  return (
    <aside className={`fixed right-0 top-0 z-40 flex h-full w-[420px] flex-col border-l border-line bg-bg transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`} aria-hidden={!open}>
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="font-display text-xl font-medium">Run sheet</div>
          <div className="font-mono text-xs text-muted">
            round {st ? (st.round + 1n).toString() : "?"} · pot {st ? formatRands(st.pot) : "?"} · {s.relayerUp ? "relayer up" : "RELAYER DOWN"}
          </div>
        </div>
        <button onClick={onClose} className="border border-line px-2 py-1 text-sm text-muted hover:border-text" title="Close (D)">
          close ▸
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <Group n="Screen" title="fill it with one section">
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setFocus(null)} className={`border px-2 py-1 text-sm ${focus === null ? "border-text" : "border-line text-muted"}`}>0 everything</button>
            {FOCUS.map((f) => (
              <button key={f.id} onClick={() => setFocus(f.id)} className={`border px-2 py-1 text-sm ${focus === f.id ? "border-text" : "border-line text-muted"}`}>
                {f.key} {f.label.toLowerCase()}
              </button>
            ))}
          </div>
        </Group>

        <Group n="DEMO 1" title="the committee signs the constitution">
          {members.length === 0 && <div className="text-sm text-muted">Members sign with their cards: phone camera, or the station at /sign.</div>}
          {members.map((k) => (
            <Cmd key={k.label} id={`join-${k.label}`} label={`${k.label} ${k.name} signs`} cmd={`sign Join · POST ${R}/join → joinBySig(sig)`} onRun={() => signAs(k, "join")} />
          ))}
          {members.length > 0 && (
            <Cmd id="join-all" label="all six" tone="border-primary" cmd={`6 × POST ${R}/join`} onRun={async () => { const out: Result[] = []; for (const k of members) out.push(await signAs(k, "join")); return out; }} />
          )}
        </Group>

        <Group n="DEMO 2" title="card swipe and round-up">
          <Cmd id="swipe-03" label="Aisha swipes R87 at the bakery" tone="border-primary" cmd={`POST ${M}/__mock/swipe {memberNumber:"03", centsAmount:8700}`} onRun={() => mock("swipe", { memberNumber: "03", centsAmount: 8700 })} />
          <Cmd id="swipe-03b" label="Aisha swipes R249.50" cmd={`POST ${M}/__mock/swipe {memberNumber:"03", centsAmount:24950}`} onRun={() => mock("swipe", { memberNumber: "03", centsAmount: 24950, merchant: "Woolworths" })} />
        </Group>

        <Group n="before DEMO 3" title="everyone pays this month">
          {unpaid.length === 0 && <div className="text-sm text-muted">Everyone has paid.</div>}
          {unpaid.length > 1 && st && (
            <Cmd id="pay-all" label={`everyone left pays (${unpaid.length})`} tone="border-primary" cmd={`${unpaid.length} × POST ${M}/__mock/credit "STK-0n"`} onRun={async () => { const out: Result[] = []; for (const m of unpaid) out.push(await mock("credit", { memberNumber: MEMBERS[m.memberId]!.number, cents: Number(st.contributionCents - m.paidThisRound) })); return out; }} />
          )}
          {st && unpaid.map((m) => {
            const n = MEMBERS[m.memberId]!;
            const cents = st.contributionCents - m.paidThisRound;
            return <Cmd key={m.memberId} id={`pay-${n.number}`} label={`${n.name} pays ${formatRands(cents)}`} cmd={`POST ${M}/__mock/credit {memberNumber:"${n.number}", cents:${cents}}`} onRun={() => mock("credit", { memberNumber: n.number, cents: Number(cents) })} />;
          })}
        </Group>

        <Group n="DEMO 3" title="month end">
          <Cmd id="month-end" label={`Skip to month end and settle${chainOnly ? " (Anvil only)" : ""}`} tone="border-primary" cmd={`POST ${R}/admin/warp {toRoundEnd:true} · POST ${R}/admin/tick → closeRound()`} onRun={async () => [await relayer("/admin/warp", { toRoundEnd: true }), await relayer("/admin/tick")]} />
          <Cmd id="tick" label="Run the loops now" cmd={`POST ${R}/admin/tick → attest, closeRound(), settle`} onRun={() => relayer("/admin/tick")} />
        </Group>

        <Group n="DEMO 4" title="the treasurer steals">
          <Cmd id="steal" label="Take R1,000 out, then attest" tone="border-danger" cmd={`POST ${M}/__mock/steal {cents:100000} · POST ${R}/admin/tick`} onRun={async () => [await mock("steal", { cents: 100_000 }), await relayer("/admin/tick")]} />
          <Cmd id="try-close" label="Try to close the round" cmd={`POST ${R}/admin/warp · POST ${R}/admin/tick → closeRound() reverts ReservesShort`} onRun={async () => [await relayer("/admin/warp", { toRoundEnd: true }), await relayer("/admin/tick")]} />
          <Cmd id="put-back" label="Put it back" cmd={`POST ${M}/__mock/refund {cents:100000} · tick`} onRun={async () => [await mock("refund", { cents: 100_000 }), await relayer("/admin/warp", { seconds: 1 }), await relayer("/admin/tick")]} />
        </Group>

        <Group n="DEMO 5" title="double webhook">
          <Cmd id="v1-double" label="V1: same transaction twice (double credit)" tone="border-danger" cmd={`2 × POST ${R}/admin/replay {target:"v1"} → recordContribution()`} onRun={async () => {
            const bank = await fetch(`${cfg?.relayerUrl ?? R}/bank`).then((r) => r.json()).catch(() => null);
            const tx = bank?.transactions?.find((t: { type: string }) => t.type === "CREDIT");
            if (!tx) return { ok: false, text: "no credit on the statement to replay" };
            return [await relayer("/admin/replay", { transaction: tx, target: "v1" }), await relayer("/admin/replay", { transaction: tx, target: "v1" })];
          }} />
          <Cmd id="v2-double" label="V2: same webhook twice (AlreadyRecorded)" tone="border-primary" cmd={`POST ${M}/__mock/double-webhook {times:2} → second reverts AlreadyRecorded`} onRun={() => mock("double-webhook", { times: 2 })} />
        </Group>

        <Group n="DEMO 7" title="vote: raise the contribution">
          <Cmd id="propose-raise" label={`Propose ${st ? `${formatRands(st.contributionCents)} to ${formatRands(st.contributionCents + 100000n)}` : "a raise"}`} tone="border-primary" cmd={`POST ${R}/propose {kind:0, value:${st ? (st.contributionCents + 100000n).toString() : "…"}} → propose()`} onRun={() => relayer("/propose", { kind: 0, value: ((st?.contributionCents ?? 500000n) + 100000n).toString() })} />
          {latest && members.map((k) => (
            <Cmd key={k.label} id={`vote-${k.label}-${latest.id}`} label={`${k.label} ${k.name} votes #${latest.id}`} cmd={`sign Vote · POST ${R}/votes → voteBySig()`} onRun={() => signAs(k, { proposalId: latest.id })} />
          ))}
          {latest && (
            <Cmd id={`execute-${latest.id}`} label={`Execute #${latest.id} ${timelockLeft !== null ? `(timelock ${timelockLeft}s${chainOnly ? "" : ", will warp"})` : "(needs 4 votes)"}`} cmd={`POST ${R}/execute {proposalId:${latest.id}} → execute()`} onRun={async () => { const out: Result[] = []; if (timelockLeft && !chainOnly) out.push(await relayer("/admin/warp", { seconds: timelockLeft + 1 })); out.push(await relayer("/execute", { proposalId: latest.id.toString() })); return out; }} />
          )}
        </Group>

        <Group n="DEMO 8" title="stolen card: Sipho to card 06b">
          <Cmd id="propose-rotate" label="Propose RotateKey 06 to 06b" tone="border-primary" cmd={`POST ${R}/propose {kind:1, memberId:5, newAddr:06b} → propose()`} onRun={async () => { const to = spare?.address ?? cfg?.spareAddress; return to ? relayer("/propose", { kind: 1, memberId: 5, newAddr: to }) : { ok: false, text: "no card 06b: set SPARE_ADDRESS on the server" }; }} />
          {latest && keys.find((k) => k.label === "06") && <Cmd id="thief" label="Thief votes with the stolen 06 card" tone="border-danger" cmd={`sign Vote with old 06 · POST ${R}/votes`} onRun={() => signAs(keys.find((k) => k.label === "06")!, { proposalId: latest.id })} />}
          {latest && spare && <Cmd id="06b-votes" label="06b votes as Sipho" cmd={`sign Vote with 06b · POST ${R}/votes`} onRun={() => signAs(spare, { proposalId: latest.id })} />}
        </Group>

        <Group n="DEMO 9" title="kill the server">
          <Cmd id="kill" label="Stop the relayer (it restarts itself)" tone="border-danger" cmd={`POST ${R}/admin/kill → process.exit, systemd restarts it`} onRun={() => relayer("/admin/kill")} />
        </Group>

        <Group n="Fallback" title="if the live path dies">
          <Cmd id="fallback" label={fallback ? "Fallback mode is ON, turn it off" : "Switch the board to fallback mode"} cmd="the board plays a recorded script, no backend" onRun={async () => { const next = !fallback; setFallback(next); try { localStorage.setItem("stokvel:fallback", next ? "1" : "0"); } catch {} return { ok: true, text: next ? "fallback on" : "fallback off" }; }} />
          {fallback && (
            <Cmd id={`fallback-step-${fallbackStep}`} label={`Next fallback step (${fallbackStep + 1} of ${script.length})`} cmd={script[fallbackStep]?.title ?? "end of the script"} onRun={async () => { const step = script[fallbackStep]; if (!step) return { ok: false, text: "end of the fallback script" }; window.dispatchEvent(new CustomEvent("stokvel:fallback-step", { detail: step.payload })); setFallbackStep((n) => n + 1); return { ok: true, text: step.title }; }} />
          )}
          <Cmd id="reset-bank" label="Reset the mock bank" cmd={`POST ${M}/__mock/reset`} onRun={() => mock("reset")} />
        </Group>

        <section className="border-t border-line pt-3">
          <div className="text-xs uppercase tracking-wider text-muted">What ran</div>
          <ul className="font-mono mt-2 space-y-2 text-[11px] leading-snug">
            {log.length === 0 && <li className="text-muted">nothing yet</li>}
            {log.map((l, i) => (
              <li key={i}>
                <span className="text-muted">{l.at}</span> <span className={l.result.ok ? "text-success" : "text-danger"}>{l.result.ok ? "✓" : "✗"}</span> <span className="break-all">{l.cmd}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}
