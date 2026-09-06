# The Karasu website

The public site at <https://kyusetzu.github.io/Karasu/>. An npm project of its
own inside the app's repository; the rules that keep the two apart are in the
root `CLAUDE.md` under "The website".

## Stack

Vite 8 + React 19 + TypeScript, Tailwind v4 on the app's own design tokens,
`motion` for the orchestrated scenes. One page, pre-rendered to static HTML
(`scripts/prerender.mjs`) so it reads without JavaScript; `motion` drives
forward from the pre-rendered end state, so nothing flashes and reduced motion
simply keeps the end state.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on <http://localhost:4321/Karasu/>; `#sample` shows the token and type sample |
| `npm run check` | The gate: typecheck plus "is `tokens.generated.css` fresh" |
| `npm run sync` | Regenerate `src/styles/tokens.generated.css` from `../src/app/index.css` |
| `npm run build` | Client build, SSR build, prerender, `verify-dist` |
| `npm run preview` | Serve `dist/client` on port 4322 |
| `npm run lighthouse` | Lighthouse, mobile and desktop, against `dist/client` in headless Edge; fails under 95 in any category |
| `node scripts/snap.mjs <url> …` | Review screenshots at 390/768/1280/1440/2560 into `captures/review/`; `--full` stitches the whole page in tiles |
| `node scripts/capture-desktop.mjs …` | Drives the portable release exe over CDP for the 2× desktop screenshots (`launch`, `go`, `shot`, `quit`, …) |
| `node scripts/process-screenshots.mjs` | Turns `captures/` into the AVIF/WebP/JPEG sets under `src/assets/screenshots/` and rewrites `src/content/screenshots.ts` from `shots.config.mjs` |
| `node scripts/og-image.mjs` | Renders `public/og.png` from the site's own tokens and font |
| `node scripts/icons.mjs` | Regenerate the favicon set from `src-tauri/icons/app-icon.svg` |
| `node scripts/release-info.mjs` | Refresh `src/generated/release.json` from the newest release (needs `GH_TOKEN`) |

`verify-dist.mjs` fails the build for a rooted URL without `/Karasu/`, an
external script or stylesheet, a link to a file that is not in `dist`, an
image without `alt` or dimensions, an image over 250 kB, or more than 100 kB
of gzipped JavaScript.

## Layout

```
src/
  entry-client.tsx  entry-server.tsx  App.tsx  NotFound.tsx  head.ts
  site.config.ts        every URL and the nav, in one place
  styles/               index.css (site layer), tokens.generated.css, fonts.css
  components/ui/        button, card, pill — copies of the app's, on purpose
  components/           KarasuMark and the site's own pieces
  sections/             one file per section of the page
  content/              copy and data the sections render
  generated/            release.json (committed fallback; CI overwrites it)
  assets/               the mark, the katakana, the processed screenshots
  dev/                  the sample page; never bundled
scripts/                sync-tokens, prerender, verify-dist, release-info, icons, snap, captures
public/                 favicons, fonts (SN Pro, OFL), robots.txt, .nojekyll
captures/               raw screenshots; ignored
CONTENT-AUDIT.md        every claim on the page and the file that makes it true
```

## Review checkpoints

Nothing on the page is final until the maintainer has seen it. The order:
structure, tokens and type, the hero scene, the full desktop page, the
screenshot session, mobile and ultrawide, the copy against the audit, then
Lighthouse and the first deploy.
