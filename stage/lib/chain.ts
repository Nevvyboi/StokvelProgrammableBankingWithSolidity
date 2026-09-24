import { createPublicClient, http, type PublicClient } from "viem";
import { stokvelAbi } from "./abi";
import type { StageConfig } from "./config";

export type StokvelEvent = {
  name: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  at?: number;
};

export type MemberState = { memberId: number; key: string; paidCents: bigint; paidThisRound: bigint; joined: boolean };

export type ChainState = {
  round: bigint;
  roundEndsAt: number;
  pot: bigint;
  unsettled: bigint;
  totalIn: bigint;
  settledOut: bigint;
  reservesCents: bigint;
  reservesAt: number;
  fresh: boolean;
  contributionCents: bigint;
  relayer: string;
  attestor: string;
  members: MemberState[];
  recipient: number;
  blockNumber: bigint;
  blockTime: number;
  proposals: ProposalState[];
};

export type ProposalState = {
  id: bigint;
  kind: number;
  memberId: number;
  yes: number;
  executed: boolean;
  newAddr: string;
  createdAt: number;
  eta: number;
  value: bigint;
};

export const KIND_NAMES = ["Set contribution", "Rotate key", "Replace relayer", "Replace attestor"];

export function publicClientFor(cfg: StageConfig): PublicClient {
  return createPublicClient({ transport: http(cfg.rpcUrl, { batch: true }) });
}

/** Everything the dashboard shows, read straight from the contract. No database. */
export async function readState(client: PublicClient, address: `0x${string}`): Promise<ChainState> {
  const c = { address, abi: stokvelAbi } as const;
  const block = await client.getBlock();
  const [round, roundEndsAt, pot, unsettled, totalIn, settledOut, health, contributionCents, relayer, attestor, memberCount, proposalCount] =
    await Promise.all([
      client.readContract({ ...c, functionName: "round" }),
      client.readContract({ ...c, functionName: "roundEndsAt" }),
      client.readContract({ ...c, functionName: "pot" }),
      client.readContract({ ...c, functionName: "unsettled" }),
      client.readContract({ ...c, functionName: "totalIn" }),
      client.readContract({ ...c, functionName: "settledOut" }),
      client.readContract({ ...c, functionName: "health" }),
      client.readContract({ ...c, functionName: "contributionCents" }),
      client.readContract({ ...c, functionName: "relayer" }),
      client.readContract({ ...c, functionName: "attestor" }),
      client.readContract({ ...c, functionName: "memberCount" }),
      client.readContract({ ...c, functionName: "proposalCount" }),
    ]);
  const n = Number(memberCount);
  const members = await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const [m, paidThisRound, joined] = await Promise.all([
        client.readContract({ ...c, functionName: "members", args: [BigInt(i)] }),
        client.readContract({ ...c, functionName: "paidInRound", args: [round, i] }),
        client.readContract({ ...c, functionName: "joined", args: [i] }),
      ]);
      return { memberId: i, key: m[0], paidCents: m[2], paidThisRound, joined };
    }),
  );
  const proposals = await Promise.all(
    Array.from({ length: Number(proposalCount) }, async (_, i) => {
      const p = await client.readContract({ ...c, functionName: "proposals", args: [BigInt(i)] });
      return { id: BigInt(i), kind: p[0], memberId: p[1], yes: p[2], executed: p[3], newAddr: p[4], createdAt: Number(p[5]), eta: Number(p[6]), value: p[7] };
    }),
  );
  return {
    round,
    roundEndsAt: Number(roundEndsAt),
    pot,
    unsettled,
    totalIn,
    settledOut,
    reservesCents: health[0],
    reservesAt: Number(health[2]),
    fresh: health[3],
    contributionCents,
    relayer,
    attestor,
    members,
    recipient: n ? Number(round % BigInt(n)) : 0,
    blockNumber: block.number,
    blockTime: Number(block.timestamp),
    proposals,
  };
}

/** All the contract's events from a block onwards, decoded, oldest first. */
export async function readEvents(client: PublicClient, address: `0x${string}`, fromBlock: bigint): Promise<StokvelEvent[]> {
  const logs = await client.getContractEvents({ address, abi: stokvelAbi, fromBlock, strict: false });
  return logs.map((l) => ({
    name: l.eventName ?? "?",
    args: (l.args ?? {}) as Record<string, unknown>,
    blockNumber: l.blockNumber,
    txHash: l.transactionHash,
    logIndex: l.logIndex,
  }));
}

export type BlockInfo = { number: bigint; timestamp: number; txCount: number; hash: string };

export async function recentBlocks(client: PublicClient, n: number): Promise<BlockInfo[]> {
  const latest = await client.getBlockNumber();
  const numbers = Array.from({ length: Number(latest < BigInt(n) ? latest + 1n : BigInt(n)) }, (_, i) => latest - BigInt(i));
  const blocks = await Promise.all(numbers.map((b) => client.getBlock({ blockNumber: b })));
  return blocks.map((b) => ({ number: b.number, timestamp: Number(b.timestamp), txCount: b.transactions.length, hash: b.hash }));
}

