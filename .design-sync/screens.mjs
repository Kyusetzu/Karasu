// Screen references for Claude Design: imports captures into .design-sync/screens/ and emits a card per screen into ds-bundle.
//
//   node .design-sync/screens.mjs --import site/captures/desktop   convert PNG captures named in index.json to 1x JPEGs
//   node .design-sync/screens.mjs                                  emit components/screens/<Name>/ cards + guidelines/screens.md
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..");
const screensDir = path.join(here, "screens");
const index = JSON.parse(readFileSync(path.join(screensDir, "index.json"), "utf8"));
const args = process.argv.slice(2);

if (args[0] === "--import") {
  // sharp lives under site/; the app's own tree has no image tooling and does not need one.
  const sharp = createRequire(path.join(repo, "site", "package.json"))("sharp");
  const from = path.resolve(args[1]);
  let done = 0;
  for (const s of index.screens) {
    const src = path.join(from, `${s.id}.png`);
    if (!existsSync(src)) { console.error(`! ${s.id}: no ${src}`); continue; }
    const width = s.platform === "desktop" ? 1440 : 608;
    await sharp(src).resize(width).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(screensDir, `${s.id}.jpg`));
    done++;
  }
  console.log(`screens: imported ${done}/${index.screens.length}`);
  process.exit(0);
}

const out = path.join(repo, "ds-bundle");
if (!existsSync(path.join(out, "styles.css"))) throw new Error("run the converter first; ds-bundle/ is not a build");
const lines = ["# Karasu screens", "", index.note, "", "Each screen is a real capture; its card is under components/screens/. Use them as the layout truth for a redesign: the same regions, the same components, the same density.", ""];
let n = 0;
for (const s of index.screens) {
  const jpg = path.join(screensDir, `${s.id}.jpg`);
  if (!existsSync(jpg)) { console.error(`! ${s.id}: not imported yet`); continue; }
  const dir = path.join(out, "components", "screens", s.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${s.id}.jpg`), readFileSync(jpg));
  const phone = s.platform === "android";
  writeFileSync(
    path.join(dir, `${s.name}.html`),
    `<!-- @dsCard group="Screens" viewport="${phone ? "420x900" : "1440x900"}" -->
<!doctype html>
<html><head><meta charset="utf-8"><title>${s.title}</title>
<style>body{margin:0;background:#0b0d12;display:grid;place-items:start center}img{display:block;max-width:100%;height:auto}</style>
</head><body><img src="${s.id}.jpg" alt="${s.title} — ${s.state}"></body></html>
`,
  );
  writeFileSync(
    path.join(dir, `${s.name}.prompt.md`),
    `${s.title} (${s.platform}, ${s.state}) — a reference capture of the real Karasu screen at ${s.route}, not a component.\n\n${s.description}\n\nBuild a variant of this screen from the components in this design system inside \`KarasuTheme\`; keep its regions and density unless the brief says otherwise.\n`,
  );
  lines.push(`## ${s.title}`, "", `Route \`${s.route}\` · ${s.platform} · ${s.state}`, "", s.description, "");
  n++;
}
mkdirSync(path.join(out, "guidelines"), { recursive: true });
writeFileSync(path.join(out, "guidelines", "screens.md"), lines.join("\n"));
console.log(`screens: ${n} cards under components/screens/, guidelines/screens.md written`);
