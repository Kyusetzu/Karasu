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

## Milestone: v1.0.0

Feature work is done; the tag is cut on the maintainer's explicit word and
not before. What remains:

### The device pass

Verified so far: all four widgets render real data (2026-08-30). Still to
exercise on hardware:

- **HTTP/2 negotiated** — enable debug logging, open any AniList screen,
  and `karasu.log` should say `negotiated HTTP/2` (the round-10 ALPN fix;
  general loading speed should be visibly better).
- **The dead-app notification check** — enable the interval in Settings →
  AniList, force-stop Karasu, then
  `adb shell cmd jobscheduler run -f dev.kyu.karasu 46231`.
- **The share target** — share an anilist.co link out of the browser, once
  bare and once buried in a sentence.
- **The boot-persisted reschedule** — reboot with the interval on, force a
  run without opening the app first.
- **Sign-out wipes `widgets.json`** — the widgets fall back to their empty
  state on the next render.
- **The sync surface** — More → Sync, a queued offline edit drained.
- **The update notice clears itself** — needs one real update cycle: let
  the app announce a release, install it, relaunch, and the bell row is
  gone. (Testable early by hand-setting a low `last_notified_update_version`.)
- **The round-10 surface fixes at a glance** — Wrapped loads with a moving
  loader and draws promptly, its pill rows each hold one line, the covers
  show edit + +1 whole, the hero has working arrows and a fast first
  banner, the More sheet reads as a list.

### The build smoke

`npm run tauri build` and `tauri android build`, warnings read — `verify`
cannot see everything a bundle build can.

### The secrets confirmation

Repo settings, not the tree: the four `ANDROID_*` secrets must exist at tag
time or the release ships desktop-only (debug APK stays a workflow
artifact); `TAURI_SIGNING_PRIVATE_KEY` (+ password) must exist or the tag
build dies at the manifest step, *after* the 15-minute build. Both have
been publishing rolling builds, so this is a confirmation, not a setup task.

### Cutting the release, mechanically

The CHANGELOG header documents the file's own half; the whole sequence, in
order:

1. Rewrite `CHANGELOG.md`: rename `## Unreleased` to `## 1.0.0` (a trailing
   ` — 2026-…` date is fine; brackets or a fourth segment break the slicer's
   match and the tag build throws), curate the section from `git log` — it
   is deliberately well behind the tree, so this is a real writing pass —
   open a fresh empty `## Unreleased` above it, and delete the "there has
   been no tagged release yet" paragraph, which stops being true.
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

## After v1.0.0

The backlog, each item with its recorded reason — none of it blocks the tag:

- **Measure the residual sign-in delay on a device.** `connect_with_token`
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
- **`MediaSessionManager` detection on Android** — moot while the app is
  sideloaded: the notification-listener permission is a Play policy
  question, and Play distribution is itself not planned (maintainer,
  August 2026; sideload is the model, `adb install -r` is the update path,
  and Android must never gain an updater by accident).
- **The limiter's zero-headroom minute** — a header reporting
  `remaining: 0` un-heals headroom for 60 s, during which every request
  pays the full 5 s self-pace before being sent anyway. Measured and
  recorded during round 10; harmless in practice so far.
