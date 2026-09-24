"use client";

import type { Alarm as AlarmT } from "@/lib/useStage";

const COPY: Record<AlarmT["kind"], { stamp: string; line: string }> = {
  ReservesShort: { stamp: "Frozen", line: "The bank holds less than the club is owed. No payout until it does." },
  AlreadyRecorded: { stamp: "Refused", line: "That Investec transaction was counted once. It will not be counted twice." },
  Refused: { stamp: "Refused", line: "The contract said no." },
};

/** The whole screen goes red and a stamp lands on it. Click or Esc to dismiss. */
export function Alarm({ alarm, onDismiss }: { alarm: AlarmT | null; onDismiss: () => void }) {
  if (!alarm) return null;
  const c = COPY[alarm.kind];
  return (
    <div className="alarm fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center p-16 text-paper" onClick={onDismiss} role="alert">
      <div className="stamp text-[14vw] leading-none" style={{ borderWidth: "0.6vw" }}>
        {c.stamp}
      </div>
      <p className="font-display mt-[4vw] max-w-[70vw] text-center text-[2.8vw] leading-tight">{c.line}</p>
      <p className="font-mono mt-[3vw] text-[1.5vw] opacity-80">{alarm.detail}</p>
    </div>
  );
}
