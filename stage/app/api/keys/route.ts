import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Demo only. Serves the throwaway member keys from cards/out/keys.json to the presenter panel, so
 * a rehearsal can sign as a member without a printed card. These are testnet keys with no value,
 * and the file is gitignored, but anyone holding them can vote as a volunteer, so they go only to
 * a request that carries PRESENTER_TOKEN.
 *
 * Not the Host header: Next reports every request's hostname as localhost, and a client can send
 * any Host or X-Forwarded-For it likes. scripts/demo.sh makes a fresh token on every run and
 * prints the presenter URL with it in the fragment. With no token set (the public server), the
 * route is off.
 */
export function GET(req: Request) {
  const token = process.env.PRESENTER_TOKEN ?? "";
  const given = req.headers.get("x-presenter-token") ?? "";
  if (!token || process.env.DEMO_MODE === "false" || !same(token, given)) return NextResponse.json({ error: "not here" }, { status: 403 });
  const file = process.env.KEYS_FILE ?? resolve(process.cwd(), "..", "cards", "out", "keys.json");
  if (!existsSync(/*turbopackIgnore: true*/ file)) return NextResponse.json({ keys: null, reason: "cards/out/keys.json not found; run the card generator or use Anvil keys" });
  const d = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
  return NextResponse.json({ keys: d.cards });
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
