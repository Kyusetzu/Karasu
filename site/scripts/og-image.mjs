#!/usr/bin/env node
/**
 * The social preview (`public/og.png`, 1200x630): the Wrapped poster's
 * recipe — near-black ground, three washes, the 1px catch-light, the mark
 * bleeding off the corner — with the wordmark and the one-line pitch. Run
 * once and commit the result; re-run when the pitch or the palette moves.
 *
 * Rendered by headless Edge through playwright-core from an HTML string, so
 * it is the site's own CSS tokens and the site's own font, not a re-typed
 * approximation.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SITE = path.resolve(here, "..");
const EDGE =
  process.env.CHROMIUM_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "/opt/pw-browsers/chromium");
if (!existsSync(EDGE)) {
  console.error(`og-image: no browser at ${EDGE} — set CHROMIUM_PATH`);
  process.exit(1);
}

const font = (w) =>
  `data:font/woff2;base64,${readFileSync(path.join(SITE, "public", "fonts", `sn-pro-latin-${w}-normal.woff2`)).toString("base64")}`;
const mark = `data:image/svg+xml;base64,${readFileSync(path.join(SITE, "src", "assets", "karasu-mark.svg")).toString("base64")}`;

// The default accent's derived values, as tokens.generated.css carries them.
const tokens = readFileSync(path.join(SITE, "src", "styles", "tokens.generated.css"), "utf8");
const val = (name) => {
  const m = tokens.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`og-image: token ${name} not found`);
  return m[1].trim();
};
const accentRgb = val("--accent-rgb");
const w1 = val("--w1");
const w2 = val("--w2");
const accent400 = val("--color-accent-400");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"SN Pro";font-weight:400;src:url(${font(400)}) format("woff2")}
@font-face{font-family:"SN Pro";font-weight:700;src:url(${font(700)}) format("woff2")}
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#07090d;font-family:"SN Pro",system-ui,sans-serif;color:#f1f5f9}
.stage{position:relative;width:1200px;height:630px;
  background:
    radial-gradient(90% 90% at 0% 0%, rgba(${w1},.16), transparent 60%),
    radial-gradient(70% 70% at 100% 100%, rgba(${accentRgb},.13), transparent 60%),
    radial-gradient(60% 60% at 50% 45%, rgba(${w2},.07), transparent 65%),
    #07090d;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.mark{position:absolute;right:-90px;bottom:-120px;width:560px;opacity:.34;transform:rotate(-7deg)}
.copy{position:absolute;left:88px;top:120px;max-width:760px}
.eyebrow{font-size:18px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${accent400}}
h1{margin:22px 0 0;font-size:64px;line-height:1.06;letter-spacing:-.03em;font-weight:700}
p{margin:26px 0 0;font-size:26px;line-height:1.4;color:rgba(238,241,246,.62)}
.foot{position:absolute;left:88px;bottom:64px;display:flex;align-items:center;gap:16px}
.foot img{width:40px;height:44px;object-fit:contain}
.foot .word{font-size:18px;font-weight:700;letter-spacing:.2em}
.foot .rule{width:1px;height:20px;background:rgba(238,241,246,.18)}
.foot .url{font-size:16px;color:rgba(238,241,246,.5);letter-spacing:.02em}
</style></head><body><div class="stage">
  <img class="mark" src="${mark}" alt="">
  <div class="copy">
    <div class="eyebrow">Free · open source · built for AniList</div>
    <h1>A modern anime &amp; manga tracker, built exclusively for AniList.</h1>
    <p>Karasu watches what you play and read and keeps your AniList progress in sync — no buttons to press. Windows · Linux · Android.</p>
  </div>
  <div class="foot"><img src="${mark}" alt=""><span class="word">KARASU</span><span class="rule"></span><span class="url">kyusetzu.github.io/Karasu</span></div>
</div></body></html>`;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  const out = path.join(SITE, "public", "og.png");
  await page.screenshot({ path: out, type: "png" });
  console.log(`og-image: ${path.relative(SITE, out)}`);
} finally {
  await browser.close();
}
