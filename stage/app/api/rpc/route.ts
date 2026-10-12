import { NextResponse } from "next/server";
import { serverConfig, upstreamRpcUrl } from "@/lib/serverConfig";

export const dynamic = "force-dynamic";

/**
 * A read-only JSON-RPC proxy for the browser, so the audience's phones only ever talk to this site.
 * Set PUBLIC_RPC_URL=/api/rpc to use it (deploy/README.md does).
 *
 * It forwards only what the pages need to read, and only about the two Stokvel contracts: no
 * transactions, no Anvil admin methods, and no free node for anyone holding the URL.
 */
const READ_ANYTHING = new Set(["eth_blockNumber", "eth_chainId", "net_version", "eth_getBlockByNumber", "eth_getBlockByHash"]);
const MAX_BATCH = 100;
const MAX_BODY = 64 * 1024;

type Call = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: Call | Call[];
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return NextResponse.json({ error: "batch size" }, { status: 400 });

  const cfg = serverConfig();
  const ours = new Set([cfg.stokvel, cfg.stokvelV1].filter(Boolean).map((a) => a!.toLowerCase()));
  const refused = calls.find((c) => !allowed(c, ours));
  if (refused) {
    const error = { code: -32601, message: `not served here: ${String(refused.method)}` };
    const out = calls.map((c) => ({ jsonrpc: "2.0", id: c.id ?? null, error }));
    return NextResponse.json(Array.isArray(body) ? out : out[0], { status: 403 });
  }

  try {
    const r = await fetch(upstreamRpcUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: text, cache: "no-store" });
    return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "chain unreachable" }, { status: 502 });
  }
}

function allowed(c: Call, ours: Set<string>): boolean {
  if (typeof c.method !== "string") return false;
  if (READ_ANYTHING.has(c.method)) return true;
  const p = Array.isArray(c.params) ? (c.params[0] as Record<string, unknown> | undefined) : undefined;
  if (!p || typeof p !== "object") return false;
  // a read of one of our contracts, never a state override or a call to anything else
  if (c.method === "eth_call") return typeof p.to === "string" && ours.has(p.to.toLowerCase()) && (c.params as unknown[]).length <= 2;
  if (c.method === "eth_getLogs") {
    const a = p.address;
    const list = Array.isArray(a) ? a : [a];
    return list.length > 0 && list.every((x) => typeof x === "string" && ours.has(x.toLowerCase()));
  }
  return false;
}
