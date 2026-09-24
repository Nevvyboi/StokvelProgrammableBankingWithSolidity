"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useStage } from "@/lib/useStage";
import { Alarm } from "@/components/Alarm";
import { BankPanel } from "@/components/BankPanel";
import { Blocks, PotLine, Reconciliation, Roster } from "@/components/ChainPanel";
import { FeedPanel } from "@/components/FeedPanel";
import { QuiltWall } from "@/components/QuiltWall";

function Dashboard() {
  const params = useSearchParams();
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const fromUrl = params.get("fallback") === "1";
    let stored = false;
    try {
      stored = localStorage.getItem("stokvel:fallback") === "1";
    } catch {}
    setFallback(fromUrl || stored);
    const bc = new BroadcastChannel("stokvel-stage");
    bc.onmessage = (e) => {
      if (e.data?.type === "fallback") setFallback(!!e.data.on);
      if (e.data?.type === "step") window.dispatchEvent(new CustomEvent("stokvel:fallback-step", { detail: e.data.payload }));
    };
    return () => bc.close();
  }, [params]);
  const s = useStage({ fallback });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") s.dismissAlarm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  return (
    <main className="flex h-screen flex-col overflow-hidden px-10 pb-5 pt-6">
      <Alarm alarm={s.alarm} onDismiss={s.dismissAlarm} />

      <header className="flex items-end justify-between pb-4">
        <div className="flex items-baseline gap-5">
          <h1 className="font-display text-[2.6rem] font-medium leading-none tracking-tight">The Q4 Stokvel</h1>
          <span className="text-lg text-muted">the treasurer's book, kept in public</span>
        </div>
        <div className="font-mono flex items-center gap-5 text-sm text-muted">
          {fallback && <span className="stamp soft text-lerato">fallback</span>}
          <span>
            chain <span className={s.chainUp ? "text-success" : "text-danger"}>{s.chainUp ? "up" : "down"}</span>
          </span>
          <span>
            relayer <span className={s.relayerUp ? "text-success" : "text-danger"}>{s.relayerUp ? "up" : "down"}</span>
          </span>
          {s.cfg && <span>{s.cfg.chainId === 84532 ? "Base Sepolia" : "Anvil, local"}</span>}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[5fr_7fr] gap-12 overflow-hidden">
        <BankPanel bank={s.bank} up={s.relayerUp} mode={s.cfg?.mode ?? "mock"} />

        <section className="page flex min-h-0 flex-col overflow-hidden">
          <div className="running-head">
            <span>
              <b>The chain</b> · Stokvel.sol · rules and record, no money
            </span>
            <Blocks blocks={s.blocks} />
          </div>
          {s.state ? (
            <>
              <div className="mt-6">
                <PotLine state={s.state} />
              </div>
              <div className="mt-4">
                <Reconciliation state={s.state} />
              </div>
              <div className="mt-4">
                <Roster state={s.state} />
              </div>
              <div className="mt-auto pt-3">
                <div className="mb-2 flex items-baseline justify-between text-sm text-muted">
                  <span>The quilt. One patch per contribution, in the member's colour.</span>
                  <span className="font-mono">page 2 of 2</span>
                </div>
                <QuiltWall events={s.events} size={40} max={52} />
              </div>
            </>
          ) : (
            <div className="mt-8 text-lg text-muted">{s.chainUp ? "Reading the contract…" : "The chain is unreachable. Switch the presenter panel to fallback mode."}</div>
          )}
        </section>
      </div>

      <section className="page mt-5 h-[215px] shrink-0 overflow-hidden">
        <div className="running-head">
          <span>
            <b>Minute book</b> · what crossed between the bank and the chain
          </span>
          <span>the relayer carries, the contract decides</span>
        </div>
        <div className="mt-2">
          <FeedPanel feed={s.feed} cfg={s.cfg} rows={4} />
        </div>
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
