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

**Status: shipped** (August 2026). "Could we?" got its answer, so the long
write-up that lived here — costs, constraints, a six-step slice — is replaced
by the record of what actually happened, kept so nobody re-plans it or
re-argues the parts that are settled.

What shipped:

- **The APK exists** — arm64 and universal, release-signed in CI when the four
  `ANDROID_*` secrets exist. The debug APK stays a workflow artifact, because
  debug- and release-signed builds refuse to install over each other.
- **The phone shell exists**: a bottom bar, keyed on width (`usePhoneShell`,
  767px), not on user agent. This is *not* the `minWidth` removal the plan
  called for — `minWidth: 940` is still in `tauri.conf.json` and never needed
  to go; it governs the desktop window, and Android does not read it.
- **Detection is Jellyfin-only, by decision** in the first device round. The
  desktop detection machinery is greyed out in Settings under a "desktop only"
  badge, never hidden.
- **The back gesture closes overlays** instead of leaving the page —
  `useBackClose` in every dialog, the history protocol pure and tested in
  `lib/backStack`.
- **System notifications post while the app runs**, and ask for their runtime
  permission once at startup (`alerts/notify.rs`).
- **Login hops back into the app via `karasu://`.** See the misprediction note
  below for why that is the whole of what changed.
- **Tokens are Android-Keystore-sealed** — the plan's step 3, done:
  `keystore.rs` plus `TokenCipher.kt`, KRSA1 framing, migrating the interim
  file-based storage in place. The rule it preserves is the one that governed
  the desktop all along: the token stays in Rust and never reaches the WebView.
- The launcher icons in `src-tauri/icons/android/` are committed, not
  generated — `tauri android init` will appear to have produced them on a
  fresh run; it did not.

What the write-up got wrong, kept for honesty:

- **The layout needed no `minWidth` removal and no new row tier.** It predicted
  a list view "rewritten rather than adapted"; cards were already the
  one-per-row answer, and the fixed desktop tracks simply never render on a
  phone.
- **The sign-in flow was not desktop-shaped after all.** It predicted the
  localhost callback replaced by a per-platform redirect URI; the
  `127.0.0.1:46231` listener binds and answers on Android as written, and the
  `karasu://` scheme's only job is the return hop from the browser, which was
  the one missing piece.
- **The TLS cost landed exactly as predicted** — the compiles-cleanly,
  fails-at-runtime class it flagged. `net.rs` is the fix and documents the
  trade (webpki roots, a named provider, user-installed CAs not honoured).

Still open, deliberately:

- **`MediaSessionManager` detection.** Moot while the app is sideloaded: the
  notification-listener permission is a Play policy question, and it only
  matters if Play distribution — see below — is ever revisited.
- **Background notification delivery.** Android suspends the process, and FCM
  needs a hosted backend, which is forbidden. The while-running half shipped;
  the background half stays a research item (WorkManager-style periodic wake
  or nothing) until measured.
- **Play Store distribution itself.** Not planned — per the maintainer,
  August 2026. Sideload is the model and updates are `adb install -r`;
  Android has no updater and must not gain one by accident.

## Chosen from the Aluminium review (August 2026)

**Status: all four shipped.** Picked after surveying Aluminium (the Play-Store
AniList client) in the third device round — inspiration only, each designed
fresh against Karasu's conventions. Where they landed: the quick +1 is on the
Dashboard's continue-watching strip and was extended to a continue-reading
strip for manga, both through `useListMutations` and its receipt toast; the
character, staff and studio search scopes are live in `Search.tsx`, each
behind the three-character floor, re-measured per entity as the entry demanded
(`USER_SEARCH_MIN` in `api/social.ts` records the measurement); the clear-✕
is in every search and filter box, and the default status when adding a title
is a setting rather than a hard-coded Planning (`lib/defaultAddStatus`, set in
the Account pane); and Android system notifications post while the app runs,
with the runtime permission requested at startup. Background delivery is the
one caveat that survives — see "still open" above.
