#!/usr/bin/env node
// Runs cargo-mutants over the files whose tests matter most, in a copy of src-tauri that tauri-build can still configure.
//
//   node scripts/mutants.mjs                       scrobbler.rs and db.rs, four jobs, report under src-tauri/mutants.out
//   node scripts/mutants.mjs -f src/library.rs     any cargo-mutants arguments replace the defaults
import { spawnSync } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(here, "..");
const extra = process.argv.slice(2);
const args = extra.length ? extra : ["-f", "src/playback/scrobbler.rs", "-f", "src/db.rs", "--jobs", "4"];

// The copy holds src-tauri alone, so the bundled `../THIRD-PARTY-NOTICES.md` is missing; the override drops that resource.
const env = { ...process.env, TAURI_CONFIG: JSON.stringify({ bundle: { resources: [] } }) };
const result = spawnSync("cargo", ["mutants", "-d", "src-tauri", ...args], { cwd: ROOT, stdio: "inherit", env });
process.exit(result.status ?? 1);
