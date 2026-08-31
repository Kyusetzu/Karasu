# Karasu — Architecture Map

Audit reference map, produced 2026-08-31 against commit `94e12cf` on
`claude/karasu-release-audit-l2rksb`, app version **0.190.0.498**.

This document is descriptive, not prescriptive: it records what the code *is* so
that the findings in the sibling reports can be read without re-deriving the
system. Line numbers are approximate anchors, accurate at the audited commit.

---

## 1. Scale

| Area | Files | Lines |
|---|---:|---:|
| Rust backend (`src-tauri/src`) | 47 | 21,434 |
| Frontend (`src`) | 318 | ~59,900 |
| Tracked files (whole repo) | 530 | — |
| Rust tests | 305 fns / 32 modules | — |
| Frontend tests | 86 files / 935 tests | — |

Stack: Tauri 2 (Rust, WebView2/WebKitGTK) · React 19 + TypeScript 7 + Vite 8 ·
TanStack Query 5 · Zustand 5 · react-router 8 (HashRouter) · Tailwind 4 ·
i18next · SQLite via rusqlite (bundled) · AniList GraphQL as the only backend.

Platforms: Windows and Linux (x86_64) plus Android (sideloaded APK). No hosted
backend exists or may exist.

---

## 2. Frontend

```
src/
├── app/          App.tsx (routes, deep links, shell) · main.tsx (QueryClient, error hooks) · index.css
├── api/          anilist.ts (IPC surface) · queries.ts · social.ts · franchise.ts · library.ts
│                 diagnostics.ts · types.ts
├── components/
│   ├── ui/       18 primitives with no app knowledge
│   ├── shell/    14 — Titlebar, Sidebar, Bell (757 ln), CommandPalette, SyncPanel, Toast, GlobalKeys
│   ├── media/    14 — EntryEditModal, NowPlayingCard, CoverCell, MediaCard, RecommendedSection
│   ├── overlays/ 12 — MatchPicker, SignInMerge, SeasonSplitModal, ReviewComposer, …
│   ├── list/     10 — VirtualGrid, ListRow, GridCard, BulkBar, columns.ts
│   ├── social/   14 — ActivityCard, CommentTree, Markdown, UserList, FollowButton
│   ├── stats/    10 — Charts.tsx, panels, Heatmap, AreaChart, DotPlot
│   └── root      ErrorBoundary · RichText · EmptyState · Skeleton · FilteredNotice · KarasuMark
├── hooks/        24 hooks (useListMutations 401 ln, useManualSync, usePrimedLists, useSyncStatus, …)
├── i18n/         index.ts + en.ts (1,557) + de.ts (1,557, typed `de: typeof en`)
├── lib/          67 pure modules, 65 with a co-located test
├── pages/        18 pages + 8 settings panes
├── stores/       auth · nowPlaying · theme · library · contentFilter · platform · toast
└── test/         render.tsx (providers, signIn/signOut fixtures)
```

### 2.1 Routes and mount cost

`HashRouter`; `<main key={pathname}>` and `<ErrorBoundary key={pathname}>` force a
full remount per route. Eager: Dashboard, MediaList, Search, Seasonal,
AnimeDetail. All others are `React.lazy`.

| Route | Page | Fetches on mount |
|---|---|---|
| `/` | Dashboard | both `mediaList` types + `social/birthdays` |
| `/list`, `/manga` | MediaList | `["mediaList", type, userId]` |
| `/search` | Search | `genreTags` (Infinity stale) + infinite browse/entity searches |
| `/seasonal` | Seasonal | `seasonal` + `seasonHero` |
| `/calendar` | Calendar | `mediaList ANIME` + `calendar[week]` |
| `/stats` | Statistics | `userStats` + `mediaList` (×2) |
| `/wrapped` | Wrapped | `wrapped[viewerId]` composite |
| `/library` | LocalLibrary | `mediaList` + 4 library keys |
| `/media/:id` | AnimeDetail | `mediaDetail`, then deferred episodes/cast/reviews/trends |
| `/franchise/:id` | Franchise | `franchise[rootId]` (BFS, bounded) |
| `/social`, `/user/:name`, `/forum`, `/thread/:id`, `/activity/:id` | social pages | `["social", …]` namespace |
| `/character\|staff\|studio/:id` | Person | `["person", kind, id]` |
| `/settings`, `/about` | Settings (8 panes), About | IPC only |

### 2.2 State

**TanStack Query** — defaults in `src/app/main.tsx:19-35`: `staleTime` 5 min,
`gcTime` 30 min, `refetchOnWindowFocus: false`, retry once except on token
rejection or not-found. Hot key: `["mediaList", type, userId]` with 12 read
sites. `["social", …]` covers the whole profile/forum surface. Eleven
`useInfiniteQuery` sites, all advanced by a button — never by scroll — because
the rate budget is shared with background passes.

**Zustand** — seven stores: `auth` (viewer, mode `anilist|local|none`,
sessionExpired; mirrors into the api-layer caches), `nowPlaying` (detection
state, fed by Tauri events), `theme` (localStorage-backed, applied pre-paint),
`library`, `contentFilter`, `platform`, `toast`.

**Optimistic writes** — `src/hooks/useListMutations.ts`: `save` snapshots per
entry before patching and restores on error; `bulkSave` is one mutation for the
whole selection and *invalidates* rather than restores on a partial failure;
`remove`/`bulkRemove` are not optimistic.

### 2.3 IPC boundary

One gateway for all AniList traffic:

```
component → api/anilist.ts gql() → invoke("anilist_query") → Rust attaches bearer
          → anilist::client (rate limiter) → graphql.anilist.co
```

The access token never crosses IPC. 110 distinct commands are invoked from 12
frontend files (56 of them from `api/anilist.ts`). Eight Tauri events flow the
other way: `now-playing`, `scrobble-state`, `anilist-auth`, `anilist-auth-error`,
`scrobble-done`, `manual-sync`, `notifications-changed`, plus deep-link
`onOpenUrl`.

---

## 3. Rust backend

```
src-tauri/src/
├── lib.rs            module tree, tray, hotkey, setup, generate_handler! (110 commands)
├── commands/         auth · list · playback · prefs · system · update · images  (95 commands)
├── playback/
│   ├── detection/    mod.rs (precedence) · jellyfin.rs · mpv_ipc.rs · profiles.rs
│   │                 media_session/{mod,smtc,mpris}.rs
│   ├── recognition/  parser.rs (release names) · matcher.rs (trigram Dice)
│   ├── relations.rs  anime-relations rules, episode redirects
│   └── scrobbler.rs  1,492 ln — the state machine and poll loop
├── alerts/           airing · sequel · stale · site · notify
├── anilist/          client.rs (rate limiter, error taxonomy) · auth.rs · login.rs
├── db.rs             2,452 ln — schema V1–V17, kv, queue, caches, library tables
├── library.rs        1,903 ln — scanner + 15 commands
├── identify.rs · logging.rs · diagnostics.rs · net.rs · discord.rs
├── widgets.rs · background.rs · backups.rs · portable.rs · keystore.rs · i18n.rs · sync.rs
└── gen/android/      hand-edited: MainActivity, TokenCipher, NotifJob, Widgets, build.gradle.kts
```

### 3.1 Command surface (110)

`auth` 9 · `list` 14 · `images` 1 · `prefs` 15 · `playback` 18 · `system` 29 ·
`update` 9 · `library` 15. Every command takes WebView-supplied arguments; that
is the trust boundary examined in `SECURITY.md`.

### 3.2 Database

Rollback journal (not WAL — `snapshot_to` depends on it), `busy_timeout` 5 s.
Every migration runs through `apply()` (db.rs:493), which wraps the DDL and the
`PRAGMA user_version` bump in one transaction; `has_column()` guards each
`ALTER TABLE ADD COLUMN` step.

| Ver | Adds |
|---|---|
| base | `kv`, `offline_queue` |
| V2 | `list_cache` |
| V3 | `history` (dead by design, kept for validity) |
| V4 | `local_list` (account-free profile) |
| V5 | `notifications` |
| V6 | `library_files` |
| V7 | `local_list.progress_volumes` |
| V8 | `library_match` |
| V9 | `library_override`, `library_unmatched` |
| V10 | `library_suggestion` |
| V11 | `library_redirect` |
| V12 | `detection_override` (separate key space from the library) |
| V13 | `detection_override.episode_offset` |
| V14 | `local_list.started_at/completed_at/private` |
| V15 | `notifications.media_id` |
| V16 | `offline_queue.user_id` + backfill + delete of unattributable rows |
| V17 | seeds `blur_adult` for new installs only |

### 3.3 The scrobbling pipeline

```
scrobbler::spawn (5 s poll, supervised)
 └─ detection::detect_playback           precedence: mpv IPC → Jellyfin → window titles → media session
    └─ build_now_playing
       ├─ parser::parse / parse_manga    (skipped when the source already supplies a parse)
       ├─ candidates_from_cache          (list_cache only — off-list titles have no candidate)
       ├─ detection_override lookup      settles WHICH series
       ├─ shift_episode                  reported + offset, floored at 1
       ├─ matcher::best_match            trigram Dice, season_informed guard
       └─ relations::redirect            decides WHICH entry the episode lands on
 └─ drive_session
    ├─ block_reason        unplaceable_season → AlreadyWatched → EpisodeGap
    ├─ threshold / position_due / auto_arm (GAP_GRACE)
    └─ perform_update → would_regress → commands::save_entry_core
                        ├─ AniList SAVE mutation
                        └─ retryable error ⇒ queue_push_deduped (offline queue)
```

### 3.4 Networking and rate limiting

`net.rs` is the single `reqwest` client seam. `anilist/client.rs` holds one
shared rate limiter (SEED 30, RESERVE 2, 60 s window, 400 ms slice, 5 s max
pace) used by *every* caller: frontend passthrough queries, scrobbler writes,
the four alert passes, `identify.rs`, and the library scan. Errors are classified
into `Network | Auth | Retryable | Api`; `is_retryable()` is what decides whether
a failed write becomes a queued edit.

### 3.5 Background work

| Loop | Interval | First run | Supervised |
|---|---|---|---|
| scrobbler / detection | 5 s | immediate | yes |
| airing watcher | 20 min | +30 s | yes |
| site notification summary | 60 s tick | +45 s | yes |
| stale / on-hold reminder | 6 h | +90 s | yes |
| sequel watcher | 12 h | +120 s | yes |
| daily backups | 1 h wake | — | yes |
| anime-relations loader | one-shot, 7 d cache | — | **no** |
| widget projection | one-shot | +3 s | no |

`logging::supervise` restarts a panicked loop up to five times with doubling
backoff, then gives up with a log line.

### 3.6 Token storage

| Platform / mode | Where |
|---|---|
| Windows, Linux (normal) | OS credential store (`keyring`) |
| Windows (portable) | `data/token.dat`, DPAPI |
| Linux (portable) | `data/token.dat`, XChaCha20-Poly1305 (`KRSU1`), key in Secret Service |
| Android | Keystore-sealed file (`KRSA1`, AES-256-GCM via `TokenCipher.kt` over JNI) |

Login uses the implicit OAuth grant against a localhost callback on port 46231
with a single-use `state` nonce; no client secret exists anywhere in the tree.

---

## 4. Infrastructure

**Build** — `npm run verify` = `tsc --noEmit` && `vitest run` && `cargo test`.
Vitest runs two projects selected by filename: everything is `node` unless the
file is named `*.dom.test.tsx`, which boots jsdom.

**CI** (`.github/workflows/ci.yml`) — pull requests only; a Windows job
(verify + NSIS bundle) and a Linux job on ubuntu-22.04 (verify + AppImage). The
Linux job is the only place Linux-only Rust code is compiled.

**Release** (`.github/workflows/release.yml`) — pushes to `main` and `v*` tags.
Three jobs: `build-linux`, `android-build` (release-signed only when the four
`ANDROID_*` secrets exist), and `build-and-publish` on Windows, which is the only
job with write permission. It resolves the release target, rebuilds signed,
generates `latest.json`, writes `SHA256SUMS.txt`, submits to VirusTotal, moves
the rolling `latest` tag and prunes stale assets.

**Update system** — one endpoint per channel; `latest.json` spells the commit
number as semver build metadata (`0.190.0+498`) because the plugin's parser
rejects a fourth dotted segment, and `download_pending_update` supplies an
explicit `version_comparator` so a running four-part build is compared
correctly. Android deliberately has no updater.

**Versioning** — `MAJOR.MINOR.PATCH.COMMIT#`; `scripts/bump-version.mjs` moves
all five locations (three manifests, `COMMIT_NUMBER`, `Cargo.lock`) atomically.

---

## 5. Trust boundaries and external surfaces

| Boundary | What crosses it | Notes |
|---|---|---|
| WebView → Rust (IPC) | 110 commands, arbitrary GraphQL documents | the token never crosses back |
| Rust → AniList | authenticated GraphQL | single rate limiter |
| Rust → Jellyfin | user credentials, `/Sessions` polling | LAN plain HTTP supported deliberately |
| Rust → GitHub | update manifest and artifacts | minisign-verified |
| Rust → erengy/anime-relations | rules text | cached 7 days |
| Rust → arbitrary image hosts | AniList bio images | proxied with SSRF guards, returned as `data:` URIs |
| Deep links → app | `anilist.co` URLs, `karasu://`, Android share intents | routed through `lib/anilistUrl` |

No telemetry, no analytics, no hosted backend.
