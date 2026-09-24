"use client";

import { useEffect, useRef, useState } from "react";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useStage } from "@/lib/useStage";
import { MEMBERS, formatRands } from "@/lib/members";
import { anvilMember, nonceOf, relayerPost, signJoin, signVote } from "@/lib/signing";
import type { ProposalState } from "@/lib/chain";

type CardKey = { label: string; name: string; privateKey: `0x${string}`; address: string; memberId?: number };

/**
 * The hidden presenter panel. One button per demo step, a log of what each call returned, and the
 * fallback toggle. In rehearsals it can sign as any member with the throwaway keys; on the night
 * the volunteers' cards do that on /sign.
 */
export default function Presenter() {
  const s = useStage({ poll: 2000 });
  const [log, setLog] = useState<string[]>([]);
  const [keys, setKeys] = useState<CardKey[]>([]);
  const [fallback, setFallback] = useState(false);
  const [fallbackStep, setFallbackStep] = useState(0);
  const [script, setScript] = useState<Array<{ title: string; payload: unknown }>>([]);
  const channel = useRef<BroadcastChannel | null>(null);
  const loadedOnce = useRef(false);

  const say = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 80));

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    channel.current = new BroadcastChannel("stokvel-stage");
    try {
      setFallback(localStorage.getItem("stokvel:fallback") === "1");
    } catch {}
    fetch("/fallback/script.json").then((r) => r.json()).then(setScript).catch(() => {});
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => {
        if (d.keys) {
          setKeys(d.keys.map((k: { label: string; name: string; privateKey: `0x${string}`; memberId?: number }) => ({ ...k, address: privateKeyToAccount(k.privateKey).address })));
          say("loaded member keys from cards/out/keys.json");
        } else {
          const pk = (i: number) => toHex(anvilMember(i).getHdKey().privateKey!);
          setKeys([
            ...MEMBERS.map((m) => ({ label: m.number, name: m.name, privateKey: pk(m.memberId), address: anvilMember(m.memberId).address, memberId: m.memberId })),
            { label: "04b", name: "spare 04b", privateKey: pk(6), address: anvilMember(6).address },
            { label: "07", name: "spare 07", privateKey: pk(7), address: anvilMember(7).address },
          ]);
          say("no cards/out/keys.json, using Anvil's public test keys as the members");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cfg = s.cfg;
  const mock = async (path: string, body: unknown = {}) => {
    if (!cfg) return null;
    try {
      const r = await fetch(`${cfg.mockUrl}/__mock/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
      say(`mock ${path}: ${JSON.stringify(r).slice(0, 160)}`);
      return r;
    } catch (err) {
      say(`mock ${path} failed: ${String(err)}`);
      return null;
    }
  };
  const relayer = async (path: string, body: unknown = {}) => {
    if (!cfg) return null;
    try {
      const r = await relayerPost(cfg, path, body);
      say(`relayer ${path}: ${JSON.stringify(r).slice(0, 160)}`);
      return r;
    } catch (err) {
      say(`relayer ${path} failed: ${String(err)}`);
      return null;
    }
  };

  const signAs = async (k: CardKey, what: "join" | { proposalId: bigint }) => {
    if (!cfg) return;
    const account = privateKeyToAccount(k.privateKey);
    if (what === "join") {
      const text = (await fetch("/api/constitution").then((r) => r.json())).text as string;
      await relayer("/join", { signature: await signJoin(account, cfg, text) });
    } else {
      const nonce = await nonceOf(cfg, account.address);
      await relayer("/votes", { proposalId: what.proposalId.toString(), nonce: nonce.toString(), signature: await signVote(account, cfg, what.proposalId, nonce) });
    }
  };

  const open: ProposalState[] = (s.state?.proposals ?? []).filter((p) => !p.executed);
  const latest = open[open.length - 1];
  const unpaid = (s.state?.members ?? []).filter((m) => m.paidThisRound < (s.state?.contributionCents ?? 0n));
  const spare = keys.find((k) => k.label === "04b");

  const toggleFallback = () => {
    const next = !fallback;
    setFallback(next);
    try {
      localStorage.setItem("stokvel:fallback", next ? "1" : "0");
    } catch {}
    channel.current?.postMessage({ type: "fallback", on: next });
    say(next ? "fallback mode ON: the dashboard now plays the canned script (open / with ?fallback=1)" : "fallback mode off");
  };
  const fallbackNext = () => {
    const step = script[fallbackStep];
    if (!step) return say("end of the fallback script");
    channel.current?.postMessage({ type: "step", payload: step.payload });
    say(`fallback step ${fallbackStep + 1}: ${step.title}`);
    setFallbackStep((n) => n + 1);
  };

  const timelockLeft = latest && latest.eta ? Math.max(0, latest.eta - (s.state?.blockTime ?? 0)) : null;
  const Btn = ({ children, onClick, tone = "" }: { children: React.ReactNode; onClick: () => void; tone?: string }) => (
    <button onClick={onClick} className={`border border-line px-3.5 py-2 text-left text-[15px] hover:border-text ${tone}`}>
      {children}
    </button>
  );
  const Step = ({ n, title, children }: { n: string; title: string; children: React.ReactNode }) => (
    <section className="page">
      <div className="running-head">
        <span>
          <b>{n}</b> · {title}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </section>
  );

  const chainOnly = cfg?.chainId !== 31337;

  return (
    <main className="mx-auto grid max-w-7xl grid-cols-[1fr_360px] gap-8 px-8 py-6">
      <div className="space-y-6">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-medium">Run sheet</h1>
            <div className="text-sm text-muted">presenter panel, keep it off the projector</div>
          </div>
          <div className="font-mono text-sm text-muted">
            round {s.state ? (s.state.round + 1n).toString() : "?"} · pot {s.state ? formatRands(s.state.pot) : "?"} · {s.relayerUp ? "relayer up" : "RELAYER DOWN"} · {chainOnly ? "no time travel on this chain" : "Anvil"}
          </div>
        </header>

        <Step n="DEMO 1" title="The committee signs the constitution">
          {keys.filter((k) => k.memberId !== undefined).map((k) => (
            <Btn key={k.label} onClick={() => signAs(k, "join")}>
              {k.label} {k.name} signs
            </Btn>
          ))}
          <Btn onClick={async () => { for (const k of keys.filter((k) => k.memberId !== undefined)) await signAs(k, "join"); }} tone="border-primary text-primary">all six</Btn>
        </Step>

        <Step n="DEMO 2" title="Card swipe and round-up">
          {MEMBERS.map((m) => (
            <Btn key={m.number} onClick={() => mock("swipe", { memberNumber: m.number, centsAmount: 8700 })}>
              {m.name} swipes R87 at the bakery
            </Btn>
          ))}
          <Btn onClick={() => mock("swipe", { memberNumber: "03", centsAmount: 24950, merchant: "Woolworths" })}>Aisha swipes R249.50</Btn>
        </Step>

        <Step n="before DEMO 3" title="Everyone pays this month's contribution">
          {unpaid.map((m) => (
            <Btn key={m.memberId} onClick={() => mock("credit", { memberNumber: MEMBERS[m.memberId]!.number, cents: Number(s.state!.contributionCents - m.paidThisRound) })}>
              {MEMBERS[m.memberId]!.name} pays {formatRands(s.state!.contributionCents - m.paidThisRound)}
            </Btn>
          ))}
          {unpaid.length === 0 && <span className="text-muted">Everyone has paid.</span>}
        </Step>

        <Step n="DEMO 3" title="Month end">
          <Btn tone="border-primary text-primary" onClick={async () => { await relayer("/admin/warp", { toRoundEnd: true }); await relayer("/admin/tick"); }}>
            Skip to month end and settle {chainOnly ? "(Anvil only)" : ""}
          </Btn>
          <Btn onClick={() => relayer("/admin/tick")}>Run the loops now</Btn>
        </Step>

        <Step n="DEMO 4" title="The treasurer steals">
          <Btn tone="border-danger text-danger" onClick={async () => { await mock("steal", { cents: 100_000 }); await relayer("/admin/tick"); }}>Take R1,000 out, then attest</Btn>
          <Btn onClick={async () => { await relayer("/admin/warp", { toRoundEnd: true }); await relayer("/admin/tick"); }}>Try to close the round</Btn>
          <Btn onClick={async () => { await mock("refund", { cents: 100_000 }); await relayer("/admin/warp", { seconds: 1 }); await relayer("/admin/tick"); }}>Put it back</Btn>
        </Step>

        <Step n="DEMO 5" title="Double webhook">
          <Btn tone="border-danger text-danger" onClick={async () => {
            const bank = await fetch(`${cfg!.relayerUrl}/bank`).then((r) => r.json());
            const tx = bank.transactions.find((t: { type: string }) => t.type === "CREDIT");
            if (!tx) return say("no credit to replay");
            await relayer("/admin/replay", { transaction: tx, target: "v1" });
            await relayer("/admin/replay", { transaction: tx, target: "v1" });
          }}>V1: same transaction twice (double credit)</Btn>
          <Btn tone="border-primary text-primary" onClick={() => mock("double-webhook", { times: 2 })}>V2: same webhook twice (AlreadyRecorded)</Btn>
        </Step>

        <Step n="DEMO 7" title="Vote: raise the contribution">
          <Btn tone="border-primary text-primary" onClick={() => relayer("/propose", { kind: 0, value: ((s.state?.contributionCents ?? 500000n) + 100000n).toString() })}>
            Propose {s.state ? `${formatRands(s.state.contributionCents)} to ${formatRands(s.state.contributionCents + 100000n)}` : "a raise"}
          </Btn>
          {latest && keys.filter((k) => k.memberId !== undefined).map((k) => (
            <Btn key={k.label} onClick={() => signAs(k, { proposalId: latest.id })}>
              {k.label} {k.name} votes #{latest.id.toString()}
            </Btn>
          ))}
          {latest && (
            <Btn onClick={async () => { if (timelockLeft && !chainOnly) await relayer("/admin/warp", { seconds: timelockLeft + 1 }); await relayer("/execute", { proposalId: latest.id.toString() }); }}>
              Execute #{latest.id.toString()} {timelockLeft !== null ? `(timelock ${timelockLeft}s${chainOnly ? "" : ", will warp"})` : "(needs 4 votes)"}
            </Btn>
          )}
        </Step>

        <Step n="DEMO 8" title="Stolen card: move Sipho to card 04b">
          <Btn tone="border-primary text-primary" onClick={() => spare && relayer("/propose", { kind: 1, memberId: 5, newAddr: spare.address })}>Propose RotateKey 06 to 04b</Btn>
          {keys.find((k) => k.label === "06") && <Btn tone="border-danger text-danger" onClick={() => latest && signAs(keys.find((k) => k.label === "06")!, { proposalId: latest.id })}>Thief votes with the stolen 06 card</Btn>}
          {spare && <Btn onClick={() => latest && signAs(spare, { proposalId: latest.id })}>04b votes as Sipho</Btn>}
        </Step>

        <Step n="DEMO 9" title="Kill the server">
          <Btn tone="border-danger text-danger" onClick={() => relayer("/admin/kill")}>Stop the relayer (the launcher restarts it)</Btn>
          <Btn onClick={() => s.refresh()}>Reload the dashboard state from chain</Btn>
        </Step>

        <Step n="Fallback" title="If the live path dies">
          <Btn tone={fallback ? "border-lerato text-lerato" : ""} onClick={toggleFallback}>{fallback ? "Fallback mode is ON, turn it off" : "Switch the dashboard to fallback mode"}</Btn>
          {fallback && <Btn onClick={fallbackNext}>Next fallback step ({fallbackStep + 1} of {script.length})</Btn>}
          <Btn onClick={() => mock("reset")}>Reset the mock bank</Btn>
        </Step>
      </div>

      <aside className="page sticky top-6 h-[calc(100vh-3rem)] overflow-auto">
        <div className="running-head">
          <span>
            <b>Log</b>
          </span>
        </div>
        <ul className="font-mono mt-3 space-y-1 text-xs text-muted">
          {log.map((l, i) => (
            <li key={i} className={i === 0 ? "text-text" : ""}>{l}</li>
          ))}
        </ul>
      </aside>
    </main>
  );
}

