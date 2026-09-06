#!/usr/bin/env node
/**
 * The last step of `npm run build`: fails the build for the mistakes a static
 * site on a sub-path makes silently. Every rooted URL must carry the base
 * path, nothing may load from another origin, every internal file must exist,
 * the pre-rendered HTML must actually contain the page, and the shipped bytes
 * must stay inside their budgets.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLIENT = path.resolve(here, "..", "dist", "client");
const BASE = "/Karasu/";
const SITE_URL = "https://kyusetzu.github.io/Karasu/";
const JS_BUDGET_GZ = 100 * 1024;
// Per format: AVIF is what every current browser downloads and carries the
// 2x files; WebP and JPEG exist at 1x for the browsers that cannot.
const IMAGE_BUDGET = { avif: 250 * 1024, webp: 300 * 1024, jpg: 300 * 1024, jpeg: 300 * 1024, png: 250 * 1024 };

const failures = [];
const fail = (msg) => failures.push(msg);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(CLIENT);
const rel = (p) => path.relative(CLIENT, p).replace(/\\/g, "/");

for (const page of ["index.html", "404.html"]) {
  const file = path.join(CLIENT, page);
  if (!existsSync(file)) {
    fail(`${page} is missing`);
    continue;
  }
  const html = readFileSync(file, "utf8");
  if (html.includes("<!--app-")) fail(`${page}: a prerender placeholder survived`);
  if (!/<h1[\s>]/.test(html)) fail(`${page}: no <h1> in the pre-rendered markup`);
  if (!/<title>[^<]+<\/title>/.test(html)) fail(`${page}: no <title>`);

  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (url.startsWith("#") || url.startsWith("mailto:")) continue;
    if (/^https?:\/\//.test(url)) {
      if (url.startsWith(SITE_URL)) {
        const local = url.slice(SITE_URL.length);
        if (local && !local.startsWith("#") && !existsSync(path.join(CLIENT, local))) {
          fail(`${page}: absolute self link to a file that does not exist: ${url}`);
        }
      }
      continue; // external links are allowed; external *scripts/styles* are checked below
    }
    if (url.startsWith("/")) {
      if (!url.startsWith(BASE)) fail(`${page}: rooted URL without the base path: ${url}`);
      else {
        const local = url.slice(BASE.length).split(/[?#]/)[0];
        if (local && !existsSync(path.join(CLIENT, local))) fail(`${page}: ${url} does not exist in dist`);
      }
    }
  }
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    if (/^(https?:)?\/\//.test(m[1]) && !m[1].startsWith(SITE_URL)) fail(`${page}: external script ${m[1]}`);
  }
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) {
    if (/^(https?:)?\/\//.test(m[1]) && !m[1].startsWith(SITE_URL) && !/rel="canonical"/.test(m[0])) {
      fail(`${page}: external stylesheet or resource hint ${m[1]}`);
    }
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(m[0])) fail(`${page}: <img> without alt: ${m[0].slice(0, 80)}`);
    if (!/\bwidth=/.test(m[0]) || !/\bheight=/.test(m[0])) fail(`${page}: <img> without width/height: ${m[0].slice(0, 80)}`);
  }
}

// Budgets. The JavaScript budget is for what the page loads before it can
// run: the entry and every chunk it preloads. Chunks fetched on demand (the
// hero's `motion`) are listed but not counted.
const indexHtml = readFileSync(path.join(CLIENT, "index.html"), "utf8");
const initial = new Set(
  [...indexHtml.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="([^"]+)"/g)].map((m) =>
    m[1].replace(BASE, ""),
  ),
);
let jsGz = 0;
let lazyGz = 0;
const rows = [];
for (const f of files) {
  const size = statSync(f).size;
  const name = rel(f);
  if (name.endsWith(".js")) {
    const gz = gzipSync(readFileSync(f)).length;
    if (initial.has(name)) jsGz += gz;
    else lazyGz += gz;
    rows.push([name + (initial.has(name) ? "" : "  (lazy)"), size, gz]);
  } else if (/\.(css)$/.test(name)) {
    rows.push([name, size, gzipSync(readFileSync(f)).length]);
  } else if (/\.(avif|webp|jpe?g|png)$/.test(name)) {
    rows.push([name, size, null]);
    const budget = IMAGE_BUDGET[name.split(".").pop()];
    if (size > budget) fail(`${name} is ${(size / 1024).toFixed(0)} kB, over the ${budget / 1024} kB budget for its format`);
  }
}
for (const [name, size, gz] of rows.sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`${String(size).padStart(9)} B${gz === null ? "" : `  ${String(gz).padStart(7)} gz`}  ${name}`);
}
console.log(`JavaScript, gzipped: ${(jsGz / 1024).toFixed(1)} kB initial (budget ${JS_BUDGET_GZ / 1024} kB) + ${(lazyGz / 1024).toFixed(1)} kB on demand`);
if (jsGz > JS_BUDGET_GZ) fail(`JavaScript over budget: ${(jsGz / 1024).toFixed(1)} kB gzipped`);

for (const required of ["robots.txt", "sitemap.xml", ".nojekyll", "404.html"]) {
  if (!existsSync(path.join(CLIENT, required))) fail(`${required} is missing from dist`);
}

if (failures.length) {
  console.error(`\nverify-dist: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-dist: ok");
