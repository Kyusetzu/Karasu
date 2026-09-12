#!/usr/bin/env node
// Reports every multi-line comment block and over-long one-liner in the code; `--check` is the gate `npm run verify` runs.
//
//   node scripts/comment-audit.mjs              list the offenders
//   node scripts/comment-audit.mjs --check      exit 1 on any offender outside comment-allowlist.json
//   node scripts/comment-audit.mjs --stats      the per-area table
//   node scripts/comment-audit.mjs --files a b  only these paths
//   node scripts/comment-audit.mjs --selftest   the lexer's own fixtures
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blocks, inScope, langFor, selfTest } from "./comment-lexer.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ALLOWLIST = join(ROOT, "scripts", "comment-allowlist.json");
// A one-liner may hold this many characters of comment text; longer is a paragraph wearing a disguise.
export const HARD_LIMIT = 120;
// Lines past this are counted in --stats so a drift towards the hard limit is visible before it fails.
export const SOFT_LIMIT = 100;
// Doc directly above a plain comment counts as two blocks; flip to merge them into one.
export const MERGE_KINDS = false;
const MOJIBAKE = /\u00C3.|\u00E2\u20AC|\uFFFD/;

/** Tracked and untracked in-scope files, so a new file is audited before it is ever committed. */
export function scopeFiles() {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" });
  return [...new Set([...tracked.split("\0"), ...untracked.split("\0")])].filter((p) => p && inScope(p) && langFor(p));
}

export function areaOf(path) {
  if (path.startsWith("src-tauri/src/")) return "src-tauri/src";
  if (path.startsWith("src-tauri/gen/android/")) return "gen/android";
  if (path.startsWith(".github/workflows/")) return "workflows";
  if (path.startsWith("scripts/")) return "scripts";
  if (path === "src/app/index.css") return "index.css";
  if (path.startsWith("src/")) return "src";
  return "root";
}

/** Everything the audit knows about one file. */
export function auditFile(path) {
  const text = readFileSync(join(ROOT, path), "utf8");
  const lang = langFor(path);
  const { blocks: bs, trailing, desync } = blocks(text, lang);
  const multi = bs.filter((b) => b.length > 1);
  const long = [
    ...bs.filter((b) => b.length === 1 && b.chars > HARD_LIMIT).map((b) => ({ line: b.line, chars: b.chars })),
    ...trailing.filter((t) => t.chars > HARD_LIMIT),
  ];
  const soft = [
    ...bs.filter((b) => b.length === 1 && b.chars > SOFT_LIMIT && b.chars <= HARD_LIMIT),
    ...trailing.filter((t) => t.chars > SOFT_LIMIT && t.chars <= HARD_LIMIT),
  ].length;
  const mojibake = bs
    .flatMap((b) => b.tokens)
    .filter((t) => MOJIBAKE.test(t.text))
    .map((t) => t.line);
  return { path, lang, blocks: bs, multi, long, soft, mojibake, desync };
}

export function loadAllowlist() {
  return JSON.parse(readFileSync(ALLOWLIST, "utf8"));
}

function allowed(entry, path, block) {
  return entry.file === path && block.firstLine.startsWith(entry.startsWith);
}

function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  if (has("--selftest")) {
    const failures = selfTest();
    for (const f of failures) console.error(`lexer: ${f.lang} ${f.desync ? "(desync) " : ""}got ${JSON.stringify(f.got)} want ${JSON.stringify(f.want)}`);
    console.log(failures.length === 0 ? "lexer: all fixtures pass" : `lexer: ${failures.length} fixture(s) failed`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
  const at = args.indexOf("--files");
  const files = at === -1 ? scopeFiles() : args.slice(at + 1).filter((a) => !a.startsWith("--")).map((p) => p.replace(/\\/g, "/"));
  const allowlist = loadAllowlist();
  const used = new Set();
  const results = files.map(auditFile);
  const offenders = [];
  for (const r of results) {
    for (const b of r.multi) {
      const entry = allowlist.find((e) => allowed(e, r.path, b));
      if (entry) used.add(entry);
      else offenders.push({ path: r.path, line: b.line, length: b.length, kind: b.kind });
    }
  }
  const stale = allowlist.filter((e) => !used.has(e));

  if (has("--stats")) {
    const areas = new Map();
    for (const r of results) {
      const a = areas.get(areaOf(r.path)) ?? { files: 0, blocks: 0, multi: 0, doc: 0, plain: 0, soft: 0, long: 0, longest: 0, top: [] };
      a.files++;
      a.blocks += r.blocks.length;
      a.multi += r.multi.length;
      a.doc += r.multi.filter((b) => b.kind === "doc").length;
      a.plain += r.multi.length - r.multi.filter((b) => b.kind === "doc").length;
      a.soft += r.soft;
      a.long += r.long.length;
      a.longest = Math.max(a.longest, ...r.multi.map((b) => b.length));
      if (r.multi.length > 0) a.top.push([r.path, r.multi.length]);
      areas.set(areaOf(r.path), a);
    }
    const rows = [...areas.entries()].sort((x, y) => y[1].multi - x[1].multi);
    console.log("area\tfiles\tblocks\tmulti\tdoc\tplain\t>100\t>120\tlongest");
    let t = { files: 0, blocks: 0, multi: 0, doc: 0, plain: 0, soft: 0, long: 0, longest: 0 };
    for (const [name, a] of rows) {
      console.log(`${name}\t${a.files}\t${a.blocks}\t${a.multi}\t${a.doc}\t${a.plain}\t${a.soft}\t${a.long}\t${a.longest}`);
      for (const k of Object.keys(t)) t[k] = k === "longest" ? Math.max(t[k], a[k]) : t[k] + a[k];
    }
    console.log(`TOTAL\t${t.files}\t${t.blocks}\t${t.multi}\t${t.doc}\t${t.plain}\t${t.soft}\t${t.long}\t${t.longest}`);
    const top = rows.flatMap(([, a]) => a.top).sort((x, y) => y[1] - x[1]).slice(0, 10);
    if (top.length) console.log("\ntop files: " + top.map(([p, n]) => `${p} ${n}`).join(", "));
    console.log(`allowlisted: ${used.size}, stale allowlist entries: ${stale.length}`);
  }

  if (has("--json")) {
    console.log(JSON.stringify({ offenders, long: results.flatMap((r) => r.long.map((l) => ({ path: r.path, ...l }))), stale }, null, 1));
  } else if (!has("--stats")) {
    for (const o of offenders) console.log(`${o.path}:${o.line}: ${o.length} lines (${o.kind})`);
    for (const r of results) for (const l of r.long) console.log(`${r.path}:${l.line}: ${l.chars} chars`);
    for (const r of results) for (const l of r.mojibake) console.log(`${r.path}:${l}: mojibake`);
    for (const r of results) if (r.desync) console.log(`${r.path}: lexer lost its place (unterminated string or comment)`);
    for (const e of stale) console.log(`allowlist: unused entry for ${e.file} ("${e.startsWith}")`);
  }

  const longCount = results.reduce((n, r) => n + r.long.length, 0);
  const mojibake = results.reduce((n, r) => n + r.mojibake.length, 0);
  const desync = results.filter((r) => r.desync).length;
  const summary = `comment-audit: ${offenders.length} multi-line block(s), ${longCount} over ${HARD_LIMIT} chars, ${mojibake} mojibake, ${desync} desync, ${stale.length} stale allowlist entr${stale.length === 1 ? "y" : "ies"} in ${files.length} file(s)`;
  if (has("--check")) {
    const bad = offenders.length + longCount + mojibake + desync + stale.length > 0;
    console.log(summary);
    process.exit(bad ? 1 : 0);
  }
  if (!has("--json")) console.log(summary);
}

main();
