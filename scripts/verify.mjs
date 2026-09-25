#!/usr/bin/env node
// The gate before a commit, and with --full the whole of it before a push: every check the repository owns, in one run.
//
//   node scripts/verify.mjs              the commit gate; one line per phase, the full log only for a phase that failed
//   node scripts/verify.mjs --full       the push gate: the commit gate, then clippy, cargo-deny, knip, machete, the
//                                        version files, the site, the bundle budget, the Android check, a release
//                                        build, a clean tree
//   node scripts/verify.mjs --frontend   typecheck, audits, lints and vitest only
//   node scripts/verify.mjs --rust       cargo test only
//   node scripts/verify.mjs --verbose    every phase's output as it runs, as the tools print it themselves
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(here, "..");
const flags = new Set(process.argv.slice(2));
const wantFrontend = !flags.has("--rust");
const wantRust = !flags.has("--frontend");
const verbose = flags.has("--verbose");
const full = flags.has("--full");
// The JS tools by their entry files under node itself: no `.cmd` shim to find, so no shell and nothing to escape.
const node = process.execPath;
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
const VITEST = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const OXLINT = path.join(ROOT, "node_modules", "oxlint", "bin", "oxlint");
const KNIP = path.join(ROOT, "node_modules", "knip", "bin", "knip.js");
const TAURI = path.join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
const SITE_TSC = path.join(ROOT, "site", "node_modules", "typescript", "bin", "tsc");
const MANIFEST = ["--manifest-path", "src-tauri/Cargo.toml"];
// npm itself, by its cli file, for the same no-shim reason: beside node on Windows, under `lib/` of the prefix elsewhere.
const NPM = [
  path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
].find((file) => existsSync(file)) ?? "npm-cli.js";

const phases = [];

/** Runs one phase, captures its output unless verbose, and keeps what the summary needs. */
function run(name, cmd, args, summarize, { optional, cwd = ROOT, env = {} } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
    });
    let out = "";
    if (!verbose) {
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
    }
    // A tool that is not installed is a visible skip for an optional phase and a failure for the rest.
    let settled = false;
    child.on("error", (err) => {
      settled = true;
      const missing = err.code === "ENOENT";
      const phase = { name, ms: Date.now() - started, ok: missing && Boolean(optional), skipped: missing, out: String(err), summary: missing ? `skipped — not installed (${optional ?? cmd})` : String(err) };
      phases.push(phase);
      resolve(phase);
    });
    child.on("close", (code) => {
      if (settled) return;
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
/** typos prints only findings, one `path:line:col: error:` line each, with `--format brief`. */
const summarizeTypos = (out) => {
  const n = lines(out).filter((l) => /: error: /.test(l)).length;
  return n ? `${n} finding(s)` : "clean";
};
const summarizeToml = (out) => lines(strip(out)).at(-1)?.replace(/^toml-check: /, "") ?? "";
/** `git diff --numstat` prints `added deleted path` for a changed file and nothing for an unchanged one. */
const summarizeBindings = (out) => {
  const m = /^(\d+)\s+(\d+)\s/.exec(strip(out));
  return m ? `regenerated, +${m[1]} -${m[2]} lines to commit` : "unchanged";
};
/** The style audit's closing line: `clean (N files, M baselined)`, or what rose. */
const summarizeStyle = (out) => lines(strip(out)).at(-1)?.replace(/^style-audit: /, "") ?? "";
const summarizeAudit = (out) => {
  const last = strip(out).split("\n").at(-1)?.replace(/^comment-audit: /, "") ?? "";
  const files = /in (\d+) file\(s\)/.exec(last)?.[1];
  const clean = /^0 multi-line block\(s\), 0 over 120 chars, 0 mojibake, 0 desync, 0 stale/.test(last);
  return clean ? `clean (${files} files)` : last;
};

/** Clippy's and cargo-deny's own closing lines; a clean clippy prints nothing but `Finished`. */
const summarizeClippy = (out) => {
  const n = lines(out).filter((l) => /^(warning|error)(\[|:)/.test(strip(l)) && !/generated \d+ warning/.test(l)).length;
  return n ? `${n} finding(s)` : "clean";
};
const summarizeDeny = (out) => lines(strip(out)).findLast((l) => /(advisories|bans|licenses|sources) (ok|FAILED)/.test(l)) ?? "(no summary line found)";
/** knip is silent when clean; otherwise every section heading carries its count. */
const summarizeKnip = (out) => {
  const counts = [...strip(out).matchAll(/^([A-Za-z ]+) \((\d+)\)$/gm)].map((m) => `${m[2]} ${m[1].toLowerCase()}`);
  return counts.length ? counts.join(", ") : "clean";
};
const summarizeMachete = (out) => (/didn't find any unused/.test(out) ? "clean" : "unused dependencies found");
const summarizeVersions = (out) => lines(strip(out)).at(-1)?.replace(/^bump-version: /, "") ?? "";
const summarizeSite = (out) => (strip(out).includes("up to date") ? "up to date" : lines(strip(out)).at(-1) ?? "");
const summarizeCheck = (out) => {
  const warnings = lines(out).map(strip).filter((l) => /^warning: /.test(l) && !/generated \d+ warning/.test(l));
  return warnings.length ? `${warnings.length} compiler warning(s)` : "clean";
};
/** The bundle build: how many bundles, plus every rustc warning, which `cargo test` cannot see (see CLAUDE.md). */
const summarizeBuild = (out) => {
  const all = lines(out).map(strip);
  const bundles = /Finished (\d+) bundles? at/.exec(all.join("\n"))?.[1];
  const warnings = all.filter((l) => /^warning: /.test(l) && !/generated \d+ warning/.test(l));
  const head = bundles ? `${bundles} bundle(s)` : "no bundle line found";
  return warnings.length ? `${head} · ${warnings.length} compiler warning(s):\n      ${warnings.join("\n      ")}` : head;
};
/** The budget's one line: each figure against its limit, or which one went over. */
const summarizeBudget = (out) => lines(strip(out)).at(-1)?.replace(/^bundle-budget: /, "") ?? "";
const summarizeTree = (out) => (strip(out) ? `${lines(strip(out)).length} uncommitted path(s)` : "clean");
const summarizeAudit2 = (out) => {
  const m = /found (\d+) vulnerabilit/.exec(out);
  return m ? (m[1] === "0" ? "clean" : `${m[1]} vulnerability(ies)`) : lines(strip(out)).at(-1) ?? "";
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
    const mark = p.skipped ? "skip" : p.ok ? "ok  " : "FAIL";
    console.log(`${mark} ${p.name.padEnd(width)}  ${(p.ms / 1000).toFixed(1).padStart(5)} s  ${p.summary}`);
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
  console.log(`verify: green in ${(total / 1000).toFixed(1)} s of work${full ? " — ready to push" : ""}`);
}

if (wantFrontend) {
  // Cheap and first: a type error stops the run before either suite spends its time.
  if (!(await run("typecheck", node, [TSC, "--noEmit"], summarizeTsc)).ok) report();
  if (!(await run("comment audit", node, ["scripts/comment-audit.mjs", "--check"], summarizeAudit)).ok) report();
  if (!(await run("style audit", node, ["scripts/style-audit.mjs", "--check"], summarizeStyle)).ok) report();
  if (!(await run("typos", "typos", ["--format", "brief"], summarizeTypos, { optional: "cargo install typos-cli" })).ok) report();
  if (!(await run("toml", node, ["scripts/toml-check.mjs"], summarizeToml)).ok) report();
  if (!(await run("oxlint", node, [OXLINT, "--deny-warnings"], summarizeLint)).ok) report();
}

// Cargo compiles while vitest runs; both are captured, so the two never interleave and a green run prints two lines.
await Promise.all([
  wantRust && run("cargo test", "cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"], summarizeCargo),
  wantFrontend && run("vitest", node, [VITEST, "run", "--reporter=default"], summarizeVitest),
]);
// `cargo test` just rewrote the bindings; a diff is a commit's business here and, in CI or before a push, a stale copy.
if (wantRust) {
  const phase = await run("bindings", "git", ["diff", "--numstat", "--", "src/api/bindings.ts"], summarizeBindings);
  if ((process.env.GITHUB_ACTIONS || full) && phase.summary !== "unchanged") {
    phase.ok = false;
    phase.out = "src/api/bindings.ts is stale: run `cargo test` and commit the regenerated file";
  }
}
if (!full) {
  report();
  process.exit(0);
}

// --- The push gate: everything else the repository can check, cheap and independent first, the builds last. ---------
if (phases.some((p) => !p.ok)) report();
await Promise.all([
  run("knip", node, [KNIP], summarizeKnip),
  run("versions", node, ["scripts/bump-version.mjs", "--check"], summarizeVersions),
  run("site", node, [SITE_TSC, "--noEmit"], () => "typecheck clean", { cwd: path.join(ROOT, "site") }),
  run("site tokens", node, ["scripts/sync-tokens.mjs", "--check"], summarizeSite, { cwd: path.join(ROOT, "site") }),
  run("npm audit", node, [NPM, "audit", "--audit-level=high", "--omit=dev"], summarizeAudit2),
  run("bundle budget", node, ["scripts/bundle-budget.mjs"], summarizeBudget),
]);
// The three cargo tools share the target directory's lock, so they run one after another.
await run("clippy", "cargo", ["clippy", ...MANIFEST, "--all-targets", "--", "-D", "warnings"], summarizeClippy);
await run("cargo deny", "cargo", ["deny", ...MANIFEST, "check"], summarizeDeny, { optional: "cargo install cargo-deny" });
await run("machete", "cargo", ["machete", "--with-metadata", "src-tauri"], summarizeMachete, { optional: "cargo install cargo-machete" });
if (phases.some((p) => !p.ok)) report();
// The two builds: a cargo check for aarch64 with the NDK exported (Windows only), then the desktop bundle.
if (process.platform === "win32") {
  await run("android check", "powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/android-check.ps1"], summarizeCheck);
} else {
  phases.push({ name: "android check", ms: 0, ok: true, skipped: true, out: "", summary: "skipped — scripts/android-check.ps1 is Windows only; CI's android job is the check elsewhere" });
}
await run("tauri build", node, [TAURI, "build"], summarizeBuild);
// Last, so the builds above cannot have dirtied it: nothing uncommitted may ride along with a push.
await run("clean tree", "git", ["status", "--porcelain"], summarizeTree).then((p) => {
  if (p.summary !== "clean") p.ok = false;
});
report();
