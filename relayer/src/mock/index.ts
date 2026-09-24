import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { Ledger } from "./ledger.js";
import { createMockApp } from "./server.js";
import { log } from "../log.js";

const port = Number(process.env.MOCK_PORT ?? 4100);
const relayerWebhookUrl = process.env.RELAYER_WEBHOOK_URL ?? "http://127.0.0.1:4000/webhook/transaction";
const seedFile = process.env.MOCK_SEED_FILE ?? resolve(process.cwd(), "..", "contracts", "deployments", "demo-ledger.jsonl");

const ledger = new Ledger();
const loaded = ledger.seed(seedFile);
const app = createMockApp({ ledger, log, relayerWebhookUrl, selfUrl: `http://127.0.0.1:${port}`, cardDir: resolve(process.cwd(), "..", "card"), stateless: process.env.MOCK_STATELESS === "true" });

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  log.info({ port, seeded: loaded, balance: ledger.balance("1111122222333334444455555").currentBalance }, "mock Investec is up");
});
