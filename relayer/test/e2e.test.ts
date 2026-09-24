/**
 * End to end against a real Anvil and the mock bank, in process: deploy, join, contribute by card
 * swipe, attest, warp to month end, close, pay, confirm, steal and freeze, double webhook on V1 and
 * V2, vote and rotate a key. Run with: npm run test:e2e (needs anvil and forge on the PATH).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import pino from "pino";
import { createPublicClient, http, keccak256, toBytes, type Hex, type Address } from "viem";
import { privateKeyToAccount, mnemonicToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { Ledger, POOL_ACCOUNT_ID } from "../src/mock/ledger.js";
import { createMockApp } from "../src/mock/server.js";
import { InvestecClient } from "../src/investec/client.js";
import { makeClients, stokvelContract, eip712Domain, types, errorText } from "../src/chain.js";
import { Feed } from "../src/feed.js";
import { createContributionLoop } from "../src/loops/contributions.js";
import { createReservesLoop } from "../src/loops/reserves.js";
import { createPayoutLoop } from "../src/loops/payouts.js";
import { createHttpApp } from "../src/http.js";
import { loadConfig } from "../src/config.js";

const run = process.env.E2E === "1";
const log = pino({ level: process.env.LOG_LEVEL ?? "silent" });
const contractsDir = resolve(process.cwd(), "..", "contracts");
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const MNEMONIC = "test test test test test test test test test test test junk";

let anvilProc: ChildProcess;

describe.skipIf(!run)("relayer end to end", () => {
  let cfg: ReturnType<typeof loadConfig>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let contract: ReturnType<typeof stokvelContract>;
  let contractV1: ReturnType<typeof stokvelContract>;
  let ledger: Ledger;
  let relayerApp: ReturnType<typeof createHttpApp>;
  let mockApp: ReturnType<typeof createMockApp>;
  let loops: { poll: () => Promise<unknown>; reserves: () => Promise<unknown>; payouts: () => Promise<unknown> };
  let feed: Feed;
  const members = Array.from({ length: 6 }, (_, i) => mnemonicToAccount(MNEMONIC, { addressIndex: 3 + i }));

  beforeAll(async () => {
    anvilProc = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 1500));
    execSync(`forge script script/Deploy.s.sol --rpc-url ${RPC} --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`, { cwd: contractsDir, stdio: "pipe" }); // scan:allow Anvil account 0
    const d = JSON.parse(readFileSync(resolve(contractsDir, "deployments", "31337.json"), "utf8"));

    cfg = loadConfig({ RPC_URL: RPC, STOKVEL_ADDRESS: d.stokvel, STOKVEL_V1_ADDRESS: d.stokvelV1, INVESTEC_MODE: "mock", INVESTEC_BASE_URL: "http://mock" });
    const clients = makeClients(cfg);
    publicClient = clients.publicClient as never;
    contract = stokvelContract(cfg.stokvel, clients.publicClient, clients.wallet);
    contractV1 = stokvelContract(cfg.stokvelV1, clients.publicClient, clients.wallet);
    feed = new Feed();

    ledger = new Ledger();
    // the mock bank pushes webhooks to the relayer app, in process
    const mockFetch: typeof fetch = (input, init) => Promise.resolve(relayerApp.request(input as string, init as RequestInit));
    mockApp = createMockApp({ ledger, log, selfUrl: "http://mock", relayerWebhookUrl: "http://relayer/webhook/transaction", fetchImpl: mockFetch, cardDir: resolve(process.cwd(), "..", "card") });
    const investec = new InvestecClient({ baseUrl: "http://mock", clientId: "id", clientSecret: "s", apiKey: "k", log, fetchImpl: (i, init) => Promise.resolve(mockApp.request(i as string, init as RequestInit)) });

    const contributions = createContributionLoop({ investec, accountId: POOL_ACCOUNT_ID, contract, log, feed });
    const reserves = createReservesLoop({ investec, accountId: POOL_ACCOUNT_ID, contract, publicClient: clients.publicClient, attestor: clients.attestor, chainId: 31337, address: cfg.stokvel, log, feed });
    const payouts = createPayoutLoop({ investec, accountId: POOL_ACCOUNT_ID, method: "pay", members: cfg.members, contract, publicClient: clients.publicClient, log, feed });
    loops = { poll: () => contributions.poll(), reserves: () => reserves.tick(), payouts: async () => ({ close: await payouts.tryClose(), settled: await payouts.settle() }) };
    relayerApp = createHttpApp({ cfg, contract, contractV1, publicClient: clients.publicClient, contributions, reservesTick: reserves.tick, payoutsTick: loops.payouts, feed, log, status: () => ({}) });
  }, 60_000);

  afterAll(() => {
    anvilProc?.kill();
  });

  const post = async (app: { request: (u: string, i?: RequestInit) => Response | Promise<Response> }, url: string, body: unknown) =>
    (await app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

  it("DEMO 1: every member signs the constitution, gaslessly", async () => {
    const constitution = readFileSync(resolve(contractsDir, "CONSTITUTION.md"), "utf8");
    expect(await contract.read.constitutionHash()).toBe(keccak256(toBytes(constitution)));
    const domain = eip712Domain(31337, cfg.stokvel);
    for (const m of members) {
      const signature = await m.signTypedData({ domain, types, primaryType: "Join", message: { constitution } });
      const r = await post(relayerApp, "http://relayer/join", { signature });
      expect(r.ok).toBe(true);
    }
    for (let i = 0; i < 6; i++) expect(await contract.read.joined([i])).toBe(true);
    // a stranger's signature is refused
    const thief = privateKeyToAccount(keccak256(toBytes("thief")));
    const bad = await post(relayerApp, "http://relayer/join", { signature: await thief.signTypedData({ domain, types, primaryType: "Join", message: { constitution } }) });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/NotMember/);
  });

  it("DEMO 2: a card swipe lands as a contribution on chain, once", async () => {
    const swipe = await post(mockApp, "http://mock/__mock/swipe", { memberNumber: "03", centsAmount: 8700 });
    expect(swipe.roundUpCents).toBe(300);
    // the mock pushed a webhook and the poll loop runs as well; between them it lands exactly once
    await loops.poll();
    const [, , paid] = await contract.read.members([2n]);
    expect(paid).toBe(300n);
    const again = (await loops.poll()) as { recorded: number };
    expect(again.recorded).toBe(0);
    expect(await contract.read.totalIn()).toBe(300n);
  });

  it("the rest of the month: everyone pays, reserves are attested", async () => {
    for (const n of ["01", "02", "03", "04", "05", "06"]) await post(mockApp, "http://mock/__mock/credit", { memberNumber: n, cents: 500_000 });
    await loops.poll();
    expect(await contract.read.pot()).toBe(3_000_300n);
    const r = (await loops.reserves()) as { posted: boolean; cents: bigint };
    expect(r.posted).toBe(true);
    expect(r.cents).toBe(3_000_300n);
    const [held, owed, , fresh] = await contract.read.health();
    expect(held).toBe(owed);
    expect(fresh).toBe(true);
  });

  it("DEMO 3: month end closes, pays Lerato through the bank, confirms on chain", async () => {
    const before = (await loops.payouts()) as { close: { closed: boolean; reason?: string } };
    expect(before.close.closed).toBe(false);
    expect(before.close.reason).toBe("RoundStillOpen");

    const warp = await post(relayerApp, "http://relayer/admin/warp", { toRoundEnd: true });
    expect(warp.ok).toBe(true);
    await loops.reserves();
    const after = (await loops.payouts()) as { close: { closed: boolean }; settled: number };
    expect(after.close.closed).toBe(true);
    expect(after.settled).toBe(1);
    expect(await contract.read.round()).toBe(1n);
    expect(await contract.read.unsettled()).toBe(0n);
    expect(await contract.read.settledOut()).toBe(3_000_300n);
    expect(ledger.balance(POOL_ACCOUNT_ID).currentBalance).toBe(0);
    const lerato = ledger.beneficiaries[0]!;
    expect(lerato.lastPaymentAmount).toBe("30003.00");
    // running the loop again pays nobody twice
    const again = (await loops.payouts()) as { settled: number };
    expect(again.settled).toBe(0);
  });

  it("DEMO 4: the treasurer steals and the next close is frozen with ReservesShort", async () => {
    for (const n of ["01", "02", "03", "04", "05", "06"]) await post(mockApp, "http://mock/__mock/credit", { memberNumber: n, cents: 500_000 });
    await loops.poll();
    await post(mockApp, "http://mock/__mock/steal", { cents: 100_000 });
    await post(relayerApp, "http://relayer/admin/warp", { toRoundEnd: true });
    await loops.reserves();
    const r = (await loops.payouts()) as { close: { closed: boolean; reason?: string } };
    expect(r.close.closed).toBe(false);
    expect(r.close.reason).toBe("ReservesShort(2900000, 3000000)");
    expect(feed.last().some((f) => f.title === "Payout frozen")).toBe(true);
    // money comes back, the club moves on
    await post(mockApp, "http://mock/__mock/refund", { cents: 100_000 });
    await post(relayerApp, "http://relayer/admin/warp", { seconds: 1 });
    await loops.reserves();
    const ok = (await loops.payouts()) as { close: { closed: boolean } };
    expect(ok.close.closed).toBe(true);
    expect(await contract.read.round()).toBe(2n);
  });

  it("DEMO 5: the same webhook twice. V1 double-credits, V2 says AlreadyRecorded", async () => {
    const tx = ledger.post(POOL_ACCOUNT_ID, "CREDIT", 500_000n, "STK-05", { silent: true });
    const { id: _i, cents: _c, at: _a, ...transaction } = tx;
    const [, , v1before] = await contractV1.read.members([4n]);
    const [, , v2before] = await contract.read.members([4n]);
    const v1a = await post(relayerApp, "http://relayer/webhook/transaction", { accountId: POOL_ACCOUNT_ID, transaction, target: "v1" });
    const v1b = await post(relayerApp, "http://relayer/webhook/transaction", { accountId: POOL_ACCOUNT_ID, transaction, target: "v1" });
    expect(v1a.result).toBe("recorded");
    expect(v1b.result).toBe("recorded");
    const [, , v1paid] = await contractV1.read.members([4n]);
    expect(v1paid - v1before).toBe(1_000_000n);

    const v2a = await post(relayerApp, "http://relayer/webhook/transaction", { accountId: POOL_ACCOUNT_ID, transaction, target: "v2" });
    const v2b = await post(relayerApp, "http://relayer/webhook/transaction", { accountId: POOL_ACCOUNT_ID, transaction, target: "v2" });
    expect(v2a.result).toBe("recorded");
    expect(v2b.result).toMatch(/^refused:AlreadyRecorded/);
    const [, , v2paid] = await contract.read.members([4n]);
    expect(v2paid - v2before).toBe(500_000n);
  });

  it("DEMO 7: four cards sign a raise, the timelock passes, the change applies", async () => {
    const proposal = await post(relayerApp, "http://relayer/propose", { kind: 0, value: "600000" });
    expect(proposal.ok).toBe(true);
    const id = proposal.proposalId as string;
    const domain = eip712Domain(31337, cfg.stokvel);
    for (const m of members.slice(0, 4)) {
      const nonce = (await (await relayerApp.request(`http://relayer/nonce/${m.address}`)).json()).nonce as string;
      const signature = await m.signTypedData({ domain, types, primaryType: "Vote", message: { proposalId: BigInt(id), nonce: BigInt(nonce) } });
      const r = await post(relayerApp, "http://relayer/votes", { proposalId: id, nonce, signature });
      expect(r.ok).toBe(true);
      // a replay of the same signature is refused
      const replay = await post(relayerApp, "http://relayer/votes", { proposalId: id, nonce, signature });
      expect(replay.ok).toBe(false);
      expect(replay.error).toMatch(/BadNonce/);
    }
    const early = await post(relayerApp, "http://relayer/execute", { proposalId: id });
    expect(early.error).toMatch(/TimelockActive/);
    await post(relayerApp, "http://relayer/admin/warp", { seconds: 121 });
    const done = await post(relayerApp, "http://relayer/execute", { proposalId: id });
    expect(done.ok).toBe(true);
    expect(await contract.read.contributionCents()).toBe(600_000n);
  });

  it("DEMO 8: Sipho's card is stolen; after RotateKey the thief is rejected and card 04b votes", async () => {
    const spare = privateKeyToAccount(keccak256(toBytes("spare card 04b")));
    const p = await post(relayerApp, "http://relayer/propose", { kind: 1, memberId: 5, newAddr: spare.address });
    const id = p.proposalId as string;
    const domain = eip712Domain(31337, cfg.stokvel);
    for (const m of members.slice(0, 4)) {
      const nonce = (await (await relayerApp.request(`http://relayer/nonce/${m.address}`)).json()).nonce as string;
      const signature = await m.signTypedData({ domain, types, primaryType: "Vote", message: { proposalId: BigInt(id), nonce: BigInt(nonce) } });
      await post(relayerApp, "http://relayer/votes", { proposalId: id, nonce, signature });
    }
    await post(relayerApp, "http://relayer/admin/warp", { seconds: 121 });
    expect((await post(relayerApp, "http://relayer/execute", { proposalId: id })).ok).toBe(true);
    expect(await contract.read.idOf([members[5]!.address])).toBe(0n);
    expect(await contract.read.idOf([spare.address])).toBe(6n);

    const next = await post(relayerApp, "http://relayer/propose", { kind: 0, value: "700000" });
    const thiefSig = await members[5]!.signTypedData({ domain, types, primaryType: "Vote", message: { proposalId: BigInt(next.proposalId), nonce: 0n } });
    const rejected = await post(relayerApp, "http://relayer/votes", { proposalId: next.proposalId, nonce: "0", signature: thiefSig });
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/NotMember/);
    const spareSig = await spare.signTypedData({ domain, types, primaryType: "Vote", message: { proposalId: BigInt(next.proposalId), nonce: 0n } });
    expect((await post(relayerApp, "http://relayer/votes", { proposalId: next.proposalId, nonce: "0", signature: spareSig })).ok).toBe(true);
    expect(await contract.read.hasVoted([BigInt(next.proposalId), 5])).toBe(true);
  });

  it("kill the server: a fresh relayer rebuilds from bank and chain and sends nothing twice", async () => {
    const clients = makeClients(cfg);
    const investec = new InvestecClient({ baseUrl: "http://mock", clientId: "id", clientSecret: "s", apiKey: "k", log, fetchImpl: (i, init) => Promise.resolve(mockApp.request(i as string, init as RequestInit)) });
    const fresh = createContributionLoop({ investec, accountId: POOL_ACCOUNT_ID, contract: stokvelContract(cfg.stokvel, clients.publicClient, clients.wallet), log, feed: new Feed() });
    const before = await contract.read.totalIn();
    const r = await fresh.poll();
    expect(r.recorded).toBe(0);
    expect(await contract.read.totalIn()).toBe(before);
    expect(errorText(new Error("x"))).toBe("x");
  });
});
