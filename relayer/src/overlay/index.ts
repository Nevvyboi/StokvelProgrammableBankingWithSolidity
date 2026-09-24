import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { OverlayStore } from "./store.js";
import { createOverlayApp } from "./server.js";
import { loadConfig, SANDBOX_URL } from "../config.js";
import { log } from "../log.js";

/**
 * The stateful sandbox, as a process. Point INVESTEC_BASE_URL at it.
 *   OVERLAY_PORT (4200), SANDBOX_URL, OVERLAY_FILE (.demo/sandbox-overlay.json),
 *   INVESTEC_CLIENT_ID / SECRET / API_KEY for the presenter stories,
 *   POOL_ACCOUNT_ID / TREASURER_ACCOUNT_ID to choose which sandbox accounts play which part.
 */
const cfg = loadConfig({ INVESTEC_MODE: "sandbox", INVESTEC_BASE_URL: "unused" });
const port = Number(process.env.OVERLAY_PORT ?? 4200);
const store = new OverlayStore(process.env.OVERLAY_FILE ?? resolve(process.cwd(), "..", ".demo", "sandbox-overlay.json"));
const app = createOverlayApp({
  sandboxUrl: process.env.SANDBOX_URL ?? SANDBOX_URL,
  store,
  log,
  clientId: cfg.INVESTEC_CLIENT_ID || undefined,
  clientSecret: cfg.INVESTEC_CLIENT_SECRET,
  apiKey: cfg.INVESTEC_API_KEY,
  poolAccountId: process.env.POOL_ACCOUNT_ID,
  treasurerAccountId: process.env.TREASURER_ACCOUNT_ID,
  relayerWebhookUrl: process.env.RELAYER_WEBHOOK_URL ?? "http://127.0.0.1:4000/webhook/transaction",
  selfUrl: `http://127.0.0.1:${port}`,
  cardDir: resolve(process.cwd(), "..", "card"),
});
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => log.info({ port, sandbox: process.env.SANDBOX_URL ?? SANDBOX_URL, recorded: store.snapshot().refs.length }, "sandbox overlay is up"));
