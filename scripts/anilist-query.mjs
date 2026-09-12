#!/usr/bin/env node
/**
 * Runs one of the app's own GraphQL queries against the live AniList API, read off disk so it checks the query the app ships.
 *
 *   node scripts/anilist-query.mjs DETAIL_QUERY '{"id":16498}'
 *   node scripts/anilist-query.mjs LIST_QUERY '{"userId":153164,"type":"ANIME"}'
 *   node scripts/anilist-query.mjs USER_STATS_QUERY '{"id":153164}' --show-query
 *   node scripts/anilist-query.mjs DETAIL_QUERY '{"id":16498}' --raw | jq .
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENDPOINT = "https://graphql.anilist.co";

/** Files that hold GraphQL constants: every api module, plus the Rust side. */
function sourceFiles() {
  const apiDir = join(ROOT, "src/api");
  const api = readdirSync(apiDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(apiDir, f));
  // Read the whole commands module so LIST_QUERY and friends stay reachable wherever they end up living.
  const cmdDir = join(ROOT, "src-tauri/src/commands");
  const rust = readdirSync(cmdDir)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => join(cmdDir, f));
  return [...api, ...rust];
}

/** Finds `const NAME = <literal>` in one source, TS template, TS string or Rust `&str` alike, honouring escaped quotes. */
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
  console.error(`no const named ${name} in src/api/*.ts or src-tauri/src/commands/*.rs`);
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
  // The byte count makes a field's cost an observation; `relative` keeps the absolute checkout path out of pasted output.
  console.log(`${name} from ${relative(ROOT, found.file)}`);
  console.log(`  HTTP ${response.status}, ${body.length} bytes`);
  console.log(`  data: ${Object.keys(parsed.data ?? {}).join(", ") || "none"}`);
}
