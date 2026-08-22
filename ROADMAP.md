# Roadmap

Things Karasu might become, and what each would actually cost. Nothing here is
scheduled or promised — it is the honest version of "could we?", written down so
the answer does not have to be re-derived every time someone asks.

**This file is not `CHANGELOG.md`, on purpose.** `scripts/release/release-notes.ps1`
slices that file between `## <version>` and the next `## `, so a stray heading
there truncates a published release body. Ideas go here; shipped work goes there.

For what will *never* be built, see the "Explicitly rejected" section of
`CLAUDE.md` — activity and playback-history expansion, manga cost tracking,
settings cloud-sync, Plex and Emby, RSS/torrent release feeds, and anything
needing a hosted backend.

---

## An Android app

**Status:** not started, not committed to. Written up because the question keeps
coming back and the answer has real shape.

### What it would be

Not a port. **A different product sharing a codebase: a list client without
detection.**

That sentence is the whole entry. Karasu's identity on the desktop is that it
watches what you play and updates AniList without being asked. On Android almost
none of that is available, so what is left is a fast, offline-capable AniList
client — browsing, editing, statistics, social — which is a perfectly good thing
to want, and is *not* the thing the desktop app is.

Anyone who plans this as "Karasu, on a phone" will build the shell and then
discover the feature is missing.

### What carries over

Nearly all of it, and that is why the idea is tempting at all.

- The entire AniList layer — `api/` queries, types, the franchise walker, the
  library and social surfaces. It is HTTP and GraphQL; nothing in it is
  desktop-shaped.
- The list, search, statistics, social and forum screens, as logic. Not as
  layout — see below.
- SQLite via rusqlite. Android ships SQLite; rusqlite bundles its own.
- The rate limiter in `anilist/client.rs`. The ~30/min budget is a property of
  AniList, not of the platform, and the paging-is-a-button rule follows it.
- **Jellyfin**, and it is the *only* detection source that survives, because it
  is just HTTP against a server the user already runs. A phone that plays an
  episode through the Jellyfin app would still scrobble.
- The offline queue. It matters *more* on a phone than on a desktop.

### What does not carry over

- **Win32 window enumeration.** Windows-only already.
- **SMTC and MPRIS.** Android's nearest equivalent is `MediaSessionManager`,
  which needs the notification-listener permission — and Google Play restricts
  that permission to apps whose core function requires it. An anime tracker is
  not obviously one of those, so this is a policy question before it is a
  technical one.
- **The local library scanner.** Scoped storage and SAF make walking arbitrary
  directories impractical; `library.rs`'s fourteen commands assume a filesystem
  Android does not hand out.
- **Tray, global hotkey, toast action buttons, close-to-tray, autostart, the
  custom titlebar, portable mode, Discord Rich Presence.** All desktop shell.
- **The updater.** `tauri-plugin-updater` is not the distribution model; Play
  Store or sideload is. `COMMIT_NUMBER`, the `version_comparator` and
  `latest.json`'s `+` build metadata are all desktop machinery.
- **Token storage.** `keyring` is taken twice in `Cargo.toml`, once per
  platform: `windows-native` under `cfg(windows)`, `sync-secret-service` under
  `cfg(target_os = "linux")`. Android is neither — it needs Keystore, which is a
  third backend rather than one more cfg arm. The rule that matters survives
  intact, though: **the token stays in Rust and never reaches the WebView**, and
  that is what would have to be true of any Keystore path too.

### View — the part worth thinking hardest about

The desktop layout assumes a wide window and a mouse, in more places than a
quick look suggests.

- **The sidebar is 208px of permanent chrome.** It collapses to 56px now, but
  even that is a rail beside the content. On a phone it becomes a bottom bar or
  a drawer, and the accent rail marker (`useRailMarker`) has no meaning in
  either.
- **`minWidth: 940`** in `tauri.conf.json` versus a phone's ~360–430dp. That is
  not a breakpoint away; it is a different information density.
- **`components/list/columns.ts` is fixed tracks**, sized so `★ 10` and
  `500 / 500` cannot clip, and `useRowTier` changes the column *set* by measured
  container width. Neither has a phone tier, and the honest one is probably "no
  columns at all — one card per row", which means the list view is rewritten
  rather than adapted.
- **Every `group-hover` reveal is invisible on touch.** The +1 button, the row
  actions, the cover overlays. Touch has no hover state to reveal them from, so
  each needs a persistent affordance or a gesture.
- **Right-click context menus become long-press**, and the app's own context
  menu (`shell/ContextMenu.tsx`) is built on `contextmenu` events.
- **Ctrl+K, `/`, `j`/`k` and the roving arrow keys are meaningless** without a
  keyboard. The command palette is a genuine loss; the keyboard sheet simply
  would not ship.
- **The 1.44 MB Japanese woff2 subset.** CLAUDE.md documents why it cannot be
  trimmed — it renders arbitrary `title.native` in five call sites — and on a
  desktop that cost is paid once at install. On mobile data it is a real number,
  and the alternative (falling back per missing glyph) is worse-looking, not
  cheaper.

### The constraint that shapes everything

CLAUDE.md rejects settings cloud-sync and any hosted backend, and that stands.
So **a phone and a desktop would share nothing but the AniList account**:

- separate databases, separate detection corrections, separate library indexes,
  separate preferences, separate offline queues;
- no push notifications, because push needs a server — only local polling, or
  AniList's own notifications read on open;
- a correction made on the phone does not reach the desktop, and vice versa.

That is not a gap to close later. It is the design, and an Android entry that
does not say so up front sets up the first feature request that cannot be
granted.

### The framework decision

**Tauri 2, targeting Android.** Not React Native, not a rewrite.

Tauri 2 ships Android support, and it is the only option that keeps the parts
of Karasu that are actually expensive. The AniList layer, the rate limiter, the
release-name parser, the fuzzy matcher, the relations redirects, SQLite through
rusqlite and the offline queue are all Rust with no desktop assumptions in them
— roughly the half of this codebase that took the longest to get right. React
Native would mean porting every one of them to TypeScript or to a native module,
and then maintaining two implementations of the matcher.

What the choice costs, stated up front so it is not discovered later:

- **The WebView is the renderer**, so performance is Android WebView's, not a
  native toolkit's. The list is already virtualized, which is the part that
  would hurt.
- **`tauri-plugin-*` coverage is thinner on Android.** `single-instance`,
  `global-shortcut` and the tray are desktop-only and simply do not apply;
  `notification` and `opener` do work. The updater does not — distribution is
  the Play Store or a sideloaded APK.
- **The keyring crate does not cover Android.** Token storage needs a Keystore
  implementation behind the same interface, and the rule it has to preserve is
  the one that already governs the desktop: the token stays in Rust and never
  reaches the WebView.
- **Two build targets in CI**, and the Android one needs the NDK.

### The first slice, in order

Small, sequenced so each step is independently checkable. None of it is
scheduled — this is what "first efforts" would actually mean.

1. **Prove the shell.** `tauri android init`, get a debug APK onto a device
   showing the existing UI. Nothing else. This is where WebView rendering,
   build times and the NDK either become a problem or stop being a question.
2. **Split the platform-only Rust behind cfg.** `library.rs`, the Win32
   enumerator, SMTC/MPRIS, tray, hotkey, portable mode and the updater need
   `#[cfg]` gates that leave a compiling Android build. The house rule applies:
   a cfg'd **pair of functions**, never a cfg'd statement, or the arm nobody
   compiles rots.
3. **Token storage on Keystore**, behind the existing `auth.rs` interface.
   Sign-in, sign-out and a rejected token have to behave exactly as they do
   now — `sessionExpired` and the one banner are already the right shape.
4. **A phone tier for the layout.** `minWidth: 940` goes; the 208px sidebar
   becomes a bottom bar; `columns.ts` and `useRowTier` need a tier that is
   honestly "one card per row"; every `group-hover` reveal needs a persistent
   affordance; right-click becomes long-press. This is the largest single
   piece and it is UI work, not plumbing.
5. **Jellyfin as the only detection source.** It is plain HTTP and already
   works. The now-playing card, the scrobbler and the correction flow can then
   be exercised end to end without any of the platform detection.
6. **Decide about `MediaSessionManager`** — see below. Until that is answered,
   step 5 is the whole of detection.

Deliberately *not* in the first slice: Wrapped (a canvas poster sized for a
desktop screen), the local library scanner (scoped storage), Discord presence,
and anything that assumes a keyboard.

### What would have to be decided first

1. Whether the app is worth building *without* detection. If the answer is no,
   the rest is moot.
2. Whether `MediaSessionManager` is reachable on Play — that decides whether
   "without detection" is permanent.
3. Whether the UI is a second set of screens in this repo or a separate one.
   Sharing `api/` and `lib/` is clearly right; sharing `pages/` is clearly not.
