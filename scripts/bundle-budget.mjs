#!/usr/bin/env node
// Measures the production bundle gzipped and fails when a figure passes its budget in bundle-budget.json.
//
//   node scripts/bundle-budget.mjs              build fresh, then measure against the budget
//   node scripts/bundle-budget.mjs --no-build   measure the dist/ already on disk
//   node scripts/bundle-budget.mjs --report     every chunk, largest first, and the four figures
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, "dist");
const BUDGET = join(ROOT, "scripts", "bundle-budget.json");
const VITE = join(ROOT, "node_modules", "vite", "bin", "vite.js");

/** The figures the budget names, with what each one measures. */
export const FIGURES = {
  initialJs: "the entry script and every chunk it preloads: what the window waits for",
  initialCss: "the one stylesheet",
  largestLazy: "the largest chunk loaded on demand",
  totalJs: "every script in the bundle",
};

const gz = (bytes) => gzipSync(bytes, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;

/** The entry script, its preloads and its stylesheet, as index.html names them. */
export function initialSet(html) {
  const refs = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((m) => m[1]);
  return { js: new Set(refs.filter((r) => r.endsWith(".js"))), css: new Set(refs.filter((r) => r.endsWith(".css"))) };
}

/** The four figures, and every chunk's gzipped size for the report. */
export function measure(dist = DIST) {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const initial = initialSet(html);
  const chunks = readdirSync(join(dist, "assets"))
    .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
    .map((f) => ({ file: `assets/${f}`, gz: gz(readFileSync(join(dist, "assets", f))) }));
  const js = chunks.filter((c) => c.file.endsWith(".js"));
  const lazy = js.filter((c) => !initial.js.has(c.file)).sort((a, b) => b.gz - a.gz);
  const sum = (list) => list.reduce((n, c) => n + c.gz, 0);
  return {
    figures: {
      initialJs: sum(js.filter((c) => initial.js.has(c.file))),
      initialCss: sum(chunks.filter((c) => initial.css.has(c.file))),
      largestLazy: lazy[0]?.gz ?? 0,
      totalJs: sum(js),
    },
    largestLazyFile: lazy[0]?.file ?? null,
    chunks: chunks.sort((a, b) => b.gz - a.gz),
  };
}

/** Each figure over its budget, and figures the budget does not name. */
export function overBudget(figures, budget) {
  const over = [];
  for (const [name, value] of Object.entries(figures)) {
    const limit = budget[name];
    if (typeof limit !== "number") over.push({ name, value, limit: null });
    else if (value > limit) over.push({ name, value, limit });
  }
  return over;
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--no-build")) {
    execFileSync(process.execPath, [VITE, "build", "--logLevel", "error"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
  }
  const { figures, largestLazyFile, chunks } = measure();
  const budget = JSON.parse(readFileSync(BUDGET, "utf8")).budget;
  if (args.has("--report")) {
    for (const c of chunks) console.log(`${kb(c.gz).padStart(9)}  ${c.file}`);
    console.log("");
  }
  const over = overBudget(figures, budget);
  for (const o of over) {
    console.log(o.limit === null ? `${o.name}: ${kb(o.value)}, with no budget in bundle-budget.json` : `${o.name}: ${kb(o.value)} over its ${kb(o.limit)} budget (${FIGURES[o.name]})`);
  }
  const lazyName = largestLazyFile?.replace(/^assets\/|-[\w-]{8}\.js$/g, "") ?? "none";
  const line = `initial js ${kb(figures.initialJs)} / ${kb(budget.initialJs)}, css ${kb(figures.initialCss)} / ${kb(budget.initialCss)}, largest lazy ${kb(figures.largestLazy)} (${lazyName}) / ${kb(budget.largestLazy)}, total js ${kb(figures.totalJs)} / ${kb(budget.totalJs)}`;
  console.log(`bundle-budget: ${over.length ? "over — " : ""}${line}`);
  process.exit(over.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
