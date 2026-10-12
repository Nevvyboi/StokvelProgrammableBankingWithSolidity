import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { StageConfig } from "./config";

/**
 * Server side only. The stage app's configuration: env first, the Foundry deployment file for the
 * rest. /api/config hands it to the browser; /api/rpc uses it to decide which contracts it reads.
 */
export function serverConfig(): StageConfig {
  const chainId = Number(process.env.CHAIN_ID ?? 31337);
  const file = resolve(process.cwd(), "..", "contracts", "deployments", `${chainId}.json`);
  const d = existsSync(/*turbopackIgnore: true*/ file) ? JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) : {};
  const explorer = process.env.EXPLORER_URL || (chainId === 84532 ? "https://sepolia.basescan.org" : null);
  // || not ??: stokvel.env leaves unused values empty (STOKVEL_ADDRESS=), and empty means "not set"
  return {
    // what the browser connects to. On a public server this is /api/rpc, so phones never need to
    // reach a node themselves and the provider key in RPC_URL stays on the server
    rpcUrl: process.env.PUBLIC_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? upstreamRpcUrl(),
    chainId,
    stokvel: process.env.STOKVEL_ADDRESS || d.stokvel || null,
    stokvelV1: process.env.STOKVEL_V1_ADDRESS || d.stokvelV1 || null,
    relayerUrl: process.env.RELAYER_URL ?? "http://127.0.0.1:4000",
    mockUrl: process.env.MOCK_URL ?? "http://127.0.0.1:4100",
    explorerUrl: explorer,
    deployedAtBlock: Number(d.deployedAtBlock ?? 0),
    contributionCents: String(d.contributionCents ?? 500000),
    timelock: Number(d.timelock ?? 120),
    mode: process.env.INVESTEC_MODE === "sandbox" ? "sandbox" : "mock",
    spareAddress: (process.env.SPARE_ADDRESS || null) as `0x${string}` | null,
  } as StageConfig;
}

/** The node the server itself talks to. Never sent to the browser when PUBLIC_RPC_URL is set. */
export function upstreamRpcUrl(): string {
  return process.env.RPC_URL ?? "http://127.0.0.1:8545";
}
