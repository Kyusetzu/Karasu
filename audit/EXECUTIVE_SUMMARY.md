# Executive Summary — Karasu Release Audit

This is the pre-release audit of Karasu at commit `9a53427` on
`claude/karasu-release-audit-l2rksb`, app version **0.190.0.498**.

**What was audited.** The whole tree, not a sample: 21,434 lines of Rust across
47 files in `src-tauri/src`, ~59,900 lines of frontend across 318 files in
`src/`, the 111 `#[tauri::command]` entry points and the IPC capability set, the
SQLite schema and all seventeen migrations, the CI and release pipeline
(`.github/workflows/{ci,release}.yml`, `scripts/bump-version.mjs`, the five
PowerShell release scripts), the Android tree under `src-tauri/gen/android`, and
the licence/notices/asset surface. 538 tracked files.

**How.** Eleven dimensions — architecture, security, account isolation, data
integrity, database and migrations, sync, scrobbling, detection, the local
library, the updater, performance — plus UI/UX, dead code, test gaps and
legal/content, sixteen reports in all. Each dimension was audited once and then
adversarially re-verified against the code by a second pass whose job was to
break the first pass's claims. That second pass produced three outcomes, all
recorded: findings confirmed, findings downgraded with the corrected severity and
the reason, and findings **refuted** and struck. At least 35 findings were
downgraded on verification (including the audit's only P0 candidate, A3-01,
P0 → P1), 5 report entries covering 4 distinct claims were refuted outright, and
roughly 24 findings were raised by the verification pass itself rather than by
the pass it was checking.

**The one honest limitation.** The app was never run. No live AniList request was
made, no Jellyfin server was contacted, no Windows installer or Android APK was
produced, and no update was installed. Every finding here comes from reading
code, schema, workflow YAML and dependency source. The only things actually
executed were the test suites and the type checker, and those results are in
`## Baseline` below. Two consequences worth stating: findings whose confidence
rests on runtime behaviour (WebView CSP enforcement, SMTC/MPRIS session shapes,
the real AniList rate-limit headers) are reasoned from source and marked as such
in their home reports, and `LEGAL_CONTENT.md`'s C3-10 records that two
confidences in that dimension were set against an assumed lack of network access
that was never tested.

---

## Release status

- [ ] READY
- [ ] READY WITH KNOWN RISKS
- [x] NOT READY
- [ ] RELEASE BLOCKED

**Justification.** Nothing in this audit is a P0. The two categories the release
bar names most sharply were hunted specifically and specifically not found: the
updater's trust chain holds end to end (minisign verification before any byte is
stashed, an explicit `version_comparator` that defeats the self-reinstall loop,
no `updater` permission reachable from the WebView), and the offline queue's
cross-account write that `MIGRATION_V16` exists to close is shut on every path an
ordinary user can walk. That is why this is not RELEASE BLOCKED.

It is not READY either, and the deciding item is mechanical rather than
philosophical: **the repository's own release gate is red.** `npm run verify`
ends in `cargo test`, and the default parallel run fails on a cross-test
interference in the panic-hook test — reproduced here on the first attempt,
`FAILED. 302 passed; 1 failed`. `release.yml` runs `npm run verify` twice, so a
tag cut today can fail for reasons that have nothing to do with the release, and
a green run means the scheduler was kind rather than that the code is sound.
Above that sit two P1 defects: an identity change never clears the TanStack cache,
so account A's list entry — private `notes` included — renders inside account B's
session and is one Save away from being written there (A3-01); and one tick with
nothing detected destroys the scrobble session, so an ordinary pause resets the
whole wall-clock threshold on every player without a window title, which on Linux
is every player (B3-01). All three fixes are small — one isolates the
two tests that share the global log ring, one is a registered-callback
`queryClient.clear()`, one is a grace window in a single match arm. Fix the three P1s and the six to eight P2s named
under "Must fix" and this is READY; ship it as it stands and the first thing that
happens is a random red release job.

One item is not a code change and must be settled before the repository is
public: eight of these audit reports (118 severity-tagged, unremediated findings)
are tracked and already pushed to `origin` (C3-09, verified — `git ls-files audit`
returns eight files and `origin/claude/karasu-release-audit-l2rksb` carries them).

---

## Findings

### Counts

Sixteen reports produced **238 finding entries**. `ARCHITECTURE.md` is a map and
raises none; the other fifteen (fourteen dimension reports plus `BUGS.md`, the
cross-cutting register) carry the entries. Because three reports —
`PERFORMANCE.md`, `LIBRARY_AUDIT.md` and `ACCOUNT_ISOLATION.md` — are
cross-cutting views that re-file findings owned elsewhere, and because one defect
was found independently by three passes, those 238 entries reduce to **182
distinct findings**.

| Severity | Report entries (238) | Distinct findings (182) | Distinct functional defects (103) |
|---|---:|---:|---:|
| P0 | 0 | 0 | 0 |
| P1 | 3 | 3 | 3 |
| P2 | 24 | 17 | 13 |
| P3 | 74 | 58 | 41 |
| P4 | 137 | 104 | 46 |
| **Total** | **238** | **182** | **103** |

The 79 distinct findings that are not functional defects break down as
IMPROVEMENT 21, DOCUMENTATION ISSUE 22, MISSING TEST 21, CODE SMELL 8,
INVESTIGATION 4, DEAD CODE 1, RELEASE HYGIENE 1, PROCESS 1. 103 + 79 = 182.

*One correction to a report's own arithmetic.* `BUGS.md`'s Counts table states 79
excluded-by-category entries, but its prose enumerates them as "IMPROVEMENT (20,
counting the one ENHANCEMENT), DOCUMENTATION ISSUE (22), MISSING TEST (21), CODE
SMELL (8), INVESTIGATION (4), DEAD CODE (1), RELEASE HYGIENE (1), PROCESS (1)",
which sums to 78 and makes its own distinct total 181 rather than 182. Recounting
category by category across the fifteen reports, the IMPROVEMENT bucket holds
**21** distinct entries, not 20 — two in `ACCOUNT_ISOLATION.md` (A1-04, A1-12),
two in `DATABASE_AUDIT.md` (A4-09, A4-13), four in `DEAD_CODE.md` (DC-08, DC-09,
DC-17, DC-18), three in `DETECTION_AUDIT.md` (B3-14, B3-15, B3-19), one in
`LEGAL_CONTENT.md` (C3-07), three in `SCROBBLING_AUDIT.md` (A2-05, A2-11, A2-13),
three in `SYNC_AUDIT.md` (A3-12, A3-13, A3-17), two in `UI_UX_AUDIT.md` (B4-11,
B4-15) and one in `UPDATE_AUDIT.md` (B2-10). With 21 the enumeration sums to 79
and the table is right. This is a bookkeeping slip in one sentence, not a missing
finding.

Per-report totals, for cross-reference: `DATABASE_AUDIT` 26 · `DATA_INTEGRITY` 24
· `DETECTION_AUDIT` 21 · `PERFORMANCE` 20 · `TEST_GAPS` 20 · `DEAD_CODE` 18 ·
`SCROBBLING_AUDIT` 17 · `UPDATE_AUDIT` 17 · `SYNC_AUDIT` 16 · `UI_UX_AUDIT` 16 ·
`LIBRARY_AUDIT` 15 · `SECURITY` 11 · `LEGAL_CONTENT` 10 · `ACCOUNT_ISOLATION` 7.
Sum 238.

### Critical data-integrity risks

Thirty-five entries carry the DATA INTEGRITY RISK category, and the sharp ones
cluster in one place: **`list_cache` is a second copy of the user's list that
only one writer keeps current.** It is written by `fetch_media_list` and patched
by `update_cached_progress`, whose only caller is the scrobbler's own
`perform_update`; a manual save, a bulk edit, a delete and a queue drain all
leave it stale. Seven findings fall out of that one fact — A1-03 (the two "never
move progress backwards" guards read it, so setting an entry to `24 / COMPLETED`
by hand and then playing episode 5 within the five-minute `staleTime` writes
`5 / CURRENT` over it with no toast and no undo), A1-14 (a deleted entry is never
removed, so playing that title scrobbles it back into existence), A2-10, A1-05,
A1-17, A3-14 and A2-15.

The other data-integrity items that change a user's own data without them:
**A1-02**, where `delete_list_entry` treats a skipped queue drain as a successful
one — its sibling `save_entry_core` matches `Ok(drained) if !drained.skipped` and
explains why in an eight-line comment, and the delete path matches bare
`Ok(drained)` — so a concurrent drain replays an older save after the live
`DELETE_MUTATION` lands and AniList recreates the entry stripped of score, notes,
tags, dates, repeat and volumes. **A4-02**, where `enable_portable` switches path
resolution immediately but never repoints the live `Db` handle, so every scrobble,
queued edit, library row and setting written after that click goes to the old
database and vanishes at the next launch, under a UI that says only "Restart
Karasu for this to take effect". **A2-01**, where the correction dialog measures
`episode_offset` against the *resolved* episode rather than `source_episode`
(which is `#[serde(skip)]` and so invisible to the frontend), so re-confirming a
correction wipes a working offset and on a relations-redirected title can produce
a false `COMPLETED`. And **A1-01**, the token and the cached viewer written as two
`?`-unwound statements in the unsafe order, which on a failing `kv_set` leaves
`token = B, viewer = A` durably and drains A's queued edits under B's bearer.

### Security risks

Ten distinct findings are security-shaped, and none of them is a hole in a
design — they are spellings, ordering and unvalidated inputs at the edges of
guards that are otherwise correct.

- **A3-01 (P1)** — the only cross-account exposure in the audit.
  `grep -rn "queryClient.clear\|removeQueries\|resetQueries" src/` returns exactly
  one hit, `Thread.tsx:426`, scoped to a forum key; `connect`, `enableLocal`,
  `logout` and the `anilist-auth` listener each set new store state and clear
  nothing. `MEDIA_FIELDS` puts `mediaListEntry { status progress score repeat
  notes }` and `isFavourite` into almost every media document, and ten of those
  query keys carry no viewer id. With `staleTime` 5 min and `gcTime` 30 min,
  account A's entry — including AniList's private `notes` — is served verbatim to
  account B, and `AnimeDetail.tsx:182` prefers it over the local one and seeds
  `ListEditor`, which Saves absolute values.
- **B1-01 / B1-02 (P3)** — the bio-image SSRF guard accepts `::ffff:127.0.0.1`,
  `::127.0.0.1` and `localhost.`: `host_is_local`'s IPv6 arm tests `is_loopback`,
  `is_unspecified`, `fc00::/7` and `fe80::/10`, none of which match an
  IPv4-mapped literal, and the name arm's `h == "localhost"` misses a trailing
  dot. `100.64/10` and `198.18/15` are likewise absent. `SECURITY.md` holds these
  at P3 (the payoff is a blind probe with no path back to the attacker);
  `TEST_GAPS.md` filed the same code at P2 as C1-01, weighting the thirteen
  untested host spellings. The disagreement is recorded rather than resolved
  because it does not change the action: canonicalise IPv4-mapped v6 before the
  match, strip one trailing dot, extend the tests.
- **B1-03 (P3)** — the 4 MiB image cap is enforced after the whole body is
  buffered, so a chunked response is unbounded.
- **P4:** `redact_home` returns after the first match (B1-05); `set_mpv_ipc`
  (B1-07), `set_jellyfin_settings` (B1-10) and `set_library_path` (B1-11) take
  unvalidated paths/URLs over IPC, escalating a WebView compromise; the 24-image
  bio fan-out cap is per document rather than per screen (B1-12); and the Discord
  presence's content-filter guard falls open for unmatched detections and
  broadcasts the raw parsed title (B3-05).

No secret is embedded, no token is reachable from the WebView, and no telemetry
exists — all three checked by enumeration rather than by grep alone, in
`SECURITY.md`'s and `LEGAL_CONTENT.md`'s verified-sound sections.

### Performance issues

Twenty findings, three at P2, none of them a rendering problem — the measured
performance invariants in CLAUDE.md all held. The three P2s are all about the
~30 req/min AniList budget and the 5 s detection loop:

- **A3-04 / PERF-01** — the AniList write is awaited inline in the 5 s detection
  loop, so a throttled save or a queue drain freezes detection for minutes and
  can silently miss a short episode.
- **A3-03 / PERF-02** — the frontend retry stacks on the Rust retry with no
  cancellation: one logical read can cost 4 HTTP requests and ~371 s of skeleton.
- **A3-02 / PERF-03** — `sleeping_until`, the `Retry-After` deadline the limiter
  records on a 429, is read by nobody who decides whether to send, and the window
  heal repairs the budget straight through it.

Below those: four library-correction commands rewrite the whole index inline on
the WebView UI thread (A4-20), `hydrate` re-parses every indexed path on the
setup thread before the window exists (A4-24), the local-library screen renders
every indexed title eagerly and unvirtualized while its sibling `MediaList` goes
through `VirtualGrid` (PERF-04), a failing site-notification pass degrades from
its 15–720 minute interval to one request every 60 s because it stamps only on
success (A3-05), and `VACUUM INTO` runs inline on the UI thread in
`set_backup_settings` (A4-10) and directly inside an async loop in
`backups::run_once` (A4-25).

### Dead-code candidates

**There is essentially no dead code, and that is a finding.** All 110 registered
commands are invoked from the frontend (extracted from `generate_handler!` and
matched against the frontend call sites); no function has only `cfg(test)`
callers; `cargo check --offline` on the Linux target completes with zero
warnings; the one zero-reference `pub fn` is a live JNI entry point; every direct
Cargo dependency and all 22 production npm dependencies are referenced; every
frontend module is imported; all 22 hooks are live and documented; there are no
unreferenced assets, no live `TODO`/`FIXME`/`HACK`/`XXX` markers, and no NUL
bytes or mojibake in any of 364 source files.

What `DEAD_CODE.md`'s 18 findings actually are is stale documentation: two P3s
where `anilistMarkdown.ts`'s design justification cites a deleted module in the
present tense and describes a WebView "whose `csp` is `null`" when
`tauri.conf.json:26` sets a full production CSP; and sixteen P4s, mostly comments
and doc tables that have drifted (`vite.config.ts` claims "thirty-odd files and
four hundred assertions" against a measured 86 files and 935 cases; the
third-party notices table lists 21 of 22 direct dependencies; CLAUDE.md names
"settings/ holds the eight panes" for eight files that no longer map to eight
panes). The one entry categorised DEAD CODE anywhere in the audit is C1-16, the
single `#[ignore]`d test — `live_detect`, which asserts nothing and on Linux
prints an empty vec from a `#[cfg(not(windows))]` stub.

### Missing critical tests

Twenty-one distinct MISSING TEST findings, three of them P2, and they sit exactly
under the code paths that produce the most P2 defects: **C1-04** (the offline-queue
drain — nothing pins which `ApiError` aborts a drain versus drops a row, and a
misclassification either wedges the queue forever or silently discards a queued
edit), **C1-05** (`build_now_playing` / `requeue_match` — the four composition
rules CLAUDE.md calls load-bearing are duplicated 350 lines apart with no test
holding them together), and **C1-06** (the optimistic cache patch and its
two-branch rollback, including the `??`-versus-`||` trap that decides whether
`private: false` and `progress: 0` survive).

`TEST_GAPS.md` specifies 24 concrete regression tests in five tiers, named, with
their assertions and the finding each catches. Beyond the three P2s, the gaps
with teeth are: no test that an identity change empties the query cache (A3-01),
no test that a pause does not restart the scrobble threshold (B3-01), no test
that the season-2 exact-match short circuit survives a season-1 candidate placed
first in the list (A2-04 — the existing `second_season_matches_correct_entry`
passes only because `candidates()` happens to hold no season-1 Kusuriya entry),
and no test that `enabled = false` disarms a running session (A2-02).

### Legal and content findings

**Karasu is legally in good order for a public release**, and this was checked by
enumeration: no piracy tooling of any kind (`torrent|magnet|nyaa|rss|xdcc|ddl`
returns nothing operational), all three video streaming markers are licensed
services, no site name reaches the UI, an original app icon with its provenance
documented in the SVG, screenshots with no Exif, no third-party branding, no
character or promotional artwork as a standalone asset, no copyleft anywhere in
the installed npm tree, no secret in fifty-two commits of history, CI actions
pinned, Taiga credited and `anime-relations` attributed in prose, and font
licences satisfied down to the reproduced OFL and Apache texts in a notices file
that ships byte-identically on desktop and Android.

Ten findings, one P2 and nine documentation-shaped. The P2 is **C3-09**: the audit
reports themselves. Two P3s: a test fixture that names a real, identifiable
AniList user and reproduces their bio (C3-03), and `SECURITY.md`'s enumeration of
contacted hosts omitting the automatic bio-image fetches to arbitrary third
parties (C3-04). At P4: a README features bullet that names five unlicensed
scanlation aggregators (C3-01), an unqualified MIT grant that nominally
sublicenses seven screenshots' worth of publishers' cover art (C3-05), the
runtime-fetched `anime-relations` dataset absent from a notices file that
structurally cannot see it (C3-06), and eight of ten site markers with no test
(C3-08).

### Refuted during verification

Four distinct claims (five report entries) were struck. They are not findings and
are recorded so they are not re-derived later.

- **A1-13** (`ACCOUNT_ISOLATION.md`, `DATA_INTEGRITY.md`) — "`queue_push_deduped`
  refuses with no viewer, so a scrobble is lost silently." Both call sites turn
  the `Err` into `Phase::Blocked(BlockReason::Failed { message })` and emit it to
  the now-playing card, and the precondition is near-unreachable because
  `anilist_session` needs both the token and the viewer blob. The refusal is the
  correct behaviour.
- **B1-08** (`SECURITY.md`) — "middle-click on a bio link navigates the app window
  away." Middle-click's default is a new-window *request*, and both shipped
  engines dead-end there with no handler configured (wry `add_NewWindowRequested`
  → `SetHandled(true)` on WebView2; `connect_create` never wired on WebKitGTK).
  No mechanism produces the claimed impact.
- **B4-14** (`UI_UX_AUDIT.md`) — "`FavouritesModal` blurs on `row.adult &&
  blurAdult` and ignores the level." That is exactly what
  `shouldBlur(media, level, blurAdult)` answers for the same inputs; the proposed
  fix would blur artwork for a user who explicitly switched blurring off,
  contradicting `contentFilter.test.ts:151-154` and the store's documented
  contract.
- **C1-17** (`TEST_GAPS.md`) — a claimed wall-clock flake in
  `a_short_park_never_shortens_a_long_one`. No failing schedule could be
  constructed, and none was observed across nine parallel and three serial runs.

---

## What is solid

The machinery that carries the most risk in this app is, on the evidence,
correct, and it is correct because of guards that are written down and pinned by
tests. **The updater's trust chain holds end to end**: every installable byte
passes the plugin's minisign verification against the pubkey in
`tauri.conf.json` before it is stashed; the explicit `version_comparator` supplies
`COMMIT_NUMBER` and so defeats the self-reinstall loop the default comparator
would cause; `version_parts` treats `+` and `.` alike and a test asserts the
manifest's shape, so "tidying" that `+` back into a dot fails the suite;
`can_install` refuses a non-AppImage Linux install *before* the ~100 MB download;
`updater_available()` is a cfg'd pair keeping Android out; a 404 is not read as
"up to date"; a failed install keeps the download; and `capabilities/default.json`
grants no `updater` permission at all, so the WebView cannot reach the plugin's
own comparator. **The offline queue's account isolation holds** on every path a
user can walk: `process_queue` resolves the owner from `viewer_id(db)` inside the
lock, `queue_all`/`queue_len`/`queue_remove_for` all carry `WHERE user_id = ?`
with no empty-list fallback, `queue_push` takes a non-optional `user_id` so the
pre-v16 shape is unwritable rather than merely unwritten, `discard_queued_edit`
puts the owner in the WHERE clause instead of trusting a UI-supplied id, every
queued payload is absolute so a replay cannot land a relative value on the wrong
account's numbers, and the v16 backfill and its drop rule are both pinned.
**The migration ladder is atomic**: `apply` wraps each step's DDL and its
`user_version` bump in one transaction, five `has_column` guards make the
non-re-runnable steps safe, a database interrupted mid-`ALTER` still opens, and
v17's fresh-install seed cannot overwrite an explicit choice. **The login and
proxy surfaces hold**: the OAuth callback requires a 256-bit nonce compared in
constant time, refuses any request carrying an `Origin` header, burns the nonce on
use, reflects nothing, and fails cleanly to manual paste when the port is taken;
decimal, octal and hex IPv4 spellings are normalised by the URL parser before the
guard sees them; every redirect hop is re-checked and the chain is capped; SVG is
excluded from the content-type allowlist; and neither the bio URL nor the response
is ever logged. **Secrets never leave Rust**: no command returns either token,
scrubbing happens on write rather than on read, and
`no_secret_survives_to_the_file_on_disk` proves it against the artefact that
actually leaves the machine. **Scrobble ordering is right where it matters**:
offset then redirect in both resolve paths, `requeue_match` re-resolving from the
untouched source number so corrections cannot compound in Rust, a redirect that
cannot be applied twice, `would_regress` re-read inside `perform_update` rather
than trusted from a minutes-old session, and the `UnknownSeason` block that
refuses to guess a season rather than writing the wrong one. **A library rescan
preserves user data** — overrides, redirects and confirmed suggestions all
survive, and the index can never outlive its confidences. **Every long-lived loop
except the relations loader is supervised**, and poisoned mutexes go through
`sync::LockExt` so they cannot permanently disable detection. And on the
frontend, **paging is a button everywhere** (zero `IntersectionObserver` hits
repo-wide), every `listen` call site but one awaits its registration promise
before unsubscribing, memoization and Zustand selector discipline hold, and the
documented performance invariants — `usePrimedLists`' backdated `setQueryData`,
the `--cover-cols` grid, the fixed list tracks — all re-verified.

---

## Themes

**1. A second copy of state that only one writer maintains.** `list_cache` is the
clearest case (seven findings), but it is the same shape as A3-01's TanStack
cache surviving an identity change, `LAST_GOOD` surviving a Jellyfin sign-out
(B3-08), the `notifications` table and the alert dedupe keys surviving a logout
(B3-03, B3-20), and the cached viewer blob surviving `enable_local_mode` (A1-09).
In each, one path writes and several read, and nothing invalidates on the event
that makes the copy wrong.

**2. Two writes that must land together, written as two statements.** The token
and the viewer blob (A1-01), plus `profile_mode` as a third (A1-16); the queue
dedupe's delete-then-insert (A1-15); the library scan's `persist` as two
transactions (A4-06) and its two `kv_set` hints as separate autocommits (A4-26);
the redirect plan applied as individual autocommitted deletes then inserts
(A4-07); the update throttle stamped before the response is validated (B2-03).
The migration ladder shows the codebase already knows the answer — `apply` wraps
each step in a transaction precisely so a crash cannot leave a half-state — and
these are the places that pattern was not carried over.

**3. A guard that reads the wrong input.** `delete_list_entry` matching
`Ok(drained)` where its sibling matches `Ok(drained) if !drained.skipped`
(A1-02); the per-tick `armed` check consulting `settings.gap_auto` and never
`settings.enabled`, which appears exactly once in the whole file and only inside
`auto_arm` (A2-02); the correction dialog measuring the offset against the
resolved episode instead of `source_episode` (A2-01); `would_regress` comparing
against a cache no manual save updates (A1-03); the SSRF guard testing IPv6
predicates that an IPv4-mapped literal cannot satisfy (B1-01); the cached-list
fallback matching only `ApiError::Network` so a 429 shows an error page over a
complete local cache (A3-14). The guard exists, is placed correctly, and is fed
something adjacent to what it needs.

**4. Untested composition, and one untested test.** Every P2 above sits on a code
path with no test, and `TEST_GAPS.md` is explicit that the three worst gaps
(C1-04, C1-05, C1-06) are the untested halves of the three paths that produce the
most P2s. The extreme case is C1-02/C1-18, where the gate meant to catch all of
this is itself broken by two tests sharing a process-global panic hook and a
shared ring while only one takes the serialising lock — so the suite's own
reliability was the last thing anyone was in a position to check.

---

## Must fix before release

Ordered by real risk, not by label.

1. **C1-02 + C1-18 — the release gate fails at random.**
   `logging.rs:745` identifies its entry by `.find(|e| e.target == "panic")` over
   a process-global ring that `sync.rs:49`'s deliberate thread panic also writes
   to, without taking the logging tests' lock; `logging.rs:683` has the identical
   exposure on `all[0]`. *Fix:* make both predicates identify their own entry —
   `e.target == "panic" && e.message.contains(<own marker>)` and a
   `target == "ringtest"` filter. Two one-line test changes, no production code.
   Do **not** fix it by serialising `sync.rs`'s test into the logger's lock.
2. **A3-01 — an identity change never clears the query cache.** Account A's
   private `notes` render under account B and one Save writes A's numbers to B's
   list. *Fix:* register a `setIdentityChangedHandler` from `main.tsx` — the same
   registered-callback pattern as `setTokenRejectedHandler` in `api/anilist.ts` —
   and call `queryClient.clear()` on all four transitions (`connect`,
   `enableLocal`, `logout`, the `anilist-auth` listener). Clear, do not
   invalidate: invalidation leaves the stale object renderable during the refetch.
3. **B3-01 — one empty tick destroys the scrobble session.** The `_ =>` arm of
   `drive_session` sets `*guard = None` on the first tick with no detection, and a
   resumed session re-arms `update_at` from `Instant::now() + threshold`. On Linux
   the window-title rung is empty by construction, so pausing any player without an
   mpv IPC pipe silently resets the threshold. *Fix:* keep the `Session` and its
   `update_at` while `PlaybackState` is `None` for fewer than N consecutive ticks
   and drop it after; `is_same` still keys on `(media_id, episode)`, so a grace
   window cannot bind the timer to different content. If the state machine is
   judged too hot to touch this close to the tag, the honest alternative is a
   release note naming Linux and Jellyfin Media Player explicitly — not silence,
   because the card simply goes idle and comes back.
4. **A1-02 — a skipped drain is treated as a successful one, so a confirmed
   delete un-deletes itself.** *Fix:* change `list.rs:531` to
   `Ok(drained) if !drained.skipped =>` and let the fall-through queue the delete,
   exactly as `save_entry_core` already does. One line.
5. **A1-03 — the anti-regression guard reads a cache no manual save updates.**
   A hand-set `24 / COMPLETED` is overwritten with `5 / CURRENT` with no toast and
   no undo. *Fix:* patch `list_cache` from `save_entry_core`,
   `bulk_save_list_entries` and the queue drain, so the guard is fed the same
   store the user just wrote to.
6. **A1-14 — a deleted entry stays a scrobble candidate and gets recreated.**
   *Fix:* add `Db::forget_cached_entry(user_id, media_type, media_id)` and call it
   from `delete_list_entry` and `bulk_remove` after a successful delete, and on a
   queued one.
7. **A4-02 — enabling portable mode strands the rest of the session's writes.**
   `Db` is constructed once against the startup-resolved directory and never
   reopened, while `is_portable()` is a live marker check. *Fix:* call
   `app.restart()` immediately after `create_marker()` succeeds, so no write can
   occur against the stale handle.
8. **A2-02 — turning automatic updates off mid-episode does not stop the write.**
   *Fix:* add `settings.enabled &&` to the per-tick `armed` expression, which is
   what the surrounding comment already claims the code does. One line.
9. **A2-01 — the correction dialog measures the offset against the wrong number.**
   *Fix:* serialise `source_episode` as `sourceEpisode` (drop the `#[serde(skip)]`),
   pass it to the picker as `detectedEpisode`, and compute the offset from it.
10. **C3-09 — the audit directory is tracked and on `origin`.** Eight reports,
    118 unremediated findings, naming the SSRF proxy, the OAuth loopback listener,
    the IPC surface, the CSP and the token stores. *Fix:* `git rm --cached audit`,
    add it to `.gitignore`, keep the reports out of the branch that merges. This
    must happen before the tag is *public*, not before it is cut.

## Should fix before release

1. **A1-01 — the token and the cached viewer are written in the unsafe order.**
   *Fix:* write the viewer blob first (the intermediate state becomes "new
   identity, old credential", for which `queue_all(B)` is empty and the drain is a
   no-op) and delete the blob if `save_token` then fails.
2. **A3-02 / PERF-03 — the `Retry-After` deadline throttles nothing.** *Fix:* have
   the pre-flight decision consult `sleeping_until`, and stop the window heal
   repairing the budget through a server deadline.
3. **A3-04 / PERF-01 — the AniList write is awaited inline in the 5 s detection
   loop.** *Fix:* move the write off the poll thread; `applies_to` already
   prevents a duplicate for the same `(media_id, episode)`.
4. **A3-03 / PERF-02 — two retry layers stack to 4 requests and ~371 s.**
   *Fix:* make the frontend predicate refuse the rate-limit class, and clamp the
   Rust sleep.
5. **A3-14 — a 429 shows the error page over a complete local cache.** *Fix:*
   widen the cached-list fallback past `ApiError::Network` to the retryable class.
6. **B1-01 / B1-02 / B1-03 — the SSRF guard's spellings and its cap.** *Fix:*
   `to_ipv4_mapped()` before the match, strip one trailing dot before the name
   comparison, add `100.64/10` and `198.18/15`, and enforce the 4 MiB cap while
   streaming rather than after buffering. The cheapest security fix in the audit.
7. **A2-04 — the season-stripped variant wins the exact-match short circuit.**
   *Fix:* exclude the stripped variant from the exact-match path, and extend
   `second_season_matches_correct_entry` with a season-1 candidate placed first.
8. **B2-06 and B2-01 — two pre-tag human checks, not code changes.** Diff
   `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and
   `COMMIT_NUMBER` by hand (a mismatch produces a permanent reinstall loop for
   every user), and confirm the manifest's `0.x.y+N` sorts above the version
   already live on the channel.
9. **The 24 regression tests in `TEST_GAPS.md`, tiers 1–3.** Tier 1 is the gate
   itself and is already covered by items 1 above; tiers 2 and 3 are the tests
   that would have caught A1-01, A1-02, A1-03, A1-14, A2-01, A2-02, A2-04, A3-01
   and B3-01 — write them with the fixes, not after them.

## Can fix after release

1. **A1-17, B3-03, B3-20 — signed-out state that outlives the account.** Cached
   lists, the `notifications` table and three account-less dedupe key prefixes
   survive `anilist_logout`. Clear them on logout, or key them by viewer.
2. **A4-20, A4-24, A4-10, A4-25, PERF-04 — work on the wrong thread.** Four
   library-correction commands, `hydrate`, two `VACUUM INTO` calls and the
   unvirtualized local-library screen. Move each off the UI/setup/async-worker
   thread; virtualize `LocalLibrary` through the `VirtualGrid` its sibling
   already uses.
3. **A3-05, A3-07, B2-05 — unbounded or degrading network behaviour.** Stamp the
   site pass on failure as well as success; give the relations loader a timeout
   (it is the one outbound client in the tree with none at any level); give the
   updater's download client one too.
4. **B2-15, B2-16, B2-04, B2-02, B2-09, B2-17 — updater ergonomics.** Re-downloading
   ~100 MB for a declined update, a throttle with no lower bound that a backwards
   clock jump disables indefinitely, an undeduped daily bell row, an absent
   AppImage entry degrading into a green "up to date", a rolling tag force-moved
   before publication, and Android `versionCode` not moving on a commit-only bump.
5. **B4-03, B4-06, B4-04, B4-05 — content-filter coverage.** The bell's AniList
   rows carry no `isAdult`/`genres` so the filter cannot apply at all; `blur_adult`
   is honoured on eight cover surfaces and skipped on five; stored notification
   rows are filtered at write time only; the match picker omits the `isAdult`
   server argument and trims on arrival.
6. **The 22 documentation findings and the 21 improvements.** `DEAD_CODE.md`'s
   drifted comments and doc tables, `LEGAL_CONTENT.md`'s README and notices items
   (C3-01, C3-04, C3-06 in particular), and the smaller ergonomic work. None of
   it changes behaviour; all of it is cheap and none of it is urgent.

---

## Baseline

Measured on this tree, in this container, on the audited commit.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, no diagnostics |
| `npx vitest run` | **86 files / 935 tests, all passing** — 14.43 s at audit time; 15.14 s on the re-run for this summary |
| `cargo test -- --test-threads=1` | **303 passing, 1 ignored, 0 failed** — 2.37 s at audit time; 1.92 s on the re-run |
| `cargo test` (default parallelism, what `npm run verify` and CI actually run) | **FAILS** — `FAILED. 302 passed; 1 failed; 1 ignored`, reproduced on the first attempt |

The failing test is `logging::tests::the_panic_hook_records_the_panic`, asserting
at `src-tauri/src/logging.rs:762` and printing
`[unnamed] while holding the lock (src/sync.rs:49)` — the panic message from
`sync::tests::a_poisoned_lock_still_hands_over_its_data`, which panics a spawned
thread through the same process-global hook into the same ring without taking the
logging tests' serialising lock. `npm run verify` is `typecheck && vitest run &&
cargo test`, both CI jobs run it, and `release.yml` runs it twice, so **the verify
gate CI runs on every pull request is flaky today**, and a green run means the
scheduler was kind rather than that the code is sound. CLAUDE.md's standing
instruction to "run it bare and read the exit code" is, as of this commit, not
something the gate can honour.

The one ignored test is `live_tests::live_detect` (`C1-16`), a manual aid that
asserts nothing.

**Environment note.** The Rust suite does not build in a clean Linux container as
shipped: the GTK/WebKit development packages have to be installed first
(`webkit2gtk-4.1`, `javascriptcoregtk-4.1`, `libsoup-3.0` and their glib
dependencies — confirmed present at `webkit2gtk-4.1` 2.52.3, `glib-2.0` 2.80.0).
Nothing in `CONTRIBUTING.md` or `CLAUDE.md` states this, which makes a first
`npm run verify` on a fresh Linux checkout fail at link time for a reason that
looks like a code error.

**Scale, re-measured for this summary.** 47 Rust files / 21,434 lines; 317
TypeScript/TSX/CSS files / 59,881 lines under `src/` (318 counting
`index.html`'s sibling declaration file, as `ARCHITECTURE.md` does); 538 tracked
files; 111 `#[tauri::command]` attributes over 110 distinct registered command
names.
