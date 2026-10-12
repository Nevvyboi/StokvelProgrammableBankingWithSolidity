"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { useStage } from "@/lib/useStage";
import { MEMBERS } from "@/lib/members";
import { Patch } from "@/lib/quilt";
import { accountFromKey, describeProposal, nonceOf, parseCardQr, relayerPost, signJoin, signVote } from "@/lib/signing";
import type { ProposalState } from "@/lib/chain";
import { stokvelAbi } from "@/lib/abi";

type Phase = { step: "scan" } | { step: "holding"; address: string; memberId: number | null } | { step: "done"; ok: boolean; text: string; hash?: string };

/**
 * The signing slip. A volunteer's phone camera opens it straight from the card's QR (the key rides
 * after the #, which browsers never send to the server); or the station at the side of the stage
 * scans the card (webcam, or a USB scanner that types). Read the sentence, press Sign, and the key
 * is dropped from memory. It never leaves this page.
 */
export default function Sign() {
  const s = useStage({ poll: 2500 });
  const [phase, setPhase] = useState<Phase>({ step: "scan" });
  const [chosen, setChosen] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [constitution, setConstitution] = useState("");
  const keyRef = useRef<`0x${string}` | null>(null);
  const wedge = useRef("");
  const videoRef = useRef<HTMLVideoElement>(null);
  // a card opened from the phone camera: take the key out of the address bar at once, so it isn't
  // left in the tab or the history, and hold it until the chain client is ready
  const fromLink = useRef<`0x${string}` | null | undefined>(undefined);
  if (fromLink.current === undefined && typeof window !== "undefined") {
    fromLink.current = window.location.hash ? parseCardQr(window.location.href) : null;
  }
  // after hydration, or the router puts the URL it started with (key and all) back
  useEffect(() => {
    if (!window.location.hash) return;
    const clean = window.location.pathname + window.location.search;
    window.history.replaceState(window.history.state, "", clean);
    const t = setTimeout(() => window.location.hash && window.history.replaceState(window.history.state, "", clean), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    fetch("/api/constitution").then((r) => r.json()).then((d) => setConstitution(d.text));
  }, []);

  const acceptKey = useCallback(
    async (key: `0x${string}`) => {
      if (!s.client || !s.cfg) return;
      keyRef.current = key;
      const address = accountFromKey(key).address;
      const idPlusOne = await s.client.readContract({ address: s.cfg.stokvel, abi: stokvelAbi, functionName: "idOf", args: [address] });
      setPhase({ step: "holding", address, memberId: idPlusOne === 0n ? null : Number(idPlusOne) - 1 });
      setChosen(null);
    },
    [s.client, s.cfg],
  );

  useEffect(() => {
    if (fromLink.current && s.client && s.cfg) {
      const key = fromLink.current;
      fromLink.current = null;
      acceptKey(key);
    }
  }, [s.client, s.cfg, acceptKey]);

  // a USB scanner acts as a keyboard: it types the QR text fast and presses Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase.step !== "scan" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Enter") {
        const key = parseCardQr(wedge.current);
        wedge.current = "";
        if (key) acceptKey(key);
        return;
      }
      if (e.key.length === 1) wedge.current += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.step, acceptKey]);

  // webcam path: jsQR on video frames
  useEffect(() => {
    if (!camera || phase.step !== "scan") return;
    let stream: MediaStream | null = null;
    let raf = 0;
    const canvas = document.createElement("canvas");
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const loop = () => {
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height);
            const key = code ? parseCardQr(code.data) : null;
            if (key) {
              acceptKey(key);
              return;
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch {
        setCamera(false);
      }
    };
    start();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [camera, phase.step, acceptKey]);

  const wipe = () => {
    keyRef.current = null;
    wedge.current = "";
  };

  const openProposals: ProposalState[] = (s.state?.proposals ?? []).filter((p) => !p.executed);
  const holding = phase.step === "holding" ? phase : null;
  const memberInfo = holding && holding.memberId !== null ? MEMBERS[holding.memberId] : null;
  const memberState = holding && holding.memberId !== null ? s.state?.members[holding.memberId] : null;
  const needsJoin = !!memberState && !memberState.joined;
  const proposal = chosen !== null ? openProposals.find((p) => p.id === chosen) : needsJoin ? null : openProposals[openProposals.length - 1];
  const message = !holding || !s.state ? "" : holding.memberId === null ? "This card is not a member of the stokvel." : needsJoin ? `${memberInfo!.name} signs the constitution of The Q4 Stokvel.` : proposal ? describeProposal(proposal, s.state.contributionCents, memberInfo!.name) : "Nothing to sign right now.";
  const canSign = !!holding && holding.memberId !== null && (needsJoin || !!proposal) && !busy;

  const sign = async () => {
    if (!s.cfg || !holding || !keyRef.current) return;
    setBusy(true);
    try {
      const account = accountFromKey(keyRef.current);
      let r: { ok: boolean; error?: string; hash?: string };
      if (needsJoin) {
        r = await relayerPost(s.cfg, "/join", { signature: await signJoin(account, s.cfg, constitution) });
      } else {
        const nonce = await nonceOf(s.cfg, account.address);
        r = await relayerPost(s.cfg, "/votes", { proposalId: proposal!.id.toString(), nonce: nonce.toString(), signature: await signVote(account, s.cfg, proposal!.id, nonce) });
      }
      wipe();
      setPhase({ step: "done", ok: r.ok, text: r.ok ? "Signed. The key is gone from this page. Scan your card again when there's a vote." : `Refused: ${r.error}`, hash: r.hash });
    } catch (err) {
      wipe();
      setPhase({ step: "done", ok: false, text: String(err).split("\n")[0]! });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    wipe();
    setPhase({ step: "scan" });
    setChosen(null);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 pb-10 pt-6 sm:px-8 sm:pt-8">
      <header className="page">
        <div className="running-head">
          <span>
            <b>Signing station</b> · The Q4 Stokvel
          </span>
          <span className="font-mono hidden text-sm sm:inline">keys stay on this screen</span>
        </div>
      </header>

      {phase.step === "scan" && (
        <section className="mt-10 flex flex-1 flex-col">
          <h1 className="font-display text-3xl font-medium leading-tight sm:text-5xl">Scan the back of your card with your phone camera.</h1>
          <p className="mt-4 text-lg text-muted sm:text-xl">Or hold it to the scanner here, which types it in for you, or use the camera below.</p>
          <div className="mt-10 flex flex-col gap-6">
            {camera ? (
              <video ref={videoRef} className="w-full max-w-md border border-line" muted playsInline />
            ) : (
              <button className="w-fit border border-text px-6 py-3 text-lg hover:bg-surface" onClick={() => setCamera(true)}>
                Use the camera
              </button>
            )}
            <input
              className="w-full max-w-md border-b border-line bg-transparent py-2 font-mono text-sm text-muted outline-none placeholder:text-muted/60"
              placeholder="or paste stokvel:v1:0x… and press Enter"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const key = parseCardQr((e.target as HTMLInputElement).value);
                  (e.target as HTMLInputElement).value = "";
                  if (key) acceptKey(key);
                }
              }}
            />
          </div>
        </section>
      )}

      {holding && (
        <section className="mt-6 flex flex-1 flex-col sm:mt-8">
          {/* the slip */}
          <div className="bg-paper px-5 py-6 text-ink sm:px-10 sm:py-9">
            <div className="flex flex-wrap items-center gap-4 border-b border-ink/20 pb-5 sm:gap-5">
              {memberInfo ? (
                <>
                  <Patch colour={memberInfo.colour} seed={`member:${memberInfo.number}`} size={64} base="#e9e4d8" />
                  <div>
                    <div className="font-mono text-sm text-ink/60">member {memberInfo.number}</div>
                    <div className="font-display text-4xl font-medium">{memberInfo.name}</div>
                  </div>
                </>
              ) : (
                <div>
                  <div className="font-mono text-sm text-danger">unknown card</div>
                  <div className="font-display text-4xl font-medium text-danger">Not a member</div>
                </div>
              )}
              <div className="font-mono w-full break-all text-xs text-ink/50 sm:ml-auto sm:w-auto">{holding.address}</div>
            </div>

            {!needsJoin && memberInfo && openProposals.length > 1 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {openProposals.map((p) => (
                  <button key={p.id.toString()} onClick={() => setChosen(p.id)} className={`border px-3 py-1 font-mono text-sm ${proposal?.id === p.id ? "border-ink bg-ink text-paper" : "border-ink/30 text-ink/70"}`}>
                    #{p.id.toString()}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-7 text-sm text-ink/60">You are signing</div>
            <div className="font-display mt-2 text-[1.9rem] font-medium leading-tight sm:text-[2.6rem]">{message || "Reading the contract…"}</div>
            {proposal && !needsJoin && (
              <div className="font-mono mt-5 text-sm text-ink/60">
                EIP-712 · Vote(proposalId {proposal.id.toString()}, nonce next) · {proposal.yes} of 6 have signed
              </div>
            )}
            <div className="mt-10 flex items-end gap-4">
              <div className="flex-1 border-b border-ink/40 pb-1 text-sm text-ink/50">signature</div>
            </div>
          </div>

          <div className="mt-6 flex gap-3 sm:gap-4">
            <button onClick={sign} disabled={!canSign} className="font-display flex-1 bg-text py-5 text-3xl font-medium text-ink disabled:opacity-30 sm:py-6 sm:text-4xl">
              {busy ? "Signing…" : "Sign"}
            </button>
            <button onClick={reset} className="border border-line px-5 text-lg text-muted hover:border-text sm:px-8 sm:text-xl">
              Cancel
            </button>
          </div>
        </section>
      )}

      {phase.step === "done" && (
        <section className="mt-10 flex flex-1 flex-col items-start">
          <div className={`stamp text-5xl sm:text-6xl ${phase.ok ? "text-success" : "text-danger"}`}>{phase.ok ? "Signed" : "Refused"}</div>
          <p className="mt-8 max-w-2xl text-xl sm:text-2xl">{phase.text}</p>
          {phase.hash && <p className="font-mono mt-3 break-all text-sm text-muted">{phase.hash}</p>}
          <button onClick={reset} className="mt-10 border border-text px-8 py-4 text-xl hover:bg-surface">
            Next card
          </button>
        </section>
      )}
    </main>
  );
}
