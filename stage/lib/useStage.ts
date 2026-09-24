"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicClient } from "viem";
import { loadStageConfig, type StageConfig } from "./config";
import { publicClientFor, readEvents, readState, recentBlocks, type BlockInfo, type ChainState, type StokvelEvent } from "./chain";

export type FeedItem = {
  seq: number;
  at: number;
  kind: "bank->chain" | "chain->bank" | "refused" | "info" | "reserves" | "vote";
  title: string;
  detail?: string;
  hash?: string;
  error?: string;
};

export type BankState = {
  accountId: string;
  balance: { currentBalance: number; currency: string };
  transactions: Array<{ type: "CREDIT" | "DEBIT"; description: string; amount: number; transactionDate: string; uuid?: string; postedOrder: number }>;
  at: number;
};

export type Alarm = { kind: "ReservesShort" | "AlreadyRecorded" | "Refused"; title: string; detail: string; at: number };

export type Stage = {
  cfg: StageConfig | null;
  client: PublicClient | null;
  state: ChainState | null;
  events: StokvelEvent[];
  blocks: BlockInfo[];
  feed: FeedItem[];
  bank: BankState | null;
  relayerUp: boolean;
  chainUp: boolean;
  alarm: Alarm | null;
  fallback: boolean;
  dismissAlarm: () => void;
  refresh: () => Promise<void>;
};

const ALARM_MS = 9000;

/**
 * One hook for every page. Truth comes from the chain (state and events), colour comes from the
 * relayer's feed, and the bank half comes through the relayer so the browser never sees credentials.
 * In fallback mode everything comes from /fallback/snapshot.json and the presenter steps a script.
 */
export function useStage(opts: { poll?: number; fallback?: boolean } = {}): Stage {
  const poll = opts.poll ?? 2000;
  const [cfg, setCfg] = useState<StageConfig | null>(null);
  const [state, setState] = useState<ChainState | null>(null);
  const [events, setEvents] = useState<StokvelEvent[]>([]);
  const [blocks, setBlocks] = useState<BlockInfo[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [bank, setBank] = useState<BankState | null>(null);
  const [relayerUp, setRelayerUp] = useState(true);
  const [chainUp, setChainUp] = useState(true);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const fallback = opts.fallback ?? false;
  const lastBlock = useRef<bigint>(-1n);
  const lastSeq = useRef(0);
  const client = useMemo(() => (cfg ? publicClientFor(cfg) : null), [cfg]);

  useEffect(() => {
    loadStageConfig().then(setCfg).catch(() => setChainUp(false));
  }, []);

  // ---------------------------------------------------------------- fallback: canned data
  useEffect(() => {
    if (!fallback) return;
    let cancelled = false;
    const load = async () => {
      const snap = await fetch("/fallback/snapshot.json").then((r) => r.json());
      if (cancelled) return;
      setState(reviveState(snap.state));
      setEvents(snap.events.map(reviveEvent));
      setBlocks(snap.blocks.map((b: { number: string; timestamp: number; txCount: number; hash: string }) => ({ ...b, number: BigInt(b.number) })));
      setFeed(snap.feed);
      setBank(snap.bank);
    };
    load();
    const onStep = (e: Event) => {
      const step = (e as CustomEvent).detail as { feed?: FeedItem[]; patch?: Record<string, unknown>; bank?: BankState; alarm?: Alarm; events?: unknown[] };
      if (step.feed) setFeed((f) => [...f, ...step.feed!.map((i) => ({ ...i, at: Date.now() }))]);
      if (step.patch) setState((s) => (s ? { ...s, ...reviveState(step.patch!) } : s));
      if (step.bank) setBank(step.bank);
      if (step.events) setEvents((ev) => [...ev, ...step.events!.map(reviveEvent)]);
      if (step.alarm) setAlarm({ ...step.alarm, at: Date.now() });
    };
    window.addEventListener("stokvel:fallback-step", onStep);
    return () => {
      cancelled = true;
      window.removeEventListener("stokvel:fallback-step", onStep);
    };
  }, [fallback]);

  // ---------------------------------------------------------------- chain: state, events, blocks
  const refresh = async () => {
    if (!cfg || !client || fallback) return;
    try {
      const [s, b] = await Promise.all([readState(client, cfg.stokvel), recentBlocks(client, 8)]);
      setState(s);
      setBlocks(b);
      if (s.blockNumber !== lastBlock.current) {
        const from = lastBlock.current < 0n ? BigInt(cfg.deployedAtBlock) : lastBlock.current + 1n;
        const fresh = await readEvents(client, cfg.stokvel, from);
        if (fresh.length) setEvents((old) => dedupe([...old, ...fresh]));
        lastBlock.current = s.blockNumber;
      }
      setChainUp(true);
    } catch {
      setChainUp(false);
    }
  };

  useEffect(() => {
    if (!cfg || !client || fallback) return;
    refresh();
    const t = setInterval(refresh, poll);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, client, fallback, poll]);

  // ---------------------------------------------------------------- relayer: feed and bank
  useEffect(() => {
    if (!cfg || fallback) return;
    let stop = false;
    const tick = async () => {
      try {
        const [f, b] = await Promise.all([
          fetch(`${cfg.relayerUrl}/feed?since=${lastSeq.current}`).then((r) => r.json()) as Promise<FeedItem[]>,
          fetch(`${cfg.relayerUrl}/bank`).then((r) => (r.ok ? r.json() : null)) as Promise<BankState | null>,
        ]);
        if (stop) return;
        if (f.length) {
          lastSeq.current = f[f.length - 1]!.seq;
          setFeed((old) => [...old, ...f].slice(-120));
          // only a fresh refusal raises the alarm; a reload must not replay an old one
          const bad = [...f].reverse().find((i) => i.error && i.at > Date.now() - 20_000);
          if (bad) {
            const kind: Alarm["kind"] = bad.error!.startsWith("ReservesShort") ? "ReservesShort" : bad.error!.startsWith("AlreadyRecorded") ? "AlreadyRecorded" : "Refused";
            setAlarm({ kind, title: bad.title, detail: bad.error!, at: Date.now() });
          }
        }
        if (b) setBank(b);
        setRelayerUp(true);
      } catch {
        if (!stop) setRelayerUp(false);
      }
    };
    tick();
    const t = setInterval(tick, Math.max(1000, poll / 2));
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [cfg, fallback, poll]);

  useEffect(() => {
    if (!alarm) return;
    const t = setTimeout(() => setAlarm(null), ALARM_MS);
    return () => clearTimeout(t);
  }, [alarm]);

  return { cfg, client, state, events, blocks, feed, bank, relayerUp, chainUp, alarm, fallback, dismissAlarm: () => setAlarm(null), refresh };
}

function dedupe(list: StokvelEvent[]): StokvelEvent[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = `${e.txHash}:${e.logIndex}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const BIG = new Set(["round", "pot", "unsettled", "totalIn", "settledOut", "reservesCents", "contributionCents", "blockNumber"]);

function reviveState(raw: Record<string, unknown>): ChainState {
  const out: Record<string, unknown> = { ...raw };
  for (const k of BIG) if (typeof out[k] === "string" || typeof out[k] === "number") out[k] = BigInt(out[k] as string);
  if (Array.isArray(out.members)) out.members = out.members.map((m) => ({ ...m, paidCents: BigInt(m.paidCents), paidThisRound: BigInt(m.paidThisRound) }));
  if (Array.isArray(out.proposals)) out.proposals = out.proposals.map((p) => ({ ...p, id: BigInt(p.id), value: BigInt(p.value) }));
  return out as ChainState;
}

function reviveEvent(e: unknown): StokvelEvent {
  const r = e as StokvelEvent & { blockNumber: string | bigint };
  return { ...r, blockNumber: BigInt(r.blockNumber) };
}

/** Stringify chain state for the fallback snapshot (BigInt safe). */
export function serialise(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
