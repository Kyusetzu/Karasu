# CLAUDE.md

Guidance for AI coding agents (and humans) working in this repository. Karasu is
developed with heavy AI assistance; this file records the conventions and
guardrails those tools are expected to follow. Every change is reviewed and
verified by a human maintainer before it lands.

## Project

**Karasu** is a modern desktop anime & manga tracker built **exclusively for
[AniList](https://anilist.co)**, inspired by the wonderful
[Taiga](https://github.com/erengy/taiga). It detects what you play/read locally
and in the browser and scrobbles your AniList progress automatically.

- **Shell:** Tauri 2 (Rust backend, WebView2)
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4
- **State:** TanStack Query (server), Zustand (client), i18next (i18n)
- **Rendering:** `@tanstack/react-virtual` virtualizes the media lists. Rows are
  chunked by hand, so anything that renders one needs a column count — take it
  from `useColumnCount`, which reads the browser's resolved
  `grid-template-columns` rather than recomputing the CSS in JS
- **Storage:** SQLite via rusqlite (bundled); tokens in the OS credential store
- **Detection:** Win32 window enumeration + Windows media sessions (SMTC) +
  an optional Jellyfin `/Sessions` source, with a custom release-name parser
- **Platforms:** Windows is supported. Linux (Ubuntu) is experimental
  compile-only groundwork — do not assume feature parity there.

## Layout

```
src/
  app/               App.tsx, main.tsx, index.css — the entry, and only the entry
  api/               AniList GraphQL client, queries, types, franchise, library
  components/
    ui/              primitives with no app knowledge (kebab-case files)
    shell/           the window frame and global machinery — titlebar, sidebar,
                     bell, command palette, keyboard sheet, context menu, toast
    media/           anything that renders a title or edits an entry
    overlays/        modal flows (confirm, preset, random pick, sign-in merge)
    list/            the parts MediaList draws (virtual grid, rows, bulk bar)
    stats/           the parts Statistics draws (panels, ranked list, charts)
    EmptyState · Skeleton · KarasuMark — cross-cutting, belong to no group
  hooks/             shared hooks (useListMutations, usePrimedLists,
                     useColumnCount, usePanZoom, useCachedEntry)
  i18n/              index.ts (setup) + en.ts + de.ts; `de: typeof en` enforces
                     key parity across the two files
  lib/               pure logic + its *.test.ts — the place testable code goes
  pages/             one per route; settings/ holds the seven panes
  stores/            Zustand stores (auth, theme, library, nowPlaying, …)
src-tauri/src/
  commands/          the whole frontend-facing surface, 62 commands by subject:
                     auth · list · playback · prefs · system · update.
                     `mod.rs` re-exports all of it, so `commands::x` paths and
                     `generate_handler!` do not care which file a command is in
  playback/          the pipeline: detection/ (Win32 windows, SMTC, Jellyfin) →
                     recognition/ (release-name parser, fuzzy matcher) →
                     relations (episode redirects) → scrobbler (when to write)
  alerts/            the background passes that end in a notification —
                     airing, sequel, stale, and notify itself
  anilist/           auth (token handling), API client
  db.rs              SQLite: PRAGMA user_version migrations + row helpers
  discord.rs · library.rs · portable.rs
scripts/             bump-version.mjs (every commit), anilist-query.mjs
                     (validate a query live); release/ holds the two PowerShell
                     scripts the release workflow runs
```

**Where things go.** `lib/` is pure logic with tests beside it; `hooks/` is
React glue; a component's folder is its answer to "what am I" — a `ui/`
primitive knows nothing about Karasu, `shell/` is the frame around every screen,
`media/` renders titles, `overlays/` opens over things. On the Rust side a
folder exists only when it holds more than one file, and a command's file is
its subject, not its age.

## Hard constraints (do not violate)

- **No hosted backend, ever.** Karasu is a local app talking directly to the
  AniList GraphQL API. Never introduce a server we would have to run.
- **AniList client secret is never embedded.** Login uses the implicit OAuth
  grant only. A built-in *client id* (`BUILTIN_ANILIST_CLIENT_ID` in
  `commands/auth.rs`) is fine; a *secret* is not.
- **The access token stays in the Rust backend.** It must never be exposed to
  the WebView / frontend JS.
- **i18n key parity.** `de` is typed `de: typeof en`, so every English key needs
  a German counterpart. Add both, or `tsc` fails.
- **AniList rate limit (~30 req/min).** Batch requests (`Page.media(id_in:)`,
  ≤50 ids) and bound BFS/traversal work; never fan out unboundedly.

### Explicitly rejected — never implement (or propose)

Activity/playback-history expansion, **manga cost tracking** (what a collection
was worth or what it was bought for), settings cloud-sync, and anything that
would require a hosted backend. If a requested feature depends on any of these,
flag the dependency rather than silently building around it.

Read *volumes* (`progressVolumes`) is not on this list and never was — it is one
of AniList's own list fields, it costs nothing to carry, and the local list has
stored it since schema v7. The rejected idea is tracking **purchases**, which
would need price data the app has no source for.

The schema is at **v8**; `library_match` holds the scanner's per-title match
confidence, which is what the local library's `exact` / `close` column reads.

## Versioning (every commit)

Four-part scheme **`MAJOR.MINOR.PATCH.COMMIT#`**:

- **MAJOR** — breaking changes
- **MINOR** — new backward-compatible features
- **PATCH** — bug fixes / patches
- **COMMIT#** — a monotonically increasing commit counter (`+1` every commit)

The three manifests (`package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`) carry the `MAJOR.MINOR.PATCH` semver core. The 4th
segment lives in `COMMIT_NUMBER` in `src-tauri/src/commands/update.rs`;
`app_version()` returns the full `MAJOR.MINOR.PATCH.COMMIT#` string, which the
About window always displays. **Bump the appropriate segment and the
`COMMIT_NUMBER` on every commit** — via `scripts/bump-version.mjs`, which also
keeps `Cargo.lock` in step; see "The commit loop" below. The update check
compares all four segments, COMMIT# included, so a commit-only bump still
registers as an update.

**`latest.json` spells the commit number as semver build metadata**
(`0.23.2+90`), not as a fourth dotted segment — see
`scripts/generate-update-manifest.ps1`. `tauri-plugin-updater` parses that field
with `semver::Version::from_str`, which rejects `0.23.2.90` outright and makes
every install fail with *"unexpected character '.' after patch version number"*.

That fix alone isn't enough, so `download_pending_update` also supplies an
explicit `version_comparator`. The plugin's default compares the manifest
against `package_info().version` — which comes from `Cargo.toml` and therefore
has **no commit number** — so the running `0.23.2.90` reaches it as a bare
`0.23.2`, and the manifest for that same build (`0.23.2+90`) sorts above it:
the app would download and reinstall itself on a loop. The comparator supplies
`COMMIT_NUMBER` as the running commit number instead. `version_parts` in
`commands/update.rs` treats `+` and `.` alike so both spellings compare equal.
**Don't "tidy" that `+` back into a dot, and don't drop the comparator.**

## The commit loop

Three commands, in this order. Don't do any of it by hand.

```sh
node scripts/bump-version.mjs patch   # minor for features, major for breaks
npm run verify                        # typecheck + vitest + cargo test
git commit                            # message ends with the Co-Authored-By trailer
```

**`scripts/bump-version.mjs`** moves the version in all five places at once —
the three manifests, `COMMIT_NUMBER`, and `Cargo.lock`. It prints the resulting
four-part version on stdout (so a commit subject can be filled without a second
grep) and refuses to run when the tree holds nothing but version files, since a
bump with nothing to describe is a mistake or a double-run. `--force` overrides
that, `--print` just reports the current version.

**`npm run verify`** is the whole gate and is what CI runs, so the two cannot
drift. It short-circuits, so a type error stops it before the tests.

For build-affecting changes — dependencies, `tauri.conf.json`, anything in the
bundle — also run `npm run tauri build` as a smoke check. On Windows only the
NSIS bundle builds; `deb`/`appimage` are correctly skipped.

Prefer extracting pure logic into `src/lib/*.ts` (or a pure Rust fn) and unit
testing it. Untestable-by-construction logic in a component is the usual reason
a regression here is invisible until it ships.

### Notes that have cost real time

- **`npm test` already means `vitest run`.** `npm test -- --run` is redundant.
- **Validate AniList fields live before wiring them**, per the convention below,
  with `node scripts/anilist-query.mjs <CONST> '<variables-json>'`. It reads the
  constant off disk, so it checks the query the app actually ships.
- **Control characters in source must be written as an escape and then
  verified.** An editing tool can emit a literal control byte where `\u0000`
  was intended; the file then reads back looking correct while every subsequent
  exact-match edit on that line mysteriously fails to apply. `src/lib/search.ts`
  contains one on purpose. Check with `grep -c $'\0' <file>` after writing.
- **A suite that finishes far faster than usual failed early, it did not get
  faster.** The Rust suite takes ~0.5 s; a 0.02 s run means something bailed.
- **Never pipe `npm run verify` through `grep`.** The pipe reports *grep's*
  exit status, so a `tsc` failure sails through and gets committed. Run it bare
  and read the exit code.
- **A missing i18n key renders as the key.** i18next does not throw and does not
  fall back, so `entry.scoreHint` appears on screen and nothing reports it.
  `src/lib/i18nKeys.test.ts` resolves every literal `t("…")` in the source; the
  `de: typeof en` type covers the other direction.

## Conventions

- **One commit per feature.** The maintainer commits per feature; keep changes
  scoped. Commit messages end with the `Co-Authored-By:` trailer.
- **Validate AniList queries live** before wiring new fields (introspection /
  a throwaway Node script), since the schema is the source of truth.
- **DB changes go through a new `MIGRATION_V*`** guarded by PRAGMA
  `user_version`; add a `mem_db()` test.
- **Platform-specific Rust is `#[cfg(...)]`-gated** with a non-Windows fallback
  so the crate still compiles on Linux.
- **Accent colours** derive shades + a readable ink colour (`src/lib/contrast.ts`);
  use `text-accent-ink` on accent-filled controls rather than hard-coded
  `text-white`.
- **Overlays carry `data-overlay`.** Screen-level key handlers check for it and
  stand down, so a dialog owns the keyboard instead of the list behind it acting
  on the same press.
- **Statistics scores are normalized in `userStatistics`.** AniList mixes a
  hundred-point `meanScore` with a distribution in the user's *display* format,
  and says so nowhere. Everything downstream is ten-point.

## Performance invariants

Each of these looks like cruft and is not. They were measured; don't "tidy"
them away without re-measuring.

- **`@font-face` is hand-written in `index.css`.** Importing the `@fontsource`
  stylesheets instead pulls a woff fallback WebView2 will never use — 1.83 MiB
  of Kosugi Maru on the installer and every auto-update. Not the `400.css`
  variant either: it is 122 unicode-range subsets totalling 7.9 MB.
- **`reqwest` enables `gzip` and deliberately not `brotli`.** AniList prefers
  `br` when offered both, and `br` measured *larger* than gzip on the list
  payload.
- **The list and grid queries must not ask for `coverImage.extraLarge` or
  `bannerImage`** — nothing renders them there. They belong to `DETAIL_QUERY`.
  **`synonyms` must stay**: local mode re-serves the stored media object and
  `MediaList` spreads it.
- **`RecommendedSection` sorts `seedIds` before using them as a query key.**
  `pickSeeds` orders by score then `updatedAt`, so an unsorted array reshuffles
  on any save and mints a new key, defeating its own cache.
- **`usePrimedLists` uses `setQueryData(..., { updatedAt: 0 })`.** The
  backdating is what keeps the primed entry stale so the mounting `useQuery`
  still refetches; without it the list stops updating for a whole `staleTime`.
- **`mediaList` invalidation is scoped to the media type that changed.** The
  `scrobble-done` listener reads that type from the store at fire time (not
  from a closure) and **must** keep its fallback to the broad key — otherwise an
  absent type leaves one list silently never refreshing.
- **The Wrapped poster is laid out in `em` and measured twice** — once at
  `em = 1` for its natural height, then drawn at the size that fills the
  preset's crop. `drawMark` places the mark by its **centre**: corner anchoring
  is what once left 52% of the bird outside the page.
- **`matcher::prepare` preserves candidate and title order**, keeps the empty
  trigram-set guard (a NaN score pins `best` forever) and keeps the exact-match
  short circuit. `matcher.rs`'s equivalence test checks the optimized path
  against a copy of the original algorithm — keep that copy honest.
