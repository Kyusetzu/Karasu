#!/usr/bin/env node
// Reclaims the Cargo target directory's dead weight: incremental sessions and artifacts that no current build reads.
//
//   node scripts/clean-target.mjs            report what would go, delete nothing
//   node scripts/clean-target.mjs --apply    delete it
//   node scripts/clean-target.mjs --apply --keep-days 3
//   node scripts/clean-target.mjs --apply --android   also the cross-compile trees, at the price of a cold Android build
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TARGET = path.resolve(here, "..", "src-tauri", "target");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const keepDays = Number(args[args.indexOf("--keep-days") + 1]) || 1;
const cutoff = Date.now() - keepDays * 86_400_000;

/** Bytes under a directory, walked without following links; slow on a huge tree, which is the point of the report. */
function sizeOf(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += statSync(p).size;
        } catch {
          // A file that vanished mid-walk counts as nothing.
        }
      }
    }
  }
  return total;
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
const victims = [];

// Every version bump mints a fresh incremental session for the crate; the ones older than a day never load again.
for (const profile of ["debug", "release"]) {
  const inc = path.join(TARGET, profile, "incremental");
  let sessions;
  try {
    sessions = readdirSync(inc, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    continue;
  }
  for (const s of sessions) {
    const p = path.join(inc, s.name);
    if (statSync(p).mtimeMs < cutoff) victims.push({ path: p, why: `${profile} incremental session` });
  }
}

// The Android check has its own target dir, and a whole cross-target tree survives every release build it fed.
const androidDirs = args.includes("--android") ? ["android-check", "aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android"] : [];
for (const dir of androidDirs) {
  const p = path.join(TARGET, dir);
  try {
    if (statSync(p).isDirectory()) victims.push({ path: p, why: "cross-compile tree, rebuilt by the next Android build" });
  } catch {
    // Absent is the state this script leaves behind.
  }
}

if (victims.length === 0) {
  console.log("clean-target: nothing to reclaim");
  process.exit(0);
}

let total = 0;
const byWhy = new Map();
for (const v of victims) {
  const size = sizeOf(v.path);
  total += size;
  byWhy.set(v.why, (byWhy.get(v.why) ?? 0) + size);
}
for (const [why, size] of byWhy) console.log(`  ${gb(size).padStart(9)}  ${why}`);
console.log(`clean-target: ${victims.length} item(s), ${gb(total)}${apply ? "" : " — pass --apply to delete"}`);

if (apply) {
  for (const v of victims) rmSync(v.path, { recursive: true, force: true });
  console.log(`clean-target: reclaimed ${gb(total)}`);
}
