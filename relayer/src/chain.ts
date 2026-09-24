import {
  createPublicClient,
  createWalletClient,
  http,
  getContract,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
  type Account,
  decodeErrorResult,
  BaseError,
  ContractFunctionRevertedError,
  nonceManager,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, baseSepolia } from "viem/chains";
import { stokvelAbi } from "./abi.js";
import type { Config } from "./config.js";

export type StokvelContract = ReturnType<typeof stokvelContract>;

export function chainFor(chainId: number): Chain {
  if (chainId === 84532) return baseSepolia;
  if (chainId === 31337) return anvil;
  return { ...anvil, id: chainId, name: `chain-${chainId}` };
}

export function makeClients(cfg: Pick<Config, "RPC_URL" | "CHAIN_ID" | "RELAYER_PK" | "ATTESTOR_PK">) {
  const chain = chainFor(cfg.CHAIN_ID);
  const transport = http(cfg.RPC_URL);
  // the webhook handler and the loops all send from this key; the nonce manager keeps them in order
  const relayer = privateKeyToAccount(cfg.RELAYER_PK, { nonceManager });
  const attestor = privateKeyToAccount(cfg.ATTESTOR_PK);
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account: relayer });
  return { chain, publicClient, wallet, relayer, attestor };
}

export function stokvelContract(
  address: Address,
  publicClient: PublicClient,
  wallet: WalletClient<Transport, Chain, Account>,
) {
  return getContract({ address, abi: stokvelAbi, client: { public: publicClient, wallet } });
}

export function eip712Domain(chainId: number, verifyingContract: Address) {
  return { name: "Stokvel", version: "1", chainId, verifyingContract } as const;
}

export const types = {
  Reserves: [
    { name: "cents", type: "uint256" },
    { name: "at", type: "uint64" },
  ],
  Vote: [
    { name: "proposalId", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
  Join: [{ name: "constitution", type: "string" }],
} as const;

/** Turn a viem revert into the contract's custom error name and args, for logs and the dashboard. */
export function decodeRevert(err: unknown): { name: string; args: readonly unknown[] } | null {
  if (!(err instanceof BaseError)) return null;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
  if (revert?.data) return { name: revert.data.errorName, args: revert.data.args ?? [] };
  const raw = (err.walk((e) => (e as { data?: Hex }).data !== undefined) as { data?: Hex } | null)?.data;
  if (raw && raw !== "0x") {
    try {
      const d = decodeErrorResult({ abi: stokvelAbi, data: raw });
      return { name: d.errorName, args: d.args ?? [] };
    } catch {
      return null;
    }
  }
  return null;
}

export function errorText(err: unknown): string {
  const d = decodeRevert(err);
  if (d) return `${d.name}(${d.args.map(String).join(", ")})`;
  return err instanceof Error ? err.message.split("\n")[0]! : String(err);
}
