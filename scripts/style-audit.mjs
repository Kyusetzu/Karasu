#!/usr/bin/env node
// Holds the class vocabulary to DESIGN.md: counts drift per file and rule, and fails when a count rises above the baseline.
//
//   node scripts/style-audit.mjs              list every finding
//   node scripts/style-audit.mjs --check      exit 1 when a file × rule count differs from style-baseline.json
//   node scripts/style-audit.mjs --stats      the per-rule table and the files carrying the most drift
//   node scripts/style-audit.mjs --files a b  only these paths
//   node scripts/style-audit.mjs --tighten    lower the baseline to today's counts, never raise it
//   node scripts/style-audit.mjs --record     rewrite the baseline to today's counts, raises included
//   node scripts/style-audit.mjs --selftest   the rules' own fixtures
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASELINE = join(ROOT, "scripts", "style-baseline.json");
const ALLOWLIST = join(ROOT, "scripts", "style-allowlist.json");
const TOKENS = join(ROOT, "src", "app", "index.css");

/** What each rule holds the code to; the key is what the baseline and the allowlist name. */
export const RULES = {
  "radius-arbitrary": "a bracketed radius; use a radius role",
  "radius-size": "a radius by size (rounded, -md, -lg, -xl …); use a role: inner, control, panel, sheet, cover",
  "shadow-size": "a shadow by size (shadow, -lg, -xl …); use a role: float, sheet",
  "text-size-arbitrary": "a bracketed font size; use a type step",
  "tracking-arbitrary": "a bracketed letter spacing",
  "colour-arbitrary": "a hex, rgb or hsl colour in a class; use a token",
  "colour-undefined": "a shade the theme does not define, which renders nothing",
  "colour-foreign": "Tailwind's own palette, black or white instead of a token",
  "transition-broad": "transition-colors, transition-all or a bare transition; use transition-surface",
  "z-arbitrary": "a bracketed z-index",
  "shadow-arbitrary": "a bracketed shadow",
  "motion-arbitrary": "a bracketed duration, delay or easing",
  "spin-outside-spinner": "animate-spin outside the spinner primitive",
  "outline-removed": "outline-none with no focus style beside it",
  "class-fragment": "a class built from a template fragment, which Tailwind cannot see",
  "icon-size": "an icon size off the icon scale",
  "library-boundary": "a UI or motion library imported outside its wrapper",
  "parse-error": "the file did not parse, so nothing in it was checked",
};

/** The icon scale in Tailwind spacing units (14, 16, 20 and 32 px). */
export const ICON_SIZES = new Set(["3.5", "4", "5", "8"]);
/** Pixel sizes a lucide `size` prop may take, the same scale. */
const ICON_PX = new Set([14, 16, 20, 32]);
const SPINNER = "src/components/ui/spinner.tsx";
/** The one module each library may be imported from; everything else goes through it. */
const LIBRARY_HOMES = [
  { test: (m) => m === "@base-ui/react" || m.startsWith("@base-ui/react/"), home: (p) => p.startsWith("src/components/ui/") },
  { test: (m) => m === "motion" || m.startsWith("motion/") || m === "framer-motion", home: (p) => p === "src/app/motion.tsx" },
];

const COLOUR_PREFIX =
  /^(?:bg|text|border(?:-[trblxyse])?|outline|ring(?:-offset)?|inset-ring|from|via|to|fill|stroke|decoration|divide|caret|placeholder|shadow|inset-shadow|drop-shadow)-(.+)$/;
const OWN_FAMILIES = ["surface", "ink", "accent", "status", "graph"];
const TW_PALETTE =
  /^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/;
const COLOUR_VALUE = /^\[(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|color:)/i;
const FOCUS_STYLE = /^(?:[\w-]+:)*(?:focus|focus-visible|focus-within)(?::[\w-]+)*:(?:border|ring|outline-(?!none)|shadow|bg|inset-ring)/;

/** Every `--color-*` name the stylesheet defines, in any block. */
export function definedColours(css = readFileSync(TOKENS, "utf8")) {
  return new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/** A class token without its variants, important marks and negative sign, so `md:hover:!-z-[5]` reads `z-[5]`. */
export function utilityOf(token) {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) cut = i;
  }
  return token.slice(cut + 1).replace(/^!/, "").replace(/!$/, "").replace(/^-/, "");
}

/** The rules one token breaks, before any allowlist or context is applied. */
export function tokenRules(token, path, colours) {
  const u = utilityOf(token);
  const hits = [];
  if (/^rounded(?:-[a-z]{1,2})?-\[/.test(u)) hits.push("radius-arbitrary");
  if (/^rounded(?:-[trblxyse]{1,2})?(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl))?$/.test(u)) hits.push("radius-size");
  if (/^shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl))?$/.test(u)) hits.push("shadow-size");
  if (/^text-\[/.test(u) && !COLOUR_VALUE.test(u.slice(5)) && !/^text-\[var\(--color/.test(u)) hits.push("text-size-arbitrary");
  if (/^tracking-\[/.test(u)) hits.push("tracking-arbitrary");
  if (/^z-\[/.test(u)) hits.push("z-arbitrary");
  if (/^shadow-\[/.test(u) && !COLOUR_VALUE.test(u.slice(7))) hits.push("shadow-arbitrary");
  if (/^(?:duration|delay|ease)-\[/.test(u)) hits.push("motion-arbitrary");
  if (u === "transition-colors" || u === "transition-all" || u === "transition") hits.push("transition-broad");
  if (u === "animate-spin" && path !== SPINNER) hits.push("spin-outside-spinner");
  const colour = COLOUR_PREFIX.exec(u);
  if (colour) {
    const value = colour[1].replace(/\/[\d.[\]%]+$/, "");
    if (COLOUR_VALUE.test(value)) hits.push("colour-arbitrary");
    else if (!colours.has(value) && OWN_FAMILIES.some((f) => value.startsWith(`${f}-`))) hits.push("colour-undefined");
    else if (value === "white" || value === "black" || TW_PALETTE.test(value)) hits.push("colour-foreign");
  }
  return hits;
}

const CLASS_CALLS = new Set(["cn", "cva", "clsx", "twMerge"]);
const isClassCall = (n) => n.type === "CallExpression" && n.callee?.type === "Identifier" && CLASS_CALLS.has(n.callee.name);
const isFunction = (n) => /Function|ArrowFunction|MethodDefinition/.test(n.type);
const isClassAttr = (n) => n.type === "JSXAttribute" && /^(?:className|class)$/.test(n.name?.name ?? "");

/** The node whose strings count as one class list: a JSX attribute, a `cn`/`cva` call, or the literal alone. */
function groupOf(node, parents) {
  for (let i = parents.length - 1; i >= 0; i--) {
    const n = parents[i];
    if (n.type === "JSXAttribute" || isClassCall(n)) return n;
    if (n.type === "VariableDeclarator" || isFunction(n)) return node;
  }
  return node;
}

/** Whether a template sits where its text is a class list, so a key or a URL built the same way is left alone. */
function inClassContext(parents) {
  for (let i = parents.length - 1; i >= 0; i--) {
    const n = parents[i];
    if (n.type === "JSXAttribute") return isClassAttr(n);
    if (isClassCall(n)) return true;
    if (isFunction(n)) return false;
  }
  return false;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Whether one of the three nearest enclosing elements draws the focus instead, with a `focus-within:` style. */
function wrapperShowsFocus(parents) {
  const elements = parents.filter((n) => n.type === "JSXElement");
  for (const el of elements.slice(-4, -1)) {
    const attr = el.openingElement.attributes.find((a) => a.type === "JSXAttribute" && isClassAttr(a));
    if (attr && stringsUnder(attr.value).some((v) => /(?:^|\s)focus-within:/.test(v))) return true;
  }
  return false;
}

/** The string literals under a node, for the class list of one attribute. */
function stringsUnder(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) stringsUnder(n, out);
    return out;
  }
  if (node.type === "Literal" && typeof node.value === "string") out.push(node.value);
  else if (node.type === "TemplateElement") out.push(node.value.cooked ?? node.value.raw);
  for (const key in node) if (key !== "parent" && node[key] && typeof node[key] === "object") stringsUnder(node[key], out);
  return out;
}

/** Everything the audit finds in one file's text; `path` decides the spinner and library exceptions. */
export function auditText(text, path, colours = definedColours()) {
  const { program, errors } = parseSync(path, text);
  const starts = lineStarts(text);
  const findings = [];
  const add = (node, rule, token) => findings.push({ path, line: lineAt(starts, node.start), rule, token });
  if (errors.length) add({ start: errors[0].labels?.[0]?.start ?? 0 }, "parse-error", errors[0].message);
  const icons = new Set(["Icon"]);
  const groups = new Map();
  const tokensOf = (value) => value.split(/\s+/).filter(Boolean);

  const visitString = (node, value, parents) => {
    const group = groupOf(node, parents);
    if (!groups.has(group)) groups.set(group, { node, tokens: [], outlines: [] });
    const entry = groups.get(group);
    for (const token of tokensOf(value)) {
      for (const rule of tokenRules(token, path, colours)) add(node, rule, token);
      if (/(?:^|:)!?outline-none!?$/.test(token)) entry.outlines.push({ node, token, parents });
      entry.tokens.push(token);
    }
    for (const m of value.matchAll(/--color-([a-z0-9]+(?:-[a-z0-9]+)*)(?![a-z0-9-])/g)) {
      if (!colours.has(m[1]) && OWN_FAMILIES.some((f) => m[1].startsWith(`${f}-`))) add(node, "colour-undefined", m[0]);
    }
  };

  const visitIcon = (node) => {
    for (const attr of node.attributes) {
      if (attr.type !== "JSXAttribute") continue;
      if (isClassAttr(attr)) {
        for (const token of stringsUnder(attr.value).flatMap(tokensOf)) {
          const m = /^(?:size|h|w)-([\d.]+)$/.exec(utilityOf(token));
          if (m && !ICON_SIZES.has(m[1])) add(attr, "icon-size", token);
        }
      } else if (attr.name?.name === "size" && attr.value?.type === "JSXExpressionContainer") {
        const e = attr.value.expression;
        if (e?.type === "Literal" && typeof e.value === "number" && !ICON_PX.has(e.value)) add(attr, "icon-size", `size={${e.value}}`);
      }
    }
  };

  const visit = (node, parents) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, parents);
      return;
    }
    if (typeof node.type !== "string") return;
    switch (node.type) {
      case "ImportDeclaration": {
        const from = node.source.value;
        if (from === "lucide-react") for (const sp of node.specifiers) if (sp.type === "ImportSpecifier") icons.add(sp.local.name);
        const lib = LIBRARY_HOMES.find((l) => l.test(from));
        if (lib && !lib.home(path)) add(node, "library-boundary", from);
        return;
      }
      case "Literal":
        if (typeof node.value === "string") visitString(node, node.value, parents);
        return;
      case "TemplateLiteral": {
        const classy = inClassContext(parents);
        node.quasis.forEach((q, i) => {
          const part = q.value.cooked ?? q.value.raw;
          visitString(node, part, parents);
          if (!classy) return;
          // A class cut off before a `${}` (`grid-cols-${n}`) or picked up right after one (`${side}-4`).
          if (!q.tail && /(?:^|\s)[!\w:.-]*[a-z][\w:.-]*[-[]$/.test(part)) add(node, "class-fragment", tokensOf(part).at(-1));
          if (i > 0 && /^-[\w[]/.test(part)) add(node, "class-fragment", tokensOf(part)[0]);
        });
        break;
      }
      case "JSXOpeningElement":
        if (node.name?.type === "JSXIdentifier" && icons.has(node.name.name)) visitIcon(node);
        break;
    }
    const next = [...parents, node];
    for (const key in node) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = node[key];
      if (child && typeof child === "object") visit(child, next);
    }
  };
  visit(program, []);

  for (const { tokens, outlines } of groups.values()) {
    if (outlines.length === 0 || tokens.some((t) => FOCUS_STYLE.test(t))) continue;
    for (const o of outlines) if (!wrapperShowsFocus(o.parents)) add(o.node, "outline-removed", o.token);
  }
  return findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

/** The files the audit reads: the app's TypeScript, tests, test helpers and the generated bindings aside. */
export function inScope(path) {
  const p = path.replace(/\\/g, "/");
  if (!p.startsWith("src/") || !/\.(ts|tsx)$/.test(p)) return false;
  if (/\.test\.tsx?$/.test(p) || p.startsWith("src/test/") || p === "src/api/bindings.ts") return false;
  return true;
}

function scopeFiles() {
  const list = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\0");
  const all = [...list(["ls-files", "-z"]), ...list(["ls-files", "--others", "--exclude-standard", "-z"])];
  return [...new Set(all)].filter((p) => p && inScope(p)).sort();
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/** Findings with the allowlist applied; `used` collects the entries that matched, so a stale one can be named. */
export function applyAllowlist(findings, allowlist, used = new Set()) {
  return findings.filter((f) => {
    const entry = allowlist.find((e) => e.file === f.path && e.rule === f.rule && f.token.includes(e.token));
    if (entry) used.add(entry);
    return !entry;
  });
}

/** Per file, per rule counts, the shape the baseline is stored in. */
export function countsOf(findings) {
  const out = {};
  for (const f of findings) {
    out[f.path] ??= {};
    out[f.path][f.rule] = (out[f.path][f.rule] ?? 0) + 1;
  }
  return out;
}

/** Where today's counts rise above the baseline and where the baseline has slack, over the scanned files only. */
export function compare(counts, baseline, scanned) {
  const rises = [];
  const slack = [];
  for (const path of scanned) {
    const now = counts[path] ?? {};
    const was = baseline[path] ?? {};
    for (const rule of new Set([...Object.keys(now), ...Object.keys(was)])) {
      const a = now[rule] ?? 0;
      const b = was[rule] ?? 0;
      if (a > b) rises.push({ path, rule, now: a, was: b });
      else if (a < b) slack.push({ path, rule, now: a, was: b });
    }
  }
  return { rises, slack };
}

/** Sorted keys and one rule per line, so a baseline diff reads as the drift that moved. */
function writeBaseline(counts) {
  const sorted = {};
  for (const path of Object.keys(counts).sort()) {
    const rules = Object.fromEntries(Object.entries(counts[path]).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)));
    if (Object.keys(rules).length) sorted[path] = rules;
  }
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
}

const FIXTURES = [
  { text: `<div className="rounded-[.625rem] text-[.8125rem] tracking-[.1em]" />`, want: ["radius-arbitrary", "text-size-arbitrary", "tracking-arbitrary"] },
  { text: `<div className="rounded rounded-lg md:rounded-t-xl rounded-control rounded-full rounded-none shadow shadow-2xl shadow-float" />`, want: ["radius-size", "radius-size", "radius-size", "shadow-size", "shadow-size"] },
  { text: `<div className="text-ink-200 hover:border-surface-500 text-ink-300 bg-accent-ink" />`, want: ["colour-undefined", "colour-undefined"] },
  { text: `<div className="text-white bg-black/55 text-rose-400 bg-transparent text-sm" />`, want: ["colour-foreign", "colour-foreign", "colour-foreign"] },
  { text: `<div className="bg-[rgba(4,5,8,.55)] hover:bg-[#b3232c] text-[#0d1117]" />`, want: ["colour-arbitrary", "colour-arbitrary", "colour-arbitrary"] },
  { text: `<div className="transition-colors transition transition-surface transition-transform" />`, want: ["transition-broad", "transition-broad"] },
  { text: `<div className="z-[110] shadow-[0_1rem_3rem_rgba(0,0,0,.6)] duration-[900ms] shadow-float z-50" />`, want: ["motion-arbitrary", "shadow-arbitrary", "z-arbitrary"] },
  { text: `<span className="animate-spin" />`, want: ["spin-outside-spinner"] },
  { text: `<input className="focus:outline-none" />`, want: ["outline-removed"] },
  { text: `<input className={cn("focus:outline-none", "focus:border-accent-500")} />`, want: [] },
  { text: `<label className="focus-within:border-accent-500"><input className="focus:outline-none" /></label>`, want: [] },
  { text: "const v = `var(--color-status-${s.toLowerCase()})`;", want: [] },
  { text: "const a = cn(`grid-cols-${n} gap-2`, `${side}-4`); const k = t(`status.${type}.${s}`); const u = `karasu-${key}`;", want: ["class-fragment", "class-fragment"] },
  { text: `import { Plus } from "lucide-react";\n<><Plus className="size-3 text-ink-500" /><Plus className="size-4" /><Plus size={18} /></>`, want: ["icon-size", "icon-size"] },
  { text: `import { Menu } from "@base-ui/react/menu";`, want: ["library-boundary"] },
  { text: `const s = { color: "var(--color-ink-400)", background: "var(--color-surface-900)" };`, want: ["colour-undefined"] },
  { text: `// text-ink-200 in a comment is not a class\n/* rounded-[3px] */ const x = 1;`, want: [] },
];

export function selfTest() {
  const colours = definedColours();
  const failures = [];
  for (const f of FIXTURES) {
    const got = auditText(f.text, "src/fixture.tsx", colours).map((x) => x.rule).sort();
    const want = [...f.want].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push({ text: f.text, got, want });
  }
  return failures;
}

function main() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  if (has("--selftest")) {
    const failures = selfTest();
    for (const f of failures) console.error(`fixture: ${JSON.stringify(f.text)}\n  got  ${JSON.stringify(f.got)}\n  want ${JSON.stringify(f.want)}`);
    console.log(failures.length === 0 ? `style-audit: all ${FIXTURES.length} fixtures pass` : `style-audit: ${failures.length} fixture(s) failed`);
    process.exit(failures.length === 0 ? 0 : 1);
  }
  const at = args.indexOf("--files");
  const files = at === -1 ? scopeFiles() : args.slice(at + 1).filter((a) => !a.startsWith("--")).map((p) => p.replace(/\\/g, "/")).filter(inScope);
  const colours = definedColours();
  const allowlist = readJson(ALLOWLIST, []);
  const used = new Set();
  const raw = files.flatMap((p) => auditText(readFileSync(join(ROOT, p), "utf8"), p, colours));
  const findings = applyAllowlist(raw, allowlist, used);
  const counts = countsOf(findings);
  const baseline = readJson(BASELINE, {});
  const scanned = new Set(files);
  const staleAllow = allowlist.filter((e) => !used.has(e) && scanned.has(e.file));

  if (has("--record") || has("--tighten")) {
    if (at !== -1) {
      console.error("style-audit: --record and --tighten read every file; drop --files");
      process.exit(2);
    }
    const next = {};
    const raised = [];
    for (const path of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
      for (const rule of new Set([...Object.keys(counts[path] ?? {}), ...Object.keys(baseline[path] ?? {})])) {
        const now = counts[path]?.[rule] ?? 0;
        const was = baseline[path]?.[rule] ?? 0;
        if (now > was && !has("--record")) raised.push(`${path} ${rule} ${was} -> ${now}`);
        const keep = has("--record") ? now : Math.min(now, was);
        if (keep > 0) (next[path] ??= {})[rule] = keep;
      }
    }
    writeBaseline(next);
    const total = Object.values(next).reduce((n, r) => n + Object.values(r).reduce((a, b) => a + b, 0), 0);
    console.log(`style-audit: baseline ${has("--record") ? "recorded" : "tightened"} to ${total} finding(s) in ${Object.keys(next).length} file(s)`);
    for (const r of raised) console.log(`  not raised (fix it or --record): ${r}`);
    process.exit(raised.length ? 1 : 0);
  }

  if (has("--stats")) {
    const perRule = new Map(Object.keys(RULES).map((r) => [r, 0]));
    for (const f of findings) perRule.set(f.rule, (perRule.get(f.rule) ?? 0) + 1);
    console.log("rule\tcount\tmeaning");
    for (const [rule, n] of perRule) console.log(`${rule}\t${n}\t${RULES[rule]}`);
    const perFile = Object.entries(counts).map(([p, r]) => [p, Object.values(r).reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]);
    console.log(`\ntop files: ${perFile.slice(0, 12).map(([p, n]) => `${p} ${n}`).join(", ")}`);
    console.log(`TOTAL ${findings.length} finding(s) in ${perFile.length} of ${files.length} file(s); allowlisted ${raw.length - findings.length}`);
    return;
  }

  if (!has("--check")) {
    for (const f of findings) console.log(`${f.path}:${f.line}: ${f.rule} ${f.token}`);
    for (const e of staleAllow) console.log(`allowlist: unused entry for ${e.file} (${e.rule} "${e.token}")`);
    console.log(`style-audit: ${findings.length} finding(s) in ${Object.keys(counts).length} of ${files.length} file(s)`);
    return;
  }

  const { rises, slack } = compare(counts, baseline, [...scanned]);
  const gone = at === -1 ? Object.keys(baseline).filter((p) => !scanned.has(p)) : [];
  for (const r of rises) {
    console.log(`${r.path}: ${r.rule} ${r.was} -> ${r.now} (${RULES[r.rule]})`);
    for (const f of findings.filter((x) => x.path === r.path && x.rule === r.rule)) console.log(`  ${f.path}:${f.line}: ${f.token}`);
  }
  for (const s of slack) console.log(`${s.path}: ${s.rule} ${s.was} -> ${s.now}, lower the baseline with --tighten`);
  for (const p of gone) console.log(`${p}: in the baseline but not in scope any more, drop it with --tighten`);
  for (const e of staleAllow) console.log(`allowlist: unused entry for ${e.file} (${e.rule} "${e.token}")`);
  const bad = rises.length + slack.length + gone.length + staleAllow.length;
  const baselined = findings.length;
  console.log(
    bad === 0
      ? `style-audit: clean (${files.length} files, ${baselined} baselined)`
      : `style-audit: ${rises.length} rise(s), ${slack.length} loose baseline entr${slack.length === 1 ? "y" : "ies"}, ${gone.length} gone file(s), ${staleAllow.length} stale allowlist entr${staleAllow.length === 1 ? "y" : "ies"}`,
  );
  process.exit(bad === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
