#!/usr/bin/env node
/**
 * Appends the commits since the marker to CHANGELOG.md's Unreleased section; a `Changelog: [Group:] text|skip` trailer overrules the subject.
 *
 *   node scripts/changelog.mjs           # bring the section up to HEAD
 *   node scripts/changelog.mjs --check   # exit 1 if it would change anything
 *   node scripts/changelog.mjs --dry-run # print what it would add
 *   node scripts/changelog.mjs --marker-head # after folding it in with --amend
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "CHANGELOG.md");
const MARKER = /<!-- generated-through: ([0-9a-f]{7,40}) -->/;
const UNRELEASED = "## Unreleased";

/** Separators for `git log --format`, written as escapes: a raw control byte here breaks every later exact-match edit. */
const FS = "\u0001";
const RS = "\u0002";

/** The places `bump-version.mjs` writes; a commit touching only these describes no change to anyone using the app. */
const VERSION_FILES = new Set([
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/commands/update.rs",
]);

/** Paths whose change is real work but not work a user of the app can see. */
const INTERNAL_ONLY =
  /^(\.github\/|scripts\/|site\/|docs?\/|CLAUDE\.md|ROADMAP\.md|CONTRIBUTING\.md|CHANGELOG\.md|README\.md|SECURITY\.md|THIRD-PARTY-NOTICES\.md|\.gitignore)/;

const GROUPS = ["Added", "Changed", "Fixed", "Removed", "Security"];

/** The group of a subject with no trailer; a shy heuristic that defaults to `Changed` rather than learning more words. */
function guessGroup(subject) {
  const s = subject.toLowerCase();
  if (/^(add|introduce|teach|give|offer|bring)\b/.test(s)) return "Added";
  if (/^(remove|delete|drop|stop)\b/.test(s)) return "Removed";
  if (/\b(fix|repair|no longer|correct)\b/.test(s)) return "Fixed";
  return "Changed";
}

const git = (...args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

/** One entry per commit worth mentioning, oldest first. */
function collect(since) {
  const raw = git(
    "log",
    "--no-merges",
    "--reverse",
    `--format=%H${FS}%s${FS}%b${RS}`,
    `${since}..HEAD`,
  );
  const out = [];
  for (const block of raw.split(RS)) {
    if (!block.trim()) continue;
    const [sha, subject, body = ""] = block.replace(/^\n/, "").split(FS);
    if (!sha || !subject) continue;

    const trailer = body.match(/^Changelog:\s*(.+)$/im)?.[1]?.trim();
    if (trailer && /^skip$/i.test(trailer)) continue;

    let group;
    let text;
    if (trailer) {
      const m = trailer.match(/^(Added|Changed|Fixed|Removed|Security)\s*:\s*(.+)$/i);
      if (m) {
        group = GROUPS.find((g) => g.toLowerCase() === m[1].toLowerCase());
        text = m[2].trim();
      } else {
        group = "Changed";
        text = trailer;
      }
    } else {
      // No trailer: use the subject, but only for a commit that changed something a user of the app could notice.
      const files = git("show", "--name-only", "--format=", sha)
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
      const meaningful = files.filter((f) => !VERSION_FILES.has(f));
      if (meaningful.length === 0) continue;
      if (meaningful.every((f) => INTERNAL_ONLY.test(f))) continue;
      // A squash merge's subject carries its PR number, which means nothing to a reader of the changelog.
      text = subject.replace(/\s*\(#\d+\)\s*$/, "").trim();
      group = guessGroup(text);
    }
    if (!text) continue;
    if (!/[.!?]$/.test(text)) text += ".";
    out.push({ sha: sha.slice(0, 7), group, text });
  }
  return out;
}

/** Inserts each entry at the end of its `### Group` in place; a re-render reflowed and reordered what was already there. */
function insert(section, entries, through) {
  let out = section.replace(MARKER, `<!-- generated-through: ${through} -->`);
  for (const e of entries) {
    const heading = `### ${e.group}`;
    const at = out.indexOf(`${heading}\n`);
    const line = `- ${e.text}`;
    if (at === -1) {
      // A group the section does not have yet goes at the end, which keeps this edit local.
      out = `${out.trimEnd()}\n\n${heading}\n\n${line}\n`;
      continue;
    }
    // The end of this group is the next `### ` heading, or the end.
    const nextHeading = out.indexOf("\n### ", at + 1);
    const cut = nextHeading === -1 ? out.length : nextHeading;
    const body = out.slice(at, cut).trimEnd();
    out = `${out.slice(0, at)}${body}\n${line}\n${out.slice(cut).replace(/^\n+/, "\n")}`;
  }
  return out;
}

const args = new Set(process.argv.slice(2));
const file = readFileSync(FILE, "utf8");

/** `--marker-head` moves the marker to HEAD, because an --amend rewrites the sha the last run recorded. */
if (args.has("--marker-head")) {
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const current = file.match(MARKER)?.[1];
  if (!current) {
    console.error("changelog: no marker to move — is the Unreleased section missing one?");
    process.exit(1);
  }
  if (current === head) {
    console.log(`changelog: marker already at ${head}`);
    process.exit(0);
  }
  writeFileSync(FILE, file.replace(MARKER, `<!-- generated-through: ${head} -->`));
  console.log(`changelog: marker moved from ${current} to ${head}`);
  process.exit(0);
}

const start = file.indexOf(`${UNRELEASED}\n`);
if (start === -1) {
  console.error(`changelog: no '${UNRELEASED}' heading in CHANGELOG.md`);
  process.exit(1);
}
const after = file.indexOf("\n## ", start + 1);
const end = after === -1 ? file.length : after + 1;
const section = file.slice(start, end);

const since = section.match(MARKER)?.[1];
if (!since) {
  console.error(
    "changelog: no '<!-- generated-through: <sha> -->' marker in the Unreleased\n" +
      "  section. Add one naming the last commit already described, so the first\n" +
      "  run appends rather than re-listing the whole history.",
  );
  process.exit(1);
}

// An amend or a rebase routinely rewrites the marker's commit, so explain that instead of dying on a raw git usage dump.
try {
  execFileSync("git", ["cat-file", "-e", `${since}^{commit}`], { cwd: ROOT, stdio: "ignore" });
} catch {
  console.error(
    `changelog: the marker names ${since}, which is not a commit in this repository.\n` +
      "  An amend or a rebase rewrote it. Point the marker at a commit that still\n" +
      "  exists and whose changes are already described — usually the one before\n" +
      "  your current work:\n" +
      "    <!-- generated-through: $(git rev-parse --short HEAD~1) -->",
  );
  process.exit(1);
}

const head = git("rev-parse", "HEAD").trim().slice(0, 7);
const entries = collect(since);

if (args.has("--dry-run")) {
  if (entries.length === 0) console.log("changelog: nothing new");
  for (const e of entries) console.log(`  ${e.group.padEnd(8)} ${e.text}  (${e.sha})`);
  process.exit(0);
}

if (args.has("--check")) {
  if (entries.length > 0) {
    console.error(
      `changelog: ${entries.length} commit(s) since ${since} are not described.\n` +
        "  Run: node scripts/changelog.mjs",
    );
    process.exit(1);
  }
  console.log("changelog: up to date");
  process.exit(0);
}

if (entries.length === 0) {
  // The marker moves only when something is added, which keeps a no-op run a true no-op.
  console.log("changelog: already up to date");
  process.exit(0);
}

const updated = file.slice(0, start) + insert(section, entries, head) + file.slice(end);
writeFileSync(FILE, updated);
console.log(
  `changelog: added ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, through ${head}`,
);
