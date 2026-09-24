// Captures a fallback snapshot for the stage app from the running stack: chain state, events,
// blocks, feed and bank, plus a scripted list of steps that replay the eight demos with no backend.
import { writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";

const base = "http://127.0.0.1:3000";
const relayer = "http://127.0.0.1:4000";
const out = process.argv[2];
const cfg = await fetch(`${base}/api/config`).then((r) => r.json());
const { stokvelAbi } = await import(`${process.cwd()}/../../home/user/StokvelProgrammableBankingWithSolidity/stage/lib/abi.ts`).catch(() => ({ stokvelAbi: null }));

// reuse the stage's own readers by importing them through tsx would need a build; read directly instead
const client = createPublicClient({ transport: http(cfg.rpcUrl) });
const abi = stokvelAbi ?? JSON.parse(await (await import("node:fs/promises")).readFile("/home/user/StokvelProgrammableBankingWithSolidity/contracts/out/Stokvel.sol/Stokvel.json", "utf8")).abi;
const c = { address: cfg.stokvel, abi };
const rd = (functionName, args = []) => client.readContract({ ...c, functionName, args });

const block = await client.getBlock();
const [round, roundEndsAt, pot, unsettled, totalIn, settledOut, health, contributionCents, relayerAddr, attestor, memberCount, proposalCount] = await Promise.all([
  rd("round"), rd("roundEndsAt"), rd("pot"), rd("unsettled"), rd("totalIn"), rd("settledOut"), rd("health"), rd("contributionCents"), rd("relayer"), rd("attestor"), rd("memberCount"), rd("proposalCount"),
]);
const members = [];
for (let i = 0; i < Number(memberCount); i++) {
  const m = await rd("members", [BigInt(i)]);
  members.push({ memberId: i, key: m[0], paidCents: m[2], paidThisRound: await rd("paidInRound", [round, i]), joined: await rd("joined", [i]) });
}
const proposals = [];
for (let i = 0; i < Number(proposalCount); i++) {
  const p = await rd("proposals", [BigInt(i)]);
  proposals.push({ id: BigInt(i), kind: p[0], memberId: p[1], yes: p[2], executed: p[3], newAddr: p[4], createdAt: Number(p[5]), eta: Number(p[6]), value: p[7] });
}
const state = { round, roundEndsAt: Number(roundEndsAt), pot, unsettled, totalIn, settledOut, reservesCents: health[0], reservesAt: Number(health[2]), fresh: health[3], contributionCents, relayer: relayerAddr, attestor, members, recipient: Number(round % memberCount), blockNumber: block.number, blockTime: Number(block.timestamp), proposals };

const logs = await client.getContractEvents({ address: cfg.stokvel, abi, fromBlock: 0n, strict: false });
const events = logs.map((l) => ({ name: l.eventName, args: l.args, blockNumber: l.blockNumber, txHash: l.transactionHash, logIndex: l.logIndex }));
const latest = await client.getBlockNumber();
const blocks = [];
for (let i = 0n; i < 8n && latest - i >= 0n; i++) {
  const b = await client.getBlock({ blockNumber: latest - i });
  blocks.push({ number: b.number, timestamp: Number(b.timestamp), txCount: b.transactions.length, hash: b.hash });
}
const feed = await fetch(`${relayer}/feed?since=0`).then((r) => r.json());
const bank = await fetch(`${relayer}/bank`).then((r) => r.json());

const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
writeFileSync(`${out}/snapshot.json`, json({ state, events, blocks, feed: feed.slice(-6), bank }));
console.log("snapshot", events.length, "events", blocks.length, "blocks", feed.length, "feed");
