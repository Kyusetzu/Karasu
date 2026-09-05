#!/usr/bin/env node
/**
 * Turns the client build into finished pages. Vite's client build leaves the
 * template with two placeholders; the SSR build exports `render(path)`; this
 * joins them and writes `index.html`, `404.html` and `sitemap.xml` into
 * `dist/client`, which is what GitHub Pages serves. Forty lines instead of a
 * framework, because the site has two pages and no routing.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SITE = path.resolve(here, "..");
const CLIENT = path.join(SITE, "dist", "client");
const SERVER = path.join(SITE, "dist", "server");
const SITE_URL = "https://kyusetzu.github.io/Karasu/";

const template = readFileSync(path.join(CLIENT, "index.html"), "utf8");
const entry = readdirSync(SERVER).find((f) => /^entry-server\.(m?js)$/.test(f));
if (!entry) throw new Error("prerender: no entry-server bundle under dist/server");
const { render } = await import(pathToFileURL(path.join(SERVER, entry)).href);

function page(routePath, dataPage) {
  const { html, head } = render(routePath);
  let out = template
    // the dev-only <title>; the head string carries the real one
    .replace(/\s*<title>[^<]*<\/title>/, "")
    .replace("<!--app-head-->", head)
    .replace("<!--app-html-->", html);
  if (dataPage) out = out.replace('<div id="root">', `<div id="root" data-page="${dataPage}">`);
  if (out.includes("<!--app-")) throw new Error("prerender: a placeholder survived");
  return out;
}

writeFileSync(path.join(CLIENT, "index.html"), page("/"));
writeFileSync(path.join(CLIENT, "404.html"), page("/404", "404"));

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  path.join(CLIENT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`,
);
console.log("prerender: index.html, 404.html, sitemap.xml written");
