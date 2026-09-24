import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Demo only. Serves the throwaway member keys from cards/out/keys.json to the presenter panel, so
 * a rehearsal can sign as a member without a printed card. Localhost only, and off unless DEMO_MODE.
 * These are testnet keys with no value, and the file is gitignored.
 */
export function GET(req: Request) {
  const host = new URL(req.url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local || process.env.DEMO_MODE === "false") return NextResponse.json({ error: "not here" }, { status: 403 });
  const file = process.env.KEYS_FILE ?? resolve(process.cwd(), "..", "cards", "out", "keys.json");
  if (!existsSync(/*turbopackIgnore: true*/ file)) return NextResponse.json({ keys: null, reason: "cards/out/keys.json not found; run the card generator or use Anvil keys" });
  const d = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
  return NextResponse.json({ keys: d.cards });
}
