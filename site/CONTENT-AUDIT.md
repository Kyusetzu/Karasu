# Content audit

Every claim the site makes, and what in the repository makes it true. A
sentence with no row here does not go on the page; a row whose evidence
moves takes the sentence with it. Paths are relative to the repository root;
line numbers are as of the v1.0.0 tag and drift with edits, the file names
do not.

Status: **confirmed** (read in the code), **partial** (true with the stated
limit, and the page states it), **mock** (a drawn stand-in, labelled as
such in the code and showing no invented data).

## Hero, trust strip, footer

| # | Claim on the page | Evidence | Status |
|---|---|---|---|
| 1 | "A modern anime & manga tracker, built exclusively for AniList." | `README.md` tagline, `src-tauri/tauri.conf.json` `shortDescription`, `CLAUDE.md` Project | confirmed |
| 2 | "Karasu watches what you play and read and keeps your AniList progress in sync — no buttons to press." | `src-tauri/src/playback/detection/mod.rs` `detect_playback` (four sources), `src-tauri/src/playback/scrobbler.rs` (the write), `README.md` "What is Karasu?" | confirmed |
| 3 | "Free · open source · built for AniList"; "MIT licensed, no paid tier"; "Every commit is public" | `LICENSE` (MIT), public repository | confirmed |
| 4 | "Windows · Linux · Android" | `.github/workflows/release.yml` (NSIS, AppImage, two APKs) | confirmed |
| 5 | "No account needed to start"; "Start with a local list, no account" | `src/stores/auth.ts` `ProfileMode = "anilist" \| "local" \| "none"`, `setLocal`; `src/pages/FirstRun.tsx` | confirmed |
| 6 | "Implicit OAuth, no client secret" | `CLAUDE.md` hard constraints; `src-tauri/src/commands/auth.rs` `BUILTIN_ANILIST_CLIENT_ID`; `src-tauri/src/anilist/login.rs` | confirmed |
| 7 | "No telemetry, no analytics, no backend, no account of ours" | exhaustive grep of `src/` and `src-tauri/src/` for sentry/posthog/plausible/mixpanel/amplitude/gtag/crashlytics/telemetry/analytics: no hits in code; `SECURITY.md` "no hosted backend"; `CLAUDE.md` hard constraint | confirmed |
| 8 | "MIT licensed · © 2026 Kyu and Karasu contributors" | `LICENSE:3`, `src-tauri/tauri.conf.json` `copyright` | confirmed |
| 9 | "not affiliated with or endorsed by AniList" | no affiliation exists; public API with a public client id | confirmed |
| 10 | "SN Pro is used under the SIL Open Font License 1.1" | `site/public/fonts/OFL.txt` (from `@fontsource/sn-pro`) | confirmed |
| 11 | The hero scene: mpv, "Anime Title", "Updated to episode 1" | a drawn scene in the app's Now Playing recipe (`src/components/media/NowPlayingCard.tsx`), neutral titles, no data | mock |

## The problem, and how it works

| # | Claim | Evidence | Status |
|---|---|---|---|
| 12 | Sources: system media sessions, player or browser window, an mpv pipe, your own Jellyfin server | `src-tauri/src/playback/detection/mod.rs` (`detect_playback` order: mpv IPC → Jellyfin → windows → media sessions); `media_session/smtc.rs`, `media_session/mpris.rs`, `mpv_ipc.rs`, `jellyfin.rs` | confirmed |
| 13 | "A scrobble can raise your progress, never lower it, and it re-checks your list a moment before it writes." | `scrobbler.rs` `would_regress` and the pre-write re-check against the live cache (`Outcome::Refused(AlreadyWatched)`); `CLAUDE.md` "list_cache has one owner" | confirmed |
| 14 | "Turn on the confirmation toast and every update waits for one click on the desktop." | `src-tauri/src/alerts/notify.rs` action toast (Windows `tauri_winrt_notification` button, Linux `notify-rust` action); mobile returns "action toasts are desktop-only"; setting "Ask before updating" in `src/pages/settings/DetectionPane.tsx` | confirmed, desktop only (stated) |
| 15 | Flow: release-name parser, fuzzy matcher, relations data for season splits and redirects | `src-tauri/src/playback/recognition/parser.rs`, `recognition/matcher.rs`, `src-tauri/src/playback/relations.rs` (erengy/anime-relations, cached 7 days) | confirmed |
| 16 | "A receipt with an undo lands in the app" | `src/lib/receipt.ts`, `src/hooks/useListMutations.ts` | confirmed (undo declines for custom lists and advanced scores — the Features row says "ten fields") |
| 17 | "After two thirds of the runtime … or the minutes you set" | `scrobbler.rs` threshold: setting in minutes, else 2/3 of episode length; `src/i18n/en.ts` "0 = automatic (two thirds of the episode length)" | confirmed |
| 18 | "A pause defers, it does not cancel" | `CLAUDE.md` note measured 2026-09-03 with mpv; `scrobbler.rs` `EMPTY_TICK_GRACE` | confirmed |
| 19 | "An unclear season is yours to settle … offers the sequels" | `CLAUDE.md` "The season is inert for matching unless the title carries it"; `scrobbler.rs` `BlockReason::UnknownSeason`; the match picker offers sequels | confirmed |
| 20 | Players: mpv, VLC, MPC-HC, MPC-BE, PotPlayer, SMPlayer | `src-tauri/src/playback/detection/profiles.rs` | confirmed |
| 21 | Browsers: Chrome, Firefox, Edge, Brave, Opera, Vivaldi, Zen, LibreWolf, Waterfox, Helium | `profiles.rs` | confirmed |
| 22 | Streaming sites: Crunchyroll, ADN, Netflix; manga sites: MangaDex, MANGA Plus, Comick, Bato.to, MangaFire, Asura Scans | `profiles.rs` | confirmed |
| 23 | "Windows has all of these. Linux reads media sessions, mpv and Jellyfin, and no window titles; Android reads Jellyfin." | `detection/mod.rs` non-Windows `enumerate_windows` returns empty ("Wayland forbids…"); `mpv_ipc.rs` mobile stub; `src/pages/Settings.tsx` `ANDROID_DESKTOP_ONLY` | confirmed |
| 24 | The Now Playing screenshot: "Katanagatari — Episode 3 … Progress will update in 31 min 49 s" | captured 2026-09-06 on the rig with a real mpv window (`--force-media-title`), no write made | confirmed (real capture) |

## Local library

| # | Claim | Evidence | Status |
|---|---|---|---|
| 25 | "Up to 20,000 files, six levels deep" | `src-tauri/src/library.rs` `MAX_FILES = 20_000`, `MAX_DEPTH = 6` | confirmed |
| 26 | Match reads exact / close / yours | `library.rs` score 1.0 exact short-circuit; `CLAUDE.md` schema v8/v9 | confirmed |
| 27 | "The first episode past your progress"; "Plays it in your default player, or in mpv if you point Karasu at it" | `library.rs` `play_next`, `open_path` (mpv binary if configured, else the OS opener) | confirmed |
| 28 | Corrections stick; seasons can be split; unplaced titles get a suggestion applied only when confirmed | `CLAUDE.md` schema v9 (`library_override` never cleared by a scan), v11 (`library_redirect`), v10 (`library_suggestion`); `src-tauri/src/identify.rs` | confirmed |
| 29 | "Karasu never downloads anything." | `CLAUDE.md` "Explicitly rejected": RSS/torrent feeds and anything piracy-adjacent | confirmed |

## Offline

| # | Claim | Evidence | Status |
|---|---|---|---|
| 30 | List cached in a local SQLite database | `src-tauri/src/db.rs` `list_cache` | confirmed |
| 31 | Offline detail page with a working +1 for a title on your list; nothing for one that is not | `src/components/media/OfflineDetail.tsx` | confirmed |
| 32 | Edits queued, per account, inspectable and discardable in Settings, sent in order on return | `db.rs` `offline_queue` with `user_id` (schema v16); `src-tauri/src/commands/list.rs` drain paths; `QueueSection` in Settings → Advanced | confirmed |
| 33 | "'Queued' is never 'saved' — the receipt says which" | `CLAUDE.md` invariant "Queued is not success", `Outcome::{Landed, Queued, Refused}`; `useListMutations.ts` receipt text | confirmed |

## Statistics

| # | Claim | Evidence | Status |
|---|---|---|---|
| 34 | Five tabs: overview, ratings, years, genres and tags, people and studios | `src/pages/Statistics.tsx` | confirmed |
| 35 | Charts drawn by hand in SVG: radar, sunburst, treemap, area, dot plot, gradient bars, heatmaps; no chart library | `src/components/stats/Charts.tsx`, `AreaChart.tsx`, `DotPlot.tsx`, `GradientBars.tsx`, `Heatmap.tsx`, `DayHeatmap.tsx`; `CLAUDE.md` Charts note | confirmed |
| 36 | "Your scores against the crowd … computed from your cached list" | `Statistics.tsx` `ScoreDeltaSummary` | confirmed |
| 37 | "A poster of your year or season in five crops, exported as PNG or JPEG at up to 3×" | `src/pages/Wrapped.tsx` `PresetKey` (five), export format and scale; `src/lib/wrapped.ts` `availableSeasons` | confirmed |
| 38 | "costs no requests and is there offline too" | charts read the cached list (`useCachedEntry`/list cache); no query on the page beyond the cache | confirmed |

## Features

| # | Claim | Evidence | Status |
|---|---|---|---|
| 39 | Scores in the account's format: 100-point, 10-point with or without decimals, five stars, three smileys | `src/lib/scoreFormat.ts`; `CLAUDE.md` "Scores live in the account's scoreFormat, end to end" | confirmed |
| 40 | Custom lists, advanced scores, tags, notes, dates, rewatches, volumes | `src/components/media/EntryEditModal.tsx`; `src/lib/customLists.ts`, `advancedScores.ts` | confirmed |
| 41 | Bulk edit; undo for ten fields | `src/components/list/BulkBar.tsx`, `bulk_save_list_entries`; `src/lib/receipt.ts` (ten reversible fields, two irreversible) | confirmed |
| 42 | Presets, tri-state filters, typo-tolerant search | `src/lib/presets.ts`, `src/lib/multiFilter.ts`, `src/lib/fuzzy.ts` | confirmed |
| 43 | Covers or rows, 1 to 40 covers per row, lists that stay quick at any size | `src/lib/viewMode.ts`; `src/stores/theme.ts` `COVER_COLS_MIN/MAX`; `@tanstack/react-virtual` in `VirtualGrid.tsx`/`VirtualRows.tsx` | confirmed |
| 44 | Manga in chapters and volumes; continue-reading row; manga sites recognised on Windows | list fields `progress`/`progressVolumes` (schema v7); `src/pages/Dashboard.tsx` continue-reading; `profiles.rs` manga sites; window detection Windows only | confirmed |
| 45 | Airing notifications; opt-in sequel and on-hold reminders; AniList notifications in the same bell, grouped in bursts | `src-tauri/src/alerts/airing.rs`, `sequel.rs` (off by default), `stale.rs` (off by default), `site.rs`; `src/lib/notifGroups.ts` | confirmed |
| 46 | Tray icon with Scrobble now, Sync now and the detection switch | `src-tauri/src/lib.rs` tray menu (desktop only) | confirmed |
| 47 | Optional background check every 15, 30 or 60 minutes | `src/pages/settings/AniListPane.tsx` presets; `alerts/site.rs` `notif_bg_interval_min` | confirmed |
| 48 | Android: sideloaded APK; the list, statistics, notifications, social pages; Jellyfin detection; four widgets from the cache with no network; background job with the app closed; share an anilist.co link | `release.yml` APK legs; `src-tauri/gen/android/.../Widgets.kt` + `src-tauri/src/widgets.rs`; `NotifJob.kt` + `src-tauri/src/background.rs`; `MainActivity.kt` SEND→VIEW; `AndroidManifest.xml` | confirmed |
| 49 | Widgets: Airing Today, Continue Watching, Continue Reading, This Week | manifest receivers `Widgets$AiringToday`, `Widgets$ContinueWatching`, `Widgets$ContinueReading`, `Widgets$Week` | confirmed |
| 50 | Seasonal page; Monday-first calendar with iCal export; franchise graph with pan and zoom; recommendations weighted by your scores; search across anime, manga, users, characters, staff, studios | `src/pages/Seasonal.tsx`; `src/lib/calendar.ts`, `src/lib/ical.ts`; `src/pages/Franchise.tsx`, `usePanZoom.ts`; `src/lib/recommend.ts`; `src/pages/Search.tsx` scopes | confirmed |
| 51 | Activity feed, profiles with follow and affinity, forum threads and comments, text posts, likes, replies | `src/api/social.ts`; `src/pages/Social.tsx`, `UserProfile.tsx`, `Forum.tsx`, `Thread.tsx`; `src/lib/affinity.ts` | confirmed |
| 52 | "Nothing social is kept on your machine … every further page is a button rather than a scroll" | `CLAUDE.md` "No local activity store", "Paging is a button, never a scroll" | confirmed |
| 53 | Discord: off until switched on; title, episode/chapter, timer; button to the project; never your AniList name; filtered titles never broadcast | `src-tauri/src/discord.rs` (`discord_enabled == "1"`, nothing seeds it; payload fields; content-filter guard) | confirmed |
| 54 | Export MAL XML and JSON in either mode; import into a local list; daily local backup on by default; portable mode | `src/pages/settings/AdvancedPane.tsx` (export both modes, import local only); `src-tauri/src/backups.rs` (`read_enabled` default on, 7 kept); `src-tauri/src/portable.rs` | confirmed |
| 55 | "connect AniList later and Karasu merges the two" | `src/lib/mergeDecision.ts`, `src/components/overlays/SignInMerge.tsx` | confirmed |
| 56 | The Discord card, the notifications and social panels, the "yours to keep" panel | drawn, labelled in code, neutral titles | mock |

## Platforms

| # | Claim | Evidence | Status |
|---|---|---|---|
| 57 | Windows: installer, not code-signed (SmartScreen may warn), checksums | `release.yml` NSIS; `scripts/release/release-notes.ps1` "It is unsigned"; `SHA256SUMS.txt` published | confirmed |
| 58 | Windows: every detection source; streaming and manga sites; tray; autostart; updater; portable mode | `profiles.rs`; `lib.rs` tray/autostart; `commands/update.rs`; `portable.rs` | confirmed |
| 59 | Android: 7 and up; signed with the project key; arm64 and universal | `build.gradle.kts` `minSdk 24`; `release.yml` release signing; `rename-apk.ps1` | confirmed |
| 60 | Android: detection is Jellyfin only; no in-app updater | `mpv_ipc.rs` mobile stub, no SMTC/MPRIS on mobile; `commands/update.rs` `updater_available()` false on mobile; `CLAUDE.md` | confirmed |
| 61 | Linux: AppImage x86_64; needs webkit2gtk-4.1; MPRIS, mpv, Jellyfin; updater for a running AppImage; no window titles, no manga detection; tray needs a StatusNotifier host or closing quits | `release.yml` build-linux (ubuntu-22.04); `release-notes.ps1` boilerplate; `mpris.rs`; `detection/mod.rs`; `lib.rs` `tray_present` | confirmed |
| 62 | "Stable … used every day by the maintainer; Experimental … built by CI, not used every day"; Linux Experimental | maintainer's statement, 2026-09-05; every Linux check in the repo is CI or a throwaway crate (`CLAUDE.md`) | confirmed (maintainer) |
| 63 | "Version 1.0.0, released 2026-09-05"; the four asset links and the checksums | `src/generated/release.json` ← GitHub `releases/latest` via `scripts/release-info.mjs` | confirmed |
| 64 | Updates: Stable channel by default, checked once a day; Nightly one switch away in Settings → Desktop → Updates | `commands/update.rs` `stored_channel` default `stable` (schema v19 seeds `prerelease` for existing installs), `UPDATE_CHECK_THROTTLE_MS`; `src/pages/settings/AdvancedPane.tsx` `UpdatesSection` rendered in the Desktop pane | confirmed |

## AniList, open source, FAQ

| # | Claim | Evidence | Status |
|---|---|---|---|
| 65 | Reads and writes through the public GraphQL API; a token, never a password; no client secret | `src-tauri/src/anilist/client.rs`, `login.rs` (implicit grant) | confirmed |
| 66 | Token kept in the OS credential store; an encrypted file in portable mode; the Android Keystore; never reaches the web view | `src-tauri/src/anilist/auth.rs` (keyring; DPAPI/XChaCha20 portable files); `src-tauri/src/keystore.rs`; `CLAUDE.md` hard constraint | confirmed |
| 67 | "AniList allows about thirty requests a minute. Karasu batches, caches and never fetches on scroll" | `CLAUDE.md` rate-limit constraint and stepped-window measurement; `anilist/client.rs` limiter; no `IntersectionObserver` fetch anywhere | confirmed |
| 68 | "Developed with heavy AI assistance, and every change reviewed by a human maintainer" | `CLAUDE.md` preamble; `README.md` | confirmed |
| 69 | Stack: Tauri 2, Rust, React 19 + TypeScript, Vite, Tailwind CSS v4, SQLite, TanStack Query, AniList GraphQL | `package.json`, `src-tauri/Cargo.toml`, `CLAUDE.md` Project | confirmed |
| 70 | FAQ "What does Karasu talk to?": AniList API and image servers; GitHub for updates; the relations data on GitHub at most weekly; your Jellyfin server; Discord's local socket; bio images through a bounded proxy so those hosts learn your IP | `anilist/client.rs`; `tauri.conf.json` CSP `img-src *.anilist.co`; `commands/update.rs`; `playback/relations.rs` (7-day cache); `detection/jellyfin.rs`; `discord.rs`; `commands/images.rs` + `net.rs` (bounded, no cookies/referer, private hosts refused) | confirmed |
| 71 | FAQ "Can Karasu work offline?" | rows 30–33 | confirmed |
| 72 | FAQ "Which platforms?" and "no macOS build" | rows 57–61; `CLAUDE.md` "macOS is deliberately not covered" | confirmed |
| 73 | FAQ "Why does Windows warn?" | row 57 | confirmed |

## Screenshots

All twenty-two are captures of build 1.0.3.566 taken on 2026-09-06 on the
maintainer's account (desktop: the isolated rig at 1440×900, rendered at 2×;
phone: the release APK over adb). The local library shows a folder of empty
files named like clean releases. The Now Playing capture is a real mpv
window under `--force-media-title`. Nothing is composited or edited beyond
resizing and encoding. Approved by the maintainer on 2026-09-06.
