#!/usr/bin/env node
/**
 * Lighthouse against the built site, served by `vite preview` on port 4322,
 * in headless Edge. Both presets, all four categories; the scores land in
 * `captures/review/lighthouse-{mobile,desktop}.json` and the summary prints.
 *
 *   npm run build && node scripts/lighthouse.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..");
const OUT = path.join(SITE, "captures", "review");
const URL = "http://localhost:4322/Karasu/";
const EDGE =
  process.env.CHROMIUM_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "/opt/pw-browsers/chromium");
if (!existsSync(path.join(SITE, "dist", "client", "index.html"))) {
  console.error("lighthouse: no dist/client — run `npm run build` first");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const preview = spawn(
  process.execPath,
  [path.join(SITE, "node_modules", "vite", "bin", "vite.js"), "preview", "--outDir", "dist/client", "--port", "4322", "--strictPort"],
  { cwd: SITE, stdio: "ignore" },
);
const ready = async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("lighthouse: preview did not come up on 4322");
};

let failed = false;
try {
  await ready();
  const chrome = await launch({ chromePath: EDGE, chromeFlags: ["--headless=new", "--no-first-run"] });
  try {
    for (const preset of ["mobile", "desktop"]) {
      const result = await lighthouse(URL, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        ...(preset === "desktop" ? { preset: "desktop" } : {}),
      });
      const cats = result.lhr.categories;
      const scores = Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)]));
      writeFileSync(path.join(OUT, `lighthouse-${preset}.json`), result.report);
      const line = Object.entries(scores).map(([k, v]) => `${k} ${v}`).join("  ");
      console.log(`lighthouse ${preset.padEnd(7)} ${line}`);
      for (const [k, v] of Object.entries(scores)) if (v < 95) {
        failed = true;
        console.log(`  under 95: ${k} (${v})`);
      }
      const audits = Object.values(result.lhr.audits).filter((a) => a.score !== null && a.score < 0.9 && a.details?.type !== "debugdata");
      for (const a of audits.slice(0, 12)) console.log(`  - ${a.id}: ${a.title}${a.displayValue ? ` — ${a.displayValue}` : ""}`);
    }
  } finally {
    // chrome-launcher tries to delete its temp profile while Edge still holds
    // it on Windows; the scores are already on disk.
    try {
      await chrome.kill();
    } catch {}
  }
} finally {
  preview.kill();
}
process.exit(failed ? 1 : 0);
