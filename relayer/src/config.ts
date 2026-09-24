import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Hex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

// .env is optional: every value has a demo default and scripts/demo.sh passes the rest
loadDotEnv(resolve(here, "..", ".env"));

const hex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x prefixed 32 byte hex key")
  .transform((v) => v as Hex);
// an empty string in .env means "use the default"
const optionalHex32 = (fallback: Hex) => z.preprocess((v) => (v === "" || v === undefined ? fallback : v), hex32);

const schema = z.object({
  RPC_URL: z.string().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().default(31337),
  STOKVEL_ADDRESS: z.string().default(""),
  STOKVEL_V1_ADDRESS: z.string().default(""),
  INVESTEC_ACCOUNT_ID: z.string().default(""),
  RELAYER_PK: optionalHex32("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"), // scan:allow Anvil account 1
  ATTESTOR_PK: optionalHex32("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"), // scan:allow Anvil account 2
  INVESTEC_MODE: z.enum(["mock", "sandbox"]).default("mock"),
  INVESTEC_BASE_URL: z.string().default(""),
  INVESTEC_CLIENT_ID: z.string().default(""),
  INVESTEC_CLIENT_SECRET: z.string().default(""),
  INVESTEC_API_KEY: z.string().default(""),
  INVESTEC_PROFILE_ID: z.string().default(""),
  PAYOUT_METHOD: z.enum(["pay", "transfer"]).default("pay"),
  INVESTEC_SHADOW: z.enum(["none", "sandbox"]).default("none"),
  DEMO_MODE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  POLL_MS: z.coerce.number().default(3000),
  RESERVES_MS: z.coerce.number().default(20_000),
  MEMBERS_FILE: z.string().default(resolve(here, "..", "members.example.json")),
  PORT: z.coerce.number().default(4000),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof schema> & {
  stokvel: `0x${string}`;
  stokvelV1: `0x${string}`;
  investecBaseUrl: string;
  members: Member[];
};

export type Member = {
  memberId: number;
  number: string;
  name: string;
  colour: string;
  investecId: string;
};

export function loadConfig(overrides: Record<string, string> = {}): Config {
  const parsed = schema.parse({ ...process.env, ...overrides });

  let stokvel = parsed.STOKVEL_ADDRESS;
  let stokvelV1 = parsed.STOKVEL_V1_ADDRESS;
  if (!stokvel) {
    const file = resolve(repoRoot, "contracts", "deployments", `${parsed.CHAIN_ID}.json`);
    if (!existsSync(file)) {
      throw new Error(`STOKVEL_ADDRESS is empty and ${file} does not exist. Deploy first.`);
    }
    const d = JSON.parse(readFileSync(file, "utf8"));
    stokvel = d.stokvel;
    stokvelV1 = stokvelV1 || d.stokvelV1;
  }

  const investecBaseUrl =
    parsed.INVESTEC_BASE_URL ||
    (parsed.INVESTEC_MODE === "sandbox" ? "https://openapisandbox.investec.com" : "http://127.0.0.1:4100");

  const members = (JSON.parse(readFileSync(parsed.MEMBERS_FILE, "utf8")).members as Member[]).sort(
    (a, b) => a.memberId - b.memberId,
  );

  return {
    ...parsed,
    stokvel: stokvel as `0x${string}`,
    stokvelV1: stokvelV1 as `0x${string}`,
    investecBaseUrl,
    members,
  };
}

export const SANDBOX_URL = "https://openapisandbox.investec.com";

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
