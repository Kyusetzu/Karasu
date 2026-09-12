#!/usr/bin/env node
/**
 * Bumps the version in all five places Karasu keeps one, by targeted replacement so no manifest is reformatted.
 *
 *   node scripts/bump-version.mjs patch     0.28.9.109 -> 0.28.10.110
 *   node scripts/bump-version.mjs minor     0.28.9.109 -> 0.29.0.110
 *   node scripts/bump-version.mjs major     0.28.9.109 -> 1.0.0.110
 *   node scripts/bump-version.mjs --print   report the version, change nothing
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PACKAGE_JSON = join(ROOT, "package.json");
const TAURI_CONF = join(ROOT, "src-tauri/tauri.conf.json");
const CARGO_TOML = join(ROOT, "src-tauri/Cargo.toml");
const CARGO_LOCK = join(ROOT, "src-tauri/Cargo.lock");
// The counter sits with the updater, whose `version_comparator` is the only runtime reader.
const COMMANDS_RS = join(ROOT, "src-tauri/src/commands/update.rs");

/** Every path this script writes, for the "did anything else change" guard. */
const VERSION_FILES = [
  PACKAGE_JSON,
  TAURI_CONF,
  CARGO_TOML,
  CARGO_LOCK,
  COMMANDS_RS,
].map((p) => relative(ROOT, p).replaceAll("\\", "/"));

const SEMVER = String.raw`\d+\.\d+\.\d+`;
/** The top-level "version" key — the first one in both JSON files. */
const JSON_VERSION = new RegExp(`"version":\\s*"${SEMVER}"`);
/** Anchored to line start, so inline `{ version = "0.13" }` deps don't match. */
const TOML_VERSION = new RegExp(`^version = "${SEMVER}"`, "m");
const LOCK_VERSION = new RegExp(`(name = "karasu"\\r?\\nversion = )"${SEMVER}"`);
const COMMIT_NUMBER = /COMMIT_NUMBER: u32 = (\d+);/;

function fail(message) {
  console.error(`bump-version: ${message}`);
  process.exit(1);
}

/** Computes one replacement for `writeAll`, refusing a miss or a no-op; `replacement` is a function so `$1` stays inert. */
function plan(path, pattern, replacement) {
  const before = readFileSync(path, "utf8");
  if (!pattern.test(before)) {
    fail(`no ${pattern} in ${relative(ROOT, path)}`);
  }
  const after = before.replace(pattern, replacement);
  if (after === before) {
    fail(`replacing ${pattern} in ${relative(ROOT, path)} changed nothing`);
  }
  return { path, before, after };
}

/** Writes every planned change or none, restoring on a mid-sequence failure so the five files never disagree. */
function writeAll(writes) {
  const done = [];
  try {
    for (const w of writes) {
      writeFileSync(w.path, w.after);
      done.push(w);
    }
  } catch (e) {
    for (const w of done) {
      try {
        writeFileSync(w.path, w.before);
      } catch {
        // Restoring failed too: name the file left inconsistent rather than reporting only the original error.
        console.error(`bump-version: could not restore ${relative(ROOT, w.path)}`);
      }
    }
    fail(`writing ${relative(ROOT, e.path ?? "")} failed: ${e.message}`);
  }
}

function readCurrent() {
  const core = readFileSync(PACKAGE_JSON, "utf8").match(
    new RegExp(`"version":\\s*"(${SEMVER})"`),
  );
  if (!core) fail("could not read the version from package.json");
  const commit = readFileSync(COMMANDS_RS, "utf8").match(COMMIT_NUMBER);
  if (!commit) fail("could not read COMMIT_NUMBER from commands/update.rs");
  return { core: core[1], commit: Number(commit[1]) };
}

/** Refuses a bump with nothing to describe, since that is a mistake or a double-run; --force covers bumping ahead. */
function requireAccompanyingChange() {
  let status;
  try {
    status = execFileSync("git", ["status", "--porcelain"], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch {
    return; // not a git checkout — nothing to guard against
  }
  const changed = status
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .filter((path) => !VERSION_FILES.includes(path));
  if (changed.length === 0) {
    fail(
      "nothing to accompany this bump — the tree holds only version files.\n" +
        "  Make the change first, or pass --force if you meant to bump ahead of it.",
    );
  }
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const parts = args.filter((a) => !a.startsWith("--"));
const current = readCurrent();

if (args.includes("--print")) {
  console.log(`${current.core}.${current.commit}`);
  process.exit(0);
}

/** Checks that the five version files agree, because a mismatch makes every install reinstall its own update on a loop. */
if (args.includes("--check")) {
  const problems = [];
  const cargo = readFileSync(CARGO_TOML, "utf8").match(
    new RegExp(`^version\\s*=\\s*"(${SEMVER})"`, "m"),
  );
  const conf = readFileSync(TAURI_CONF, "utf8").match(
    new RegExp(`"version":\\s*"(${SEMVER})"`),
  );
  if (!cargo) problems.push("could not read the version from Cargo.toml");
  else if (cargo[1] !== current.core)
    problems.push(`Cargo.toml says ${cargo[1]}, package.json says ${current.core}`);
  if (!conf) problems.push("could not read the version from tauri.conf.json");
  else if (conf[1] !== current.core)
    problems.push(`tauri.conf.json says ${conf[1]}, package.json says ${current.core}`);

  const lock = readFileSync(CARGO_LOCK, "utf8");
  if (!lock.includes(`name = "karasu"`) || !new RegExp(`name = "karasu"\\nversion = "${current.core.replace(/\./g, "\\.")}"`).test(lock)) {
    problems.push(`Cargo.lock does not carry ${current.core} for the karasu package`);
  }

  if (problems.length) {
    console.error("Version files disagree:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nAn install built from a mismatched pair re-downloads its own update forever.\n" +
        "Run `node scripts/bump-version.mjs patch --force` to write all five from one source.",
    );
    process.exit(1);
  }
  console.log(`${current.core}.${current.commit} (all five agree)`);
  process.exit(0);
}

const part = parts[0] ?? "patch";
if (!["major", "minor", "patch"].includes(part)) {
  fail(`unknown segment "${part}" — expected major, minor or patch`);
}
if (parts.length > 1) {
  fail(`expected one segment, got: ${parts.join(", ")}`);
}
if (!force) requireAccompanyingChange();

const [major, minor, patchNum] = current.core.split(".").map(Number);
const core =
  part === "major"
    ? `${major + 1}.0.0`
    : part === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patchNum + 1}`;
const commit = current.commit + 1;

// Every replacement is checked before `writeAll` writes any, so a missed pattern cannot leave the five files disagreeing.
writeAll([
  plan(PACKAGE_JSON, JSON_VERSION, () => `"version": "${core}"`),
  plan(TAURI_CONF, JSON_VERSION, () => `"version": "${core}"`),
  plan(CARGO_TOML, TOML_VERSION, () => `version = "${core}"`),
  plan(CARGO_LOCK, LOCK_VERSION, (_match, prefix) => `${prefix}"${core}"`),
  plan(COMMANDS_RS, COMMIT_NUMBER, () => `COMMIT_NUMBER: u32 = ${commit};`),
]);

console.error(
  `${current.core}.${current.commit} -> ${core}.${commit} (${part})`,
);
// stdout carries the version alone, so it can be captured for a commit subject.
console.log(`${core}.${commit}`);
