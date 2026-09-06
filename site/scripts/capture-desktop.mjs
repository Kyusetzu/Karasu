#!/usr/bin/env node
/**
 * Drives the isolated desktop rig over CDP to take the site's 2x screenshots.
 *
 * The rig is the release exe with a `karasu.portable` marker beside it, so
 * its database, log and token live under `src-tauri/target/release/data/`
 * and never touch the real install — which must NOT be running (the two
 * share a single-instance mutex; the tell is the real window popping up).
 * The maintainer signs the rig in once, by hand, in its window.
 *
 *   node scripts/capture-desktop.mjs launch            start the rig with remote debugging on
 *   node scripts/capture-desktop.mjs go <#/route>      navigate (hash router)
 *   node scripts/capture-desktop.mjs shot <name>       capture the current screen to captures/desktop/<name>.png
 *   node scripts/capture-desktop.mjs eval <js>         evaluate in the page, print the result
 *   node scripts/capture-desktop.mjs click <text>      click the first element with that text
 *   node scripts/capture-desktop.mjs key <combo>       press a key combination (e.g. Control+K)
 *   node scripts/capture-desktop.mjs store <key> <json> write a localStorage entry
 *   node scripts/capture-desktop.mjs invoke <cmd> <json> call a Tauri command
 *   node scripts/capture-desktop.mjs library <dir>     point the rig's library at a folder and scan it
 *   node scripts/capture-desktop.mjs quit              close the rig
 *
 * Every capture is at 1440x900 logical pixels with a device scale factor of
 * 2, set through CDP emulation so it does not depend on the window. Motion is
 * frozen for the still (`data-reduce-motion`), as CLAUDE.md's rig notes
 * describe. Never signs out and never opens the Jellyfin pane.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const REPO = path.resolve(here, "..", "..");
const RELEASE = path.join(REPO, "src-tauri", "target", "release");
const EXE = path.join(RELEASE, "karasu.exe");
const MARKER = path.join(RELEASE, "karasu.portable");
const OUT = path.resolve(here, "..", "captures", "desktop");
const CDP = "http://127.0.0.1:9222";
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const [cmd, ...args] = process.argv.slice(2);

async function connect() {
  const browser = await chromium.connectOverCDP(CDP);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => p.url().startsWith("http://tauri.localhost")) ?? pages[0];
  if (!page) throw new Error("capture: the rig has no page; is it running with --remote-debugging-port=9222?");
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
  return { browser, page, session };
}

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => document.documentElement.setAttribute("data-reduce-motion", ""));
  await page.waitForTimeout(900);
}

switch (cmd) {
  case "launch": {
    if (!existsSync(EXE)) throw new Error(`capture: no exe at ${EXE}`);
    if (!existsSync(MARKER)) throw new Error(`capture: no karasu.portable beside the exe — the rig would use the real data dir`);
    const child = spawn(EXE, [], {
      cwd: RELEASE,
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9222" },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    console.log(`capture: rig launched (pid ${child.pid}); data under ${path.join(RELEASE, "data")}`);
    break;
  }
  case "go": {
    const { browser, page } = await connect();
    await page.evaluate((to) => {
      location.hash = to.startsWith("#") ? to : `#${to}`;
    }, args[0]);
    await page.waitForTimeout(600);
    console.log(page.url());
    await browser.close();
    break;
  }
  case "shot": {
    mkdirSync(OUT, { recursive: true });
    const { browser, page, session } = await connect();
    await settle(page);
    const file = path.join(OUT, `${args[0]}.png`);
    // CDP renders the clip at the requested scale, which is how the still
    // comes out at 2880x1800 whatever the window's own scale factor is.
    const { data } = await session.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: VIEWPORT.deviceScaleFactor },
      captureBeyondViewport: false,
    });
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`capture: ${path.relative(process.cwd(), file)}`);
    await browser.close();
    break;
  }
  case "eval": {
    const { browser, page } = await connect();
    console.log(JSON.stringify(await page.evaluate(args[0])));
    await browser.close();
    break;
  }
  case "click": {
    const { browser, page } = await connect();
    await page.getByText(args[0], { exact: false }).first().click({ timeout: 5000 });
    await page.waitForTimeout(500);
    await browser.close();
    break;
  }
  case "key": {
    const { browser, page } = await connect();
    await page.keyboard.press(args[0]);
    await page.waitForTimeout(500);
    await browser.close();
    break;
  }
  case "store": {
    const { browser, page } = await connect();
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [args[0], args[1]]);
    console.log(`capture: localStorage ${args[0]} set`);
    await browser.close();
    break;
  }
  case "invoke": {
    const { browser, page } = await connect();
    const result = await page.evaluate(
      async ([name, json]) => window.__TAURI_INTERNALS__.invoke(name, json ? JSON.parse(json) : {}),
      [args[0], args[1] ?? ""],
    );
    console.log(JSON.stringify(result).slice(0, 2000));
    await browser.close();
    break;
  }
  case "library": {
    // A folder of empty files with clean release names, one per episode, so
    // the library screenshot shows matched titles rather than release tags.
    const dir = path.resolve(args[0]);
    mkdirSync(dir, { recursive: true });
    const spec = JSON.parse(args[1] ?? "[]"); // [["Title", episodes], …]
    for (const [title, count] of spec) {
      const folder = path.join(dir, title);
      mkdirSync(folder, { recursive: true });
      for (let e = 1; e <= count; e++) {
        const f = path.join(folder, `${title} - ${String(e).padStart(2, "0")}.mkv`);
        if (!existsSync(f)) writeFileSync(f, "");
      }
    }
    console.log(`capture: ${readdirSync(dir).length} title folders under ${dir}`);
    const { browser, page } = await connect();
    await page.evaluate(async (p) => {
      await window.__TAURI_INTERNALS__.invoke("set_library_path", { path: p });
      return window.__TAURI_INTERNALS__.invoke("scan_library");
    }, dir);
    console.log("capture: library set and scanned");
    await browser.close();
    break;
  }
  case "quit": {
    const { browser, page } = await connect();
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("quit_app").catch(() => {}));
    await browser.close().catch(() => {});
    console.log("capture: quit requested");
    break;
  }
  default:
    console.error("capture: unknown command");
    process.exit(1);
}
