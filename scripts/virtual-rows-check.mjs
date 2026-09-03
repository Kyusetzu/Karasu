#!/usr/bin/env node
// Checks `VirtualRows` in a real browser, because nothing else can.
//
// jsdom has no layout: every rect is zero, so the virtualizer's window is
// degenerate and it mounts *no* rows at all. Measured, not assumed — a unit
// test there passes every assertion vacuously, which reads as coverage and
// is worse than having none. Everything this component does is geometry, so
// the check is a real Chromium with a real scroll container.
//
// Not part of `npm run verify`: it needs a browser and a dev server, the same
// reason android-check.ps1 and windows-check.sh sit outside the gate.
//
// Usage: node scripts/virtual-rows-check.mjs
// Requires: playwright (npm i --no-save --no-audit --no-fund playwright, then
// `git checkout -- package-lock.json` to undo npm's rewrite of the root
// version, which bump-version.mjs does not maintain) and a Chromium-family
// browser: $CHROMIUM_PATH, else Edge on Windows, else /opt/pw-browsers/chromium.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROMIUM =
  process.env.CHROMIUM_PATH ??
  (process.platform === "win32"
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "/opt/pw-browsers/chromium");
if (!existsSync(CHROMIUM)) {
  console.error(`virtual-rows-check: no browser at ${CHROMIUM} — set CHROMIUM_PATH`);
  process.exit(1);
}
const HARNESS_URL = "http://localhost:5199/";

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

// Node's own binary and Vite's entry script, not `npx`: on Windows the shim is
// `npx.cmd`, which `spawn` cannot find without a shell (ENOENT, and with no
// error listener that was an uncaught exception), and a shell would make the
// `vite.kill()` below stop the shell and orphan the server on 5199.
let stopping = false;
const vite = spawn(
  process.execPath,
  [
    path.join(here, "..", "node_modules", "vite", "bin", "vite.js"),
    "--config",
    path.join(here, "virtual-rows-check", "vite.config.ts"),
  ],
  { cwd: path.join(here, ".."), stdio: "ignore" },
);
vite.on("error", (e) => {
  console.error(`virtual-rows-check: could not start vite: ${e.message}`);
  process.exit(1);
});
// `stdio: "ignore"` hides a Vite that started and then died (port taken, bad
// config), so its exit has to be watched too.
vite.on("exit", (code) => {
  if (!stopping && code) {
    console.error(`virtual-rows-check: vite exited with ${code}`);
    process.exit(1);
  }
});
process.on("exit", () => {
  stopping = true;
  vite.kill();
});

const { chromium } = await import("playwright");

// Wait for the dev server rather than sleeping a fixed time.
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(HARNESS_URL)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(HARNESS_URL, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="a0"]');

const scrollTo = async (y) => {
  await page.evaluate((v) => {
    document.getElementById("scroller").scrollTop = v;
  }, y);
  await page.waitForTimeout(350);
};
const mounted = () => page.$$eval("[data-testid]", (n) => n.map((e) => e.dataset.testid));
const rect = (id) =>
  page.$eval(`[data-testid="${id}"]`, (e) => {
    const r = e.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  });
/** Offset within the scroller, which is what the virtualizer's maths is in. */
const offset = (id) =>
  page.evaluate((sel) => {
    const s = document.getElementById("scroller");
    const e = document.querySelector(sel);
    if (!e) return null;
    return Math.round(e.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop);
  }, `[data-testid="${id}"]`);

const atRest = await mounted();
check("mounts a bounded subset", atRest.length > 0 && atRest.length < 60,
  `${atRest.length} of 1000`);

const [a0, a1, a2] = [await rect("a0"), await rect("a1"), await rect("a2")];
check("rows tile without gap or overlap", a1.top === a0.bottom && a2.top === a1.bottom,
  `${a0.bottom}/${a1.top}/${a1.bottom}/${a2.top}`);

await scrollTo(20000);
const scrolled = await mounted();
check("scrolling recycles rather than accumulates",
  scrolled.length < 60 && !scrolled.includes("a0"), `${scrolled.length} mounted`);

// The reason each instance measures its own `scrollMargin`: two lists share
// one scroller, and the second must start below the first, not on top of it.
await scrollTo(33900);
const [endOfA, startOfB] = [await offset("a499"), await offset("b0")];
check("the second list starts after the first",
  endOfA !== null && startOfB !== null && startOfB > endOfA, `${endOfA} then ${startOfB}`);
const [b0, b1] = [await rect("b0"), await rect("b1")];
check("the second list tiles too", b1.top === b0.bottom, `${b0.bottom}/${b1.top}`);

const lastFlags = await page.$$eval('[data-last="true"]', (n) => n.map((e) => e.dataset.testid));
check("only the final row of a list is flagged last",
  lastFlags.every((id) => id === "a499" || id === "b499"), lastFlags.join(","));

// An expanded row is taller than the estimate, so it has to be measured.
await scrollTo(0);
await page.click('[data-testid="a1"]');
await page.waitForTimeout(350);
const expanded = await rect("a1");
const pushed = await rect("a2");
check("expanding a row re-measures it", expanded.h > 150, `${expanded.h}px`);
check("the row below moves down by the difference", pushed.top === expanded.bottom);

// The state lives above the rows precisely so this survives.
await scrollTo(25000);
const away = (await mounted()).includes("a1");
await scrollTo(0);
const returned = await rect("a1");
check("an expanded row is unmounted when scrolled away", !away);
check("and is still expanded when it comes back", returned.h === expanded.h,
  `${returned.h} vs ${expanded.h}`);

// Nothing re-renders VirtualRows when a *sibling* above changes height, so
// only the ResizeObserver can catch it. This is the case that silently
// desyncs without one.
const before = await offset("a0");
await page.click("#grow");
await page.waitForTimeout(400);
const after = await offset("a0");
check("a section growing above moves the rows below it", after - before === 360,
  `${before} -> ${after}`);

check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
stopping = true;
vite.kill();

if (failures.length) {
  console.error(`\nvirtual-rows-check: ${failures.length} failed`);
  process.exit(1);
}
console.log("\nvirtual-rows-check: ok");
