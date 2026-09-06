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
import sharp from "sharp";

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
          if (full) {
            // Not `fullPage: true`. Chromium renders a capture beyond the
            // viewport into one surface capped at 16,384 px, and the part of
            // a taller page past the cap wraps around: the 768 and 2560
            // stills ended with the nav and hero painted over the footer,
            // 21,393 and 17,018 px tall with the DOM holding one of each. A
            // single viewport of the page's own height hits the same cap. So:
            // scroll the page in tiles that fit, hide the sticky nav on every
            // tile but the first (it would repeat at each seam), and
            // composite them. Nothing on the page is sized in vh, so the
            // shorter viewport changes no layout.
            const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
            const tileH = Math.min(docHeight, Math.floor(8000 / scale));
            await page.setViewportSize({ width, height: tileH });
            const tiles = [];
            for (let top = 0; top < docHeight; top += tileH) {
              const y = await page.evaluate((t) => {
                document.documentElement.style.scrollBehavior = "auto";
                window.scrollTo({ top: t, behavior: "instant" });
                document.querySelector("header")?.style.setProperty("visibility", t > 0 ? "hidden" : "");
                return window.scrollY;
              }, top);
              await page.waitForTimeout(150);
              const shot = await page.screenshot({ animations: "allow" });
              const h = Math.min(tileH, docHeight - top);
              tiles.push({
                left: 0,
                top: Math.round(top * scale),
                input: await sharp(shot)
                  .extract({ left: 0, top: Math.round((top - y) * scale), width: Math.round(width * scale), height: Math.round(h * scale) })
                  .png()
                  .toBuffer(),
              });
            }
            await page.evaluate(() => {
              document.querySelector("header")?.style.removeProperty("visibility");
              document.documentElement.style.scrollBehavior = "";
              window.scrollTo({ top: 0, behavior: "instant" });
            });
            await page.setViewportSize({ width, height });
            await sharp({
              create: { width: Math.round(width * scale), height: Math.round(docHeight * scale), channels: 4, background: "#000" },
            })
              .composite(tiles)
              .png()
              .toFile(file);
          } else {
            await page.screenshot({ path: file, animations: "allow" });
          }
        }
        console.log(`snap: ${tag}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
