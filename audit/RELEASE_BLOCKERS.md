# Release Blockers

## Verdict

**No P0 was found. Nothing in this audit is, by itself, a reason to refuse the
tag.** Fifteen dimension reports — architecture, security, account isolation,
data integrity, the database and its migration ladder, sync, scrobbling,
detection, the local library, the updater, performance, UI/UX, dead code, test
gaps and legal/content — produced 238 finding entries across the tree, and every
one of them came back **P0: 0**. The two categories the release bar names most
sharply were specifically hunted and specifically not found: the updater's trust
chain holds end to end (minisign verification before any byte is stashed, the
explicit `version_comparator` that stops the self-reinstall loop, and no
`updater:default` capability reachable from the WebView), and the offline
queue's cross-account write — the thing `MIGRATION_V16` exists to close — is
shut on every path an ordinary user can walk. What *is* here is three P1s, one
of which fails the repository's own release gate on a coin flip, and a short row
of P2s whose failure mode is a user's own data quietly changing under them.
My recommendation is to fix all three P1s and the seven P2s named below before
the tag: none of them is a large change, two are one-liners, and every one of
them is the kind of defect that is far more expensive to explain after a release
than to fix before it.

## P0 — must fix before release

**There are none.** No finding in any of the fifteen reports was filed or
verified at P0, and I did not find one while re-reading the code for this file.
Two findings came close enough to be worth stating plainly, because "no P0"
should be legible as a judgement rather than an absence:

- **A3-01** (`ACCOUNT_ISOLATION.md`) was **filed as a P0 and downgraded on
  verification** — cross-account exposure of one account's list entry, including
  the private `notes` field, under another account's session. It is not a P0
  because the write is not automatic. `MediaCard`'s one-click quick-add fires
  only when `entry` is null (`src/components/media/MediaCard.tsx:109-135`,
  re-read for this report), so the only path that sends account A's numbers is a
  deliberate Save on the detail page or in `EntryEditModal`; the scrobbler reads
  progress from the account-scoped SQLite list cache, not the query cache, so no
  background write is affected; and the `["mediaList", type, userId]` keys are
  viewer-scoped, so the list screens, the sidebar and Wrapped are clean.
  Leakage plus a click is a P1. It is the first item under P1 below.
- **A1-01** (`ACCOUNT_ISOLATION.md`) is a genuine cross-account *write* — A's
  queued edits drained under B's bearer — and was downgraded from P1 to P2
  because reaching it needs a two-fault chain: queued rows for A, a re-sign-in
  as a different account without a logout, and a failing `kv_set` inside that
  exact call. It is not provable end to end on a shipped build without injecting
  a storage failure, which is why it is not a blocker. It is still on the
  strong-P2 list, because the fix is to swap two lines.

## P1 — critical, decide deliberately

### C1-02 — the release gate itself fails at random

`src-tauri/src/logging.rs:745-770` · `TEST_GAPS.md` · Confidence HIGH

`the_panic_hook_records_the_panic` identifies its entry by
`.find(|e| e.target == "panic")` over a newest-first ring. `install_panic_hook`
sets a **process-global** hook, and `sync::tests::a_poisoned_lock_still_hands_
over_its_data` deliberately panics a spawned thread (`panic!("while holding the
lock")`, `src-tauri/src/sync.rs:49`) through that same hook into that same ring,
without taking the logging tests' serialising lock. Under default parallelism
the foreign entry wins.

**Reproduced here, on the first attempt:** `cargo test --lib` in
`/home/user/Karasu/src-tauri` returned `FAILED. 302 passed; 1 failed`, with the
assertion at `logging.rs:762` printing
`[unnamed] while holding the lock (src/sync.rs:49)`. This is not a theoretical
race; it is the state of the tree today.

**Argument — block the tag.** `npm run verify` is the whole gate
(`package.json:12`), both CI jobs run it, and `release.yml` runs it **twice**
(`:78`, `:254`). A release can therefore fail for reasons unrelated to the
release, and — the worse half — a green run means the scheduler was kind, not
that the code is sound. CLAUDE.md's standing instruction is "run it bare and
read the exit code"; that instruction is currently untrue. The fix is one line:
make the predicate identify the entry rather than its class
(`e.target == "panic" && e.message.contains("a deliberate test panic")`). Do
**not** fix it by serialising `sync.rs`'s test into the logger's lock — that
couples an unrelated module to the logger and only narrows the window, since the
hook stays installed for the rest of the binary.

**C1-18 must be fixed in the same commit.** `the_ring_is_bounded_and_newest_
first` (`logging.rs:683-699`) has the identical exposure — it asserts `all[0]`
is its own newest entry while a foreign panic can land on top — and C1-02's
predicate fix does not cover it. Filter that test on its own `"ringtest"` target
too, or the gate will look repaired and stay flaky.

**Recommendation: fix before the tag.** Two one-line test-predicate changes, no
production code touched, and it removes the only thing standing between the
release workflow and a random red.

### A3-01 — an identity change never clears the query cache

`src/stores/auth.ts:149-172` (with `128-134`) · `ACCOUNT_ISOLATION.md`, also
filed as B4-01 (P2) in `UI_UX_AUDIT.md` · Confidence HIGH

`grep -rn "queryClient.clear\|removeQueries\|resetQueries" src/` returns exactly
one hit — `src/pages/Thread.tsx:426`, scoped to a forum key. Re-verified for
this report: `connect`, `enableLocal`, `logout` and the `anilist-auth` listener
each `set()` new store state and clear nothing. Meanwhile `MEDIA_FIELDS` puts
`mediaListEntry { status progress score repeat notes }` and `isFavourite` into
almost every media document, and those keys carry no viewer:
`["mediaDetail", id]`, `["search", …]`, `["seasonal", …]`, `["recommendations",
…]`, `["libraryMedia", …]`, `["franchise", id]`, plus `isFollowing`, `isLiked`
and `userRating` on the social keys. With `staleTime: 5 * 60 * 1000` and
`gcTime: 30 * 60 * 1000` (`src/app/main.tsx:23-24`), account A's entry is served
verbatim to account B for five minutes, and rendered during the refetch for
another twenty-five. `AnimeDetail.tsx:182` computes
`data.mediaListEntry ?? cachedEntry` and hands it to `ListEditor`, which seeds
its controlled state from that object and Saves absolute values.

**Argument — block the tag.** Three things decide this. First, the exposed field
is `notes`, which AniList treats as private text; showing one account's private
notes inside another account's session is a leak whatever the write path does.
Second, the trigger is not exotic: signing out and into a second account, and
switching to local mode, are both first-class buttons in the Account pane, and
`enableLocal` clears nothing while `AnimeDetail` *prefers* the stale AniList
entry over the local one whenever the former is non-null — so the most likely
victim is a user trying out local mode on day one of the release. Third, the fix
is small and has a shape the codebase already uses: register a
`setIdentityChangedHandler` from `main.tsx`, the same registered-callback pattern
as `setTokenRejectedHandler` (`src/api/anilist.ts:63-66`), and call
`queryClient.clear()` on all four transitions. Clear, do not invalidate —
invalidation leaves the stale object renderable during the refetch, which is half
the defect.

The counter-argument is real and worth naming: this is frontend cache state, it
needs a deliberate account switch inside a 30-minute window plus a user click,
and no background process touches it. That is precisely why it is a P1 and not a
P0. It is not why it should ship. **Recommendation: fix before the tag.**

### B3-01 — one empty tick destroys the scrobble session

`src-tauri/src/playback/scrobbler.rs:1213` (the `_ =>` arm of `drive_session`),
with `1094-1131` · `DETECTION_AUDIT.md` · Confidence HIGH

Re-read for this report: the `_` arm sets `*guard = None` and emits `idle` on the
first tick with no detection, and a resumed session re-arms `update_at` from
`Instant::now() + threshold` at `:1115`. The media-session rung reports nothing
whenever the desktop session is not exactly `"playing"`
(`media_session/mod.rs:84-86`, filtered in both tiers of `watchable`), and
`playback_from` sets `position_sec: None`, so the wall clock is the only clock
there is. An ordinary pause therefore erases all accumulated watch time.

**Argument — block the tag.** The blast radius is asymmetric by platform and
that asymmetry is what decides it. On Windows the window-title rung still covers
mpv/VLC/MPC-HC, so this bites Jellyfin Media Player and browser playback. **On
Linux the window rung is empty by construction** (`detection/mod.rs:66-73`;
there is no X11/Wayland enumerator and CLAUDE.md says there will not be one), so
MPRIS *is* generic local detection — and pausing any Linux player without an mpv
IPC pipe resets the threshold. That means the headline feature of the app fails,
silently, on the single most ordinary thing a viewer does, on one of the two
shipping desktop platforms. The other two rungs already treat a pause as a
continuing session and say so in their comments (`jellyfin.rs:592-594`,
`mpv_ipc.rs:120-129`); the session state machine is the odd one out.

The counter-argument is that this is a *missed* write, not a wrong one — no data
is damaged, and a user can set progress by hand — and that a late change to the
scrobbler's state machine is the riskiest kind of late change. I weighed that and
still recommend fixing, because the change is contained to one match arm: keep
the `Session` and its `update_at` while `PlaybackState` is `None` for fewer than
N consecutive ticks, and drop it after. `is_same` (`:1096-1098`) still keys on
`(media_id, episode)`, so a grace window cannot bind the timer to different
content; the worst case of a badly-chosen N is a session that stays armed a few
ticks past a genuine stop and then dies, which is the behaviour every other rung
already has. The three regression tests are already specified in the finding.

**Recommendation: fix before the tag.** If the maintainer decides the state
machine is too hot to touch this close to a release, the honest alternative is to
ship it as a documented known issue naming Linux and Jellyfin Media Player
explicitly in the release notes — not to ship it silently, because the failure
gives the user no signal at all: the card simply goes idle and comes back.

## Strong P2 candidates for the same release

Seven P2s where the fix is small and the failure mode is the user's own data
changing without them, plus one repository action that has to happen before the
tag is public.

- **A1-02 — a skipped drain is treated as a successful one, so a confirmed
  delete un-deletes itself.** `src-tauri/src/commands/list.rs:525-535`.
  `delete_list_entry` matches `Ok(drained)` where its sibling `save_entry_core`
  matches `Ok(drained) if !drained.skipped` and explains why in a comment eight
  lines long (`list.rs:341-345`). A concurrent drain holding an older `save` for
  the same media replays it after the live `DELETE_MUTATION` lands, and
  `SaveMediaListEntry` recreates the entry — without score, notes, tags, dates,
  repeat or volumes. **Fix:** change the arm to
  `Ok(drained) if !drained.skipped =>` and let the fall-through queue the delete,
  exactly as `save_entry_core` does. One line.
- **A1-03 — the "never move progress backwards" guard reads a cache no manual
  save ever updates.** `src-tauri/src/playback/scrobbler.rs:728-743`.
  `would_regress` and `block_reason` both compare against `list_cache`, and
  `db.update_cached_progress` has exactly one caller — `perform_update` itself.
  `save_entry_core` and `bulk_save_list_entries` touch nothing local. Set an
  entry to `24 / COMPLETED` on the list screen, play episode 5 within the
  five-minute `staleTime`, and the scrobbler writes `5 / CURRENT` over it with no
  toast and no undo. **Fix:** patch `list_cache` from the two save paths (and
  from the queue drain) so the guard is fed by the same store the user just
  wrote to.
- **A1-14 — a deleted entry stays a scrobble candidate and gets recreated.**
  `src-tauri/src/commands/list.rs:516-543`. There is no removal counterpart to
  `update_cached_progress`, so `candidates_from_cache` keeps returning the
  deleted media id until the next successful `fetch_media_list`; playing that
  title writes progress and AniList creates the entry again. **Fix:** add
  `Db::forget_cached_entry(user_id, media_type, media_id)` and call it from
  `delete_list_entry` and `bulk_remove` after a successful delete, and on a
  queued one.
- **A2-01 — the correction dialog measures the offset against the wrong
  number.** `src/components/media/NowPlayingCard.tsx:446,458-461`. `np.episode`
  is the *resolved* episode (its own doc comment at `scrobbler.rs:40-42` says
  so), `source_episode` is what the offset must be measured against, and that
  field is `#[serde(skip)]` at `scrobbler.rs:48-49` so the frontend cannot see
  it. Re-opening the picker on a corrected title and confirming the same entry
  stores `offset = 0` and wipes a working correction; on a relations-redirected
  title it can turn a confirmation into a false `COMPLETED`. **Fix:** serialize
  `source_episode` as `sourceEpisode`, pass that as `detectedEpisode`, and
  compute the offset from it.
- **A2-02 — turning automatic updates off mid-episode does not stop the write.**
  `src-tauri/src/playback/scrobbler.rs:1143-1148`. Verified by grep for this
  report: `settings.enabled` appears exactly once in the whole file, at
  `:1107`, inside `auto_arm`, which runs only at session creation. The per-tick
  `armed` check consults `settings.gap_auto` and never the master switch, so a
  session armed before the toggle still fires — up to a full threshold later.
  **Fix:** add `settings.enabled &&` to the `armed` expression, which is what the
  surrounding comment already claims the code does.
- **A1-01 — the token and the cached viewer are written in the unsafe order.**
  `src-tauri/src/commands/auth.rs:155-160`. `save_token` (→ B) then
  `kv_set("anilist_viewer")` (→ B), both `?`-unwound; a failure of the second
  leaves `token = B, viewer = A` durably, and every subsequent drain sends A's
  queued edits under B's bearer and then deletes them. **Fix:** write the viewer
  blob first — the intermediate state becomes "new identity, old credential", for
  which `queue_all(B)` is empty and the drain is a no-op — and delete the blob if
  `save_token` then fails. Optionally store the viewer id beside the token so
  `process_queue` can refuse a mismatched pair.
- **A4-02 — enabling portable mode strands the rest of the session's writes.**
  `src-tauri/src/commands/system.rs:249-284`. Verified end to end for this
  report: `Db` is constructed once in `lib.rs:356` against
  `portable::data_dir(...)` as resolved at startup and never reopened, while
  `portable::is_portable()` is a live marker check and `backups::run_once`
  recomputes the directory on every pass (`backups.rs:104`). From the moment the
  marker is written, scrobbles, queued edits, library rows and settings go to the
  old database, and the next launch opens the T0 snapshot without them. The UI
  says only "Restart Karasu for this to take effect", which reads as *nothing has
  changed yet*. **Fix:** call `app.restart()` immediately after
  `create_marker()` succeeds, so no write can occur against the stale handle.
- **C3-09 — the audit directory is tracked and already pushed.** Verified:
  `git ls-files audit` lists eight reports on branch
  `claude/karasu-release-audit-l2rksb`, and no `.gitignore` rule covers `audit/`.
  This file is a ninth. If the branch is merged or the repository is made public
  with it present, an unremediated vulnerability inventory — naming the SSRF
  proxy, the OAuth loopback listener, the IPC surface, the CSP and the token
  stores — enters permanent public history ahead of the fixes it describes, where
  removal costs a history rewrite. **Fix:** `git rm --cached` the directory, add
  it to `.gitignore`, and keep the reports out of the branch that gets merged.
  This is a repository action, not a code change, and it is the one item on this
  page that must happen before the tag is *public* rather than before it is
  *cut*.

**Two P3s that are pre-tag checks rather than code changes.** B2-06
(`UPDATE_AUDIT.md`): nothing compares the four files carrying the version, and a
mismatch between them produces a permanent reinstall loop for every user — so
diff `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and
`COMMIT_NUMBER` by hand before tagging. B2-01: nothing checks that the version
being published is greater than the one already on the channel — confirm the
manifest's `0.x.y+N` sorts above the live one before the release job runs.
Neither needs a fix to ship safely; both need a human to look once.

**One security predicate worth the three lines.** The bio-image SSRF guard
(`src-tauri/src/commands/images.rs:46-66`) accepts `::ffff:127.0.0.1`,
`::127.0.0.1` and `localhost.` — re-read and confirmed: the IPv6 arm tests
`is_loopback`, `is_unspecified`, `fc00::/7` and `fe80::/10`, none of which match
an IPv4-mapped literal, and the name arm's `h == "localhost"` misses a trailing
dot. `SECURITY.md` holds this at **P3** after verification (B1-01, B1-02) on the
ground that the payoff is a blind probe with no path back out to the attacker;
`TEST_GAPS.md` filed the same code at **P2** (C1-01) as a missing-coverage
security risk. I record the disagreement rather than resolving it, because the
severity does not change the action: map IPv4-mapped IPv6 to its V4 form before
the match, strip one trailing dot before the name comparison, and extend the
thirteen existing spelling tests. It is not data damage, which is why it sits in
a footnote rather than in the list above.

## What was checked and found sound

The machinery that carries the most risk in this app is, on the evidence,
correct. **The updater's trust chain holds end to end**: every installable byte
passes the plugin's minisign verification against the pubkey in
`tauri.conf.json` before it is stashed; the explicit `version_comparator`
supplies `COMMIT_NUMBER` and so defeats the self-reinstall loop the default
comparator would cause; `version_parts` treats `+` and `.` alike and a test
asserts the manifest's shape so a "tidy" back to a dotted fourth segment fails
the suite; `can_install` refuses a non-AppImage Linux install *before* the
~100 MB download; `updater_available()` is a cfg'd pair that keeps Android out;
and `capabilities/default.json` grants no `updater` permission at all, so the
WebView cannot reach the plugin's own comparator. **The offline queue's
account isolation holds** on every path a user can walk: `process_queue`
resolves the owner from `viewer_id(db)` inside the lock, `queue_all`/`queue_len`/
`queue_remove_for` all carry `WHERE user_id = ?` with no empty-list fallback,
`queue_push` cannot produce an ownerless row, `discard_queued_edit` puts the
owner in the WHERE clause rather than trusting a UI-supplied id, and the v16
backfill and its drop rule are both pinned by tests. **The migration ladder is
atomic**: `apply` wraps each step's DDL and its `user_version` bump in one
transaction, five `has_column` guards make the non-re-runnable steps safe, a
database interrupted mid-`ALTER` still opens, and v17's fresh-install seed cannot
overwrite an explicit choice. **The login and proxy surfaces hold**: the OAuth
callback requires a 256-bit nonce compared in constant time, refuses any request
carrying an `Origin` header, and burns the nonce on use; the bio-image proxy
re-checks every redirect hop, caps the chain, refuses non-HTTP schemes, excludes
SVG from its content-type allowlist, and logs neither URL nor body — the gaps
found in it are spellings of "local", not holes in its design. **Scrobble
ordering is right where it matters**: offset then redirect in both resolve paths,
`requeue_match` re-resolving from the untouched source number so corrections
cannot compound in Rust, a redirect that cannot be applied twice, the
`UnknownSeason` block that refuses to guess a season rather than writing the
wrong one, and `would_regress` re-reading live progress inside `perform_update`
rather than trusting a minutes-old session. **A library rescan preserves user
data** — overrides, redirects and confirmed suggestions all survive, and the
index can never outlive its confidences. And **event-listener lifecycle is clean
across the frontend**: every `listen` call site but one awaits its registration
promise before unsubscribing, and the four unbalanced DOM listeners are
module-level singletons that are supposed to outlive components. The defects
above are real and several of them are sharp, but they are gaps at the edges of
sound machinery, not symptoms of a design that will not hold.
