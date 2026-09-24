import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The stage app's configuration: env first, the Foundry deployment file for the rest. */
export function GET() {
  const chainId = Number(process.env.CHAIN_ID ?? 31337);
  const file = resolve(process.cwd(), "..", "contracts", "deployments", `${chainId}.json`);
  const d = existsSync(file) ? JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) : {};
  const explorer = process.env.EXPLORER_URL ?? (chainId === 84532 ? "https://sepolia.basescan.org" : null);
  return NextResponse.json({
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8545",
    chainId,
    stokvel: process.env.STOKVEL_ADDRESS ?? d.stokvel ?? null,
    stokvelV1: process.env.STOKVEL_V1_ADDRESS ?? d.stokvelV1 ?? null,
    relayerUrl: process.env.RELAYER_URL ?? "http://127.0.0.1:4000",
    mockUrl: process.env.MOCK_URL ?? "http://127.0.0.1:4100",
    explorerUrl: explorer,
    deployedAtBlock: Number(d.deployedAtBlock ?? 0),
    contributionCents: String(d.contributionCents ?? 500000),
    timelock: Number(d.timelock ?? 120),
    mode: process.env.INVESTEC_MODE === "sandbox" ? "sandbox" : "mock",
  });
}
