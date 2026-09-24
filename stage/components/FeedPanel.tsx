"use client";

import type { FeedItem } from "@/lib/useStage";
import type { StageConfig } from "@/lib/config";
import { explorerTx } from "@/lib/config";
import { short } from "@/lib/members";

const WHERE: Record<FeedItem["kind"], string> = {
  "bank->chain": "bank → chain",
  "chain->bank": "chain → bank",
  refused: "chain said no",
  reserves: "attestor → chain",
  vote: "card → chain",
  info: "relayer",
};

/** The minute book: one line per message, time on the left, hash on the right. */
export function FeedPanel({ feed, cfg, rows = 5, big = true }: { feed: FeedItem[]; cfg: StageConfig | null; rows?: number; big?: boolean }) {
  const items = [...feed].reverse().slice(0, rows);
  return (
    <table className={`ledger ${big ? "text-[1.25rem]" : "text-sm"}`}>
      <tbody>
        {items.map((i) => {
          const link = i.hash && cfg ? explorerTx(cfg, i.hash) : null;
          return (
            <tr key={i.seq} className="rise">
              <td className="font-mono w-24 text-base text-muted">{new Date(i.at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
              <td className={`w-44 ${i.error ? "text-danger" : "text-muted"}`}>{WHERE[i.kind]}</td>
              <td className={`font-display font-medium ${i.error ? "text-danger" : ""}`}>{i.title}</td>
              <td className="max-w-0 truncate pr-6 text-muted">{i.detail}</td>
              <td className="font-mono w-28 text-right text-sm text-muted">
                {i.hash && (link ? (
                  <a className="underline" href={link} target="_blank" rel="noreferrer">
                    {short(i.hash, 4)}
                  </a>
                ) : (
                  short(i.hash, 4)
                ))}
              </td>
            </tr>
          );
        })}
        {items.length === 0 && (
          <tr>
            <td className="text-muted">Nothing has crossed yet.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
