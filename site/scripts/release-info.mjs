#!/usr/bin/env node
/**
 * Writes `src/generated/release.json` from the newest non-prerelease GitHub
 * release, so the download buttons name what a visitor can actually get. The
 * committed file is the fallback: without a token (a fork, an offline build)
 * it stays as it is and the build goes on.
 *
 *   GH_TOKEN=… node scripts/release-info.mjs
 *   node scripts/release-info.mjs --anonymous      use the unauthenticated API (60/h)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const OUT = path.resolve(here, "..", "src", "generated", "release.json");
const API = "https://api.github.com/repos/Kyusetzu/Karasu/releases/latest";

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token && !process.argv.includes("--anonymous")) {
  console.log("release-info: no GH_TOKEN, keeping the committed fallback");
  process.exit(0);
}

const headers = { Accept: "application/vnd.github+json", "User-Agent": "karasu-site" };
if (token) headers.Authorization = `Bearer ${token}`;
const res = await fetch(API, { headers });
if (!res.ok) {
  console.error(`release-info: GitHub answered ${res.status}; keeping the committed fallback`);
  process.exit(0);
}
const rel = await res.json();
const find = (re) => rel.assets.find((a) => re.test(a.name))?.browser_download_url;
const version = String(rel.tag_name).replace(/^v/, "");
const windows = find(/_x64-setup\.exe$/);
const commit = Number((windows?.match(/_\d+\.\d+\.\d+\.(\d+)_/) ?? [])[1] ?? NaN);
const info = {
  tag: rel.tag_name,
  version,
  commit: Number.isFinite(commit) ? commit : null,
  publishedAt: String(rel.published_at).slice(0, 10),
  url: rel.html_url,
  assets: {
    windows,
    linux: find(/\.AppImage$/),
    androidArm64: find(/_arm64\.apk$/),
    androidUniversal: find(/_universal\.apk$/),
    sums: find(/^SHA256SUMS\.txt$/),
  },
};
for (const [k, v] of Object.entries(info.assets)) {
  if (!v) {
    console.error(`release-info: release ${rel.tag_name} has no ${k} asset; keeping the committed fallback`);
    process.exit(0);
  }
}
const before = readFileSync(OUT, "utf8");
const after = `${JSON.stringify(info, null, 2)}\n`;
writeFileSync(OUT, after);
console.log(`release-info: ${rel.tag_name} (${info.publishedAt})${before === after ? ", unchanged" : ""}`);
