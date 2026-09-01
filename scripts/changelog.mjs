#!/usr/bin/env node
/**
 * Keeps `CHANGELOG.md`'s `## Unreleased` section current from the commits.
 *
 * The file's own header used to say the section was written by hand at tag
 * time. That is a chore that gets skipped under pressure, and skipping it
 * silently is worse than not doing it — a half-written changelog reads as
 * complete. So it is generated, incrementally, and nobody writes it by hand.
 *
 * **What makes the output readable is the commit subjects.** This repository
 * writes them as prose, deliberately ("Let five minutes of watching lift the
 * episode gap"), which is already most of a changelog line. A conventional-
 * commits parser would have nothing to work with here and would have meant
 * changing how every commit is written; this reads what is already there.
 *
 * A commit can say it better than its subject does, with a trailer:
 *
 *     Changelog: Fixed: A declined update no longer re-downloads every day.
 *     Changelog: A declined update no longer re-downloads every day.
 *     Changelog: skip
 *
 * The group is optional and defaults to `Changed`; `skip` leaves the commit
 * out. Without a trailer the subject is used and the group is guessed from it
 * — a heuristic, marked as one below, and the trailer is how you overrule it.
 *
 * **Incremental, never destructive.** It records how far it has read in an
 * HTML comment and only appends past that point, so entries already in the
 * file survive untouched and re-running is a no-op.
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

/**
 * Field and record separators for `git log --format`.
 *
 * Written as escapes rather than typed literally, and that is not fussiness:
 * an editing tool emitting a raw control byte here produces a file that reads
 * back looking correct while every later exact-match edit on the line fails.
 * CLAUDE.md records the afternoon that cost. Verify with a byte-class grep
 * (`grep -cP '[\x00-\x08\x0b\x0c\x0e-\x1f]' scripts/changelog.mjs`), which
 * must print 0 — and note that a literal one cannot be written *here* either.
 */
const FS = "\u0001";
const RS = "\u0002";

/**
 * The places `bump-version.mjs` writes. A commit touching only these describes
 * no change to anyone using the app.
 */
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
  /^(\.github\/|scripts\/|docs?\/|CLAUDE\.md|ROADMAP\.md|CONTRIBUTING\.md|CHANGELOG\.md|README\.md|SECURITY\.md|THIRD-PARTY-NOTICES\.md|\.gitignore)/;

const GROUPS = ["Added", "Changed", "Fixed", "Removed", "Security"];

/**
 * Which group a subject belongs to, when no trailer said.
 *
 * Deliberately a shy heuristic: anything it is not confident about lands in
 * `Changed`, the honest default for a sentence that only says something moved.
 * Overrule it with a `Changelog:` trailer rather than teaching it more words —
 * a longer keyword list is just a worse version of the trailer.
 */
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
      // No trailer: fall back to the subject, but only for a commit that
      // changed something a user of the app could notice.
      const files = git("show", "--name-only", "--format=", sha)
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
      const meaningful = files.filter((f) => !VERSION_FILES.has(f));
      if (meaningful.length === 0) continue;
      if (meaningful.every((f) => INTERNAL_ONLY.test(f))) continue;
      // A squash merge's subject carries its PR number, which means nothing
      // to a reader of the changelog.
      text = subject.replace(/\s*\(#\d+\)\s*$/, "").trim();
      group = guessGroup(text);
    }
    if (!text) continue;
    if (!/[.!?]$/.test(text)) text += ".";
    out.push({ sha: sha.slice(0, 7), group, text });
  }
  return out;
}

/**
 * Inserts each entry at the end of its `### Group`, editing the section in
 * place.
 *
 * Deliberately *not* a re-render of the parsed section. The first version of
 * this rebuilt the whole thing from its buckets, which reordered the existing
 * groups and reflowed every wrapped line — a destructive edit reported as
 * "added 0 entries". Appending into the existing text touches only the lines
 * it adds.
 */
function insert(section, entries, through) {
  let out = section.replace(MARKER, `<!-- generated-through: ${through} -->`);
  for (const e of entries) {
    const heading = `### ${e.group}`;
    const at = out.indexOf(`${heading}\n`);
    const line = `- ${e.text}`;
    if (at === -1) {
      // A group the section does not have yet goes at the end, in the
      // canonical order's spirit rather than its letter: appending is what
      // keeps this edit local.
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

/**
 * `--marker-head`: move the marker to HEAD without generating anything.
 *
 * For the amend. This script runs after a commit, so folding its own edit back
 * into that commit with `--amend` rewrites the sha it just recorded — and the
 * next run then offers the entry a second time, because the marker names a
 * commit that is no longer an ancestor of HEAD. One line beats explaining the
 * hazard and hoping.
 */
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

// A marker naming a commit that no longer exists is routine rather than
// exotic: an amend or a rebase rewrites the sha the previous run recorded.
// Without this the next run died on a raw `git log` usage dump, which says
// nothing about what to do.
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
  // Nothing to say, so nothing is written. The marker is only moved by a run
  // that actually adds something, which keeps a no-op run a true no-op.
  console.log("changelog: already up to date");
  process.exit(0);
}

const updated = file.slice(0, start) + insert(section, entries, head) + file.slice(end);
writeFileSync(FILE, updated);
console.log(
  `changelog: added ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, through ${head}`,
);
