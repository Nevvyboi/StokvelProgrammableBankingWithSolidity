"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useStage } from "@/lib/useStage";
import { FOCUS, type Focus } from "@/lib/focus";
import { Alarm } from "@/components/Alarm";
import { BankPanel } from "@/components/BankPanel";
import { Blocks, PotLine, Reconciliation, Roster } from "@/components/ChainPanel";
import { FeedPanel } from "@/components/FeedPanel";
import { QuiltWall } from "@/components/QuiltWall";

// the board is laid out once, for a 1080p projector, and scaled to whatever window it's in, so a
// laptop screen or a smaller window shows all of it, smaller, instead of cutting the bottom off
const W = 1920;
const H = 1080;
// what's left for a focused section: the board minus its padding and the header
const FOCUS_W = W - 80;
const FOCUS_H = H - 150;

function useFit() {
  const [fit, setFit] = useState({ k: 1, x: 0, y: 0 });
  useEffect(() => {
    const f = () => {
      const k = Math.min(window.innerWidth / W, window.innerHeight / H);
      setFit({ k, x: (window.innerWidth - W * k) / 2, y: (window.innerHeight - H * k) / 2 });
    };
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return fit;
}

/** One section, scaled up by z to fill the focus area. */
function Zoomed({ z, children }: { z: number; children: ReactNode }) {
  return (
    <div style={{ width: FOCUS_W / z, height: FOCUS_H / z, transform: `scale(${z})`, transformOrigin: "top left" }}>{children}</div>
  );
}

function Dashboard() {
  const params = useSearchParams();
  const [fallback, setFallback] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const fit = useFit();
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
      if (e.data?.type === "focus") setFocus(e.data.focus ?? null);
    };
    return () => bc.close();
  }, [params]);
  const s = useStage({ fallback });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (s.alarm) s.dismissAlarm();
        else setFocus(null);
      }
      if (e.key === "0") setFocus(null);
      const f = FOCUS.find((x) => x.key === e.key);
      if (f) setFocus((cur) => (cur === f.id ? null : f.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  const label = focus ? FOCUS.find((f) => f.id === focus)!.label : null;
  const zoomable = (id: Focus) => ({ onClick: () => setFocus(id), className: "cursor-zoom-in", title: "Click, or press its number, to fill the screen" });

  return (
    <div className="fixed inset-0 overflow-hidden">
      <div style={{ width: W, height: H, transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.k})`, transformOrigin: "top left" }}>
        <main className="flex h-full flex-col overflow-hidden px-10 pb-5 pt-6">
          <Alarm alarm={s.alarm} onDismiss={s.dismissAlarm} />

          <header className="flex items-end justify-between pb-4">
            <div className="flex items-baseline gap-5">
              <h1 className="font-display text-[2.6rem] font-medium leading-none tracking-tight">The Q4 Stokvel</h1>
              <span className="text-lg text-muted">{label ?? "the treasurer's book, kept in public"}</span>
            </div>
            <div className="font-mono flex items-center gap-5 text-sm text-muted">
              {fallback && <span className="stamp soft text-lerato">fallback</span>}
              {focus && (
                <button className="border border-line px-2 py-0.5 hover:border-text" onClick={() => setFocus(null)}>
                  everything (0)
                </button>
              )}
              <span>
                chain <span className={s.chainUp ? "text-success" : "text-danger"}>{s.chainUp ? "up" : "down"}</span>
              </span>
              <span>
                relayer <span className={s.relayerUp ? "text-success" : "text-danger"}>{s.relayerUp ? "up" : "down"}</span>
              </span>
              {s.cfg && <span>{s.cfg.chainId === 84532 ? "Base Sepolia" : "Anvil, local"}</span>}
            </div>
          </header>

          {focus ? (
            <div className="min-h-0 flex-1 cursor-zoom-out overflow-hidden" onClick={() => setFocus(null)} title="Click, or press 0 or Esc, for everything">
              {focus === "bank" && (
                <Zoomed z={1.45}>
                  <BankPanel bank={s.bank} up={s.relayerUp} mode={s.cfg?.mode ?? "mock"} />
                </Zoomed>
              )}
              {focus === "pot" && s.state && (
                <Zoomed z={2.4}>
                  <section className="page">
                    <PotLine state={s.state} />
                    <div className="mt-6">
                      <Reconciliation state={s.state} />
                    </div>
                  </section>
                </Zoomed>
              )}
              {focus === "roster" && s.state && (
                <Zoomed z={2.7}>
                  <section className="page">
                    <Roster state={s.state} />
                  </section>
                </Zoomed>
              )}
              {focus === "minutes" && (
                <Zoomed z={1.6}>
                  <section className="page">
                    <div className="running-head">
                      <span>
                        <b>Minute book</b> · what crossed between the bank and the chain
                      </span>
                      <span>the relayer carries, the contract decides</span>
                    </div>
                    <div className="mt-2">
                      <FeedPanel feed={s.feed} cfg={s.cfg} rows={9} />
                    </div>
                  </section>
                </Zoomed>
              )}
              {focus === "quilt" && (
                <section className="page h-full">
                  <div className="mb-4 text-xl text-muted">The quilt. One patch per contribution, in the member's colour.</div>
                  <QuiltWall events={s.events} size={88} max={160} />
                </section>
              )}
            </div>
          ) : (
            <>
              <div className="grid min-h-0 flex-1 grid-cols-[5fr_7fr] gap-12 overflow-hidden">
                <div {...zoomable("bank")} className="min-h-0 cursor-zoom-in overflow-hidden">
                  <BankPanel bank={s.bank} up={s.relayerUp} mode={s.cfg?.mode ?? "mock"} />
                </div>

                <section className="page flex min-h-0 flex-col overflow-hidden">
                  <div className="running-head">
                    <span>
                      <b>The chain</b> · Stokvel.sol · rules and record, no money
                    </span>
                    <Blocks blocks={s.blocks} />
                  </div>
                  {s.state ? (
                    <>
                      <div {...zoomable("pot")}>
                        <div className="mt-6">
                          <PotLine state={s.state} />
                        </div>
                        <div className="mt-4">
                          <Reconciliation state={s.state} />
                        </div>
                      </div>
                      <div {...zoomable("roster")} className="mt-4 cursor-zoom-in">
                        <Roster state={s.state} />
                      </div>
                      <div {...zoomable("quilt")} className="mt-auto cursor-zoom-in pt-3">
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

              <section {...zoomable("minutes")} className="page mt-5 h-[215px] shrink-0 cursor-zoom-in overflow-hidden">
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
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
