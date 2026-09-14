// Copies the compiled app stylesheet to a stable path, minus its /assets/ font rules (fonts.css ships those).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const assets = path.resolve(here, "..", "dist", "assets");
const name = readdirSync(assets).find((f) => /^index-.*\.css$/.test(f));
if (!name) throw new Error("no compiled stylesheet under dist/assets — run npm run build first");
const css = readFileSync(path.join(assets, name), "utf8").replace(/@font-face\{[^}]*\}/g, "");
mkdirSync(path.join(here, ".cache"), { recursive: true });
writeFileSync(path.join(here, ".cache", "app.css"), css);
console.log(`app-css: ${name} -> .design-sync/.cache/app.css (${css.length} bytes, font rules stripped)`);
