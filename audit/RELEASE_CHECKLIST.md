# Release Checklist

The operational sheet for cutting **v1.0.0**. It merges what `ROADMAP.md`
already specifies with what the pre-release audit adds. Audited tree: commit
`9a53427` on `claude/karasu-release-audit-l2rksb`, app version
**0.190.0.498**.

Audit verdict, for context while ticking: **no P0 was found.** Three P1s, and a
short row of P2s whose failure mode is the user's own data changing under them.
Every line below is either a checkbox or a fact needed to tick one.

---

## Before the tag — from this audit

### Must land (the audit's "must fix", ordered by real risk)

- [ ] **C1-02 + C1-18 — the release gate fails at random.** Fix in one commit.
      `src-tauri/src/logging.rs:745-770` (`the_panic_hook_records_the_panic`)
      finds its entry by `.find(|e| e.target == "panic")` over a process-global
      ring that `src-tauri/src/sync.rs:49`'s deliberate thread panic also writes
      to without taking the logging tests' serialising lock;
      `logging.rs:683-699` (`the_ring_is_bounded_and_newest_first`) has the same
      exposure on `all[0]`. Reproduced on this tree on the first attempt:
      `cargo test --lib` returned `FAILED. 302 passed; 1 failed`, asserting at
      `logging.rs:762` and printing `[unnamed] while holding the lock
      (src/sync.rs:49)`. **Fix:** make each predicate identify its own entry —
      `e.target == "panic" && e.message.contains("a deliberate test panic")`,
      and a `target == "ringtest"` filter on the other. Two one-line test
      changes, no production code. **Do not** fix it by serialising `sync.rs`'s
      test into the logger's lock: that couples an unrelated module to the
      logger and only narrows the window, since the hook stays installed for the
      rest of the binary.
      *Why this one first:* `npm run verify` is the whole gate
      (`package.json:12`), both CI jobs run it, and `release.yml` runs it
      **twice** (`:78`, `:254`). Until this lands, a tag can fail for reasons
      unrelated to the release, and a green run means the scheduler was kind.
- [ ] **A3-01 (P1) — an identity change never clears the query cache.**
      `src/stores/auth.ts:149-172` (with `128-134`). `connect`, `enableLocal`,
      `logout` and the `anilist-auth` listener each `set()` new store state and
      clear nothing; `MEDIA_FIELDS` puts `mediaListEntry { … notes }` and
      `isFavourite` into almost every media document under keys carrying no
      viewer id, and with `staleTime` 5 min / `gcTime` 30 min
      (`src/app/main.tsx:23-24`) account A's entry — private `notes` included —
      renders inside account B's session, one Save away from being written
      there. **Fix:** register a `setIdentityChangedHandler` from `main.tsx`,
      the same registered-callback pattern as `setTokenRejectedHandler`
      (`src/api/anilist.ts:63-66`), and call `queryClient.clear()` on all four
      transitions. **Clear, do not invalidate** — invalidation leaves the stale
      object renderable during the refetch, which is half the defect.
- [ ] **B3-01 (P1) — one empty tick destroys the scrobble session.**
      `src-tauri/src/playback/scrobbler.rs:1213` (the `_ =>` arm of
      `drive_session`), with `1094-1131`. The arm sets `*guard = None` on the
      first tick with no detection and a resumed session re-arms `update_at`
      from `Instant::now() + threshold`, so an ordinary pause erases all
      accumulated watch time. On Linux the window-title rung is empty by
      construction (`playback/detection/mod.rs:66-73`), so this is every player
      without an mpv IPC pipe. **Fix:** keep the `Session` and its `update_at`
      while `PlaybackState` is `None` for fewer than N consecutive ticks, and
      drop it after; `is_same` (`:1096-1098`) still keys on
      `(media_id, episode)`, so a grace window cannot bind the timer to
      different content.
      **If this is judged too hot to touch this close to the tag:** ship it as a
      documented known issue naming Linux and Jellyfin Media Player explicitly
      in the release notes — see "Known risks shipped" below. Not silently: the
      card just goes idle and comes back, so the user gets no signal at all.
- [ ] **A1-02 (P2) — a skipped drain is treated as a successful one, so a
      confirmed delete un-deletes itself.** `src-tauri/src/commands/list.rs:525-535`.
      **Fix:** change the arm to `Ok(drained) if !drained.skipped =>` and let
      the fall-through queue the delete, exactly as `save_entry_core` already
      does at `list.rs:341-345`. One line.
- [ ] **A1-03 (P2) — the "never move progress backwards" guard reads a cache no
      manual save updates.** `src-tauri/src/playback/scrobbler.rs:728-743`;
      `db.update_cached_progress` has exactly one caller, `perform_update`.
      **Fix:** patch `list_cache` from `save_entry_core`,
      `bulk_save_list_entries` and the queue drain, so the guard is fed the same
      store the user just wrote to.
- [ ] **A1-14 (P2) — a deleted entry stays a scrobble candidate and gets
      recreated.** `src-tauri/src/commands/list.rs:516-543`. **Fix:** add
      `Db::forget_cached_entry(user_id, media_type, media_id)` and call it from
      `delete_list_entry` and `bulk_remove` after a successful delete, and on a
      queued one.
- [ ] **A4-02 (P2) — enabling portable mode strands the rest of the session's
      writes.** `src-tauri/src/commands/system.rs:249-284`. `Db` is constructed
      once in `lib.rs:356` against the startup-resolved directory and never
      reopened, while `portable::is_portable()` is a live marker check. **Fix:**
      call `app.restart()` immediately after `create_marker()` succeeds, so no
      write can occur against the stale handle.
- [ ] **A2-02 (P2) — turning automatic updates off mid-episode does not stop the
      write.** `src-tauri/src/playback/scrobbler.rs:1143-1148`;
      `settings.enabled` appears exactly once in the file, at `:1107` inside
      `auto_arm`. **Fix:** add `settings.enabled &&` to the per-tick `armed`
      expression, which is what the surrounding comment already claims the code
      does. One line.
- [ ] **A2-01 (P2) — the correction dialog measures the offset against the wrong
      number.** `src/components/media/NowPlayingCard.tsx:446,458-461`;
      `source_episode` is `#[serde(skip)]` at `scrobbler.rs:48-49`. **Fix:**
      serialise it as `sourceEpisode`, pass that as `detectedEpisode`, and
      compute the offset from it.
- [ ] **A1-01 (P2) — the token and the cached viewer are written in the unsafe
      order.** `src-tauri/src/commands/auth.rs:155-160`. **Fix:** write the
      viewer blob first (the intermediate state becomes "new identity, old
      credential", for which `queue_all(B)` is empty and the drain is a no-op)
      and delete the blob if `save_token` then fails.
- [ ] **Regression tests land with the fixes, not after them.**
      `audit/TEST_GAPS.md` specifies 24 named tests in five tiers; tier 1 is
      C1-02/C1-18 above, tiers 2–3 are the tests that would have caught A1-01,
      A1-02, A1-03, A1-14, A2-01, A2-02, A2-04, A3-01 and B3-01.

### Repository action — before the tag is *public*

- [ ] **C3-09 (P2) — the audit directory is tracked and already pushed.**
      Verified on this tree: `git ls-files audit` lists eight reports on
      `claude/karasu-release-audit-l2rksb`, and `.gitignore` has no rule
      covering `audit/`. An unremediated vulnerability inventory naming the SSRF
      proxy, the OAuth loopback listener, the IPC surface, the CSP and the token
      stores must not enter permanent public history ahead of the fixes it
      describes. **Action:** `git rm --cached` the directory, add `audit/` to
      `.gitignore`, and keep the reports out of the branch that merges. This is
      a repository action, not a code change.

### Two pre-tag human checks (P3 — no fix needed, one look each)

- [ ] **B2-06 — the four version carriers agree.** Nothing in the tree compares
      them, and a mismatch produces a permanent reinstall loop for every user.
      Diff by hand after the bump: `package.json`, `src-tauri/Cargo.toml`,
      `src-tauri/tauri.conf.json` (all three carry the `MAJOR.MINOR.PATCH` core)
      and `COMMIT_NUMBER` in `src-tauri/src/commands/update.rs:13`.
      Current tree reads `0.190.0` / `0.190.0` / `0.190.0` / `498`.
- [ ] **B2-01 — the version being published sorts above the one already live.**
      Nothing checks it. Confirm the manifest's `1.0.0+<commit#>` sorts above
      whatever the channel currently serves before the release job runs.

### Optional, cheap, security-shaped (P3 — decide, do not forget)

- [ ] **B1-01 / B1-02 / B1-03 — the bio-image SSRF guard's spellings and its
      cap.** `src-tauri/src/commands/images.rs:46-66` accepts
      `::ffff:127.0.0.1`, `::127.0.0.1` and `localhost.`; the 4 MiB cap is
      enforced after the whole body is buffered. **Fix:** `to_ipv4_mapped()`
      before the match, strip one trailing dot before the name comparison, add
      `100.64/10` and `198.18/15`, enforce the cap while streaming, and extend
      the thirteen existing spelling tests. `SECURITY.md` holds this at P3 (the
      payoff is a blind probe with no path back to the attacker); `TEST_GAPS.md`
      files the same code at P2 as a coverage risk (C1-01). The severity
      disagreement is recorded, not resolved — the action is the same either
      way.

---

## Before the tag — already specified by the roadmap

### The device pass

Verified so far: all four widgets render real data (2026-08-30). Still to
exercise on hardware:

- [ ] **HTTP/2 negotiated** — enable debug logging, open any AniList screen, and
      `karasu.log` should say `negotiated HTTP/2` (the round-10 ALPN fix;
      general loading speed should be visibly better).
- [ ] **The dead-app notification check** — enable the interval in Settings →
      AniList, force-stop Karasu, then
      `adb shell cmd jobscheduler run -f dev.kyu.karasu 46231`.
- [ ] **The share target** — share an anilist.co link out of the browser, once
      bare and once buried in a sentence.
- [ ] **The boot-persisted reschedule** — reboot with the interval on, force a
      run without opening the app first.
- [ ] **Sign-out wipes `widgets.json`** — the widgets fall back to their empty
      state on the next render.
- [ ] **The sync surface** — More → Sync, a queued offline edit drained.
- [ ] **The update notice clears itself** — needs one real update cycle: let the
      app announce a release, install it, relaunch, and the bell row is gone.
      (Testable early by hand-setting a low `last_notified_update_version`.)
- [ ] **The round-10 surface fixes at a glance** — Wrapped loads with a moving
      loader and draws promptly, its pill rows each hold one line, the covers
      show edit + +1 whole, the hero has working arrows and a fast first banner,
      the More sheet reads as a list.

### The build smoke

- [ ] `npm run tauri build`, **warnings read** — `verify` cannot see everything
      a bundle build can (a function whose only non-Linux caller is a test is
      alive under `cargo test` and dead in a release build).
- [ ] `tauri android build`, warnings read.
- *Fact for a fresh Linux checkout:* the Rust suite does not build in a clean
  container as shipped — `webkit2gtk-4.1`, `javascriptcoregtk-4.1`, `libsoup-3.0`
  and their glib dependencies must be installed first, or the first
  `npm run verify` fails at link time for a reason that looks like a code error.
  Neither `CONTRIBUTING.md` nor `CLAUDE.md` says so.

### The secrets confirmation

Repo settings, not the tree. Both have been publishing rolling builds, so this
is a confirmation, not a setup task.

- [ ] The four `ANDROID_*` secrets exist at tag time — `ANDROID_KEYSTORE_B64`,
      `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
      Without them the release ships **desktop-only** and the debug APK stays a
      workflow artifact.
- [ ] `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
      exist — without them the tag build dies at the manifest step, *after* the
      15-minute build.

---

## Cutting the release

The seven mechanical steps, in order.

- [ ] **1. Rewrite `CHANGELOG.md`.** Rename `## Unreleased` to `## 1.0.0` (a
      trailing ` — 2026-…` date is fine; brackets or a fourth segment break the
      slicer's match and the tag build throws). Curate the section from
      `git log` — the file is deliberately well behind the tree, so this is a
      real writing pass. Open a fresh empty `## Unreleased` above it, and delete
      the "there has been no tagged release yet" paragraph, which stops being
      true.
      *Audit note:* if B3-01 is being shipped rather than fixed, its known-issue
      wording belongs in this section (see "Known risks shipped").
- [ ] **2. `node scripts/bump-version.mjs major`**, in the same dirty tree — the
      CHANGELOG edit is what lets the bump run without `--force`. It lands on
      `1.0.0.<commit#>` and prints it for the commit subject.
      *Audit note (B2-06):* do the four-file version diff here, immediately
      after the bump.
- [ ] **3. `npm run verify`, bare, never piped.** The pipe reports *grep's* exit
      status. Then the build smoke above if anything moved since it last ran.
      *Audit note (C1-02/C1-18):* until those two test predicates are fixed this
      step is a coin flip, and a green result proves the scheduler was kind
      rather than that the code is sound. A single green run is not evidence
      here — fix it, or run the suite repeatedly and know what you are looking
      at.
- [ ] **4. One commit** carrying the CHANGELOG rewrite and all five version
      files — the workflow reads both off the tagged commit. Message ends with
      the `Co-Authored-By:` trailer.
      *Audit note (C3-09):* confirm `audit/` is not in this commit and not on
      the branch being merged.
- [ ] **5. `git tag -a v1.0.0`** — annotated, because `git push --follow-tags`
      silently skips lightweight tags, and the only symptom would be a rolling
      rebuild and no release.
- [ ] **6. Push branch and tag** — the maintainer's own action, every time. Two
      workflow runs start and cannot cancel each other (the concurrency group is
      keyed on the ref). The rolling `latest` prerelease survives as the
      prerelease channel and is rebuilt at the same content.
- [ ] **7. Watch "Resolve release target" on the tag run.** The version-agreement
      check and the release-notes precheck both fail in seconds, before the
      ~15-minute build: `release.yml:167-210` throws if the tag's semver core
      disagrees with `package.json`, then runs `release-notes.ps1` against the
      CHANGELOG section and throws if it is missing.

*Two consequences on tag day.* v1.0.0 is the first non-prerelease, so GitHub's
`releases/latest` alias starts resolving and the **Stable update channel goes
live** the moment it publishes — its manifest has 404'd since the channel
existed. And once the release is published the tag is immutable: a run that
fails *after* the precheck can be re-run against the same tag, but a broken
tagged commit means delete-tag, fix, re-tag — acceptable only while no release
was published under it.

---

## After publishing

### Confirm on the published release

- [ ] The release is **not marked prerelease** (the workflow sets
      `prerelease=false` for a tag with no `-` suffix).
- [ ] Assets present: the NSIS installer, the AppImage, `SHA256SUMS.txt`,
      `latest.json` — plus the two APKs if the `ANDROID_*` secrets exist.
- [ ] **`latest.json`'s version reads `1.0.0+<commit#>`.** The `+` is
      load-bearing: `tauri-plugin-updater` parses that field with
      `semver::Version::from_str`, which rejects `1.0.0.<n>` outright and makes
      every install fail with *"unexpected character '.' after patch version
      number"*.
- [ ] The **Stable channel** now resolves — `releases/latest` returns v1.0.0
      where its manifest previously 404'd.
- [ ] The rolling `latest` prerelease still exists and carries the same content.

### Post-release watch items this audit produced

- [ ] **One real update cycle, end to end.** The audit could not run the app: no
      update was ever installed, no installer or APK was produced. The trust
      chain and the `version_comparator` were verified by reading only — install
      the published build over a previous one and confirm it does **not** loop
      (the comparator supplies `COMMIT_NUMBER`; the default one would compare
      the manifest against a commit-number-less `package_info().version`).
- [ ] **Watch for reports of progress moving backwards** (A1-03) and of a
      deleted entry reappearing (A1-14) if those fixes were deferred — both are
      silent, with no toast and no undo.
- [ ] **Watch for scrobbles that never land after a pause** (B3-01) if that fix
      was deferred — Linux and Jellyfin Media Player first.
- [ ] **Re-measure the residual sign-in delay on a device.**
      `connect_with_token` has logged its three phases since the handoff fix;
      nobody has read them off hardware. Act only if it is still slow.
- [ ] **`Page.threadComments` off-by-one** — AniList returns `perPage + 1` rows
      with one out of sequence, cause unknown. Re-measure someday or report
      upstream; the app degrades gracefully.
- [ ] **The limiter's zero-headroom minute** — a header reporting `remaining: 0`
      un-heals headroom for 60 s, during which every request pays the full 5 s
      self-pace before being sent anyway. Harmless in practice so far.

---

## Known risks shipped

Anything left unticked in "Before the tag — from this audit" ships. One line
each, in user-visible terms, so the release notes can be honest.

**P1 — only if the fix is deliberately deferred**

- **B3-01** — pausing a video can reset the scrobble timer, so an episode you
  watched may never be marked as watched. Affects any player Karasu tracks
  through the media-session rung: on Linux that is effectively every player
  except mpv with its IPC pipe, and on Windows it is Jellyfin Media Player and
  browser playback. There is no error and no indicator — the now-playing card
  simply goes idle and comes back.
- **A3-01** — after signing out and into a different account (or switching to
  local mode) without restarting, a detail page can still show the previous
  account's list entry, private notes included, for up to five minutes, and
  saving from that page writes those numbers to the new account.

**P2 — knowingly shipped**

- **A1-02** — deleting an entry while an offline edit for the same title is
  draining can recreate it, stripped of score, notes, tags, dates, repeat and
  volumes.
- **A1-03** — an entry you set by hand can be overwritten by the scrobbler with
  a lower progress and `CURRENT` status, with no toast and no undo.
- **A1-14** — a deleted entry can be scrobbled back into existence the next time
  that title plays.
- **A4-02** — turning on portable mode writes the rest of that session
  (scrobbles, queued edits, library rows, settings) to the old database; they
  are gone at the next launch. The UI says only "Restart Karasu for this to take
  effect".
- **A2-02** — turning automatic updates off mid-episode does not stop a session
  that was already armed; it can still write once, up to a threshold later.
- **A2-01** — re-confirming a title correction can wipe a working episode
  offset, and on a relations-redirected title can mark an entry complete when it
  is not.
- **A1-01** — if the app fails to store the cached viewer during sign-in, queued
  offline edits from the previous account can be sent under the new account's
  credentials.
- **C3-09** — the audit reports are tracked in git. If the branch merges or the
  repository is public with them present, an unremediated finding inventory
  enters permanent public history.

**P2 — deferred by the audit's own recommendation (no action expected before
the tag)**

- **A3-04 / PERF-01** — the AniList write is awaited inline in the 5 s detection
  loop, so a throttled save or a queue drain freezes detection for minutes and
  can miss a short episode.
- **A3-03 / PERF-02** — the frontend retry stacks on the Rust retry with no
  cancellation: one logical read can cost 4 HTTP requests and ~371 s of
  skeleton.
- **A3-02 / PERF-03** — the `Retry-After` deadline the limiter records on a 429
  is read by nobody who decides whether to send, and the window heal repairs the
  budget straight through it.
- **A3-14** — a rate-limit response shows the error page over a complete local
  cache, because the cached-list fallback matches only `ApiError::Network`.
- **A2-04** — the season-stripped title variant can win the matcher's
  exact-match short circuit, placing a season-2 episode on the season-1 entry.
- **C1-01, C1-04, C1-05, C1-06** — untested code under the offline-queue drain,
  `build_now_playing` / `requeue_match`, the optimistic cache patch and its
  rollback, and the SSRF host guard. Not defects in themselves; they are the
  reason the defects above were invisible.
