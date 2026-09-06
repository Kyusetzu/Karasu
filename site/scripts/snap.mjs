#!/usr/bin/env node
/**
 * Review screenshots: renders one or more URLs at the widths the design is
 * judged at and writes PNGs under `captures/review/`. Headless Edge through
 * playwright-core (no browser download), the same executable the app's
 * virtual-rows check uses.
 *
 *   node scripts/snap.mjs <url> [<url> …] [options]
 *
 *   --widths 390,768,1280,1440,2560   viewport widths (default all five)
 *   --full                            whole page height, not the first viewport
 *   --out name                        file name stem (default "page")
 *   --clip <selector>                 capture only that element
 *   --frames 0,500,1000               one capture per delay (ms) after load, for a timeline
 *   --reduced                         emulate prefers-reduced-motion: reduce
 *   --scale 2                         device scale factor (default 2 below 768 px, else 1)
 *
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
const flagsWithValue = new Set(["--widths", "--out", "--clip", "--frames", "--scale"]);
const opts = {};
const urls = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (flagsWithValue.has(a)) opts[a] = argv[++i];
  else if (a.startsWith("--")) opts[a] = true;
  else urls.push(a);
}
const widths = (opts["--widths"] ?? "390,768,1280,1440,2560").split(",").map(Number);
const frames = opts["--frames"] ? opts["--frames"].split(",").map(Number) : [null];
const name = opts["--out"] ?? "page";
const full = Boolean(opts["--full"]);
const clip = opts["--clip"];
const reduced = Boolean(opts["--reduced"]);

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
      const scale = opts["--scale"] ? Number(opts["--scale"]) : width < 768 ? 2 : 1;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: scale,
        colorScheme: "dark",
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // A full-page capture does not scroll, and the page reveals on scroll:
      // sweep it once so every block has been in view, then return to the top.
      if (full) {
        await page.evaluate(async () => {
          // Instant, not smooth: the page asks for smooth scrolling, and a smooth
          // sweep glides past the observers between frames.
          document.documentElement.style.scrollBehavior = "auto";
          const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
          for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
            window.scrollTo({ top: y, behavior: "instant" });
            await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 90)));
          }
          window.scrollTo({ top: 0, behavior: "instant" });
          // Whatever the sweep missed is revealed by hand: this is a review
          // still, and a block that is invisible in it tells the reviewer nothing.
          for (const el of document.querySelectorAll("[data-reveal]")) el.setAttribute("data-revealed", "");
          document.documentElement.style.scrollBehavior = "";
        });
        await page.waitForTimeout(500);
      }
      let elapsed = 0;
      for (const at of frames) {
        if (at === null) await page.waitForTimeout(600);
        else {
          await page.waitForTimeout(Math.max(0, at - elapsed));
          elapsed = at;
        }
        const tag = `${name}-${width}${reduced ? "-reduced" : ""}${at === null ? "" : `-t${at}`}${full ? "-full" : ""}.png`;
        const file = path.join(OUT, tag);
        if (clip) {
          const el = page.locator(clip).first();
          await el.screenshot({ path: file, animations: "allow" });
        } else {
          await page.screenshot({ path: file, fullPage: full, animations: "allow" });
        }
        console.log(`snap: ${tag}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
