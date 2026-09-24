import { privateKeyToAccount, mnemonicToAccount, type PrivateKeyAccount, type HDAccount } from "viem/accounts";
import type { StageConfig } from "./config";
import { KIND_NAMES, type ProposalState } from "./chain";
import { MEMBERS, formatRands, short } from "./members";

export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

/** What a member card's QR holds: a version tag and a throwaway testnet key. Nothing else. */
export function parseCardQr(text: string): `0x${string}` | null {
  const t = text.trim();
  const m = /^stokvel:v1:(0x[0-9a-fA-F]{64})$/.exec(t) ?? /^(0x[0-9a-fA-F]{64})$/.exec(t);
  return m ? (m[1] as `0x${string}`) : null;
}

export function accountFromKey(key: `0x${string}`): PrivateKeyAccount {
  return privateKeyToAccount(key);
}

export function anvilMember(i: number): HDAccount {
  return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 3 + i });
}

export function domainFor(cfg: StageConfig) {
  return { name: "Stokvel", version: "1", chainId: cfg.chainId, verifyingContract: cfg.stokvel } as const;
}

export const TYPES = {
  Vote: [
    { name: "proposalId", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
  Join: [{ name: "constitution", type: "string" }],
} as const;

/** The EIP-712 message in plain English, the way the signing station shows it. */
export function describeProposal(p: ProposalState, currentContribution: bigint, signerName: string): string {
  const who = MEMBERS[p.memberId]?.name ?? `member ${p.memberId + 1}`;
  switch (p.kind) {
    case 0: {
      const verb = p.value > currentContribution ? "raise" : "lower";
      return `${signerName} approves: ${verb} the contribution from ${formatRands(currentContribution)} to ${formatRands(p.value)}`;
    }
    case 1:
      return `${signerName} approves: move ${who}'s membership to the card ${short(p.newAddr, 5)}`;
    case 2:
      return `${signerName} approves: replace the relayer with ${short(p.newAddr, 5)}`;
    case 3:
      return `${signerName} approves: replace the attestor with ${short(p.newAddr, 5)}`;
    default:
      return `${signerName} approves: ${KIND_NAMES[p.kind] ?? "proposal"} #${p.id}`;
  }
}

export async function signVote(account: { signTypedData: PrivateKeyAccount["signTypedData"] }, cfg: StageConfig, proposalId: bigint, nonce: bigint) {
  return account.signTypedData({ domain: domainFor(cfg), types: TYPES, primaryType: "Vote", message: { proposalId, nonce } });
}

export async function signJoin(account: { signTypedData: PrivateKeyAccount["signTypedData"] }, cfg: StageConfig, constitution: string) {
  return account.signTypedData({ domain: domainFor(cfg), types: TYPES, primaryType: "Join", message: { constitution } });
}

export async function relayerPost(cfg: StageConfig, path: string, body: unknown): Promise<{ ok: boolean; error?: string; hash?: string; proposalId?: string }> {
  const r = await fetch(`${cfg.relayerUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

export async function nonceOf(cfg: StageConfig, address: string): Promise<bigint> {
  const r = await fetch(`${cfg.relayerUrl}/nonce/${address}`).then((x) => x.json());
  return BigInt(r.nonce);
}
