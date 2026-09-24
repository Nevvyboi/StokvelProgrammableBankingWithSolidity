import { serve } from "@hono/node-server";
import { loadConfig, SANDBOX_URL } from "./config.js";
import { log } from "./log.js";
import { InvestecClient } from "./investec/client.js";
import { makeClients, stokvelContract } from "./chain.js";
import { Feed } from "./feed.js";
import { createContributionLoop } from "./loops/contributions.js";
import { createReservesLoop } from "./loops/reserves.js";
import { createPayoutLoop } from "./loops/payouts.js";
import { createHttpApp } from "./http.js";

/**
 * The relayer. Four loops, one HTTP surface, no database. On restart it re-reads the bank and the
 * chain and carries on; nothing it sends is accepted twice.
 */
async function main() {
  const cfg = loadConfig();
  const { publicClient, wallet, relayer, attestor } = makeClients(cfg);
  const contract = stokvelContract(cfg.stokvel, publicClient, wallet);
  const contractV1 = cfg.stokvelV1 ? stokvelContract(cfg.stokvelV1, publicClient, wallet) : null;
  const feed = new Feed();

  const investec = new InvestecClient({
    baseUrl: cfg.investecBaseUrl,
    clientId: cfg.INVESTEC_CLIENT_ID || "mock",
    clientSecret: cfg.INVESTEC_CLIENT_SECRET || "mock",
    apiKey: cfg.INVESTEC_API_KEY || "mock",
    log,
  });
  const shadow =
    cfg.INVESTEC_MODE === "mock" && cfg.INVESTEC_SHADOW === "sandbox" && cfg.INVESTEC_CLIENT_ID
      ? new InvestecClient({ baseUrl: SANDBOX_URL, clientId: cfg.INVESTEC_CLIENT_ID, clientSecret: cfg.INVESTEC_CLIENT_SECRET, apiKey: cfg.INVESTEC_API_KEY, log })
      : undefined;

  const accounts = await investec.accounts();
  const account = cfg.INVESTEC_ACCOUNT_ID ? accounts.find((a) => a.accountId === cfg.INVESTEC_ACCOUNT_ID) : accounts[0];
  if (!account) throw new Error("no Investec account found");
  const profileId = cfg.INVESTEC_PROFILE_ID || account.profileId;

  const onChainRelayer = await contract.read.relayer();
  if (onChainRelayer.toLowerCase() !== relayer.address.toLowerCase()) {
    log.warn({ onChainRelayer, ours: relayer.address }, "RELAYER_PK does not match the contract's relayer; writes will be refused");
  }

  log.info(
    {
      mode: cfg.INVESTEC_MODE,
      investec: cfg.investecBaseUrl,
      account: account.accountId,
      referenceName: account.referenceName,
      chainId: cfg.CHAIN_ID,
      stokvel: cfg.stokvel,
      relayer: relayer.address,
      attestor: attestor.address,
      shadow: shadow ? SANDBOX_URL : "off",
    },
    "relayer starting",
  );

  const contributions = createContributionLoop({ investec, accountId: account.accountId, contract, log, feed });
  const reserves = createReservesLoop({
    investec,
    accountId: account.accountId,
    contract,
    publicClient,
    attestor,
    chainId: cfg.CHAIN_ID,
    address: cfg.stokvel,
    log,
    feed,
  });
  const payouts = createPayoutLoop({
    investec,
    accountId: account.accountId,
    profileId,
    method: cfg.PAYOUT_METHOD,
    members: cfg.members,
    contract,
    publicClient,
    log,
    feed,
    shadow,
  });

  const startedAt = Date.now();
  const state = { lastPoll: 0, lastReserves: 0, errors: 0 };
  const guard = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (err) {
      state.errors += 1;
      log.error({ loop: name, err: String(err).split("\n")[0] }, "loop error");
    }
  };

  const pollOnce = guard("contributions", async () => {
    await contributions.poll();
    state.lastPoll = Date.now();
  });
  const reservesOnce = guard("reserves", async () => {
    await reserves.tick();
    state.lastReserves = Date.now();
  });
  const payoutsOnce = guard("payouts", async () => {
    await payouts.tryClose();
    await payouts.settle();
  });

  // first pass before serving, so a restart catches up before anyone asks
  await pollOnce();
  await reservesOnce();
  await payoutsOnce();

  setInterval(pollOnce, cfg.POLL_MS);
  setInterval(reservesOnce, cfg.DEMO_MODE ? cfg.RESERVES_MS : 5 * 60_000);
  setInterval(payoutsOnce, cfg.POLL_MS);

  const app = createHttpApp({
    cfg,
    contract,
    contractV1,
    publicClient,
    contributions,
    reservesTick: () => reserves.tick(),
    payoutsTick: async () => ({ close: await payouts.tryClose(), settled: await payouts.settle() }),
    feed,
    log,
    status: () => ({ ...state, startedAt, mode: cfg.INVESTEC_MODE, chainId: cfg.CHAIN_ID, stokvel: cfg.stokvel, stokvelV1: cfg.stokvelV1, account: account.accountId, relayer: relayer.address, attestor: attestor.address }),
    investec,
    accountId: account.accountId,
  });
  serve({ fetch: app.fetch, port: cfg.PORT, hostname: "0.0.0.0" }, () => log.info({ port: cfg.PORT }, "relayer listening"));
}

main().catch((err) => {
  log.fatal({ err: String(err) }, "relayer failed to start");
  process.exit(1);
});
