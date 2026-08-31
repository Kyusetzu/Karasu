# Local Library Audit

## Scope

The local-library feature end to end, as it exists at the audited tree: the folder setting,
the recursive walk, the parse/match pass, the identify pass, publication to SQLite, startup
hydration, and the four commands that let the user correct what the scanner concluded.

Files covered:

- `src-tauri/src/library.rs` — the scanner, `index_files`, `persist`, `hydrate`, `plan_redirect`,
  `open_path`, `collect_videos`, and the six library commands.
- `src-tauri/src/db.rs` — `library_files` (v6), `library_match` (v8), `library_override` and
  `library_unmatched` (v9), `library_suggestion` (v10), `library_redirect` (v11), and the
  `library_replace_*` writers.
- `src-tauri/src/identify.rs` — the AniList search pass for titles the local matcher cannot place.
- `src-tauri/src/lib.rs:384` — `library::hydrate` in `setup`.
- `src/pages/LocalLibrary.tsx` — the pane that renders the index, the unplaced list and the
  suggestion rows.

Sources: the local-library findings of the database audit and its adversarial verification, plus
the library-touching material in the scrobbling and detection audits. Every finding below was
re-derived from source for this report; verdicts from the verification pass have been applied,
and the verifier's own findings are promoted into the series at `A4-20` and above.

### What a rescan preserves, and what it rebuilds

Every scan is a **full** rescan; there is no incremental path. Each publishing write deletes only
its own table, which is what makes the split below hold.

| Table | Fate of a rescan | Where |
|---|---|---|
| `library_files` (v6) | rebuilt wholesale | `library_replace_all`, db.rs:1180 |
| `library_match` (v8) | rebuilt wholesale, in the same transaction as the files | db.rs:1180 |
| `library_unmatched` (v9) | rebuilt wholesale | `library_replace_unmatched`, db.rs:1477 |
| `library_suggestion` (v10) | replaced, but with the **union** of fresh answers and still-unplaced carried-forward ones | library.rs:534-543, db.rs:1446 |
| `library_override` (v9) | **never touched by a scan** | pinned by `a_rescan_keeps_corrections_and_replaces_everything_else`, db.rs:1647 |
| `library_redirect` (v11) | **never touched by a scan**; read at scan start and re-applied | `redirect_rules`, library.rs:602; consumed at library.rs:720-731 |

A confirmed suggestion is not a suggestion: `LocalLibrary.tsx:413-419` calls the ordinary
`set_library_match`, which writes a `library_override` row, so a confirmation inherits the
"never touched by a scan" guarantee. Pinned by `a_rescan_replaces_suggestions_but_never_corrections`
(db.rs:1630).

`index_files`' documented consultation order is redirect rule → override → matcher
(library.rs:720-742), matching the repository's project instructions, and both halves are pinned
(`a_split_beats_a_whole_key_override_inside_its_range` library.rs:1630,
`a_correction_outlives_the_scan_that_disagreed` library.rs:1805).

### Redirect keying

`plan_redirect` (library.rs:990) takes `from`/`to` in the **current display frame** — the numbers
the row and the overflow chip show, which may already be renumbered by an earlier split — and
translates to the **disk frame** per file by re-reading each filename (`reparse`, library.rs:1008).
The persisted `library_redirect` rows stay keyed on `(title, season, disk ep_from)`, because that
is the frame a scan parses. This is exactly the chained-split fix the repository's project instructions describe, and it is
pinned by `a_second_split_keys_on_what_the_row_shows` (library.rs:1658) and
`splitting_a_renumbered_row_targets_the_right_files_and_trims` (library.rs:1699).

The overlap-trim arithmetic (library.rs:1058-1072) was re-checked algebraically: both remnants
preserve the original rule's mapping, neither `d_min - 1` nor `d_max + 1 - r.ep_from` can underflow
given the branch conditions, and the three surviving keys (`r.ep_from`, `d_max + 1`, `d_min`) cannot
collide. Two refusals sit around it — the mixed-offset check (library.rs:1029-1035) and the
"range overlaps files from another source" check (library.rs:1042-1053). The arithmetic is correct;
what is missing is a test for one branch (**A4-15**) and a transaction around the application
(**A4-07**).

### Suggestion lifecycle

`library_suggestion` is written only by `library_replace_suggestions` (library.rs:549) and read in
three places: `reindex` attaches it to an `UnmatchedGroup` (library.rs:154), `hydrate` restores it
(library.rs:886-893), and `scan_library` carries it forward (library.rs:435-439). **Nothing reads a
suggestion's media id into `ScannedFile.media_id`** — `index_files` consults redirects, overrides
and the matcher and nothing else (library.rs:720-742). The accept button calls the ordinary
`set_library_match` (LocalLibrary.tsx:413-419), which writes an override, at which point the row
reads `yours` rather than `exact`/`close`. There is no path that applies a suggestion without
explicit confirmation, and the reason there must not be one is pinned by
`a_plausible_but_wrong_hit_is_still_only_a_suggestion` (identify.rs:273).

The community-relations split hint has the same shape: `detect_overflow` (library.rs:806) only
describes; the hint is serialised for the card to pre-select and is never applied.

### Edge inputs

| Input | Behaviour | Verdict |
|---|---|---|
| Zero files, nothing indexed before, root readable | Empty index written; this is the only way to empty a library on purpose | Sound |
| Zero files, something indexed before, or an unreadable directory seen | Hard error, index kept (library.rs:474-479) | Sound |
| Root unreadable at t=0 | `read_dir` pre-check (library.rs:458-463) returns before anything is deleted | Sound |
| **Root partially unavailable mid-scan** | `unreadable > 0` with `total > 0` proceeds to publish | **A4-03** |
| **More than `MAX_FILES` (20 000) files** | Walk stops silently; the truncated result replaces the index | **A4-04** |
| Directory deeper than `MAX_DEPTH` (6) | Silently skipped; not counted as unreadable | folded into **A4-04** |
| Filename with no parsable title | `parse` yields `title: ""`; cannot match; lands in an unplaced group keyed `("", -1)` | Cosmetic |
| **Filename with no parsable episode (films, single-file OVAs)** | Dropped at library.rs:717 — not indexed, not unplaced, not reportable | **A4-09** |
| **Non-UTF-8 path bytes** | `to_string_lossy` at library.rs:1386 and 714 stores a path that cannot be opened | **A4-11** |
| Very long paths | `std::fs` handles Windows long absolute paths; nothing here truncates | No finding |
| Two files claiming one episode of one media | First in walk order wins (`or_insert_with`, library.rs:108-112), pinned by `the_first_path_wins_for_a_duplicate_episode` (library.rs:1789) | Documented |
| Two unplaced files claiming one `(title, season, episode)` | In-memory group holds both; the table's primary key collapses them | **A4-18** |
| Files deleted or moved between scans | `library_replace_all` deletes the table first (db.rs:1189), so no residue; `open_path` re-checks existence (library.rs:1319) | Sound |
| Season folders / no season in the name | `season_key` → `-1`, consistent with every `library_*` table (library.rs:761) | Sound |

### Scan cost shape (static analysis)

This is static analysis of the code paths, not a measurement. For `F` walked video files yielding
`P` distinct `(media_id, episode)` pairs across `M` matched media, `U` unplaced files, `S`
suggestions, `T` distinct parsed `(title, season)` keys and `C` cached AniList candidates:

**SQLite writes**

| Write | Statements | Transactions |
|---|---|---|
| `library_replace_all` (db.rs:1180) | `2 DELETE + P INSERT + M INSERT` | 1 |
| `library_replace_unmatched` (db.rs:1477) | `1 DELETE + U INSERT` | 1 |
| `library_replace_suggestions` (db.rs:1446) | `1 DELETE + S INSERT` | 1 |
| `kv_set("identify_cursor")`, `kv_set("library_files_seen")` (library.rs:553, 556) | 2 | 2 autocommits |

So ≈ `P + M + U + S + 6` statements in **five** transactions, independent of `F` — the right
shape. Reads at the top of a scan: `kv_get("library_path")`, `candidates_from_cache`
(one whole-list JSON parse), `library_suggestions`, `kv_get("identify_cursor")`,
`library_overrides`, `library_redirects`, and `library_all()` materialised only to be counted
(**A4-19**).

**AniList requests**

Bounded at `MAX_BATCHES = 8` per scan by `identify`'s `.take(MAX_BATCHES)` (identify.rs:150), with
`PER_REQUEST = 25` (identify.rs:23), i.e. **≤ 8 requests covering ≤ 200 titles for any `F`**.
Already-answered groups are filtered out before the call (library.rs:502-506), so a rescan of an
unchanged folder costs **0** requests; the rotate-then-cap cursor (library.rs:516-527) makes the cap
a moving window rather than a prefix, pinned by `successive_scans_ask_about_every_unplaced_title`
(identify.rs:190). A failed batch ends the pass rather than failing the scan (identify.rs:154-156).

**CPU**

- Walk: one `read_dir` per directory, `F` lossy path allocations.
- `index_files`: `F` `parser::parse` calls (five regexes each), plus `matcher::prepare` once over
  `C` candidates and `best_match_prepared` once per distinct `(title, season)` — `T`, not `F`
  (library.rs:736-744), negative results memoised too.
- `reindex`: `O(F)` plus a linear scan per media's source list.
- `hydrate` at startup: one `reparse` per stored row plus a whole-list JSON parse — see **A4-21**.
- `plan_redirect`: per parse group in the range, a full pass over the index with a `reparse` for
  every file sharing that parse key (library.rs:1042-1053).

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
|---|---|---|---|---|
| A4-03 | P3 | DATA INTEGRITY RISK | src-tauri/src/library.rs:474 | A partially unreadable walk is published over the complete previous index, with a success toast |
| A4-04 | P3 | DATA INTEGRITY RISK | src-tauri/src/library.rs:1364 | `MAX_FILES` truncation is silent and the truncated result replaces the index |
| A4-20 | P3 | PERFORMANCE PROBLEM | src-tauri/src/library.rs:932 | The four library-correction commands run a full index rewrite on the UI thread |
| A4-21 | P3 | PERFORMANCE PROBLEM | src-tauri/src/library.rs:832 | `hydrate` re-parses every indexed path and the whole cached list synchronously in `setup` |
| A4-06 | P4 | DATA INTEGRITY RISK | src-tauri/src/library.rs:663 | `persist` publishes one scan as two independent transactions |
| A4-07 | P4 | DATA INTEGRITY RISK | src-tauri/src/library.rs:1118 | An atomically-planned split is applied as loose deletes then inserts |
| A4-09 | P4 | IMPROVEMENT | src-tauri/src/library.rs:717 | Files with no episode number — every film and single-file OVA — leave the pipeline unreportably |
| A4-11 | P4 | BUG | src-tauri/src/library.rs:1386 | Non-UTF-8 path bytes are stored lossily, producing a permanently dead play button |
| A4-12 | P4 | BUG | src-tauri/src/library.rs:327 | `set_library_path` is the one library command with no scan gate |
| A4-15 | P4 | MISSING TEST | src-tauri/src/library.rs:1066 | The right-hand trim branch of `plan_redirect` has no test |
| A4-18 | P4 | BUG | src-tauri/src/db.rs:155 | `library_unmatched`'s primary key silently collapses duplicate unplaced episodes across a restart |
| A4-19 | P4 | PERFORMANCE PROBLEM | src-tauri/src/library.rs:454 | `library_all().len()` materialises every row to obtain a count |
| A4-22 | P4 | DATA INTEGRITY RISK | src-tauri/src/library.rs:553 | The two scan hints are written as autocommits after the index they describe |
| A4-23 | P4 | BUG | src-tauri/src/library.rs:843 | `hydrate` re-derives splits from their rules but trusts the stored media id over an override |
| B3-16 | P4 | BUG | src-tauri/src/library.rs:487 | The scan takes the relations `RwLock` with `.read().unwrap()`, outside `LockExt` |

---

ID: A4-03
Severity: P3
Category: DATA INTEGRITY RISK

File: src-tauri/src/library.rs
Line: 474-479 (the guard); 1363-1391 (`collect_videos`)
Function: `scan_library`, `collect_videos`

Problem:
`collect_videos` counts the directories it could not read and returns that count, but `scan_library`
consults the count only when the walk found *nothing*. A root that is readable while some of its
subtrees are not — a NAS share that drops mid-walk, a permission-denied season folder, an external
drive that spins down partway — produces a partial file list that is then written down as the
complete truth.

Expected Behavior:
"Could not look" and "found nothing" are already distinguished for the total-loss case. The same
distinction should hold for a partial loss, because a scan replaces all three index tables
wholesale.

Actual Behavior:
The guard is `if total == 0 && (unreadable > 0 || previously_indexed > 0)` (library.rs:474). With
`unreadable = 40` and `total = 300` (down from 3 000) the condition is false, the scan proceeds to
`persist` (library.rs:548 → library.rs:663-673), which `DELETE`s and rewrites `library_files`,
`library_match` and `library_unmatched` from the 300 reachable files, overwrites
`library_files_seen` with 300 (library.rs:556), and returns `Ok`. The pane renders the result in
success styling.

Reproduction:
Point the library at a mounted network share; start a scan; disconnect the network after the walk
has entered the tree but before it finishes. The scan returns `Ok` with a reduced count and the
index is replaced.

Impact:
The play affordances for most of the library disappear until a successful rescan, and the failure
presents as a success. No user data is destroyed: `library_override`, `library_redirect` and
`library_suggestion` are untouched, and a later complete scan restores the index.

Root Cause:
`unreadable` is computed and `#[must_use]` (library.rs:1362) but wired into only one arm of the
guard added in the same change. Two further losses are invisible for the same reason: a per-entry
`read_dir` iteration error is dropped by `entries.flatten()` (library.rs:1379) without incrementing
the counter, and the cap returns of A4-04 return `0`.

Recommended Fix:
Refuse — or warn and keep the previous index — whenever `unreadable > 0`, or whenever `total` has
fallen against `previously_indexed` by more than a threshold. The sentence already written for the
`total == 0` case ("The index was kept — check that the drive or network share is connected") is
the right one for both.

Regression Tests Required:
A test over `collect_videos` plus the guard that a walk returning `unreadable > 0` with `total > 0`
does not reach `persist`. The existing `an_unreadable_directory_is_counted_rather_than_swallowed`
(library.rs:1879) covers only the counting half.

Confidence: HIGH

---

ID: A4-04
Severity: P3
Category: DATA INTEGRITY RISK

File: src-tauri/src/library.rs
Line: 19-20 (`MAX_DEPTH`, `MAX_FILES`); 1364, 1379
Function: `collect_videos`, `scan_library`

Problem:
The walk stops silently at `MAX_FILES = 20_000` and skips silently below `MAX_DEPTH = 6`. Neither
truncation is reported anywhere, and the truncated result is then written over the complete previous
index.

Expected Behavior:
Hitting a safety cap is information the user needs, because the consequence is that part of their
library stops being playable and cannot even be surfaced as unplaced.

Actual Behavior:
`collect_videos` returns `0` — its return value counts unreadable directories only — both when
`depth > MAX_DEPTH` (library.rs:1364) and when `out.len() >= MAX_FILES` (library.rs:1364 and 1379).
`scan_library` then reports `files: total` (exactly 20 000), writes that to `library_files_seen`
(library.rs:556), and publishes. `ScanSummary` (library.rs:293-302) carries no truncation flag and
nothing is logged for either cap.

Reproduction:
A library of 25 000 video files. Scan: everything past the cap is absent from the index and from the
unplaced list, and the pane reports a clean success. The depth half needs seven directory levels
below the root — the guard is `depth > MAX_DEPTH` with the root at depth 0 — which is unusual rather
than ordinary; the `MAX_FILES` half carries the finding.

Impact:
Part of the library silently loses its play buttons, with no screen on which the user can notice.
20 000 files is large but reachable for a long-runner-heavy collection.

Root Cause:
The caps predate the "found nothing must not be persisted as truth" guard and were never wired into
it.

Recommended Fix:
Return the cap-hit and the depth-skip alongside `unreadable`, and either refuse the scan or attach a
warning to `ScanSummary` that the pane renders. At minimum `logging::warn` on both — the unreadable
branch already logs (library.rs:1370-1373) and these do not.

Regression Tests Required:
A test that a walk hitting `MAX_FILES` reports it (a synthetic `out` pre-filled to the cap), and one
that a directory below `MAX_DEPTH` is reported rather than silently skipped.

Verification: the source report's depth example was off by one and is corrected above; the
`MAX_FILES` half is confirmed as stated.

Confidence: HIGH

---

ID: A4-20
Severity: P3
Category: PERFORMANCE PROBLEM

File: src-tauri/src/library.rs
Line: 932-957 (`set_library_match`), 1096-1125 (`set_library_redirect`), 1141-1197
(`clear_library_redirect`), 1206-1260 (`clear_library_match`)
Function: `set_library_match`, `set_library_redirect`, `clear_library_redirect`, `clear_library_match`

Problem:
All four library-correction commands are plain `#[tauri::command]`s. This module states the
consequence itself, at library.rs:388-394: "`tauri-macros` defaults a plain `#[tauri::command]` to
`ExecutionContext::Blocking`, which runs the body inline on the WebView2 UI thread." Each of the
four ends in `persist`, a delete-and-reinsert of the entire index across two transactions, while
holding both the `LibraryIndex` mutex and (inside `persist`) the `Db` mutex.

Expected Behavior:
The same reasoning that made `scan_library` `#[tauri::command(async)]` applies to a command that
rewrites the same tables the scan writes. Clicking "this one is wrong" should not freeze the window.

Actual Behavior:
`persist` (library.rs:663-673) builds a `Vec` of every `(media_id, episode, path)` row and runs
`library_replace_all` (`2 DELETE` + up to `MAX_FILES` `INSERT`s in one transaction, db.rs:1180)
followed by `library_replace_unmatched` (db.rs:1477), synchronously on the UI thread.
`set_library_redirect` additionally runs `plan_redirect`, which for each parse group in the range
does a full pass over the index with a `parser::parse` per same-parse file (library.rs:1042-1053);
`clear_library_redirect` runs two more `reparse` sweeps (library.rs:1165-1185); `clear_library_match`
runs one (library.rs:1229-1242). Every background writer — the scrobbler, the three alert passes —
is blocked behind the same `Db` mutex for the duration.

Reproduction:
Index a large folder (thousands of files), then correct any mis-matched title from the Library pane.
The window stops repainting for the length of the rewrite.

Impact:
A visible freeze proportional to index size on a one-click correction, on the screen where a user
making one correction usually makes several. No correctness impact.

Root Cause:
The `async` fix was applied to `scan_library`, whose comment explains exactly why, and not to the
four commands that share its write path.

Recommended Fix:
`#[tauri::command(async)]` on all four, matching `scan_library`. The bodies take no `State<'_, _>`
guard across an await, so the change is mechanical.

Regression Tests Required:
None mechanical. A comment (or a doc test) asserting the four are declared `async` for the reason
library.rs:388-394 already gives would pin it.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-21
Severity: P3
Category: PERFORMANCE PROBLEM

File: src-tauri/src/library.rs
Line: 832-905 (with src-tauri/src/lib.rs:384)
Function: `library::hydrate`

Problem:
`hydrate` is called synchronously from `setup` (lib.rs:384), before the window exists, and does two
unbounded pieces of work on that thread: one `parser::parse` per stored index row, and a full JSON
parse of the cached AniList list.

Expected Behavior:
Startup work that is proportional to library size and list size does not sit on the pre-window
critical path.

Actual Behavior:
`hydrate` reads `library_all()`, `library_unmatched()`, `library_scores()`, `library_suggestions()`,
the overrides and the redirects, then calls `reparse` (library.rs:911-919, five regexes via
`parser::parse`) once per stored row — up to `MAX_FILES = 20_000` — and for each row additionally
walks the redirect rules. It then calls `episode_counts(&candidates_from_cache(&db, "ANIME"))`
(library.rs:896), and `candidates_from_cache` (scrobbler.rs:263-272) pulls the whole cached list
payload out of SQLite and runs `serde_json::from_str` over it. That payload is stored uncompressed,
so it is comfortably multi-megabyte for an ordinary account. All of it runs before the window is
created, holding the `Db` mutex for each query.

Reproduction:
Static. A 20 000-row index plus a large cached list makes every launch pay the sum before the first
frame.

Impact:
Added time-to-first-window on every launch, growing with the two things a heavy user has most of.
No correctness impact — the work itself is right, and the index must be hydrated before the pane can
render.

Root Cause:
`hydrate` was placed in `setup` so the index is ready before the frontend asks for it, and nothing
bounded or deferred the cost as the index grew a cap of 20 000 rows.

Recommended Fix:
Move `hydrate` off the setup thread — `tauri::async_runtime::spawn_blocking` with the pane treating
"not hydrated yet" the way it already treats "never scanned" — or at minimum defer the
`candidates_from_cache` half, which only feeds the overflow chips.

Regression Tests Required:
A test that `hydrate` restores a split row from its rule and an ordinary row from its stored id
(the behaviour must not change), plus, if it is made async, one asserting the pane's empty state is
reachable before hydration completes.

Confidence: HIGH
Source: found during adversarial verification

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
`scores` in the same transaction as `rows` (db.rs:1174-1179).

Actual Behavior:
```
db.library_replace_all(&rows, &score_rows)?;          // transaction 1 commits
db.library_replace_unmatched(&data.unmatched_rows())  // transaction 2
```
A crash or a write error between them leaves the *new* matched index beside the *previous* scan's
unplaced list. `hydrate` (library.rs:843, 878) concatenates `library_all()` with
`library_unmatched()` with no reconciliation, so a path that is now matched and was previously
unplaced appears twice — once placed, once in the unplaced group — and the user is offered a
correction for files that are already indexed.

Reproduction:
Kill the process between the two calls, or induce a disk-full on the second. Restart: the Library
screen shows entries in both the matched table and the unplaced list.

Impact:
A confusing display that survives restarts until the next successful scan, which repairs it. No user
data is lost — `library_override`, `library_redirect` and `library_suggestion` are untouched.

Root Cause:
The transaction boundary sits at the table level rather than at the operation level, and the two
`Db` helpers each own their own transaction, so a caller cannot compose them.

Recommended Fix:
A single `Db` method taking rows, scores and unmatched that writes all three `DELETE`s and all
inserts in one transaction; `persist` calls that. The suggestions table is genuinely separate — it
is written after an `.await` — and can stay as it is.

Regression Tests Required:
A `mem_db()` test that a failing insert in the unmatched half leaves `library_files` unchanged.

Verification: downgraded from P3 — the trigger is a crash or a write error precisely between two
transactions, and the consequence is a confusing display rather than lost data, repaired by any
successful rescan.

Confidence: HIGH

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
deletes and inserts run as individual autocommitted statements, deletes first.

Expected Behavior:
An atomically-planned change is applied atomically. A failure leaves the previous split rules
exactly as they were.

Actual Behavior:
```
for (title, season, ep_from) in &plan.delete { db.library_redirect_clear(...)?; }
for r in &plan.insert                        { db.library_redirect_set(...)?;   }
```
Each call is its own transaction (db.rs:1405, db.rs:1380). An error or a crash after the deletes and
before or during the inserts leaves the overlapped rule deleted and its trimmed remnants unwritten:
the user's earlier confirmed split is gone along with the new one. Because `plan.delete` runs first,
the window covers the entire insert loop. `clear_library_match` (library.rs:1216-1226) has the same
shape — one `library_override_clear` followed by N `library_redirect_clear`s, each its own
autocommit — so a failure part-way leaves the override gone and some splits still standing.

Reproduction:
A three-cour folder with an existing split covering disk 13–36, then a second split of the
current-frame 13–24 (the `splitting_a_renumbered_row_targets_the_right_files_and_trims` scenario,
library.rs:1699). Interrupt after `library_redirect_clear` and before both `library_redirect_set`
calls: `library_redirect` holds neither the old rule nor the new ones, and the next scan re-merges
every episode onto the first season.

Impact:
Loss of a user-confirmed season split — the class of data the schema comment calls "User data: a
scan must never clear it" (db.rs:195-196). The user re-confirms in two clicks; nothing else is
affected.

Root Cause:
No transaction spans the plan's application; the `Db` helpers are per-row.

Recommended Fix:
`Db::library_redirects_apply(&plan.delete, &plan.insert)`, one transaction, both loops inside it,
mirroring `library_replace_all`'s shape. Give `clear_library_match`'s pair the same treatment.

Regression Tests Required:
A `mem_db()` test that a failure during the insert loop leaves the pre-existing rules intact.

Verification: downgraded from P3 — the window is three or four single-row statements with no I/O of
consequence, and what is lost is a confirmation the user can redo, not stored content.

Confidence: HIGH

---

ID: A4-09
Severity: P4
Category: IMPROVEMENT

File: src-tauri/src/library.rs
Line: 717
Function: `index_files`

Problem:
`let Some(episode) = parsed.episode else { continue };` drops every file whose filename carries no
episode number. For a series that is the right call (an OP, an ED, an extra), but it also excludes
the whole class of single-file media — films, OVAs, specials released as one file — which have no
episode number by nature and are ordinary AniList entries with `episodes: 1`.

Expected Behavior:
A film on the user's list and present on disk either gets a play button, or at least appears in the
unplaced list where the user can assign it.

Actual Behavior:
The file leaves the pipeline at library.rs:717, before the matcher and before the unplaced grouping.
It is not in `library_files`, not in `library_unmatched`, not in `ScanSummary.matched`, and counted
nowhere except the raw `files` total. There is no screen on which the user can discover that Karasu
saw it. `parser::parse` genuinely yields `episode: None` here: the bracket strip (parser.rs:84-88)
removes `(2016)`/`[1080p]` and the trailing-number rule explicitly rejects 1950–2030
(parser.rs:107-109).

Reproduction:
Put `Koe no Katachi (2016) [1080p].mkv` in the library folder with the film on the AniList list and
scan. The Library screen shows nothing for it.

Impact:
An entire media category is outside what the local library can represent. The workaround — renaming
each file to include `- 01` — is not discoverable.

Root Cause:
Episode number is the identity of a library row: `library_files` is keyed `(media_id, episode)`
(db.rs:95-100), so a file without one has nowhere to go.

Recommended Fix:
When `parsed.episode` is `None` and the matched candidate reports `episodes == Some(1)` (or a film
format), index it as episode 1. Failing that, route episode-less files into `library_unmatched` with
`episode = 0` so they are at least visible and assignable.

Regression Tests Required:
A test that a single-file film matching a one-episode candidate is indexed at episode 1, and that an
episode-less file matching a 28-episode candidate is still skipped, so OP/ED extras do not regress.

Verification: downgraded from P3 to an enhancement — the skip is deliberate and pinned by a test
whose comment says so ("Skipped means skipped: no episode number is not the same as an unplaced
episode", library.rs:1761-1768), and the `(media_id, episode)` key means a film has no
representation by construction. This is a capability the feature does not have rather than a defect
in what it does. It is nonetheless not recorded in the repository's project instructions as a decision, which is why it is
filed rather than dropped.

Confidence: HIGH

---

ID: A4-11
Severity: P4
Category: BUG

File: src-tauri/src/library.rs
Line: 1386 (`collect_videos`), 714 (`index_files`), 1319 (`open_path`)
Function: `collect_videos`, `index_files`, `open_path`

Problem:
Paths are stored as `path.to_string_lossy().to_string()`. On Linux a filename is an arbitrary byte
string; any non-UTF-8 byte becomes U+FFFD, and the stored path then names a file that does not
exist. The index keeps the mangled path, and every rescan reproduces it.

Expected Behavior:
A file the scanner walked past is a file the play button can open.

Actual Behavior:
`collect_videos` pushes the lossy string into `out` (library.rs:1386); `persist` writes it to
`library_files`; `open_path` does `if !Path::new(path).exists()` (library.rs:1319), which is false,
and returns "That file is no longer on disk — rescan your library". A rescan produces the identical
mangled path, so the message is both wrong and un-actionable.

Reproduction:
On Linux, create `Frieren - 13 [caf\xe9].mkv` (a latin-1 byte, common in files unpacked from old
archives). Scan; the episode appears in the index; pressing play reports it is no longer on disk,
permanently.

Impact:
A permanently dead play button with a misleading error, bounded to the offending files. Nothing is
corrupted and no other file is affected.

Root Cause:
The index is typed `String` end to end rather than `PathBuf`/`OsString`, so the lossy conversion is
forced at the walk.

Recommended Fix:
Either skip files whose path is not valid UTF-8, with a `logging::warn` so they are reportable, or
store the path as bytes and convert only for display. Skipping is the small, honest fix: it turns a
dead button into a file that was never claimed.

Regression Tests Required:
A Linux-gated test that a path with an invalid UTF-8 byte is not added to the index. Per the house
rule about Linux-only code, the CI `linux-build` job is where it runs.

Verification: downgraded from P3 — bounded to Linux filenames containing invalid UTF-8, degrading to
an error message on those files alone rather than corrupting anything.

Confidence: HIGH (mechanism), MEDIUM (how often a real library contains such a name)

---

ID: A4-12
Severity: P4
Category: BUG

File: src-tauri/src/library.rs
Line: 326-329
Function: `set_library_path`

Problem:
`set_library_path` is the only library-mutating command that does not consult the scan flag
(`LibraryIndex.1`). The other five all do: library.rs:404 (`scan_library` re-entry), 940
(`set_library_match`), 1109 (`set_library_redirect`), 1149 (`clear_library_redirect`), 1213
(`clear_library_match`).

Expected Behavior:
Consistent with the flag's stated purpose — a lock on the conclusion — changing the input a running
scan is drawing conclusions about should be refused too.

Actual Behavior:
The path is written mid-scan by a bare `kv_set`. `scan_library` captured `root` at library.rs:412,
so it finishes and publishes an index for the *old* folder plus a `library_files_seen` count for the
old folder, while `get_library_status` (library.rs:310-319) reports the *new* path beside those
numbers and every play button points into the old tree.

Reproduction:
Start a scan of a large folder, then pick a different folder in Settings before it finishes.

Impact:
A misleading status row and stale play targets until the next scan, which the user will run anyway
after changing the folder. No corruption: the tables are replaced wholesale on the next scan and no
user data is involved.

Root Cause:
The gate was added to the five commands that write index tables, and not to the one that writes the
setting they read.

Recommended Fix:
Add the same `state.1.load(Ordering::Acquire)` check and the same error string.

Regression Tests Required:
None beyond the existing pattern; a command-level assertion would need Tauri state.

Confidence: HIGH

---

ID: A4-15
Severity: P4
Category: MISSING TEST

File: src-tauri/src/library.rs
Line: 1066-1072
Function: `plan_redirect` (right-hand trim branch)

Problem:
The overlap trimmer has two branches. The left one (`if r.ep_from < d_min`) is exercised by
`splitting_a_renumbered_row_targets_the_right_files_and_trims` (library.rs:1699). The right one
(`if r.ep_to > d_max`), including its non-obvious `dst_start: r.dst_start + (d_max + 1 - r.ep_from)`
re-basing, is reached by no test in the file.

Expected Behavior:
The branch that re-bases a destination start has a test, because a silent off-by-one there points
files at the wrong episode of the right show — which then scrobbles.

Actual Behavior:
Every `plan_redirect` call in the test module was inspected: library.rs:1681 asserts `plan.delete`
is empty; library.rs:1719 has `d_max == r.ep_to == 36`, so `r.ep_to > d_max` is false;
library.rs:1753 and 1755 exercise error paths. The branch is therefore never entered.

Reproduction:
A four-cour folder split once as disk 13–48 onto a sequel, then a second split of the current-frame
1–12 of that sequel (disk 13–24) onto a third entry. `d_max = 24 < r.ep_to = 48`, so the right
remnant `(25, 48, dst_start = 1 + (25 - 13) = 13)` is produced — the branch with no coverage.

Impact:
None today. The branch was verified algebraically for this report: against `SplitRule::apply`
(library.rs:61-67), which maps `e -> e - ep_from + dst_start`, the remnant
`{ep_from: d_max+1, dst_start: s + (d_max+1-a)}` yields `s + (d_max+1-a) + (e-(d_max+1)) = s+(e-a)`,
identical to the original rule. The exposure is to a future edit.

Root Cause:
The chained-split scenarios the tests were written from all trimmed on the left.

Recommended Fix:
Add the four-cour test above, asserting the emitted `(ep_from, ep_to, media_id, dst_start)` tuple for
the right remnant. `clear_library_redirect` (library.rs:1141-1197) is also entirely untested — its
`fallback` selection and the `was_governed`/`still_split` interplay are non-trivial — and is worth
covering in the same pass.

Regression Tests Required:
As described.

Verification: downgraded from P3 — this is a missing test over code independently verified correct,
with no defect present today.

Confidence: HIGH

---

ID: A4-18
Severity: P4
Category: BUG

File: src-tauri/src/db.rs
Line: 155-161 (`library_unmatched` primary key); 1487-1490 (`INSERT OR REPLACE`, db.rs:1485 `DELETE`)
Function: `MIGRATION_V9`, `Db::library_replace_unmatched`

Problem:
`library_unmatched` is keyed `(title, season, episode)` and written with `INSERT OR REPLACE`. Two
files that parse to the same title, season and episode — a dual-quality library holding
`Show - 01 [720p].mkv` and `Show - 01 [1080p].mkv` — collapse to one row, while the in-memory group
built by `reindex` (library.rs:140-143) holds both, pushed unconditionally.

Expected Behavior:
The unplaced list shows the same thing before and after a restart.

Actual Behavior:
Immediately after a scan the group reports N files; after a restart `hydrate` rebuilds it from the
table and it reports fewer. Nothing warns. This mirrors the deliberate `(media_id, episode)` dedupe
on the matched side, where "the first path wins" is documented and tested (library.rs:1789) — but on
the unmatched side it is neither documented nor tested, and it changes a count the user can see.

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
At `MAX_FILES = 20_000` this allocates 20 000 `String`s plus the tuple vector and drops them one
statement later, while holding the `Db` mutex for the whole `query_map` (db.rs:1226-1234).

Reproduction:
Static.

Impact:
Tens of milliseconds and a few megabytes of transient allocation per scan, plus a mutex hold that
blocks the scrobbler and the alert passes for its duration. Negligible in absolute terms.

Root Cause:
Reuse of an existing accessor rather than a purpose-built count.

Recommended Fix:
Add `Db::library_file_count()` doing `SELECT COUNT(*)`.

Regression Tests Required:
None.

Confidence: HIGH

---

ID: A4-22
Severity: P4
Category: DATA INTEGRITY RISK

File: src-tauri/src/library.rs
Line: 553, 556
Function: `scan_library`

Problem:
The two hints a scan leaves behind — `identify_cursor` and `library_files_seen` — are written as
separate autocommitted `kv_set`s after `persist` and `library_replace_suggestions` have already
committed. They describe the scan that just published, but nothing binds them to it.

Expected Behavior:
The number the status row shows describes the index the status row is showing.

Actual Behavior:
```
persist(&db, &data)?;                          // transactions 1 and 2
db.library_replace_suggestions(&suggestions)?; // transaction 3
db.kv_set("identify_cursor", …)?;              // transaction 4
db.kv_set("library_files_seen", …)?;           // transaction 5
```
A failure or a crash at either `kv_set` leaves `library_files_seen` describing the *previous* scan
beside the index this one just published, and `get_library_status` (library.rs:310-319) reads it
verbatim. A failure at the `identify_cursor` write leaves the rotation cursor where the previous
scan left it, so the next scan re-asks AniList about the same window of unplaced titles it just
asked about — up to eight requests spent learning nothing.

Reproduction:
Induce a write error (disk full) after `library_replace_suggestions` commits. Restart: the status row
reports the old file count against the new index.

Impact:
A wrong number on the Library status row, and at most one wasted identify window. Repaired by any
successful rescan. Same class as A4-06 and adjacent to it.

Root Cause:
The publish is a sequence of independent commits rather than one operation; the hints were appended
to the end of it.

Recommended Fix:
Fold both `kv_set`s into the same transaction as the index publish suggested in A4-06, so the index
and the numbers describing it commit together.

Regression Tests Required:
Covered by A4-06's test if the two are fixed together: a failure anywhere in the publish leaves the
previous index *and* the previous counts.

Confidence: HIGH
Source: found during adversarial verification

---

ID: A4-23
Severity: P4
Category: BUG

File: src-tauri/src/library.rs
Line: 843-877
Function: `hydrate`

Problem:
`hydrate` treats the two kinds of correction asymmetrically. A season split is **re-derived** from
its `library_redirect` rule and the filename's own number, so a stored row that disagrees with the
rules is corrected at startup. A whole-key override is **not**: the stored `media_id` is trusted, and
`library_override` is consulted only to set the `manual` display flag.

Expected Behavior:
Either both kinds of correction are re-derived at hydration, or neither is — and if neither, a
stored index that disagrees with a stored correction is a state that cannot occur.

Actual Behavior:
```
manual: overrides.get(&(title.clone(), season)) == Some(&media_id),
…
media_id: Some(media_id),   // the stored row, not the override
```
So if `library_files` ever holds a row whose media id contradicts an override, the contradiction
survives every restart until the next scan. That state is reachable: `set_library_match`
(library.rs:944-955) writes the override row first and calls `persist` last, so a failed `persist`
— the disk-full / write-error class of A4-06 and A4-07 — commits the correction and not the index
it corrects. `clear_library_match` has the mirror shape: it deletes the override and the split rules
first (library.rs:1216-1226), so a failed `persist` leaves the index still corrected with no
correction on record, and a formerly split row then hydrates with its *renumbered* episode number
against the split target and `manual = false`.

Reproduction:
Correct a mis-matched title with the database read-only or the disk full. The command returns an
error, but `library_override` now holds the correction. Restart: the Library pane shows the old,
wrong match with no "yours" marker. A rescan fixes it.

Impact:
A correction that appears not to have taken, or a correction that appears to persist after being
removed, until the user rescans. No data is lost — the override row is the user data and it is
intact either way.

Root Cause:
The split path had to be re-derived because a split row's stored episode is the renumbered one,
which the filename cannot confirm; the override path had no such forcing reason and was left
trusting the stored id.

Recommended Fix:
Apply the override in `hydrate` the way the redirect is applied — `overrides.get(&(title, season))`
wins over the stored `media_id`, with `manual = true` — so the index cannot disagree with a stored
correction across a restart. Fixing A4-06 (one transaction for the whole publish, extended to cover
the correction commands) removes the reachable trigger; this removes the residue.

Regression Tests Required:
A test that `hydrate` over a `library_files` row whose `media_id` contradicts a `library_override`
row for the same parse resolves to the override, and that a row with no override is unchanged.

Confidence: MEDIUM
Source: identified while re-reading `hydrate` for this report; present in neither the source
report nor the verification pass. The mechanism was read directly from library.rs:843-877 and
library.rs:944-955; the reachability depends on the same failed-write window as A4-06.

---

ID: B3-16
Severity: P4
Category: BUG

File: src-tauri/src/library.rs
Line: 487
Function: `scan_library`

Problem:
The scan snapshots the community relation rules with
`app.state::<relations::Relations>().0.read().unwrap()`. `sync::LockExt::guard` — the helper that
exists precisely so a poisoned lock does not permanently disable the app (sync.rs:24-33) — covers
`Mutex` only, so every `RwLock` access in the tree bypasses it.

Expected Behavior:
A panic in one relations writer does not make every subsequent scan panic.

Actual Behavior:
If either writer (relations.rs:140, relations.rs:193) panics while holding the write lock, the
`RwLock` is poisoned and this `.read().unwrap()` panics on the next scan. `hydrate` does the right
thing four lines away (`.read().map(|r| r.clone()).unwrap_or_default()`, library.rs:900-903), which
makes the inconsistency visible.

Reproduction:
Not reachable today: neither writer holds the guard across code that can panic. This is a
robustness gap rather than a live defect.

Impact:
None observed. If it ever fires, `scan_library` panics inside a Tauri command.

Root Cause:
`LockExt` was written for `Mutex` and the `RwLock` sites were never migrated.

Recommended Fix:
Extend `LockExt` to `RwLock` (or use `hydrate`'s `.map(...).unwrap_or_default()` shape here), and
apply it at all three read sites — library.rs:487, scrobbler.rs:847, scrobbler.rs:1058.

Regression Tests Required:
A test in the shape of the existing `a_poisoned_lock_still_hands_over_its_data`, extended to
`RwLock`.

Confidence: HIGH (code), LOW (reachability)
Source: found during adversarial verification — the detection report named two `RwLock` read sites;
verification found this third one in the library scanner.

---

## Verified sound

Scenarios checked that are correctly handled, and the guard that handles each. These are kept from
the auditor's report; each was re-checked against source for this report.

1. **A rescan preserves user data.** `library_override`, `library_redirect` and confirmed
   suggestions all survive, because each scan write deletes only its own table
   (db.rs:1189, 1485, 1454). Pinned by `a_rescan_keeps_corrections_and_replaces_everything_else`
   (db.rs:1647) and `a_rescan_replaces_suggestions_but_never_corrections` (db.rs:1630).
2. **The index can never survive without its confidences.** `library_replace_all` (db.rs:1180)
   writes `library_files` and `library_match` in one transaction, for the reason its own doc comment
   gives: an index that outlived its scores would show every title as an exact match.
3. **`index_files`' documented order** — redirect rule → override → matcher (library.rs:720-742),
   matching the repository's project instructions. A split is checked first because it is strictly more specific than a
   whole-key override; the override is checked before the matcher so the fuzzy sweep is never spent
   on a title the user has already corrected. Pinned by
   `a_split_beats_a_whole_key_override_inside_its_range` (library.rs:1630).
4. **The scan-flag gate.** `LibraryIndex.1` is claimed by `compare_exchange` before the first early
   return (library.rs:401-408) and released by `ScanGuard::drop` (library.rs:589), so the two early
   error paths cannot leave the app refusing corrections until a restart. Honoured by all five
   index-mutating commands (the one gap is the setting-writer, A4-12). A correction landing between
   the check and the scan's flag claim is written to the database and then overwritten in memory,
   but its `library_override`/`library_redirect` row survives and `hydrate` re-applies it — with the
   one exception recorded as A4-23.
5. **`plan_redirect`'s display-frame vs disk-frame keying** matches the documented chained-split fix;
   the translation happens per file through `reparse` (library.rs:1008). Pinned by library.rs:1658
   and library.rs:1699.
6. **`plan_redirect`'s overlap arithmetic.** Both trim branches verified algebraically: no
   off-by-one, no `u32` underflow, no primary-key collision between the remnants and the new rule.
7. **`plan_redirect`'s refusals.** The mixed-offset check (library.rs:1029-1035) and the "range
   overlaps files from another source" check (library.rs:1042-1053) prevent a rule from silently
   dragging unselected same-parse files along; the zero-match case errors rather than returning a
   silent `Ok` (library.rs:1019-1021), pinned by `a_split_matching_no_files_is_an_error`.
8. **The suggestion lifecycle.** Nothing applies a suggestion without confirmation: `index_files`
   reads only redirects, overrides and the matcher, and the accept button calls the ordinary
   `set_library_match` (LocalLibrary.tsx:413-419). The reason it must stay that way is pinned by
   `a_plausible_but_wrong_hit_is_still_only_a_suggestion` (identify.rs:273).
9. **Suggestions are carried forward rather than re-asked.** The union at library.rs:534-543 keeps
   answers for groups still unplaced and drops those whose group has since been matched or whose
   files are gone, so `library_replace_suggestions`' `DELETE` cannot lose an answer the identify
   filter deliberately declined to re-request.
10. **Identify's request budget.** `.take(MAX_BATCHES)` (identify.rs:150) bounds a scan at eight
    requests regardless of file count; the rotate-then-cap cursor (library.rs:516-527) makes the cap
    a window rather than a prefix, pinned by `successive_scans_ask_about_every_unplaced_title`
    (identify.rs:190); already-answered groups are filtered before the call (library.rs:502-506).
    A rescan of an unchanged folder spends zero requests.
11. **Identify's query safety.** `matcher::normalize` reduces the interpolated title to
    alphanumerics and spaces, pinned by `a_quote_in_a_title_cannot_escape_the_query`
    (identify.rs:219); `Page(perPage: 1)` rather than `Media(search:)` so one miss cannot null the
    whole batch. A failed batch ends the pass instead of failing the scan (identify.rs:154-156).
12. **Identify is unreachable from detection.** `identify.rs` is called only from
    `scan_library` (library.rs:526), so a detected title that matches nothing never spends an
    AniList request — the scrobbler's silence on an unknown title is deliberate.
13. **A wholly unreachable library root does not wipe the index.** The `read_dir` pre-check
    (library.rs:458-463) plus the `total == 0` guard (library.rs:474-479), which correctly treats a
    still-mounted-but-empty mount point as a failure to look rather than as an emptied library.
14. **Stale rows are pruned.** `library_replace_all` deletes the table before inserting, so files
    deleted or moved between scans leave no residue; `open_path` re-checks existence at play time
    (library.rs:1319).
15. **Duplicate episodes on the matched side.** `or_insert_with` (library.rs:108-112) gives
    first-in-walk-order, pinned by `the_first_path_wins_for_a_duplicate_episode` (library.rs:1789).
16. **The matcher runs once per title, not once per file.** `best_match_prepared` is memoised on
    `(title, season)` including negative results (library.rs:736-744), and `matcher::prepare`
    normalises and trigrams the candidate list once per scan.
17. **No lock is held across the identify `.await`.** `scan_library` snapshots the relations
    `RwLock` before the await (library.rs:487) and takes the `LibraryIndex` mutex only after it
    (library.rs:575); `MutexGuard`'s `!Send` enforces the rest.
18. **`hydrate` re-derives a split rather than trusting the stored number.** A split row's stored
    episode is the renumbered one, which the filename cannot confirm, so the split is re-derived
    from its rule and the filename's own number — the two sources that cannot drift (library.rs:846-866).
    A rule cleared since the last run simply stops matching and the row falls back to what is stored.
19. **No title column is stored for a matched row.** `hydrate` recovers the parse by re-reading the
    filename, so a stored copy cannot drift away from what the parser says today (db.rs:144-148).
20. **`season_key`'s `-1` convention** is the same value in memory and in every `library_*` table,
    and the schema comment records why a nullable column would be wrong (SQLite treats each NULL in
    a primary key as distinct, db.rs:135-140).
21. **`open_path`'s mpv door does not go dead over a setting.** A failed launch logs and falls
    through to the default opener (library.rs:1343-1350), and `--` precedes the filename so a name
    beginning with a dash is not read as an option.
22. **The account-free profile gets an honest refusal.** `candidates_from_cache` reads the cached
    AniList list, so in local mode it is always empty; `scan_library` says so rather than sending the
    user to look for a button that would not help (library.rs:419-430).

## Refuted during verification

None. Every local-library finding in the source report survived adversarial verification; five of
the ten were downgraded (A4-06, A4-07, A4-09, A4-11, A4-15) and are carried above at the corrected
severity with the reason recorded on a `Verification:` line.

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 4 |
| P4 | 11 |
| Refuted | 0 |

Total findings: 15. Four were promoted from the adversarial verification pass (A4-20, A4-21, A4-22,
B3-16); one (A4-23) was identified while re-reading `hydrate` for this report and is labelled as
such.
