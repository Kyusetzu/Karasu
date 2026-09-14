# design-sync notes for Karasu

Repo-specific facts a re-sync needs. The converter runs from the repo root; the app is not a component package, so the entry is a hand-kept barrel.

- **Entry is `src/ds.ts`** (`--entry src/ds.ts`), re-exporting the `src/components/ui/` primitives plus `KarasuTheme` from `src/ds-theme.tsx`. A new primitive is synced by adding it to the barrel AND to `componentSrcMap` in config.json (the barrel has no `.d.ts`, so discovery is the map).
- **`KarasuTheme` is the provider** (`cfg.provider`). It does what `stores/theme.ts` `apply()` does — `data-theme`/`data-density` on `<html>`, the accent ramp through `lib/contrast.accentShades`, the status colour vars — and initialises i18n through `setLanguageSetting` (default `en`). The innermost nested one wins, which is what lets its own preview card show light and a second accent under the dark provider wrap.
- **The stylesheet is the app's compiled CSS**, not `index.css`: `cfg.buildCmd` = `npm run build && node .design-sync/app-css.mjs`, which copies `dist/assets/index-*.css` to `.design-sync/.cache/app.css` with the `/assets/`-relative `@font-face` rules stripped (they cannot resolve outside Vite). Consequence: only utilities the app uses exist in designs — the conventions header says so.
- **Fonts** come from `.design-sync/fonts.css` (`cfg.extraFonts`), pointing at `node_modules/@fontsource/{sn-pro,kosugi-maru}`. The 1.44 MB Kosugi Maru subset ships; it backs `font-brand-jp`.
- **Render check** runs through system Edge: `DS_CHROMIUM_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"` with the `playwright` package installed in `.ds-sync/` under `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. No chromium download on this machine.
- **`@/i18n` must be imported as `@/i18n/index`** in anything the converter bundles — the story-import plugin resolves the alias to the directory and fails.
- **Previews** are all authored (`.design-sync/previews/*.tsx`, 21 files); none generated. Stateful/open states (MultiFilterSelect open, SeasonPicker open, Input clear pressed) are not previewed — they need interaction.

- **Screen references** live in `.design-sync/screens/` (index.json + one JPEG each, 1440 wide for desktop, 608 for the phone) and are emitted by `node .design-sync/screens.mjs` into `ds-bundle/components/screens/<Name>/` (card + prompt + image) and `guidelines/screens.md`. **Run it after the converter and before the upload** — the converter wipes `ds-bundle/`, and the close-out deletes any remote path the local bundle lacks. New captures: `site/scripts/capture-desktop.mjs` on the rig (`MSYS_NO_PATHCONV=1` in Git Bash, or `#/` becomes a Program Files path), `adb exec-out screencap -p` on the phone, then `screens.mjs --import <dir>`. Signed-out screens: move the rig's `token.dat` aside (never sign out — that clears the shared credential), and set `profile_mode` back to `anilist` in the rig's kv afterwards, since a token-less start writes `local`.

## Known render warns

- `✗ count mismatch: N previews vs 21 components` from `package-validate.mjs` once the screen cards are in the bundle — the validator counts every `components/*/*/` html; the driver's own validate runs before `screens.mjs` and is clean. Not a defect.

- `[RENDER_THIN] Modal: rendered height is 0px` — the dialog is `fixed inset-0`; the screenshot shows it fine. Benign.
- `[RENDER_THIN] KarasuTheme: variants render identically` — the three cells share their DOM text and differ only in theme/accent colour; the sheet shows dark, light and green. Benign.

## Re-sync risks

- `dist/assets/index-*.css` must be fresh: run `cfg.buildCmd` before the converter whenever `index.css` or any component's classes changed, or designs get yesterday's utilities.
- `KarasuTheme` mirrors `stores/theme.ts` `apply()` by hand; a new root variable there (a new status colour, a new wash) needs the same line in `src/ds-theme.tsx`.
- The Playwright/Edge pairing depends on the installed Edge; a major Edge update that Playwright's `chromium` launcher rejects shows up as `[RENDER_SKIPPED]`.
- `fonts.css` paths are `node_modules`-relative; a fontsource version that moves its `files/` breaks `[FONT_DANGLING]`.
