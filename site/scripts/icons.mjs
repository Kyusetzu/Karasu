#!/usr/bin/env node
/**
 * The favicon set, from the app's own icon source (`src-tauri/icons/
 * app-icon.svg`: the same bird and disc, square canvas, transparent ground).
 * Run once and commit the results; the SVG is copied as-is and sharp renders
 * the PNG sizes browsers and home screens ask for.
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SITE = path.resolve(here, "..");
const SOURCE = path.resolve(SITE, "..", "src-tauri", "icons", "app-icon.svg");
const PUBLIC = path.join(SITE, "public");
mkdirSync(PUBLIC, { recursive: true });

copyFileSync(SOURCE, path.join(PUBLIC, "favicon.svg"));
const svg = readFileSync(SOURCE);
const sizes = [
  ["favicon-32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];
for (const [name, size] of sizes) {
  // Rendered at 4x and downscaled so the thin tail keeps its edge at 32px.
  const buf = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(buf).toFile(path.join(PUBLIC, name));
  console.log(`icons: ${name} (${size}px, ${buf.length} B)`);
}
