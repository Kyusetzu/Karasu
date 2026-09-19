#!/usr/bin/env node
// The whole gate, as CI runs it: typecheck, the comment audit, then the frontend and the Rust suites side by side.
//
//   node scripts/verify.mjs              everything
//   node scripts/verify.mjs --frontend   typecheck, audit and vitest only
//   node scripts/verify.mjs --rust       cargo test only
import { spawn } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(here, "..");
const flags = new Set(process.argv.slice(2));
const wantFrontend = !flags.has("--rust");
const wantRust = !flags.has("--frontend");
const shell = process.platform === "win32";

const timings = [];

/** Runs one phase with its output either live or buffered until it ends, and records how long it took. */
function run(name, cmd, args, { buffer = false } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      shell,
      stdio: buffer ? ["ignore", "pipe", "pipe"] : "inherit",
      env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" },
    });
    let out = "";
    if (buffer) {
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
    }
    child.on("close", (code) => {
      timings.push({ name, ms: Date.now() - started, ok: code === 0 });
      resolve({ ok: code === 0, out });
    });
  });
}

function report() {
  const width = Math.max(...timings.map((t) => t.name.length));
  console.log("\nverify:");
  for (const t of timings) {
    console.log(`  ${t.ok ? "ok  " : "FAIL"} ${t.name.padEnd(width)}  ${(t.ms / 1000).toFixed(1)} s`);
  }
}

function fail() {
  report();
  process.exit(1);
}

if (wantFrontend) {
  // Cheap and first: a type error stops the run before either suite spends its time.
  if (!(await run("typecheck", "npx", ["tsc", "--noEmit"])).ok) fail();
  if (!(await run("comment audit", "node", ["scripts/comment-audit.mjs", "--check"])).ok) fail();
}

// Cargo compiles while vitest runs; its output is held back so the two do not interleave, and printed once it ends.
const rust = wantRust
  ? run("cargo test", "cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"], { buffer: true })
  : Promise.resolve({ ok: true, out: "" });
const front = wantFrontend ? run("vitest", "npx", ["vitest", "run"]) : Promise.resolve({ ok: true, out: "" });

const [rustResult, frontResult] = await Promise.all([rust, front]);
if (rustResult.out) process.stdout.write(rustResult.out.endsWith("\n") ? rustResult.out : rustResult.out + "\n");
if (!rustResult.ok || !frontResult.ok) fail();
report();
