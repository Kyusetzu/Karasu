#!/usr/bin/env node
// Proves a change touched only comments: strips them from the base version and the working copy and compares the rest.
//
//   node scripts/comment-strip-check.mjs                 every in-scope file changed against HEAD
//   node scripts/comment-strip-check.mjs --base <ref>    against another commit
//   node scripts/comment-strip-check.mjs -- a b c        only these paths
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inScope, langFor, stripComments } from "./comment-lexer.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BOM = "\uFEFF";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function changedFiles(base) {
  const changed = git(["diff", "--name-only", "-z", base, "--"]).split("\0");
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0");
  return [...new Set([...changed, ...untracked])].filter((p) => p && inScope(p) && langFor(p));
}

function baseText(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
  } catch {
    return null;
  }
}

/** Comment-free lines, EOL-normalised, trailing whitespace trimmed, blank lines dropped. */
function normalise(text, lang) {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  return stripComments(body, lang)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l !== "");
}

function main() {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf("--base");
  const base = baseAt === -1 ? "HEAD" : args[baseAt + 1];
  const sep = args.indexOf("--");
  const files = sep === -1 ? changedFiles(base) : args.slice(sep + 1).map((p) => p.replace(/\\/g, "/"));
  let failed = 0;
  let fresh = 0;
  for (const path of files) {
    const lang = langFor(path);
    const before = baseText(base, path);
    if (!existsSync(join(ROOT, path))) {
      console.log(`${path}: deleted`);
      failed++;
      continue;
    }
    const after = readFileSync(join(ROOT, path), "utf8");
    if (before === null) {
      console.log(`${path}: new file, nothing to compare against`);
      fresh++;
      continue;
    }
    if (before.startsWith(BOM) !== after.startsWith(BOM)) {
      console.log(`${path}: byte-order mark ${after.startsWith(BOM) ? "appeared" : "vanished"}`);
      failed++;
    }
    const a = normalise(before, lang);
    const b = normalise(after, lang);
    let diff = -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        diff = i;
        break;
      }
    }
    if (diff !== -1) {
      failed++;
      console.log(`${path}: code differs at stripped line ${diff + 1}`);
      console.log(`  base: ${a[diff] ?? "<end>"}`);
      console.log(`  work: ${b[diff] ?? "<end>"}`);
    }
  }
  console.log(`comment-strip-check: ${files.length} file(s) against ${base}, ${failed} with code changes, ${fresh} new`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
