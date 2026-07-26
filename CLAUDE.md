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
- **Storage:** SQLite via rusqlite (bundled); tokens in the OS credential store
- **Detection:** Win32 window enumeration + Windows media sessions (SMTC) +
  an optional Jellyfin `/Sessions` source, with a custom release-name parser
- **Platforms:** Windows is supported. Linux (Ubuntu) is experimental
  compile-only groundwork — do not assume feature parity there.

## Layout

```
src/                 React frontend
  api/               AniList GraphQL client, queries, types, franchise loader
  components/        UI components (Bell, ContextMenu, EntryEditModal, …)
  pages/             Route pages (Dashboard, MediaList, Franchise, Wrapped, …)
  stores/            Zustand stores (auth, theme, library, nowPlaying)
  lib/               Pure logic + its *.test.ts (tags, contrast, format, wrapped,
                     recommend, contentFilter, …)
  i18n.ts            en (primary) + de; `de: typeof en` enforces key parity
src-tauri/src/       Rust backend
  commands.rs        Tauri commands, AniList list/save mutations, version
  db/                SQLite: PRAGMA user_version migrations + row helpers
  anilist/           auth (token handling), API glue
  detection/         mod.rs (Win32 window enumeration, cfg-gated for Windows),
                     profiles.rs (player/site matching), smtc.rs (Windows media
                     sessions), jellyfin.rs (optional /Sessions source)
  discord/           Discord Rich Presence
  notify/            notify(app, kind, title, body) → row + toast + event
  airing/ stale/ sequel/   background alert passes
```

## Hard constraints (do not violate)

- **No hosted backend, ever.** Karasu is a local app talking directly to the
  AniList GraphQL API. Never introduce a server we would have to run.
- **AniList client secret is never embedded.** Login uses the implicit OAuth
  grant only. A built-in *client id* (`BUILTIN_ANILIST_CLIENT_ID` in
  `commands.rs`) is fine; a *secret* is not.
- **The access token stays in the Rust backend.** It must never be exposed to
  the WebView / frontend JS.
- **i18n key parity.** `de` is typed `de: typeof en`, so every English key needs
  a German counterpart. Add both, or `tsc` fails.
- **AniList rate limit (~30 req/min).** Batch requests (`Page.media(id_in:)`,
  ≤50 ids) and bound BFS/traversal work; never fan out unboundedly.

### Explicitly rejected — never implement (or propose)

Activity/playback-history expansion, manga volume/cost tracking, settings
cloud-sync, and anything that would require a hosted backend. If a requested
feature depends on any of these, flag the dependency rather than silently
building around it.

## Versioning (every commit)

Four-part scheme **`MAJOR.MINOR.PATCH.COMMIT#`**:

- **MAJOR** — breaking changes
- **MINOR** — new backward-compatible features
- **PATCH** — bug fixes / patches
- **COMMIT#** — a monotonically increasing commit counter (`+1` every commit)

The three manifests (`package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`) carry the `MAJOR.MINOR.PATCH` semver core. The 4th
segment lives in `COMMIT_NUMBER` in `src-tauri/src/commands.rs`;
`app_version()` returns the full `MAJOR.MINOR.PATCH.COMMIT#` string, which the
About window always displays. **Bump the appropriate segment(s) and the
`COMMIT_NUMBER` on every commit.** The update check compares all four segments,
COMMIT# included, so a commit-only bump still registers as an update.

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
`commands.rs` treats `+` and `.` alike so both spellings compare equal.
**Don't "tidy" that `+` back into a dot, and don't drop the comparator.**

## Verification (per commit)

Run and keep green before committing:

```sh
npm run typecheck                                  # TypeScript
npm test                                           # frontend unit tests (vitest)
cargo test --manifest-path src-tauri/Cargo.toml    # backend tests
```

For build-affecting changes, also run a `npm run tauri build` smoke check.
Prefer extracting pure logic into `src/lib/*.ts` (or a pure Rust fn) and unit
testing it. On Windows only the NSIS bundle builds; `deb`/`appimage` targets are
correctly skipped.

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
