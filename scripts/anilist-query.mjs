#!/usr/bin/env node
/**
 * Runs one of the app's own GraphQL queries against the live AniList API.
 *
 *   node scripts/anilist-query.mjs DETAIL_QUERY '{"id":16498}'
 *   node scripts/anilist-query.mjs LIST_QUERY '{"userId":153164,"type":"ANIME"}'
 *   node scripts/anilist-query.mjs USER_STATS_QUERY '{"id":153164}' --show-query
 *   node scripts/anilist-query.mjs DETAIL_QUERY '{"id":16498}' --raw | jq .
 *
 * CLAUDE.md requires validating queries against the live schema before wiring
 * new fields, because the schema is the source of truth. That used to mean
 * hand-rolling an extract-interpolate-POST script each time, which is both slow
 * and wrong in an interesting way: a retyped query proves nothing about the one
 * the app ships. This reads the constant off disk instead.
 *
 * Handles the three literal forms in the tree — TS template literals, TS
 * double-quoted strings and Rust `const NAME: &str` — and resolves `${OTHER}`
 * interpolations from the same file (USER_STATS_QUERY pulls in STAT_ROW,
 * DETAIL_QUERY pulls in MEDIA_FIELDS).
 *
 * Unauthenticated, so it cannot see private data: a user's `voiceActors` and
 * `staff` statistics come back as empty arrays. That is a permissions artefact,
 * not a schema problem — judge validity by the absence of `errors`.
 *
 * Public ids that work for smoke tests: user 153164, media 16498, staff 95269.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENDPOINT = "https://graphql.anilist.co";

/** Files that hold GraphQL constants: every api module, plus the Rust side. */
function sourceFiles() {
  const apiDir = join(ROOT, "src/api");
  const api = readdirSync(apiDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(apiDir, f));
  return [...api, join(ROOT, "src-tauri/src/commands.rs")];
}

/**
 * Finds `const NAME = <literal>` in one source, for TS and Rust alike.
 *
 * The optional `: &str` covers Rust; the literal is either backtick-delimited
 * (TS template) or double-quoted (TS string and Rust). Escaped quotes are
 * allowed for so a `\"` inside a Rust literal cannot end the match early.
 */
function findConstant(source, name) {
  const backtick = new RegExp(`const ${name}\\s*(?::[^=]+)?=\\s*\`([^\`]*)\``);
  const quoted = new RegExp(
    `const ${name}\\s*(?::[^=]+)?=\\s*"((?:[^"\\\\]|\\\\.)*)"`,
  );
  const match = source.match(backtick) ?? source.match(quoted);
  return match?.[1];
}

/** Resolves `${OTHER}` against constants in the same file, cycles included. */
function interpolate(text, source, seen = new Set()) {
  return text.replace(/\$\{(\w+)\}/g, (whole, name) => {
    if (seen.has(name)) {
      throw new Error(`${name} interpolates itself`);
    }
    const value = findConstant(source, name);
    if (value === undefined) {
      throw new Error(`${whole} does not resolve — no const ${name} in scope`);
    }
    return interpolate(value, source, new Set([...seen, name]));
  });
}

function loadQuery(name) {
  for (const file of sourceFiles()) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const raw = findConstant(source, name);
    if (raw !== undefined) {
      return { query: interpolate(raw, source), file };
    }
  }
  return null;
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [name, variablesJson] = args.filter((a) => !a.startsWith("--"));

if (!name) {
  console.error(
    "usage: node scripts/anilist-query.mjs <CONST_NAME> [variables-json] " +
      "[--raw] [--show-query]",
  );
  process.exit(1);
}

let variables;
try {
  variables = variablesJson ? JSON.parse(variablesJson) : {};
} catch (e) {
  console.error(`variables are not valid JSON: ${e.message}`);
  process.exit(1);
}

let found;
try {
  found = loadQuery(name);
} catch (e) {
  console.error(`${name}: ${e.message}`);
  process.exit(1);
}
if (!found) {
  console.error(`no const named ${name} in src/api/*.ts or commands.rs`);
  process.exit(1);
}

if (flags.has("--show-query")) {
  console.error(found.query);
}

const response = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ query: found.query, variables }),
});
const body = await response.text();

let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  console.error(`HTTP ${response.status}, and the body is not JSON:\n${body}`);
  process.exit(1);
}

if (flags.has("--raw")) {
  console.log(body);
}

if (parsed.errors) {
  console.error(`${name} was rejected by AniList:`);
  for (const error of parsed.errors) {
    const at = error.locations
      ?.map((l) => `line ${l.line}, column ${l.column}`)
      .join("; ");
    console.error(`  ${error.message}${at ? ` (${at})` : ""}`);
  }
  process.exit(1);
}

if (!flags.has("--raw")) {
  // The byte count is the point: it is what makes a field's cost, or a
  // compression change, an observation rather than an assumption.
  console.log(`${name} from ${found.file.replace(ROOT + "\\", "")}`);
  console.log(`  HTTP ${response.status}, ${body.length} bytes`);
  console.log(`  data: ${Object.keys(parsed.data ?? {}).join(", ") || "none"}`);
}
