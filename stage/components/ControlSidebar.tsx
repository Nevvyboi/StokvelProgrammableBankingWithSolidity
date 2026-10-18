"use client";

import { useEffect, useRef, useState } from "react";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadStageConfig } from "@/lib/config";
import { FOCUS, type Focus } from "@/lib/focus";
import { MEMBERS, formatRands } from "@/lib/members";
import { anvilMember, nonceOf, relayerPost, signJoin, signVote } from "@/lib/signing";
import type { useStage } from "@/lib/useStage";
import { REHEARSAL_STANDINS, RUN_ORDER } from "@/lib/runOrder";

// every command in the run order, in order, so the next one can be highlighted as you go
const ORDER_CMDS = RUN_ORDER.flatMap((d) => d.steps.flatMap((x) => ("cmd" in x ? [x.cmd] : [])));

type Stage = ReturnType<typeof useStage>;
type CardKey = { label: string; name: string; privateKey: `0x${string}`; address: string; memberId?: number };
type Result = { ok: boolean; text: string };
type Line = { kind: "in" | "call" | "ok" | "err" | "info"; text: string };

/** One thing you can type: a few words, and the calls it really makes. */
type Command = {
  words: string; // what you type, with <args>
  about: string; // what it does, in a few words
  calls: (a: string[]) => string[]; // the full calls, as the room sees them
  run: (a: string[]) => Promise<Result | Result[]>;
};

/**
 * The run sheet, as a console on the projector page. Type a few words ("monthend", "steal 1000",
 * "zoom roster"); it prints the calls they really make, runs them, and prints what came back,
 * while the board changes behind it. It floats over the board, which keeps its size.
 */
export function ControlSidebar({
  s,
  open,
  onClose,
  setFocus,
  setFallback,
}: {
  s: Stage;
  open: boolean;
  onClose: () => void;
  setFocus: (f: Focus | null) => void;
  setFallback: (on: boolean) => void;
}) {
  const [lines, setLines] = useState<Line[]>([{ kind: "info", text: "Type a command, or click one below. help lists them all." }]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIndex, setHIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"order" | "commands">("order");
  const [pos, setPos] = useState(0); // the next command in the run order
  const [keys, setKeys] = useState<CardKey[]>([]);
  const [fallbackStep, setFallbackStep] = useState(0);
  const [script, setScript] = useState<Array<{ title: string; payload: unknown }>>([]);
  const loadedOnce = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const cfg = s.cfg;

  // focus the box when it opens; when it closes, give the keyboard back to the board, or the
  // hidden box keeps it and swallows D and the zoom keys (and types them into the next command)
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
    inputRef.current?.blur();
  }, [open]);
  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    fetch("/fallback/script.json").then((r) => r.json()).then(setScript).catch(() => {});
    // scripts/demo.sh prints the board's URL with #k=<token> so rehearsals can sign as the members;
    // the fragment never reaches a server log. On a server the card keys are never there at all
    let token = "";
    try {
      const m = window.location.hash.match(/k=([0-9a-f]+)/);
      if (m) {
        sessionStorage.setItem("stokvel:presenter-token", m[1]!);
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      }
      token = sessionStorage.getItem("stokvel:presenter-token") ?? "";
    } catch {}
    fetch("/api/keys", { headers: { "x-presenter-token": token } })
      .then((r) => (r.ok ? r.json() : { error: r.status }))
      .then(async (d) => {
        if (d.keys) {
          setKeys(d.keys.map((k: { label: string; name: string; privateKey: `0x${string}`; memberId?: number }) => ({ ...k, address: privateKeyToAccount(k.privateKey).address })));
        } else if (await loadStageConfig().then((c) => c.chainId !== 31337 || c.spareAddress)) {
          setKeys([]); // the printed cards are the members, and they sign on phones
        } else {
          const pk = (i: number) => toHex(anvilMember(i).getHdKey().privateKey!);
          setKeys([
            ...MEMBERS.map((m) => ({ label: m.number, name: m.name, privateKey: pk(m.memberId), address: anvilMember(m.memberId).address, memberId: m.memberId })),
            { label: "06b", name: "spare 06b", privateKey: pk(6), address: anvilMember(6).address },
          ]);
        }
      })
      .catch(() => {});
  }, []);

  // ------------------------------------------------------------------ the real calls
  const brief = (v: unknown) => JSON.stringify(v).replace(/"(\w+)":/g, "$1:").slice(0, 140);
  const mock = async (path: string, body: unknown = {}): Promise<Result> => {
    if (!cfg) return { ok: false, text: "no config yet" };
    try {
      const res = await fetch(`${cfg.mockUrl}/__mock/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json().catch(() => ({}));
      return { ok: res.ok && !r.error, text: r.error ? String(r.error) : brief(r) };
    } catch (err) {
      return { ok: false, text: String(err).split("\n")[0]! };
    }
  };
  const relayer = async (path: string, body: unknown = {}): Promise<Result> => {
    if (!cfg) return { ok: false, text: "no config yet" };
    try {
      const r = await relayerPost(cfg, path, body);
      return { ok: r.ok !== false && !r.error, text: r.error ? String(r.error) : brief(r) };
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

  // ------------------------------------------------------------------ who and how much
  const st = s.state;
  const latest = (st?.proposals ?? []).filter((p) => !p.executed).at(-1);
  const members = keys.filter((k) => k.memberId !== undefined);
  const spare = keys.find((k) => k.label === "06b");
  const chainOnly = cfg?.chainId !== 31337;
  const member = (word?: string) => {
    const w = (word ?? "").toLowerCase();
    return w ? MEMBERS.find((m) => m.name.toLowerCase() === w || m.number === w.padStart(2, "0")) : undefined;
  };
  const rands = (word: string | undefined, fallbackCents: number) => {
    const n = word ? Number(word.replace(/^r/i, "").replace(/,/g, "")) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : fallbackCents;
  };
  const noKeys: Result = { ok: false, text: "the card keys aren't here: members sign with their cards, on their phones" };
  const each = async <T,>(xs: T[], f: (x: T) => Promise<Result>) => {
    const out: Result[] = [];
    for (const x of xs) out.push(await f(x));
    return out.length ? out : [{ ok: false, text: "nobody matched" }];
  };
  const unpaid = () => (st?.members ?? []).filter((m) => m.paidThisRound < (st?.contributionCents ?? 0n));
  const payees = (a: string[]) => (a[0] === "all" || !a[0] ? unpaid() : unpaid().filter((m) => MEMBERS[m.memberId]!.number === member(a[0])?.number));

  const commands: Command[] = [
    {
      words: "swipe <name> <rands>",
      about: "a card buys something; the card code rounds it up to R10 and sends the change",
      calls: (a) => [`POST /mock/__mock/swipe {memberNumber:"${member(a[0])?.number ?? "03"}", centsAmount:${rands(a[1], 8700)}}`, "→ card main.js, the round-up transfer, ref STK-0n"],
      run: (a) => mock("swipe", { memberNumber: member(a[0])?.number ?? "03", centsAmount: rands(a[1], 8700) }),
    },
    {
      words: "pay <name|all>",
      about: "members pay the rest of this month's contribution",
      calls: (a) => payees(a).map((m) => `POST /mock/__mock/credit {memberNumber:"${MEMBERS[m.memberId]!.number}", cents:${(st!.contributionCents - m.paidThisRound).toString()}}`),
      run: async (a) => {
        if (!st) return { ok: false, text: "chain not read yet" };
        const who = payees(a);
        if (!who.length) return { ok: true, text: a[0] && a[0] !== "all" ? `${member(a[0])?.name ?? a[0]} has already paid` : "everyone has paid" };
        return each(who, (m) => mock("credit", { memberNumber: MEMBERS[m.memberId]!.number, cents: Number(st.contributionCents - m.paidThisRound) }));
      },
    },
    {
      words: "monthend",
      about: "skip to month end, then close the round and pay the next member",
      calls: () => ["POST /relayer/admin/warp {toRoundEnd:true}  → evm_increaseTime", "POST /relayer/admin/tick  → postReserves(), closeRound(), payout"],
      run: async () => (chainOnly ? { ok: false, text: "time travel only works on Anvil" } : [await relayer("/admin/warp", { toRoundEnd: true }), await relayer("/admin/tick")]),
    },
    {
      words: "tick",
      about: "run the relayer's loops now: attest, close if due, settle",
      calls: () => ["POST /relayer/admin/tick"],
      run: () => relayer("/admin/tick"),
    },
    {
      words: "steal <rands>",
      about: "the treasurer takes money out; the attestor signs the new balance",
      calls: (a) => [`POST /mock/__mock/steal {cents:${rands(a[0], 100_000)}}`, "POST /relayer/admin/tick  → postReserves()"],
      run: async (a) => [await mock("steal", { cents: rands(a[0], 100_000) }), await relayer("/admin/tick")],
    },
    {
      words: "close",
      about: "try to close the round (FROZEN while the bank is short)",
      calls: () => ["POST /relayer/admin/warp {toRoundEnd:true}", "POST /relayer/admin/tick  → closeRound() reverts ReservesShort"],
      run: async () => [await relayer("/admin/warp", { toRoundEnd: true }), await relayer("/admin/tick")],
    },
    {
      words: "putback <rands>",
      about: "the money goes back, and the next attestation shows it",
      calls: (a) => [`POST /mock/__mock/refund {cents:${rands(a[0], 100_000)}}`, "POST /relayer/admin/warp {seconds:1}", "POST /relayer/admin/tick"],
      run: async (a) => [await mock("refund", { cents: rands(a[0], 100_000) }), await relayer("/admin/warp", { seconds: 1 }), await relayer("/admin/tick")],
    },
    {
      words: "double v1",
      about: "V1 gets the same bank transaction twice and counts it twice",
      calls: () => ["GET /relayer/bank  → the latest STK-0n credit", '2 × POST /relayer/admin/replay {target:"v1"}  → recordContribution()'],
      run: async () => {
        const bank = await fetch(`${cfg?.relayerUrl ?? "/relayer"}/bank`).then((r) => r.json()).catch(() => null);
        // a member's contribution: the newest credit with an STK-0n reference (not the putback refund)
        const tx = bank?.transactions?.find((t: { type: string; description?: string; reference?: string }) => t.type === "CREDIT" && /STK-0[1-6]/.test(`${t.description ?? ""} ${t.reference ?? ""}`));
        if (!tx) return { ok: false, text: "no member contribution on the statement to replay" };
        return [await relayer("/admin/replay", { transaction: tx, target: "v1" }), await relayer("/admin/replay", { transaction: tx, target: "v1" })];
      },
    },
    {
      words: "double v2",
      about: "V2 gets the same webhook twice and refuses the second",
      calls: () => ["POST /mock/__mock/double-webhook {times:2}  → second reverts AlreadyRecorded"],
      run: () => mock("double-webhook", { times: 2 }),
    },
    {
      words: "propose raise <rands>",
      about: "propose a new monthly contribution (default R1,000 more)",
      calls: (a) => [`POST /relayer/propose {kind:0, value:${a[0] ? rands(a[0], 0) : ((st?.contributionCents ?? 500000n) + 100000n).toString()}}  → propose()`],
      run: (a) => relayer("/propose", { kind: 0, value: (a[0] ? BigInt(rands(a[0], 0)) : (st?.contributionCents ?? 500000n) + 100000n).toString() }),
    },
    {
      words: "propose rotate",
      about: "propose moving Sipho (06) to the spare card 06b",
      calls: () => ["POST /relayer/propose {kind:1, memberId:5, newAddr:<card 06b>}  → propose()"],
      run: async () => {
        const to = spare?.address ?? cfg?.spareAddress;
        return to ? relayer("/propose", { kind: 1, memberId: 5, newAddr: to }) : { ok: false, text: "no card 06b: set SPARE_ADDRESS on the server" };
      },
    },
    {
      words: "execute",
      about: "carry out the latest proposal once it has four votes (skips the timelock on Anvil)",
      calls: () => [...(!chainOnly ? ["POST /relayer/admin/warp {seconds:<timelock left>}"] : []), `POST /relayer/execute {proposalId:${latest?.id ?? "?"}}  → execute()`],
      run: async () => {
        if (!latest) return { ok: false, text: "no open proposal" };
        const left = latest.eta ? Math.max(0, latest.eta - (st?.blockTime ?? 0)) : 0;
        const out: Result[] = [];
        if (left && !chainOnly) out.push(await relayer("/admin/warp", { seconds: left + 1 }));
        out.push(await relayer("/execute", { proposalId: latest.id.toString() }));
        return out;
      },
    },
    {
      words: "join <name|all>",
      about: "sign the constitution as a member (rehearsal; on the night, phones)",
      calls: (a) => [`${a[0] === "all" ? "6 × " : ""}sign Join, POST /relayer/join  → joinBySig()`],
      run: async (a) => {
        if (!members.length) return noKeys;
        const who = a[0] === "all" ? members : members.filter((k) => k.label === member(a[0])?.number);
        return each(who, (k) => signAs(k, "join"));
      },
    },
    {
      words: "vote <name|all>",
      about: "sign a vote on the latest proposal (rehearsal; on the night, phones)",
      calls: (a) => [`${a[0] === "all" ? "4 × " : ""}sign Vote, POST /relayer/votes  → voteBySig()`],
      run: async (a) => {
        if (!members.length) return noKeys;
        if (!latest) return { ok: false, text: "no open proposal" };
        const who = a[0] === "all" ? members.slice(0, 4) : a[0] === "06b" ? (spare ? [spare] : []) : members.filter((k) => k.label === member(a[0])?.number);
        return each(who, (k) => signAs(k, { proposalId: latest.id }));
      },
    },
    {
      words: "kill",
      about: "stop the relayer; it restarts itself and sends nothing twice",
      calls: () => ["POST /relayer/admin/kill  → the process exits, systemd restarts it"],
      run: () => relayer("/admin/kill"),
    },
    {
      words: "zoom <constitution|bank|pot|roster|minutes|quilt|all>",
      about: "fill the screen with one section (or keys 1 to 6, and 0)",
      calls: () => [],
      run: async (a) => {
        const f = a[0] ? FOCUS.find((x) => x.id === a[0] || x.key === a[0] || x.label.toLowerCase().startsWith(a[0]!)) : undefined;
        setFocus(f ? f.id : null);
        return { ok: true, text: f ? f.label : "everything" };
      },
    },
    {
      words: "fallback <on|off|next>",
      about: "the board plays a recorded script, no backend needed",
      calls: () => [],
      run: async (a) => {
        if (a[0] === "next") {
          const step = script[fallbackStep];
          if (!step) return { ok: false, text: "end of the fallback script" };
          window.dispatchEvent(new CustomEvent("stokvel:fallback-step", { detail: step.payload }));
          setFallbackStep((n) => n + 1);
          return { ok: true, text: `step ${fallbackStep + 1}: ${step.title}` };
        }
        const on = a[0] !== "off";
        setFallback(on);
        try {
          localStorage.setItem("stokvel:fallback", on ? "1" : "0");
        } catch {}
        return { ok: true, text: on ? "fallback on; fallback next steps the script" : "fallback off" };
      },
    },
    {
      words: "reset bank",
      about: "empty the mock bank's statement",
      calls: () => ["POST /mock/__mock/reset"],
      run: () => mock("reset"),
    },
  ];

  // ------------------------------------------------------------------ typing
  const fixed = (c: Command) => c.words.split(" ").filter((w) => !w.startsWith("<"));
  const find = (text: string): { c: Command; args: string[] } | null => {
    const parts = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // the other ways people type the same thing
    const alias: Record<string, string[]> = { "month end": ["monthend"], "put back": ["putback"], refund: ["putback"], screen: ["zoom"], "v1 double": ["double", "v1"], "v2 double": ["double", "v2"], rotate: ["propose", "rotate"], raise: ["propose", "raise"] };
    for (const [k, v] of Object.entries(alias)) {
      const kp = k.split(" ");
      if (kp.every((w, i) => parts[i] === w)) parts.splice(0, kp.length, ...v);
    }
    const matches = commands
      .map((c) => ({ c, f: fixed(c) }))
      .filter(({ f }) => f.every((w, i) => parts[i] === w))
      .sort((a, b) => b.f.length - a.f.length);
    return matches[0] ? { c: matches[0].c, args: parts.slice(matches[0].f.length) } : null;
  };
  const say = (...l: Line[]) => setLines((x) => [...x, ...l].slice(-200));

  const submit = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setHistory((h) => [t, ...h.filter((x) => x !== t)].slice(0, 50));
    setHIndex(-1);
    setInput("");
    // typing the highlighted run-order command, or one further on (a step skipped), moves the
    // highlight past it
    const norm = t.toLowerCase().replace(/\s+/g, " ");
    setPos((p) => {
      const at = ORDER_CMDS.indexOf(norm, p);
      return at === -1 ? p : at + 1;
    });
    if (t === "clear") return setLines([]);
    if (t === "help") return say({ kind: "in", text: t }, ...commands.map((c) => ({ kind: "info" as const, text: `${c.words}\n   ${c.about}` })));
    const hit = find(t);
    if (!hit) return say({ kind: "in", text: t }, { kind: "err", text: "not a command; help lists them" });
    say({ kind: "in", text: t }, ...hit.c.calls(hit.args).map((x) => ({ kind: "call" as const, text: x })));
    setBusy(true);
    try {
      const out = await hit.c.run(hit.args);
      const all = Array.isArray(out) ? out : [out];
      say(...all.map((r) => ({ kind: r.ok ? ("ok" as const) : ("err" as const), text: r.text })));
    } finally {
      setBusy(false);
    }
  };
  const complete = () => {
    const t = input.trim().toLowerCase();
    const options = Array.from(new Set(commands.map((c) => fixed(c).join(" ")))).filter((w) => w.startsWith(t));
    if (options.length === 1) setInput(options[0] + " ");
    else if (options.length > 1) say({ kind: "info", text: options.join("   ") });
  };

  return (
    <aside className={`fixed right-0 top-0 z-40 flex h-full w-[460px] flex-col border-l border-line bg-bg/95 shadow-2xl backdrop-blur transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`} aria-hidden={!open} inert={!open}>
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="font-display text-xl font-medium">Run sheet</div>
          <div className="font-mono text-xs text-muted">
            round {st ? (st.round + 1n).toString() : "?"} · pot {st ? formatRands(st.pot) : "?"} · {s.relayerUp ? "relayer up" : "RELAYER DOWN"}
            {latest ? ` · proposal #${latest.id} ${latest.yes}/6` : ""}
          </div>
        </div>
        <button onClick={onClose} className="border border-line px-2 py-1 text-sm text-muted hover:border-text" title="Close (D, or Esc in the box)">
          close ▸
        </button>
      </header>

      {/* what ran: your words, the real calls, what came back */}
      <div ref={outRef} className="font-mono min-h-0 flex-1 space-y-0.5 overflow-y-auto px-4 py-3 text-[12.5px] leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={l.kind === "in" ? "mt-2 text-[14px] text-text" : l.kind === "call" ? "break-all pl-3 text-muted" : l.kind === "ok" ? "break-all pl-3 text-success" : l.kind === "err" ? "break-all pl-3 text-danger" : "whitespace-pre-wrap text-muted"}>
            {l.kind === "in" ? `› ${l.text}` : l.kind === "ok" ? `✓ ${l.text}` : l.kind === "err" ? `✗ ${l.text}` : l.text}
          </div>
        ))}
        {busy && <div className="pl-3 text-muted">…</div>}
      </div>

      <form
        className="border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <div className="font-mono flex items-center gap-2 border border-line px-3 py-2 focus-within:border-text">
          <span className="text-primary">›</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // the board's own keys (1 to 5, 0, D) stay out of the box
              if (e.key === "Tab") {
                e.preventDefault();
                complete();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const i = Math.min(hIndex + 1, history.length - 1);
                if (history[i]) {
                  setHIndex(i);
                  setInput(history[i]!);
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                const i = hIndex - 1;
                setHIndex(Math.max(i, -1));
                setInput(i >= 0 ? history[i]! : "");
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="monthend, swipe aisha 87, steal 1000 …"
            className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/60"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </form>

      {/* the run order, and the commands: click a line to put it in the box */}
      <div className="flex max-h-[46%] min-h-[30%] flex-col border-t border-line">
        <div className="flex items-center gap-1 px-4 pt-2 text-xs uppercase tracking-wider">
          {(["order", "commands"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`border-b-2 px-2 py-1 ${tab === t ? "border-primary text-text" : "border-transparent text-muted hover:text-text"}`}>
              {t === "order" ? "Run order" : "All commands"}
            </button>
          ))}
          <span className="ml-auto normal-case tracking-normal text-muted">click to put it in the box · Tab · ↑</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "order" ? (
            <ol className="space-y-3">
              {(() => {
                let i = -1;
                return RUN_ORDER.map((d) => (
                  <li key={d.demo}>
                    <div className="text-xs uppercase tracking-wider text-muted">
                      <b className="text-text">{d.demo}</b> · {d.title}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {d.steps.map((x, j) => {
                        if ("cue" in x) return <li key={j} className="border-l-2 border-line pl-2 text-[12.5px] italic leading-snug text-muted">{x.cue}</li>;
                        i += 1;
                        const idx = i;
                        const state = idx < pos ? "done" : idx === pos ? "next" : "later";
                        return (
                          <li key={j}>
                            <button
                              onClick={() => {
                                setPos(idx);
                                setInput(x.cmd);
                                inputRef.current?.focus();
                              }}
                              className={`flex w-full items-baseline gap-2 text-left ${state === "next" ? "text-primary" : state === "done" ? "text-muted" : "hover:text-primary"}`}
                            >
                              <span className="font-mono w-3 shrink-0 text-xs">{state === "done" ? "✓" : state === "next" ? "▸" : ""}</span>
                              <span className={`font-mono text-[14px] ${state === "next" ? "font-semibold" : ""}`}>{x.cmd}</span>
                              {x.note && <span className="text-[11.5px] leading-snug text-muted">{x.note}</span>}
                            </button>
                          </li>
                        );
                      })}
                      {REHEARSAL_STANDINS[d.demo] && <li className="pl-5 text-[11.5px] text-muted">rehearsing alone, no volunteers: <span className="font-mono">{REHEARSAL_STANDINS[d.demo]}</span></li>}
                    </ul>
                  </li>
                ));
              })()}
            </ol>
          ) : (
            <ul className="space-y-1.5">
              {commands.map((c) => (
                <li key={c.words}>
                  <button
                    className="w-full text-left hover:text-primary"
                    onClick={() => {
                      const f = fixed(c).join(" ");
                      setInput(c.words.includes("<") ? f + " " : f);
                      inputRef.current?.focus();
                    }}
                  >
                    <span className="font-mono text-[14px]">{c.words}</span>
                    <span className="block text-[11.5px] leading-snug text-muted">{c.about}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
