// Renders every SVG in this folder to PNG at 2x, dark and light, with the repo's fonts.
// Needs playwright (npm i playwright) and a Chromium; PLAYWRIGHT_CHROMIUM overrides the binary.
import { chromium } from "playwright";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fonts = resolve(here, "..", "fonts");
const out = resolve(here, "png");
mkdirSync(out, { recursive: true });

const fontCss = `
@font-face { font-family: "Space Grotesk"; src: url("file://${fonts}/space-grotesk/SpaceGrotesk[wght].ttf"); font-weight: 300 700; }
@font-face { font-family: "Inter"; src: url("file://${fonts}/inter/InterVariable.ttf"); font-weight: 100 900; }
@font-face { font-family: "JetBrains Mono"; src: url("file://${fonts}/jetbrains-mono/JetBrainsMono[wght].ttf"); font-weight: 100 800; }
html, body { margin: 0; background: transparent; }
svg { display: block; }
`;

const launch = { executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined };
const browser = await chromium.launch(launch);
const only = process.argv[2];
for (const file of readdirSync(here).filter((f) => f.endsWith(".svg") && (!only || f.startsWith(only)))) {
  const svg = readFileSync(resolve(here, file), "utf8");
  const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><html><head><style>${fontCss}</style></head><body>${svg.replace('data-theme="dark"', `data-theme="${theme}"`)}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const name = file.replace(".svg", "") + (theme === "light" ? "-light" : "") + ".png";
    await page.screenshot({ path: resolve(out, name), clip: { x: 0, y: 0, width: Number(w), height: Number(h) } });
    await page.close();
    console.log("wrote png/" + name);
  }
}
await browser.close();
