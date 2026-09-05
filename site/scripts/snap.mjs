#!/usr/bin/env node
/**
 * Review screenshots: renders one or more URLs at the widths the design is
 * judged at and writes PNGs under `captures/review/`. Headless Edge through
 * playwright-core (no browser download), the same executable the app's
 * virtual-rows check uses.
 *
 *   node scripts/snap.mjs <url> [<url> …] [--widths 390,768,1280,1440,2560] [--full] [--out name]
 *
 * `--full` captures the whole page height; otherwise the first viewport.
 * A URL's `#hash` is kept, so `#sample` reaches the dev-only sample page.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = path.resolve(here, "..", "captures", "review");
const EDGE =
  process.env.CHROMIUM_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "/opt/pw-browsers/chromium");

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const urls = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && argv[i - 1] !== "--full"));
const widths = opt("--widths", "390,768,1280,1440,2560").split(",").map(Number);
const full = argv.includes("--full");
const name = opt("--out", "page");

if (!urls.length) {
  console.error("snap: give at least one URL");
  process.exit(1);
}
if (!existsSync(EDGE)) {
  console.error(`snap: no browser at ${EDGE} — set CHROMIUM_PATH`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  for (const url of urls) {
    for (const width of widths) {
      const height = width < 768 ? 844 : 900;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: width < 768 ? 2 : 1,
        colorScheme: "dark",
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const tag = `${name}-${width}${full ? "-full" : ""}.png`;
      await page.screenshot({ path: path.join(OUT, tag), fullPage: full });
      console.log(`snap: ${tag}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
