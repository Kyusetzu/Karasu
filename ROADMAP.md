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
- **Play Store distribution itself.** Not planned — per the maintainer,
  August 2026. Sideload is the model and updates are `adb install -r`;
  Android has no updater and must not gain one by accident.

A third entry used to sit here — background notification delivery, then "a
research item until measured". It resolved by shipping: a JobScheduler job
wakes the dead app's Rust core through one exported symbol, off by default
and floored at 15 minutes, deferring to the in-app pass through a shared
freshness stamp. FCM stays rejected — it needs a hosted backend — and the
accepted residue is polling latency inside Doze's maintenance windows. The
fuller record is in "The road to v1.0.0" below.

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
with the runtime permission requested at startup. The background-delivery
caveat this paragraph used to close on has since resolved by shipping — see
"The road to v1.0.0" below.

## The road to v1.0.0

**Status: prepared, not scheduled.** The tag is cut on the maintainer's
explicit word and not before. This section is the honest inventory of what
stands between the tree and that word — kept here so "what's left?" does not
have to be re-derived, and so the tag-day mechanics are written down *before*
the day they are needed. (A checklist in a file that promises not to make
promises is a deliberate exception: none of this is a feature.)

### Where the tree stands

Feature work for 1.0 is done. The last round (August 2026) landed the four
Android home-screen widgets — Airing Today, Continue Watching, Continue
Reading, Weekly Calendar — fed by a Rust-written projection file
(`widgets.rs` owns the format the way `keystore.rs` owns `TokenCipher`'s);
the background check for AniList notifications on both platforms (a
JobScheduler job that runs with the app dead on Android, the supervised
`alerts/site.rs` pass on desktop, one shared setting: off by default,
15/30/60-minute presets or a custom interval clamped to 15..720); the
Android share target; the Android new-release notice (a notice and never an
updater); Seasonal Wrapped; the offline-queue viewer with per-row discard
and a sync surface on the phone; and the season-splits list with per-rule
undo. `npm run verify` is green at 935 frontend and 292 backend tests, the
test compiles are warning-free again, and the user-facing docs were moved
back to the truth in the same pass that wrote this section.

### What the tag still waits for

1. **A device pass on the phone.** Verified already: all four widgets render
   real data (2026-08-30). Not yet exercised on hardware:
   - the dead-app notification check — enable the interval in Settings →
     AniList, force-stop Karasu, then
     `adb shell cmd jobscheduler run -f dev.kyu.karasu 46231`;
   - the share target — share an anilist.co link out of the browser, once
     bare and once buried in a sentence;
   - the boot-persisted reschedule — reboot with the interval on, force a
     run without opening the app first;
   - sign-out wiping `widgets.json` — the widgets fall back to their empty
     state on the next render;
   - the sync surface — More → Sync, a queued offline edit drained.
2. **The full-build smoke on both platforms** — `npm run tauri build` and
   `tauri android build`, warnings read, per the house rule that `verify`
   cannot see everything a bundle build can.
3. **Whether the release carries APKs** is a repo-settings question, not a
   tree question: the four `ANDROID_*` secrets must exist at tag time, or
   the release ships desktop-only and the debug APK stays a workflow
   artifact. `TAURI_SIGNING_PRIVATE_KEY` (and its password) must exist or
   the tag build dies at the manifest step — *after* the 15-minute build.
   Both have been publishing rolling builds, so this is a confirmation, not
   a setup task.

### Cutting the release, mechanically

The CHANGELOG header documents the file's own half; the whole sequence, in
order:

1. Rewrite `CHANGELOG.md`: rename `## Unreleased` to `## 1.0.0` (a trailing
   ` — 2026-…` date is fine; brackets or a fourth segment break the slicer's
   match and the tag build throws), curate the section from `git log` — it
   is deliberately well behind the tree, so this is a real writing pass, not
   a rename — open a fresh empty `## Unreleased` above it, and delete the
   "there has been no tagged release yet" paragraph, which stops being true.
2. `node scripts/bump-version.mjs major`, in the same dirty tree — the
   CHANGELOG edit is what lets the bump run without `--force`. It lands on
   `1.0.0.<commit#>` and prints it for the commit subject.
3. `npm run verify`, bare, never piped. Then the build smoke above if
   anything moved since it last ran.
4. One commit carrying the CHANGELOG rewrite and all five version files —
   the workflow reads both off the tagged commit.
5. `git tag -a v1.0.0` — annotated, because `git push --follow-tags`
   silently skips lightweight tags, and the only symptom would be a rolling
   rebuild and no release.
6. Push branch and tag — the maintainer's own action, every time. Two
   workflow runs start and cannot cancel each other (the concurrency group
   is keyed on the ref). The rolling `latest` prerelease survives as the
   prerelease channel and is rebuilt at the same content.
7. Watch **Resolve release target** on the tag run: the version-agreement
   check and the release-notes precheck fail in seconds, before the build.
   Then confirm the published release — not marked prerelease, installer +
   AppImage (+ the two APKs if the secrets exist), `SHA256SUMS.txt`, and a
   `latest.json` whose version reads `1.0.0+<commit#>`. The `+` is
   load-bearing; CLAUDE.md's versioning section says why.

Two consequences worth knowing on tag day. v1.0.0 is the first
non-prerelease, so GitHub's `releases/latest` alias starts resolving and
the **Stable update channel goes live** the moment it publishes — its
manifest has 404'd since the channel existed. And once the release is
published the tag is immutable: a run that fails *after* the precheck can
be re-run against the same tag, but a broken tagged commit means
delete-tag, fix, re-tag — acceptable only while no release was published
under it.

### What v1 does not wait for

Post-v1 candidates, each with its recorded reason:

- **Measuring the residual sign-in delay on a device.** `connect_with_token`
  has logged its three phases since the handoff fix; nobody has read them
  off hardware yet. Act only if it is still slow.
- **The `Page.threadComments` off-by-one.** AniList returns `perPage + 1`
  rows with one out of sequence; cause unknown, recorded in CLAUDE.md.
  Re-measure someday or report upstream — the app degrades gracefully.
- **A hint about Android's "open by default" setting.** anilist.co App
  Links can never auto-verify (assetlinks.json needs domain ownership), so
  opening AniList links by default stays a manual Android setting; the
  share target exists precisely because it needs no domain. A first-run or
  README hint is a nicety, not a gap.
- **User-installed CAs on Android** — the webpki-roots trade documented in
  `net.rs`. Revisit only if a user with such a setup actually asks.

Everything else consciously not built is either above (MediaSessionManager
detection, Play Store) or in CLAUDE.md's "Explicitly rejected" list, and
stays there.
