#!/usr/bin/env node
// The whole gate, as CI runs it: typecheck, the comment audit, then the frontend and the Rust suites side by side.
//
//   node scripts/verify.mjs              everything; one line per phase, the full log only for a phase that failed
//   node scripts/verify.mjs --frontend   typecheck, audit and vitest only
//   node scripts/verify.mjs --rust       cargo test only
//   node scripts/verify.mjs --verbose    every phase's output as it runs, as the tools print it themselves
import { spawn } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(here, "..");
const flags = new Set(process.argv.slice(2));
const wantFrontend = !flags.has("--rust");
const wantRust = !flags.has("--frontend");
const verbose = flags.has("--verbose");
// The JS tools by their entry files under node itself: no `.cmd` shim to find, so no shell and nothing to escape.
const node = process.execPath;
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const OXLINT = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");

const phases = [];

/** Runs one phase, captures its output unless verbose, and keeps what the summary needs. */
function run(name, cmd, args, summarize) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    let out = "";
    if (!verbose) {
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
    }
    child.on("close", (code) => {
      const phase = { name, ms: Date.now() - started, ok: code === 0, out, summary: summarize(out) };
      phases.push(phase);
      resolve(phase);
    });
  });
}

const lines = (out) => out.split(/\r?\n/);
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, "").trim();

/** vitest's three closing lines, with the timing breakdown dropped; a failure prints the whole log anyway. */
function summarizeVitest(out) {
  const tail = lines(out)
    .map(strip)
    .filter((l) => /^(Test Files|Tests|Duration)\s/.test(l))
    .map((l) => l.replace(/\s+/g, " ").replace(/ \(transform.*$/, ""));
  return tail.join(" · ") || "(no summary line found)";
}

/** Cargo's result lines, plus every compiler warning, which a green suite would otherwise hide. */
function summarizeCargo(out) {
  const all = lines(out).map(strip);
  const results = all.filter((l) => l.startsWith("test result:"));
  const passed = results.reduce((n, l) => n + Number(/(\d+) passed/.exec(l)?.[1] ?? 0), 0);
  const failed = results.reduce((n, l) => n + Number(/(\d+) failed/.exec(l)?.[1] ?? 0), 0);
  const ignored = results.reduce((n, l) => n + Number(/(\d+) ignored/.exec(l)?.[1] ?? 0), 0);
  const warnings = all.filter((l) => /^warning: /.test(l) && !/generated \d+ warning/.test(l));
  const head = `${passed} passed, ${failed} failed, ${ignored} ignored`;
  return warnings.length ? `${head} · ${warnings.length} compiler warning(s):\n      ${warnings.join("\n      ")}` : head;
}

/** oxlint prints one `file:line:col: level rule(...)` line per finding and nothing else without colour. */
const summarizeLint = (out) => {
  const n = lines(out).filter((l) => /^\S+:\d+:\d+: (error|warning) /.test(strip(l))).length;
  return n ? `${n} finding(s)` : "clean";
};
const summarizeTsc = (out) => (strip(out) ? `${lines(out).filter((l) => /error TS/.test(l)).length} error(s)` : "clean");
const summarizeAudit = (out) => {
  const last = strip(out).split("\n").at(-1)?.replace(/^comment-audit: /, "") ?? "";
  const files = /in (\d+) file\(s\)/.exec(last)?.[1];
  const clean = /^0 multi-line block\(s\), 0 over 120 chars, 0 mojibake, 0 desync, 0 stale/.test(last);
  return clean ? `clean (${files} files)` : last;
};

/** The part of a failed phase's log that names what failed: vitest's and cargo's failure sections, else everything. */
function failureExcerpt(out) {
  const all = lines(out);
  const start = all.findIndex((l) => /Failed (Tests|Suites)|^failures:$/.test(strip(l)));
  if (start === -1) return out;
  // Passing files above the section are the same lines the summary already counted.
  return all.slice(start).join("\n");
}

function report() {
  const width = Math.max(...phases.map((p) => p.name.length));
  for (const p of phases) {
    console.log(`${p.ok ? "ok  " : "FAIL"} ${p.name.padEnd(width)}  ${(p.ms / 1000).toFixed(1).padStart(5)} s  ${p.summary}`);
  }
  const failed = phases.filter((p) => !p.ok);
  for (const p of failed) {
    if (verbose) continue;
    const excerpt = failureExcerpt(p.out);
    console.log(`\n--- ${p.name}: ${excerpt === p.out ? "full output" : "the failures"} ---`);
    process.stdout.write(excerpt.endsWith("\n") ? excerpt : excerpt + "\n");
  }
  if (failed.length) {
    console.log(`\nverify: ${failed.map((p) => p.name).join(", ")} failed`);
    process.exit(1);
  }
  const total = phases.reduce((n, p) => n + p.ms, 0);
  console.log(`verify: green in ${(total / 1000).toFixed(1)} s of work`);
}

if (wantFrontend) {
  // Cheap and first: a type error stops the run before either suite spends its time.
  if (!(await run("typecheck", node, [TSC, "--noEmit"], summarizeTsc)).ok) report();
  if (!(await run("comment audit", node, ["scripts/comment-audit.mjs", "--check"], summarizeAudit)).ok) report();
  if (!(await run("oxlint", node, [OXLINT, "--deny-warnings"], summarizeLint)).ok) report();
}

// Cargo compiles while vitest runs; both are captured, so the two never interleave and a green run prints two lines.
await Promise.all([
  wantRust && run("cargo test", "cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"], summarizeCargo),
  wantFrontend && run("vitest", node, [VITEST, "run", "--reporter=default"], summarizeVitest),
]);
report();
