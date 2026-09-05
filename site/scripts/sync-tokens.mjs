#!/usr/bin/env node
/**
 * Writes `src/styles/tokens.generated.css` from the app's `src/app/index.css`.
 *
 * The site does not import the app's stylesheet: it declares its fonts with
 * bare package URLs, hides body overflow for a desktop window, keys its light
 * theme on an attribute the theme store writes, and its `@theme` accent values
 * are placeholders — the colours a user actually sees are computed by
 * `src/lib/contrast.ts` from the default accent at runtime. So this script
 * takes the blocks that *are* the design language (the `@theme`, every
 * `@keyframes` and `@utility`, the `:root` vars, both theme blocks, the
 * reduced-motion, forced-colours and scrollbar rules), leaves the rest, and
 * appends the default accent evaluated through the app's own function.
 *
 *   node scripts/sync-tokens.mjs            write the file
 *   node scripts/sync-tokens.mjs --check    exit 1 if the committed file is stale
 *   node scripts/sync-tokens.mjs --list     print every top-level block and whether it is taken
 *   node scripts/sync-tokens.mjs --report-copies   how far the copied primitives drifted
 *
 * Runs on Node ≥ 22.18 (type stripping is what lets it import a `.ts` file).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SITE = path.resolve(here, "..");
const REPO = path.resolve(SITE, "..");
const SOURCE = path.join(REPO, "src", "app", "index.css");
const CONTRAST = path.join(REPO, "src", "lib", "contrast.ts");
const OUT = path.join(SITE, "src", "styles", "tokens.generated.css");
const DEFAULT_ACCENT = "#4b3fc7"; // src/stores/theme.ts DEFAULT_ACCENT

const args = new Set(process.argv.slice(2));

/**
 * Splits a stylesheet into top-level statements, each with the comments that
 * precede it. Brace-balanced and string-aware enough for this file; it is a
 * scanner for one known stylesheet, not a CSS parser.
 */
function statements(css) {
  const out = [];
  let i = 0;
  const n = css.length;
  let pendingComment = "";
  while (i < n) {
    // whitespace
    if (/\s/.test(css[i])) {
      i++;
      continue;
    }
    // comment
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const text = css.slice(i, end + 2);
      pendingComment += (pendingComment ? "\n" : "") + text;
      i = end + 2;
      continue;
    }
    // statement: read until ';' at depth 0 or the matching '}' of the first '{'
    const start = i;
    let depth = 0;
    let sawBrace = false;
    let quote = null;
    while (i < n) {
      const c = css[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (css.startsWith("/*", i)) {
        i = css.indexOf("*/", i + 2) + 2;
        continue;
      } else if (c === "{") {
        depth++;
        sawBrace = true;
      } else if (c === "}") {
        depth--;
        if (depth === 0 && sawBrace) {
          i++;
          break;
        }
      } else if (c === ";" && depth === 0 && !sawBrace) {
        i++;
        break;
      }
      i++;
    }
    const body = css.slice(start, i).trim();
    const head = body.split("{")[0].trim().replace(/\s+/g, " ");
    out.push({ head, body, comment: pendingComment });
    pendingComment = "";
  }
  return out;
}

/** The blocks a website needs, by their heads. */
function taken(head, body = "") {
  // The view-transition rules are the app's page navigation; the site has none.
  if (body.includes("view-transition")) return false;
  if (head === "@theme static") return true;
  if (head.startsWith("@keyframes ")) return true;
  if (head.startsWith("@utility ")) return true;
  if (head === ":root") return true;
  if (/^:root\[data-theme="(light|dark)"\]$/.test(head)) return true;
  if (head === "@media (prefers-reduced-motion: reduce)") return true;
  if (head.startsWith("html[data-reduce-motion]")) return true;
  if (head === "@media (forced-colors: active)") return true;
  if (head === "@media (prefers-contrast: more)") return true;
  if (head.startsWith("*::-webkit-scrollbar")) return true;
  return false;
}

function fileUrl(p) {
  return pathToFileURL(p).href;
}

async function accentBlocks() {
  const { accentShades } = await import(fileUrl(CONTRAST));
  const render = (s) =>
    [
      `  --color-accent-400: ${s.a400};`,
      `  --color-accent-500: ${s.a500};`,
      `  --color-accent-600: ${s.a600};`,
      `  --color-accent-ink: ${s.ink};`,
      `  --accent-rgb: ${s.rgb};`,
      `  --w1: ${s.w1};`,
      `  --w2: ${s.w2};`,
      `  --hair: ${s.hair};`,
    ].join("\n");
  const dark = accentShades(DEFAULT_ACCENT, { light: false });
  const light = accentShades(DEFAULT_ACCENT, { light: true });
  return [
    `/* The default accent (${DEFAULT_ACCENT}, src/stores/theme.ts) as the theme store`,
    `   writes it at runtime — computed through src/lib/contrast.ts at sync time,`,
    `   never typed by hand. The @theme fallbacks above are not these colours. */`,
    `:root {`,
    render(dark),
    `}`,
    ``,
    `:root[data-theme="light"] {`,
    render(light),
    `}`,
  ].join("\n");
}

async function generate() {
  const css = readFileSync(SOURCE, "utf8").replace(/\r\n/g, "\n");
  const digest = createHash("sha256").update(css).digest("hex").slice(0, 12);
  const parts = statements(css);
  const kept = parts.filter((s) => taken(s.head, s.body));
  const header = [
    `/* GENERATED from src/app/index.css (sha256 ${digest}) by site/scripts/sync-tokens.mjs`,
    `   — do not edit. Re-run \`npm run sync\` after changing the source; \`npm run check\``,
    `   fails while this file is stale. CLAUDE.md, "The website". */`,
    ``,
  ].join("\n");
  const body = kept
    .map((s) => (s.comment ? `${s.comment}\n${s.body}` : s.body))
    .join("\n\n");
  const accent = await accentBlocks();
  return { text: `${header}${body}\n\n${accent}\n`, parts, kept };
}

const { text, parts, kept } = await generate();

if (args.has("--list")) {
  for (const s of parts) {
    console.log(`${taken(s.head, s.body) ? "take " : "skip "} ${s.head.slice(0, 90)}`);
  }
  console.log(`\n${kept.length} of ${parts.length} top-level blocks taken`);
  process.exit(0);
}

if (args.has("--report-copies")) {
  const pairs = [
    ["src/components/ui/button.tsx", "src/components/ui/button.tsx"],
    ["src/components/ui/card.tsx", "src/components/ui/card.tsx"],
    ["src/components/ui/pill.tsx", "src/components/ui/pill.tsx"],
    ["src/components/KarasuMark.tsx", "src/components/KarasuMark.tsx"],
    ["src/lib/utils.ts", "src/lib/cn.ts"],
  ];
  for (const [app, site] of pairs) {
    const a = new Set(readFileSync(path.join(REPO, app), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    const b = new Set(readFileSync(path.join(SITE, site), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    let onlyApp = 0;
    for (const l of a) if (!b.has(l)) onlyApp++;
    console.log(`${site.padEnd(40)} ${onlyApp} line(s) of the app file are not in the copy`);
  }
  process.exit(0);
}

if (args.has("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  } catch {
    console.error(`sync-tokens: ${path.relative(SITE, OUT)} is missing — run \`npm run sync\``);
    process.exit(1);
  }
  if (current !== text) {
    console.error(
      `sync-tokens: ${path.relative(SITE, OUT)} is stale against src/app/index.css — run \`npm run sync\` and commit the result`,
    );
    process.exit(1);
  }
  console.log("sync-tokens: up to date");
  process.exit(0);
}

writeFileSync(OUT, text);
console.log(`sync-tokens: wrote ${path.relative(SITE, OUT)} (${kept.length} blocks, ${text.length} bytes)`);
