// Screenshots of the stage app against the running demo stack.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "/tmp/claude-0/shots/out";
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:3000";
const relayer = "http://127.0.0.1:4000";
const mock = "http://127.0.0.1:4100";

const post = async (url, body = {}) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`POST ${url} -> ${r.status} ${text.slice(0, 120)}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("console.error", m.text().slice(0, 200)); });

async function shot(name, url, opts = {}) {
  await page.goto(url, { waitUntil: "networkidle" });
  await sleep(opts.wait ?? 2500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: !!opts.full });
  console.log("shot", name);
}

const which = process.argv[3] ?? "all";

if (which === "all" || which === "normal") {
  await shot("dashboard-normal", `${base}/`);
}

if (which === "all" || which === "sign") {
  // signing station with a pasted card key (Anvil member 03 = Aisha), a proposal open
  const cfg = await fetch(`${base}/api/config`).then((r) => r.json());
  const existing = await fetch(`${base}/api/config`).then(r=>r.json()); const props = { proposalId: "0" };
  console.log("proposal", props.proposalId);
  await page.goto(`${base}/sign`, { waitUntil: "networkidle" });
  await sleep(1500);
  // Anvil mnemonic account 5 (member 03, Aisha)
  const { mnemonicToAccount } = await import("viem/accounts");
  const { toHex } = await import("viem");
  const acct = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: 5 });
  const key = toHex(acct.getHdKey().privateKey);
  await page.fill("input[placeholder^='or paste']", `stokvel:v1:${key}`);
  await page.press("input[placeholder^='or paste']", "Enter");
  await sleep(2500);
  await page.screenshot({ path: `${out}/sign-message.png` });
  console.log("shot sign-message", cfg.stokvel);
}

if (which === "all" || which === "short") {
  // treasurer theft: steal, attest, try to close -> ReservesShort alarm
  await post(`${mock}/__mock/steal`, { cents: 100000 });
  await post(`${relayer}/admin/warp`, { toRoundEnd: true });
  await post(`${relayer}/admin/tick`);
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await sleep(3500);
  await page.screenshot({ path: `${out}/dashboard-reserves-short.png` });
  console.log("shot dashboard-reserves-short");
  await page.keyboard.press("Escape");
  await sleep(800);
  await page.screenshot({ path: `${out}/dashboard-short-bar.png` });
  // put it back so the state is honest again
  await post(`${mock}/__mock/refund`, { cents: 100000 });
  await post(`${relayer}/admin/warp`, { seconds: 1 });
  await post(`${relayer}/admin/tick`);
}

if (which === "all" || which === "double") {
  await post(`${mock}/__mock/double-webhook`, { times: 2 });
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await sleep(3000);
  await page.screenshot({ path: `${out}/dashboard-already-recorded.png` });
  console.log("shot dashboard-already-recorded");
}

if (which === "all" || which === "watch") {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const p = await phone.newPage();
  await p.goto(`${base}/watch`, { waitUntil: "networkidle" });
  await sleep(3000);
  await p.screenshot({ path: `${out}/watch-phone.png`, fullPage: false });
  await p.screenshot({ path: `${out}/watch-phone-full.png`, fullPage: true });
  console.log("shot watch-phone");
  await phone.close();
}

if (which === "all" || which === "presenter") {
  await shot("presenter", `${base}/presenter`, { wait: 2500 });
}

await browser.close();
