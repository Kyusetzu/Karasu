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
- **Charts:** drawn by hand in SVG/JSX; `d3-array`, `d3-scale` and `d3-shape`
  supply the maths only — there is no chart library and the renderer stays ours
- **Rendering:** `@tanstack/react-virtual` virtualizes the media lists. Rows are
  chunked by hand, so anything that renders one needs a column count — take it
  from `useColumnCount`, which reads the browser's resolved
  `grid-template-columns` rather than recomputing the CSS in JS
- **Storage:** SQLite via rusqlite (bundled); tokens in the OS credential store
- **Detection:** system media sessions (SMTC on Windows, MPRIS on Linux) +
  Win32 window enumeration (Windows only) + an optional Jellyfin `/Sessions`
  source, with a custom release-name parser
- **Platforms:** Windows and Linux (x86_64), plus Android (sideloaded APK;
  arm64 is the one that matters). Window-title detection is Windows only —
  there is no X11/Wayland enumerator and Wayland forbids one — so on Linux the
  media-session pass and Jellyfin are the whole of detection, and browser *tab*
  titles are only seen where the browser publishes MPRIS. On Android detection
  is Jellyfin alone, decided in the first device round: the desktop detection
  machinery is greyed out in Settings under a "desktop only" badge, never
  hidden. The phone shell is width-keyed (`usePhoneShell`, 767px), not
  user-agent-keyed.

## Layout

```
src/
  app/               App.tsx, main.tsx, index.css — the entry, and only the entry
  api/               AniList GraphQL client, queries, types, franchise, library,
                     social (the whole profile/follow/forum surface)
  components/
    ui/              primitives with no app knowledge (kebab-case files)
    shell/           the window frame and global machinery — titlebar, sidebar,
                     bell, command palette, keyboard sheet, context menu, toast
    media/           anything that renders a title or edits an entry
    overlays/        modal flows (confirm, preset, random pick, sign-in merge,
                     profile edit, match picker, favourites, new thread,
                     season split, cover viewer)
    list/            the parts MediaList draws (virtual grid, rows, bulk bar)
    stats/           the parts Statistics draws — panels, ranked list, Charts
                     (radar/sunburst/treemap), AreaChart, DotPlot, GradientBars,
                     Heatmap
    social/          the parts UserProfile, Social and Thread draw — the
                     markdown renderer, follow button, user and activity and
                     thread rows, and the two composers
    EmptyState · Skeleton · KarasuMark · FilteredNotice — cross-cutting,
    belong to no group; FilteredNotice is the content filter's one disclosure
    line, so the three surfaces that show it cannot drift apart
  hooks/             shared hooks (useListMutations, usePrimedLists,
                     useColumnCount, useRowTier, useListSummary, usePanZoom,
                     useCachedEntry, usePresence, useViewTransitions,
                     useAniListLogin, useFollow, useSocialActions,
                     useFavourite, useActivityPost, useUpdateUser,
                     usePhoneShell, useBackClose, useNotifBadge)
  i18n/              index.ts (setup) + en.ts + de.ts; `de: typeof en` enforces
                     key parity across the two files
  lib/               pure logic + its *.test.ts — the place testable code goes
  pages/             one per route; settings/ holds the eight panes
  stores/            Zustand stores (auth, theme, library, nowPlaying, …)
src-tauri/src/
  commands/          93 of the 107 frontend-facing commands, by subject:
                     auth · images · list · playback · prefs · system ·
                     update. The other 14 are the library scanner's, in
                     `library.rs`.
                     `mod.rs` re-exports all of it, so `commands::x` paths and
                     `generate_handler!` do not care which file a command is in.
                     Note what is *not* here: the entire social surface adds no
                     command at all, because `anilist_query` in `auth.rs` is a
                     generic authenticated passthrough and the token stays in
                     Rust either way
  playback/          the pipeline: detection/ (Win32 windows, media_session/
                     — SMTC on Windows, Jellyfin) →
                     recognition/ (release-name parser, fuzzy matcher) →
                     relations (episode redirects) → scrobbler (when to write)
  alerts/            the background passes that end in a notification —
                     airing, sequel, stale, and notify itself
  anilist/           auth (token handling), API client
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
                     the trade — user-installed CAs are not honoured on
                     Android — is documented in the module
  gen/android/       generated by `tauri android init` and REGENERATED by it:
                     three files are hand-edited and say so in comments —
                     buildSrc's BuildTask.kt (spawns `node …/tauri.js`
                     directly; Gradle cannot spawn npm shims under nvm4w),
                     MainActivity.kt (native edge-to-edge insets; the WebView
                     cannot see the status bar), app/build.gradle.kts (release
                     signing from gitignored key.properties, falling back to
                     debug signing so CI without secrets still builds).
                     Re-apply them after any re-init
  discord.rs · library.rs · portable.rs
scripts/             bump-version.mjs (every commit), anilist-query.mjs
                     (validate a query live), android-check.ps1 (the fast
                     cfg(mobile) gate — cargo check for aarch64 with the NDK
                     env exported); release/ holds the four PowerShell scripts
                     the release workflow runs (installer, AppImage and APK
                     renamers are deliberate near-twins, plus release-notes)
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

Two more, decided by the maintainer in August 2026:

- **Plex and Emby integration.** The maintainer uses Jellyfin (free, open
  source) and has no use for supporting a paid product he doesn't run.
  Revisit only if actual users ask for it — do not propose it unprompted.
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

The schema is at **v17** (v17 seeds `blur_adult` on for new installs only —
an existing install's explicit choice, or absence of one, is left alone). `library_match` (v8) holds the scanner's per-title
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
NSIS bundle builds and `appimage` is correctly skipped; the AppImage is built by
the `linux-build` job in CI, which is also the only place Linux-only code is
compiled at all.

Prefer extracting pure logic into `src/lib/*.ts` (or a pure Rust fn) and unit
testing it. Untestable-by-construction logic in a component is the usual reason
a regression here is invisible until it ships.

**Two vitest projects, and the filename picks one.** Everything runs in **node**
by default; only `*.dom.test.tsx` boots jsdom and Testing Library, via the
`projects` block in `vite.config.ts`. That split is what keeps the suite under
~4 s for ~550 tests, and it is a *name* rather than an inference on purpose:
`components/stats/Charts.test.tsx` renders with `renderToStaticMarkup` and needs
no DOM, so an extension rule (`.tsx` ⇒ jsdom) dragged it into one and the suite
went from 2.0 s to **14.1 s**. Needing a DOM is a decision, so it is spelled out
in the filename. `src/test/render.tsx` holds the provider wrapper and the
sign-in helpers; it imports Testing Library, so nothing in the node project may
import it.

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
- **A suite that finishes far faster than usual failed early, it did not get
  faster.** The Rust suite takes ~0.5 s; a 0.02 s run means something bailed.
- **Never pipe `npm run verify` through `grep`.** The pipe reports *grep's*
  exit status, so a `tsc` failure sails through and gets committed. Run it bare
  and read the exit code.
- **Never add `panic = "abort"` to `[profile.release]`.** `lib.rs` catches the
  panic `libappindicator-sys` raises when it cannot dlopen the AppIndicator
  library — that catch is the only reason Karasu starts on a Linux desktop
  without it, and `abort` would silently kill it.
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
- **Debug-signed and release-signed APKs do not install over each other.**
  Android refuses the signature change; the other one must be uninstalled
  first, which wipes app-local data. This is why CI publishes only
  release-signed APKs (and only when the four `ANDROID_*` secrets exist), why
  the debug APK stays a workflow artifact, and why the phone should only ever
  see release builds once one is installed.
- **Android has no updater and must not gain one by accident.**
  `updater_available()` is a cfg'd pair answering false on mobile;
  `generate-update-manifest.ps1` knows nothing about Android on purpose. APK
  updates are `adb install -r` or a store, ever.
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
  which blanked the whole detection pass.
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
- **`Page.users(search:)` needs three characters.** Two returns the exact match
  followed by a fixed set of unrelated accounts — `"ky"` yields
  `["ky", "user10151", "Gregorymr", …]` — and so does any single character or
  non-Latin string. Media search is fine at two and keeps it; `USER_SEARCH_MIN`
  is why they differ.
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
- **`Page.threadComments` returns `perPage + 1` rows, and the extra one is out
  of sequence.** At `perPage: 10`, page 1 of thread 1 came back as
  `17,18,19,23,30,`**`2088149`**`,32,40,43,44,53` and page 2 carried `1618189`
  between `163` and `165` — eleven rows both times, while `pageInfo` kept
  reporting `perPage: 10`. **Cause unknown**; it is recorded because each "Load
  more" therefore draws one chronologically wrong row, not because it is
  understood.
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
  permits: size cap, content-type allowlist (no SVG — it is a scripting
  context), timeout, no cookies, no `Referer`, and local/private hosts refused on
  the URL *and every redirect hop* so a crafted bio cannot probe the LAN. The
  host still learns the user's IP; that is unavoidable in any design that shows
  the image, and it is the residue rather than the part that was solved. Anything
  that fails falls back to the chip. **Do not "simplify" this into a CSP
  change** — that is the thing the measurement rejected.
- **MSVC writes an 11 MB `karasu.pdb` on every release build and there is no
  flag reaching the linker to stop it.** `debug = 0` and `strip = true` are
  already set, `cargo build --release -v` shows no `/DEBUG`, no `-Cdebuginfo=`
  and no `/PDB` — and the file is still produced and hardlinked into `deps/`.
  It is not bundled, so this is target-dir disk and nothing else. Looked at
  once; don't spend the afternoon on it again.

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
  covered: the keyring dependency is `cfg(target_os = "linux")`, so a macOS
  build fails at the manifest rather than compiling a Secret Service backend
  that cannot work there.
- **Accent colours** derive shades + a readable ink colour (`src/lib/contrast.ts`);
  use `text-accent-ink` on accent-filled controls rather than hard-coded
  `text-white`.
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
  and the tests assume net-zero history entries either way.
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
- **Paging is a button, never a scroll.** Every paginated list — followers,
  following, user search, activities, threads, comments — uses
  `useInfiniteQuery` with `fetchNextPage` on a click and no `IntersectionObserver`
  anywhere. The reason is the limiter in `anilist/client.rs`: it is a ~30/min
  brake shared with the scrobbler and the three alert passes, and it reads its
  budget then drops the lock *before* any response header lands, so it cannot see
  a burst it has not sent. A feed that fetches because the user scrolled spends
  that budget with nobody asking. Two further traps live in `UserList`'s comment
  and are worth reading before touching an infinite query: `refetch()` refetches
  **every** retained page, and `maxPages` evicts from the wrong end.
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
- **The cover grid is `repeat(var(--cover-cols), minmax(0, 1fr))`** — the
  covers-per-row slider, one token written by the theme store, defaulting by
  form factor at first run (8 wide, 2 narrow) with a one-time migration from
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
