# CLAUDE.md

Guidance for AI coding agents (and humans) working in this repository. Karasu is
developed with heavy AI assistance; this file records the conventions and
guardrails those tools are expected to follow. Every change is reviewed and
verified by a human maintainer before it lands.

## Project

**Karasu** is a modern anime & manga tracker built **exclusively for
[AniList](https://anilist.co)**, inspired by the wonderful
[Taiga](https://github.com/erengy/taiga). It detects what you play/read locally
and in the browser and scrobbles your AniList progress automatically.

- **Shell:** Tauri 2 (Rust backend; WebView2 on Windows, WebKitGTK on Linux,
  the system WebView on Android)
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4
- **State:** TanStack Query (server), Zustand (client), i18next (i18n)
- **Charts:** drawn by hand in SVG/JSX; `d3-array`, `d3-scale` and `d3-shape`
  supply the maths only — there is no chart library and the renderer stays ours
- **Rendering:** `@tanstack/react-virtual` virtualizes the media lists. Rows are
  chunked by hand, so anything that renders one needs a column count — take it
  from `useColumnCount`, which reads the browser's resolved
  `grid-template-columns` rather than recomputing the CSS in JS
- **Storage:** SQLite via rusqlite (bundled); tokens in the OS credential store
- **Detection:** system media sessions (SMTC on Windows, MPRIS on Linux) +
  Win32 window enumeration (Windows only, with WASAPI pause detection) + an
  optional Jellyfin `/Sessions` source + an opt-in mpv JSON IPC socket (the
  real file path and a live position), with a custom release-name parser
- **Platforms:** Windows and Linux (x86_64), plus Android (sideloaded APK;
  arm64 is the one that matters). Window-title detection is Windows only —
  there is no X11/Wayland enumerator and Wayland forbids one — so on Linux the
  media-session pass and Jellyfin are the whole of detection, and browser *tab*
  titles are only seen where the browser publishes MPRIS. On Android detection
  is Jellyfin alone, decided in the first device round: the desktop detection
  machinery is greyed out in Settings under a "desktop only" badge, never
  hidden. Two different keys, and they must not swap: the *shell shape* is
  width-keyed (`usePhoneShell`, 767px), while *capability* gating — the badge,
  the hidden Library/Desktop panes, the bottom bar's missing library — is
  platform-keyed (`isAndroid` over `platform_info`), because a narrowed
  desktop window still has SMTC and a filesystem, and an Android tablet at
  desktop width still has neither.

## Layout

```
src/
  app/               App.tsx, main.tsx, index.css — the entry — plus motion.tsx
                     and motionFeatures.ts, the one door to Motion
  api/               AniList GraphQL client, queries, types, franchise, library,
                     social (the whole profile/follow/forum surface);
                     bindings.ts is GENERATED from the Rust command signatures
                     and tauri.ts is `unwrap`, the one seam over it — see
                     "The bindings are generated"
  components/
    ui/              primitives with no app knowledge (kebab-case files);
                     popover is the anchored dropdown / phone sheet the list
                     toolbar's panels open in
    shell/           the window frame and global machinery — titlebar, sidebar,
                     bottom bar, back button, bell (the titlebar's glance, the
                     phone's NotifSheet and the NotifFeed rows both share with
                     the notifications page), command palette, keyboard
                     sheet, global keys, toast, first run, session expired, the
                     sync panel, the pull-to-sync indicator, the detection pill
                     and the floating detection window, and the action host,
                     which owns right-click and long press and renders the context
                     menu or the action sheet over one resolved list of actions
                     (actionIcons/actionLabels are its two lookup tables)
    media/           anything that renders a title or edits an entry
    overlays/        modal flows (confirm, preset, random pick, sign-in merge,
                     profile edit, match picker, favourites, new thread,
                     season split, cover viewer, review composer)
    list/            the parts MediaList draws (the header's ListToolbar and
                     the phone's ListMoreMenu, virtual grid, rows, bulk bar)
                     plus VirtualRows, the flat-list twin of VirtualGrid — the
                     local library runs several of them in one scroller, so
                     each measures its own `scrollMargin`
    stats/           the parts Statistics draws — panels, ranked list, Charts
                     (radar/sunburst/treemap), AreaChart, DotPlot, GradientBars,
                     Heatmap
    social/          the parts UserProfile, Social and Thread draw — the
                     markdown renderer, follow button, user and activity and
                     thread rows, and the two composers
    EmptyState · Skeleton · KarasuMark · FilteredNotice · ErrorBoundary ·
    RichText — cross-cutting, belong to no group; FilteredNotice is the
    content filter's one disclosure line, so the three surfaces that show it
    cannot drift apart
  hooks/             shared hooks (useListMutations, usePrimedLists,
                     useColumnCount, useRowTier, useListSummary, usePanZoom,
                     useCachedEntry, usePresence, useViewTransitions,
                     useAniListLogin, useFollow, useSocialActions,
                     useFavourite, useActivityPost, useUpdateUser,
                     usePhoneShell, useShortViewport, useElementWidth,
                     useBackClose, useNotifBadge, useNotifications,
                     useDialogFocus,
                     useGridRoving, useSyncStatus, useManualSync,
                     usePullToSync, useActionRunner, useCachedMedia,
                     useDetectionMedia, useDetectionDrag, useElementSize)
  i18n/              index.ts (setup) + en.ts + de.ts; `de: typeof en` enforces
                     key parity across the two files
  lib/               pure logic + its *.test.ts — the place testable code goes
  pages/             one per route; settings/ holds the pane files — the eight
                     pane ids live in `lib/settingsPanes.ts`, and the desktop
                     and data panes are sections exported from AdvancedPane
  stores/            Zustand stores (auth, theme, library, nowPlaying, …)
  assets/            karasu-mark.svg, the one asset the bundle inlines
  test/              render.tsx — the provider wrapper and sign-in helpers for
                     the jsdom project, and nothing in the node project imports it
src-tauri/src/
  commands/          102 of the 126 frontend-facing commands, by subject:
                     auth · images · list · playback · prefs · system ·
                     update. The other 24 are the library scanner's 15 in
                     `library.rs` and the Android updater's 9 in
                     `apk_update.rs`.
                     `mod.rs` re-exports all of it, so `commands::x` paths and
                     `generate_handler!` do not care which file a command is in.
                     Note what is *not* here: the entire social surface adds no
                     command at all, because `anilist_query` in `auth.rs` is a
                     generic authenticated passthrough and the token stays in
                     Rust either way
  playback/          the pipeline: detection/ (Win32 windows + WASAPI audio
                     state, media_session/ — SMTC on Windows, MPRIS on Linux —,
                     Jellyfin with its UDP discovery, the opt-in mpv IPC socket,
                     and profiles: which processes and sites count) →
                     recognition/ (release-name parser, fuzzy matcher) →
                     relations (episode redirects) → scrobbler (when to write)
  alerts/            the background passes that end in a notification —
                     airing, sequel, stale, site (AniList's own notifications
                     as a summary toast), and notify itself
  anilist/           auth (token handling), login (the localhost OAuth
                     callback), client (the limiter), query_cache (v20)
  db.rs              SQLite: PRAGMA user_version migrations + row helpers
  identify.rs        the AniList search pass for titles the local matcher
                     cannot place — 25 per request, capped at 8 requests a
                     scan, scored by the same matcher
  logging.rs         the background log: a bounded in-memory ring for the
                     viewer plus a rotating `karasu.log` beside the database.
                     `scrub` strips credentials on write; `debug_changed` is
                     the per-key dedupe the 5 s detection poll logs through.
                     Owns the panic hook and `supervise`, which puts a panicked
                     background loop back
  diagnostics.rs     the facts a bug report needs, composed from the commands
                     that already know them (never re-derived), plus the
                     Linux-only distro/desktop/session probe
  net.rs             where every outbound HTTP client is born — one seam so a
                     TLS fix cannot miss a builder. Android gets webpki roots
                     with a *named* aws-lc-rs provider (the default-provider
                     lookup panics with two providers in the graph, and
                     rustls-platform-verifier needs a JNI init nothing does);
                     the trade is that user-installed CAs are not honoured on
                     Android, so a self-signed Jellyfin needs plain HTTP there
  gen/android/       generated by `tauri android init` and REGENERATED by it:
                     the hand-edited/hand-written files say so in comments —
                     buildSrc's BuildTask.kt (spawns `node …/tauri.js`
                     directly; Gradle cannot spawn npm shims under nvm4w),
                     MainActivity.kt (native edge-to-edge insets; the WebView
                     cannot see the status bar), app/build.gradle.kts (release
                     signing from gitignored key.properties, falling back to
                     debug signing so CI without secrets still builds, plus
                     the versionCode/versionName read out of `COMMIT_NUMBER`
                     — `tauri.properties` carries only the semver core, so
                     without it a commit-only bump is the same version to
                     Android), and
                     TokenCipher.kt (the Keystore seal `keystore.rs` calls
                     over JNI — init won't overwrite it, but a wiped tree
                     won't recreate it: restore from git), and NotifJob.kt
                     (the JobScheduler half of background notifications —
                     same restore-from-git rule; its NotifScheduler proguard
                     keep is load-bearing, and the manifest's hand-added
                     entries — the NotifJobService `<service>`,
                     RECEIVE_BOOT_COMPLETED, ACCESS_NETWORK_STATE (a job
                     with a connectivity constraint needs it, or
                     `schedule()` throws and the feature is silently dead),
                     and the SEND share-target filter, which sits ABOVE the
                     deep-link markers because that is where the generator
                     leaves it — all sit OUTSIDE those markers, which are
                     rewritten on every build),
                     and Widgets.kt plus its res/ family (karasu_widget
                     layout, widget_bg drawable, styles_widgets,
                     strings_widgets en+de, four xml/widget_* metadata) —
                     the four home-screen widgets, fed by widgets.rs's
                     projection file, with WidgetRefresher's proguard keep
                     load-bearing the same way NotifScheduler's is;
                     and TrackingService.kt (the opt-in foreground service
                     that keeps Jellyfin tracking alive with the screen off,
                     plus the battery-exemption calls — TrackingControl is
                     JNI-by-name like NotifScheduler, so its proguard keep
                     is load-bearing too; the manifest's hand-added
                     FOREGROUND_SERVICE, FOREGROUND_SERVICE_SPECIAL_USE,
                     REQUEST_IGNORE_BATTERY_OPTIMIZATIONS and
                     POST_NOTIFICATIONS, and the `<service>` with its
                     `specialUse` `<property>`, sit outside the markers like
                     the rest; MainActivity's onResume/onPause report the
                     foreground flag through `KarasuNative.setForeground`);
                     and SystemAccent.kt (Material You's primary accent for
                     the theme store, JNI-by-name, proguard keep load-bearing);
                     and UpdateInstaller.kt (the in-app updater's device
                     half — ABI, cache dir, free space, metered state, the
                     signing-certificate comparison and the two intents;
                     JNI-by-name like NotifScheduler, proguard keep
                     load-bearing; REQUEST_INSTALL_PACKAGES sits outside
                     the markers with the rest).
                     Re-apply all of it after any re-init. Also committed here: the bundled copy
                     of THIRD-PARTY-NOTICES.md under app assets — the APK
                     cannot read the repository root, so it carries its own
                     copy, and `src/lib/notices.test.ts` fails the gate when
                     the two differ. Edit both together; the test is what
                     says so when you don't
  background.rs      the dead-app notification check, Android's half: the one
                     symbol NotifJob.kt calls over JNI, in a process where
                     Tauri may never have started — no AppHandle, every
                     dependency taken by hand; shares the site-notification
                     kv vocabulary with alerts/site.rs. Also the live app's
                     Android-only glue the other way round — Rust calling
                     Kotlin statics through the activity's class loader
                     (`with_app_class`): the notification job's schedule,
                     the tracking service, the battery exemption, and the
                     foreground flag the scrobbler's poll cadence reads
  backups.rs         daily local snapshots of karasu.db (`VACUUM INTO`, one
                     per UTC day, newest N kept) — what db.rs falls back to
                     when the file will not open
  i18n.rs            the strings Rust composes (notifications, the bell rows,
                     the tray menu) in the language the user chose
  keystore.rs        Android-Keystore sealing for the two mobile token files —
                     the Rust side of TokenCipher.kt
  sync.rs            lock-taking that survives a poisoned mutex, so a
                     supervised background loop's panic does not take every
                     later lock with it
  widgets.rs         the home-screen widgets' projection file (widgets.json),
                     rewritten whenever the list cache moves; Widgets.kt
                     renders it with no network and no schema knowledge
  apk_update.rs      the Android in-app updater, see "The Android updater"
  discord.rs · library.rs · portable.rs · lib.rs (setup, the handler list,
  the background loops) · main.rs
scripts/             bump-version.mjs (every commit), anilist-query.mjs
                     (validate a query live), android-check.ps1 (the fast
                     cfg(mobile) gate — cargo check for aarch64 with the NDK
                     env exported), windows-check.sh (the same idea for
                     cfg(windows) from a Linux box — a whole-crate cross-check
                     is impossible because aws-lc-sys needs the MSVC headers,
                     so it copies the module into a throwaway crate and checks
                     that), virtual-rows-check.mjs (VirtualRows in a real
                     Chromium — jsdom has no layout, so it mounts zero rows
                     and a unit test there passes vacuously), changelog.mjs
                     (appends the Unreleased section from the commits since
                     its `generated-through` marker; a `Changelog:` trailer
                     overrules the subject), ratelimit-probe.mjs (re-measures
                     the shape of AniList's rate window — stepped, see the
                     notes — one unauthenticated request per sample, needs
                     real egress to graphql.anilist.co), phone-measure.ps1
                     (the adb side of the Android tracking-service
                     measurement: service state, standby bucket, Doze, the
                     notification job, the Kotlin logcat tags, and polls per
                     hour from an exported diagnostics file — the Rust log
                     never reaches logcat, and a release APK is not
                     debuggable, so the export is the only way at it),
                     sample-markdown.mjs and gen-entities.mjs (the markdown
                     fixtures and the entity table, see the notes),
                     comment-audit.mjs, comment-strip-check.mjs,
                     comment-lexer.mjs and comment-allowlist.json (the
                     one-line-comment rule: the gate, the comment-only proof,
                     the shared scanner and the allowed exceptions — see
                     "Comments: one line each"), style-audit.mjs with
                     style-baseline.json and style-allowlist.json (the class
                     vocabulary's ratchet, see "Design language"),
                     bundle-budget.mjs and bundle-budget.json (the gzipped
                     bundle against its budget, a push-gate phase),
                     screens.mjs with screens/ (the real app over a mocked
                     backend in Chromium: shots, boards, clips and pixel
                     hashes, see "Design language"),
                     verify.mjs (the gate, see
                     "The commit loop"), toml-check.mjs (taplo over the
                     TOML files, one per stdin — see the same section),
                     mutants.mjs (cargo-mutants in a copy tauri-build can
                     still configure, see "Three Cargo tools"),
                     clean-target.mjs (reclaims the
                     stale incremental sessions every version bump leaves
                     under `src-tauri/target`, see the notes);
                     release/ holds the nine PowerShell scripts
                     the release workflow runs (installer, AppImage, Linux
                     package and APK renamers are deliberate near-twins,
                     slim-appimage — see "The commit loop" —,
                     release-notes, flatpak-manifest, fdroid-recipe, and
                     generate-update-manifest, whose Android legs feed the
                     APK updater — see "The Android updater")
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
  the WebView / frontend JS. Where it rests differs by platform and is written
  down in SECURITY.md: OS credential store on desktop, DPAPI/XChaCha20 files
  in portable mode, and on Android a Keystore-sealed file (`keystore.rs` +
  `TokenCipher.kt`, `KRSA1 || iv || ct`, key hardware-backed; a plaintext
  token from an older build migrates in place on first read).
- **i18n key parity.** `de` is typed `de: typeof en`, so every English key needs
  a German counterpart. Add both, or `tsc` fails.
- **AniList rate limit (~30 req/min).** Batch requests (`Page.media(id_in:)`,
  ≤50 ids) and bound BFS/traversal work; never fan out unboundedly. The
  budget is one shared pool, so every request names its spender and the
  cheap answer is the cached one — see "The request budget" below.

### Explicitly rejected — never implement (or propose)

Activity/playback-history expansion, **manga cost tracking** (what a collection
was worth or what it was bought for), settings cloud-sync, and anything that
would require a hosted backend. If a requested feature depends on any of these,
flag the dependency rather than silently building around it.

Two more, decided by the maintainer in August 2026:

- **Plex and Emby integration.** The maintainer uses Jellyfin (free, open
  source) and has no use for supporting a paid product he doesn't run.
  Revisit only if actual users ask for it — do not propose it unprompted.
- **Windows code signing through SignPath, and a winget manifest.** Both were
  on the tooling backlog and were struck by the maintainer on 2026-09-20 for
  good: the installer stays unsigned (the README, the release notes and the
  website say so, and keep saying so), and there is no winget package. Do not
  propose either again; the SmartScreen paragraph in the README is the
  answer to the question it raises.
- **RSS/torrent release feeds, and anything piracy-adjacent.** New releases
  are already reported through AniList's own airing data. The local library
  is the user's own files; how they got there is not the app's business, and
  nothing in Karasu may track, fetch, or point at torrents or release feeds.
  This closes the classic Taiga feature deliberately.

**The log is a deliberate exception to the first of those, decided by the
maintainer.** With verbose logging on, `karasu.log` records what detection saw —
window and session titles, the parsed release name, the matched id and score,
each redirect, and every scrobble phase change. That is a playback history by
construction. It was raised as a conflict and kept on purpose: an unreportable
bug is worse than a local file the user controls. Do not delete the debug lines
on the strength of the line above; they are what makes the toggle, its hint and
the diagnostics report true.

What is *not* carved out: no history UI, nothing queryable, nothing that
survives log rotation (~1 MB, one kept generation), and nothing uploaded
anywhere. And the volume is bounded on purpose — the detection poll runs every
5 s, so the per-tick lines go through `logging::debug_changed`, which records a
line only when it differs from the last one under the same key. A plain `debug`
in `detect_playback` or `media_session::detect` is 17,280 lines a day and
rotates the interesting part off disk; that is a bug, not a style preference.

**The AniList social surface is the second deliberate exception, also decided by
the maintainer.** Karasu reads AniList's own activity feed on `/social` and on
every profile — list activities, text activities, replies and likes — and can
post a status update through `SaveTextActivity`. That is activity expansion by
construction. It was raised as a conflict with the line above, the narrower
read-only option was offered and declined, and the whole surface was kept on
purpose: this is AniList's data rendered by an AniList client, and a tracker that
can read a friend's list but cannot show that they finished the show is a worse
client than the website it replaces. **Do not delete the feed, the composer or
the activity queries on the strength of the line above.** `/activity/:id`
renders one activity through the same fragments and normalizer as the feed —
the bell's activity notifications land there, names go to profiles — and
`MessageActivity` stays excluded on that page the same three ways.

What is *not* carved out, and these are the load-bearing half of the exception:

- **No local activity store.** Nothing in SQLite, no schema version, nothing
  that survives a restart. Every activity on screen came from a
  `Page.activities` request in this session and goes when the query cache does.
- **Playback history is still what the rejection means, and is still rejected.**
  The scrobbler does not write activities, `karasu.log` remains the only record
  of what detection saw, and nothing correlates the two. A "what did I watch
  last month" screen built from either is the thing being refused.
- **`MessageActivity` is never rendered.** It is private mail between two users,
  and it is excluded three ways — absent from `type_in`, given no inline
  fragment, and normalised to null with a test that says so.
- **Paging is user-initiated by design.** A feed that fetches on scroll spends a
  ~30/min budget shared with the scrobbler and the alert passes without anyone
  asking it to, and the limiter cannot see a burst it has not sent. Every page
  past the first is a button; see the Conventions note.

Read *volumes* (`progressVolumes`) is not on this list and never was — it is one
of AniList's own list fields, it costs nothing to carry, and the local list has
stored it since schema v7. The rejected idea is tracking **purchases**, which
would need price data the app has no source for.

The schema is at **v20**. `library_match` (v8) holds the scanner's per-title
match confidence, which is what the local library's `exact` / `close` column
reads. v9 adds `library_override` — the user's corrections, keyed on the parsed
`(title, season)` with `season = -1` for a release name that carried none, and
never cleared by a scan — plus `library_unmatched`, so the unplaced list
survives a restart. v10 adds `library_suggestion`, AniList's guess for a title
the matcher cannot place; it is applied only once confirmed, at which point it
becomes an ordinary override and the row reads `yours` rather than
`exact`/`close`. v11 adds `library_redirect` — confirmed season splits, keyed
on the parse plus a **disk** episode range. The command that writes them
(`set_library_redirect`) is keyed on `(media_id, current-frame range)` — the
numbers the row displays — and `plan_redirect` translates per file, trimming
any overlapped rule; don't re-key it on disk numbers, that was the chained-split
bug.

v12 adds `detection_override` — the same idea as v9 for the *now-playing* card,
and deliberately **not** the same table. Keyed `(title, season, media_type)`
because the two key spaces are different populations that share a shape: the
scanner parses filenames, detection parses window/session titles or takes
Jellyfin's `SeriesName`, so one table would let a correction typed against a
browser tab re-point files on disk at the next scan. Detection also covers
manga, which the scanner does not, and `clear_library_match` deletes redirects
on its key while `set_library_match` refuses during a scan — both of which
would surface on the wrong screen if shared. It carries `display_title` so the
Settings list and an off-list forced entry read correctly with no request.
`build_now_playing` consults it *before* `best_match`, mirroring `index_files`'
documented order, and the relations redirect still applies afterwards: a
correction settles which series this is, relations still decide which entry the
episode number lands on.

v13 adds `episode_offset` to it — the second `ALTER TABLE ADD COLUMN` in the
schema, so it carries v7's `has_column` guard and for the same reason. A
correction could say *which entry* and nothing about *which episode*, which
covers a franchise whose seasons are separate AniList entries (Jellyfin's S2E1
is episode 1 of the sequel) but not a server that splits one continuously
numbered entry into cours, where S2E1 is episode 13. Signed, applied as
`reported + offset` before the relations redirect, floored at 1. `NowPlaying`
keeps `source_episode` beside `episode` because `requeue_match` re-resolves
from that object rather than from a fresh detection — shifting an
already-shifted number would drift further on every correction.

v14 gives the **local** list `started_at`, `completed_at` and `private` — three
fields the app reads, charts and exports everywhere else, which the account-free
profile answered with a hard-coded `false` and two nulls. The dates are the JSON
text of AniList's own `FuzzyDate` rather than an ISO string, because every part
is independently nullable and "2019" is a real answer. All three are `COALESCE`d
on write, so an absent one means "leave it alone" exactly as an absent GraphQL
variable does — which is what the editor relies on when it sends a date only
once the user has touched it. Three `ALTER TABLE ADD COLUMN`s in one
transaction, so they carry v7's `has_column` guard and the first column decides
for all three. "Private" locally means left out of the MAL export; the JSON
backup keeps the entry and carries the flag.

v15 adds `media_id` to `notifications`, so a notification can link to the entry
it is about. v16 adds `user_id` to `offline_queue`, and is a data-loss fix rather
than a feature: `anilist_logout` cleared the token and the cached viewer but left
the queue, and a queued row carried only a `mediaId` — so signing out of A and
into B drained A's unsynced edits onto B's list, silently, on B's first list
fetch. It backfills from the cached viewer and drops rows it cannot attribute,
because clearing the queue on logout would defeat the point of having one.

v17 seeds `blur_adult` on for new installs only — an existing install's
explicit choice, or absence of one, is left alone.

v18 adds a nullable `user_id` to `notifications`, backfilled from the cached
viewer, and leaves `kind = 'update'` rows unowned on purpose: the update
notice is the app's, not an account's, so it survives a sign-out while every
row an account was told goes with that account (`notif_clear_owned`).

v19 seeds `update_channel = prerelease` for a database that predates it, so
the Stable default that came with v1.0.0 applies to new installs only and
nobody on the rolling build was moved without choosing. Which population a
file belongs to is decided in `open` by the pre-migration `user_version` (0
means created just now), **not** by whether `kv` is empty — v17 has already
written a row by the time v19 runs on a fresh install, so v17's own test would
call every new install an old one. The accepted gap: a first launch that dies
mid-chain leaves a fresh file with a version, and the next open seeds it.

v20 adds `query_cache`, the answer cache behind the `anilist_query`
passthrough: a row per `(source, query, variables, viewer)` sha256 key,
with the payload and its fetch time. The rule that keeps it inside "no
local activity store" is an **allowlist**, in `anilist/query_cache.rs`
(`CACHEABLE`), not a blocklist: a source not named there is never stored,
so a new feed or activity query is uncached until someone deliberately
adds it, and fails open the safe way. The frontend passes a wished TTL
through `gql(query, vars, { source, ttlSec, mediaId })`; Rust caps it at
the allowlist's own maximum. `mediaId` on a detail answer lets an own edit
evict it: `cache_patch_entry` and `cache_forget_entry_id` both call
`query_cache_forget_media`, so a reopened detail can never show a stale
entry the list no longer has. `switch_identity` clears the whole table,
and `setup` prunes rows older than a week. Never cached, by omission from
the allowlist: feeds, activities, replies, threads, comments,
notifications, favourites, search, and every mutation. The list itself is
not here — it has its own 15-minute window in `fetch_media_list` (below).

**AniList has two name spaces for a custom list, and only one is writable.**
`MediaListCollection.lists[].name` is a *display* value: it upper-cases the
first character and invents section names that exist nowhere else (an account
with split-by-format has a "Completed TV" group and no such list). The names
that identify a list are the raw ones — the keys of each entry's `customLists`
map, and what `SaveMediaListEntry(customLists:)` writes. Reading the display
name and looking it up in the raw map is a bug with three faces, and it shipped
for a while: the membership checkbox never ticked, the filter returned nothing,
and saving sent a name the account did not have. `lib/customLists` is the one
reader; do not go back to `g.name`.

**The season is inert for matching unless the *title* carries it.**
`matcher::variants` only re-spells a marker already in the string; it never
invents one, because "Show" plus season 2 could be "Show 2", "Show II" or a
differently-named sequel, and guessing writes to a list. So every source that
reports the season *beside* the name — the Jellyfin API above all — matched on
the bare series title and offered that season's episode numbers against season
one. `matcher::season_informed` is that guard as a named function, and
`drive_session` blocks with `UnknownSeason` when a season past the first was
reported, could not inform the match, and has no correction. Do not "fix" this
by generating season variants: for Beyblade's Metal Fusion / Metal Masters /
Metal Fury, three separate 51-episode entries, no spelling of "season 2" finds
the right one — only the user can say, and the picker offers the AniList
sequels so it is one click.

**Interaction is one model with three presentations.** `lib/actions` resolves a
target (a list entry, a title that is not one, the detection session, or the
page) plus a context into the actions that would actually change something, and
returns i18n *keys* rather than sentences. `ActionHost` owns both gestures —
right-click from a mouse, a 500 ms press from a touch — resolves what was under
it through the query cache (`findCachedMedia`, a read and never a fetch), and
renders either the context menu or the bottom sheet. The palette reads the same
resolver for its command group. So a new action is added once, in `lib/actions`
plus its label and icon, and appears everywhere it applies. Two rules hold this
together: an action that cannot run is omitted rather than drawn disabled, and
every write goes through `useListMutations`, which is where receipts, Undo and
the offline queue already live. The DOM carries identity only —
`data-media-id`, `data-media-type` and `data-media-title` — because serialising
an entry's state into attributes means keeping them in step with every quick
save, and `dataset` is `string` either way.

**The detection surface is the shell's, not the overview's.** `DetectionPopup`
floats bottom-right on every route (docked above the bottom bar on the phone),
in expanded or compact form, and the choice is a `localStorage` key
(`lib/detectionView`). It is deliberately **not** a dialog: no `data-overlay`,
no autofocus, `z-30` under every real overlay — detection arrives unprompted
and must not take the keyboard from whatever is being done. There is still one
detection and one `DetectionSurface`; the popup only chooses how much of it to
draw.
On desktop it is a window: the header drags it anywhere and either edge
changes its width, both remembered per machine by `lib/detectionLayout`
(`karasu-detection-layout`); the phone keeps the dock above its bottom bar.
The cover and the meta line come from the list cache, and for a title off
the list from one allowlisted `mediaByIds` request (`useDetectionMedia`).

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
`scripts/release/generate-update-manifest.ps1`. `tauri-plugin-updater` parses
that field with `semver::Version::from_str`, which rejects `0.23.2.90` outright and makes
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

## The request budget

One ~30/min pool serves every screen, the scrobbler and the alert passes, so
the rule is: **name the spender, cache the answer, wake for a reason.**

- **Every request names its source.** `AniList::query_from(source, …)`; the
  passthrough takes it from `gql(query, vars, { source, ttlSec, mediaId })`
  and falls back to `gql:<root field>`. The tallies land in three places: a
  verbose line every five minutes (`N requests in the last 5 min: list 3,
  airing 1; 429s 0, min remaining 17`, zero included), the diagnostics
  report's three rows, and the sync panel's "Requests by source". Start any
  budget question by reading those, never by guessing.
- **The limiter's last measurement outlives the process** (kv `rate_state`,
  restored when younger than the window, a pending `Retry-After` re-parked).
  A build swap used to seed a full thirty and earn a burst of 429s.
- **The own list has a fifteen-minute window** in `fetch_media_list`: inside
  it the SQLite copy answers with no request; past it the copy answers at
  once and one background fetch refreshes it, emitting `list-refreshed` so
  the frontend re-reads the fresh copy for nothing. `force` (the sync button,
  the merge) always fetches. `fetched_at` is stamped only by `cache_list` —
  a patch is our own edit, not a fetch, so `edit_cached_list` must never
  touch it — and a first add, which no patch can invent, calls
  `cache_mark_stale` so the next read fetches.
- **The passthrough caches allowlisted answers** (schema v20, above).
- **The airing watcher wakes for the next episode** (`plan_next_wake`),
  clamped to [1 min, 6 h], re-timed by `replan()` after a list refresh. A
  replan re-times the sleep; it must never force a check, or every list
  refresh costs a request.
- **The bucket is per IP, not per token** (measured, see the window note), so
  the phone and the PC share one budget on one network.

Measured on the rig on 2026-09-13: a cold start fell from 8 requests in the
first 30 s to 2 (the bell count and one airing check); a restart inside the
window plus four screen changes cost no list request; a reopened detail and
the whole Wrapped page cost none.

## The commit loop, and the push gate

Six commands per commit, in this order, and one more before a push. Don't do
any of it by hand.

```sh
node scripts/bump-version.mjs patch   # minor for features, major for breaks
npm run verify                        # typecheck, audits and lints, then vitest and cargo test side by side
git commit                            # message ends with the Co-Authored-By trailer
node scripts/changelog.mjs            # after the commit — it reads the commit
git commit --amend --no-edit          # fold the changelog in, then re-run:
node scripts/changelog.mjs --marker-head
npm run verify:full                   # before a push: every check the repository owns, once
```

**`scripts/bump-version.mjs`** moves the version in all five places at once —
the three manifests, `COMMIT_NUMBER`, and `Cargo.lock`. It prints the resulting
four-part version on stdout (so a commit subject can be filled without a second
grep) and refuses to run when the tree holds nothing but version files, since a
bump with nothing to describe is a mistake or a double-run. `--force` overrides
that, `--print` just reports the current version.

**`npm run verify`** is `scripts/verify.mjs`, the whole gate and what CI runs,
so the two cannot drift. Typecheck, the comment audit, the style audit and the
site tokens' freshness go first and stop the run on a failure; then vitest and
`cargo test` run at the same time. Every
phase is captured, and a green run prints one line per phase — counts, seconds,
any compiler warning — and nothing else, which is the point: the loop runs
many times a day and its output is read by an agent. A failed phase prints its
failure section (vitest's "Failed Tests", cargo's "failures:") and only that;
`--verbose` streams everything as the tools print it. `verify:frontend` and
`verify:rust` are the halves, for the commit that touched only one. Between
the audit and the suites sits **oxlint**
(`npm run lint`, `.oxlintrc.json`): the correctness category plus
`react-hooks`, `jsx-a11y`, `import` and `vitest`, warnings denied. The rules
switched off there are switched off on purpose — the React Compiler set
(`refs`, `purity`, `set-state-in-effect`) flags the live-ref and
derived-state patterns this code uses knowingly, `prefer-tag-over-role` and
`no-autofocus` argue with decisions the overlays document, and the rest is
style — so a new warning is a finding, not a formatting opinion. Before oxlint sit two
more cheap phases: **typos** (`_typos.toml`; the German copy is excluded by
file and by a regex over the `(De, …)` arms of `i18n.rs`, because typos knows
English, and the anime vocabulary — cours, ADN — is in `extend-words`; the
binary comes from `cargo install typos-cli`, and a machine without it gets a
visible `skip` line, never silence, while CI runs the `crate-ci/typos` action
before `verify`) and **toml** (`scripts/toml-check.mjs`, taplo's npm build fed
one file at a time over stdin, because its WASM globbing finds nothing on
Windows; `taplo.toml` names the files and the style, `--fix` rewrites them).
Looked at for the gate on
2026-09-19 and left out: `cargo-nextest` (a one-second suite gains nothing),
`msw` (HTTP lives in Rust, so there is no fetch to mock), and a formatter (one
tree-wide diff for nothing). `npm run test:coverage` answers a question rather
than gating (four summary lines, the per-file map under `coverage/`).
Run it bare and read the exit code — see the note below on piping. The same rule holds for every script the loop runs:
`bump-version` prints the version, `changelog` one line, `comment-audit` one
line when clean and the offending lines when not.

**`npm run verify:full`** is the same script with `--full`, the push gate: the
commit gate, and then everything else the repository can check, in one run
with the same one-line-per-phase output. After the gate's own phases it runs
the cheap, independent checks at once — **knip** (unused files, exports and
dependencies, `knip.json`), **versions** (`bump-version --check`, the five
version files agree), the **site**'s typecheck,
**npm audit** at `high` over the production graph, the **bundle budget**
(`scripts/bundle-budget.mjs`: a fresh `vite build`, then four gzipped figures —
what the window waits for, the stylesheet, the largest lazy chunk, all the
script — against `scripts/bundle-budget.json`, each 3 % over the larger of the
two build targets' measurement; on 2026-09-25, with Base UI and Motion in,
the Linux target read 391.5, 16.3, 27.3 and 528.0 KiB, and a raise names its
reason in the commit) — then
the three cargo tools
one after another because they share the target directory's lock: **clippy**
with warnings denied, **cargo deny** (advisories, licences, bans, sources
against `deny.toml`), **machete** (dependencies nothing uses). Then the two
builds, last because they are the slow part: the **android check**
(`scripts/android-check.ps1`, a cargo check for aarch64 with the NDK exported —
Windows only; elsewhere the phase says so and CI's android job is the check)
and **tauri build**, the real bundle, whose rustc warnings the phase prints
because `cargo test` cannot see them. The final phase is **clean tree**: `git
status --porcelain` must be empty, so nothing uncommitted — and no bindings
regenerated by the run — rides along with a push; in `--full` a regenerated
`bindings.ts` is a failure, not a note. Measured on 2026-09-20: 1 m 32 s of
work, 66 s of it the bundle. `.githooks/pre-push` runs it on every push once
`git config core.hooksPath .githooks` has been set on the clone — do that
once; the hook is committed, the setting is not. A tool that is not installed
(typos, cargo-deny, machete) is a visible `skip` line here as in the gate.
The single-tool scripts (`lint`, `lint:rust`, `deny`, `deps:unused`, `knip`,
`lint:typos`, `lint:toml`) remain for running one of them alone; the push
gate is the one place they all run together, and CI runs the same pieces on
its own jobs.

**`scripts/changelog.mjs`** runs *after* the commit, because it reads it —
which is also why the loop above ends the way it does. Folding the generated
entry back in with `--amend` rewrites the sha the marker just recorded, so the
next run would offer the same entry a second time; `--marker-head` re-points it
at the amended commit and is the one-line answer. Skip the amend and commit the
changelog separately if you prefer — the marker stays correct either way. It
appends to `CHANGELOG.md`'s `## Unreleased` section from every commit since the
`generated-through` marker, so nobody writes that file by hand — the maintainer
declined to, and a changelog kept by hand is one that silently goes stale. The
commit subject is the changelog line; add a `Changelog: Fixed: …` trailer when
the subject describes the change and the reader needs the effect, or
`Changelog: skip` to leave a commit out. Version-only, docs-only, CI-only and
scripts-only commits drop out without a trailer.

For build-affecting changes — dependencies, `tauri.conf.json`, anything in the
bundle — also run `npm run tauri build` as a smoke check. On Windows only the
NSIS bundle builds and the three Linux targets are correctly skipped; the
AppImage, the `.deb` and the `.rpm` are built by the `linux-build` job in CI,
which is also the only place Linux-only code is compiled at all. The AppImage
stays the updater's format; the packages install through a package manager and
carry explicit `depends` (webkit2gtk-4.1, gtk3 and the ayatana appindicator,
which `ldd` cannot see because it is dlopen'd), and every place that names a
release file — the renamer twins under `scripts/release`, the checksum step,
the Nightly's prune list, `release-info.mjs` on the site — walks the
`karasu-linux` artifact recursively, because three bundle folders make the
download keep its `appimage/`, `deb/` and `rpm/` subfolders where one did not.

**The AppImage ships without `libwayland-client`, on purpose.** linuxdeploy
bundles the build host's copy (ubuntu-22.04, wayland 1.20), the AppRun puts it
first on `LD_LIBRARY_PATH`, and Mesa 26 cannot create an EGL display against
it: `Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...`,
WebKit's web process dies, the window stays black. Reported from Fedora 44 on
2026-09-23 and reproduced the same day on WSL's Ubuntu 26.04 (Mesa 26.0.3)
with the 1.19.1.664 Nightly. `scripts/release/slim-appimage.ps1` runs after
the build in `release.yml` and `ci.yml`: it extracts the AppImage, deletes
that one library, repacks with a digest-pinned `appimagetool` over the
runtime cut from Tauri's own file, and re-signs with the updater key,
because the `.sig` covers the file's bytes. Only the client goes:
tauri-apps/tauri#15976 lists ten display-stack libraries, but removing all
ten failed on the same WSL host with `libwayland-server.so.0: cannot open
shared object file`, which some hosts do not have, while removing only the
client kept WebKit's web process alive there, repacked file included.
Drop the script once Tauri ships `bundle.linux.appimage.excludeLibraries`
(tauri-apps/tauri#15662) or excludes the library by default. The `.deb`,
the `.rpm` and the Flatpak link against the host's libraries and never had
the problem.

**Two kinds of test that are not examples.** `proptest` runs the parser and the
matcher over thousands of generated inputs a run (`parser.rs` and `matcher.rs`,
`mod props` inside each `tests`): nothing panics, the episode and season never
exceed their digit counts, a plain fansub or chapter name round-trips, and the
prepared matcher agrees with the reference copy on random candidate sets. A
failing case is minimised and written to `src-tauri/proptest-regressions/`,
which is committed so the case stays a test. `insta` pins the text blocks
nobody used to check — the diagnostics report (both redactions) and the widget
projection (both locales) — as `src-tauri/src/snapshots/*.snap`; the MAL XML
and the JSON backup are pinned the same way by vitest's `toMatchFileSnapshot`
under `src/lib/__snapshots__/`. A snapshot diff is the review: accept a wanted
change with `INSTA_UPDATE=always cargo test` (or `cargo insta review`) and
`npx vitest run -u`, and commit the file with the change that caused it.

Prefer extracting pure logic into `src/lib/*.ts` (or a pure Rust fn) and unit
testing it. Untestable-by-construction logic in a component is the usual reason
a regression here is invisible until it ships.

## The bindings are generated, never written

`src/api/bindings.ts` is what tauri-specta emits from the Rust command
signatures: one `commands.x(args)` per `#[tauri::command]`, every argument and
return type spelled out, doc comments carried over. `cargo test` writes it
(`src-tauri/tests/bindings.rs`, an integration test because the lib test
binary cannot start once it links every command — rfd's `TaskDialogIndirect`
needs the comctl v6 manifest, which `build.rs` now embeds for test targets
only), so the file is always as fresh as the last `npm run verify`; the gate's
`bindings` phase reports a regenerated file locally and fails CI on one, since
a stale committed copy is the one way the two sides can lie to each other.
Nothing edits the file by hand, oxlint, knip and the comment audit skip it, and
`@tauri-apps/api/core`'s `invoke` is imported nowhere else in `src/`. A new
command is three things: `#[tauri::command] #[specta::specta]` on the function,
`specta::Type` on every type in its signature, and its path in
`specta_builder()`'s `collect_commands!` list in `lib.rs` — then `cargo test`,
and the frontend calls `commands.newThing(...)` (through `unwrap` in
`api/tauri.ts` when it returns a `Result`, which turns the generated
`{ status, data | error }` back into the thrown string every catch expects).
Four rules the export forced, each in `commands/mod.rs`: a bare `i64`, `u64`
or `usize` is refused by specta-typescript (precision), so a 64-bit field
carries `#[specta(type = crate::commands::Num)]` and a 64-bit argument or
return is the `Num` newtype (`.0` at the top of the body); `serde_json::Value`
is `Json` the same way, exported as `any`, because specta's own `Value`
support (the `serde_json` feature) recurses without end; a bare `f64` exports
as `number | null` for NaN's sake, so a float is `Real`; and a function takes
at most ten arguments, which is why `bulk_save_list_entries` takes a
`BulkSaveInput`. A `HashMap` keyed by a number becomes one keyed by `String`
(JSON has no other key). The hand-written types in `api/types.ts` stay where
they know more than Rust's signature can say — a `Value` field's real shape,
a literal union behind a `String` — and the wrappers in `api/anilist.ts`
annotate or cast to them; where the generated type was complete, the
hand-written one is gone. Measured at the migration on 2026-09-20: 127
`invoke` sites moved, two dead wrapper types found, zero behaviour changes on
the rig.

## Comments: one line each

Decided by the maintainer on 2026-09-12 and applied to the whole tree the same
weekend: **every comment in a code file is one physical line** — `//`, `///`,
`//!`, `#`, `/* */`, JSDoc, KDoc, a `{/* */}` in JSX, all of them. One sentence
that says what the code does, or the one reason it is this way; when both will
not fit, keep the why. Numbers, dates, sizes, timings, rejected alternatives and
bug history stay out of comments — this file is where a measurement lives.
Adjacent comment-only lines are one block, so stacking one-liners is not a way
around the rule; a trailing comment on a code line is never a block. Hard limit
120 characters of comment text, aim for 100. No comment may point at another
comment ("see the note above"); point at a function, a test or this file. The
only allowed multi-line shape is a script header's list of example invocations,
and each of those sits in `scripts/comment-allowlist.json` with its reason —
an entry nothing matches fails the check, so the list cannot go stale.

Three scripts hold the rule, and `npm run verify` runs the first:

```sh
node scripts/comment-audit.mjs --check           # exit 1 on any block, long line, desync or stale allowlist entry
node scripts/comment-audit.mjs --stats           # the per-area table
node scripts/comment-audit.mjs --files a b       # only these paths, for a batch
node scripts/comment-strip-check.mjs --base HEAD # proves a change touched only comments
```

`comment-lexer.mjs` is the shared scanner (strings, regexes, raw strings,
templates, heredocs and YAML block scalars are all understood, and a file that
ends inside one is reported as a desync rather than passed). The strip check
compares base and working copy with every comment removed — the proof a
comment-only commit needs, and the only proof available for the Windows-only
and Linux-only Rust arms and the Kotlin, which do not compile here. A rewrite
that deletes a comment outright is legal under the rule but against the
intent: prefer one good line.

**Two vitest projects, and the filename picks one.** Everything runs in **node**
by default; only `*.dom.test.tsx` boots jsdom and Testing Library, via the
`projects` block in `vite.config.ts`. That split is what keeps the suite fast
(~1,200 tests in a handful of seconds), and it is a *name* rather than an inference on purpose:
`components/stats/Charts.test.tsx` renders with `renderToStaticMarkup` and needs
no DOM, so an extension rule (`.tsx` ⇒ jsdom) dragged it into one and the suite
went from 2.0 s to **14.1 s**. Needing a DOM is a decision, so it is spelled out
in the filename. `src/test/render.tsx` holds the provider wrapper and the
sign-in helpers; it imports Testing Library, so nothing in the node project may
import it. `src/test/fixtures.ts` holds the complete, typed `media`, `entry`,
`listResult`, `nowPlaying` and `idleScrobble` builders both projects use — a
test overrides the field it is about rather than spelling a sixteen-field
literal — and `src/test/{markdown,markup,actions}.ts` the readers the split
suites share. Both projects run on worker threads, and the node project runs
without isolation (one module graph for every file) because its modules are
pure; a node test that needs a fresh module must say so with a `.dom.` name or
`vi.resetModules`. A `slowTestThreshold` of 300 ms marks the tests to look at. `happy-dom` was
measured against jsdom on 2026-09-19 and lost: tests 5.9 → 2.9 s, but the
environment boot 19.7 → 34.6 s across 29 small files, 7.0 → 8.5 s in all —
the suite is boot-bound, not test-bound, so the faster DOM is the slower run.
The dom setup stubs `ResizeObserver` and `matchMedia` (desktop-shaped), mocks
`react-i18next` (a key back, never the English copy), the opener and event
plugins, and loads `@testing-library/jest-dom`, so a DOM assertion says what it
means — `toBeInTheDocument()`, `toBeDisabled()`, `toHaveAttribute()` — and fails
with the reason rather than "expected null to be truthy"; `toBeTruthy()` on an
element is the old idiom, not a choice. Where a test types or presses keys as a
person would (the composers, Tab through a dialog) it goes through
`@testing-library/user-event` with `delay: null`, because `fireEvent.change`
fires one event and a field hears focus, keydown, input and change; the
pointer and long-press tests stay on `fireEvent`, which is the only way to
dispatch a `pointerType: "touch"` sequence against a timer. The a11y lint rules
that argue with our role patterns are off in oxlint; **axe grades the rendered
result instead**: `components/{overlays,shell}/a11y.dom.test.tsx` render every
overlay and every piece of the frame once and expect `toHaveNoViolations()`
(`vitest-axe`, options in `src/test/a11y.ts` — `color-contrast` and `region`
are off there because jsdom has no layout and a fragment has no landmarks, and
nowhere else). Its first run found two real ones: a cover link with no name and
a palette listbox holding headings and `<ul>`s where only groups and options may
sit. A new overlay is a new row in that table. A test that wants
`isTauri` true mocks `@/api/anilist` itself. Import
`act` from `@testing-library/react`, never from `react`: Testing Library's
copy raises the act environment flag around the call, React's own prints a
warning per update, and the flag must not be set globally — with it on, every
async update the real code makes after an await warns instead.

### Notes that have cost real time

- **`npm test` already means `vitest run`.** `npm test -- --run` is redundant.
- **Validate AniList fields live before wiring them**, per the convention below,
  with `node scripts/anilist-query.mjs <CONST> '<variables-json>'`. It reads the
  constant off disk, so it checks the query the app actually ships.
- **Control characters in source must be written as an escape and then
  verified.** An editing tool can emit a literal control byte where `\u0000`
  was intended; the file then reads back looking correct while every subsequent
  exact-match edit on that line mysteriously fails to apply. Check with `grep -c $'\0' <file>` after writing. (The NUL
  that used to live in `src/lib/search.ts` died with the fuzzy refactor; the
  lesson did not.)
- **vitest has failed twice under `verify` and never alone.** Both times
  (2026-09-19 and 2026-09-20) a handful of tests in one file failed while
  `cargo test` compiled beside it, and eight consecutive bare runs afterwards
  were green. Nothing is known beyond that; the suspects, in order, are CPU
  starvation against the dom project's timeouts and the node project's
  `isolate: false`. Re-run `npm run verify` once before reading a failure that
  a bare `npm test` does not reproduce as a regression, and write down the
  file if it happens again.
- **A suite that finishes far faster than usual failed early, it did not get
  faster.** The Rust suite takes ~0.5 s; a 0.02 s run means something bailed.
- **Never pipe `npm run verify` through `grep`.** The pipe reports *grep's*
  exit status, so a `tsc` failure sails through and gets committed. Run it bare
  and read the exit code.
- **Never add `panic = "abort"` to `[profile.release]`.** `lib.rs` catches the
  panic `libappindicator-sys` raises when it cannot dlopen the AppIndicator
  library — that catch is the only reason Karasu starts on a Linux desktop
  without it, and `abort` would silently kill it.
- **The window's size, position and maximised state come back through
  `tauri-plugin-window-state`**, registered in `attach_desktop`; the
  `center: true` in `tauri.conf.json` places a first run only. It saves on
  close and on exit, so hide-to-tray is not a save — the state is whatever the
  window had when it was last closed or the app quit.
- **The WebView's own shortcuts are taken away on desktop, and Shift+Tab is
  not one of them.** `prevent_browser_keys` in `lib.rs` registers
  `tauri-plugin-prevent-default` with an explicit flag set — find, print, view
  source, open, downloads, caret browsing, and reload in a release build (a
  dev build keeps F5) — never `init()` or `Flags::all()`, because the default
  set includes `FOCUS_MOVE`, which is Shift+Tab. The injected script only
  `preventDefault`s on a bubbling window listener, so the app's own handlers
  (Ctrl+R sync, Ctrl+K palette) still run; measured on the rig on 2026-09-20:
  every listed key prevented, Shift+Tab and Escape untouched, and the page
  survived F5.
- **The clipboard goes through Rust.** `lib/clipboard.ts` `copyText` calls
  `tauri-plugin-clipboard-manager` inside the app and `navigator.clipboard`
  outside it, because the browser API is reliable in WebView2 and conditional
  in WebKitGTK; the capability grants `clipboard-manager:allow-write-text` and
  nothing else of the plugin. The two callers are the action runner's copy
  selection and the diagnostics copy.
- **Android gets two plugins of its own, and the battery plugin was
  rejected.** `attach_mobile` in `lib.rs` (a cfg pair on `target_os =
  "android"`, with the crates in the Android dependency table so no desktop
  build compiles them) registers `tauri-plugin-haptics` and
  `tauri-plugin-sharekit`, and `capabilities/mobile.json` — `platforms:
  ["android"]`, because a desktop build refuses a capability naming a
  permission it cannot resolve — grants exactly `haptics:allow-selection-
  feedback` and `sharekit:allow-share-text`. `lib/haptics.ts` `tick()` is the
  one vibration, fired when the long-press sheet opens and when a pull arms,
  and a no-op off Android. The `share` action (`lib/actions`, group `link`,
  `ActionContext.share`) hands `lib/anilistUrl`'s `mediaUrl` to the system
  share sheet from the context menu, the sheet and a button on the detail
  page; sharekit was chosen over `tauri-plugin-sharesheet` because the latter
  had not moved since August 2024. `tauri-plugin-android-battery-optimization`
  (0.1.4, two stars, JS-only API) was looked at on 2026-09-20 and not taken:
  `get_jellyfin_background` reads the exemption in Rust for its
  `battery_exempt` field, which a JS-only plugin cannot serve, and the JNI
  pair in `TrackingService.kt` was measured on the phone; do not re-propose
  it. Both plugins compiled into a debug APK on 2026-09-20 (`tauri.settings.
  gradle` lists both projects) and have not run on a device yet.
- **The media-detection kv key is still spelled `smtc_enabled`.** The setting
  is no longer Windows-only, but renaming the key would reset every existing
  user's opt-out. It is behind `MEDIA_DETECTION_KEY` in `commands/playback.rs`.
- **PRs merge by squash.** The repo refuses merge commits server-side;
  `gh pr merge N --squash`. A local `git pull --no-rebase` afterwards may
  still create a local merge commit — that is fine, the restriction is
  GitHub's. A lockfile conflict resolves by taking the merged `package.json`
  and regenerating with `npm install`, never by rebasing twelve version bumps.
- **Android-only code compiles nowhere on this machine except through
  `scripts/android-check.ps1`** (a cargo check for aarch64-linux-android with
  the NDK toolchain exported) and the real `tauri android build`. Treat it
  exactly like the Linux rule below: `npm run verify` proves nothing about it.
- **The Gradle daemon caches SDK-package resolution.** Installing an SDK
  package after a failed build does nothing until `gradlew --stop` — the
  daemon keeps answering "not installed" from memory. Four rebuilds were lost
  to a licence error that was already fixed.
- **`sdkmanager.bat --licenses` accepts only via cmd file redirection**
  (`< yes.txt`); both pipe forms feed it EOF and it exits silently having
  accepted nothing. Never run an installer with its output discarded.
- **`tauri android build` rewrites `app/build.gradle.kts` on every run**, so a
  hand edit there — an `applicationIdSuffix` for a side-by-side debug install,
  say — is gone before the APK exists. Put such a local-only change in
  `~/.gradle/init.d/*.gradle` instead (an init script sees the `android`
  block of every project it builds); a debug APK under `dev.kyu.karasu.debug`
  installs beside the release app, keeps its own data, and is what the
  device test of 2026-09-19 ran on. Its WebView is debuggable — `adb forward
  tcp:9223 localabstract:webview_devtools_remote_<pid>` plus Playwright's
  `connectOverCDP` reads the DOM, and `adb shell run-as dev.kyu.karasu.debug`
  reads its `karasu.log`. Neither works on the release package.
- **Debug-signed and release-signed APKs do not install over each other.**
  Android refuses the signature change; the other one must be uninstalled
  first, which wipes app-local data. This is why CI publishes only
  release-signed APKs (and only when the four `ANDROID_*` secrets exist), why
  the debug APK stays a workflow artifact, and why the phone should only ever
  see release builds once one is installed. A nightly builds the arm64 APK
  alone; the universal one (four cargo targets plus R8 over all of them, nine
  minutes measured on 2026-09-14) is a tag build's, since the 32-bit phones and
  emulators it serves can wait for a release.
- **The Android updater is `apk_update.rs`, not the Tauri plugin.**
  `updater_available()` stays false on mobile: that is the desktop plugin,
  which cannot install an APK. Android's own path, built deliberately on
  2026-09-14: `latest.json` carries `platforms.android-arm64` and
  `android-universal` (`url`, `sha256`, `size` and an empty `signature` — the
  desktop plugin parses every platform entry as `{url, signature}` and
  rejects the whole manifest when the key is missing, which is what the
  `the_desktop_updater_still_reads_a_manifest_with_android_legs` test
  pins; written by
  `generate-update-manifest.ps1` from the same artifacts the checksum step
  hashes); `check_for_updates` keeps the leg for `Build.SUPPORTED_ABIS[0]`
  in kv `apk_pending`; `apk_download` streams it into
  `<cacheDir>/updates/<version>.apk.part` (Range-resumed, sha256 over the
  whole file, then `UpdateInstaller.inspect` must answer the installed
  app's signing certificates and a higher `versionCode`) and renames it
  into place; `apk_install` opens the system installer through the
  FileProvider Tauri already ships (`cache-path "."`). It runs only in a
  release build (`cfg!(debug_assertions)` — a debug build is signed
  differently and the install would fail after the download), only while the
  activity is in front, only on an unmetered network unless kv
  `apk_download_metered` says otherwise (a nightly is 23 MB, several a
  day), and only with room for two copies. `sweep` at start deletes every
  file under `updates/` except the pending upgrade. The consent the app
  cannot give itself is the per-app "install unknown apps" switch;
  `apk_open_install_permission` leads to it, About explains it. The start
  prompt (`apk_prompt_if_ready`) opens the installer once per version, kv
  `apk_prompted_version`, so a cancel holds. Verification is two nightlies:
  install the first by hand, watch it fetch and install the second.
- **Android keeps `usesCleartextTraffic` in release** deliberately — a LAN
  Jellyfin over plain HTTP is a supported setup, and (see `net.rs`) on Android
  a *self-signed* Jellyfin needs plain HTTP anyway.
- **Linux-only code does not compile on Windows**, so `cargo test` here proves
  nothing about it. Either let CI's `linux-build` job be the check, or — for a
  pure-Rust dependency like zbus or chacha20poly1305 — paste the module into a
  throwaway crate and `cargo check` it locally. That caught two real errors in
  the MPRIS backend that would otherwise have gone to CI. For the same reason,
  never put `#[cfg(target_os = "linux")]` on a *statement*: it is stripped here,
  so nothing inside it is ever checked. Write a cfg'd pair of functions instead
  (`protect`/`unprotect`, `delete_portable_key`) so the call site still compiles.
- **A comment asserting what a dependency cannot do needs rechecking when that
  dependency is bumped.** `smtc.rs` hand-rolled a 500 ms poll loop for years
  because a comment said `windows-future`'s blocking `join()` was private. True
  of 0.2; the crate has been on 0.3 — where it is `pub` — since long before
  anyone reread it. The poll then returned a *fabricated* HRESULT on overrun,
  which blanked the whole detection pass. Now that a comment is one line, the
  line is the whole claim — recheck it when the crate is bumped.
- **`eprintln!` reaches nobody in a shipped build.** `main.rs` sets
  `windows_subsystem = "windows"`, so a release binary on Windows has no console
  and stderr is discarded; a Linux AppImage started from a desktop file is no
  better. Use `logging::{error,warn,info,debug}` — and never log a command
  argument, a request header or a response body: `anilist_connect` takes the raw
  token and `jellyfin_sign_in` takes a plaintext password. `logging::scrub`
  replaces credentials with a labelled `<CREDENTIAL_…>` on write, and has a
  catch-all so an unforeseen shape fails closed, but it is a backstop rather
  than a licence.
- **Run the dev app isolated, or it edits the real install's data.** Debug and
  release share the identifier, so they share `%APPDATA%\dev.kyu.karasu` *and*
  the `dev.kyu.karasu-sim` single-instance mutex: starting `tauri dev` while the
  installed build runs makes the dev process hand over its argv and `exit(0)`,
  and without isolation it would otherwise open the real `karasu.db`, append to
  and rotate the real `karasu.log`, and read the real tokens. Drop a
  `karasu.portable` marker beside `src-tauri/target/debug/karasu.exe` and
  `portable::data_dir` sends all three to `target/debug/data/` instead. The
  marker is inside the ignored `target/`, so it is invisible in git and
  `cargo clean` deletes it — recreate it before trusting a dev run. A debug
  build also starts hidden in the tray (`hide_window_in_dev`); relaunching the
  exe shows the running one through the single-instance callback.
- **A missing i18n key renders as the key.** i18next does not throw and does not
  fall back, so `entry.scoreHint` appears on screen and nothing reports it.
  `src/lib/i18nKeys.test.ts` resolves every literal `t("…")` in the source; the
  `de: typeof en` type covers the other direction.
- **`npm run verify` cannot see every warning `npm run tauri build` can.**
  `cargo test` compiles `#[cfg(test)]`, so a function whose only non-Linux caller
  is a test stays alive there and is dead code in a release build —
  `diagnostics::parse_os_release` is exactly that, and the gate was green for as
  long as it took to run a bundle build. Read the warnings from a `tauri build`
  before assuming there are none.
- **Never point Tailwind's scanner at a hand-written `@source` list without
  diffing the emitted CSS.** `@import "tailwindcss" source(none);` plus explicit
  globs made the build ~30× faster and emitted **6,560 bytes instead of
  62,178** — every utility silently gone, no error, no warning. Nothing else was
  learned for free either: the default scan is not the bottleneck. Vite's
  `[PLUGIN_TIMINGS]` blames `@tailwindcss/vite:generate:build`, but the walk only
  ever sees 285 tracked files (155 scannable, ~50 ms); the ~8 s is *generation*.
  The one real hazard there is the walk's reliance on `.gitignore` — the root one
  did not mention `src-tauri/target/`, so ~100 GB across ~195k files was kept out
  by the nested ignore file alone. It is listed in both now.
- **`pageInfo.total` is a capped sentinel on most AniList collections, not a
  count.** Anything with many matches reports `total: 5000` with a `lastPage`
  that is just 5000/perPage — measured on user search, activities and threads
  alike. It is honest only for small sets (`User(name: "Kyusetzu")` really is 1,
  and follower/following totals are real). So a "Load N more" label is a lie on
  those three, which is why `UserList` takes a `countRemaining` flag and the
  feeds pass a countless button. A number on a button is a claim about what a
  click costs.
- **Entity search needs three characters, and it was measured per entity.**
  `Page.users(search: "ky")` returns the exact match followed by a fixed set
  of unrelated accounts; characters, staff and studios behave the same way
  (`"ky"` answered Levi and MADHOUSE before real prefix matches appear at
  three). `USER_SEARCH_MIN` gates all four scopes; media search is fine at
  two and keeps it.
- **One not-found root nulls every sibling root.** `{ good: User(id: 153164) bad:
  User(id: 999999999) }` returns HTTP 404 and `{"good": null, "bad": null}` — the
  good one dies with the bad. That is why `FOLLOW_COUNTS_QUERY` may alias two
  `Page` roots (a `Page` cannot 404) and why `User` is never aliased beside
  anything else. `Page.users` also has no `id_in`, so users cannot be batched by
  id at all.
- **`ThreadComment.childComments` is a raw `Json` scalar and costs 13×.** Twelve
  comments measured 52,801 bytes with it and 3,964 without, and the nesting ran
  **48 levels deep**. There is no depth control, so it is all or nothing: the
  query keeps it, pays for it with `perPage: 10`, and `lib/comments` flattens to
  two levels while reporting what it hides. Being untyped, "unexpected shape" is
  a normal outcome there rather than a defensive hypothetical.
- **`text(asHtml: true)` is the API's renderer, not the website's.** The
  site renders markdown in the browser with its own pipeline, and the two
  disagree inside HTML blocks: markdown inside a multi-line `<center>` is
  literal to the API and rendered by the site (`#__[t](u)__` is an `<h1>`
  holding a bold link there, a bare anime URL a media card), and the site's
  heading rule needs no space after the `#` (marked's, not CommonMark's).
  Spoilers and images agreed in every sample measured on 2026-09-10; that is
  why `anilistMarkdown.fixtures.test.ts` grades those two everywhere and
  headings/links only where `scripts/sample-markdown.mjs` says the API can be
  trusted. The oracle is the site's `.markdown` element in a browser, and a
  one-line `<div align="center">- x -</div>` is *not* a list there while a
  multi-line `<center>` block does get its markdown — measured, not derived.
  The sampler's `--rig` transport exists because an outage that refuses
  unauthenticated requests (HTTP 403 "temporarily disabled") still answers
  signed-in ones.
- **Jellyfin sessions need a heartbeat, and the Android tracking service
  was measured, not assumed.** `GET /Sessions` does not refresh a session's
  `LastActivityDate`; an empty `POST /Sessions/Capabilities` does, on
  Jellyfin 10.11.11 (2026-09-11: the rig's own row read `activeAgoSec: 0`
  on every look while it tracked a playback, and the phone's read 6 s from
  the desktop). That row is how two Karasus on one account see each other
  (`jellyfin::yield_to`), so a "the phone never yields" report starts with
  Test connection: is the desktop's row there, and how old is it. On the
  maintainer's NX809J (nubia, REDMAGIC OS 11, Android 16) with the release
  APK, 2026-09-12: **the service record is not the process.** `dumpsys
  activity services` kept showing `TrackingService … isForeground=true
  types=0x40000000` (that is `specialUse`) while `dumpsys activity
  processes` said `isFrozen=true` and the events log had `am_freeze` 37 s
  after the screen lock — with the process at `prcp F/A/FGS`, adj 200,
  far under AOSP's `freezer_cutoff_adj=900`, so it is the ROM
  (`OomAdjusterZteHook`), not Android. The phone's own log showed the
  five-minute poll line simply missing until the unlock, and the Jellyfin
  row aged past `FRESH`. The battery-optimisation exemption (bucket 5,
  Doze whitelist) did **not** prevent it; the ROM's per-app rule did:
  system app settings → "Läuft im Hintergrund" → "Zugelassen" (and
  "Auto-Start" → "Zugelassen" for the notification job). With that set, a
  45-minute locked run logged `20 polls in the last 5 min` on every line
  (the 15 s hidden cadence), no `am_freeze`, the desktop wrote at its due
  point and the phone logged `due, yielding to Karasu on KYU-PC for
  180 s` ten seconds later. It wrote once the grace was spent — and that
  was right, not a duplicate: the maintainer had reset the entry to 2 by
  hand in between, the live check in `perform_update` read that 2, and a
  due episode 3 against a list at 2 is a scrobble. Read the live-check
  line before calling a second write a bug. So a "the phone stops
  tracking" report is answered by `scripts/phone-measure.ps1`'s frozen
  line and freeze events first, and by the vendor rule second; the
  notification job being absent from `dumpsys jobscheduler` while the
  interval setting is 0 is not a failure. And
  Windows sends a limited broadcast from a wildcard UDP socket out of one
  interface of its own choosing — with a Hyper-V switch present, that one —
  which is why `discovery::broadcast` also binds to the default route's
  address (measured on the maintainer's PC: the wildcard socket heard
  nothing, the Ethernet-bound one heard the server twice).
- **The website reaches a forum page Karasu cannot, and that is deliberate.**
  anilist.co renders page 470 of thread 1 because its **Web Worker** posts to
  **`anilist.co/graphql`** — a different endpoint from `graphql.anilist.co` —
  with an `x-csrf-token` bound to a site session. That endpoint does not enforce
  the 5,000-entry page-depth cap; without the header it answers **403
  `Forbidden. (Use graphql subdomain)`**. An account does not lift the cap
  either: the measurement was taken logged *out*, and the site needs the
  separate endpoint for its own signed-in users too. Using it would mean
  scraping a CSRF token and impersonating the website past an explicit access
  control. **Do not.** The supported route is `Thread.replyCommentId` → the root
  `ThreadComment(id:)` field, which is a **LIST rather than a `Page` and so is
  not capped at all**; it resolves any id to the **root of its tree** and returns
  the whole conversation in one request. `lib/threadJump` holds the arithmetic
  and the rejected alternatives — the worker is also why a normal network trace
  of anilist.co shows no GraphQL at all.
- **One not-found root nulls every sibling on `ThreadComment` too.** The trap
  `FOLLOW_COUNTS_QUERY` documents for `User` is not special to `User`: forty
  aliased `ThreadComment(id:)` roots in one request all came back `null` with a
  single `"Not Found."` because one comment had been deleted. Alias-batching
  otherwise works there (20 roots for one request), which is exactly what makes
  it tempting. Deleted comments are ordinary, so any id-walking scheme built on
  it fails most times it runs.
- **`ThreadComment(threadId:, userId:)` and `Page.threadComments(threadId:,
  userId:)` are different resolvers.** The root field returned **1** comment for
  a user in thread 1; the `Page` field returned **144**, because it includes
  their nested replies and the root field does not. Unbounded
  `ThreadComment(threadId:)` with no other filter answers **HTTP 500** — but
  `Page.threadComments(userId:)` with **no `threadId` works**, resolves
  `thread { id title }` per row, reports an honest `total`, and — unlike every
  `threadId` call — **actually honours `sort: [ID_DESC]`** (ids measured
  reversed against the unsorted call). "sort is inert" is a fact about the
  `threadId` shape only; `USER_FORUM_COMMENTS_QUERY` is the one place the app
  passes `sort` to this field, and why.
- **`Page.threadComments` returns `perPage + 1` rows, and the extra one is a
  nested reply served as a root.** At `perPage: 10`, page 1 of thread 1 came
  back as `17,18,19,23,30,`**`2088149`**`,32,40,43,44,53` and page 2 carried
  `1618189` between `163` and `165` — eleven rows both times, while
  `pageInfo` kept reporting `perPage: 10`. Re-measured identically on
  2026-09-03 (page 3 was a clean ten), and the cause narrowed by one more
  request: `ThreadComment(id: 2088149)` resolves to the tree of root comment
  **30**, the root just before it on the page — so the extra row is a reply
  buried inside the preceding root (posted years later), which AniList hands
  out as if it were a root of its own. Each "Load more" therefore draws one
  row that belongs inside another; `lib/comments` degrades gracefully, and
  this is the datum an upstream report needs.
- **Never round-trip source text through `encode("utf-8").decode("unicode_escape")`.**
  A script inserting i18n keys did, over text Python had already decoded, and
  every em-dash, arrow and umlaut came back a byte at a time as latin-1 —
  `Kontoänderungen` became `KontoÃ¤nderungen` in seven strings across both files.
  Worse, `grep` reported the files clean because the console codepage hid it. If
  non-ASCII is ever in question, compare **codepoints** (`hex(ord(c))`), not
  glyphs, and write literal UTF-8 rather than escapes.
- **The CSP needs `img-src data:`, and dropping it makes the bird disappear.**
  `assets/karasu-mark.svg` is 2,966 bytes, under Vite's 4,096-byte
  `assetsInlineLimit`, so the build inlines it as
  `data:image/svg+xml,%3c?xml…` — verified by grepping `dist/`, not by reasoning
  about it. Without `data:` the mark vanishes from the titlebar, About, first
  run, the Wrapped footer and several empty states, and nothing else breaks, so
  it looks like a styling regression rather than a policy one.
- **`csp` and `devCsp` are separate, and dev genuinely needs the looser one.**
  Vite injects `<style>` elements at runtime and serves HMR over a websocket;
  the production bundle does neither. A single strict `csp` therefore breaks
  `tauri dev` while the shipped app is fine — which is the worst way round to
  find out.
- **Tauri rewrites the CSP at compile time**, parsing the frontend assets and
  injecting nonce and hash sources into `script-src` and `style-src`
  (`dangerousDisableAssetCspModification` turns that off — don't). Two
  consequences: never add `'unsafe-eval'` or `'unsafe-inline'` to `script-src`
  in production, because Tauri's nonce is what makes it work; and
  `'unsafe-inline'` in `style-src` is *inert* whenever a hash is present, since
  CSP tells browsers to ignore it then. It is kept only as a fallback for the
  case where Tauri injects nothing.
- **A CSP cannot be checked from the Vite dev server** — it applies to the Tauri
  webview, so the browser-pane tooling is blind to it. Only a real
  `tauri dev`/`tauri build` run proves it.
- **Bio images are proxied through Rust, and `img-src` is still not widened.**
  Across 89 real bios holding 350 images, **6 (2%) were on `*.anilist.co`**; the
  rest were imgur (147), tumblr (57), pinimg, postimg, catbox and discord — so no
  allowlist covers that tail without handing an unbounded set of third parties
  the user's IP and which profile they opened, *from the page, on every render*.
  `commands::fetch_bio_image` makes one bounded request in Rust instead and
  returns a `data:` URI, which the existing `img-src 'self' data:` already
  permits: size cap, the format sniffed from the bytes (png/jpeg/gif/webp/avif/ico
  — never SVG, it is a scripting context — and the declared `Content-Type` is
  not consulted, because hosts send `octet-stream`, nothing, or the wrong
  one), timeout, no cookies, no `Referer` on any hop (`referer(false)`;
  reqwest's default sets one on redirects), and local/private hosts refused on
  the URL *and every redirect hop* so a crafted bio cannot probe the LAN. The
  frontend fetches each URL once per session (`lib/promiseCache`). The
  host still learns the user's IP; that is unavoidable in any design that shows
  the image, and it is the residue rather than the part that was solved. Anything
  that fails falls back to the chip. **Do not "simplify" this into a CSP
  change** — that is the thing the measurement rejected.
- **Every version bump mints a new incremental session under
  `src-tauri/target/debug/incremental`, and cargo never reclaims one.** The
  package version is part of Cargo's metadata hash, so 566 bumps had left
  2,810 session directories — 175 GB of a 269 GB `debug/` — of which the
  current build reads one. `node scripts/clean-target.mjs` reports them and
  `--apply` deletes every session older than a day (`--keep-days`), and
  `--android` adds the cross-compile trees for a cold Android build's price.
  Run it when the disk asks; it costs nothing but the next build's few
  seconds of incremental warm-up.
- **MSVC writes an 11 MB `karasu.pdb` on every release build and there is no
  flag reaching the linker to stop it.** `debug = 0` and `strip = true` are
  already set, `cargo build --release -v` shows no `/DEBUG`, no `-Cdebuginfo=`
  and no `/PDB` — and the file is still produced and hardlinked into `deps/`.
  It is not bundled, so this is target-dir disk and nothing else. Looked at
  once; don't spend the afternoon on it again.
- **`hydrate` is not a startup cost, and the numbers are in the tree.** It was
  filed as one without a measurement. In a release build the re-parse of every
  indexed path is 49 ms for 20,000 files, and the other half nobody had looked
  at — deserializing the cached list to recompute the overflow chips — is 76 ms
  for 8,000 entries on a 2 MB blob. A pathological install pays about an eighth
  of a second before the window appears; a normal one pays under twenty
  milliseconds. Moving it off `setup` would buy that back and cost a window
  where the Library screen renders empty and every correction command needs a
  "not ready" state it does not have. `library::hydrate_cost` and
  `db::tests::measure_the_cache_read` are the measurements, `#[ignore]`d — run
  them with `cargo test --release --lib <name> -- --ignored --nocapture`.
- **AniList's rate window steps; it does not roll.** Measured twice on
  2026-09-03 with `scripts/ratelimit-probe.mjs` (unauthenticated, the phone in
  airplane mode, two minutes apart, identical both times): a cold client reads
  `remaining: 29` of 30; a burn to 21 then reads 20, 19, 18, 17 at
  +5/+15/+30/+45 s — each sample costing exactly one and nothing returning —
  and 29 at +60 s, 28 at +90 s. Flat, then the whole budget at once, about
  60 s after the first request of the window. `headroom` in
  `anilist/client.rs` models exactly that step and stays as it is; the cost —
  one response reporting `remaining: 0` makes every request in the next
  minute pay the full `MAX_PACE` and go out anyway — is bounded and known. Do
  **not** heal proportionally: right for a rolling window, and for this one it
  hands out budget that does not exist and earns the 429s the limiter exists
  to avoid. **The bucket is per IP, not per token** — measured on
  2026-09-13: the anonymous probe read 17 after a burn, one signed-in
  request through the rig then read 16, and the next anonymous sample 15.
  So the phone and the PC share one budget only on the same network, and
  the rig and the installed app always do. Every request is tagged with a
  source (`AniList::query_from`; the passthrough takes `gql(query, vars,
  { source })`), tallied per source, and reported three ways: the verbose
  line `N requests in the last 5 min: …; 429s n, min remaining m` every
  five minutes, the "AniList requests this run" rows of the diagnostics
  report, and the "Requests by source" table in the sync panel. A cold
  start measured 8 requests in its first 30 s on 2026-09-13 (two lists,
  two recommendation sets, season hero, birthdays, bell count, airing).
- **An agent shell launched from the Claude desktop app sees a virtualized
  AppData.** That app is an MSIX package (`Claude_pzs8sxrjxfjjc`), and every
  child process inherits its file-system virtualization: any path under
  `%APPDATA%` / `%LOCALAPPDATA%` that has a shadow under
  `…\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\{Roaming,Local}\`
  is served *from* the shadow and written *into* it. The real install's
  `karasu.db` was shadowed by a stale copy a Claude-launched run left on
  8 Aug, so the "truncate the database" recovery test wrote to the shadow and
  changed nothing — "boots fine, file unchanged, nothing logged" was that,
  not a wrong path. The Android SDK, NDK and licences exist *only* in that
  shadow (the real `%LOCALAPPDATA%\Android\Sdk` is empty), so `tauri android
  build`, `android-check.ps1` and `apksigner` run only from such a shell.
  Read the real data dir via `\\localhost\C$\Users\…` (the loopback share
  bypasses the filter), never launch the installed app from that shell, and
  keep every test instance's data under `src-tauri\target\`.
- **The desktop test rig.** A release exe with a `karasu.portable` marker
  beside it keeps db, log, backups and a DPAPI `token.dat` under
  `target\release\data\` and starts signed out; launched with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, its
  WebView is scriptable through Playwright's `connectOverCDP` (the app is a
  `HashRouter`, so navigate by `location.hash`). Three traps: the marker does
  not isolate the single-instance mutex, so the installed app must be quit
  first (the tell is its window popping up); `Abmelden` in the rig calls
  `delete_token`, which clears the *shared* Windows Credential Manager entry
  the installed app uses; and the Jellyfin token has no portable branch, so a
  seed copied from a real backup polls the real server unless its
  `jellyfin*` kv rows are deleted first.
- **A 0-byte `karasu.db` is a valid empty database**, so truncating it does
  not exercise the backup fallback — the app starts empty with no error line,
  which reads as the failure it is not. Clobber the 16-byte header instead;
  the transcript is then `ERROR db: cannot open the database: Migration
  failed: file is not a database`, `INFO  backups: restored the database from
  karasu-YYYYMMDD.db`, and the broken file kept as `karasu.db.unreadable`
  (measured 2026-09-03).
- **`am force-stop` cancels the package's JobScheduler jobs**, so a "force-stop,
  then `cmd jobscheduler run`" procedure answers "Could not find job 46231"
  whatever the code did. The dead-app state is Home, then `am kill` (leaves
  `stopped=false`). The job's registration itself was refused for the whole
  life of the feature until 0.193.9: a job with a connectivity constraint
  needs `ACCESS_NETWORK_STATE` in the manifest, or `schedule()` throws a
  `SecurityException` that the old code caught and logged to logcat only.
  The job's Rust log lines never reach `karasu.log` (no `logging::init` in
  that process); logcat tag `KarasuNotifJob` is the only channel. A forced run
  posts nothing unless the interval is on, the last check is older than it,
  and a seen-id baseline already exists — the first run only arms.
- **The `cannot move state from Destroyed` panic at the end of a session is
  Windows ending the session, not the tray's Quit.** Every one of the ten in
  the installed app's and the rig's logs between 2026-08-14 and 2026-09-11
  sits one to two seconds after a System-log event 1074 (shutdown, from
  Explorer) or a Winlogon session end; the tray's Quit, driven by UI
  automation four times on 2026-09-12 (debug and release, signed out and
  signed in), never logged one. tao 0.35 answers `WM_ENDSESSION` with
  `loop_destroyed()` and then keeps pumping messages with the runner already
  `Destroyed`, which tao 0.36 fixed by exiting inside the handler
  (tauri-apps/tao#1157); tauri-runtime-wry 2.11 still pins 0.35, so
  `exit_now_if_unrequested` in `lib.rs` does the same from the app's `Exit`
  hook. It reproduces on demand without a shutdown: `SendMessage(hwnd, 0x16,
  1, 0x80000000)` to the process's `Tao Thread Event Target` window. And
  `app.exit(0)` inside a menu callback is fine — it is a proxy message the
  loop handles on its next turn, not a teardown in the callback.
- **A pause defers a scrobble, it does not cancel it.** The window rung drops
  a paused player's window (WASAPI reads the session Inactive within a few
  seconds), the card unmounts, and the session's absolute deadline keeps
  running; resume inside the five-minute grace after the deadline and the
  very next tick is due. Observed on 2026-09-03 with mpv: paused at +60 s
  of a 120 s threshold, no write while paused, `due, waiting for
  confirmation` on the first tick after resume. A silent file in a fresh
  process is detected normally.
- **The Android sign-in is slow at the network, not at the Keystore.**
  Measured on the phone on 2026-09-05 with verbose logging:
  `connect timings: viewer 5237ms, kv 6ms, token save 27ms` — and the
  viewer figure included AniList answering the first fetch with HTTP 502
  and `connect_with_token`'s one bounded retry (1.5 s sleep) covering it.
  The hardware-key generation everyone suspected costs 27 ms. Do not move
  `save_token` off the sign-in path on the strength of the old guess.
- **User id 153164 in `scripts/anilist-query.mjs`'s examples is a stranger's
  public account, not the maintainer's.** Kyusetzu is **6421433**. A plan
  built on the wrong one reads someone else's list and then "finds" bugs in
  the offline page for titles that were never on the list.

## The website

The public site lives in `site/` and deploys to
https://kyusetzu.github.io/Karasu/ through `.github/workflows/pages.yml` — on
a push to `main` that touches `site/**` or `src/app/index.css`, on a published
(non-prerelease) release, or by hand. It is its own npm project with its own
lockfile and `node_modules`; nothing under `site/` is imported by the app, and
the app's vitest projects cannot see it (`src/**` only). Layout, stack and the
review checkpoints are in `site/README.md`.

- **Site-only commits do not bump the version and do not run the app loop.**
  The gate is `npm --prefix site run check` (typecheck plus the token
  freshness check), then a prose commit with the `Co-Authored-By` trailer.
  `scripts/changelog.mjs` drops `site/` paths by itself, so no
  `Changelog: skip` is needed. A commit that touches both the app and the
  site goes through the normal six commands, and its changelog line describes
  the app half.
- **A site commit must not build a Nightly.** `release.yml` and `ci.yml`
  carry `paths-ignore: ["site/**", ".github/workflows/pages.yml"]`; keep it
  that way. Push `pages.yml` and the `site/` folder together — the workflow
  runs `npm ci` in `site/` and fails on a tree without it.
- **The app's Tailwind build must not see the site.** `src/app/index.css`
  carries `@source not "../../site";` under the import, measured on
  2026-09-05: with a probe class under `site/src/` the emitted
  `dist/assets/index-*.css` was byte-identical to the baseline with the line
  and 71 bytes larger without it. Re-run that diff whenever the line, the
  import or Tailwind moves; the header of `index.css` carries the numbers.
  `@source not "../../scripts";` sits beside it since 2026-09-25, when the
  style audit's fixtures started naming classes: the emitted CSS lost 254
  bytes, five classes named only in `scripts/`, and nothing the app uses.
- **Tokens are generated, never copied.** `site/src/styles/tokens.generated.css`
  is written by `node site/scripts/sync-tokens.mjs` from the `@theme`,
  `@keyframes`, `@utility`, `:root` and `[data-theme]` blocks of
  `src/app/index.css`, plus the default accent evaluated through
  `src/lib/contrast.ts` — the `@theme` fallbacks are not the colours a user
  sees. Changing any of those blocks means re-running the sync in the same
  commit; the site's `check` fails when the file is stale, and `pages.yml`
  watches `index.css` so drift fails in the open.
- **The UI primitives under `site/src/components/ui` are copies, on purpose.**
  The site's Tailwind scan cannot see `src/`, and an app refactor must not
  break the deploy. `sync-tokens.mjs --report-copies` shows the drift and
  enforces nothing.
- **Every claim on the site has a row in `site/CONTENT-AUDIT.md`** naming the
  file or test that makes it true. No row, no sentence — the site advertises
  the app that exists, not the one that is planned.
- **A site pull request is checked by `site-ci.yml`, not `ci.yml`.** CI ignores
  `site/**`; the Site workflow runs the site's `check` and `build` on a PR that
  touches `site/**` or `src/app/index.css`, and is what the auto-merge below
  listens to for a site dependency bump.

## The dependency graph is checked, not trusted

`src-tauri/deny.toml` is what `cargo deny check` (`npm run deny`, and the
Linux PR job without blocking) holds the Rust graph to: the RustSec
advisories, a licence allow-list that is the spread THIRD-PARTY-NOTICES.md
describes — a crate under anything else fails here before it can ship
unlisted — crates.io as the only source, and duplicates allowed because they
are the ecosystem's business. It found `h2` under RUSTSEC-2026-0258 the day
it was added; `cargo update -p h2` was the fix. Dependabot keeps the npm and
cargo graphs moving; knip and cargo-deny say when something in them is dead
or wrong.

## The dev loop has eyes

Three things a dev build shows that a release never carries. **TanStack Query
devtools** mount in `main.tsx` under `import.meta.env.DEV` (lazy, so the
production graph never sees the package — proven by grepping `dist/assets`),
with the button bottom-left because the detection window owns the other
corner; every request-budget question ("what refetched, what is stale") reads
off it before anyone adds a log line. **react-scan** highlights renders live,
but only when asked: `KARASU_SCAN=1` in the dev server's environment makes
`vite.config.ts` inject `src/app/scan.ts` as the first module script, which is
the one way to load it before `react-dom` (an inline script cannot resolve a
bare specifier, a static import would ship it, and a dynamic one is too late
for the DevTools hook). It slows the app and is off by default for that reason.
`npm run build:analyze` is `rollup-plugin-visualizer` on rolldown — it works —
writing a treemap of every chunk to `dist-stats/index.html` (ignored); open it
before guessing what the index chunk is made of.

## Three Cargo tools that answer questions, run by hand

`npm run deps:unused` is cargo-machete over the crate (it does not read
`build.rs`, so `tauri-build` sits in `[package.metadata.cargo-machete]`);
its first run on 2026-09-20 found `windows-future` declared and unused — the
`join()` it was kept for reaches `smtc.rs` through `windows`' own re-export, so
the line went. `npm run bloat` is cargo-bloat over the release exe, and the
answer on 2026-09-20 was not the suspected one: of a 23.3 MiB file, `.text` is
16.4 MiB and the `windows` crate is not in the top sixty (its bindings inline
into `karasu_lib`); the weight is tauri 2.6 MiB, std 2.6, karasu_lib 2.2,
tokio 1.3, the HTTP stack (reqwest, rustls, h2, hyper) ~1.5, and the regex
family ~0.8. The one oddity is two crypto backends at once — `ring` (125 KiB)
beside `aws_lc_sys` (197 KiB), because `tauri-plugin-updater`'s reqwest wants
rustls with `ring` while ours resolves to aws-lc — worth ~300 KiB if anyone
ever cares, which is not now. `npm run mutants` is cargo-mutants through
`scripts/mutants.mjs` (the copy holds `src-tauri` alone, so the wrapper drops
the `../THIRD-PARTY-NOTICES.md` resource through `TAURI_CONFIG` or
tauri-build refuses to configure it); `src-tauri/.cargo/mutants.toml`
excludes the arms that do not compile here. First run, 2026-09-20, `scrobbler.rs` alone with four jobs: 182 mutants in
16 minutes, 151 caught, 19 missed, 10 unviable, 2 timeouts. Eight of the
misses were the `* 60` in the duration constants (a constant has no test but
its value), three were `emit_session` (a window event, unobservable from a unit
test), and six pointed at real gaps that got tests the same day: `season_key`'s
`-1`, `detection_override`'s three-part key, `cached_user_id` and
`candidates_from_cache`. Read the misses as questions, not as a score to push.

## Packaging beyond the release page

`packaging/` holds what other channels need and the repository can prepare;
the submissions themselves are the maintainer's. **Flatpak**:
`packaging/flatpak/dev.kyu.karasu.yml` builds from the release `.deb` (extract,
install the binary, re-name the desktop file and icons to the app id, which
Flathub requires), `dev.kyu.karasu.metainfo.xml` is the AppStream data, and
`scripts/release/flatpak-manifest.ps1 -Tag vX.Y.Z` fills the URL, the sha256
and the release date from that tag. The `Flatpak` workflow (dispatch, input
`tag`) validates the metainfo with `appstreamcli --pedantic` on the runner and
builds the bundle in the GNOME 50 builder image; run it before a Flathub pull
request. The `finish-args` are each a feature — StatusNotifier for the tray,
`org.mpris.MediaPlayer2.*` for the media-session pass, `org.freedesktop.secrets`
for the token, the settings portal for the accent, network for AniList and the
OAuth callback — and `SUBMISSION.md` there lists what the sandbox changes
(autostart writes an app-private folder, the updater stays off through
`can_install`). **F-Droid**: `packaging/fdroid/dev.kyu.karasu.yml`
is the fdroiddata recipe, `scripts/release/fdroid-recipe.ps1 -Tag` fills its
version, code and commit, `fastlane/metadata/android/{en-US,de-DE}` is the
listing F-Droid reads at the tag, and the `Reproducible` workflow (dispatch,
input `tag`) rebuilds the arm64 APK on a fresh runner and diffs it against the
release with `apksigcopier compare --unsigned`. Reproducibility rests on
four things the tree now fixes: `rust-toolchain.toml` pins the exact version
(and `src/lib/toolchain.test.ts` fails the gate when a workflow's
`dtolnay/rust-toolchain` step or the recipe names another — CI passes the
pin as `toolchain:` because the action does not read the file, and rustup's
auto-install would otherwise leave the Android targets on the wrong
toolchain), the Android job remaps `RUSTFLAGS --remap-path-prefix` for the
workspace and `~/.cargo` and pins `SOURCE_DATE_EPOCH` to the commit, and two
build-time switches — `KARASU_NO_SELF_UPDATE` (`self_update_disabled` in
`commands/update.rs`; F-Droid forbids self-updating apps, so the check and
the install both stand down) and `KARASU_UNSIGNED` (`build.gradle.kts` emits an
unsigned release instead of falling back to debug signing). Bumping the
Rust pin means the toolchain file, the five workflow steps and the recipe in
one commit; the test says so. Nothing under `packaging/` is built by the
release; it reads the release.

## Links are checked weekly, not trusted

`.github/workflows/links.yml` runs lychee every Monday (and by hand) over the
markdown, the issue forms, the website's copy and the i18n files, with
`lychee.toml` carrying the exclusions: the POST-only GraphQL endpoint, the dev
server, private addresses (the Settings hint's example Jellyfin URL), and 429 as
an accepted answer because GitHub throttles a burst of HEADs. The first run on
2026-09-20 found 84 links alive and 10 redirecting for good reasons
(`releases/latest`, the issue-form links that bounce through login), so a
redirect is not a finding here; a failed run is, and it lands in Kyu's inbox as
the workflow's own notification. `cargo install lychee` and `lychee --config
lychee.toml -- '*.md'` reproduce it locally.

## The Actions cache is 10 GB, and a PR must not spend it

Measured on 2026-09-19: the Nightly ran with no Rust cache at all because four
Dependabot PRs two days earlier had each saved a ~1 GB Windows cache under
their own `refs/pull/N/merge` key, and the store evicts oldest-first. So every
rust-cache step names a `shared-key` per platform (`windows`, `linux`,
`android`) that `ci.yml` and `release.yml` share, and the PR jobs carry
`save-if: github.ref == 'refs/heads/main'` — a PR restores main's cache and
never writes one. A PR that changes `Cargo.lock` therefore compiles on top of
main's nearest cache and saves nothing, which is the intended price. Both
workflows also ignore `*.md`, `assets/screenshots/**` and the issue forms, so a
changelog-marker commit builds nothing; every job has a `timeout-minutes` and
every artifact a `retention-days`; and the four small workflows pin
`ubuntu-24.04` rather than ride `ubuntu-latest` into the 26.04 migration.

## Dependabot merges itself

`.github/workflows/dependabot-automerge.yml` merges a Dependabot PR when the
check workflow for it — CI for the app, Site for the website — finishes green
on the PR's current head. It runs on `workflow_run`, so it cannot fire before a
build has spoken and needs no branch protection to wait, which is what keeps
direct pushes to `main` as they are. It refuses a PR not opened by
`dependabot[bot]`, one from another repository, or one whose head moved after
the tested commit. Three consequences to know:

- **The merge builds no Nightly and bumps no version.** It is made with
  `GITHUB_TOKEN`, and a push made with that token starts no workflow by
  design. The dependency sits on `main` until the next real commit, which
  carries the version bump and the Nightly for both — the same way a
  hand-merged Dependabot PR always worked here (they never bumped either).
- **A PR neither workflow runs for is never merged automatically** — a change
  outside both path lists waits for a person. Dependabot never opens a
  semver-major PR for npm or cargo (`dependabot.yml`), so the workflow grades
  nothing; if that ignore list ever loosens, this is the place to add a
  `fetch-metadata` gate.
- **Re-running a PR's CI is the way to merge it by hand through the
  automation** (`gh run rerun <id>`); the re-run keeps Dependabot as the
  run's actor, the merge follows.

## Invariants the release audit established

Each of these closed a group of real defects, and each is the kind of rule that
comes back the moment it is only remembered rather than enforced. They are
written as rules because that is what the audit found: the same mistake in
four or five places, made by careful code, because nothing said it once.

- **`list_cache` has one owner.** `db::edit_cached_list` does read, edit and
  write under a single lock, and `cache_patch_entry` / `cache_forget_entry`
  are the only ways an entry changes. *Every* write path calls them — the live
  save, the bulk chunks, the delete, the queue drain — because the scrobbler's
  two anti-regression guards read this table as truth. Fed a stale copy, they
  let a scrobble overwrite the user's own newer edit, and a deleted entry stayed
  a scrobble candidate that `SaveMediaListEntry(mediaId:)` then recreated.
- **`Queued` is not success.** `save_entry_core` answers `queued` for anything
  that could still work later, and no caller may treat that as landed: no
  `Phase::Updated`, no cache patch, no `scrobble-done`, no green receipt.
  `Outcome::{Landed, Queued, Refused}` exists so the compiler asks. A
  *skipped* drain takes the same exit as a failed one, in all three mutating
  commands.
- **Identity changes only through `commands::auth::switch_identity`.** It
  forgets the outgoing account first and writes the identity *before* the
  credential. The order is the point: a failure then leaves "this account, no
  credential", where the drain finds nothing, rather than "new credential, old
  identity", which sends one account's queued edits under another's bearer.
  `refresh_viewer` is deliberately outside it — same account, fresher data.
- **The tick re-reads what the tick decides on.** `settings.enabled`, the gap
  grace and play state are read at the due point, not at session creation. A
  session survives `EMPTY_TICK_GRACE` empty polls, because on any source that
  reports only playing sessions a pause is indistinguishable from a stop. No
  phase carrying a write in flight may arm — that invariant is what makes
  spawning the write safe, and it has a test of its own.
- **Validate by parsing, never by spelling.** `net::host_is_local` canonicalises
  to an `IpAddr` before any range test. Three spellings of loopback walked
  through the string-matching version it replaced. `to_ipv4` is not the tool:
  it converts IPv4-compatible addresses too, turning `::1` into `0.0.0.1`.
- **The limiter reads its own deadline.** A `Retry-After` outranks the local
  budget, and `MAX_PACE` bounds only our own pacing. One retry layer, not two:
  429 answers with the stable code `RATE_LIMITED` so the frontend can refuse it
  without re-implementing the classification in TypeScript.
- **A partial result is a value, not an absence.** A failed list query is not an
  empty list, and a query in the error state has `isLoading === false` with no
  data — so destructure `isError` wherever `data` is used, or the screen states
  the opposite of the truth as settled fact.
- **The five version files must agree.** `node scripts/bump-version.mjs --check`
  proves it and the release workflow runs it before building. A mismatch between
  `package.json` and `COMMIT_NUMBER` makes every install re-download its own
  update forever.

## Design language

`DESIGN.md` at the root is the brief for how Karasu looks and moves, and it
outranks any design skill, library default or mockup: the principles ("dark,
dense, quiet"), the token vocabulary and what each step is for, the contrast
obligations every theme must meet, the primitive to use for each recurring
shape, the libraries approved and declined, and the dated decision log. The
conventions below that touch styling (accent, motion registers, exits, banners)
stay here as rules; DESIGN.md says what they add up to. A change to how a screen
is *arranged* gets three mockups before code, and the choice goes into that log.

**`scripts/style-audit.mjs` is the vocabulary's gate**, the comment audit's twin
and the third phase of `npm run verify`. It parses every app `.ts`/`.tsx` with
`oxc-parser` (the parser knip already carried, now a direct dev dependency,
because TypeScript 7 no longer ships a JS compiler API) and counts, per file and
rule, what DESIGN.md calls drift: bracketed radii, sizes, tracking, z-index,
shadows and motion values; hex and rgb in a class; a shade the theme does not
define (read from `index.css`'s `--color-*` names, so `ink-200` is caught and
renders nothing); Tailwind's own palette; broad transitions; `animate-spin`
outside the spinner; `outline-none` with no focus style beside it or on a
`focus-within:` wrapper; a class cut at a template `${}`; icons off the
14/16/20/32 scale; and Base UI or Motion imported outside their wrappers.
`scripts/style-baseline.json` is a ratchet, not a licence: `--check` fails when
a count rises above it *and* when it falls below, so the commit that removes
drift also runs `--tighten` and the room cannot be spent again. `--record`
rewrites it outright and is for a deliberate raise, which the diff then shows.
`scripts/style-allowlist.json` holds the permanent exceptions, each with its
reason, and an entry nothing matches fails the check. Recorded on 2026-09-25:
380 findings in 91 of 281 files, half a second a run.

**`scripts/screens.mjs` shows the real app, and it is how a UI change is
proven.** It serves `scripts/screens/` (the whole `App`, shell included, over
`mockIPC` answers and fixture lists) and drives Chromium: `shoot` renders twelve
named screens (six desktop, six phone) per style and theme, `board` lays them
out for the maintainer, `clip` records motion side by side, and `hash` takes
still frames at a fixed clock with motion off. Two `hash` runs agree, so an
unchanged hash is the proof that a mechanical refactor moved no pixel. The
banners and covers of three real titles are fetched from AniList into
`scripts/screens/.cache/` on first use and never committed; the stand-in faces
are Roboto for Android and Open Sans for Segoe UI, which Linux lacks. The
project skill `.claude/skills/karasu-mockups` holds the procedure the
maintainer expects: three mockups before an arrangement changes, the boards'
shape, and the question that follows them.

## Conventions

- **One commit per feature.** The maintainer commits per feature; keep changes
  scoped. Commit messages end with the `Co-Authored-By:` trailer.
- **Validate AniList queries live** before wiring new fields (introspection /
  a throwaway Node script), since the schema is the source of truth. A *mutation*
  cannot be validated by running it — that means editing real entries — so use
  schema introspection (`__type(name: "Mutation")`) for its argument list
  instead; that is how `UpdateMediaListEntries` was widened past status/score.
  Scalars on `LIST_QUERY` (`startedAt`, `completedAt`, `private`) are cheap and
  fine; nested edge lists like `studios` are not, and belong to `DETAIL_QUERY`.
- **DB changes go through a new `MIGRATION_V*`** guarded by PRAGMA
  `user_version`; add a `mem_db()` test. Run it through `apply`, which wraps the
  step in a transaction so the schema change and its `user_version` bump land
  together — `execute_batch` alone commits each statement separately, and a
  crash in between leaves a database that is migrated but not labelled as such.
  Prefer `CREATE TABLE IF NOT EXISTS` so a step is re-runnable anyway; `ALTER
  TABLE ADD COLUMN` is not, which is why v7 has to ask whether the column is
  already there.
- **Platform-specific Rust is `#[cfg(...)]`-gated**, and both Windows and Linux
  are real implementations rather than one plus a stub. Keep the pure decisions
  out of the gated modules — `media_session/mod.rs` is the pattern: the backends
  supply data, the shared module decides, and its tests then run on both
  platforms instead of only in the Linux CI job. macOS is deliberately *not*
  covered: the keyring dependency is declared for `cfg(windows)` and
  `cfg(target_os = "linux")` only, so a macOS build fails at the manifest
  rather than compiling a Secret Service backend that cannot work there.
- **Accent colours** derive shades + a readable ink colour (`src/lib/contrast.ts`);
  use `text-accent-ink` on accent-filled controls rather than hard-coded
  `text-white`. The accent has two sources: the user's hex (`karasu-accent`)
  and the OS's, chosen by `karasu-accent-source` and read through
  `system_accent` in `commands/system.rs` — `UISettings::GetColorValue(Accent)`
  on Windows, the settings portal's `org.freedesktop.appearance accent-color`
  on Linux (GNOME 47+, KDE; older portals answer an error, so `None`), and
  `android.R.color.system_accent1_500` through `SystemAccent.kt` on Android
  12+. The store keeps the user's colour underneath (`effectiveAccent`),
  re-reads on window focus only while following the system, and the
  Appearance toggle is disabled with a hint where the answer is `None`. On
  the rig on 2026-09-20 the switch painted Windows' `#0078d4` and came back
  to the saved colour; Linux and Android are compile-checked only.
  Contrast is its own setting beside the theme (`karasu-contrast`: system,
  standard, high; `lib/contrast` `resolveContrast`): high sets
  `data-contrast="more"`, which swaps the palette in `index.css`, and passes
  `contrast: "high"` to `accentShades`, which lifts the accent to 7:1. Never
  key a high-contrast rule on `@media (prefers-contrast)` in the app — that
  would override a user who chose Standard; the site, which has no setting,
  gets the media query from the token sync.
- **Overlays carry `data-overlay`.** Screen-level key handlers check for it and
  stand down, so a dialog owns the keyboard instead of the list behind it acting
  on the same press. `GlobalKeys` honours it too.
- **Overlays also register with `useBackClose`**, so the Android back gesture
  (and the browser back button) closes them instead of leaving the page.
  `ui/modal.tsx` does it once for every dialog; an overlay that rolls its own
  chrome adds the one line. The protocol — one same-URL history entry per
  overlay, a single popstate listener, a one-shot swallow when closing by
  other means — is `lib/backStack`, pure and tested; Escape and backdrop
  closing must keep working on their own, because the back path is additive
  and the tests assume net-zero history entries either way. **A URL `replace`
  must never land while an overlay's entry is current** — React Router
  overwrites the marker, the stack no longer recognises it, and the next back
  press undoes the write. `afterBackSettles` (the stack's `whenSettled`) runs a
  callback once no overlay holds an entry and no unwind is due; `MediaList`'s
  `setView` goes through it and merges what queues up in call order, and the
  toolbar's panels edit a draft the list draws at once and `setView` writes on
  close. `Popover`'s `closeThen` is the same wait for anything a panel opens.
- **A banner is shown whole, and its own edges fill the rest.** AniList banners
  are a fixed strip: of Summer 2026's 36, 34 measured exactly 1900 × 400
  (4.75 : 1) on 2026-09-25, the others 3.33 and 2.22. `BannerImage` contains
  the picture (`lib/bannerFit` places it), feathers each edge that meets a gap,
  and fills the gap with the picture's outermost rows or columns stretched and
  blurred, so the colours carry on and nothing repeats. Two fills were tried
  and dropped: a blurred centre crop (its colours did not continue the edge,
  which drew a hard seam top and bottom) and a mirrored copy (it repeats a face
  or an eye as a ghost). The detail header follows the width below the desktop
  cap — `min(16rem, 100cqw / 4.75 + 5.5rem)`, a 44 px band above for the back
  button and one below for the cover — because a fixed 256 px showed a phone
  an 85 px banner in two thirds blur. The query container sits on a wrapper
  around the header, never on the page root: containment would make that root
  the containing block of every `fixed` overlay rendered inside it.
- **The phone's detail header floats the cover.** The title and the native title flow beside it and
  carry on beneath it when they are longer; every fact — the meta line, genres, the next episode, the
  action row with the status button — sits below the cover whatever the title's length. Chosen by the
  maintainer on 2026-09-25 over three rounds of mockups: a short title leaving air beside the cover beats
  a narrow column that squeezes. `usePhoneShell` picks the layout, so the desktop header is untouched.
  The status button (`StatusMenu`) is the page's whole entry editor, on the phone in the action row
  over a sheet and on the desktop under the title over a dropdown; there is no editor card any more.
  `QuickEditor` saves status, progress steps and the score as they are touched (receipts and Undo come
  from `useListMutations`), a typed count when its field is left or the sheet closes on it, and
  rewatches, tags and notes together behind "More". The score is `CommunityScore`: AniList's own
  histogram from `DETAIL_QUERY` (no extra request) as the bars, folded onto the account's format by
  `lib/scoreDistribution`, with the community mean marked beneath. A first add goes through
  `saveListEntry` with the media object, because a new local entry is refused without it; a save's echo
  reaches the page only through `lib/listEcho`, since the local echo names no status. Count fields
  everywhere are `ui/number-input`: an emptied field reports 0 and a stored 0 shows as the placeholder.
- **Local text matching goes through `lib/fuzzy`.** Exact > substring >
  word-prefix > trigram containment, scored per title — per-title docs are
  what make a query structurally unable to match across two adjacent names
  (the straddle bug the old NUL-joined haystack guarded by construction).
  Don't reintroduce a bare `.includes` filter or a joined haystack; the
  AniList search *page* stays server-side `SEARCH_MATCH` and is not this
  module's business.
- **Content-filter rules live only in `lib/contentFilter`.** `blockReason`
  names *why* a title is hidden (adult wins over suggestive, so nothing
  counts twice), `isBlocked` is its boolean face, and `FilteredNotice` is the
  one disclosure line every surface renders — the settings pane's vocabulary,
  linking to `/settings?pane=appearance`. On search the adult bucket is 0 by
  construction (the server strips adult before it arrives); the split is
  carried anyway so the sentence stays honest.
- **The bell is one stream, and its grouping is presentation only.**
  `lib/notifGroups` unifies Karasu rows (milliseconds) with AniList rows
  (seconds), collapses runs by actor or by media in a 48h window, and is
  recomputed over the loaded set — nothing persists, which is what keeps it
  inside the no-local-activity-store line. The one cross-source group
  (airing) leans on `alerts/airing.rs` never writing a local row AniList
  already covers; site unread is a snapshot of the count taken before the
  page-1 mark-seen reset, an honest approximation and labelled as one. An
  activity row's press opens the activity; the actor's name is its own link.
  `useNotifications` holds all of it once for the three surfaces — the
  titlebar's dropdown (the newest three), the phone's tall sheet and
  `/notifications` — and today/earlier (`sectionByDay`) is presentation too.
  A row that navigates goes through the surface's `leave`, so an overlay's
  back entry has unwound before the destination's is pushed.
- **A thread can land on one comment.** `/thread/:id?comment=<id>` rides the
  same uncapped `ThreadComment(id:)` tree route as the newest-jump — one
  request at any thread size, including comments past the 5,000-entry paging
  cap. `ThreadTarget` in `lib/threadJump` is the whole state machine, the
  param is cleared with `replace` by every way of leaving the view so it
  cannot outlive it, and `visibleAnchor` in `lib/comments` returns
  `{ id, exact }` — a pure function that says whether its own answer is the
  clicked comment or its nearest drawable ancestor, so the highlight can
  degrade honestly instead of pointing at the wrong row.
- **Paging is a button, never a scroll.** Every paginated list — followers,
  following, user search, activities, threads, comments — uses
  `useInfiniteQuery` with `fetchNextPage` on a click and no `IntersectionObserver`
  anywhere. The reason is the limiter in `anilist/client.rs`: it is a ~30/min
  brake shared with the scrobbler and the four alert passes, and it reads its
  budget then drops the lock *before* any response header lands, so it cannot see
  a burst it has not sent. A feed that fetches because the user scrolled spends
  that budget with nobody asking. Two further traps, worth knowing before
  touching an infinite query: `refetch()` refetches **every** retained page —
  six loaded pages are six requests, which is why `UserList` keeps a long
  `staleTime` and never calls it — and `maxPages` evicts from the far end, so
  the pages being read are the ones that vanish.
- **Two queries per mount, at most.** Same cause. The profile spends its two on
  the user and the follower totals; everything else arrives when a tab is
  activated, which is a second user-initiated moment rather than a fourth
  concurrent request clearing a pre-flight check that has not been updated yet.
- **A pure function returns an i18n *key*, never a sentence.**
  `src/lib/i18nKeys.test.ts` only sees literal `t("…")` calls, so
  `` t(`social.verb${v}`) `` is invisible to it — and AniList makes this matter
  rather than academic: it composes activity sentences itself, in English only, so
  a German feed would read half-translated. `listActivityVerb`, `relationBadgeKey`,
  `validatePost` and the twenty notification labels all return closed unions that
  a component maps through a literal switch, which is the shape `receiptText` in
  `useListMutations` established.
- **Two motion registers, and the default is the quiet one.** *Surface* motion —
  hover, focus, background and border — stays on the 140ms `--ease-karasu` that
  every plain `transition-*` utility already inherits. *Feature* motion, for the
  few moments worth noticing (a dialog arriving, a scrobble landing, a chart
  drawing), may use `--ease-spring`, `--ease-out-expo` and
  `--duration-expressive`. Reach for the first unless there is a reason;
  springs everywhere is how an app starts feeling slow.
- **Exit animations go through `usePresence`.** React unmounts before CSS can
  animate, so `{open && <Modal/>}` can only ever have an entrance. The hook
  holds the node for the exit and reports `leaving`; keep emitting
  `data-overlay` while it does.
- **Motion that CSS cannot see must ask `lib/motion.ts`.** The reduce-motion
  rules in `index.css` are `!important` overrides on animation and transition
  properties — they do nothing to a View Transition, a scroll handler, a WAAPI
  call or a `setTimeout`. Those read `prefersReducedMotion()` /
  `motionDuration()` themselves. Staggers use `staggerDelay`, which also zeroes
  the *delay*: collapsing only the duration turns a stagger into a staggered
  wait.
- **Scores live in the account's `scoreFormat`, end to end.** Reads pass
  `$scoreFormat` (never a pinned `POINT_10`), writes go through `scoreRaw` —
  the format-independent 0–100 int — because a bare `score: Float` is
  interpreted in the account's format and silently corrupted non-ten-point
  accounts for years. `lib/scoreFormat.ts` is the one vocabulary
  (`toRaw`/`fromRaw`/`formatScore`/`scoreScale`); local mode stays ten-point.
- **Statistics scores are normalized in `userStatistics`.** AniList mixes a
  hundred-point `meanScore` with a distribution in the user's *display* format,
  and says so nowhere. `normalizeStatsBlock(stats, format)` brings everything
  onto the display scale at the boundary; chart domains take
  `scoreScale(format).max`, not a literal 10.

## Performance invariants

Each of these looks like cruft and is not. They were measured; don't "tidy"
them away without re-measuring.

- **`@font-face` is hand-written in `index.css`.** Importing the `@fontsource`
  stylesheets instead pulls a woff fallback neither WebView2 nor WebKitGTK will
  ever use — the Kosugi Maru woff is 1,876,732 B (1.79 MiB), carried by the
  installer and every auto-update on top of the 1.44 MB woff2 that is actually
  used. Not the `400.css` variant either: 121 unicode-range subsets, ~4.37 MB
  of woff2 if all of them ship. (The 7.9 MB figure this note used to give is the
  size of the whole `files/` directory — every weight and both formats — not of
  anything a build would emit. The decision was always right; the arithmetic
  was not.)
- **The 1.44 MB Japanese subset cannot be trimmed.** It backs `font-brand-jp`,
  which renders arbitrary `title.native` in `TitleLockup` (itself used by five
  call sites, including every virtualized row), `AnimeDetail`, `Franchise` and
  `CommandPalette`. A fixed-glyph subset would fall back to Yu Gothic UI per
  missing glyph — mixed typefaces inside one title, which is worse than either
  whole font.
- **`reqwest` enables `gzip` and deliberately not `brotli`.** AniList prefers
  `br` when offered both, and `br` measured *larger* than gzip on the list
  payload.
- **The status tabs never wrap.** `status-tabs.tsx` is one row that scrolls
  sideways (hidden scrollbar, an edge fade only while it overflows, the wheel
  mapped to `scrollLeft`), and the underline is measured against that inner
  `w-max` row, not the page. The wrapping version needed a `+14` offset
  calibrated to the consumer's bottom padding and correct on the last row
  only — it struck through the second row's labels — and it cost the phone two
  header rows. Do not bring the wrap back; a narrow window scrolls the strip,
  and the active tab is scrolled into view on every change, a swipe's included.
  The underline takes the active tab's `color` (the status colour from
  `MediaList`, the accent without one) and carries `data-keep-colors`, so High
  Contrast keeps it. A touch on an overflowing strip scrolls it rather than
  switching tabs, because `useTabSwipe` leaves sideways-scrolling elements alone.
- **The cover progress line is a border, not a bar.** A straight strip inside
  the cover's `rounded-lg` clip had its ends eaten by the corner circles; the
  line is a `border-b` on an inset-0 overlay revealed by `clip-path`, so it
  bends into the frame's own corners and a +1 still animates the growth.
- **`min-w-0`, not `shrink-0`, on a row's trailing text block.** `DigestRow`'s
  right side was pinned at max-content by `shrink-0`, and one long German note
  handed the whole page a sideways scroll (`<main>`'s `overflow-y-auto`
  computes `overflow-x: auto`, so any too-wide element scrolls everything).
  The same lesson as `SectionHeader`'s h2.
- **The cover grid is `repeat(var(--cover-cols), minmax(0, 1fr))`** — the
  covers-per-row field, one token written by the theme store, defaulting by
  platform at first run (10 desktop, 4 Android — UA-keyed, since the store
  boots before `platform_info` answers) with a one-time migration from
  the old s/m/l keys. Two shapes died here and should stay dead: fixed-size
  tracks (could not tell medium from large on a phone) and an unlayered phone
  override of them (silently beat the utility layer and killed the setting).
  `VirtualGrid`'s `watch={coverCols}` re-measure is load-bearing — the
  ResizeObserver cannot see a track re-flow that leaves the probe's own size
  alone.
- **The list view's columns are fixed tracks, sized in `components/list/columns.ts`.**
  `VirtualGrid` makes every visual row its own grid container, so `subgrid` is
  unavailable and an `auto`/`fr` track resolves differently per row — only
  identical fixed tracks line up down the page. A fixed track also overflows
  rather than shrinking, which is why the column *set* changes with the measured
  container width (`useRowTier`) instead of a `2xl:` breakpoint. Never put a
  width on a list cell at the call site: a fixed width nobody checked against
  its worst case is what clipped every `★ 10` score and every `500 / 500`
  progress, and `columns.test.ts` is what keeps the widths honest — including two
  assertions that the *old* widths still do not fit, so a green suite cannot mean
  the measurement drifted.
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
