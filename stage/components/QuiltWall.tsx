"use client";

import type { StokvelEvent } from "@/lib/chain";
import { MEMBERS } from "@/lib/members";
import { Patch } from "@/lib/quilt";

/** The group's quilt: one patch per recorded contribution, tiled edge to edge like fabric. */
export function QuiltWall({ events, size = 36, max = 48 }: { events: StokvelEvent[]; size?: number; max?: number }) {
  const patches = events.filter((e) => e.name === "ContributionRecorded").slice(-max);
  return (
    <div className="flex flex-wrap gap-[2px]">
      {patches.map((e) => {
        const id = Number(e.args.memberId ?? 0);
        const m = MEMBERS[id]!;
        return <Patch key={`${e.txHash}:${e.logIndex}`} colour={m.colour} seed={String(e.args.investecRef ?? e.txHash)} size={size} className="patch-in" />;
      })}
      {patches.length === 0 && <span className="text-sm text-muted">The quilt starts with the first contribution.</span>}
    </div>
  );
}
