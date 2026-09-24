export type StageConfig = {
  rpcUrl: string;
  chainId: number;
  stokvel: `0x${string}`;
  stokvelV1: `0x${string}` | null;
  relayerUrl: string;
  mockUrl: string;
  explorerUrl: string | null;
  deployedAtBlock: number;
  contributionCents: string;
  timelock: number;
  mode: "mock" | "sandbox";
};

let cached: Promise<StageConfig> | null = null;

/** Served by /api/config, which reads contracts/deployments/<chainId>.json so a redeploy needs no rebuild. */
export function loadStageConfig(): Promise<StageConfig> {
  if (!cached) cached = fetch("/api/config", { cache: "no-store" }).then((r) => r.json());
  return cached;
}

export function explorerTx(cfg: StageConfig, hash: string): string | null {
  return cfg.explorerUrl ? `${cfg.explorerUrl}/tx/${hash}` : null;
}

export function explorerAddress(cfg: StageConfig, address: string): string | null {
  return cfg.explorerUrl ? `${cfg.explorerUrl}/address/${address}` : null;
}
