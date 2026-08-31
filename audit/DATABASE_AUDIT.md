# Database and Migration Audit

## Scope

The persistence layer and everything that makes it multi-statement:
`src-tauri/src/db.rs` (the whole migration ladder V1–V17, `apply`, `has_column`,
`Db::open`, the list cache, the offline queue, the local list, the library tables and
`snapshot_to`/`snapshot_over`), `src-tauri/src/library.rs` (the scanner, `persist`,
`index_files`, `hydrate`, `plan_redirect` and the six library commands),
`src-tauri/src/identify.rs`, `src-tauri/src/backups.rs`, `src-tauri/src/portable.rs`,
`src-tauri/src/anilist/auth.rs` (token storage across the portable switch), and the
callers that compose those into logical operations — `src-tauri/src/commands/list.rs`,
`src-tauri/src/commands/system.rs`, `src-tauri/src/background.rs`, `src-tauri/src/lib.rs`
and `src-tauri/src/playback/scrobbler.rs`. Frontend readers of stored shapes were traced
where they decide correctness (`src/lib/malExport.ts`, `src/lib/jsonImport.ts`,
`src/pages/settings/AdvancedPane.tsx`).

Read-only audit, then adversarially verified against the same sources. Nothing in the
repository was modified.

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
|---|---|---|---|---|
| A4-02 | P2 | DATA INTEGRITY RISK | src-tauri/src/commands/system.rs:249 | `enable_portable` switches path resolution immediately but keeps writing to the old database, so a session's scrobbles and queued edits vanish on the next launch |
| A4-03 | P3 | DATA INTEGRITY RISK | src-tauri/src/library.rs:474 | A partially-readable library root produces a truncated walk that replaces the whole index, reported as a success |
| A4-21 | P3 | BUG | src-tauri/src/commands/system.rs:283 | There is no reverse token migration: enable → disable → restart leaves the credential store empty and the user silently signed out |
| A4-04 | P3 | DATA INTEGRITY RISK | src-tauri/src/library.rs:1364 | `MAX_FILES` truncation and `MAX_DEPTH` skipping are silent, and the truncated result overwrites the complete index |
| A4-22 | P3 | DATA INTEGRITY RISK | src-tauri/src/lib.rs:356 | A database that fails to open aborts `setup`, so the app never starts and there is no in-app recovery path despite daily backups sitting beside the file |
| A4-01 | P3 | BUG (concurrency) | src-tauri/src/db.rs:551 | On Android two connections can race an `ALTER TABLE` because `has_column` is checked outside the transaction that acts on it |
| A4-20 | P3 | PERFORMANCE PROBLEM | src-tauri/src/library.rs:933 | Four library-correction commands run a full index rewrite (and a reparse sweep) inline on the WebView UI thread |
| A4-05 | P4 | DATA INTEGRITY RISK | src-tauri/src/db.rs:528 | No guard against a `user_version` ahead of the binary; an older build then writes `user_id IS NULL` queue rows the current build can never see |
| A4-08 | P4 | DATA INTEGRITY RISK | src-tauri/src/db.rs:756 | `update_cached_progress` is a read-modify-write across two lock acquisitions, so a concurrent full cache write is silently discarded |
| A4-07 | P4 | DATA INTEGRITY RISK | src-tauri/src/library.rs:1118 | An atomically-planned redirect change is applied as individual autocommitted deletes then inserts |
| A4-06 | P4 | DATA INTEGRITY RISK | src-tauri/src/library.rs:663 | `persist` publishes one scan as two independent transactions, so a failure between them shows a file as both matched and unplaced |
| A4-26 | P4 | DATA INTEGRITY RISK | src-tauri/src/library.rs:553 | The scan's two `kv_set` hints are separate autocommits after `persist`, so `library_files_seen` can describe the previous scan |
| A4-11 | P4 | BUG | src-tauri/src/library.rs:1386 | Non-UTF-8 paths are stored lossily, producing a permanently dead play button with a misleading "rescan your library" message |
| A4-09 | P4 | ENHANCEMENT | src-tauri/src/library.rs:717 | Files with no parsable episode number — every film and single-file OVA — leave the pipeline entirely, with no screen on which to discover them |
| A4-12 | P4 | BUG | src-tauri/src/library.rs:327 | `set_library_path` is the one library-mutating command that does not consult the scan flag |
| A4-13 | P4 | IMPROVEMENT | src-tauri/src/db.rs:328 | V16's `DELETE FROM offline_queue WHERE user_id IS NULL` discards queued edits with no count, log or notification |
| A4-23 | P4 | BUG | src-tauri/src/commands/system.rs:272 | `enable_portable`'s documented failure guarantee is false for the token: it leaves the credential store before the marker is written |
| A4-10 | P4 | PERFORMANCE PROBLEM | src-tauri/src/commands/system.rs:600 | `set_backup_settings` runs a whole-database `VACUUM INTO` inline on the UI thread |
| A4-24 | P4 | PERFORMANCE PROBLEM | src-tauri/src/library.rs:832 | `hydrate` re-parses every indexed path on the setup thread before the window exists |
| A4-25 | P4 | PERFORMANCE PROBLEM | src-tauri/src/backups.rs:156 | `backups::run_once` is called directly inside the async loop, blocking a tokio worker for the duration of a `VACUUM INTO` |
| A4-19 | P4 | PERFORMANCE PROBLEM | src-tauri/src/library.rs:454 | `db.library_all().len()` materialises every row and its path just to get a count, under the `Db` mutex |
| A4-18 | P4 | BUG | src-tauri/src/db.rs:155 | `library_unmatched`'s `(title, season, episode)` PK collapses duplicate unplaced files, so the group's count drops across a restart |
| A4-15 | P4 | MISSING TEST | src-tauri/src/library.rs:1066 | `plan_redirect`'s right-hand trim branch, including its `dst_start` re-basing, is unreached by any test |
| A4-16 | P4 | MISSING TEST | src-tauri/src/db.rs:1772 | The half-migrated recovery test asserts openability only; the v16 leg never checks what happened to the queue |
| A4-14 | P4 | DOCUMENTATION ISSUE | src-tauri/src/db.rs:519 | The "not WAL because `snapshot_to` encodes rollback-journal assumptions" comment names a dependency that is not in that function |
| A4-17 | P4 | INVESTIGATION | src-tauri/src/db.rs:327 | V16's `json_extract(value,'$.id')` backfill cannot be checked against pre-squash history; no defect demonstrated |

## Migration walk

Verified statement by statement against `src-tauri/src/db.rs`. `apply` (db.rs:493) wraps each
step in `BEGIN; … COMMIT;`; SQLite makes DDL and `PRAGMA user_version` both transactional, so a
step lands with its version stamp or not at all. "Guarded how" is the condition in `Db::open`.

| Version | What it does | Re-runnable? | Guarded how | Risk noted |
|---|---|---|---|---|
| V1 (`MIGRATIONS`, db.rs:10) | `CREATE TABLE IF NOT EXISTS kv` + `offline_queue` | yes | none needed — runs unconditionally on **every** open (db.rs:523) | stamps no `user_version`; a fresh database sits at 0 and falls through the whole ladder, which is the intent |
| V2 (db.rs:25) | `DROP TABLE IF EXISTS list_cache` + `CREATE TABLE list_cache` | yes, destructively by design | `version < 2` (db.rs:528) | drops the cache deliberately; unreachable once version ≥ 2, so a downgraded binary cannot re-fire it |
| V3 (db.rs:40) | `CREATE TABLE IF NOT EXISTS history` | yes | `version < 3` (db.rs:531) | the table is retained empty and unused; the const says so |
| V4 (db.rs:58) | `CREATE TABLE IF NOT EXISTS local_list` | yes | `version < 4` (db.rs:534) | none |
| V5 (db.rs:78) | `CREATE TABLE IF NOT EXISTS notifications` | yes | `version < 5` (db.rs:537) | none |
| V6 (db.rs:94) | `CREATE TABLE IF NOT EXISTS library_files` (PK `(media_id, episode)`) | yes | `version < 6` (db.rs:540) | the PK is why a file with no episode number has no representation — A4-09 |
| **V7 (db.rs:110)** | `ALTER TABLE local_list ADD COLUMN progress_volumes` | **no** | `has_column(local_list, progress_volumes)` — db.rs:551 | the probe runs outside the transaction that acts on it — A4-01 |
| V8 (db.rs:120) | `CREATE TABLE IF NOT EXISTS library_match` | yes | `version < 8` (db.rs:558) | none |
| V9 (db.rs:148) | `CREATE TABLE IF NOT EXISTS library_override` + `library_unmatched` | yes | `version < 9` (db.rs:561) | `library_unmatched` PK `(title, season, episode)` collapses duplicate paths — A4-18 |
| V10 (db.rs:174) | `CREATE TABLE IF NOT EXISTS library_suggestion` | yes | `version < 10` (db.rs:564) | none — the suggestion lifecycle is sound (see Verified sound) |
| V11 (db.rs:197) | `CREATE TABLE IF NOT EXISTS library_redirect` | yes | `version < 11` (db.rs:567) | schema is fine; its writer applies a plan non-atomically — A4-07 |
| V12 (db.rs:237) | `CREATE TABLE IF NOT EXISTS detection_override` | yes | `version < 12` (db.rs:570) | none |
| **V13 (db.rs:261)** | `ALTER TABLE detection_override ADD COLUMN episode_offset` | **no** | `has_column(detection_override, episode_offset)` — db.rs:577 | A4-01 |
| **V14 (db.rs:278)** | 3× `ALTER TABLE local_list ADD COLUMN` — `started_at`, `completed_at`, `private` | **no** | `has_column(local_list, started_at)` — db.rs:587 | the first column decides for all three; correct **only** because `apply` puts all three in one transaction. A4-01 |
| **V15 (db.rs:300)** | `ALTER TABLE notifications ADD COLUMN media_id` | **no** | `has_column(notifications, media_id)` — db.rs:596 | A4-01 |
| **V16 (db.rs:324)** | `ALTER TABLE offline_queue ADD COLUMN user_id` + backfill `UPDATE` from `json_extract(kv['anilist_viewer'], '$.id')` + `DELETE FROM offline_queue WHERE user_id IS NULL` | **no** | `has_column(offline_queue, user_id)` — db.rs:608 | the guarded branch (db.rs:608-611) stamps the version and skips the backfill **and** the DELETE — untested (A4-16); the backfill is one-shot, so rows a downgraded binary writes are never attributed (A4-05); the DELETE is silent (A4-13); A4-01 |
| V17 (db.rs:354) | `INSERT INTO kv … SELECT 'blur_adult', CASE WHEN EXISTS(SELECT 1 FROM kv) … WHERE NOT EXISTS (SELECT 1 FROM kv WHERE key='blur_adult')` | **yes** | none needed — guarded on the key it inserts, documented at db.rs:351 | none; both populations pinned by db.rs:1533 and db.rs:1552 |

Two ladder-wide properties, both verified: a crash *between* two steps is safe (each `apply` is
independent and `user_version` records progress, so the next open resumes at the right rung), and
a failing statement leaves no half-open transaction (`execute_batch` returns `Err`, every caller
propagates with `?` out of `Db::open`, and dropping the `Connection` rolls back). What the ladder
does **not** have is an upper bound: `version > 17` is accepted silently (A4-05), and any `Err`
from it aborts app startup outright (A4-22).

---

# Findings

---

ID: A4-02
Severity: P2
Category: DATA INTEGRITY RISK

File: src-tauri/src/commands/system.rs
Line: 249-273 (with src-tauri/src/portable.rs:78-80 and 120-128, src-tauri/src/backups.rs:104, src/pages/settings/AdvancedPane.tsx:203-215)
Function: `enable_portable`

Problem:
`enable_portable` snapshots the live database into the portable folder and writes the
`karasu.portable` marker, but the running process keeps its already-open `Connection` on the
*AppData* file. `portable::is_portable()` is a live filesystem check (portable.rs:78-80), so from
the moment the marker exists the app is half-switched: new path resolutions go to the portable
folder while every write still lands in the old database.

Expected Behavior:
Either the switch is deferred entirely until the next launch — nothing changes behaviour now — or
the user is required to restart before continuing.

Actual Behavior:
1. `db.snapshot_to(&dest)` (system.rs:255) copies the database as of T0.
2. `crate::portable::create_marker()` (system.rs:273) makes `is_portable()` true immediately.
3. `Db` was constructed once at `lib.rs:356` against `portable::data_dir(...)` as resolved at
   startup and is never reopened, so every subsequent scrobble, list-cache write, offline-queue
   push, library index write, notification and setting goes to the AppData file.
4. `backups::run_once` recomputes `crate::portable::data_dir(base)` on every pass
   (backups.rs:104), so from T0 the daily backups are written into the *portable* folder while
   snapshotting the AppData connection.
5. On the next launch `data_dir` resolves to the portable folder and the app comes up on the T0
   snapshot. Everything between T0 and the restart is gone from the active database.

The UI does not force the restart: `AdvancedPane.tsx:210` sets a flag that renders
`settings.portableRestart` at `AdvancedPane.tsx:276` — "Restart Karasu for this to take effect."
(`src/i18n/en.ts:1486`) — a passive hint whose wording implies nothing has changed yet.

Reproduction:
Enable portable mode. Keep using the app: watch a few episodes so the scrobbler writes progress,
and make an edit while the connection is flaky so the offline queue takes a row. Restart. The
scrobbled progress and the queued edits are absent from the portable database the app now opens.

Impact:
Silent reversion of a session's work. The old file is not deleted (`PortableStatus::other` still
reports it, system.rs:224), so this is recoverable by hand — but the user is given no reason to
suspect anything was lost, and the offline queue is the sharp edge: unsynced edits made after T0
are stranded in a database the app will not open again.

Root Cause:
`is_portable()` is evaluated live while the database handle is bound once at startup, and the
snapshot is taken at toggle time rather than at shutdown.

Recommended Fix:
Close the window rather than narrow it: after `create_marker()` succeeds, call `app.restart()` so
no writes can occur against the stale handle. Failing that, block the UI on an explicit "Restart
now" and refuse other writes in between. Re-snapshotting on the exit handler is a cheaper
mitigation but still leaves a window.

Regression Tests Required:
Not unit-testable as written — it needs a live `AppHandle`. The testable half is an assertion that
`enable_portable` leaves the process's `Db` pointing at the pre-toggle path, so the invariant is
recorded in a test rather than only in prose.

Confidence: HIGH

---

ID: A4-03
Severity: P3
Category: DATA INTEGRITY RISK

File: src-tauri/src/library.rs
Line: 474-482 (the guard), 1363-1389 (`collect_videos`)
Function: `scan_library`, `collect_videos`

Problem:
`collect_videos` counts unreadable directories and returns the count, but `scan_library` consults
it only when the walk found *nothing*. A root that is readable while some of its subtrees are not
— a NAS share that drops mid-walk, a permission-denied season folder, an external drive that spins
down partway — produces a partial file list that is then written down as the complete truth.

Expected Behavior:
"Could not look" and "found nothing" are already distinguished for the total-loss case; the same
distinction should hold for a partial loss, because the scan replaces all three library tables
wholesale.

Actual Behavior:
The guard is `if total == 0 && (unreadable > 0 || previously_indexed > 0)` (library.rs:474) — the
only consumer of `collect_videos`'s `#[must_use]` return value. With `unreadable = 40` and
`total = 300` (down from 3,000) the condition is false, the scan proceeds to `persist`
(library.rs:663-673), which `DELETE`s and rewrites `library_files`, `library_match` and
`library_unmatched` from the 300 files that were reachable, and `kv_set("library_files_seen", …)`
(library.rs:556) is overwritten with 300. The command returns `Ok` and the pane renders success.
Each unreadable directory *is* logged (`logging::warn`, library.rs:1368-1375), so it is not
literally silent — but nothing user-visible distinguishes the case and the index is replaced
regardless.

Reproduction:
Point the library at a mounted network share; start a scan; disconnect the network after the walk
has entered the tree but before it finishes. The scan returns `Ok` with a reduced count and the
index is replaced.

Impact:
The play affordances for most of the library disappear until a successful rescan. No user data is
destroyed — `library_override`, `library_redirect` and `library_suggestion` are untouched — but
the index is the thing the feature exists for, and the failure presents as success.

Root Cause:
`unreadable` is computed and marked `#[must_use]` (library.rs:1362) but wired into only one arm of
the guard the same change added.

Recommended Fix:
Refuse — or at minimum warn on screen and keep the previous index — whenever `unreadable > 0`, or
whenever `total` has fallen by more than a threshold against `previously_indexed`. The sentence
already written for the `total == 0` case ("The index was kept — check that the drive or network
share is connected") is the right one for both.

Regression Tests Required:
A test over `collect_videos` plus the guard that a walk returning `unreadable > 0` with
`total > 0` does not reach `persist`. The existing
`an_unreadable_directory_is_counted_rather_than_swallowed` (library.rs:1879) covers only the
counting half.

Confidence: HIGH

---

ID: A4-21
Severity: P3
Category: BUG

File: src-tauri/src/commands/system.rs
Line: 283-285 (with src-tauri/src/anilist/auth.rs:121-136 and 35-42)
Function: `disable_portable`, `migrate_to_portable_file`, `load_token`

Problem:
Switching *into* portable mode moves the token out of the OS credential store and into the
encrypted portable file. Switching *out* of portable mode does not move it back — there is no
reverse migration anywhere in the tree. The next launch reads the credential store, finds nothing,
and the user is signed out with no explanation.

Expected Behavior:
A switch is a switch. Turning portable mode off should leave the install in the state it was in
before it was turned on, sign-in included.

Actual Behavior:
`enable_portable` calls `crate::anilist::auth::migrate_to_portable_file()` (system.rs:272), which
writes the token to the portable file and then calls `entry.delete_credential()` (auth.rs:132) —
deliberately, so a live bearer token is not left where sign-out would never reach it.
`disable_portable` (system.rs:283-285) is `crate::portable::remove_marker()` and nothing else. On
the next launch `is_portable()` is false, so `load_token` (auth.rs:35-42) takes the credential-store
branch, which is empty. `grep -rn "migrate_to_portable_file\|migrate_from_portable"` over
`src-tauri/src/` returns only the two definitions and the one call site in `enable_portable`; no
inverse exists. The `delete_token` doc comment (auth.rs:44-54) reasons about exactly this class of
hole but only in the opposite direction.

Reproduction:
Sign in. Settings → Advanced → enable portable mode → disable portable mode → restart. The app
comes up signed out. The token file is still sitting in the portable folder, unreadable in this
mode.

Impact:
A deterministic, silent sign-out on a two-click sequence a user exploring the setting will
plausibly perform. Recoverable by signing in again (or by re-enabling portable mode), but nothing
on screen connects the sign-out to the toggle, and the local list, the offline queue and the
library index are all still present — so it reads as an account bug rather than a mode switch.

Root Cause:
The portable switch was implemented as a one-way migration: `enable_portable` moves state,
`disable_portable` only removes the marker, and the doc comment for it reasons about the database
("the app comes back on whatever is in AppData") without noticing that the token does not come back
at all.

Recommended Fix:
Add the mirror of `migrate_to_portable_file` — read the portable token file, write it to the
credential store, then remove the file — and call it from `disable_portable` before
`remove_marker()`, in that order for the same reason the enable path writes the marker last. It
must distinguish "no token file" from "could not read it", exactly as `migrate_to_portable_file`
distinguishes `NoEntry` from a locked keyring.

Regression Tests Required:
A test that the pair round-trips: a token saved in one mode is loadable in the other after the
corresponding migration, and that the source store is empty afterwards. Desktop-gated
(`cfg(any(windows, target_os = "linux"))`), matching the module's own gating.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-04
Severity: P3
Category: DATA INTEGRITY RISK

File: src-tauri/src/library.rs
Line: 19-20 (`MAX_DEPTH`, `MAX_FILES`), 1364, 1380
Function: `collect_videos`, `scan_library`

Problem:
The walk stops silently at `MAX_FILES = 20_000` and skips silently below `MAX_DEPTH = 6`. Neither
truncation is reported anywhere, and the truncated result is then written over the complete
previous index.

Expected Behavior:
Hitting a safety cap is information the user needs, because the consequence is that part of their
library stops being playable and cannot even be surfaced as unplaced.

Actual Behavior:
`collect_videos` returns early at library.rs:1364 (`depth > MAX_DEPTH || out.len() >= MAX_FILES`)
and again at library.rs:1380 (`out.len() >= MAX_FILES` inside the entry loop). Its return value
counts *unreadable directories* only, so both early exits return `0` and a truncated walk is
indistinguishable from a complete one. `scan_library` then reports `files: total` (= exactly
20,000) and writes that to `library_files_seen` (library.rs:556). `ScanSummary` carries no
truncation flag and nothing is logged for either cap.

Reproduction:
A library of 25,000 video files. Scan: everything past the cap is absent from the index and from
the unplaced list, and the pane reports a clean success. (Correction to the original write-up: the
depth half needs seven directory levels below the root, not six — the guard is `depth > MAX_DEPTH`
with the root at depth 0, so `root/Anime/By-Studio/<studio>/<series>/<season>/<batch>/file.mkv` is
still walked. The `MAX_FILES` half is what carries this finding.)

Impact:
Part of the library silently loses its play buttons with no screen on which the user can notice.
20,000 files is large but reachable for a long-runner-heavy collection, and the failure again
presents as success.

Root Cause:
The caps predate the "found nothing must not be persisted as truth" guard and were never wired
into it; `collect_videos` has one return channel and it is already spoken for.

Recommended Fix:
Return the cap-hit and the depth-skip alongside `unreadable` (a small struct rather than a
`usize`), and either refuse the scan or attach a warning to `ScanSummary` that the pane renders.
At minimum `logging::warn` on both, matching what the unreadable-directory path already does.

Regression Tests Required:
A test that a walk hitting `MAX_FILES` reports it (a synthetic `out` pre-filled to the cap), and
one that a directory below `MAX_DEPTH` is reported rather than silently skipped.

Confidence: HIGH

---

ID: A4-22
Severity: P3
Category: DATA INTEGRITY RISK

File: src-tauri/src/lib.rs
Line: 356-359 (with src-tauri/src/commands/system.rs:586-596 and src-tauri/src/backups.rs:95-149)
Function: the `setup` closure, `Db::open`

Problem:
Any error from `Db::open` — corruption, a disk fault, a permissions change, a failed migration
step — is logged and then converted into a failed `setup`, which means the application does not
start. There is no fallback, no repair attempt and no in-app route to the backups that the app
itself has been writing every hour.

Expected Behavior:
A tracker that keeps daily backups beside its database should be able to tell the user the database
is unreadable and offer them the backups, rather than refusing to launch at all.

Actual Behavior:
```
app.manage(db::Db::open(data_dir).map_err(|e| {
    logging::error("db", format!("cannot open the database: {e}"));
    std::io::Error::other(e)
})?);
```
(lib.rs:356-359). The `?` propagates out of the setup closure, so the window is never created. The
only artefact is one line in `karasu.log`, which the user cannot reach through the app because the
log viewer is a screen inside the app. The documented restore procedure is entirely manual:
`open_backup_dir` (system.rs:586-596) exists to open the folder, and its own doc comment states
that "restoring a backup means replacing `karasu.db` with one of these files while the app is
closed" — a button inside the application that cannot start.

Reproduction:
Truncate or corrupt `karasu.db` (or make it unreadable) and launch. The process exits without a
window; the only evidence is `karasu.log`.

Impact:
An unbootable app for a failure mode the design already anticipates well enough to keep hourly
snapshots for. The user's AniList data is safe on the server, but the local list (the account-free
profile), the library index, the offline queue and every setting are behind the file that will not
open. Two other findings in this report are special cases of the same missing guard: A4-01 (a
migration step that fails on Android) and A4-05 (a database from the future) both end here.

Root Cause:
`Db::open` is treated as infallible-or-fatal at the one call site, and no code path between "the
database did not open" and "the app runs" exists.

Recommended Fix:
On an `Err` from `Db::open`, do not abort. Rename the unopenable file aside
(`karasu.db.unreadable-<timestamp>`), and either open the newest backup that passes
`backups::is_readable_database` (backups.rs:82) in its place or start on a fresh database, in both
cases raising a notification that says what happened and where the old file went. The two helpers
needed — `is_readable_database` and `snapshot_over` (db.rs:731) — already exist.

Regression Tests Required:
A test that `Db::open` against a file that is not a database returns `Err` (pinning the contract),
plus a test of whatever recovery function is added: given a corrupt primary and a readable backup,
it comes up on the backup and leaves the corrupt file renamed rather than deleted.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-01
Severity: P3
Category: BUG (concurrency / DATA INTEGRITY RISK)

File: src-tauri/src/db.rs (with src-tauri/src/background.rs)
Line: db.rs:551, 577, 587, 596, 608 (the five `has_column` guards); db.rs:493-496 (`apply`); db.rs:499-507 (`has_column`); background.rs:84
Function: `Db::open`, `has_column`, `background::check`

Problem:
On Android two connections to `karasu.db` can be open concurrently — the app's own at `lib.rs:356`
and the JobScheduler notification job's at `background.rs:84` (both `Db::open`, the second under
`#![cfg(target_os = "android")]`, background.rs:23) — and both run the full migration ladder. The
five `ALTER TABLE ADD COLUMN` steps decide whether to run by calling `has_column` (db.rs:499-507)
*outside* the transaction that then performs the ALTER. That is a check-then-act across a shared
resource.

Expected Behavior:
Two connections racing an upgrade should serialise: one migrates, the other observes the finished
schema and continues.

Actual Behavior:
Both read `user_version = 15` and both see `has_column(notifications, "media_id") == false`.
A calls `apply(15, MIGRATION_V15)` and commits. B calls the same; its `BEGIN` is deferred, so it
acquires the write lock only at the `ALTER`, waits out A's lock via the 5 s `busy_timeout`
(db.rs:521), then re-prepares against the changed schema cookie and the ALTER fails with a
duplicate-column error. `apply` maps that to `Err("Migration v15 failed: …")`, `Db::open` returns
`Err`, and if the loser is the app then `lib.rs:356-359` turns that into a failed `setup` — the app
does not start (see A4-22). If the loser is the job, that notification pass silently does nothing.

A second consequence follows from the same shape: `version` is read once (db.rs:525) and every
`apply` stamps an *absolute* `PRAGMA user_version`, so the losing connection can also stamp the
version **backwards** — writing 9 after the winner wrote 17. That is self-healing only because
every step below the ALTERs is `CREATE TABLE IF NOT EXISTS` and the ALTERs carry the `has_column`
probe.

Reproduction:
Android, app updated from a build at schema ≤ 16 to one at 17. A `NotifJob` fires (its interval is
user-configured, `alerts::site::INTERVAL_KEY`) while the user cold-starts the updated app, such
that both `Db::open` calls interleave inside the same missing-column window.

Impact:
One failed launch, or one skipped background notification pass, on the single launch after an
upgrade. Self-limiting: whichever side won has already advanced `user_version`, so the next launch
takes the `has_column == true` branch. No data is lost. "The app will not open after the update"
is still the most alarming failure a tracker can present, and the log line is the only clue.

Root Cause:
`has_column` is queried outside the `apply` transaction, so its answer can be stale by the time the
DDL executes. The `busy_timeout` comment at db.rs:517-521 identifies the two-connection situation
correctly but treats it purely as a lock-wait problem, not a TOCTOU one.

Recommended Fix:
Wrap the whole ladder in one `BEGIN IMMEDIATE` so the losing connection blocks at the start and
re-reads `user_version` after the winner commits — this fixes the backwards-stamp as well. A
narrower version is `BEGIN IMMEDIATE`, then `pragma_table_info`, then the ALTER, inside each guarded
step. Alternatively, treat a duplicate-column error from an ALTER as success when `has_column` is
true on retry.

Regression Tests Required:
A test that opens two `Connection`s on the same temp-file database at `user_version = 15` and
drives both through the v16 branch (a second thread, or a manual `BEGIN IMMEDIATE` on connection B
to force the interleave), asserting both `Db::open` calls return `Ok` and the final version is 17.

Confidence: MEDIUM
Verification: downgraded from P2 — the reachable window is one ALTER wide, on the single launch
after an upgrade, with the JobScheduler job firing in the same milliseconds; the outcome is one
failed launch or one skipped notification pass and no data is lost.
(The interleaving and the guards are read directly from the code; what is inferred rather than
observed is SQLite's exact response — re-prepare then duplicate-column — since Android-only code
cannot be executed here. The finding stands either way: if SQLite instead returned `SQLITE_SCHEMA`
to the caller, `apply` would still fail.)

---

ID: A4-20
Severity: P3
Category: PERFORMANCE PROBLEM

File: src-tauri/src/library.rs
Line: 932-957 (`set_library_match`), 1096-1132 (`set_library_redirect`), 1141-1197 (`clear_library_redirect`), 1206-1258 (`clear_library_match`); `persist` at 663-673
Function: `set_library_match`, `set_library_redirect`, `clear_library_redirect`, `clear_library_match`

Problem:
All four library-correction commands are plain `#[tauri::command]`s. This file states the
consequence itself at library.rs:388-394, as the reason `scan_library` is `#[tauri::command(async)]`:
"`tauri-macros` defaults a plain `#[tauri::command]` to `ExecutionContext::Blocking`, which runs
the body inline on the WebView2 UI thread." Each of the four ends in `persist`, a
delete-and-reinsert of the entire index across two transactions.

Expected Behavior:
Confirming one correction in a dialog should not freeze the window while the whole library index is
rewritten.

Actual Behavior:
Every one of the four runs on the UI thread and ends at `persist` (library.rs:671-672), which calls
`library_replace_all` (`DELETE FROM library_files`, up to `MAX_FILES` = 20,000 inserts, `DELETE FROM
library_match`, one insert per matched title — db.rs:1180-1212) and then
`library_replace_unmatched` (db.rs:1477-1500), holding the `Db` mutex against every background
writer for both. Two of them add more on top: `set_library_redirect` runs `plan_redirect`, whose
overlap check is an O(members × files) sweep calling `reparse` — a five-regex
`parser::parse` — per file (library.rs:1043-1052); `clear_library_redirect` calls `reparse` once
per same-parse file in the fallback search and again in the fix-up loop (library.rs:1157-1188).

Reproduction:
With a large library indexed, accept a suggestion or confirm a season split in the Library pane.
The window stops repainting for the duration of the index rewrite.

Impact:
A visible freeze proportional to library size on a single-click correction, plus the scrobbler and
the three alert passes blocked behind the same mutex for the same interval. No correctness impact.
Strictly worse bounds than A4-10, which is the same defect on a much smaller body of work.

Root Cause:
The `async` fix was applied to `scan_library`, where the cost was first noticed, and not to the four
commands that end in the same `persist`.

Recommended Fix:
`#[tauri::command(async)]` on all four, matching `scan_library`. They take `AppHandle` and
`State` and hold no `MutexGuard` across an await, so the change is mechanical.

Regression Tests Required:
None mechanical. The house pattern is the doc comment at library.rs:388-394; extending it to name
all five commands is what pins the decision.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-05
Severity: P4
Category: DATA INTEGRITY RISK

File: src-tauri/src/db.rs
Line: 528-618 (the ladder), 808-810 (`queue_all`), 836-842 (`queue_remove_for`), 862-869 (`queue_len`)
Function: `Db::open`, `Db::queue_all`, `Db::queue_len`, `Db::queue_remove_for`

Problem:
`Db::open` has no guard against a database whose `user_version` is *ahead* of the versions the
binary knows. An older binary opens a v17 database silently and then writes `offline_queue` rows
with `user_id = NULL` — rows the current binary can never see again, because V16's backfill only
ever runs once.

Expected Behavior:
Either refuse to open a database from the future with a message the user can act on, or make the
attribution self-healing so orphaned rows are re-attributed on the next upgrade.

Actual Behavior:
The ladder is `if version < N { apply(…) }` throughout (db.rs:528-615). With `version = 17` every
branch is skipped and `Ok(Db(...))` is returned. A pre-v16 binary's `queue_push` inserts
`(kind, payload, created_at)` and leaves `user_id` NULL. When the newer binary runs again, `version`
is already 17, so `MIGRATION_V16`'s `UPDATE`/`DELETE` never fires. Every reader filters
`WHERE user_id = ?` (`queue_all` db.rs:808-810, `queue_remove_for` db.rs:836-842, `queue_len`
db.rs:862-869) and NULL matches no value — so the rows are invisible to the drain, to the pending
badge, to `sync_status` and to `discard_queued_edit`, and they accumulate forever.

Reproduction:
Install a build at schema 17; install an older build over the same data directory; make an offline
edit there; reinstall the current build without the older build having drained its own queue. That
edit is in `offline_queue` and unreachable by every code path.

Impact:
Silent, permanent loss of unsynced edits plus a monotonically growing table.

Root Cause:
No forward-compatibility check on `user_version`, combined with a one-shot backfill.

Recommended Fix:
Refuse to open when `user_version > 17` with a clear message ("this database was written by a newer
Karasu"), which prevents the write from happening at all. Independently, V16's `UPDATE`/`DELETE`
could be made re-runnable at every open — it is idempotent for non-NULL rows — which would heal
orphans on the way back up.

Regression Tests Required:
`Db::open` on a database stamped `PRAGMA user_version = 99` returns `Err`. A second test that
inserts a `user_id IS NULL` row into a v17 database and asserts it is either attributed or removed
on the next open.

Confidence: HIGH
Verification: downgraded from P3 — the loss needs all three of an older binary over the same data
dir, an edit queued *in* that older build, and that edit still pending on return to the current
build; the old build's own drain (`process_queue`, commands/list.rs:941/951) is unfiltered and
clears its rows on the next successful list fetch. The original "two portable copies beside one
`data/` folder" path is not reachable — `portable_data_dir()` is exe-relative (portable.rs:83-85),
so two copies in different folders never share a data dir.

---

ID: A4-08
Severity: P4
Category: DATA INTEGRITY RISK

File: src-tauri/src/db.rs
Line: 756-784 (with `cached_list` at 744-752, `cache_list` at 682-697, `commands/list.rs:278`)
Function: `Db::update_cached_progress`

Problem:
The scrobbler's cache patch is a read-modify-write across two separate mutex acquisitions, with a
full JSON parse and re-serialisation in between. A concurrent full cache write from
`fetch_media_list` inside that window is silently discarded.

Expected Behavior:
The last committed cache reflects the newest information, not whichever writer finished second with
the oldest copy.

Actual Behavior:
`cached_list` takes the lock, reads and releases it; the parse, patch and re-serialise hold no lock
at all; `cache_list` then takes the lock again and does an unconditional whole-payload upsert
(db.rs:682-697). If `fetch_media_list` writes a freshly fetched list at `commands/list.rs:278`
between the read and the write, that fresh list is replaced by the stale snapshot plus one patched
entry.

Reproduction:
A scrobble completes (`playback/scrobbler.rs:759`) at the same moment a list fetch returns. The
window is the parse + mutate + serialise of the whole list, which for a large account is tens of
milliseconds.

Impact:
The list cache reverts to a stale snapshot. That cache feeds `candidates_from_cache` (the
scrobbler's matching and the library scanner's candidate set), the three alert passes, the
home-screen widget projection (`widgets.rs:215`) and `prefs.rs:212`, so other entries' progress can
appear to go backwards in detection and in the widgets until the next fetch. Self-healing on the
next `fetch_media_list`; no AniList data is affected.

Root Cause:
Read-modify-write without a transaction, on a value another code path replaces wholesale.

Recommended Fix:
Do the patch inside one transaction (`BEGIN IMMEDIATE`, `SELECT`, `UPDATE`), so the read and the
write cannot straddle another writer. The `Transaction` pattern already used by
`library_replace_all` applies directly.

Regression Tests Required:
A `mem_db()` test asserting `update_cached_progress` is implemented as a single transaction (via a
helper), since the race itself is not deterministically reproducible in a unit test.

Confidence: HIGH
Verification: downgraded from P3 — the lost write is a cache, it self-heals on the next
`fetch_media_list`, no AniList data is affected, and the interleave requires a scrobble completion
to land inside one list-fetch write. (Two lock acquisitions, not three — the parse holds none.)

---

ID: A4-07
Severity: P4
Category: DATA INTEGRITY RISK

File: src-tauri/src/library.rs
Line: 1118-1123
Function: `set_library_redirect`

Problem:
`plan_redirect` deliberately computes the whole change up front — deletes, trimmed remnants and new
rules — precisely so the decision is atomic and testable. The application throws that away: the
deletes and inserts execute as individual autocommitted statements, deletes first.

Expected Behavior:
An atomically-planned change is applied atomically. A failure leaves the previous split rules
exactly as they were.

Actual Behavior:
```
for (title, season, ep_from) in &plan.delete { db.library_redirect_clear(...)?; }
for r in &plan.insert            { db.library_redirect_set(...)?;   }
```
Each call is its own statement (`library_redirect_set` db.rs:1380, `library_redirect_clear`
db.rs:1405). An error or a crash after the deletes and before or during the inserts leaves the
overlapped rule deleted and its trimmed remnants unwritten. Because `plan.delete` runs first, the
loss window covers the entire insert loop.

Reproduction:
A three-cour folder with an existing split covering disk 13–36, then a second split of the
current-frame 13–24 (the `splitting_a_renumbered_row_targets_the_right_files_and_trims` scenario at
library.rs:1699). Interrupt after `library_redirect_clear` and before the `library_redirect_set`
calls: `library_redirect` holds neither the old rule nor the new ones, and the next scan re-merges
every episode onto the first season.

Impact:
Loss of user-confirmed season splits — data the schema comment explicitly calls "User data: a scan
must never clear it" (db.rs:195-196). The user re-confirms every split on the affected parse.

Root Cause:
No transaction spanning the plan's application; the `Db` helpers are per-row.

Recommended Fix:
Add `Db::library_redirects_apply(&plan.delete, &plan.insert)` that opens one transaction and does
both loops inside it, mirroring `library_replace_all`'s shape.

Regression Tests Required:
A `mem_db()` test that a failure during the insert loop leaves the pre-existing rules intact.

Confidence: HIGH
Verification: downgraded from P3 — the window is three or four single-row statements with no I/O of
consequence, reaching it needs a crash or disk error inside it, and what is lost is a user
confirmation redoable in two clicks rather than stored content. The one-transaction fix is still
the right shape.

---

ID: A4-06
Severity: P4
Category: DATA INTEGRITY RISK

File: src-tauri/src/library.rs
Line: 663-673
Function: `persist`

Problem:
One scan's result is written as two independent transactions. `library_replace_all` and
`library_replace_unmatched` are each atomic on their own, but the logical operation "publish this
scan" is not.

Expected Behavior:
`library_files` + `library_match` + `library_unmatched` describe one scan or the previous one, never
a mixture. This is the same reasoning `library_replace_all`'s own doc comment gives for putting
`scores` in the same transaction as `rows` (db.rs:1174-1177).

Actual Behavior:
`db.library_replace_all(&rows, &score_rows)?` commits (db.rs:1180-1212), then
`db.library_replace_unmatched(...)` opens a second transaction (db.rs:1477-1500). A crash, a power
loss or an error return between them leaves the *new* matched index beside the *previous* scan's
unplaced list. `hydrate` (library.rs:832-905) then builds `files` from `db.library_all()`
(library.rs:834) concatenated with `db.library_unmatched()` (library.rs:878) with no
reconciliation, so a path that is now matched and was previously unplaced appears twice — once
placed, once in the unplaced group — and the user is offered a correction for files already indexed.

Reproduction:
Kill the process between the two calls, or induce a disk-full on the second. Restart: the Library
screen shows entries in both the matched table and the unplaced list.

Impact:
A confusing, self-inflicted inconsistency that survives restarts until the next successful scan.
No user data is destroyed — `library_override`, `library_redirect` and `library_suggestion` are
untouched — and correcting a duplicated group is harmless but pointless.

Root Cause:
The transaction boundary sits at the table level rather than the operation level, and the two `Db`
helpers each own their own transaction so a caller cannot compose them.

Recommended Fix:
Add a single `Db` method taking rows, scores and unmatched, writing all three `DELETE`s and all
inserts in one transaction; `persist` calls that. The suggestions table is genuinely separate — it
is written after an `await` — and can stay as it is.

Regression Tests Required:
A test that a failing insert in the unmatched half leaves `library_files` unchanged, i.e. that the
whole publish rolls back.

Confidence: HIGH
Verification: downgraded from P3 — the trigger is a crash or a SQLite write error precisely between
two transactions, the consequence is a confusing display rather than lost data, and any successful
rescan repairs it.

---

ID: A4-26
Severity: P4
Category: DATA INTEGRITY RISK

File: src-tauri/src/library.rs
Line: 548-557
Function: `scan_library`

Problem:
The scan's two `kv` hints — `identify_cursor` and `library_files_seen` — are written after
`persist` and `library_replace_suggestions` as two further autocommitted statements, outside every
transaction the scan used to publish its result.

Expected Behavior:
The numbers describing a scan land with the scan they describe, or not at all.

Actual Behavior:
```
persist(&db, &data)?;                                    // two transactions
db.library_replace_suggestions(&suggestions)?;           // a third
db.kv_set("identify_cursor", &next.to_string())?;        // autocommit
db.kv_set("library_files_seen", &total.to_string())?;    // autocommit
```
(library.rs:548-556). A failure at library.rs:553 or 556 aborts the command with the new index
already committed and `library_files_seen` still holding the previous scan's count — which is the
number `get_library_status` renders and the number A4-03's guard reads on the *next* scan as
`previously_indexed`'s companion. A failure between the two leaves the identify cursor advanced
against a `library_files_seen` that was not.

Reproduction:
Induce a write error (disk full) on either `kv_set` after a successful `persist`. The Library pane
reports the old file count beside the new index.

Impact:
A wrong "files seen" number on the status row until the next successful scan, and an identify
cursor that may skip or repeat one window of unplaced titles. Nothing the user typed is lost. Same
class as A4-06 and adjacent to it in the same function.

Root Cause:
The publish step grew from one transaction to five statements over time, and the two hints were
appended outside all of them.

Recommended Fix:
Fold the two `kv_set`s into the same transaction that the composed `persist` fix (A4-06) introduces,
so one scan publishes as one commit.

Regression Tests Required:
Covered by A4-06's test if the composition includes the hints; otherwise a `mem_db()` test that a
failure writing `library_files_seen` leaves `library_files` unchanged.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-11
Severity: P4
Category: BUG

File: src-tauri/src/library.rs
Line: 1386 (`collect_videos`), 713-715 (`index_files`), 1319 (`open_path`)
Function: `collect_videos`, `index_files`, `open_path`

Problem:
Paths are stored as `path.to_string_lossy().to_string()`. On Linux a filename is an arbitrary byte
string; any non-UTF-8 byte becomes U+FFFD, and the stored path then names a file that does not
exist. The index keeps the mangled path forever and every rescan reproduces it.

Expected Behavior:
A file the scanner walked past is a file the play button can open.

Actual Behavior:
`collect_videos` pushes the lossy string into `out` (library.rs:1386); `index_files` does the same
for the filename it parses (library.rs:713-715); `persist` writes it to `library_files`; `open_path`
does `if !Path::new(path).exists()` (library.rs:1319) which is false and returns "That file is no
longer on disk — rescan your library". Rescanning produces the identical mangled path, so the
message is both wrong and un-actionable.

Reproduction:
On Linux, create a file whose name contains an invalid UTF-8 byte (a latin-1 byte, common in files
unpacked from old archives). Scan; the episode appears in the index; pressing play reports it is no
longer on disk, permanently.

Impact:
A permanently dead play button with a misleading error, bounded to the offending files. Nothing is
corrupted.

Root Cause:
The index is typed `String` end to end rather than `PathBuf`/`OsString`, so lossy conversion is
forced at the walk.

Recommended Fix:
Skip files whose path is not valid UTF-8, with a `logging::warn` so they are at least reportable —
that turns a dead button into a file that was never claimed. Storing bytes and converting only for
display is the larger alternative.

Regression Tests Required:
A Linux-gated test that a path with an invalid UTF-8 byte is not added to the index (CI's
`linux-build` job, per the house rule about Linux-only code).

Confidence: HIGH (mechanism), MEDIUM (how often a real library contains such a name)
Verification: downgraded from P3 — bounded to Linux filenames containing invalid UTF-8, it degrades
to an error message rather than corrupting anything, and it affects only the offending files.

---

ID: A4-09
Severity: P4
Category: ENHANCEMENT

File: src-tauri/src/library.rs
Line: 717
Function: `index_files`

Problem:
`let Some(episode) = parsed.episode else { continue };` drops every file whose filename carries no
episode number. For a series that is the right call (an OP/ED/extra), but it also excludes the
whole class of single-file media — films, OVAs, specials released as one file — which have no
episode number by nature and are ordinary AniList entries with `episodes: 1`.

Expected Behavior:
A film on the user's list, present on disk, gets a play button like everything else — or at least
appears in the unplaced list where the user can assign it.

Actual Behavior:
The file leaves the pipeline at library.rs:717, before the matcher and before the unplaced
grouping. It is not in `library_files`, not in `library_unmatched`, not in `ScanSummary.matched`,
and not counted anywhere except the raw `files` total. `parser::parse` genuinely yields
`episode: None` for a film — the bracket strip (parser.rs:84-88) removes `(2016)`/`[1080p]` and the
trailing-number rule explicitly rejects 1950–2030 (parser.rs:107-109).

Reproduction:
Put a single-file film in the library folder with that film on the AniList list, and scan. The
Library screen shows nothing for it; the film's detail page has no play affordance.

Impact:
An entire media category is invisible to the local-library feature. The workaround is renaming each
file to include an episode number, which the user has no way of knowing.

Root Cause:
Episode number is the identity of a library row — `library_files` is keyed `(media_id, episode)`
(db.rs:95-100) — so a file without one has nowhere to go by construction.

Recommended Fix:
When `parsed.episode` is `None` *and* the matched candidate reports `episodes == Some(1)` (or the
format is a film), index it as episode 1. Failing that, route episode-less files into
`library_unmatched` with `episode = 0` so they are visible and assignable.

Regression Tests Required:
A test that a single-file film matching a one-episode candidate is indexed at episode 1, and that
an episode-less file matching a 28-episode candidate is still skipped, so OP/ED extras do not
regress.

Confidence: HIGH
Verification: downgraded from P3 and reclassified as an enhancement — the skip is a deliberate
decision pinned by `files_without_an_episode_are_skipped` (library.rs:1761-1768), whose comment
says "Skipped means skipped: no episode number is not the same as an unplaced episode, and it must
not turn up in the list to be assigned", and the schema keys a library row on `(media_id, episode)`.
This is a capability the feature does not have, not a defect in what it does.

---

ID: A4-12
Severity: P4
Category: BUG

File: src-tauri/src/library.rs
Line: 326-330
Function: `set_library_path`

Problem:
`set_library_path` is the only library-mutating command that does not consult the scan flag
(`LibraryIndex.1`). The other five all do: library.rs:404 (`scan_library`), 940
(`set_library_match`), 1109 (`set_library_redirect`), 1146 (`clear_library_redirect`), 1210
(`clear_library_match`).

Expected Behavior:
Consistent with the flag's stated purpose — "a lock on the *conclusion*" (library.rs:213-217) —
changing the input a running scan is drawing conclusions about should be refused too.

Actual Behavior:
The path is written mid-scan by a bare `kv_set`. `scan_library` captured `root` at library.rs:412,
so it finishes and publishes an index for the *old* folder plus a `library_files_seen` count for the
old folder, while `get_library_status` (library.rs:310) reports the *new* path beside those numbers
and every play button points into the old tree.

Reproduction:
Start a scan of a large folder, then pick a different folder in Settings before it finishes.

Impact:
A misleading status row and stale play targets until the next scan — which the user will run anyway
after changing the folder. No corruption: the tables are replaced wholesale on the next scan and no
user data is involved.

Root Cause:
The gate was added to the five commands that write index tables and not to the one that writes the
setting they read.

Recommended Fix:
Add the same `state.1.load(Ordering::Acquire)` check and the same error string.

Regression Tests Required:
None beyond the existing pattern; a command-level assertion would need Tauri state.

Confidence: HIGH

---

ID: A4-13
Severity: P4
Category: IMPROVEMENT

File: src-tauri/src/db.rs
Line: 328
Function: `MIGRATION_V16`

Problem:
`DELETE FROM offline_queue WHERE user_id IS NULL` discards queued edits with no log line, no count
and no notification. The decision itself is documented and correct (db.rs:316-322) — an
unattributable queued write is exactly the hazard v16 closes, and clearing the queue on logout would
have been worse. This is filed only as an improvement to the *reporting*.

Expected Behavior:
The app already has a vocabulary for "a queued edit was thrown away": `report_dropped`
(`commands/list.rs:958-975`) raises a bell row precisely because otherwise "the row is gone, the
pending badge falls to zero, and the list simply does not contain the change". The migration
performs the same class of loss and says nothing.

Actual Behavior:
The rows disappear during `Db::open`. The user who hits this — signed out with a pending queue at
upgrade time, which `anilist_logout` (commands/auth.rs:207-210) makes reachable by deleting the
token and the viewer blob while leaving the queue standing — sees a pending badge of zero and no
explanation.

Reproduction:
Queue an edit offline, sign out, upgrade past schema 16.

Impact:
Silent loss of edits the user typed, bounded by how rare "signed out with a non-empty queue" is.

Root Cause:
`Db::open` runs before any notification machinery exists, so the migration cannot itself raise a
bell row.

Recommended Fix:
Have the migration count the affected rows first and stash the number in a `kv` key that `lib.rs`'s
setup reads once, after `notify` is available, to raise a single bell row. At minimum
`logging::warn` the count — `logging::init` already runs before `Db::open` (lib.rs:355), so a log
line is available today at no cost.

Regression Tests Required:
A `mem_db()`-style test that the count of deleted rows is recorded where the app can find it.

Confidence: HIGH

---

ID: A4-23
Severity: P4
Category: BUG

File: src-tauri/src/commands/system.rs
Line: 238-241 (the doc comment), 272-273 (the ordering)
Function: `enable_portable`

Problem:
The doc comment states the function's failure guarantee: "Done in this order, a failure leaves an
unused folder and nothing else." That is true of the database but false of the token.
`migrate_to_portable_file()` (system.rs:272) runs *before* `create_marker()` (system.rs:273), and it
deletes the credential-store entry as its last step.

Expected Behavior:
A failed `enable_portable` leaves the install exactly as it was — still signed in, still not
portable.

Actual Behavior:
If `create_marker()` fails, the token has already been written to the portable file and removed
from the credential store (auth.rs:128-136), while `is_portable()` stays false. The next
`load_token()` reads the credential store (auth.rs:35-42) and finds nothing: the user is signed out
*and* not portable, with the token sitting in a file no code path in this mode will read. The UI
reports the error as "it did not work", which is precisely the misreading the comment's ordering
rationale was written to prevent.

Reproduction:
Make the exe directory writable enough for `create_dir_all(&dest_dir)` (system.rs:251) and the
snapshot to succeed but not for the marker write — or induce a disk-full between the two. Restart:
signed out, still on AppData. The common permission-denied case is caught earlier by
`create_dir_all` and does not reach here, which is why the window is narrow.

Impact:
The same silent sign-out as A4-21, reached from a much rarer trigger, plus a doc comment that
asserts a guarantee the code does not provide.

Root Cause:
The marker was moved last to fix the database half of the ordering problem; the token migration was
left ahead of it and inherits the original hazard.

Recommended Fix:
Write the marker before the token migration and roll the marker back if the migration fails, or —
cleaner — make the token migration itself two-phase: write the portable file, create the marker,
then delete the credential entry. Either way, correct the doc comment to say what is actually
guaranteed.

Regression Tests Required:
A test of whatever ordering is chosen, asserting that a simulated marker-write failure leaves the
token still loadable. The token halves are desktop-gated, matching `auth.rs`.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-10
Severity: P4
Category: PERFORMANCE PROBLEM

File: src-tauri/src/commands/system.rs
Line: 599-612 (with src-tauri/src/backups.rs:95-149 and src-tauri/src/db.rs:711-716)
Function: `set_backup_settings` → `backups::run_once` → `Db::snapshot_to`

Problem:
`set_backup_settings` is a plain (non-`async`) `#[tauri::command]`, so by the rule this codebase
states at library.rs:388-394 its body runs inline on the WebView UI thread. It calls
`backups::run_once`, which does a `PRAGMA quick_check` over today's backup file, a whole-database
`VACUUM INTO`, a directory listing and up to N file deletes.

Expected Behavior:
Toggling a setting does not freeze the window for the duration of a full database copy.

Actual Behavior:
`run_once` returns early only when backups are *disabled* (backups.rs:96-98), so the enable path
always proceeds to `db.snapshot_to(&today)` — `VACUUM INTO`, which rewrites every page of
`karasu.db` — synchronously on the UI thread while holding the `Db` mutex against every other
writer. The list cache is stored uncompressed (`commands/list.rs:20` notes as much), so the
database is comfortably multi-megabyte for an ordinary account.

Reproduction:
Settings → toggle daily backups on. The window stops repainting until the copy finishes.

Impact:
A one-off freeze on an explicit user action, bounded by database size — tens to a few hundred
milliseconds for a few megabytes — plus every background writer blocked behind the same mutex for
the same interval. No correctness impact.

Root Cause:
The command is not `async`, so it does not go to the blocking pool; the same defect `scan_library`
was already fixed for.

Recommended Fix:
`#[tauri::command(async)]` on `set_backup_settings`, or spawn `run_once` into the async runtime and
return immediately — the backup's result is already reported only through the log.

Regression Tests Required:
None mechanical; the doc comment at library.rs:388-394 is the place the decision is pinned.

Confidence: HIGH
Verification: downgraded from P3 — a one-off freeze on an explicit user action with no correctness
impact, and the *least* severe instance of this pattern; A4-20 covers the four commands with far
worse bounds.

---

ID: A4-24
Severity: P4
Category: PERFORMANCE PROBLEM

File: src-tauri/src/library.rs
Line: 832-905 (called from src-tauri/src/lib.rs:384)
Function: `library::hydrate`

Problem:
`hydrate` is called synchronously from the `setup` closure (lib.rs:384), before the window exists,
and re-parses every stored library path with `reparse` → `parser::parse` (five regexes) once per
row.

Expected Behavior:
Restoring an index that is already on disk should not add a parse pass over the whole library to
the pre-window startup path.

Actual Behavior:
`hydrate` reads `db.library_all()` (library.rs:834) and, for each row, calls `reparse(&path)`
(library.rs:846) to recover the `(title, season, disk episode)` the row was built from — deliberate,
since a stored copy "could only ever drift away from what the parser says today" (db.rs:143-146) —
and then tests every redirect rule against it. At the `MAX_FILES` bound that is up to 20,000
five-regex parses plus 20,000 × |rules| rule applications, all on the setup thread with the `Db`
mutex taken and released per accessor. Nothing bounds it further and nothing measures it.

Reproduction:
Static, and observable on any large indexed library: the delay between launching and the window
appearing grows with the number of indexed files.

Impact:
Measurable pre-window startup latency proportional to library size, on every launch. No correctness
impact — the re-derivation itself is the right design.

Root Cause:
The correct decision not to store the parse was taken without moving the cost off the startup path.

Recommended Fix:
Move `hydrate` off the setup closure — spawn it on the blocking pool and let the index arrive a beat
after the window, the way the widget projection at lib.rs:392-400 already does — or cache the
parsed triple in memory across the two passes it is currently computed for.

Regression Tests Required:
None mechanical. If `hydrate` becomes asynchronous, a test that `get_library_index` returns empty
rather than erroring before hydration completes.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-25
Severity: P4
Category: PERFORMANCE PROBLEM

File: src-tauri/src/backups.rs
Line: 151-161
Function: `backups::spawn`

Problem:
The hourly backup loop calls the fully blocking `run_once` directly inside its `async` body rather
than through `spawn_blocking`, so the `VACUUM INTO`, the `quick_check` and the directory IO all
occupy a tokio worker thread.

Expected Behavior:
Blocking file and database work inside an async task goes to the blocking pool.

Actual Behavior:
```
loop {
    run_once(&app);
    tokio::time::sleep(Duration::from_secs(60 * 60)).await;
}
```
(backups.rs:154-158). `run_once` (backups.rs:95-149) performs `create_dir_all`, an
`is_readable_database` open plus `PRAGMA quick_check` (backups.rs:82-90), `Db::snapshot_to`'s
whole-database `VACUUM INTO` (db.rs:711-716) under the `Db` mutex, a `read_dir` and up to N
`remove_file` calls — none of it yielding.

Reproduction:
Static. The hourly pass occupies one runtime worker for the duration of a full database copy.

Impact:
One tokio worker is unavailable for the length of a `VACUUM INTO` once per hour. Other async work on
the same runtime — the scrobbler's poll, the alert passes, in-flight AniList requests — is delayed
if it happens to be scheduled on that worker. Bounded by database size and by the multi-threaded
runtime's worker count; no correctness impact.

Root Cause:
`run_once` is shared with `set_backup_settings`, where it is called from a synchronous context, so
it was written blocking and reused as-is in the async loop.

Recommended Fix:
`tokio::task::spawn_blocking` around the `run_once` call inside the loop, keeping `run_once` itself
synchronous for the settings call site. (`AppHandle` is `Send + Clone`, so this is mechanical.)

Regression Tests Required:
None mechanical.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-19
Severity: P4
Category: PERFORMANCE PROBLEM

File: src-tauri/src/library.rs
Line: 454-457
Function: `scan_library`

Problem:
`let previously_indexed = { db.library_all().len() };` materialises every row of `library_files` —
including the full path `String` for each — purely to obtain a count.

Expected Behavior:
`SELECT COUNT(*) FROM library_files`.

Actual Behavior:
`library_all` (db.rs:1226-1233) prepares `SELECT media_id, episode, path FROM library_files` and
collects `(i64, u32, String)` per row under the `Db` mutex for the whole `query_map`. At
`MAX_FILES = 20,000` that allocates 20,000 `String`s plus the tuple vector and drops them one
statement later.

Reproduction:
Static.

Impact:
Tens of milliseconds and a few megabytes of transient allocation per scan, and a mutex hold that
blocks the scrobbler and the alert passes for its duration. Negligible in absolute terms.

Root Cause:
Reuse of an existing accessor rather than a purpose-built count.

Recommended Fix:
Add `Db::library_file_count()` doing `SELECT COUNT(*)`.

Regression Tests Required:
None.

Confidence: HIGH

---

ID: A4-18
Severity: P4
Category: BUG

File: src-tauri/src/db.rs
Line: 155-161 (`library_unmatched` primary key), 1487-1490 (`INSERT OR REPLACE`)
Function: `MIGRATION_V9`, `Db::library_replace_unmatched`

Problem:
`library_unmatched` is keyed `(title, season, episode)` and written with `INSERT OR REPLACE`. Two
files that parse to the same title, season and episode — a dual-quality library holding
`Show - 01 [720p].mkv` and `Show - 01 [1080p].mkv` — collapse to one row, while the in-memory
`unmatched` group built by `reindex` (library.rs:139-142) holds both.

Expected Behavior:
The unplaced list shows the same thing before and after a restart.

Actual Behavior:
Immediately after a scan the group reports N files; after a restart `hydrate` rebuilds it from the
table and it reports fewer. Nothing warns. This mirrors the deliberate `(media_id, episode)` dedupe
on the matched side, where "the first path wins" is documented and tested
(`the_first_path_wins_for_a_duplicate_episode`, library.rs:1789) — but on the unmatched side it is
neither documented nor tested, and it changes a count the user can see.

Reproduction:
Two unmatched copies of the same episode in different subfolders; scan (group shows 2), restart
(group shows 1).

Impact:
Cosmetic. Correcting the group still places every file, because `set_library_match` operates on the
in-memory `files` list and `persist` dedupes identically either way.

Root Cause:
The primary key was chosen to mirror `library_files` without the same "first path wins" statement.

Recommended Fix:
Either add `path` to the primary key, or state the collapse in the migration comment and add the
matching test.

Regression Tests Required:
A `mem_db()` round trip asserting the documented behaviour, whichever is chosen.

Confidence: HIGH

---

ID: A4-15
Severity: P4
Category: MISSING TEST

File: src-tauri/src/library.rs
Line: 1066-1072
Function: `plan_redirect` (right-hand trim branch)

Problem:
The overlap trimmer has two branches. The left one (`if r.ep_from < d_min`, library.rs:1063-1065) is
exercised by `splitting_a_renumbered_row_targets_the_right_files_and_trims` (library.rs:1699). The
right one (`if r.ep_to > d_max`), including its non-obvious
`dst_start: r.dst_start + (d_max + 1 - r.ep_from)` re-basing, is never reached by any test.

Expected Behavior:
The branch that re-bases a destination start has a test, since a silent off-by-one there points
files at the wrong episode of the right show — which then scrobbles.

Actual Behavior:
No test produces a plan where an existing rule extends past `d_max`. Confirmed against every
`plan_redirect` call in the test module: library.rs:1681 asserts `plan.delete` is empty;
library.rs:1719 has `d_max == r.ep_to == 36`, so `r.ep_to > d_max` is false; library.rs:1753-1755
exercise error paths only.

Reproduction:
A four-cour folder split once as disk 13–48 → sequel, then a second split of the current-frame 1–12
of that sequel (disk 13–24) onto a third entry. `d_max = 24 < r.ep_to = 48`, so the right remnant
`(25, 48, dst_start = 1 + (25-13) = 13)` is produced — the branch with no coverage.

Impact:
None today. A regression here would re-point the tail of a chained split at the wrong episode
numbers, which `play_next` compares against AniList progress and the scrobbler writes.

Root Cause:
The chained-split scenarios the tests were written from all trimmed on the left.

Recommended Fix:
Add the four-cour test above, asserting the emitted `(ep_from, ep_to, media_id, dst_start)` for the
right remnant. `clear_library_redirect` (library.rs:1141-1197) is also entirely untested — its
`fallback` selection and the `was_governed`/`still_split` interplay are non-trivial — and is worth
covering in the same pass.

Regression Tests Required:
As described.

Confidence: HIGH
Verification: downgraded from P3 — this is a missing test over code independently verified correct.
Against `SplitRule::apply` (library.rs:61-67), which maps `e -> e - ep_from + dst_start`, the
remnant `{ep_from: d_max+1, dst_start: s + (d_max+1-a)}` yields `s + (d_max+1-a) + (e-(d_max+1)) =
s + (e-a)`, identical to the original rule. No defect exists today.

---

ID: A4-16
Severity: P4
Category: MISSING TEST

File: src-tauri/src/db.rs
Line: 1772-1820
Function: `a_database_left_mid_upgrade_still_opens`

Problem:
The half-migrated test covers the right set of steps — all five `ALTER TABLE` ones — but asserts
only that the database opens and reaches version 17. For v16 specifically, the
`has_column == true` branch skips the backfill *and* the DELETE entirely (db.rs:608-611), so the
test walks a path where a queued row would keep `user_id = NULL` and never asserts what happened to
the queue.

Expected Behavior:
The test that proves the recovery path works should also prove the recovery path does not leave
data in the state v16 exists to prevent.

Actual Behavior:
No `offline_queue` row exists in the fixture at all, so the assertion cannot be made. In practice
the skipped state is unreachable because `apply` is atomic — but the guard exists precisely for the
case where that assumption was once false, and the same reasoning would apply again if a future
`ALTER` step ever ships without one.

Reproduction:
N/A.

Impact:
None today. It is a gap in the proof, not a defect.

Root Cause:
The loop was written to test openability, not data outcomes.

Recommended Fix:
Insert a queued row before the v16 leg of the loop and assert it is either attributed or removed.

Regression Tests Required:
As described.

Confidence: HIGH

---

ID: A4-14
Severity: P4
Category: DOCUMENTATION ISSUE

File: src-tauri/src/db.rs
Line: 519-520
Function: `Db::open`

Problem:
The comment justifies staying off WAL with "Deliberately not WAL: `snapshot_to` encodes
rollback-journal assumptions." Read against `snapshot_to` itself (db.rs:699-716), that dependency is
not there. `snapshot_to`'s own argument is about why `std::fs::copy` is wrong — a database
mid-transaction is only consistent read together with its sidecar — and that argument holds
identically in WAL mode, where the sidecar is `-wal` instead of `-journal`. `VACUUM INTO` is the
answer in both modes and is journal-mode independent.

Expected Behavior:
A comment asserting what a mechanism depends on should name a dependency that exists — the house
rule at CLAUDE.md ("A comment asserting what a dependency cannot do needs rechecking") is the same
idea.

Actual Behavior:
A future reader evaluating "should we move to WAL for concurrency?" will check `snapshot_to`, find
nothing journal-specific, and conclude the comment is stale — when there *is* a good reason to stay
on the rollback journal that the comment does not give: the documented manual restore flow.
`open_backup_dir` (commands/system.rs:578-583) tells the user that restoring means replacing
`karasu.db` with one of these files while the app is closed. In WAL mode a `karasu.db-wal` left
behind by an unclean shutdown would be replayed on top of the restored file, silently undoing or
corrupting the restore.

Reproduction:
N/A — documentation.

Impact:
None at runtime. The risk is that the decision gets revisited on a false premise.

Root Cause:
The reason was attributed to the wrong function.

Recommended Fix:
Restate the comment in terms of the manual-restore flow, and of Android's second connection, and
drop the claim about `snapshot_to`.

Regression Tests Required:
None.

Confidence: MEDIUM
(HIGH that `VACUUM INTO` is journal-mode independent — documented SQLite behaviour, and nothing in
`snapshot_to` reads a journal file. MEDIUM only in that a subtlety the maintainer measured and did
not write down cannot be ruled out.)

---

ID: A4-17
Severity: P4
Category: INVESTIGATION

File: src-tauri/src/db.rs
Line: 327
Function: `MIGRATION_V16`

Problem:
Whether the `kv['anilist_viewer']` JSON shape was stable across **all** historical versions that
could be upgrading is provable for everything this checkout contains, and no further.

Expected Behavior:
A backfill reading a historical blob shape should be checkable against the history of the writer.

Actual Behavior:
`git rev-list --count HEAD` is 51 with a single root commit `c0a95d0`, which is a squash containing
the entire project and already writes `db.kv_set("anilist_viewer", &viewer.to_string())` with
`viewer = data["Viewer"]` — the current top-level-`id` shape. The pre-squash history is not in this
repository, so an earlier envelope shape (`{"data":{"Viewer":{…}}}` or `{"Viewer":{…}}`) cannot be
excluded from the record alone. If one ever existed, `json_extract(value,'$.id')` returns NULL for
those installs and the `DELETE` at db.rs:328 takes their whole queue.

Reproduction:
N/A — this is a records question, not a behaviour.

Impact if the concern were real:
An upgrading install from a pre-squash build would lose its entire offline queue even while signed
in, a much wider blast radius than the signed-out case the migration reasons about.

Root Cause:
N/A — no defect is demonstrated.

Recommended Fix:
Optional belt and braces, free either way: widen the backfill to
`COALESCE(json_extract(value,'$.id'), json_extract(value,'$.Viewer.id'),
json_extract(value,'$.data.Viewer.id'))`.

Regression Tests Required:
If the widening is taken, a `mem_db()` test that each of the three shapes attributes correctly.

Confidence: LOW (that a problem exists) / HIGH (that the evidence is unavailable here)
Verification: downgraded — recorded as an open question rather than a defect. Every *runtime*
reader resolves the viewer through the same top-level `$.id` shape (`viewer_id` in
commands/list.rs, the scrobbler, `widgets.rs`, the alert passes), so a historical envelope shape
would have broken the app's own viewer resolution rather than only the migration — which makes an
undetected envelope-shaped blob implausible rather than merely unproven.

---

## Verified sound

Scenarios checked that **are** correctly handled, and the guard that handles each.

1. **Atomicity of one migration step** — `apply` (db.rs:493) wraps the DDL and the
   `PRAGMA user_version` in one transaction; SQLite makes both transactional, so a crash between
   them is impossible.
2. **A crash between two migration steps** — each `apply` is independent and `user_version` records
   progress, so the next open resumes at the right rung.
3. **Re-opening a database interrupted mid-`ALTER`** — the five `has_column` guards
   (db.rs:551/577/587/596/608) plus `a_database_left_mid_upgrade_still_opens` (db.rs:1772), which
   covers every non-re-runnable step. V14's three columns correctly let the first decide for all
   three, because they share one transaction.
4. **No half-open transaction escapes a failing step** — `execute_batch` returns `Err` with the
   transaction still open, every caller propagates with `?` out of `Db::open`, and dropping the
   local `Connection` rolls it back.
5. **`json_extract` availability for V16** — `Cargo.toml:84` pins `rusqlite = "0.40"` with
   `bundled`; `Cargo.lock` resolves `libsqlite3-sys 0.38.2`, whose bundled amalgamation is far above
   the 3.38 floor the comment cites. Verified, not assumed.
6. **V17's fresh-install signal** — `Db::open` is the only constructor of `Db` and the only writer
   of `kv`; the only other `Connection::open*` in the tree is `backups::is_readable_database`
   (backups.rs:82, read-only, against a *backup* file, `PRAGMA quick_check` only) and the test
   module. No path writes a `kv` row before the ladder runs. Both populations pinned by db.rs:1533
   and db.rs:1552. No "reset settings" command exists either: every `kv_delete` caller removes one
   named key (auth.rs:209, playback.rs:406-407, update.rs:74, update.rs:327).
7. **V17 re-runnability** — `WHERE NOT EXISTS (SELECT 1 FROM kv WHERE key='blur_adult')` never
   overwrites an explicit choice; `v17_leaves_an_explicit_choice_alone` runs it twice.
8. **V16's cross-account fix** — `queue_all` / `queue_len` / `queue_remove_for` all carry
   `WHERE user_id = ?`; `queue_push` requires a `user_id`; `queue_push_deduped`
   (commands/list.rs:826) refuses without a viewer. Pinned by
   `a_queued_edit_is_invisible_to_another_account` and `a_discard_only_removes_the_owners_row`.
9. **V16's DELETE is the right trade** — the reachable populations were enumerated: signed out with
   a non-empty queue (the case the migration exists for, and there is no safe alternative), a torn
   viewer blob (unreachable — `kv_set` writes `viewer.to_string()` in one statement), and a
   local-only profile (unreachable — local edits go through `local_save_entry`,
   commands/list.rs:605, never the queue). Only the *reporting* is filed, as A4-13.
10. **The scan replacing `library_files` + `library_match`** — `library_replace_all` (db.rs:1180) is
    one transaction, so the index can never survive without its confidences.
11. **`local_save_entry`'s COALESCE partial-write semantics** — an absent key becomes `None`;
    `fuzzy_date_text` (commands/list.rs:687) folds an explicit JSON `null` into `None` because the
    frontend's `?? null` idiom sends both spellings; the `VALUES` list supplies neutral defaults that
    apply only to a first insert, and `DO UPDATE` spells `COALESCE(?N, local_list.<col>)`. Clearing a
    date is `{"year":null,"month":null,"day":null}` — a present object — so it lands. Three tests pin
    it: db.rs:1826, 1894, 1940.
12. **FuzzyDate storage and every reader** — one parse point (`Db::fuzzy_date`, db.rs:1010), used by
    `local_list_json` and `local_all_entries`; on the frontend it is typed end to end
    (`api/types.ts:123`) and consumed as an object by `malExport.malDate`, `jsonImport.fuzzy`,
    `localStats.activityHeatmap`, `mergeDecision.someDate`, `receipt.ts`, `malImport.parseMalDate`
    and `wrapped.ts`. No reader anywhere assumes an ISO string.
13. **A rescan preserving user data** — `library_override`, `library_redirect` and confirmed
    suggestions all survive, because each scan write deletes only its own table. Pinned by
    `a_rescan_keeps_corrections_and_replaces_everything_else` (db.rs:1647) and
    `a_rescan_replaces_suggestions_but_never_corrections` (db.rs:1630).
14. **`index_files`'s documented order** — redirect rule → override → `best_match_prepared`
    (library.rs:719-742), matching CLAUDE.md; pinned by
    `a_split_beats_a_whole_key_override_inside_its_range` and
    `a_correction_outlives_the_scan_that_disagreed`.
15. **The scan-flag gate** — claimed by `compare_exchange` before the first early return and
    released by `ScanGuard::drop` (library.rs:404, 589), so the two early error paths cannot leave
    corrections refused forever. Honoured by all five index-mutating commands; the one gap is
    A4-12. The check-then-act window on the flag itself is harmless: a correction landing in it is
    overwritten in memory but its `library_override` / `library_redirect` row survives and `hydrate`
    re-applies it.
16. **`plan_redirect`'s display-frame vs disk-frame keying** — the command is keyed on the numbers
    the row displays and translates per file via `reparse` (library.rs:1008), which is the documented
    chained-split fix; pinned by `a_second_split_keys_on_what_the_row_shows` (library.rs:1658) and
    `splitting_a_renumbered_row_targets_the_right_files_and_trims` (library.rs:1699).
17. **`plan_redirect`'s overlap arithmetic** — both trim branches verified algebraically. The
    predicate `r.ep_from <= d_max && r.ep_to >= d_min` is the correct closed-interval test; the left
    remnant preserves the original mapping and `d_min - 1` cannot underflow (the branch requires
    `r.ep_from < d_min`); the right remnant's re-based `dst_start` reproduces the original mapping
    exactly and `d_max + 1 - r.ep_from` cannot underflow (the predicate guarantees
    `r.ep_from <= d_max`); and no primary-key collision is possible between the remnants and the new
    rule. Only the test coverage is filed, as A4-15.
18. **`plan_redirect`'s refusals** — the mixed-offset check (library.rs:1029-1035) and the "range
    overlaps files from another source" check (library.rs:1043-1052) prevent a rule from silently
    dragging unselected same-parse files along; the zero-match case errors rather than returning a
    silent `Ok` (library.rs:1019-1021, pinned by `a_split_matching_no_files_is_an_error`).
19. **The suggestion lifecycle** — nothing applies a suggestion without confirmation. `index_files`
    consults exactly three sources (redirects, overrides, the matcher) and `library_suggestion` is not
    among them; the accept button calls the ordinary `set_library_match` (`LocalLibrary.tsx:410`),
    which writes a `library_override`. The reason it must stay that way is pinned by
    `a_plausible_but_wrong_hit_is_still_only_a_suggestion` (identify.rs:273). The community-relations
    split hint is the same shape — `detect_overflow` (library.rs:806) only describes.
20. **Identify's request budget** — `.take(MAX_BATCHES)` (identify.rs:150) bounds a scan at 8
    requests regardless of file count; already-answered groups are filtered before the call
    (library.rs:501-505); the rotate-then-cap cursor (library.rs:514-521) makes the cap a window
    rather than a prefix, pinned by `successive_scans_ask_about_every_unplaced_title`
    (identify.rs:190). A second scan of an unchanged folder costs zero requests.
21. **Identify's query safety** — `matcher::normalize` reduces the interpolated title to
    alphanumerics and spaces, pinned by `a_quote_in_a_title_cannot_escape_the_query`
    (identify.rs:219); `Page(perPage:1)` rather than `Media(search:)` so one miss cannot 404 the whole
    batch.
22. **Stale `library_files` rows are pruned** — `library_replace_all` deletes the table first
    (db.rs:1189), so files deleted or moved between scans leave no residue; `open_path` re-checks
    existence (library.rs:1319).
23. **A wholly unreachable library root does not wipe the index** — the `read_dir` pre-check
    (library.rs:458-463) and the `total == 0` guard (library.rs:474), which correctly treats a
    still-mounted-but-empty mount point as a failure to look rather than an emptied library.
24. **Duplicate episodes on the matched side** — `or_insert_with` gives first-in-walk-order, pinned
    by `the_first_path_wins_for_a_duplicate_episode` (library.rs:1789).
25. **Notification retention** — trimmed on write to `NOTIF_KEEP = 500` (db.rs:483), pinned by
    `notifications_stop_at_the_retention_limit`; `notif_clear_kind` gives the update notice its exit.
26. **`kv_prune_older`'s `substr` instead of `LIKE`** — `_` is a LIKE wildcard and several prefixes
    contain one; pinned by `pruning_a_prefix_does_not_match_it_as_a_wildcard` (db.rs:1738).
27. **`kv_advance_max`'s compare-and-set** — the guard is in the `ON CONFLICT … WHERE` clause
    (db.rs:632), so two connections racing the notification cursor cannot both believe they moved it.
    This is the one place the Android two-connection case is handled correctly.
28. **Only one connection exists on desktop** — `Db(Mutex<Connection>)` (db.rs:8) handed to Tauri
    state at lib.rs:356; every accessor takes `self.0.guard()` for the duration of one statement or
    one `rusqlite::Transaction`. The mutex serialises everything before SQLite sees it, so
    `SQLITE_BUSY` is unreachable there and `busy_timeout` is for Android's second connection only.
29. **No `MutexGuard` is held across an `.await`** — enforced by `!Send`; `scan_library` explicitly
    snapshots the relations `RwLock` before the identify await (library.rs:487) and holds no index
    lock across it (library.rs:501-527).
30. **A poisoned `Db` mutex does not permanently disable the app** — `sync::LockExt::guard`
    (sync.rs:30), which is what lets `logging::supervise`'s restarted loops take the lock again;
    pinned by `a_poisoned_lock_still_hands_over_its_data`.
31. **Backups cannot capture a torn state** — `snapshot_to` takes the same mutex every writer takes
    (db.rs:711); `backups::spawn` (lib.rs:403) runs only after `Db::open` and `manage()`, so a
    mid-migration snapshot is impossible; a cross-connection writer needs an EXCLUSIVE lock, which
    cannot be taken while `VACUUM INTO`'s read transaction holds SHARED. A snapshot taken between a
    successful mutation and its `queue_remove` replays an absolute-value mutation, which is
    idempotent.
32. **A backup that is not a readable database is rewritten** — `is_readable_database` (backups.rs:82,
    `PRAGMA quick_check`) plus the remove-and-retry at backups.rs:117-133, so a truncated snapshot
    cannot occupy a retained slot.
33. **Backup retention** — `prune_candidates` (backups.rs:56) sorts `YYYYMMDD` as text
    (chronological) and touches only `is_backup_name` matches; three tests pin the name grammar and
    the keep-newest behaviour (backups.rs:171-199).
34. **`snapshot_over`'s atomic replace** — temp file plus same-directory rename, with cleanup on the
    failure path (db.rs:731-742); pinned by `a_snapshot_can_replace_the_database_already_there`. The
    companion test also pins that `VACUUM INTO` refuses an existing destination, which is what makes
    backups.rs's skip-if-present check load-bearing.
35. **`VACUUM INTO` with a bound parameter** — pinned by
    `a_snapshot_is_a_readable_database_with_the_same_rows`, which prevents a regression to string
    concatenation that would break on an apostrophe in a folder name.
36. **Local-list status validation at the import boundary** — `local_save_entry` does not validate
    `status`, but the only untrusted producer, `parseJsonExport`, checks it against `STATUSES`
    (jsonImport.ts:97) and clamps `scoreRaw`, `progress` and `repeat` (jsonImport.ts:123-127). No
    reachable caller can write an unknown status.
37. **Portable-mode `$APPIMAGE` handling** — `plausible_appimage` (portable.rs:29) requires an
    absolute existing path, which rules out both the inherited-env trap and the bare-name trap;
    pinned by `only_an_absolute_existing_appimage_is_believed`.
38. **`enable_portable` refuses to guess when a database is already beside the exe** — the
    `(true, None)` arm errors rather than adopting or clobbering (system.rs:266-271), which is the fix
    for the "came back on a months-old list" bug.
39. **The queue drain's retryable/permanent split** — a retryable error aborts and leaves the queue
    intact (commands/list.rs:942); only a permanent rejection removes a row, and that removal is
    reported through `report_dropped` into the bell.
40. **Drain re-entrancy** — `DRAIN.try_lock()` plus a separate `DRAINING` flag read by the status
    surface (commands/list.rs:869-882), so polling `sync_status` cannot itself cause a drain to skip.
41. **`queue_push_deduped`'s non-atomic read → delete → insert** — worst case is one redundant
    queued row, and replay is idempotent because the payloads are absolute values. Not a defect.
42. **Scan write cost is bounded and correctly shaped** — for `F` files yielding `P` distinct
    `(media_id, episode)` pairs, `M` matched media, `U` unplaced and `S` suggestions, a scan is
    ≈ `P + M + U + S + 6` statements in five transactions regardless of `F`. Batching is right; only
    the transaction *composition* is filed (A4-06, A4-26).
43. **The matcher runs once per distinct `(title, season)`, not per file** — including negative
    results, which is the expensive case (library.rs:738-743).

## Refuted during verification

No finding was refuted: every claim in the source report re-derived correctly from the code, and
the corrections were to severity, reachability and detail rather than to existence. The two that
came closest are recorded here because they are the boundary cases:

- **A4-09 (episode-less files are dropped)** — claimed as a bug at P3. Not a defect: the skip is a
  deliberate decision pinned by a test whose comment states it (library.rs:1761-1768), and
  `library_files`' `(media_id, episode)` primary key means a film has no representation by
  construction. Retained at P4 as an *enhancement* — a capability the feature does not have — not as
  a defect in what it does.
- **A4-17 (V16's `json_extract` shape across history)** — claimed as an open risk. No defect is
  demonstrated: every runtime reader resolves the viewer through the same top-level `$.id` shape, so
  a historical envelope-shaped blob would have broken the app's own viewer resolution long before the
  migration ever saw it. Retained at P4 as an INVESTIGATION with LOW confidence that a problem
  exists, because the suggested widening costs nothing.

Two sub-claims were corrected rather than dropped, and the corrections are carried in the findings
above: A4-03's unreadable directories *are* logged (`logging::warn`, library.rs:1368-1375), so the
partial-walk failure is not literally silent; and A4-04's depth example was off by one — the guard is
`depth > MAX_DEPTH` with the root at depth 0, so seven directory levels below the root are needed,
which is not ordinary, and the `MAX_FILES` half carries that finding on its own.

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 1 |
| P3 | 6 |
| P4 | 19 |
| **Total** | **26** |

Refuted during verification: 0.
