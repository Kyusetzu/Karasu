#!/usr/bin/env node
// Lints and format-checks the TOML files named in taplo.toml through taplo's npm build, one file per stdin.
//
//   node scripts/toml-check.mjs          exit 1 and the file names when one is malformed or not formatted
//   node scripts/toml-check.mjs --fix    rewrite the files taplo would reformat
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(here, "..");
const TAPLO = path.join(ROOT, "node_modules", "@taplo", "cli", "dist", "cli.js");
const fix = process.argv.includes("--fix");

// The WASM build matches its `include` globs against backslash paths on Windows and finds nothing, hence stdin.
const files = [...readFileSync(path.join(ROOT, "taplo.toml"), "utf8").matchAll(/"([^"]+\.toml)"/g)]
  .map((m) => m[1]);

// One WASM start per call costs about a second, so the files run at the same time rather than one after another.
const taplo = (args, input) =>
  new Promise((resolve) => {
    const child = execFile(process.execPath, [TAPLO, ...args], { cwd: ROOT, env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 8 << 20 }, (error, stdout, stderr) =>
      resolve({ status: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin.end(input);
  });

async function check(file) {
  let source;
  try {
    source = readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    // A file the list names ahead of its creation is not a finding.
    return null;
  }
  const lint = await taplo(["lint", "-"], source);
  if (lint.status !== 0) {
    return `${file}: ${lint.stderr.trim().split(/\r?\n/).filter((l) => !/^\s*INFO /.test(l)).join(" ")}`;
  }
  const fmt = await taplo(["fmt", "--stdin-filepath", file, "-"], source);
  if (fmt.status !== 0) return `${file}: ${fmt.stderr.trim()}`;
  if (fmt.stdout === source) return "";
  if (fix) {
    writeFileSync(path.join(ROOT, file), fmt.stdout);
    return "";
  }
  return `${file}: not formatted (node scripts/toml-check.mjs --fix)`;
}

const results = (await Promise.all(files.map(check))).filter((r) => r !== null);
const checked = results.length;
const bad = results.filter(Boolean);

if (bad.length) {
  for (const line of bad) console.log(line);
  console.log(`toml-check: ${bad.length} of ${checked} file(s) failed`);
  process.exit(1);
}
console.log(`toml-check: clean (${checked} files)`);
