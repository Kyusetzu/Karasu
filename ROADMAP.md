# Roadmap

**The complete list of what stands between the tree and the next milestone —
and nothing else.** This file is maintained by deletion: an item that ships
is removed, not annotated, and history lives where history already lives
(commit subjects, and CHANGELOG.md's tag-time curation). Settled decisions
and their reasons are CLAUDE.md's job. If an item is neither open work nor a
decision the next milestone waits on, it does not belong here.

**This file is not `CHANGELOG.md`, on purpose.** `scripts/release/release-notes.ps1`
slices that file between `## <version>` and the next `## `, so a stray heading
there truncates a published release body. Open work goes here; shipped work
goes there, at tag time.

For what will *never* be built, see the "Explicitly rejected" section of
`CLAUDE.md` — activity and playback-history expansion, manga cost tracking,
settings cloud-sync, Plex and Emby, RSS/torrent release feeds, and anything
needing a hosted backend.

---

## After v1.0.0

v1.0.0 was tagged on 2026-09-05. The backlog, each item with its recorded
reason:

### Carried over from the release audit

The audit's own reports are gone (they were a list of unfixed weaknesses in a
repository about to be public, which is a finding it raised against itself).
Everything it found at P1 and P2 is fixed, as is every P3 with a behavioural
consequence. What is left is recorded here rather than in a deleted folder:

Everything still listed here is blocked on something no amount of work in the
repository supplies — a device, a live API, or a decision that is the
maintainer's. Each says which, so none of them reads as unstarted work.

**Found by the pre-tag sweep of 2026-09-05, deferred on purpose:**

- **The widgets' empty state is English on a German phone.** `Widgets.kt`
  falls back to a hard-coded "Open Karasu" / "Karasu" when `widgets.json` is
  absent — which is exactly what sign-out leaves behind. Read the two labels
  from `strings_widgets.xml` (both locales already exist) instead. Deferred
  because seeing it costs a sign-out, and the maintainer had just signed back
  in.

**Needs a user, or a decision already made:**

- **User-installed CAs on Android** — the webpki-roots trade documented in
  `net.rs`. Revisit only if a user with such a setup actually asks.
- **`MediaSessionManager` detection on Android** — moot while the app is
  sideloaded: the notification-listener permission is a Play policy
  question, and Play distribution is itself not planned (maintainer,
  August 2026; sideload is the model, and since 1.11 the app fetches its
  own APK from the GitHub release — see "The Android updater" in
  CLAUDE.md).

**Waiting on a tag:**

- **A Stable release after 1.0.0.** Everything since 2026-09-05 — the
  Android updater, the interaction model (pull-to-sync, long press,
  navigation swipe, context menu), the floating detection window, Jellyfin
  discovery and the external address, the query cache — is on `main` and in
  the Nightly only. The website describes `main`; the Stable download it
  links to is still 1.0.0 until the maintainer tags the next one.

## Tooling and packages to add

Decided by the maintainer on 2026-09-19 after a survey of the stack ("preparation
over repair"): every row below goes in, in a session of its own, and each is
deleted here when it lands. The column says where it takes effect. Already in
(2026-09-19): oxlint, knip, `@vitest/coverage-v8`, cargo-deny,
`tauri-plugin-window-state`. Measured and rejected: `happy-dom` (see the
vitest note in CLAUDE.md), `cargo-nextest` (a one-second suite), `msw` (HTTP
lives in Rust), a formatter (one tree-wide diff for nothing).

**Tests — deeper, not only more**

| Package | Where | Why, in a line |
| --- | --- | --- |
| `cargo-mutants` | manual, occasionally, over `scrobbler.rs` and `db.rs` first | the honest answer to "77 % coverage, but how good": which injected bugs the suite does not catch |

**Quality gates and hygiene**

| Package | Where | Why, in a line |
| --- | --- | --- |
| `cargo-machete` | manual, now and then | knip for Cargo: dependencies nothing uses |
| `cargo-bloat` | once, then on demand | what the 26 MB exe is made of; the `windows` crate's feature list is the suspect |
| Tauri Specta | `src/api/*.ts` wrappers, every `#[tauri::command]` | generates the TS bindings from the Rust signatures; knip found five hand-written wrappers nobody called, which generated ones cannot become |

**Development loop**

| Package | Where | Why, in a line |
| --- | --- | --- |
| `@tanstack/react-query-devtools` | `App.tsx`, dev builds only | the query cache on screen: what is stale, what refetched — the request-budget questions without log lines |
| `react-scan` | dev builds only | renders highlighted live; the virtual grid and the charts are where one extra render costs forty cards |
| `rollup-plugin-visualizer` | `npm run build -- --analyze`, on demand | a treemap of the 456 kB index chunk instead of guessing |

**Tauri plugins — desktop**

| Plugin | Where | Why, in a line |
| --- | --- | --- |
| `tauri-plugin-clipboard-manager` | `useActionRunner` (copy selection), `diagnostics.ts` (copy report) | `navigator.clipboard` is reliable in WebView2 and conditional in WebKitGTK; the plugin goes through Rust on both |
| `tauri-plugin-prevent-default` | `attach_desktop` | WebView2 and WebKitGTK still answer F5 (reloads the app, losing state), Ctrl+F (the browser's find bar), Ctrl+P; a desktop app owns those keys |

**Tauri plugins — Android**

| Plugin | Where | Why, in a line |
| --- | --- | --- |
| `tauri-plugin-haptics` | `ActionHost` when the sheet opens, `usePullToSync` at "ready" | a gesture without feedback reads as dead; Android users expect the tick |
| `tauri-plugin-sharesheet` | the detail page and the context menu ("share") | the reverse of the share target Karasu already is: hand an anilist.co link to any other app |
| `tauri-plugin-android-battery-optimization` | replaces the hand-rolled exemption call in `background.rs`/`TrackingService.kt` | one less JNI surface to keep alive across `tauri android init` |

**Distribution — Windows**

| Item | Where | Why, in a line |
| --- | --- | --- |
| Code signing via SignPath Foundation | `release.yml`, the NSIS installer and the updater artifacts | free for OSI-licensed projects, no personal identity needed; ends the SmartScreen "unrecognised app" wall every new Windows user hits |
| winget manifest (`wingetcreate` in the release workflow) | a tag build | `winget install Karasu` and `winget upgrade` for everyone who lives in a terminal; the NSIS installer is already the right shape (`nullsoft`) |

**Distribution — Linux**

| Item | Where | Why, in a line |
| --- | --- | --- |
| `.deb` and `.rpm` bundle targets | `tauri.conf.json` `bundle.targets`, `linux-build` | Tauri builds both from the same job; the AppImage stays the updater's format, the packages are what a distro user installs |
| Flatpak / Flathub | a manifest built from the `.deb`, submitted once | the one Linux channel with an update path and a sandbox; the tray and the media-session pass need portal review first |

**Distribution — Android**

| Item | Where | Why, in a line |
| --- | --- | --- |
| F-Droid | reproducible-build metadata, a merge request to fdroiddata | the sideload model with an updater people already trust; requires the build to be reproducible, which the CI signing step must be checked against |
| Follow the system accent (Material You; Windows DWM accent; GNOME 47) | `platform_info` + the accent store | one switch, "use the system colour", on all three; the derivation in `lib/contrast.ts` already takes any hex |
