# Data Integrity Audit

## Scope

This report covers data correctness and durability: the offline queue's contents
and its replay, the SQLite list cache that the scrobbler's safety guards read,
the local (account-free) list, the migration ladder, and every path traced in
which a user's edit can be lost, silently overwritten, resurrected, or written
backwards. Audited read-only at working-tree `3381dec` (the architecture map's
`94e12cf` plus one documentation commit); no repository file was modified.

Source files read for this report:
`src-tauri/src/commands/list.rs`, `src-tauri/src/commands/auth.rs`,
`src-tauri/src/commands/system.rs`, `src-tauri/src/db.rs`,
`src-tauri/src/lib.rs`, `src-tauri/src/library.rs`,
`src-tauri/src/backups.rs`, `src-tauri/src/background.rs`,
`src-tauri/src/playback/scrobbler.rs`, `src-tauri/src/anilist/client.rs`,
`src/hooks/useListMutations.ts`, `src/api/anilist.ts`, `src/lib/syncQueue.ts`,
`src/lib/receipt.ts`, `src/lib/mergeDecision.ts`,
`src/components/overlays/SignInMerge.tsx`,
`src/components/media/NowPlayingCard.tsx`,
`src/pages/settings/AdvancedPane.tsx`, `src/pages/MediaList.tsx`,
`src/app/main.tsx`.

Findings carrying an `A1-` prefix come from the data-integrity pass, `A2-` from
the scrobbling pass, `A4-` from the database pass; the numbering is shared with
the sibling reports. Every severity below is the one the adversarial
verification returned, not the one originally filed. Account **ownership**
scoping — which account a queued row or a cached list belongs to — is reported
in `ACCOUNT_ISOLATION.md`; the cross-references are listed at the end.

## Findings at a glance

| ID | Severity | Category | File:Line | Summary |
|---|---|---|---|---|
| A1-03 | P2 | DATA INTEGRITY RISK | `src-tauri/src/playback/scrobbler.rs:728` | The scrobbler's two "never move progress backwards" guards read a SQLite cache that no manual or bulk save ever updates |
| A4-02 | P2 | DATA INTEGRITY RISK | `src-tauri/src/commands/system.rs:248` | Enabling portable mode strands every subsequent write in a database the next launch will not open |
| A1-14 | P2 | DATA INTEGRITY RISK | `src-tauri/src/commands/list.rs:516` | A deleted entry is never removed from `list_cache`, so playing that title scrobbles it back into existence |
| A1-02 | P2 | BUG | `src-tauri/src/commands/list.rs:525` | `delete_list_entry` treats a skipped drain as a successful one and deletes live, letting a queued save recreate the entry |
| A1-15 | P3 | DATA INTEGRITY RISK | `src-tauri/src/commands/list.rs:825` | The dedupe deletes the superseded queue row and inserts the new one as two statements; a failure in between loses the edit |
| A1-18 | P3 | DATA INTEGRITY RISK | `src-tauri/src/playback/scrobbler.rs:755` | `perform_update` ignores `MutationResult.queued`, so a merely queued scrobble patches the cache and reports "Updated" |
| A2-10 | P3 | BUG | `src-tauri/src/db.rs:756` | `update_cached_progress` cannot insert, so a scrobble that *creates* an entry leaves the cache reporting progress 0 |
| A1-05 | P3 | DATA INTEGRITY RISK | `src-tauri/src/db.rs:756` | `update_cached_progress` is a read-modify-write across two lock acquisitions and can discard a freshly fetched list |
| A1-06 | P3 | BUG | `src/hooks/useListMutations.ts:186` | A queued (unsynced) write gets the same green success receipt as one that reached AniList |
| A4-21 | P3 | DATA INTEGRITY RISK | `src-tauri/src/lib.rs:356` | A database that fails to open bricks the app, and the only documented restore path runs through the app that will not start |
| A4-01 | P3 | BUG | `src-tauri/src/db.rs:499` | `has_column` is evaluated outside the migration transaction; two Android connections can fail a launch and stamp `user_version` backwards |
| A1-10 | P3 | MISSING TEST | `src-tauri/src/commands/list.rs:1082` | The stateful half of the queue — ordering, removal-after-confirmation, the three `skipped` exits — has no test at all |
| A1-04 | P4 | IMPROVEMENT | `src-tauri/src/commands/auth.rs:206` | Queued rows survive a sign-out but are invisible in every surface until the same account signs back in |
| A4-06 | P4 | DATA INTEGRITY RISK | `src-tauri/src/library.rs:663` | One scan is published as two transactions, so a crash between them shows a file as both matched and unplaced |
| A4-07 | P4 | DATA INTEGRITY RISK | `src-tauri/src/library.rs:1118` | An atomically-planned redirect change is applied as loose statements, deletes first, so a failure loses a confirmed split |
| A4-05 | P4 | DATA INTEGRITY RISK | `src-tauri/src/db.rs:525` | No guard against a `user_version` from the future; an older binary then writes queue rows nothing can ever read |
| A1-07 | P4 | BUG | `src/hooks/useListMutations.ts:274` | A partial bulk failure recovers by refetching, which offline serves a cache the bulk edit never touched |
| A1-08 | P4 | BUG | `src/api/anilist.ts:227` | The local-mode bulk loop has no partial-progress contract, so one failure rolls the screen back over rows already written |
| A1-11 | P4 | BUG | `src-tauri/src/db.rs:324` | `MIGRATION_V16` calls `json_extract` on stored text without `json_valid`, which aborts startup on a malformed blob |
| A4-20 | P4 | DATA INTEGRITY RISK | `src-tauri/src/library.rs:553` | The scan's two `kv` hints are autocommitted after `persist`, so they can describe the previous scan |
| A1-09 | P4 | BUG | `src-tauri/src/commands/list.rs:1024` | `SyncStatus.connected` is derived from the cached viewer alone, so local mode can report a connected account |
| A2-09 | P4 | DATA INTEGRITY RISK | `src-tauri/src/playback/scrobbler.rs:376` | `shift_episode` clamps an impossible mapping to episode 1 instead of refusing |
| A4-13 | P4 | IMPROVEMENT | `src-tauri/src/db.rs:328` | The v16 backfill drops unattributable queued edits with no log line, count or bell row |
| A4-16 | P4 | MISSING TEST | `src-tauri/src/db.rs:1772` | The half-migrated-database test never puts a row in the queue, so it cannot check what v16 did to it |

---

ID: A1-03
Severity: P2
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs
Line: 728–743 (with 604–618 and 712–713)
Function: `perform_update` / `block_reason` / `would_regress`

Problem:
The scrobbler's two "never move progress backwards" guards read the SQLite
`list_cache`, and no manual or bulk save path ever updates that cache. The
guard's data source is therefore stale by exactly the user's own most recent
edits.

* `perform_update` reads the progress it compares against from
  `candidates_from_cache` (`scrobbler.rs:728–737`), which reads
  `db.cached_list(user_id, media_type)` (`scrobbler.rs:263–272`).
* `block_reason` compares against `np.progress`, built from the same source
  (`scrobbler.rs:1103–1106`, `333–336`).
* `db.update_cached_progress` — the only writer that patches an entry in place
  (`db.rs:756–786`) — has exactly one caller: `perform_update` itself
  (`scrobbler.rs:759`).
* `save_entry_core` (`list.rs:320–370`) and `bulk_save_list_entries`
  (`list.rs:472–512`) touch nothing local.
* `db.cache_list` has exactly one non-test caller: a successful
  `fetch_media_list` (`list.rs:278`).

Expected Behavior:
`would_regress` is described in its own doc comment as "a data-safety rule, not
a UI one" (`scrobbler.rs:700–711`). It should compare the episode about to be
written against the entry's real current progress, which after a manual edit is
the value the user just set.

Actual Behavior:
Between a manual or bulk save made from the list screen and the next successful
list fetch, the cache holds the pre-edit progress and status. In that window
both `block_reason` and `would_regress` see the old number, so a scrobble of an
episode *below* the user's freshly-set progress passes both guards and writes an
absolute `{"mediaId": M, "progress": episode, "status": …}` (`scrobbler.rs:751`)
that regresses the server value — and, if `total != episode`, also rewrites
`COMPLETED` back to `CURRENT` (`scrobbler.rs:745–750`).

Reproduction:
1. Entry M is cached at `progress: 4, status: CURRENT` from the last list fetch.
2. On the list screen, set M to `progress: 24, status: COMPLETED`.
   `save_entry_core` writes it to AniList; `list_cache` is untouched; nothing
   refetches (`staleTime: 5 * 60 * 1000`, `src/app/main.tsx:23`, and
   `useListMutations`'s `save`/`bulkSave`/`remove` never invalidate
   `["mediaList"]`).
3. Play episode 5 of M. Detection builds `NowPlaying` from
   `candidates_from_cache` → `progress = 4`. `block_reason(np, 5, 4)`: `5 > 4`
   and `5 <= 4 + 1`, so `Phase::Watching` (`scrobbler.rs:611–616`).
4. The threshold elapses; `perform_update(episode = 5)` runs
   `would_regress(5, Some(4), "CURRENT")` → `false` and writes
   `progress: 5, status: CURRENT`.
5. AniList entry M goes from `24 / COMPLETED` to `5 / CURRENT`.

The offline variant removes the timing constraint: step 2 queues
`save:M:notes,private,progress,repeat,score,status` (progress 24) and step 4
queues `save:M:progress,status` (progress 5) — different field sets, so
`queue_key` keeps both (`list.rs:813–816`) and the drain replays them in id
order (`db.rs:808–811`). The scrobble's 5 lands after the editor's 24.

Impact:
Silent loss of a user's explicit progress/status edit, written by a background
process, with no toast and no undo. This is the exact class `would_regress` was
added to prevent; the guard is real but is fed from a store the write paths do
not keep current.

Root Cause:
Two caches of the same fact — React Query's `ListResult` (patched optimistically
on every save) and SQLite's `list_cache` (only refreshed by a full fetch) — with
the scrobbler's safety check reading the one the saves do not maintain.

Recommended Fix:
Call `db.update_cached_progress` (or a widened sibling carrying score, volumes
and dates) from `save_entry_core` on a successful *or* queued save, and from
`bulk_save_list_entries` for each accepted chunk. `update_cached_progress`
already handles the "no cache yet" case (`db.rs:764–766`). Re-reading the entry
from AniList before each write is the alternative, but it spends a request per
scrobble against the ~30/min budget.

Regression Tests Required:
* A Rust test: seed `list_cache` with `progress: 4`, run a save that sets
  `progress: 24`, assert `candidates_from_cache` now reports 24.
* A `would_regress` test driven from the cache rather than from a literal, so a
  future change of source is caught.

Confidence: HIGH. The call graph was re-verified by grep during verification:
`update_cached_progress` has exactly one caller and neither save path is it.
Verification correction: saves made from `MediaCard.tsx:48` (discovery/search
cards) and `AnimeDetail.tsx:1449` *do* invalidate `["mediaList", type]`, so an
edit from those two surfaces refreshes `list_cache` on the next refetch. The
list screen's own editor and `+1` (`MediaList.tsx:296`) do not, which is the
busiest path.

---

ID: A4-02
Severity: P2
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/commands/system.rs
Line: 248–284 (with `src-tauri/src/portable.rs:78–85`, `src-tauri/src/lib.rs:356`,
`src-tauri/src/backups.rs:104`, `src/pages/settings/AdvancedPane.tsx:203–215`)
Function: `enable_portable`

Problem:
`enable_portable` snapshots the live database into the portable folder and
writes the `karasu.portable` marker, but the running process keeps its already
open `Connection` on the AppData file. `portable::is_portable()` is a live
filesystem check, so from that moment the app is half-switched: new path
resolutions go to the portable folder while every write still lands in the old
database.

Expected Behavior:
Either the switch is deferred entirely until the next launch (nothing changes
behaviour now), or the user is required to restart before continuing.

Actual Behavior:
1. `db.snapshot_to(&dest)` copies the database as of T0.
2. `create_marker()` (`system.rs:283`) makes `is_portable()` true immediately.
3. `Db` was opened once at `lib.rs:356` against the AppData path and is never
   reopened, so every subsequent scrobble, list-cache write, offline-queue push,
   library index row, notification and setting is written to the AppData file.
4. `backups::run_once` recomputes `crate::portable::data_dir(base)` on every
   pass (`backups.rs:104`), so from T0 the daily backups are written into the
   *portable* folder while snapshotting the AppData connection.
5. On the next launch `data_dir` resolves to the portable folder and the app
   comes up on the T0 snapshot. Everything written between T0 and the restart is
   absent from the active database.

The UI does not force the restart: `AdvancedPane.tsx:210` sets a flag that
renders `settings.portableRestart` — "Restart Karasu for this to take effect."
(`i18n/en.ts:1486`) — a passive hint whose wording implies nothing has changed
yet.

Reproduction:
Enable portable mode; keep the app running and watch a few episodes so the
scrobbler writes progress, and make an edit while the connection is flaky so the
offline queue takes a row; restart. The scrobbled progress and the queued edits
are absent from the portable database the app now opens.

Impact:
Silent reversion of a session's work. The old file is not deleted
(`PortableStatus::other` still reports it, `system.rs:224`), so it is
recoverable by hand — but the user is given no reason to suspect anything was
lost, and the offline queue is the sharp edge: unsynced edits made after T0 are
stranded in a database the app will not open again.

Root Cause:
`is_portable()` is evaluated live while the database handle is bound once at
startup, and the snapshot is taken at toggle time rather than at shutdown.

Recommended Fix:
After `create_marker()` succeeds, call `app.restart()` so no writes can occur
against the stale handle — the only version with no window at all. Failing that,
block the UI on an explicit "Restart now" and refuse other writes in between.

Regression Tests Required:
Not unit-testable as written (it needs a live `AppHandle`). The testable half:
assert that `enable_portable` leaves the process's `Db` pointing at the
pre-toggle path, so the invariant lives in a test rather than in prose.

Confidence: HIGH (verified end to end: `Db` is constructed once at `lib.rs:356`
against `portable::data_dir(...)` as resolved at startup and never reopened;
`enable_portable` snapshots at T0 and writes the marker last; `backups::run_once`
recomputes the directory every pass).

---

ID: A1-14
Severity: P2
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/commands/list.rs
Line: 516–543 (with `src-tauri/src/db.rs:756–786`,
`src-tauri/src/playback/scrobbler.rs:263–272` and
`src/hooks/useListMutations.ts:313–325`)
Function: `delete_list_entry` (with `Db::update_cached_progress` and
`candidates_from_cache`)

Problem:
Deleting a list entry writes nothing local. `delete_list_entry` issues
`DELETE_MUTATION` and returns; `db.rs` offers `update_cached_progress` and no
removal counterpart; `remove.onSuccess` filters the row out of the React Query
cache only. The deleted entry therefore stays in `list_cache` — the store the
scrobbler matches against — until the next successful `fetch_media_list`.

Expected Behavior:
An entry the user has removed from their list must not be a scrobble candidate.
Either the delete removes it from `list_cache`, or the cache is invalidated so
the next detection pass cannot see it.

Actual Behavior:
`candidates_from_cache` (`scrobbler.rs:263–302`) keeps returning the deleted
media id with its old progress. Playing that title builds a `NowPlaying` against
it, and when the threshold elapses `perform_update` sends
`SaveMediaListEntry(mediaId:, progress:, status:)` (`scrobbler.rs:751`), which
**creates an entry when none exists**. The entry the user just deleted is back
on their AniList list, with only the fields the scrobble carried and AniList
defaults for the rest.

Reproduction:
1. Remove entry M from the list (confirm dialog). AniList deletes it; the row
   disappears from the screen.
2. Do not visit a list page and do not let a list query refetch (`staleTime` is
   5 minutes, `src/app/main.tsx:23`).
3. Play an episode of M. Detection matches it from `list_cache`, which still
   holds it, and the countdown starts.
4. The threshold elapses. `perform_update` writes progress to M and AniList
   re-creates the entry.

Impact:
A deletion the user confirmed is silently undone by a background process, and
the recreated entry has lost score, notes, tags, dates, repeat count and
volumes. Same family as A1-03, reached through a path A1-03 does not name (it
lists only `save_entry_core` and `bulk_save_list_entries` as paths that leave
the cache stale).

Root Cause:
Local cache maintenance is expressed only as "patch a progress"; there is no
"forget this entry", and the delete command was written as a pure AniList call.

Recommended Fix:
Add `Db::forget_cached_entry(user_id, media_type, media_id)` (the same
read-modify-write shape as `update_cached_progress`, fixed per A1-05 to hold one
guard) and call it from `delete_list_entry` after a successful delete. On a
queued delete, mark it too — a delete that has not reached AniList still means
the user does not want it scrobbled. Widening `bulk_remove` the same way is part
of the same change.

Regression Tests Required:
* A `mem_db()` test that a cached list with entry M, after
  `forget_cached_entry(M)`, yields a `candidates_from_cache` set without M.
* A Rust test that `delete_list_entry` on a successful delete removes the entry
  from `list_cache`.

Confidence: HIGH. Source: found during adversarial verification. Re-read for
this report: `delete_list_entry` (`list.rs:516–543`) contains no `Db` write
other than `queue_push_deduped`; `db.rs` between `cache_list` (`682`) and the
queue section (`790`) contains no removal helper; `remove.onSuccess`
(`useListMutations.ts:313–325`) patches only the query cache.

---

ID: A1-02
Severity: P2
Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/list.rs
Line: 525–535
Function: `delete_list_entry`

Problem:
`delete_list_entry` matches only two of the three outcomes `process_queue` can
return. `Drained::skipped` (`list.rs:750–757`) — "another drain holds the lock,
this call did nothing at all" — falls into the `Ok(drained)` arm and is treated
as a successful drain:

```rust
if pending(&db) > 0 {
    match process_queue(&db, &api, Some(&token)).await {
        Ok(drained) => report_dropped(&app, &drained.dropped),   // skipped lands here
        Err(_) => { queue_push_deduped(&db, "delete", …)?; return … }
    }
}
match api.query(Some(&token), DELETE_MUTATION, input.clone()).await { … }
```

Its sibling `save_entry_core` handles exactly this case and says why
(`list.rs:341–345`): "A drain that skipped leaves the queue standing, so it takes
the same exit as a drain that failed. Otherwise this write goes out live while a
concurrent drain still holds older rows for the same entry, and the older one
lands on top of it." `bulk_save_list_entries` handles it too, by refusing with
`queue.busy` (`list.rs:461–470`). The delete path is the one that does not.

Expected Behavior:
When a concurrent drain is in progress, a delete must not be issued live ahead
of queued rows that drain still holds — it should queue instead, exactly as
`save_entry_core` does.

Actual Behavior:
The `DELETE_MUTATION` is sent immediately (`list.rs:535`) while the other
drain's snapshot (taken once at `list.rs:916`, before any row was removed) may
still contain an unsent `save` for the same media. `process_queue` replays that
save after the delete has landed, and `SaveMediaListEntry(mediaId:)` creates an
entry when none exists — so the entry the user just removed comes back, with
only the fields that save carried and AniList defaults for everything else.

Reproduction:
1. Offline, edit entry X (media id M) — a `save` row is queued.
2. Come back online and mount the Dashboard: `fetch_media_list` starts a drain
   (`list.rs:255`) which takes `DRAIN` (`list.rs:905`). The client paces itself
   and sleeps out `Retry-After` on a 429, so this drain can be in flight for
   seconds to minutes.
3. While it is in flight, remove entry X. `pending(&db) > 0` (the row is not
   removed until its response lands, `list.rs:940–943`) → `process_queue` →
   `DRAIN.try_lock()` fails → `Ok(Drained { skipped: true })` → falls through to
   the live `DELETE_MUTATION`.
4. The drain reaches the queued `save` for M and sends it. The entry is
   recreated.

Impact:
A deletion the user confirmed silently reverts, and the resurrected entry has
lost every field the queued save did not carry (score, notes/tags, dates,
repeat, volumes). `remove.onSuccess` has already filtered the row out of the
React Query cache (`useListMutations.ts:313–325`), so the UI shows it gone until
the next fetch brings it back — the user sees a delete that un-did itself.

Root Cause:
`Drained` carries `skipped` as a distinct fact precisely so callers cannot
confuse it with "the queue was empty" (`list.rs:750–757`), and two of the three
mutating callers act on it. `delete_list_entry` was not updated when the flag was
introduced.

Recommended Fix:
Mirror `save_entry_core:346–353` exactly:

```rust
if pending(&db) > 0 {
    match process_queue(&db, &api, Some(&token)).await {
        Ok(drained) if !drained.skipped => report_dropped(&app, &drained.dropped),
        _ => {
            queue_push_deduped(&db, "delete", &input.to_string())?;
            return Ok(MutationResult { queued: true, entry: None });
        }
    }
}
```

Regression Tests Required:
* A test that with `DRAIN` held, `delete_list_entry` returns
  `MutationResult { queued: true, .. }` and issues no `DeleteMediaListEntry`.
* A shared test asserting all three mutating entry points (`save_entry_core`,
  `bulk_save_list_entries`, `delete_list_entry`) take a non-live exit on
  `skipped`, so the next one added cannot forget.

Confidence: HIGH (verified verbatim; the omission is unambiguous and the fix is
three lines. It needs a concurrent drain *and* a queued save for the same media,
so it is uncommon.)

---

ID: A1-15
Severity: P3
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/commands/list.rs
Line: 825–835 (with `src-tauri/src/db.rs:795–804` and `828–831`)
Function: `queue_push_deduped`

Problem:
The dedupe removes the superseded row and inserts the replacement as two
independent autocommitted statements, taking the connection mutex twice:

```rust
if let Some(key) = queue_key(kind, payload) {
    for row in db.queue_all(user_id) {
        if queue_key(&row.kind, &row.payload).as_deref() == Some(key.as_str()) {
            db.queue_remove(row.id);
        }
    }
}
db.queue_push(user_id, kind, payload)
```

`db.queue_remove` (`db.rs:828–831`) and `db.queue_push` (`db.rs:795–804`) each
take `self.0.guard()` and commit on their own.

Expected Behavior:
Replacing a queued edit is one logical operation: after it, the queue holds
either the old row or the new one, never neither.

Actual Behavior:
The delete runs first and commits. If the insert then fails — disk full,
`SQLITE_BUSY` outliving the 5 s `busy_timeout` set at `db.rs:521`, or the process
dying in between — the superseded edit is already gone and the replacement never
lands. The user's edit is lost outright, and the caller's `?` surfaces only "the
save failed", which the frontend renders as a retry toast for the *new* edit
(`useListMutations.ts:222–232`); nobody is told the older queued edit went with
it.

Reproduction:
1. Offline, set entry M to `progress: 12`. One row queued.
2. Offline, set entry M to `progress: 13` (same field set, so the same
   `queue_key`).
3. Make the `INSERT` at `db.rs:797` fail — a read-only data dir, a full disk, or
   a second connection holding the write lock past the busy timeout (the Android
   `JobScheduler` connection called out at `db.rs:515–520`).
4. `offline_queue` now holds neither row: the `progress: 12` edit was deleted and
   the `progress: 13` edit never inserted. The pending badge falls to zero and
   the change is on no list.

Impact:
Silent, permanent loss of a queued edit — the one thing the offline queue exists
to prevent. Requires a write failure, so it is rare; the loss when it happens is
total for that entry, and the app reports it as an ordinary failed save.

Root Cause:
The `Db` helpers are per-statement and cannot be composed by a caller, so the
delete-then-insert has no transaction spanning it. `notif_insert`
(`db.rs:1091–1108`) is the in-file pattern for taking the guard once across a
multi-statement operation.

Recommended Fix:
Add `Db::queue_replace(user_id, kind, payload, superseded_ids: &[i64])` (or pass
the dedupe key down) that opens one transaction, deletes the matching rows and
inserts the replacement inside it. `queue_push_deduped` then makes one call.

Regression Tests Required:
* A `mem_db()` test that a failing insert leaves the superseded row in place
  (inject the failure, or assert the shape structurally: exactly one `guard()`).
* A test that a successful replace leaves exactly one row and it is the new one.

Confidence: HIGH. Source: found during adversarial verification. Re-read for
this report: both `Db` methods take and drop their own guard, and
`queue_push_deduped` has no transaction around them.

---

ID: A1-18
Severity: P3
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs
Line: 751–781
Function: `perform_update`

Problem:
`perform_update` discards `save_entry_core`'s `MutationResult`:

```rust
crate::commands::save_entry_core(app, &db, &api, &token, input).await?;

// Patch the local cache so the next detection sees the new state
if let Some(user_id) = cached_user_id(&db) {
    db.update_cached_progress(user_id, media_type, media_id, episode, Some(status));
    crate::widgets::refresh(app);
}
…
let _ = app.emit("scrobble-done", json!({ "mediaId": media_id, "episode": episode }));
```

`save_entry_core` returns `Ok(MutationResult { queued: true, entry: None })`
when the write only reached the offline queue (`commands/list.rs:346–363`), so
the `?` succeeds and every downstream step runs as though AniList had accepted
it.

Expected Behavior:
The local cache should record what the account holds. A write that is still
queued has not changed the account, and the scrobble should be reported as
pending rather than done.

Actual Behavior:
A queued scrobble patches `list_cache` to the new progress, refreshes the
widgets, emits `now-playing` with the new number and emits `scrobble-done`, so
the card shows "Updated". If that queued row is later dropped as permanently
rejected (`list.rs:944–953`), the cache holds progress the account never
received — and `would_regress` (`scrobbler.rs:712–713`), which reads that cache,
will then refuse the correct re-scrobble of the same episode, because it looks
like a backwards write.

Reproduction:
1. Go offline. Play an episode past the threshold. `save_entry_core` queues the
   payload and returns `queued: true`; the card shows the scrobble as done and
   `list_cache` now says progress N.
2. Come back online in a state where the drain drops the row permanently — an
   `Api` rejection, e.g. the entry was deleted on anilist.co in the meantime
   (`list.rs:944–953` removes it and reports it via `report_dropped`).
3. Play the same episode again. `candidates_from_cache` reports progress N;
   `block_reason`/`would_regress` see `episode <= N` and refuse, so the episode
   cannot be written until a successful list fetch rewrites the cache.

Impact:
The local cache — which backs detection, the widgets, the offline fallback and
the scrobbler's own guards — records progress the account does not have, and the
guard built on it then blocks the write that would fix it. The user is told the
episode was tracked when it was not.

Root Cause:
`perform_update` treats `Ok(_)` from `save_entry_core` as "the server has it",
while `MutationResult.queued` exists precisely to distinguish the two.

Recommended Fix:
Bind the result: on `queued: true`, skip `update_cached_progress` (or record it
as pending in a way the drain confirms) and emit a distinct phase — the
now-playing card already renders a blocked/pending state — instead of
`scrobble-done`. When the drain later confirms the row, patch the cache then.

Regression Tests Required:
* A Rust test that `perform_update` with a queued `save_entry_core` result does
  not call `update_cached_progress` (needs the seam A1-10 asks for).
* A test that the emitted phase for a queued scrobble differs from the one for a
  confirmed scrobble.

Confidence: HIGH. Source: found during adversarial verification (raised
independently by both the data-integrity and the scrobbling verification pass).
Re-read for this report: `scrobbler.rs:755` is a bare `…await?;` with no binding,
and lines 758–781 run unconditionally afterwards.

---

ID: A2-10
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/db.rs
Line: 756–786 (with `src-tauri/src/playback/scrobbler.rs:757–762` and
`src/components/media/NowPlayingCard.tsx:106–117`)
Function: `Db::update_cached_progress`

Problem:
After a scrobble that *creates* a list entry — the documented "off-list forced
entry" path (`scrobbler.rs:385–387`) — the SQLite list cache is not updated,
because `update_cached_progress` only patches an entry already present in the
cached payload. The only other refresher is the frontend's `scrobble-done`
listener, which lives inside `NowPlayingCard`, mounted only on the Dashboard
(`src/pages/Dashboard.tsx:114`).

Expected Behavior:
Once an entry exists on AniList, the next episode of the same title should
resolve against a progress of N, not 0.

Actual Behavior:
```rust
let Some(payload) = self.cached_list(user_id, media_type) else { return; };
… for entry … if entry["mediaId"] == media_id { entry["progress"] = progress.into(); }
```
An id that is not in the payload matches nothing, and the function writes the
payload back unchanged. There is no insert path.

Reproduction:
1. Use the correction picker to point a detected title at an AniList entry that
   is not on the list (the picker searches all of AniList precisely for this,
   `MatchPicker.tsx:16–27`).
2. Watch episode 1. `resolve_match` returns `progress: None` →
   `progress.unwrap_or(0) == 0` → `Watching` → `perform_update` writes progress 1
   and creates the entry. `update_cached_progress` no-ops.
3. Navigate away from the Dashboard (or leave the app in the tray on any other
   route) so the `scrobble-done` listener is unmounted.
4. Watch episode 2. `candidates_from_cache` still does not contain the id →
   progress 0 → `block_reason(np, 2, 0)` → `EpisodeGap { 2, 0 }`. Every further
   episode is gap-blocked with the same untrue "your progress is 0".

Impact:
Automatic tracking stops for that title until something refetches the list, and
the block text states a progress that is not true. Self-healing — a live list
fetch rewrites the whole cache (`commands/list.rs:278`) — and masked whenever the
user is on the Dashboard or opens a list page.

Root Cause:
Cache maintenance after a write is split between Rust (patch in place) and the
frontend (invalidate and refetch), and the Rust half cannot express "insert".

Recommended Fix:
Give `update_cached_progress` a boolean return and, when it patched nothing,
have the scrobbler insert the entry into the cached payload (it holds the media
object it matched) or trigger a single-entry fetch. Clearing the cache is not an
option — an empty `candidates_from_cache` is worse.

Regression Tests Required:
`db.rs`: a `mem_db()` test asserting `update_cached_progress` reports whether it
patched anything, with a `media_id` absent from the payload.

Confidence: HIGH (mechanism; all three call sites read). MEDIUM that the
listener is genuinely absent off-Dashboard — the mount point is unique by grep,
but this was not confirmed by running the app.

---

ID: A1-05
Severity: P3
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/db.rs
Line: 756–786
Function: `update_cached_progress`

Problem:
`update_cached_progress` is a read-modify-write over the whole `list_cache`
payload performed across two separate acquisitions of the connection mutex:

```rust
let Some(payload) = self.cached_list(user_id, media_type) else { … };    // lock taken and released
let Ok(mut lists) = serde_json::from_str::<serde_json::Value>(&payload) … // parse (no lock)
…                                                                        // patch one entry (no lock)
let _ = self.cache_list(user_id, media_type, &lists.to_string());        // lock taken again
```

`cached_list` (`db.rs:744–752`) and `cache_list` (`db.rs:682–698`) each take
`self.0.guard()` and drop it on return, so nothing holds the lock across the
parse and re-serialize.

Expected Behavior:
A scrobble's one-entry patch should not be able to discard a whole list another
writer stored in between.

Actual Behavior:
`fetch_media_list` writes the freshly fetched list with
`db.cache_list(user_id, media_type, &lists.to_string())` (`commands/list.rs:278`)
from a command task, while `perform_update` calls `update_cached_progress` from
the scrobbler's background task (`scrobbler.rs:759`). If the fetch's `cache_list`
lands between the read and the write, the scrobbler writes back the payload it
read *before* the fetch, plus its one patched entry. The freshly fetched list is
silently lost.

Reproduction (by inspection; the window is the JSON parse plus re-serialize of
the whole list, milliseconds on a 638-entry payload — the size `LIST_QUERY`'s own
comment measures at `commands/list.rs:15–23`):
1. A scrobble fires; `update_cached_progress` reads the cache and begins parsing.
2. A list mount completes its `LIST_QUERY` and calls `cache_list` with the new
   payload.
3. `update_cached_progress` finishes and overwrites it with the old one.

Impact:
No AniList write is affected. Locally the cache — which backs the offline
fallback (`list.rs:291–306`), the widget projection (`list.rs:284`), the library
scanner's candidate set (`library.rs:417`) and the scrobbler's own safety guards
(A1-03) — reverts to a stale snapshot until the next successful fetch.

Root Cause:
Read-modify-write on a serialized blob without holding the mutex for the whole
operation. Every other multi-statement method in this file takes the guard once
(`notif_insert`, `db.rs:1091–1108`, is the pattern).

Recommended Fix:
Take the guard once for the whole function and inline the two SQL statements, or
wrap the pair in a transaction with the guard held. `snapshot_to`
(`db.rs:711–716`) already documents that taking the same mutex every other writer
takes is the mechanism relied on here.

Regression Tests Required:
The race itself is hard to test deterministically; the testable assertion is
structural — a test (or a review-level rule) that `update_cached_progress`
performs exactly one `self.0.guard()`.

Confidence: HIGH for the code shape (two lock acquisitions, verified by reading
`cached_list` and `cache_list`); MEDIUM that it is hit in practice — the
interleave requires a scrobble completion to land inside one list-fetch write.
Note: `A4-08` is the same defect found independently by the database pass, where
it was filed at P4; the higher of the two verified severities is kept here.

---

ID: A1-06
Severity: P3
Category: BUG

File: /home/user/Karasu/src/hooks/useListMutations.ts
Line: 186–221
Function: `save` mutation `onSuccess`

Problem:
`saveListEntry` resolves to `MutationResult { queued, entry }`
(`src/api/types.ts:243`, produced at `commands/list.rs:311–316`), where
`queued: true` means "this write never reached AniList; it is sitting in the
offline queue". `useListMutations` never reads that field. A repo-wide grep finds
`.queued` read only in `SignInMerge.tsx:150` and `:171`, where it correctly
refuses to clear a local row on a queued push, plus the panel's counts.

Expected Behavior:
A write that has not reached the server should be reported differently from one
that has — as the merge dialog already does, and as `MediaList`'s pending banner
does at the list level (`MediaList.tsx:657–662`).

Actual Behavior:
Offline, `save_entry_core` catches the retryable failure, queues the payload and
returns `Ok(MutationResult { queued: true, entry: None })`
(`commands/list.rs:360–363`). React Query treats that as a success, so
`onSuccess` fires and shows a green receipt — `t("receipt.progress")` and
siblings (`useListMutations.ts:213–220`) — identical to a synced write, complete
with an Undo action that will itself only queue. The same holds for `remove`,
whose `onSuccess` deletes the row from the cache on a `queued: true` result
(`useListMutations.ts:313–325`).

The list-level pending banner does not close the gap in time: it reads
`data.pending`, recomputed only when a list query refetches
(`commands/list.rs:287`, `302`), and no save invalidates the list query. With
`staleTime: 5 * 60 * 1000` (`src/app/main.tsx:23`) the badge can lag the edit by
minutes or until the next mount.

Reproduction:
1. Disconnect the network.
2. Press `+1` on a list row. Rust queues the edit and returns `queued: true`.
3. A green "Read 5 of <title>" toast appears with an Undo button; the sidebar
   badge and the amber pending banner are both unchanged.

Impact:
The user is told a write landed when it did not. On a tracker whose proposition
is "your progress is on AniList", this is the one assurance that has to be
honest — and it is the same class the codebase already fixed twice elsewhere
(`report_dropped`, `list.rs:959–976`; the merge's queued tally).

Root Cause:
The flag exists end to end and is simply not consumed on the busiest path.

Recommended Fix:
In `onSuccess`, branch on `res?.queued`: emit a distinct receipt (a
"saved — will sync" line, kind `"info"` rather than `"success"`), and either
suppress the Undo or label it as acting on the queued edit. Optionally bump the
sidebar's pending count immediately rather than waiting for a refetch. Add the
German keys alongside (`de: typeof en`).

Regression Tests Required:
* A `.dom.test.tsx` asserting that a mutation resolving `{ queued: true }`
  renders the queued receipt and not the plain success one.
* The `i18nKeys` pass covers the new literal `t("…")` keys automatically.

Confidence: HIGH (verified: the flag is produced at `list.rs:311–316` and set
true at `361–363`, `529–531`, `538–540`, and is never read in the hook).

---

ID: A4-21
Severity: P3
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/lib.rs
Line: 356–359 (with `src-tauri/src/commands/system.rs:575–596` and
`src-tauri/src/backups.rs:82–136`)
Function: `setup` / `Db::open`

Problem:
Any error from `Db::open` — corruption, a disk fault, a failed migration — is
mapped into a failed `setup`, so the app does not start:

```rust
app.manage(db::Db::open(data_dir).map_err(|e| {
    logging::error("db", format!("cannot open the database: {e}"));
    std::io::Error::other(e)
})?);
```

There is no in-app recovery. Daily verified backups sit beside the file
(`backups.rs:82–136`), but the only documented way to use one is to replace
`karasu.db` by hand while the app is closed, and the affordance for finding them
— `open_backup_dir` (`system.rs:585–596`) — is a Tauri command inside the app
that will not start.

Expected Behavior:
An install whose database cannot be opened should still reach a state where the
user can act: a message naming the file and the backup folder, an offer to
restore the newest verified backup, or a start with the database disabled.

Actual Behavior:
The window never appears. On Windows `main.rs` sets
`windows_subsystem = "windows"`, so there is no console either; the only record
is the `logging::error` line written to `karasu.log` a moment earlier
(`lib.rs:355` initializes logging before the open, deliberately). A
non-technical user sees an app that silently fails to launch.

Reproduction:
1. Corrupt or truncate `karasu.db` in the data directory (or reproduce A1-11 or
   A4-01, both of which end in a failed `Db::open`).
2. Launch Karasu. Nothing appears; `karasu.log` holds "cannot open the database".

Impact:
Total loss of access to the app — including to the backups it made — from a
single unreadable file. The data itself is usually still recoverable by hand, so
this is a recoverability gap rather than destruction; A1-11 and A4-05 are two
special cases of it.

Root Cause:
`setup` treats the database as a hard startup dependency, and the restore path
was designed as a manual, app-assisted procedure that assumes the app runs.

Recommended Fix:
Catch the open failure and start a minimal recovery window instead of returning
`Err`: name the file and the backup directory, offer to open the folder, and
offer "restore the newest backup" (`quick_check` already runs on every backup,
`backups.rs:82–136`, so the newest verified file is known). Rename the unreadable
file rather than deleting it.

Regression Tests Required:
* A test that a deliberately corrupt database file produces the recovery path
  rather than an `Err` out of `setup` (the openability half is unit-testable
  against `Db::open`).
* A test that the newest backup selected for restore passes `quick_check`.

Confidence: HIGH. Source: found during adversarial verification. Re-read for
this report: `lib.rs:356–359` and the restore comment at `system.rs:575–583`
("restoring a backup means replacing `karasu.db` with one of these files while
the app is closed").

---

ID: A4-01
Severity: P3
Category: BUG (concurrency / DATA INTEGRITY RISK)

File: /home/user/Karasu/src-tauri/src/db.rs (with
`/home/user/Karasu/src-tauri/src/background.rs`)
Line: db.rs:499–507 (`has_column`), 551, 577, 587, 596, 608 (its five call sites),
493–496 (`apply`); background.rs:84
Function: `Db::open`, `has_column`, `background::check`

Problem:
On Android two connections to `karasu.db` can be open concurrently — the app's
own (`lib.rs:356`) and the JobScheduler notification job's (`background.rs:84`) —
and both run the full migration ladder. The five `ALTER TABLE ADD COLUMN` steps
decide whether to run by calling `has_column` *outside* the transaction that then
performs the ALTER. That is a check-then-act across a shared resource.

Expected Behavior:
Two connections racing an upgrade should serialise: one migrates, the other
observes the finished schema and continues.

Actual Behavior:
Both read `user_version = 15` and both see the column missing. A applies the step
and commits. B's deferred `BEGIN` acquires the write lock only at the ALTER,
waits out A's lock via the 5 s `busy_timeout`, re-prepares against the changed
schema and fails with a duplicate-column error. `apply` maps that to
`Err("Migration v15 failed: …")`, `Db::open` returns `Err`, and if the loser is
the app, `lib.rs:356–359` means it does not start (see A4-21). If the loser is
the job, that notification pass silently does nothing.

The version is read once (`db.rs:525`) and every `apply` stamps an *absolute*
`PRAGMA user_version`, so the losing connection can also stamp the version
**backwards** — e.g. write 9 after the winner wrote 17. That is self-healing only
because every step below the ALTERs is `CREATE TABLE IF NOT EXISTS` and the
ALTERs are guarded.

Reproduction:
Android, app updated from a build at schema ≤ 16 to one at 17. A `NotifJob` fires
while the user cold-starts the updated app, such that both `Db::open` calls
interleave inside the same missing-column window.

Impact:
One failed launch (or one skipped background check) per upgrade in the worst
case, plus a possible backwards `user_version` stamp. Self-limiting: the winner
has already advanced the version, so the next launch takes the
`has_column == true` branch. No data is lost — but "the app will not open after
the update" is the most alarming failure a tracker can have.

Root Cause:
`has_column` is queried outside the `apply` transaction, so its answer can be
stale by the time the DDL executes, and `apply` writes an absolute version rather
than a conditional one. The `busy_timeout` comment at `db.rs:515–521` identifies
the two-connection situation correctly but treats it purely as a lock-wait
problem.

Recommended Fix:
Wrap the whole ladder in a single `BEGIN IMMEDIATE` so the losing connection
blocks at the start and re-reads `user_version` after the winner commits — this
also removes the backwards stamp. Alternatively move the existence check inside
each transaction, and treat a duplicate-column error as success when
`has_column` is true on retry.

Regression Tests Required:
A test that opens two `Connection`s on the same temp-file database at
`user_version = 15` and drives both through the v16 branch (a second thread, or a
manual `BEGIN IMMEDIATE` on connection B to force the interleave), asserting both
`Db::open` calls return `Ok` and the final version is 17.

Confidence: MEDIUM.
Verification: downgraded from P2 — the loser must evaluate `has_column` while the
winner is inside one ALTER transaction, on the single launch after an upgrade,
with the JobScheduler job firing in the same milliseconds; the outcome is one
failed launch or one skipped notification pass and no data loss. SQLite's exact
response (re-prepare, then duplicate-column) is inferred rather than executed,
since Android-only code cannot be run here; the finding stands either way,
because a `SQLITE_SCHEMA` return would also make `apply` fail.

---

ID: A1-10
Severity: P3
Category: MISSING TEST

File: /home/user/Karasu/src-tauri/src/commands/list.rs
Line: 1082–1216 (`mod tests`), against `process_queue` at 897
Function: `mod tests`

Problem:
The queue's *pure* logic is well covered — `queue_key`/`queue_parts` have eight
tests (`list.rs:1088–1189`) and the db-level owner scoping has three
(`db.rs:2348`, `2375`, `2393`, `2419`). The *stateful* logic has none. There is
no test anywhere for:

* `process_queue` ordering (`queue_all` is `ORDER BY id`, `db.rs:808–811`) —
  nothing pins that a later edit cannot be sent before an earlier one;
* the removal-after-confirmation contract (`list.rs:940–943`) — nothing pins that
  a row is not removed before the server answers;
* the retryable-aborts / permanent-drops split (`list.rs:944–953`) — the
  classification is tested in `client.rs`, its consequence for the queue is not;
* the three `skipped` exits (`list.rs:346–353`, `461–470`, `525–533`) — which is
  precisely why A1-02 could regress silently;
* `queue_push_deduped`'s remove-and-reappend (`list.rs:825–835`) — including the
  non-atomicity A1-15 describes;
* the cross-account guarantee *through* `process_queue` rather than through
  `Db::queue_all` alone.

Expected Behavior:
Per CLAUDE.md — "Untestable-by-construction logic in a component is the usual
reason a regression here is invisible until it ships" — the queue's ordering and
its exits deserve tests, since a regression there is a silent data-loss class
rather than a visible failure.

Actual Behavior:
`process_queue` takes `&AniList` concretely, so it cannot be driven without a
network. Nothing exercises it.

Reproduction: n/a (coverage gap).

Impact:
A1-02 is the live proof: an exit its sibling documents as mandatory is missing
from one of three callers and nothing caught it. A1-15 and A1-18 are two more
behaviours no test can currently see.

Root Cause:
`process_queue` is not written against a seam. Extracting the decision — given a
row and an outcome, keep / remove / abort — as a pure function would make almost
all of the above testable in the existing Rust unit suite.

Recommended Fix:
Extract
`fn queue_outcome(err: Option<&ApiError>) -> Outcome { Sent, Drop(String), Abort }`
and test it, plus a small trait or function-pointer seam for `api.query` so the
loop can be driven with a scripted sequence of results.

Regression Tests Required:
The list above.

Confidence: HIGH (verified by enumeration: nothing in the repository constructs
`process_queue`).

---

ID: A1-04
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/commands/auth.rs
Line: 206–213 (with `commands/list.rs:139–141`, `1029–1048`, and
`src/pages/settings/AdvancedPane.tsx:1035–1043`)
Function: `anilist_logout`

Problem:
Keeping the queue across a sign-out is a documented decision (`db.rs:305–321`,
CLAUDE.md v16). Its observability consequence is not documented and has no guard:
the retained rows are invisible in every surface while signed out, because each
of them is scoped through `viewer_id(db)`, which reads the viewer blob
`anilist_logout` has just deleted (`auth.rs:209`):

* `pending(db)` → `viewer_id(db).map_or(0, …)` → 0 (`list.rs:139–141`), so the
  sidebar badge and `ListResult.pending` say nothing;
* `sync_status` → `viewer = None` → `queued: []`, `connected: false`
  (`list.rs:1029–1048`), so the panel lists nothing;
* `QueueSection` in Settings → Advanced renders `NeedsAccount` when
  `mode !== "anilist" || !viewer` (`AdvancedPane.tsx:1035–1043`), hiding the
  per-row discard.

Expected Behavior:
An unsynced edit that is being kept on the user's behalf should be visible to its
owner — at minimum as a count, ideally as a list that can be discarded.

Actual Behavior:
There is no way to see, export or discard them while signed out. They reappear
only when the same account signs back in, at which point the first list mount
drains them (`list.rs:255`) with absolute payloads and no age gate — `created_at`
is stored (`db.rs:401–416`) but read only for the panel's "queued 20 minutes ago"
label (`list.rs:1041`).

Reproduction:
1. Signed in as A, offline: mark a series `COMPLETED, progress 24`. One row
   queued with `user_id = A`.
2. Sign out. Token and viewer deleted (`auth.rs:208–209`); the row stays.
3. Sidebar shows nothing, the Advanced pane refuses, `sync_status` returns an
   empty queue. The edit exists and nothing in the app admits it.

Impact:
An observability gap: the user cannot know an unsent edit is being held, so they
cannot decide to discard it before it is replayed. No data is lost or misdirected
— the rows replay onto their own account, v16 scoping holds.

Root Cause:
The queue's visibility, its owner scoping and its replay trigger are all keyed on
the same value (`kv.anilist_viewer`), which sign-out deletes. Scoping needs that;
visibility does not.

Recommended Fix:
Show the retained rows while signed out: `sync_status` and `QueueSection` can
read the whole table (`SELECT … GROUP BY user_id`) and label rows as belonging to
a signed-out account, with discard scoped by the row's own `user_id` —
`queue_remove_for` already takes it (`db.rs:838–846`). At minimum, say so at the
logout confirm so signing out with a non-empty queue is an informed choice.

Regression Tests Required:
A test that a queue row survives `anilist_logout` *and* is reported by whatever
the signed-out surface becomes, so the invisibility cannot come back.

Confidence: HIGH for the code reads.
Verification: downgraded from P2 — the "replayed over newer server state with no
age bound" half is what an offline queue *is*, and keeping the rows across a
sign-out is a recorded decision (`db.rs:305–321`); the identical outcome follows
from simply being offline for a month without signing out. What remains is the
observability gap.

---

ID: A4-06
Severity: P4
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/library.rs
Line: 663–673
Function: `persist`

Problem:
One scan's result is written as two independent transactions.
`library_replace_all` and `library_replace_unmatched` are each atomic on their
own, but the logical operation "publish this scan" is not — the same reasoning
`library_replace_all`'s own doc comment gives for putting `scores` in the same
transaction as `rows` (`db.rs:1174–1177`).

Expected Behavior:
`library_files` + `library_match` + `library_unmatched` describe one scan or the
previous one, never a mixture.

Actual Behavior:
```rust
db.library_replace_all(&rows, &score_rows)?;         // transaction 1 commits
db.library_replace_unmatched(&data.unmatched_rows()) // transaction 2
```
A crash, a power loss or an error between them leaves the new matched index
beside the previous scan's unplaced list. `hydrate` (`library.rs:832–905`) builds
`files` from `library_all()` and `library_unmatched()` with no reconciliation, so
a path that is now matched and was previously unplaced appears twice — once
placed, once unplaced — and the user is offered a correction for files that are
already indexed.

Reproduction:
Kill the process between the two calls (or induce a disk-full on the second).
Restart: the Library screen shows the same files in both the matched table and
the unplaced list.

Impact:
A confusing inconsistency that survives restarts until the next successful scan.
Correcting a duplicated group writes an override for a title that is already
placed — pointless but harmless. `library_override`, `library_redirect` and
`library_suggestion` are untouched, so no user-entered data is destroyed.

Root Cause:
The transaction boundary sits at the table level rather than at the operation
level, and the two `Db` helpers each own their own transaction, so a caller
cannot compose them.

Recommended Fix:
Add a single `Db` method taking rows, scores and unmatched that performs all the
`DELETE`s and inserts in one transaction; `persist` calls that. (The suggestions
table is genuinely separate — it is written after an `await` — and can stay.)

Regression Tests Required:
A test that a failing insert in the unmatched half leaves `library_files`
unchanged, i.e. the whole publish rolls back.

Confidence: HIGH.
Verification: downgraded from P3 — the trigger is a crash or a write error
precisely between two transactions, the consequence is a confusing display rather
than lost data, and any successful rescan repairs it.

---

ID: A4-07
Severity: P4
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/library.rs
Line: 1118–1123
Function: `set_library_redirect`

Problem:
`plan_redirect` deliberately computes the whole change up front — deletes,
trimmed remnants and new rules — precisely so the decision is atomic and
testable. The application throws that away: the deletes and inserts are executed
as individual autocommitted statements, deletes first.

Expected Behavior:
An atomically-planned change is applied atomically; a failure leaves the previous
split rules exactly as they were.

Actual Behavior:
```rust
for (title, season, ep_from) in &plan.delete { db.library_redirect_clear(...)?; }
for r in &plan.insert                        { db.library_redirect_set(...)?;   }
```
Each call is its own transaction (`db.rs:1405`, `1380`). An error or a crash
after the deletes and before or during the inserts leaves the overlapped rule
deleted and its trimmed remnants unwritten. Because `plan.delete` runs first, the
loss window covers the entire insert loop.

Reproduction:
A three-cour folder with an existing split covering disk 13–36, then a second
split of the current-frame 13–24 (the
`splitting_a_renumbered_row_targets_the_right_files_and_trims` scenario at
`library.rs:1699`). Interrupt after `library_redirect_clear` and before both
`library_redirect_set` calls: `library_redirect` holds neither the old rule nor
the new ones, and the next scan re-merges every episode onto the first season.

Impact:
Loss of user-confirmed season splits — data the schema comment explicitly calls
"User data: a scan must never clear it" (`db.rs:195–196`). The user has to
re-confirm the split, which is two clicks; nothing else is destroyed.

Root Cause:
No transaction spanning the plan's application; the `Db` helpers are per-row.

Recommended Fix:
Add `Db::library_redirects_apply(&plan.delete, &plan.insert)` that opens one
transaction and runs both loops inside it, mirroring `library_replace_all`.

Regression Tests Required:
A `mem_db()` test that a failure during the insert loop leaves the pre-existing
rules intact.

Confidence: HIGH.
Verification: downgraded from P3 — the window is three or four single-row
statements with no I/O of consequence, and what is lost is a user confirmation
that can be redone in two clicks rather than stored content.

---

ID: A4-05
Severity: P4
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/db.rs
Line: 525–615 (the migration ladder), 808 and 863 (`queue_all` / `queue_len`)
Function: `Db::open`, `Db::queue_all`, `Db::queue_len`

Problem:
`Db::open` has no guard against a database whose `user_version` is *ahead* of the
versions the binary knows. An older binary opens a v17 database silently and then
writes `offline_queue` rows with `user_id = NULL` — rows the current binary can
never see again, because v16's backfill only ever runs once.

Expected Behavior:
Either refuse to open a database from the future with a message the user can act
on, or make the attribution self-healing so orphaned rows are re-attributed on
the next upgrade.

Actual Behavior:
The ladder is `if version < N { apply(…) }` (`db.rs:528–615`). With
`version = 17` every branch is skipped and `Ok(Db(...))` is returned. A pre-v16
binary's `queue_push` inserts `(kind, payload, created_at)` and leaves `user_id`
NULL. When the newer binary runs again, `version` is already 17, so
`MIGRATION_V16`'s `UPDATE` never fires. Every reader filters `WHERE user_id = ?1`
(`db.rs:808`, `836`, `863`), and NULL matches no value — so the rows are
invisible to the drain, the pending badge, `sync_status` and
`discard_queued_edit`.

Reproduction:
Install a build at schema 17; install an older build over it (a rolled-back
release, or a manual reinstall of an older installer); make an offline edit
there; return to the current build. The edit is in `offline_queue` and is
unreachable by every code path.

Impact:
Silent, permanent loss of unsynced edits made in the older build, plus a table
that grows forever.

Root Cause:
No forward-compatibility check on `user_version`, combined with a one-shot
backfill.

Recommended Fix:
Refuse to open when `user_version > LATEST` with a clear message ("this database
was written by a newer Karasu") — that prevents the NULL write in the first
place. Independently, make v16's `UPDATE`/`DELETE` re-runnable at every open (it
is idempotent for non-NULL rows) so orphans heal on the way back up. Pair the
refusal with the recovery window A4-21 asks for, or it becomes another silent
non-start.

Regression Tests Required:
* `Db::open` on a database stamped `PRAGMA user_version = 99` returns `Err`.
* A test that a `user_id IS NULL` row in a v17 database is either attributed or
  removed on the next open.

Confidence: HIGH for the mechanism.
Verification: downgraded from P3 — the loss needs all three of an older binary
installed over the same data dir, an edit queued *in* that older build, and that
edit still pending when the user returns to the current build (the old build's
own unfiltered drain clears its rows on its next successful list fetch). The
report's "two portable copies beside one `data/` folder" path is not reachable:
`portable_data_dir()` is exe-relative (`portable.rs:83–85`), so two copies in
different folders never share a data dir.

---

ID: A1-07
Severity: P4
Category: BUG

File: /home/user/Karasu/src/hooks/useListMutations.ts
Line: 274–298
Function: `bulkSave` `onError`

Problem:
The partial-failure path deliberately invalidates instead of restoring, and says
why (`useListMutations.ts:275–279`): restoring would "show the old values for
entries AniList has already changed". Offline — which is when a chunked run is
most likely to die partway — the invalidated refetch produces exactly that
outcome, because it falls back to a cache the bulk edit never touched.

Expected Behavior:
After a partial bulk failure, entries AniList accepted should keep showing their
new values.

Actual Behavior:
`invalidateQueries({ queryKey: key })` (`useListMutations.ts:281`) refetches
through `fetch_media_list`. With the network down, `api.query` returns
`ApiError::Network` and the command serves `db.cached_list(...)`
(`commands/list.rs:291–306`). That cache was last written by the previous
successful `LIST_QUERY` (`list.rs:278`); `bulk_save_list_entries` never updates
it (`list.rs:472–512`). So every entry — including the ones AniList accepted
before the failure — reverts on screen to its pre-edit value.

Reproduction:
1. Select 500 entries and apply a status. `bulk_chunks` makes ten requests
   (`list.rs:404–406`, test at `1193–1201`).
2. Chunks 1–6 succeed; the connection drops on chunk 7. The command returns
   `BulkResult { updated: 300, error: Some(..) }`, the frontend throws
   `BulkSaveError` (`api/anilist.ts:254`), `partial` is true.
3. The invalidated refetch is offline and serves the stale SQLite cache; all 500
   rows show their old status, 300 of which AniList has changed.

Impact:
Transient and self-correcting on the next successful fetch, and disclosed while
it lasts: the offline fallback sets `from_cache: true` (`list.rs:301`) and
`MediaList.tsx:657–662` renders the amber `list.offline` banner on exactly that
flag, so the user is told the list on screen is the last known offline copy. It
still leaves the SQLite cache — and therefore the scrobbler's guards and the
widgets — wrong about 300 entries indefinitely (A1-03).

Root Cause:
`bulk_save_list_entries` writes to AniList and to nothing local; the frontend's
recovery strategy assumes a refetch reaches the server.

Recommended Fix:
Have `bulk_save_list_entries` patch `list_cache` for each accepted chunk (the
same fix A1-03 needs), so an offline refetch serves values consistent with what
AniList holds. Optionally, on `partial`, keep the optimistic values for the first
`updated` ids rather than invalidating blind.

Regression Tests Required:
* A Rust test that a partially successful bulk run leaves `list_cache` holding
  the accepted values for the accepted ids.
* A frontend test that a `BulkSaveError` with `updated > 0` does not restore the
  snapshot.

Confidence: HIGH.
Verification: downgraded from P3 — the offline banner discloses that the list on
screen is a cached copy, and the state self-corrects on the next successful
fetch.

---

ID: A1-08
Severity: P4
Category: BUG

File: /home/user/Karasu/src/api/anilist.ts
Line: 227–239
Function: `bulkSaveEntries` (local-mode branch)

Problem:
The AniList branch has a full partial-failure contract (`BulkResult.updated` →
`BulkSaveError` → the frontend keeps what landed). The local branch has none:

```ts
if (profileMode === "local") {
  for (const e of entries) {
    await invoke<MutationResult>("local_save_entry", { input: { mediaId: e.mediaId, ...patch } });
  }
  return entries.length;
}
```

There is no try/catch and no count of what was written.

Expected Behavior:
A local bulk edit that fails on row *k* should report the *k − 1* rows already
committed to SQLite, so the caller does not roll them back on screen.

Actual Behavior:
The first rejecting `invoke` rejects the whole promise with a plain `Error`, so
`err instanceof BulkSaveError` is false, `partial` is false
(`useListMutations.ts:280`), and `onError` restores the entire pre-edit snapshot
(`:282`) — including the rows already written to `local_list` by
`db.local_upsert` (`db.rs:879–927`). Nothing invalidates afterwards, and
`local_fetch_list` is only re-read on a fresh query, so the UI disagrees with the
database until the next mount.

Reproduction:
1. In local mode, select N entries and apply a status.
2. Make `local_save_entry` fail on the third row with a SQLite write error (a
   read-only data dir, a full disk).
3. Rows 1–2 are committed to `local_list`; the screen is rolled back for all N.

Impact:
The local list and the database disagree after a partial bulk edit; the user sees
their change reverted for rows that were in fact saved. Local only, self-heals on
remount.

Root Cause:
The local branch was written as a convenience loop and never given the
partial-progress contract the AniList branch has.

Recommended Fix:
Wrap the loop, count successes, and throw `BulkSaveError(message, written)` so
the existing `partial` handling applies unchanged. Also invalidate the local list
query on the partial path.

Regression Tests Required:
A unit test with a mocked `invoke` that rejects on the third call, asserting
`bulkSaveEntries` throws `BulkSaveError` with `updated === 2`.

Confidence: MEDIUM.
Verification: downgraded from P3 — the code shape is confirmed, but the trigger
the report cited is weaker than claimed: the bulk payload is
`{ mediaId, ...patch }` and `local_save_entry` resolves the type through
`db.local_find_type(media_id)` (`list.rs:613–619`), which succeeds for every row
already in the local list, i.e. every row a bulk edit can select. The realistic
trigger is a SQLite write error alone.

---

ID: A1-11
Severity: P4
Category: BUG

File: /home/user/Karasu/src-tauri/src/db.rs
Line: 324–330
Function: `MIGRATION_V16`

Problem:
The v16 backfill calls `json_extract` on the raw `kv.anilist_viewer` value:

```sql
UPDATE offline_queue
   SET user_id = (SELECT json_extract(value, '$.id') FROM kv WHERE key = 'anilist_viewer');
DELETE FROM offline_queue WHERE user_id IS NULL;
```

SQLite's `json_extract` *raises* on malformed JSON rather than returning NULL.
Executed rather than assumed (sqlite 3.45.1): `'{"id":123}'` → 123,
`'{"name":"x"}'` → NULL (the documented missing-key case), `'not json'` → error
"malformed JSON", `''` → error. The subquery is evaluated only when
`offline_queue` has at least one row, so an empty table upgrades cleanly.

Expected Behavior:
A migration should not be able to make an install unstartable. Everything else in
this file is defensive about exactly that: `has_column` guards the five
`ALTER TABLE` steps, `apply` wraps each step in a transaction (`db.rs:493–496`),
and v17 is written to be re-runnable.

Actual Behavior:
If a pre-v16 install has a non-JSON `anilist_viewer` value **and** at least one
queued row, `MIGRATION_V16` errors, `apply` returns "Migration v16 failed: …",
`Db::open` returns `Err`, and `setup` propagates it (`lib.rs:356–359`) — the app
does not start. It is logged first, but there is no in-app recovery (A4-21).

Reproduction:
1. Take a database at `user_version < 16` with one `offline_queue` row.
2. Set `kv.anilist_viewer` to any non-JSON text.
3. Launch. `Db::open` fails; the app exits.

Impact:
Total, unrecoverable-in-app startup failure for the affected install.

Root Cause:
`json_extract` is called on stored text without `json_valid(value)` guarding it.
The migration's doc reasons carefully about *absent* and *id-less* viewers
(`db.rs:318–323`) and not about malformed ones.

Recommended Fix:

```sql
SET user_id = (SELECT json_extract(value, '$.id')
                 FROM kv
                WHERE key = 'anilist_viewer' AND json_valid(value));
```

A malformed blob then yields NULL and the rows are dropped by the next line — the
same answer the migration already gives for "nobody to attribute them to".

Regression Tests Required:
A `mem_db()`-style test alongside the two existing v16 tests (`db.rs:2393`,
`2419`): a malformed `anilist_viewer` plus one queued row must migrate
successfully and drop the row, not error.

Confidence: MEDIUM.
Verification: downgraded from P3 — `kv.anilist_viewer` is written in exactly two
places, both `serde_json` (`auth.rs:157`, `auth.rs:233`), with `viewer` filtered
non-null before either, so a malformed value means the database file itself is
corrupt and the startup failure is not this migration's doing. The guard is cheap
defensiveness; the affected population is effectively nil.

---

ID: A4-20
Severity: P4
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/library.rs
Line: 548–556
Function: `scan_library` (the persist block)

Problem:
The scan publishes its index and then writes two `kv` hints as separate
autocommitted statements:

```rust
persist(&db, &data)?;
db.library_replace_suggestions(&suggestions)?;
let next = if pending == 0 { 0 } else { (cursor + asked) % pending };
db.kv_set("identify_cursor", &next.to_string())?;
db.kv_set("library_files_seen", &total.to_string())?;
```

Expected Behavior:
The published index and the facts recorded about it — how many files were walked,
where the identify pass resumes — should land together or not at all.

Actual Behavior:
A failure or a crash after `persist` leaves `library_files_seen` describing the
*previous* scan beside the index this one just published, and `identify_cursor`
pointing into a set that no longer exists. The count is not derivable from the
index (its own comment says so: "most of them matched nothing"), so nothing can
detect or repair the mismatch; only a full successful rescan overwrites it.

Reproduction:
Interrupt the process (or induce a write error) between `persist` and the two
`kv_set` calls. Restart: the Library screen reports a files-walked count that
does not belong to the index on screen.

Impact:
A misleading status line and a resume cursor that can skip or repeat a slice of
the identify pass. No file rows or user corrections are lost.

Root Cause:
Same class as A4-06 and adjacent to it: the operation "publish this scan" spans
several independent transactions.

Recommended Fix:
Fold the two `kv_set`s into the single publish transaction proposed for A4-06 so
one commit carries the index and the facts about it.

Regression Tests Required:
A test that a failure after `library_replace_all` leaves `library_files_seen`
unchanged from the previous scan *and* the index unchanged too, i.e. the whole
publish is one unit.

Confidence: HIGH. Source: found during adversarial verification. Re-read for this
report: `library.rs:548`, `553` and `556` are three separate `?`-unwound calls
inside the same block, each its own transaction.

---

ID: A1-09
Severity: P4
Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/list.rs
Line: 1024–1054 (with 131–135 and 578–582)
Function: `sync_status` / `viewer_id` / `enable_local_mode`

Problem:
`SyncStatus.connected` is documented as "Signed in to AniList. False in local
mode, where nothing syncs by design and an empty queue is not the same
statement." (`list.rs:1009–1011`). It is computed as `viewer.is_some()` where
`viewer = viewer_id(&db)` (`list.rs:1029`, `1048`) — i.e. "a `kv.anilist_viewer`
blob exists". It consults neither `profile_mode` nor the presence of a token, and
`enable_local_mode` deletes the token and sets `profile_mode = "local"` while
leaving the blob in place (`list.rs:579–582`).

Expected Behavior:
`connected` should mean what its doc says. `syncPhase` returns `"offline"` for
`!connected` first and separately, explicitly so local mode cannot be collapsed
with a signed-in account (`src/lib/syncQueue.ts:19–31`).

Actual Behavior:
In the reachable state "viewer blob present, no token, `profile_mode = local`":
* `sync_status.connected` is `true`;
* `syncPhase` returns `"waiting"` (or `"idle"`) rather than `"offline"`;
* `pending(db)` counts the stale account's rows (`list.rs:139–141`);
* `flush_queue` cannot drain them — it requires a token and returns "Not
  connected to AniList" (`list.rs:1076`) — and no other drain runs, because local
  mode routes list reads to `local_fetch_list` (`src/api/anilist.ts:129–134`),
  which never calls `process_queue` and hardcodes `pending: 0`
  (`list.rs:594–598`).

The state is reachable when the token disappears without a logout (a locked
Secret Service on Linux, a wiped credential store, the reinstall case
`enable_local_mode`'s own comment describes at `list.rs:568–577`): the auth store
then shows `viewer = null` (`anilist_session` needs both, `auth.rs:199–204`), so
"Use without an account" becomes reachable while the blob is still in kv.

Impact:
No live user-visible defect: both surfaces that could show the wrong value gate
on the store's mode instead (`Sidebar.tsx:236–266`, `AdvancedPane.tsx:1035–1041`).
The queue rows are counted, undrainable and undiscardable in that state — but the
count is not displayed.

Root Cause:
`connected` is derived from one of the three facts that make up "signed in"
(cached viewer) and not the other two (token, profile mode).

Recommended Fix:
Compute `connected` as
`profile_mode(&db) == "anilist" && viewer_id(&db).is_some()` (and, to be strictly
honest, `auth::load_token().is_some()`), and have `enable_local_mode` clear
`anilist_viewer` the way `anilist_logout` does so no stale identity is left
scoping the queue.

Regression Tests Required:
A Rust test: with `profile_mode = "local"` and a viewer blob present,
`sync_status().connected` must be `false`.

Confidence: HIGH for the code reads.
Verification: downgraded from P3 — the report itself concedes there is no live
user-visible defect, which makes this a latent invariant.

---

ID: A2-09
Severity: P4
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs
Line: 376–379
Function: `shift_episode`

Problem:
`shift_episode` clamps a non-positive result to 1. Its own doc says such an
offset "describes a mapping that cannot be true" — but instead of refusing, it
produces episode 1, which is a perfectly writable number and can be
auto-scrobbled.

Expected Behavior:
A mapping the correction cannot satisfy should yield no episode
(`episode = None`), which stops `drive_session` (`scrobbler.rs:1094` requires
`np.episode.is_some()`) and leaves the card showing the title without a number.

Actual Behavior:
```rust
let shifted = i64::from(episode) + i64::from(offset);
shifted.clamp(1, u32::MAX as i64) as u32
```

Reproduction:
1. A source numbers a franchise absolutely (1..51) and reports no season, so the
   correction key is `(title, -1)`. The user corrects it to the season-2 AniList
   entry with `episode_offset = -26` while watching episode 27, so 27 → 1.
2. Later they play episode 10 of the same title. The same override row applies —
   there is only one, keyed on the same parse.
3. `shift_episode(10, -26)` = 1, not "impossible".
4. The season-2 entry is at progress 0 → `block_reason` returns `None` →
   `Phase::Watching` → progress 1 is written to the season-2 entry while season 1
   episode 10 is playing.

Impact:
A wrong progress write that looks plausible on screen. Bounded: it can only ever
write 1, and only when the target entry's progress is 0.

Root Cause:
The clamp was chosen to avoid writing episode 0 — pinned by
`an_offset_moves_the_episode_and_never_below_one` (`scrobbler.rs:1376–1385`,
asserting `shift_episode(1, -5) == 1`) — and the "cannot be true" case was folded
into it rather than separated from it.

Recommended Fix:
Return `Option<u32>` — `None` when `episode + offset < 1` — and let
`build_now_playing`/`requeue_match` carry the `None` through as "no episode".
Keep the saturation at the top end.

Regression Tests Required:
Replace the `shift_episode(1, -5) == 1` assertion with
`shift_episode(1, -5).is_none()`, and add a `drive_session`-level assertion that
no session is created when the shifted episode is absent. The current test pins
the clamp deliberately, so this is a behaviour change the maintainer signs off on
rather than a silent fix.

Confidence: HIGH (mechanism) / MEDIUM (that a user reaches it — it needs a
negative offset stored under a key that also matches lower-numbered episodes).
Verification: downgraded from P3 — the doc comment at `scrobbler.rs:371–375`
shows the author considered the impossible mapping and chose the floor
deliberately, so this is a proposed behaviour change rather than an unnoticed
defect, and the impact is bounded to writing episode 1.

---

ID: A4-13
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/db.rs
Line: 328
Function: `MIGRATION_V16`

Problem:
`DELETE FROM offline_queue WHERE user_id IS NULL` discards queued edits with no
log line, no count and no notification. The decision itself is documented and
correct (`db.rs:316–322`) — an unattributable queued write is exactly the hazard
v16 closes, and clearing the queue on logout would have been worse. This is filed
against the *reporting*, not the decision.

Expected Behavior:
The app already has a vocabulary for "a queued edit was thrown away":
`report_dropped` (`commands/list.rs:958–975`) raises a bell row precisely because
otherwise "the row is gone, the pending badge falls to zero, and the list simply
does not contain the change". The migration performs the same class of loss and
says nothing.

Actual Behavior:
The rows disappear during `Db::open`. The user who hits this — signed out with a
pending queue at upgrade time — sees a pending badge of zero and no explanation.

Reproduction:
Queue an edit offline, sign out, upgrade past schema 16.

Impact:
Silent loss of edits the user typed, bounded by how rare "signed out with a
non-empty queue at upgrade time" is.

Root Cause:
`Db::open` runs before any notification machinery exists, so the migration cannot
itself raise a bell row.

Recommended Fix:
Have the migration record `changes()` (or count first) into a `kv` key that
`setup` reads once, after `notify` is available, to raise a single bell row. At
minimum, `logging::warn` the count — `logging::init` already runs before
`Db::open` (`lib.rs:355`), so a log line costs nothing today.

Regression Tests Required:
A `mem_db()`-style test that the count of deleted rows is recorded where the app
can find it.

Confidence: HIGH for the behaviour; P4 because the decision is documented and
correct.

---

ID: A4-16
Severity: P4
Category: MISSING TEST

File: /home/user/Karasu/src-tauri/src/db.rs
Line: 1772–1820
Function: `a_database_left_mid_upgrade_still_opens`

Problem:
The half-migrated test covers the right set of steps (all five `ALTER TABLE`
ones) but asserts only that the database opens and reaches version 17. For v16
specifically, the `has_column == true` branch skips the backfill entirely
(`db.rs:608–611`), so the test walks a path where a queued row would keep
`user_id = NULL` and never asserts what happened to the queue.

Expected Behavior:
The test that proves the recovery path works should also prove it does not leave
data in the state v16 exists to prevent.

Actual Behavior:
No queue rows exist in the fixture at all, so the assertion cannot be made. In
practice the skipped state is unreachable because `apply` is atomic — but the
guard exists precisely for the case where that assumption was once false, and the
same reasoning would apply again if a future `ALTER` step ever ships without one.

Reproduction: n/a (coverage gap).

Impact:
None today. It is a gap in the proof, not a defect — but it is the proof that
would catch A4-05's orphaned rows.

Root Cause:
The loop was written to test openability, not data outcomes.

Recommended Fix:
Insert a queued row before the v16 leg of the loop and assert it is either
attributed or removed.

Regression Tests Required:
As described.

Confidence: HIGH (verified: the fixture contains no `offline_queue` row, and the
v16 leg takes the backfill-skipping branch).

---

## Verified sound

Scenarios worked through against the code and found correct, each with the guard
that handles it.

1. **A signs out, B signs in, B's first list fetch drains — no cross-account
   write on the normal path.** `process_queue` resolves the owner from
   `viewer_id(db)` inside the lock and reads only that owner's rows
   (`list.rs:913–916`); `queue_all`/`queue_len` filter on `user_id` with no
   empty-list fallback (`db.rs:808–811`, `863–872`). Pinned by
   `a_queued_edit_is_invisible_to_another_account` (`db.rs:2347–2369`). A's rows
   are left untouched and drain when A signs back in. (The one hole is the
   mismatched token/viewer state cross-referenced at the end of this report, a
   different mechanism.)

2. **Signed out, there is nothing to drain.** `viewer_id` returns `None` and
   `process_queue` returns early with `skipped: false` (`list.rs:913–915`), so a
   drain with a foreign or absent token cannot send anything.

3. **A user-triggered discard cannot delete another account's row.**
   `discard_queued_edit` resolves the owner in Rust and deletes with the owner in
   the WHERE clause (`list.rs:1063–1067` → `db.queue_remove_for`,
   `db.rs:838–846`), never trusting the UI-supplied id. Pinned by
   `a_discard_only_removes_the_owners_row` (`db.rs:2375–2387`).

4. **The v16 backfill and its drop rule.** Attribution to the cached viewer and
   deletion of unattributable rows are both pinned (`db.rs:2392–2413`,
   `2418–2434`), and the step carries the `has_column` guard plus `apply`'s
   transaction so the column and the attribution land together (`db.rs:602–613`,
   `493–496`).

5. **Crash mid-drain cannot double-apply.** `db.queue_remove(id)` runs only on
   `Ok(_)` from the server (`list.rs:940–943`), so a crash before the removal
   replays the row — and every payload is absolute, never relative: `progress` is
   computed client-side into a final number (`Dashboard.tsx:218`), the editor
   sends absolute `status/progress/score/repeat/notes`
   (`EntryEditModal.tsx:437–450`), the scrobbler sends `{"progress": episode}`
   (`scrobbler.rs:751`), and scores go as `scoreRaw` (`api/anilist.ts:115–122`).
   Replaying any of them is idempotent.

6. **Retryable vs. permanent classification protects the queue.**
   `classify`/`is_retryable` keep a row for offline, 429, 401/403, 5xx and
   "invalid token"/"unauthorized"/"too many requests" bodies
   (`anilist/client.rs:103–175`), and `process_queue` aborts the whole drain on
   those (`list.rs:944`) rather than dropping. Only an `Api` rejection removes a
   row, and that removal is reported through the bell (`report_dropped`,
   `list.rs:959–976`).

7. **A `scoreFormat` change between enqueue and drain cannot corrupt a score.**
   The queued payload carries `scoreRaw` (format-independent 0–100,
   `api/anilist.ts:115–122`, `SAVE_MUTATION` doc at `list.rs:147–152`); the drain
   re-stamps only `scoreFormat`, which affects the echoed value's formatting and
   not the write (`list.rs:920–937`), and only for `kind == "save"`.
   `advancedScores`' positional hazard is stated and accepted in the same comment
   (`list.rs:925–932`) — a documented trade.

8. **The dedupe key cannot collapse two edits that must both survive.** It is
   `kind:subject:sorted-non-null-fields` with `scoreFormat` and the subject
   excluded (`queue_parts`/`queue_key`, `list.rs:774–816`); save and delete id
   spaces are kept apart. Pinned by `edits_to_different_fields_are_kept_apart`,
   `untouched_fields_do_not_join_the_key`,
   `the_score_format_never_splits_two_edits`, `entries_and_kinds_never_collide`
   (`list.rs:1139–1180`).

9. **The dedupe's remove-and-reappend does not reorder anything harmfully.**
   progress→progress, progress→status, editor-save→`+1`, `+1`→editor-save and
   delete→re-add were all traced. `queue_push_deduped` removes an older row and
   appends the newest intent at the tail (`list.rs:827–834`), each payload is
   absolute per field, so the final state is the newest intent in every ordering;
   `queue_all` reads `ORDER BY id` (`db.rs:808–811`), so the appended row is never
   sent before rows queued earlier. (Its *atomicity* is a separate matter —
   A1-15.)

10. **A live write cannot overtake queued rows on the save path.**
    `save_entry_core` takes the same exit for a skipped drain as for a failed one
    and queues instead of sending (`list.rs:346–353`); `bulk_save_list_entries`
    refuses outright with `queue.busy` (`list.rs:461–470`). (`delete_list_entry`
    is the exception — A1-02.)

11. **Drain re-entrancy and the "draining" flag.** `DRAIN.try_lock` guarantees one
    drain process-wide and skips rather than blocking (`list.rs:862`, `905–907`);
    `DrainMark`'s `Drop` clears `DRAINING` on all three exits including a panic
    (`list.rs:878–891`); `drain_in_flight` deliberately does not take the real
    lock so a 1 Hz status poll cannot cause the skip it would then report
    (`list.rs:864–895`).

12. **A queued row can never be ownerless.** `queue_push_deduped` refuses without
    a viewer (`list.rs:826`) and `Db::queue_push` takes a non-optional `user_id`
    (`db.rs:795`), so the type makes the v16 shape unwritable rather than merely
    unwritten. Every caller propagates the refusal to the UI (`list.rs:350`,
    `361`, `529`, `538`).

13. **`local_upsert`'s absent-means-unchanged contract holds for all eleven
    columns.** `COALESCE(?n, local_list.<col>)` on the update side with the
    neutral defaults confined to the `VALUES` list (`db.rs:891–908`), so a `+1`
    cannot reset status/score/repeat/notes/volumes. `false`, `0` and `""` are
    present values and are written (SQL `COALESCE` only skips NULL), and
    `local_save_entry` maps an explicit JSON `null` to absent via
    `as_i64()`/`as_bool()`/`as_str()` returning `None` (`list.rs:634–646`) — the
    same contract AniList gives an absent variable. A cleared date arrives as an
    all-null `FuzzyDate` object and is stored, not skipped (`fuzzy_date_text`,
    `list.rs:688–693`).

14. **Undo cannot restore wrong progress or dates.** `inverse` writes back only
    the fields the original save actually mentioned and actually changed
    (`lib/receipt.ts:84–103`), compares fuzzy dates part-by-part rather than by
    reference (`sameDate`, `:53–56`), spells a cleared date AniList's way (`:93`),
    maps a `null` note to `""` because the mutation takes a string (`:101`), and
    refuses the offer entirely for `customLists`/`advancedScores` (`IRREVERSIBLE`,
    `:50`, `:75`). Being a new patch rather than a snapshot restore, a v14 date or
    a progress value the save never touched is left alone.

15. **The sign-in merge never destroys a local row it has not landed.** It
    refuses to run against a cached list (`res.fromCache` → `phase = "blocked"`,
    `SignInMerge.tsx:70–75`), clears the local row only after a non-queued push
    (`:150–155`, `:171–176`), carries all nine fields including v14's three
    (`:134–145`, `commands/list.rs:727–736`), and its residual push is
    additive-only with `private` able to tighten but never loosen
    (`lib/mergeDecision.ts:111–131`). `localWins` treats `online === null` as
    "brand new" only because the caller has already proven the list was read
    (`:34–48`). Local scores are pinned to `POINT_10` on conversion
    (`api/anilist.ts:326–329`).

16. **`would_regress` itself is correct and pinned.** A scrobble may never lower
    progress outside `REPEATING` (`scrobbler.rs:712–714`), with
    `a_scrobble_can_only_ever_move_progress_forward` covering the equal-episode,
    gap and REPEATING cases (`scrobbler.rs:1275–1285`). The defect in A1-03 is its
    input, not its logic.

17. **Migrations are atomic and re-runnable.** `apply` wraps every step in
    `BEGIN/COMMIT` so a schema change and its `user_version` bump land together
    (`db.rs:485–496`), and all five `ALTER TABLE ADD COLUMN` steps carry the
    `has_column` guard (`db.rs:543–613`). v17 is guarded on the key it inserts
    (`db.rs:354–358`). (The guard's evaluation point is A4-01.)

18. **Backups cannot silently hold an unrestorable file.** `snapshot_to` uses
    `VACUUM INTO` rather than a file copy, taking the same mutex every writer
    takes (`db.rs:700–716`); `snapshot_over` writes to a temp file and renames
    atomically (`db.rs:731–742`); the daily pass re-verifies with
    `PRAGMA quick_check` and rewrites a file that fails (`backups.rs:82–136`).

19. **Mutex poisoning cannot wedge the database.** Every `Db` method takes the
    guard through `LockExt::guard`, which recovers from poisoning
    (`sync.rs:29–33`), so a panic in one background loop cannot take the
    connection down for the process — which matters because `logging::supervise`
    restarts those loops.

20. **The queue's own panel is honest about what it cannot name.** A row whose
    payload does not parse is still listed with a distinct label rather than
    dropped, so the panel count and the `COUNT(*)` badge agree
    (`QueuedEdit.subject: Option<i64>`, `list.rs:988–996`;
    `SyncPanel.tsx:185–193`), and `queuedMediaId` reads exactly one id field per
    kind because the two id spaces overlap (`lib/syncQueue.ts:42–63`).

---

## Refuted during verification

* **A1-13 — "a scrobble is silently lost when `queue_push_deduped` refuses with
  no cached viewer".** Claimed that with a token present and the viewer blob
  absent, `perform_update`'s `Err` disappears into the log. It does not: both
  call sites turn that `Err` into
  `Phase::Blocked(BlockReason::Failed { message })` and emit it to the
  now-playing surface (`scrobbler.rs:983–994`, `1224–1236`), so the user sees the
  failure on the card. The precondition is also near-unreachable —
  `anilist_session` (`auth.rs:199–204`) needs both the token and the blob, so the
  app presents as signed out. No defect.

---

## See also

Four findings from the same passes are primarily about *which account* owns or is
served data rather than about its durability, and are reported in full in
`ACCOUNT_ISOLATION.md`:

* **A1-01 (P2)** — `connect_with_token` (`commands/auth.rs:155–160`) writes the
  token before the cached viewer with no rollback, so a failed `kv_set` can leave
  a drain reading one account's queued rows and sending them under another
  account's bearer.
* **A1-16 (P3, found during adversarial verification)** — `profile_mode`
  (`commands/auth.rs:160`) is the third unwound write in that same function; if
  it alone fails, the install holds a valid token and cached viewer while Rust
  still believes it is in local mode, so list reads go to `local_fetch_list` and
  the queue never drains.
* **A1-17 (P3, found during adversarial verification)** — `anilist_logout`
  (`commands/auth.rs:206–212`) clears the token, the viewer blob and the widget
  projection but leaves the previous account's `list_cache` rows in place; with
  A1-12's missing ownership check, `cached_media_list` will serve them to any
  caller.
* **A1-12 (P4)** — `cached_media_list`/`fetch_media_list`
  (`commands/list.rs:222–309`) take `user_id` from the frontend for the cache key
  and the pending count while the drain inside scopes on the backend's
  `viewer_id(db)`, with no comparison between the two.

---

## Counts

| Severity | Findings |
|---|---:|
| P0 | 0 |
| P1 | 0 |
| P2 | 4 |
| P3 | 8 |
| P4 | 12 |
| **Total** | **24** |

Refuted during verification: 1. Cross-referenced to `ACCOUNT_ISOLATION.md`: 4.
