#!/usr/bin/env node
/**
 * Bumps the version everywhere Karasu keeps one, in a single step.
 *
 *   node scripts/bump-version.mjs patch     0.28.9.109 -> 0.28.10.110
 *   node scripts/bump-version.mjs minor     0.28.9.109 -> 0.29.0.110
 *   node scripts/bump-version.mjs major     0.28.9.109 -> 1.0.0.110
 *   node scripts/bump-version.mjs --print   report the version, change nothing
 *
 * The scheme is MAJOR.MINOR.PATCH.COMMIT# (see CLAUDE.md). The semver core
 * lives in three manifests, the commit counter in commands/update.rs, and
 * Cargo.lock
 * carries a copy of the core that cargo would otherwise only fix up on its next
 * run — five edits that used to be made by hand on every single commit.
 *
 * Files are patched by targeted replacement rather than parse-and-stringify:
 * round-tripping package.json through JSON.stringify would reformat a file
 * nobody asked to reformat. Every replacement is asserted to have matched and
 * to have changed something, because the failure that actually hurts is a
 * silent no-op that leaves the manifests disagreeing.
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
// The counter sits with the updater, which is the only thing that reads it
// at runtime — see `version_comparator` there.
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

/**
 * Computes one replacement, refusing to pass off a miss or a no-op as success.
 * Returns the write rather than performing it — see `writeAll` below.
 *
 * `replacement` is a function of the match and its groups, never a string —
 * a string would make `$1` and friends live, which is a trap when the thing
 * being substituted in is arbitrary file content.
 */
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

/**
 * Writes every planned change, or none of them.
 *
 * The version lives in five places and they have to agree. Writing each one as
 * soon as it was computed meant a miss in the fourth — Cargo.lock mid-merge, so
 * the anchored `name = "karasu"\nversion =` pattern does not match — left the
 * first three bumped and `COMMIT_NUMBER` behind. Nothing in `npm run verify`
 * compares the five, so that mismatch commits silently, and the release ships a
 * manifest whose commit number repeats the previous one: the exact thing the
 * four-part scheme exists to keep monotonic.
 *
 * Every check now runs before any write, and a write that fails mid-sequence
 * restores what has already been written.
 */
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
        // Restoring failed too — say which file is left inconsistent rather
        // than reporting only the original error.
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

/**
 * Refuses a bump that would stand on its own.
 *
 * A version bump describes an accompanying change; on its own it is always
 * either a mistake or a double-run. Bumping before editing is legitimate but
 * unusual, hence --force rather than a prompt.
 */
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

/**
 * Checks that every place the version lives already agrees, and changes
 * nothing.
 *
 * The four-part scheme is spread over five files and only this script ever
 * writes all of them at once — so a hand-edit, a bad merge or an interrupted
 * bump can leave them disagreeing, and nothing said so. That is not cosmetic:
 * `latest.json` is built from `package.json` plus `COMMIT_NUMBER`, while the
 * running app compares against the `COMMIT_NUMBER` compiled into it. If the
 * two ever describe different builds, every install downloads and reinstalls
 * an update it already has, on a loop, and only a new release stops it.
 *
 * Run in CI before a release is published, and cheap enough to run by hand.
 */
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

// Every replacement is computed and checked first; `writeAll` then writes them
// all, so a pattern that misses cannot leave the five files disagreeing.
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
