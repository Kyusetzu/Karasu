# Performance Audit

## Measurement status

**The application was not run during this audit.** No profiler was attached, no
frame times were captured, no memory snapshots were taken, and no request was
sent to AniList. Every quantity in this document is one of two things, and each
is labelled where it appears:

- **Static analysis** — a count, a bound or a worst-case ladder derived by
  reading the source and adding up the constants the source itself declares
  (`POLL_INTERVAL`, `MAX_FILES`, `MAX_PACE`, the reqwest timeout, the
  `Retry-After` clamp). These are structural claims about what the code *can*
  do, not observations of what it *did*.
- **Baseline test-suite run** — the only real measurements available:
  - `tsc` clean.
  - vitest: **935 tests in 86 files, all passing, 14.43 s**.
  - the Rust suite: **303 tests passing single-threaded in 2.37 s**, and
    **failing in the default parallel run**.

Everywhere a severity depends on how long something actually takes, that is said
plainly and the confidence is set accordingly. No timing, memory figure or
benchmark number appears in this document that was not derived from one of the
two sources above.

Note on the Rust suite: a suite that passes only under `--test-threads=1` is a
test-harness property, recorded here because it was the one measurement taken.
It is not itself filed as a finding in this dimension.

---

## Scope

The performance-shaped surface of Karasu at commit `9a53427`, assembled from
three source audits and their adversarial verification passes:

- **Frontend (`src/`)** — render economy, memoization, listener and timer
  lifecycle, TanStack query-cache growth and keying, virtualization, and
  behaviour over a long-lived session.
- **AniList sync (`src-tauri/src/anilist/`, `src/api/`, `src/hooks/`)** —
  request economy against the ~30/min limiter, the cost of stacked retry
  layers, the pre-flight pacing decision, and the detection poll's coupling to
  the write path.
- **Database and local library (`src-tauri/src/db.rs`,
  `src-tauri/src/library.rs`, `src-tauri/src/backups.rs`)** — work performed on
  the WebView UI thread, work performed during `setup` before the window
  exists, blocking calls inside async loops, and the single global
  `Mutex<Connection>` every one of them holds.

Out of scope here and covered by the other dimension reports: correctness of the
content filter, account isolation, updater behaviour, detection accuracy, and
data integrity. Where a finding below touches one of those (the cache-mutation
finding, for instance), only its performance face is filed here.

Verdicts from the verification pass are applied throughout: a downgraded finding
carries a `Verification:` line stating the correction, refuted claims are not
findings, and findings the verifier raised itself are promoted with
`Source: found during adversarial verification` on the Confidence line.

---

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
|---|---|---|---|---|
| PERF-01 | P2 | PERFORMANCE PROBLEM | src-tauri/src/playback/scrobbler.rs:1008-1073 | The AniList write is awaited inline in the 5 s detection loop, so a throttled save freezes detection for minutes |
| PERF-02 | P2 | PERFORMANCE PROBLEM | src/app/main.tsx:31-32 | Two retry layers stack multiplicatively: one read can cost 4 HTTP requests and ~371 s with no cancellation |
| PERF-03 | P2 | ARCHITECTURAL PROBLEM | src-tauri/src/anilist/client.rs:498-517 | `sleeping_until` is written by `park` and read by nobody who decides to send, so a server 429 deadline throttles nothing |
| PERF-15 | P3 | PERFORMANCE PROBLEM | src-tauri/src/library.rs:932, 1096, 1141, 1206 | Four library-correction commands rewrite the whole index on the WebView UI thread |
| PERF-16 | P3 | PERFORMANCE PROBLEM | src-tauri/src/lib.rs:384 | `hydrate` re-parses every indexed path synchronously during `setup`, before the window exists |
| PERF-04 | P3 | PERFORMANCE PROBLEM | src/pages/LocalLibrary.tsx:451-454 | The local-library screen renders every indexed title eagerly and unvirtualized |
| PERF-05 | P3 | PERFORMANCE PROBLEM | src-tauri/src/alerts/site.rs:106-146 | A failing site-notification pass degrades from its configured interval to one request every 60 s |
| PERF-06 | P3 | BUG | src-tauri/src/playback/relations.rs:159-165 | The relations loader is the one outbound client with no timeout, so its task and socket can hang for the session |
| PERF-07 | P4 | DOCUMENTATION ISSUE | src/pages/Dashboard.tsx:374-379 | "Two queries per mount" is exceeded on four screens, and three comments claim compliance |
| PERF-08 | P4 | PERFORMANCE PROBLEM | src/components/shell/Bell.tsx:328 | Opening the bell spends a count request whose answer the feed's page-1 reset then discards |
| PERF-09 | P4 | PERFORMANCE PROBLEM | src/hooks/useManualSync.ts:58-60 | Manual sync ends with an invalidation whose cost the hook's own docstring understates |
| PERF-10 | P4 | IMPROVEMENT | src/hooks/useFollow.ts:59 | `cancelQueries(["social"])` discards in-flight reads the optimistic patch never touches |
| PERF-11 | P4 | IMPROVEMENT | src-tauri/src/anilist/client.rs:113-122 | `ApiError::Api` flattens to the same string as `Retryable`, so a permanently-refused payload is retried once |
| PERF-12 | P4 | PERFORMANCE PROBLEM | src-tauri/src/commands/system.rs:597-611 | `set_backup_settings` runs `VACUUM INTO` inline on the UI thread |
| PERF-13 | P4 | PERFORMANCE PROBLEM | src-tauri/src/library.rs:454-457 | A row count is obtained by materialising every path string in `library_files` |
| PERF-14 | P4 | CODE SMELL | src/stores/auth.ts:128-134 | The `anilist-auth` listener drops its unlisten handle and registers twice under StrictMode |
| PERF-17 | P4 | CODE SMELL | src/components/media/MediaCard.tsx:50-57 | The save handler mutates TanStack cache data in place instead of going through `setQueryData` |
| PERF-18 | P4 | CODE SMELL | src/pages/AnimeDetail.tsx:1447 | Three bare 2 s `setTimeout`s write state with no cleanup, contradicting the audit's own "every timer clears" claim |
| PERF-19 | P4 | CODE SMELL | src/hooks/useGridRoving.ts:52 | A ref is written during render in the one hook StrictMode double-renders on every keypress |
| PERF-20 | P4 | PERFORMANCE PROBLEM | src-tauri/src/backups.rs:151-161 | `run_once` (VACUUM INTO + quick_check + directory IO) is called directly inside an async loop |

---

ID: PERF-01

Severity: P2

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs

Line: 1008-1073 (the poll loop), 1072 (`drive_session(&app).await`), 1073 (`sleep(POLL_INTERVAL)`), 1224 (`perform_update(...).await`), 751-755 (`save_entry_core(...).await`)

Function: `scrobbler::spawn` → `drive_session` → `perform_update` → `save_entry_core`

Problem:
The 5-second detection poll and the AniList write share one sequential loop body,
so a slow or throttled write stops detection for as long as the write takes.

```rust
loop {                                                        // scrobbler.rs:1008
    let playback = detection::detect_playback(...).await;     // :1017
    ...
    drive_session(&app).await;                                // :1072
    tokio::time::sleep(POLL_INTERVAL).await;                  // :1073, POLL_INTERVAL = 5 s (:20)
}
```

`drive_session` awaits `perform_update` (:1224), which awaits `save_entry_core`
(:751-755), which — when `pending(db) > 0` — first awaits `process_queue`
(`commands/list.rs:346-355`) and only then `api.query` for the save itself.
Nothing is dispatched to a separate task; every other long-running concern in
the tree (`alerts::*`, `relations::spawn_loader`, `backups::spawn`) has one.

Expected Behavior:
Detection keeps its 5-second resolution while a scrobble write is in flight. A
slow write delays the write, not the detector.

Actual Behavior:
One scrobble write can hold the loop. Static analysis of the constants the code
declares gives this ladder for a single save:

- pre-flight pacing, bounded by `MAX_PACE` (`client.rs:266`, 5 s) plus one
  `SLICE` (`client.rs:258`, 400 ms) — up to ~5.4 s
- attempt 1: up to the 30 s reqwest timeout (`client.rs:388`) → 429 →
  `sleep(Retry-After)` clamped to 120 s (`client.rs:590`)
- attempt 2: up to 30 s again

That is a derived upper bound of roughly 185 s of blocked loop for one save, all
of it inside `drive_session`. And the freeze is reachable with no 429 at all:
`save_entry_core` drains the offline queue first, and a *healthy* drain runs one
`api.query` per queued row sequentially, paced by the limiter
(`commands/list.rs:915`).

Reproduction:
Static trace, no run required.
1. Accumulate queued edits offline — every retryable save is queued rather than
   raised (`commands/list.rs:361-365`).
2. Come back online while an episode is playing, and let the scrobble threshold
   fire.
3. `drive_session` → `perform_update` → `save_entry_core` → `process_queue`
   walks the queue, then sends the scrobble. `detect_playback` is not called
   for the whole of it.

Impact:
- The now-playing card and the tray title freeze; `debug_changed` records
  nothing, so `karasu.log` — the app's only detection diagnostic, and a
  deliberately kept one per CLAUDE.md — has a silent hole exactly where a user
  would look.
- A media session that starts *and* stops inside the freeze is never observed,
  so it is never scrobbled. That is a missed write, not a delayed one.
- The freeze coincides with a rate-limit episode, i.e. with the moment the
  scrobbler most needs to be draining a backlog.

Root Cause:
`drive_session` is awaited inline rather than dispatched. The detector and the
writer were written as one loop when the writer was a single fast request, and
the offline queue and the `Retry-After` sleep were added to the writer without
revisiting the coupling.

Recommended Fix:
Dispatch the write. Replace the inline `perform_update(...).await` at
`scrobbler.rs:1224` with a `tauri::async_runtime::spawn` guarded by the
`Phase::Updating` state already set at :971 (or an `AtomicBool`), so at most one
write is in flight and a second tick does not enqueue a duplicate. The result
handling at :1225-1234 already re-checks `applies_to(session, mid, ep)` before
touching the session, so it is safe to run late.

Regression Tests Required:
- `drive_session` returns within one poll interval when the write path is a
  future that has not resolved (a fake `perform_update` seam).
- A second tick while `Phase::Updating` does not start a second write for the
  same `(media_id, episode)` — `applies_to` already exists to express this.
- Both must be written so they pass single-threaded, given the baseline Rust
  suite's parallel-run failure.

Confidence: HIGH on the mechanism (the await chain was re-read end to end). The
185 s figure is static analysis from declared constants, not an observation.

---

ID: PERF-02

Severity: P2

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src/app/main.tsx

Line: 31-32 (the frontend `retry` predicate), with /home/user/Karasu/src-tauri/src/anilist/client.rs:524 (the Rust retry), :388 (30 s timeout), :590 (`Retry-After` clamped to 120)

Function: `QueryClient` default `retry` predicate × `AniList::query`

Problem:
Two independent retry layers stack multiplicatively on a single read, with no
cancellation between them and no ceiling on the total wall time one `invoke` may
occupy.

- Rust: `for attempt in 0..2` (`client.rs:524`). A 429 parks, sleeps
  `Retry-After` (clamped to 120 s, :590) and retries once.
- Frontend: `retry: (count, error) => count < 1 && !isTokenRejected(error) && !isNotFound(error)`
  (`main.tsx:31-32`). A surviving 429 arrives as `ApiError::Retryable` flattened
  to a bare message string (`client.rs:113-122`), which is neither excluded
  class — so TanStack runs the whole Rust pipeline again.

Expected Behavior:
One logical read costs a bounded number of HTTP requests and returns, or reports
failure, in a time a user will wait for.

Actual Behavior:
Static worst-case ladder for **one** `useQuery`, from the declared constants:

```
attempt 1: preflight ≤ ~5.4 s + request ≤ 30 s + 429 → sleep ≤ 120 s + request ≤ 30 s
           ≈ 185 s, 2 HTTP requests
TanStack default retryDelay ≈ 1 s (not overridden)
attempt 2: the same again
           ≈ 185 s, 2 HTTP requests
                                                   total ≈ 371 s, 4 HTTP requests
```

There is no way to abort. `invoke` has no `AbortSignal` — its signature is
`invoke<T>(cmd, args?, options?)` with `InvokeOptions = { headers }` — and
`gql`/`fetchMediaList` (`src/api/anilist.ts:83-85, 130-134`) ignore the
`AbortSignal` TanStack supplies. So navigating away does not stop the request:
the Rust command runs to completion and spends its budget. `cancelQueries`
(`useListMutations.ts:173`, `useFollow.ts:59`, `useSocialActions.ts:109`)
likewise only discards answers the budget has already paid for.

Because PERF-03 makes the client's own backoff advisory, every one of those
requests is sent into a server that has already said stop.

Reproduction:
Static trace. Reach the limit (a whole-list bulk edit is 10 requests,
`commands/list.rs:415-511` with `BULK_CHUNK`; the sequel pass adds 12,
`alerts/sequel.rs:172-176`; a LocalLibrary mount adds ⌈n/50⌉), then open a
screen that fires several queries. Each follows the ladder above.

Impact:
A rate-limit episode becomes self-sustaining: the retries spend the budget that
would otherwise let it recover. The user sees a skeleton with no explanation and
no way to stop it, on screens whose loading gates exist precisely to avoid
stating falsehoods.

Root Cause:
The two layers were designed independently. The frontend predicate excludes the
two classes where retrying "cannot possibly help", but a 429 is the class where
retrying helps *least urgently* and costs *most*, and it is not excluded.
Nothing bounds the total time an `invoke` may hold.

Recommended Fix:
1. Give a surviving rate-limit a stable code the way auth already has
   `TOKEN_REJECTED` (`client.rs:120`), and exclude it in `main.tsx:31`, so the
   Rust layer owns 429 backoff end to end.
2. Bound the Rust side: cap the `Retry-After` sleep at something a UI can wait
   through (30 s, say) and return `Retryable` beyond it, letting the caller
   decide. `park` still records the full deadline, so the limiter keeps it once
   PERF-03 is fixed.
3. Honour the `AbortSignal` TanStack already supplies, at least so the frontend
   stops waiting on a request whose screen is gone.

Regression Tests Required:
- A unit test on the `retry` predicate asserting `false` for the new
  rate-limit code and `true` for a generic network error.
- A Rust test asserting the `Retry-After` sleep is clamped to the new ceiling
  and that exceeding it yields `ApiError::Retryable`.

Confidence: HIGH on the mechanism. The 371 s / 4 requests figure is static
analysis from declared constants.

---

ID: PERF-03

Severity: P2

Category: ARCHITECTURAL PROBLEM

File: /home/user/Karasu/src-tauri/src/anilist/client.rs

Line: 498-517 (the pre-flight loop), 312-320 (`park`), 322-327 (`throttled_for`), 343-349 (`headroom`), 580-600 (the 429 park)

Function: `AniList::query`, `RateState::park`

Problem:
`RateState::sleeping_until` — the field whose doc comment calls its forward-only,
never-cleared discipline "load-bearing", and which the panel renders as
"throttled for …" — is **never read by anything that decides whether to send a
request**. Its only non-test caller is `rate_snapshot` (:471-472), which feeds
the sync panel. The pre-flight loop branches on `rate.headroom(now) > RESERVE`
and nothing else:

```rust
let nap = {
    let mut rate = self.rate.lock().await;
    let now = Instant::now();
    if rate.headroom(now) > RESERVE { rate.claim(); None }
    else { rate.park(SLICE, "preflight"); Some(SLICE) }
};
```

So `park(Duration::from_secs(wait), "retryAfter")` after a real 429 (:594-597)
throttles nobody. It is a display value.

Expected Behavior:
Once AniList has answered 429 with a `Retry-After`, no request from this client
goes out until that deadline passes. One client is shared by the scrobbler,
three alert passes, `identify.rs` and every frontend passthrough, so the deadline
has to be global.

Actual Behavior:
Two paths let requests through a live server-mandated backoff.

1. **`remaining` may not be lowered at all.** The `RateSnapshot` doc (:370-376)
   states as known fact that if AniList omits `x-ratelimit-remaining` on a 429,
   `remaining` keeps its stale pre-429 value. `headroom(now) > RESERVE` is then
   still true and every concurrent and subsequent caller sends straight into the
   throttle, each earning its own 429 and its own sleep of up to 120 s.
2. **`headroom` heals straight through the backoff.** `headroom` (:343-349)
   resets `remaining` to `limit.unwrap_or(SEED)` once `now - counted_at() >=
   WINDOW` (60 s, :254). A 429 stamps `observed = now` (:565-568), so 60 s later
   the count is repaired to 30 and full-rate sending resumes — while a
   `Retry-After` of up to 120 s is still in force.

Reproduction:
Static trace of path 2, the deterministic one.
- t=0: a request receives 429 with `retry-after: 120` and
  `x-ratelimit-remaining: 0`. :563-577 sets `remaining = 0`,
  `observed = Some(t0)`, `reset_at = None`; :594-597 sets
  `sleeping_until = t0 + 120 s`.
- t=60+ε: `counted_at()` is `observed = t0`, `now - t0 >= WINDOW`, so `headroom`
  sets `remaining = 30`. Every caller clears the guard on its first iteration
  and sends at full rate, 60 seconds before the server said to resume.

Impact:
The client's own backoff is advisory. During a rate-limit episode Karasu keeps
sending, converting one 429 into a run of them; each costs a wasted request out
of a budget shared with the scrobbler and the alert passes, and each blocks its
caller for up to `Retry-After` seconds. This is the amplifier that makes PERF-01
and PERF-02 as expensive as they are. The sync panel's "throttled for 1m 58s"
line also describes a state the limiter is not in.

Root Cause:
`park`/`throttled_for` were built as a *reporting* mechanism; the pre-flight
decision was never rewired to consult them. `headroom`'s window heal — correct
as a fix for the sticky-nap bug it was written for, pinned by
`a_count_from_a_rolled_window_stops_counting` (:757-771) — has no exception for
a deadline the server itself set, because there is no code path where the two
meet.

Recommended Fix:
Make the pre-flight loop consult the deadline and let the deadline outrank the
heal: branch on `rate.throttled_for(now)` before the headroom test, and gate the
heal in `headroom` on `self.throttled_for(now).is_none()` so a rolled window
cannot repair a count while the server is still refusing. The `MAX_PACE` escape
should keep firing for the `"preflight"` kind and not for `"retryAfter"`.

Regression Tests Required:
- `a_retry_after_park_blocks_the_preflight_check`: park `"retryAfter"` for 120 s
  with `remaining = 30`; assert the pre-flight decision is "wait", not "claim".
- `max_pace_does_not_break_a_server_deadline`: assert the escape fires for
  `"preflight"` and not for `"retryAfter"`.
- `the_window_heal_does_not_outrun_a_retry_after`: `remaining = 0`,
  `observed = t0`, `sleeping_until = t0 + 120 s`; assert `headroom(t0 + 61 s)`
  is still 0.

Confidence: HIGH. `grep -n "throttled_for\|sleeping_until" src-tauri/src/anilist/client.rs`
returns only `park`, `rate_snapshot` and tests; the pre-flight loop was re-read
in full.

Note: the report's third sub-claim — that the `MAX_PACE` escape releasing the
brake after ~5 s is itself a defect — is withdrawn. `client.rs:260-266`
documents that trade explicitly ("sending into a 429 costs a `Retry-After`;
stalling costs the whole screen … the self-imposed wait is bounded and the
server's own instruction is not"), which makes it a deliberate decision. The
finding stands on the two paths above.

---

ID: PERF-15

Severity: P3

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src-tauri/src/library.rs

Line: 932-957 (`set_library_match`), 1096-1132 (`set_library_redirect`), 1141-1195 (`clear_library_redirect`), 1206-1250 (`clear_library_match`); with 663-673 (`persist`), 1043-1052 (`plan_redirect`'s reparse sweep)

Function: `set_library_match`, `set_library_redirect`, `clear_library_redirect`, `clear_library_match`

Problem:
All four library-correction commands are declared plain `#[tauri::command]`,
which this very file states the consequence of at :388-394:

> `tauri-macros` defaults a plain `#[tauri::command]` to
> `ExecutionContext::Blocking`, which runs the body inline on the WebView2 UI
> thread. A recursive walk of up to `MAX_FILES` plus a fuzzy match per file
> froze the whole window — the "scanning" spinner could not even animate,
> because the thread that would have animated it was doing the scan.

`scan_library` was fixed for exactly this (`#[tauri::command(async)]`, :395).
The four corrections were not, and each of them ends in `persist`
(:663-673) — `library_replace_all` (`db.rs:1180-1212`: `DELETE FROM
library_files`, N inserts, `DELETE FROM library_match`, M inserts, one
transaction) followed by `library_replace_unmatched` (`db.rs:1470-1500`: a
second transaction, delete plus insert per unplaced file). Both hold the single
global `Db` mutex (`db.rs:8`, `pub struct Db(pub Mutex<Connection>)`).

`set_library_redirect` additionally runs `plan_redirect`, whose overlap sweep
re-parses filenames per file (:1043-1052, via `reparse` → `parser::parse`), and
`clear_library_redirect` calls `reparse` twice per matching file (:1170, :1178).
Every one of them also calls `guard.reindex()`, which rebuilds `by_media`, the
summary and the unplaced groups and sorts them.

Expected Behavior:
A one-click correction does not block the window for the duration of a
whole-index rewrite, for the same reason the scan does not.

Actual Behavior:
Clicking "this is actually …" on the local-library screen runs, inline on the UI
thread: an in-memory sweep over every scanned file, a full `reindex`, and two
SQLite transactions that delete and reinsert up to `MAX_FILES = 20_000` rows
(:19-20) — while holding the mutex the scrobbler and all three alert passes
also need.

Reproduction:
Static analysis of the four command declarations and their shared `persist`
tail; no run required. The declarations were re-read:
`grep -n "^#\[tauri::command" -A3 src-tauri/src/library.rs` shows
`#[tauri::command(async)]` on `scan_library` alone.

Impact:
A window freeze proportional to library size on an action the UI presents as
instant, plus every background writer blocked behind the same mutex for the same
interval. No correctness impact — the writes themselves are transactional.

Root Cause:
The `async` fix was applied to the scan, the one command that was obviously
expensive, and not to the four commands that reuse the scan's own persistence
path.

Recommended Fix:
Declare all four `#[tauri::command(async)]`. They already return
`Result<Vec<LibraryEntry>, String>` and take `AppHandle`, so the change is
mechanical; the `state.1.load(Ordering::Acquire)` scan guard each already
carries is what keeps them from racing a scan.

Regression Tests Required:
- A source-level assertion (a test or a documented grep in CI) that every
  command in `library.rs` whose body reaches `persist` is declared
  `#[tauri::command(async)]`. The defect class is a declaration, so a
  declaration test is the only thing that can hold it.

Confidence: HIGH on the mechanism — the four declarations and the `persist` tail
were re-read directly. Severity reflects unbounded work on a blocking path; no
frame time was measured, so MEDIUM on the magnitude.
Source: found during adversarial verification

---

ID: PERF-16

Severity: P3

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src-tauri/src/lib.rs

Line: 384 (`library::hydrate(app.handle());`), with /home/user/Karasu/src-tauri/src/library.rs:832-908 (`hydrate`), :910-917 (`reparse`)

Function: `setup` → `library::hydrate`

Problem:
`hydrate` is called synchronously from Tauri's `setup` closure, before the
window is created, and re-parses every stored library path from scratch.

```rust
library::hydrate(app.handle());              // lib.rs:384
playback::relations::spawn_loader(...);      // :385 — the next lines all spawn
playback::scrobbler::spawn(...);             // :386
```

Inside, for every row of `library_files`:

```rust
let (title, season, disk_episode) = reparse(&path);   // library.rs:846
```

`reparse` (:910-917) calls `parser::parse`, which runs a bracket strip
(`parser.rs:87`), a season regex (:60) and up to five episode regexes (:44-52).
Rows governed by a redirect run the rule set over the result as well
(:851-856), and `data.reindex()` (:905) then rebuilds `by_media`, the summary
and the unplaced groups and sorts them. The count of rows is bounded only by
`MAX_FILES = 20_000` (:19-20).

The docstring explains *why* the title is recovered rather than stored — the
parser is pure and cannot drift — and that reasoning is sound. What is at issue
is only *where* the work runs.

Expected Behavior:
Startup work proportional to the library size does not sit on the path to the
first window. Everything else long-running in `setup` is spawned; only this is
awaited.

Actual Behavior:
Every launch of an install with a populated local library pays a full re-parse
of the index plus a `reindex` before the window exists. Its own cost has no cap
beyond `MAX_FILES`, and it holds the `Db` mutex for the `library_all`,
`library_unmatched`, `library_scores`, `library_suggestions` and override/redirect
reads it makes on the way.

Reproduction:
Static analysis. `grep -n "library::hydrate" src-tauri/src/lib.rs` gives one
call site, at :384, inside `setup` and not inside a spawn.

Impact:
Time-to-first-window grows with the size of the user's local library, on the
one launch path the user always takes. Because it precedes window creation, the
delay is a blank period with no spinner to explain it — the same failure mode
`scan_library`'s docstring records fixing for the scan.

Root Cause:
`hydrate` was placed with the `app.manage(...)` calls it feeds, all of which are
cheap, rather than with the `spawn` calls that follow it.

Recommended Fix:
Move `hydrate` behind `tauri::async_runtime::spawn_blocking` (or spawn it the
way `relations::spawn_loader` is spawned) and have the frontend's
`get_library_index` / `get_library_status` report "loading" until it lands —
both already return whatever the `LibraryIndex` state currently holds, so an
empty index during hydration is representable without a new type.

Regression Tests Required:
- A Rust test that `hydrate` over a seeded 20,000-row `library_files` produces
  the same `LibraryData` whether run inline or on a blocking thread (i.e. that
  moving it is behaviour-preserving), written to pass single-threaded.

Confidence: HIGH on the mechanism — the call site and `hydrate`'s body were both
re-read. MEDIUM on the severity, because the per-row parse cost was not measured
and the row count is entirely user-dependent.
Source: found during adversarial verification

---

ID: PERF-04

Severity: P3

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src/pages/LocalLibrary.tsx

Line: 451-454 (the four unbounded arrays), 552-576 (the four consumers), 903-935 (`Group`), 630-682 (`DetectedOffList`), 942 (`LibraryRow`)

Function: `LibraryView` → `Group` / `DetectedOffList` / `Unplaced` → `LibraryRow`

Problem:
The local-library screen renders one full `LibraryRow` per indexed title,
eagerly and unvirtualized, while `MediaList` — the other screen of the same
shape — goes through `VirtualGrid` for exactly this reason.

```ts
const onListRows = rows.filter((r) => r.entry);       // :451
const ready      = onListRows.filter((r) => r.next);  // :452
const done       = onListRows.filter((r) => !r.next); // :453
const offListRows = rows.filter((r) => !r.entry);     // :454
```

Each of the four groups receives the whole array (`rows={ready}` :552,
`rows={done}` :559, `rows={offListRows}` :566, `groups={failed}` :576). The only
`.slice()` in the file caps the *per-row file list* (:804), not the row list.
`grep -rln "VirtualGrid" src/` returns `columns.ts`, `ListHeader.tsx`,
`VirtualGrid.tsx`, `ListRow.tsx`, `formatGroups.ts` and `MediaList.tsx` —
`LocalLibrary.tsx` is not among them. `grep -n "memo(" src/pages/LocalLibrary.tsx`
returns nothing, so `LibraryRow` is not memoized either.

The file's own comment acknowledges the scale: n·log n sorting work "over a
library that can hold thousands of titles, re-run on every rescan, every
correction and every content-filter change" (:231-236).

Expected Behavior:
A screen that can hold thousands of rows renders only the visible window, as
`MediaList` does.

Actual Behavior:
Every indexed title is committed to the DOM on mount and re-rendered on every
rescan, correction and content-filter change (the `rows` memo depends on
`[entries, byMedia, byId, level]`).

Reproduction:
Point the scanner at a folder with a few thousand matched titles and open
`/library`. (Static analysis only — not executed.)

Impact:
Mount cost and per-interaction re-render cost grow linearly with library size on
the one screen whose whole purpose is a large local collection. Each correction
made from this screen also triggers PERF-15, so the two compound: the correction
blocks the UI thread in Rust, then the screen re-renders every row.

Root Cause:
The screen was written as four static sections; the virtualization work landed
on `MediaList` and was not carried across.

Recommended Fix:
Render each `Group`/`DetectedOffList` body through `VirtualGrid` with
`gridClassName="grid"` and `rowGap={0}` — the configuration `MediaList` uses for
its list view (`MediaList.tsx:923-928`) — taking the page's scroll container as
`scrollRef`. If the four-section layout makes one virtualizer awkward, the
minimum viable fix is a per-section "show all" cut-off in the style of the
existing `Unplaced` one (:881-892).

Regression Tests Required:
- A `.dom.test.tsx` rendering `LibraryView` with 2,000 synthetic rows and
  asserting the rendered row count is bounded (`< 100`), not equal to the input
  length.

Confidence: MEDIUM. The mechanism is proven from the source; nothing was
measured and the cost is entirely library-size-dependent.

Verification: downgraded from P2 — nothing measured, images are already
`loading="lazy"` (:983) so the network cost is windowed, and a typical library of
a few hundred titles renders in the same order as any settings pane; not a P2
without a frame-time number.

---

ID: PERF-05

Severity: P3

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src-tauri/src/alerts/site.rs

Line: 106-110 (the tick loop), 117-127 (the interval gate), 130-139 (the failure exit), 142-146 (the stamp)

Function: `alerts::site::check`

Problem:
On a sustained failure the site-notification pass degrades from its configured
interval (15–720 minutes) to one request every 60 seconds, because the "last
check" stamp is written only on success while the loop's own gate is the only
thing throttling it.

```rust
loop { check(&app).await; tokio::time::sleep(TICK /* 60 s */).await; }   // :107-110

async fn check(app: &AppHandle) {
    ...
    if now_ms() - last < interval * 60_000 { return; }        // :125-127
    let data = match api.query(...).await {
        Ok(d) => d,
        Err(e) => { debug_changed(...); return; }             // :130-139  ← no stamp
    };
    let _ = db.kv_set(LAST_CHECK_KEY, ...);                   // :142-146  ← success only
}
```

`last` is unchanged after a failure, so the gate stays open and the next tick
60 seconds later issues another request.

Expected Behavior:
A failed pass waits at least until the next configured interval, or backs off.
The comment at :142-144 intends "a failed fetch must not silence the *next
interval*" — not "retry every tick".

Actual Behavior:
At the 15-minute floor a persistent failure (AniList 5xx, a captive portal, a
dead token) turns 4 requests/hour into 60 — a derived 15× amplification. At the
720-minute ceiling it is 720×. Every one comes out of the ~30/min budget shared
with the scrobbler and the user-facing screens, spent with nobody asking, on a
pass whose own header calls itself "the first thing in the app that spends the
shared ~30/min budget with nobody asking".

(During a 429 the amplification is partly self-limiting, because `api.query`
sleeps out its own `Retry-After` inside `check`. A plain 5xx or a DNS failure
returns fast and gives the full 60 s cadence.)

Reproduction:
Static trace. Enable the background notification interval at 15 minutes and make
`api.query` fail persistently. `LAST_CHECK_KEY` is never stamped, :125 never
short-circuits, one `SITE_QUERY` goes out per 60-second tick.

Impact:
Budget spent 15×–720× faster than configured, precisely when the API is already
unhealthy — the interaction that turns a transient outage into a rate-limit
episode, which PERF-03 then fails to brake. Android's JobScheduler half defers
to the same `site_notif_last_check_ms` stamp (`background.rs:104`), so the phone
inherits the behaviour.

Root Cause:
One stamp is asked to mean two things — "we last got an answer" (what the toast
cursor needs) and "we last tried" (what the throttle needs). Only the first is
written.

Recommended Fix:
Stamp attempts separately from successes: keep `site_notif_last_check_ms` as the
success/cursor stamp, add `site_notif_last_attempt_ms` written on every exit
from the request, and have the :125 gate read the attempt stamp. A short
exponential backoff on consecutive failures, capped at the configured interval,
would be better still and costs one more kv key.

Regression Tests Required:
- A test over the gate arithmetic, extracted as a pure fn taking
  `(now, last_attempt, interval_min)`, asserting a failed attempt still pushes
  the next fire out by the full interval.
- A test that success and failure both advance the attempt stamp, and only
  success advances the cursor stamp.

Confidence: HIGH. The gate is opt-in and off by default (:48-59), which is what
holds this at P3 rather than higher.

---

ID: PERF-06

Severity: P3

Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/relations.rs

Line: 159 (`crate::net::client_builder().build()`), 166 (`client.get(SOURCE_URL).send().await`)

Function: `relations::spawn_loader`'s fetch

Problem:
The relations loader is the only outbound HTTP client in the tree with no
timeout — neither on the builder nor on the request.

```rust
let client = match crate::net::client_builder().build() { ... };   // :159
let resp = match client.get(SOURCE_URL).send().await { ... };      // :166
```

`grep -n "timeout" src-tauri/src/net.rs` returns nothing, so the seam sets no
default either. Every other builder sets one: `client.rs:388` (30 s),
`update.rs:156`, `images.rs:101`, `background.rs:120`, and Jellyfin per-request.
`update.rs:151-154` states the rule as settled fact — "A timeout, like every
other outbound client in this codebase" — which this call site falsifies.

Expected Behavior:
Every outbound request has a deadline, so a task cannot be parked on a socket
for the life of the process.

Actual Behavior:
A server that accepts the connection and then never responds (a captive portal,
a black-holing middlebox, a stalled TLS handshake) leaves the loader task and
its socket alive indefinitely. The redirect rules never refresh for that
session.

Reproduction:
Static analysis of the builder and the request; no run required.

Impact:
A leaked task and socket, plus relations rules that never refresh for the
session. The blast radius is bounded because the cached copy loaded at :138-141
keeps redirects working, so this is a resource leak rather than a functional
outage — which is what holds it at P3.

Root Cause:
The call site was rewritten to go through `net::client_builder` (for the Android
TLS fix its comment records) without adding the `.timeout(...)` the other four
builders carry, and `net.rs` sets no default that would have covered it.

Recommended Fix:
Add `.timeout(Duration::from_secs(30))` at :159, matching `client.rs:388`.
Better still, set a default timeout inside `net::client_builder` so the seam
cannot be bypassed by omission — that is the seam's stated purpose ("one seam so
a TLS fix cannot miss a builder", CLAUDE.md).

Regression Tests Required:
- A Rust test asserting `net::client_builder()` produces a client with a
  non-`None` timeout, once the default lands. That is the only form that holds
  for every present and future call site.

Confidence: HIGH

---

ID: PERF-07

Severity: P4

Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src/pages/Dashboard.tsx

Line: 58-70 (two list queries), 121 (`<SeasonHero />`), 374-379 (the comment); also src/pages/Statistics.tsx:165, 183, 206; src/pages/Calendar.tsx:97, 121; src/pages/LocalLibrary.tsx:121, 175, 269

Function: `DashboardContent`, `Statistics`, `Calendar`, `LibraryView`

Problem:
CLAUDE.md states the invariant "Two queries per mount, at most." Four screens
exceed it, and three carry in-file comments asserting they do not.

- **Dashboard**: the comment at :374-379 says the birthdays query waits for the
  two list queries "so the dashboard's mount burst stays at two concurrent
  requests". But `<SeasonHero />` is rendered at :121, *above* the loading gate,
  and its own query (`SeasonHero.tsx:43-47`) is `enabled: isTauri && filterReady`
  — gated on nothing the Dashboard controls. Mount burst is three.
- **Statistics**: three list-shaped queries (:165, :183, :206). The comment at
  :202-205 is accurate for `type === "ANIME"`; on `/stats?type=MANGA` — a URL
  the app writes itself (:155-160) — the keys differ and it is a third
  concurrent request.
- **Calendar** `?lens=all`: `fetchMediaList` plus `airingWeek`, up to five
  sequential pages (`queries.ts:349, 357-362`), on a route the window can
  restore into.
- **LocalLibrary**: three concurrent queries, two of which each expand to
  ⌈n/50⌉ sequential requests (`queries.ts:463-470`) — unbounded in library size.

Expected Behavior:
Either the screens honour the cap, or the invariant is restated with its real
bound and the comments claiming compliance are corrected.

Actual Behavior:
Static count: three concurrent on a cold Dashboard, three on `/stats?type=MANGA`,
two-plus-five on `/calendar?lens=all`, three-plus-⌈n/50⌉ on `/library`.

Reproduction:
Static analysis of the `enabled` predicates.

Impact:
No user-visible failure. `claim()` (`client.rs:359-361`, :503) exists precisely
so a burst can see itself, so the *limiter* is safe. What is affected is the
next reader: an author reading `Dashboard.tsx:374` will believe the Dashboard
costs two requests, and the invariant is the app's only stated defence against
burst spending. The interaction that matters is with PERF-02 and PERF-03 —
three queries × two retry layers is twelve HTTP requests for one cold Dashboard
during a throttle.

Root Cause:
`SeasonHero` was added above the loading gate (correctly, for UX) without
revisiting the comment two hundred lines below that counts the burst.
Statistics' third query is type-dependent and its comment reasons only about the
ANIME case.

Recommended Fix:
Per screen: gate `SeasonHero`'s query on the same `settled` signal `Birthdays`
uses, or correct the comment and the CLAUDE.md sentence to state the real bound;
accept and document three on Statistics; bound LocalLibrary's `mediaByIds`
expansion per mount, matching the app's own paging-is-a-button rule.

Regression Tests Required:
- A `.dom.test.tsx` per screen rendering against a mocked `invoke` and asserting
  the number of `anilist_query` / `fetch_media_list` calls made before any user
  interaction. That is the only kind of test that can hold this invariant.

Confidence: HIGH

Verification: downgraded from P3 — convention drift rather than a defect; the
limiter's `claim()` makes the burst safe, and only one of the three comments
(`Dashboard.tsx:374-379`) is actually false.

---

ID: PERF-08

Severity: P4

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src/components/shell/Bell.tsx

Line: 321-329 (the rising-edge effect), 277-291 (the site feed query)

Function: `Bell` — the `open` rising-edge effect

Problem:
Opening the bell spends an AniList request whose answer is, in the success path,
unconditionally discarded.

```jsx
setSiteUnseen(count.data ?? 0);
void qc.invalidateQueries({ queryKey: ["social", "notifCount", viewerId] });  // :328 → request A
```

while the feed's own `queryFn` fetches page 1 with `resetNotificationCount: true`
(`api/social.ts:1462` — request B), which zeroes the count server-side, and then
sets it to 0 client-side at :285 regardless of what A returned.

Expected Behavior:
Opening the bell costs the one request that fetches the feed.

Actual Behavior:
It costs two. Whichever lands first, A's value is overwritten by 0 — and even if
A landed first, the value it read is about to become 0 anyway. `invoke` cannot be
cancelled, so the `cancelQueries` at :283 discards a response the budget has
already paid for.

Reproduction:
Static trace of the two effects.

Impact:
One extra request per bell open out of a ~30/min budget shared with the
scrobbler and the alert passes.

Root Cause:
The count refetch is a leftover from the old `enabled: open` design (the comment
at :253-261). Since the feed's page-1 reset became unconditional, it is
redundant in the path that matters.

Recommended Fix:
Drop the `invalidateQueries` at :328 and move the recovery to the feed's failure
path: `if (site.isError) qc.invalidateQueries({ queryKey: ["social","notifCount", viewerId] })`.
The snapshot at :327 already reads whatever the 10-minute interval last fetched,
which is what the dots need.

Regression Tests Required:
- A `.dom.test.tsx` opening the bell against a mocked `invoke` and asserting
  exactly one `anilist_query` call for a successful feed fetch, and two when the
  feed fetch rejects.

Confidence: HIGH

Verification: downgraded from P3 — the redundancy is not total. The feed carries
`staleTime: 60_000`, so a re-open inside a minute does not refetch page 1 and the
count refetch is then the only freshness; it also remains load-bearing on the
feed's failure path. One request per user-initiated open, with a stated purpose.

---

ID: PERF-09

Severity: P4

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src/hooks/useManualSync.ts

Line: 26-27 (the docstring's claim), 58-60 (the invalidation)

Function: `useManualSync.sync`

Problem:
The docstring says "Three AniList requests per click, behind an explicit user
action", but the trailing invalidation marks every non-`mediaList` query invalid:

```ts
await qc.invalidateQueries({
  predicate: (q) => q.queryKey[0] !== "mediaList",
});
```

Two consequences the docstring does not cover:

1. **Infinite queries refetch every retained page.** `UserList`'s own comment
   states the rule: "`refetch()` on an infinite query refetches every retained
   page. Six loaded pages, no user action, six requests" (`UserList.tsx:27-29`).
   Static count: there are **11 `useInfiniteQuery` call sites** in `src/`.
2. **`staleTime: Infinity` is not respected by invalidation.** `["genreTags"]` is
   declared `staleTime: Infinity, gcTime: Infinity` with the comment "One
   request, effectively permanent" (`Search.tsx:150-154`); invalidation marks it
   stale regardless. `Dashboard.tsx:378` has another in the same position.

Expected Behavior:
A manual sync costs the bounded, documented number of AniList requests its own
docstring states.

Actual Behavior:
Three, plus one per retained page of every *mounted* infinite query, plus every
other mounted query. Standing on `/thread/:id` with several pages of comments
loaded and pressing Ctrl+R (`GlobalKeys.tsx:60-63`) issues those comment
requests on top of the documented three.

Reproduction:
Open `/thread/<busy thread>`, click "Load more" four times, press Ctrl+R, and
count the outbound GraphQL calls. (Static analysis only — not executed.)

Impact:
A refresh gesture the docstring presents as cheap can spend a noticeable slice
of the per-minute budget in one press, against a limiter that "reads its budget
then drops the lock before any response header lands, so it cannot see a burst
it has not sent" (CLAUDE.md). Held-down Ctrl+R is guarded by `busy.current`, so
this is per-press rather than runaway.

Root Cause:
The predicate excludes exactly one key prefix and takes everything else, chosen
when the app had far fewer paginated surfaces.

Recommended Fix:
Narrow to `refetchType: "none"` (mark stale, let the next mount fetch) or to an
explicit allowlist of keys worth refreshing on a manual sync. At minimum,
correct the docstring so the next reader is not misled about the cost.

Regression Tests Required:
- A test seeding an infinite query with three pages, running `sync()`, and
  asserting the fetch count for that key.

Confidence: MEDIUM

Verification: downgraded from P3 — the default `refetchType` is `"active"`, so
only *mounted* observers refetch, which on most screens is one or two queries;
and the docstring's "three requests" refers to the explicit `fetchQuery` /
`refreshViewer` calls it lists in the same paragraph. Real and worth a docstring
fix or `refetchType: "none"`, but not a P3 performance problem. (Raised
independently by both the frontend and the sync audits.)

---

ID: PERF-10

Severity: P4

Category: IMPROVEMENT

File: /home/user/Karasu/src/hooks/useFollow.ts

Line: 59; also /home/user/Karasu/src/hooks/useSocialActions.ts:109

Function: `useFollow().follow.onMutate` and siblings

Problem:
`await qc.cancelQueries({ queryKey: ["social"] })` cancels every in-flight query
under the whole `social` prefix — the feed, every profile, every thread, every
comment page, user search — because one follow (or like) button was pressed.
`patch()` (`useFollow.ts:25-54`) touches only `["social","user"]`,
`["social","followers"]`, `["social","following"]` and `["social","userSearch"]`.

Expected Behavior:
The house rule "cancel before an optimistic write" is scoped to the queries the
write actually patches — which is exactly what `useListMutations.ts:173` does
for the one list key.

Actual Behavior:
Cancelling `["social"]` additionally discards in-flight `["social","feed"]`,
`["social","activities"]`, `["social","thread*"]`, `["social","reviews"]` and
`["social","siteNotifs"]` reads. Since `invoke` has no cancellation and `gql`
ignores the `AbortSignal` TanStack supplies (`api/anilist.ts:83-85`), the Rust
commands run to completion and spend their budget; only the answers are thrown
away.

Reproduction:
Static trace: open a profile's Followers tab and, while page 2 is loading, press
Follow on another row. The page-2 read is discarded; the Rust request still ran.

Impact:
Small. A few discarded responses out of a ~30/min budget, and a visible reload
of a list that was mid-flight.

Root Cause:
The prefix was chosen for convenience; the patch set is narrower than the cancel
set.

Recommended Fix:
Cancel only the scopes `patch` touches, and thread the `AbortSignal` through
`gql`/`invoke` for the frontend's own benefit even though the backend cannot
honour it.

Regression Tests Required:
- A unit test asserting `cancelQueries` is called with each scoped key and not
  with the bare `["social"]` prefix.

Confidence: HIGH

---

ID: PERF-11

Severity: P4

Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/anilist/client.rs

Line: 113-122 (`impl From<ApiError> for String`), with /home/user/Karasu/src/app/main.tsx:31-32

Function: `From<ApiError> for String` × the `QueryClient` retry predicate

Problem:
`ApiError::Retryable(m) | ApiError::Api(m) => m` flattens two different classes
to the same bare string, so the frontend predicate cannot tell them apart:

```rust
ApiError::Auth(_) => TOKEN_REJECTED.into(),
ApiError::Retryable(m) | ApiError::Api(m) => m,
```

Expected Behavior:
A permanently-refused payload (a GraphQL validation error, a malformed mutation)
costs one round trip, not two.

Actual Behavior:
`main.tsx:31-32` retries anything that is neither `isTokenRejected` nor
`isNotFound`, so an `Api` error is retried once. `classify` (`client.rs:163-175`)
does treat `Api` as permanent, and `process_queue` drops such rows
(`commands/list.rs:920-928`) — the knowledge exists in Rust and is discarded at
the boundary.

Reproduction:
Static trace of the `From` impl and the predicate.

Impact:
Two round trips for a class that should cost one. Rare in practice; it is the
same missing-stable-code shape as PERF-02's first recommendation, and both are
fixed by the same change.

Root Cause:
Only auth was given a stable code (`TOKEN_REJECTED`); the other classes were
flattened to AniList's own wording.

Recommended Fix:
Give `Api` (and, per PERF-02, a surviving rate limit) stable codes the frontend
can branch on, and exclude `Api` from the retry predicate.

Regression Tests Required:
- A unit test on the predicate asserting `false` for the `Api` code.
- A Rust test asserting `String::from(ApiError::Api(..))` carries the code.

Confidence: MEDIUM

---

ID: PERF-12

Severity: P4

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src-tauri/src/commands/system.rs

Line: 597-611, with /home/user/Karasu/src-tauri/src/backups.rs:93-149 and /home/user/Karasu/src-tauri/src/db.rs:711-716

Function: `set_backup_settings` → `backups::run_once` → `Db::snapshot_to`

Problem:
`set_backup_settings` is a plain (non-`async`) `#[tauri::command]`, i.e.
`ExecutionContext::Blocking` by the rule `library.rs:388-394` states. It calls
`backups::run_once`, which runs a `PRAGMA quick_check` over today's backup file
and a whole-database `VACUUM INTO` (`db.rs:711-716`), then a directory listing
and up to N file deletes.

Expected Behavior:
Toggling a setting does not freeze the window for the duration of a full
database copy.

Actual Behavior:
Switching backups on (`backups.rs:95-98` returns early only when *disabled*, so
the enable path always proceeds) runs `db.snapshot_to(&today)` synchronously on
the UI thread while holding the `Db` mutex against every other writer. The list
cache is stored uncompressed (`commands/list.rs:20` says so), so the database is
comfortably multi-megabyte for an ordinary account.

Reproduction:
Settings → toggle daily backups on. (Static analysis only — not executed.)

Impact:
A one-off freeze on an explicit user action, bounded by database size, with no
correctness impact; background writers are blocked behind the same mutex for the
same interval.

Root Cause:
The command is not `async`, so it does not go to the blocking pool — the same
defect the scan command was already fixed for.

Recommended Fix:
`#[tauri::command(async)]` on `set_backup_settings`, or spawn `run_once` into
the async runtime and return immediately (the backup's result is already
reported only through the log).

Regression Tests Required:
Covered by the declaration test PERF-15 asks for, widened to every command whose
body reaches `snapshot_to` or `persist`.

Confidence: HIGH

Verification: downgraded from P3 — a one-off freeze on an explicit user action,
bounded by database size, with no correctness impact. The same pattern with far
worse bounds is filed at P3 as PERF-15.

---

ID: PERF-13

Severity: P4

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src-tauri/src/library.rs

Line: 454-457, with /home/user/Karasu/src-tauri/src/db.rs:1226-1234

Function: `scan_library` → `Db::library_all`

Problem:
`let previously_indexed = { db.library_all().len() };` materialises every row of
`library_files` — including the full path `String` for each — purely to obtain a
count.

```rust
pub fn library_all(&self) -> Vec<(i64, u32, String)> {   // db.rs:1226
    let conn = self.0.guard();
    conn.prepare("SELECT media_id, episode, path FROM library_files")
    ...
}
```

Expected Behavior:
`SELECT COUNT(*) FROM library_files`.

Actual Behavior:
At `MAX_FILES = 20_000` this allocates up to 20,000 `String`s plus the tuple
vector and drops them one statement later, while holding the `Db` mutex for the
whole `query_map`.

Reproduction:
Static.

Impact:
Transient allocation and a mutex hold that blocks the scrobbler and the alert
passes for its duration, once per scan. Negligible in absolute terms — no
measurement was taken.

Root Cause:
Reuse of an existing accessor rather than a purpose-built count.

Recommended Fix:
Add `Db::library_file_count()` doing `SELECT COUNT(*)` and call it here.
`library_all`'s other caller (`hydrate`, :834) genuinely needs the rows.

Regression Tests Required:
None mechanical; the existing scan tests cover the value.

Confidence: HIGH

---

ID: PERF-14

Severity: P4

Category: CODE SMELL

File: /home/user/Karasu/src/stores/auth.ts

Line: 128-134

Function: `useAuth.init`

Problem:
`init()` registers `listen("anilist-auth", …)` without awaiting the registration
promise and without storing the unlisten handle, and it is called from a React
effect (`App.tsx:84-89`) under `<React.StrictMode>` (`main.tsx:53`). The sibling
store shows the intended shape: `nowPlaying.ts:72-88` guards with a module-level
`initialized` flag at :66.

Expected Behavior:
A module-level listener registers once, as `useNowPlaying.init` does.

Actual Behavior:
StrictMode's double-invoke registers the listener twice; both survive, and both
run on every `anilist-auth` event.

Reproduction:
Static analysis of the two stores side by side.

Impact:
Dev-only, and the handler is idempotent, so nothing user-visible follows. It is
the one place in `src/` where the "await the registration before unlistening"
lesson recorded at `NowPlayingCard.tsx:113` is not applied. Static count for
context: every other `listen` call site returns a cleanup that awaits the
registration promise — `NowPlayingCard.tsx:108-116`, `GlobalKeys.tsx:74-78`,
`Bell.tsx:228-231`, `useNotifBadge.ts:32-35`, `useAniListLogin.ts:37-46`,
`App.tsx:99-105`.

Root Cause:
`init` predates the guard pattern `nowPlaying.ts` established.

Recommended Fix:
Add the module-level `initialized` flag `nowPlaying.ts:66` uses, or store and
honour the unlisten handle.

Regression Tests Required:
- A `.dom.test.tsx` that mounts `App` under StrictMode against a mocked `listen`
  and asserts one registration for `anilist-auth`.

Confidence: HIGH

---

ID: PERF-17

Severity: P4

Category: CODE SMELL

File: /home/user/Karasu/src/components/media/MediaCard.tsx

Line: 50-57

Function: `MediaCard` — `saveEntry.onSuccess`

Problem:
The save handler writes to the `media` prop directly:

```ts
// Patch the discovery cache locally instead of refetching (rate limit)
media.mediaListEntry = {
  id: result.entry?.id ?? media.mediaListEntry?.id ?? 0,
  status: input.status ?? media.mediaListEntry?.status ?? "PLANNING",
  ...
};
```

`media` is an object owned by the `["search", …]` / `["seasonal", …]` query data
that TanStack holds. Mutating it in place bypasses `setQueryData`.

Expected Behavior:
A cache patch goes through `qc.setQueryData`, which produces a new object,
notifies every observer of that key, and participates in structural sharing.

Actual Behavior:
No other observer of that page re-renders — this card only updates because its
own mutation state changed. Two cards for the same media on the same screen can
disagree, and the mutated object survives structural sharing in ways nothing
pins. The intent (avoid a refetch against the rate limit) is right; the
mechanism is not.

Reproduction:
Static analysis of the handler and the query keys that own `media`.

Impact:
Cosmetic today. The real cost is that it is the mechanism that makes a stale
cached object stickier than a plain read, so it compounds any cache-lifetime
defect filed elsewhere, and it defeats the re-render the patch is trying to
cause.

Root Cause:
`setQueryData` needs the key, which the card does not have — it receives only
`media` — so the shortcut was taken.

Recommended Fix:
Pass the owning query key down, or move the patch into the shared
`useListMutations` path that already does `setQueryData` correctly
(`useListMutations.ts:124-164`).

Regression Tests Required:
- A `.dom.test.tsx` rendering two `MediaCard`s for the same media from one
  seeded query, saving through one, and asserting both render the new progress.

Confidence: HIGH
Source: found during adversarial verification

---

ID: PERF-18

Severity: P4

Category: CODE SMELL

File: /home/user/Karasu/src/pages/AnimeDetail.tsx

Line: 1447; also /home/user/Karasu/src/pages/About.tsx:164 and /home/user/Karasu/src/pages/Wrapped.tsx:864

Function: `ListEditor`'s save `onSuccess`, `About.copy`, `Wrapped`'s save handler

Problem:
Three handlers arm a bare 2 s `setTimeout` that writes state, with no cleanup
and no ref:

```ts
setSaved(true);
setTimeout(() => setSaved(false), 2000);     // AnimeDetail.tsx:1447
if (ok) setTimeout(() => setCopied(false), 2000);   // About.tsx:164
if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }  // Wrapped.tsx:864
```

Expected Behavior:
A timer that writes state is cleared on unmount, which is the pattern every
other timer in the app follows.

Actual Behavior:
The timer fires after the component may have unmounted. Under React 19 the
resulting `setState` on an unmounted component is a no-op rather than a warning,
so nothing surfaces.

Reproduction:
Static analysis; `grep -rn "setTimeout(" src/` (excluding tests) returns 15 call
sites, of which these three write state without a cleanup path.

Impact:
Harmless in practice under React 19. It is filed because the frontend audit's
own *Verified sound* paragraph claims "`useCountdown`, `PlaybackError`,
`useListSummary`'s 60 s tick and `usePresence`'s exit timer all clear on
cleanup" — true of those four, but the blanket "every timer clears" reading is
wrong, and a future React or a future handler that touches a ref rather than
state would make it matter.

Root Cause:
Three one-off confirmation flashes written inline rather than through a shared
"flash a receipt" hook.

Recommended Fix:
Extract the pattern into a small `useFlash(ms)` hook that owns the timer and
clears it on unmount, and use it at all three sites.

Regression Tests Required:
- A `.dom.test.tsx` that triggers the save, unmounts, advances fake timers past
  2 s, and asserts no state write is attempted.

Confidence: HIGH
Source: found during adversarial verification

---

ID: PERF-19

Severity: P4

Category: CODE SMELL

File: /home/user/Karasu/src/hooks/useGridRoving.ts

Line: 52

Function: `useGridRoving`

Problem:
The hook writes its ref during render, outside any effect:

```ts
const state = useRef({ focus, count, columns, onOpen, sections });
state.current = { focus, count, columns, onOpen, sections };   // :52
```

The comment above it explains the *reason* for the ref correctly — keeping the
key listener mounted for the life of the screen, so it does not re-subscribe on
every focus change — but the assignment is a render-phase side effect.

Expected Behavior:
A ref used to smuggle fresh values into a long-lived listener is updated in an
effect (or via `useEffectEvent`-style indirection), not during render.

Actual Behavior:
It works today because the component is never suspended. Under StrictMode the
render runs twice per keypress and the write happens twice; under a future
suspended or discarded render it would write values for a render that never
committed.

Reproduction:
Static analysis of the hook body.

Impact:
None observed. It is the same class of hazard as PERF-14, in the one hook
StrictMode double-renders on every keypress.

Root Cause:
The ref-as-latest-value idiom written in its shortest form.

Recommended Fix:
Move the assignment into a `useEffect` with no dependency array (or with the
five values as deps). The listener reads `state.current` at event time, which is
always after commit, so the semantics are unchanged.

Regression Tests Required:
- The existing roving tests, re-run under StrictMode double-render, asserting
  one movement per keypress.

Confidence: HIGH
Source: found during adversarial verification

---

ID: PERF-20

Severity: P4

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src-tauri/src/backups.rs

Line: 151-161 (`spawn`), with 93-149 (`run_once`)

Function: `backups::spawn`

Problem:
The hourly loop calls the fully blocking `run_once` directly inside an async
block:

```rust
pub fn spawn(app: AppHandle) {
    crate::logging::supervise("backups", move || {
        let app = app.clone();
        async move {
            loop {
                run_once(&app);                                        // :156
                tokio::time::sleep(Duration::from_secs(60 * 60)).await;
            }
        }
    });
}
```

`run_once` is a synchronous `fn` doing `PRAGMA quick_check`, `VACUUM INTO`
(`db.rs:711-716`), `read_dir` and up to N `remove_file` calls.

Expected Behavior:
Blocking filesystem and SQLite work inside an async task goes through
`tauri::async_runtime::spawn_blocking`, so it cannot occupy a runtime worker.

Actual Behavior:
The worker thread running this future is blocked for the duration of a whole
database copy, once an hour, alongside every other task the multi-threaded
runtime is scheduling.

Reproduction:
Static analysis of the loop body.

Impact:
Bounded: once an hour, and the Tokio runtime has other workers. It is filed
because it is the same defect as PERF-12 and PERF-15 in a different context —
the blocking work is correct, its placement is not — and fixing all three
together is one change of shape.

Root Cause:
`run_once` is also called directly from `set_backup_settings` (PERF-12), so it
was written as a plain `fn`, and the loop simply calls it.

Recommended Fix:
Wrap the call: `tauri::async_runtime::spawn_blocking(move || run_once(&app)).await`.

Regression Tests Required:
None mechanical; covered by the declaration/placement test PERF-15 asks for if
that is widened to "blocking work is never called bare from an async loop".

Confidence: HIGH
Source: found during adversarial verification

---

## Verified sound

Scenarios traced and found correct, with the guard that handles each. These are
kept from the source audits and were re-checked during verification; they show
what the performance sweep covered and found working.

**Event-listener lifecycle.** Every `listen` call site except `auth.ts:128`
(PERF-14) returns a cleanup that *awaits the registration promise* — the form
that survives an unmount beating the IPC round trip:
`NowPlayingCard.tsx:108-116`, `GlobalKeys.tsx:74-78`, `Bell.tsx:228-231`,
`useNotifBadge.ts:32-35`, `useAniListLogin.ts:37-46`, `App.tsx:99-105`
(`onOpenUrl`). `useNowPlaying.init` needs no cleanup because a module-level
`initialized` flag (`nowPlaying.ts:66, :74-75`) makes it run once. DOM listeners
balance: **static count of 34 `addEventListener` against 30
`removeEventListener`**, and the four unmatched are module-level singletons that
must outlive any component — `theme.ts:295` (media query), `useBackClose.ts:12`
(the one `popstate` listener), and the two global error reporters in
`main.tsx:41`/`:44`.

**Timers.** `useSyncStatus`'s one-second poll is gated `enabled: open && isTauri`
(`useSyncStatus.ts:24`) and its only consumer passes the panel's open state
(`SyncPanel.tsx:107`), so nothing polls in the background;
`refetchIntervalInBackground` is left at its default, so it also stops when the
window is hidden. The two 10-minute intervals (`Bell.tsx:267`,
`useNotifBadge.ts:43`) share one query key, so they add an observer rather than a
second request. `useCountdown` (`NowPlayingCard.tsx:38-44`), `PlaybackError`
(`App.tsx:290-294`), `useListSummary`'s 60 s relative-time tick
(`useListSummary.ts:59-63`) and `usePresence`'s exit timer
(`usePresence.ts:41-72`, including cancel-on-reopen) all clear on cleanup.
`stores/toast.ts` keeps one module-level timer and clears it before every re-arm
(:46, :52). The three exceptions are PERF-18.

**Render economy on the 5 s detection poll.** The poll does not re-render the
shell. On the poll path `now-playing` is emitted only inside the
`raw != last_raw` branch (`scrobbler.rs:1038-1062`); the tree's other two emits
(:772 after a completed scrobble write, :906 after a correction) are
event-driven rather than per-tick. `scrobble-state` is emitted only on a phase
transition (nine `emit_session` call sites, all inside state changes). Only three
components subscribe to `useNowPlaying` — `NowPlayingCard` (:75, :223, :352) and
`DetectionPill` (:17) — each with a narrow field selector.

**Zustand selector discipline.** Selectors return values the store already holds
by reference; the one place that must derive does it in a `useMemo` outside the
selector, with a frozen `EMPTY_CATEGORIES` constant for the empty case and a
comment recording the measured "Maximum update depth exceeded" that forced it
(`auth.ts:69-97`).

**Memoization vs. prop stability.** `GridCard` and `ListRow` are `memo`'d, and
every handler `MediaList` passes them is a `useCallback` with correct deps —
`toggleSelect` (:183), `quickSave` (:455), `complete` (:463), `plusOne` (:474),
`startEdit` (:480) — so no inline lambda defeats the memo. `blurred` is computed
by the page and passed as a boolean specifically so a `useContentFilter`
subscription inside the card cannot re-render hundreds of them
(`GridCard.tsx:34-41`).

**Query-key growth on typing.** Search debounces 500 ms into a separate `term`
state (`Search.tsx:131-135`) and gates on `enabled: … && active` (:230), so keys
are minted per settled term, not per keystroke. The three entity scopes receive
the same debounced term and gate on `USER_SEARCH_MIN`. `MatchPicker` debounces
350 ms (:106-110) and `SeasonSplitModal` likewise. Genre/tag multi-selects go
into the key *encoded* by `lib/multiFilter`'s `encode`, which sorts, so picking
the same two genres in either order is one entry.

**Retained infinite-query pages.** `Bell` trims to page 1 on close and — the
subtle half — preserves `dataUpdatedAt` so the trim does not postpone the reopen
refetch (`Bell.tsx:296-313`). `Thread` uses `removeQueries` on the
subscribed-forum key (:423-426). The rest fall out of the 30-minute default
`gcTime` once their page unmounts.

**Paging is a button everywhere.** Static check: `grep -rn "IntersectionObserver"
src/` returns exactly one hit, and it is the *comment* in `UserList.tsx:22`
explaining that the observer is deliberately never built. Every paginated list
uses `fetchNextPage` on a click.

**Documented performance invariants, re-verified.** `usePrimedLists` still
backdates with `{ updatedAt: 0 }` (`usePrimedLists.ts:43`).
`RecommendedSection` still sorts `seedIds` numerically before using them as a
key (`RecommendedSection.tsx:75-80`). The `scrobble-done` listener still reads the media type from the
store *at fire time* and still keeps the broad-key fallback
(`NowPlayingCard.tsx:109-114`). The status-tab underline is still row-aware with
the `+14` last-row offset and a `ResizeObserver` (`status-tabs.tsx:46-75`).
`DigestRow`'s trailing block is still `min-w-0`, not `shrink-0`
(`DigestRow.tsx:42-46`). The cover grid is still
`repeat(var(--cover-cols, 8), minmax(0, 1fr))` (`index.css:626`) written from the
theme store (`theme.ts:126`).

**Bounded by construction.** The notification table is capped at `NOTIF_KEEP = 500` rows on
write (`db.rs:483`, enforced at `db.rs:1104-1107`) and read 100 at a time, so the un-virtualized bell list
cannot grow without bound. `useListSummary` subscribes with `enabled: false`, so
the sidebar's two numbers cost zero requests. The scan's own caps are declared
(`MAX_DEPTH = 6`, `MAX_FILES = 20_000`, `library.rs:19-20`).

**Rust-side atomicity that costs nothing extra.** `library_replace_all`
(`db.rs:1180-1212`) puts the file rows and the match confidences in one
transaction — an index that survived a crash without its confidences would show
every title as an exact match — and the migration ladder's `apply`
(`db.rs:493-496`) wraps each DDL step with its `PRAGMA user_version` bump in one
transaction. Neither is a performance cost worth removing.

**Baseline suite behaviour.** The two-project vitest split CLAUDE.md documents
(node by default; only `*.dom.test.tsx` boots jsdom) is intact, and the measured
baseline — 935 tests in 86 files in 14.43 s — is consistent with it. The Rust
suite's 303 tests complete in 2.37 s single-threaded, well above the "a suite
that finishes far faster than usual failed early" floor CLAUDE.md warns about.

---

## Refuted during verification

No whole finding in this dimension was refuted. Four *sub-claims* were withdrawn
during verification and are recorded here so they are not re-derived later:

- **`MAX_PACE` releasing the pre-flight brake after ~5 s is a defect** (a
  sub-claim of PERF-03) — refuted: `client.rs:260-266` documents the trade
  explicitly ("sending into a 429 costs a `Retry-After`; stalling costs the whole
  screen"), so it is a deliberate decision, not an oversight.
- **A throttled `process_queue` drain walks all N queued rows** (a sub-claim of
  PERF-01) — refuted: `process_queue` returns `Err` on the *first* retryable row
  (`commands/list.rs:919`). The freeze still holds via the per-row `Retry-After`
  sleep and via a healthy drain of N rows, which is how PERF-01 is now stated.
- **Manual sync refetches every retained page of every infinite query** (a
  sub-claim of PERF-09) — refuted as stated: the default `refetchType` is
  `"active"`, so only *mounted* observers refetch.
- **`set_backup_settings` is the significant instance of blocking work on the UI
  thread** (the framing of PERF-12) — refuted: the four library-correction
  commands (PERF-15) have the same defect with far worse bounds, and were the
  instance worth filing.

One finding from the frontend audit was refuted outright but is out of this
dimension's scope and is filed against the content-filter dimension instead:
`FavouritesModal`'s blur predicate (`FavouritesModal.tsx:238`) is exactly what
`shouldBlur` answers for the same inputs, pinned by
`src/lib/contentFilter.test.ts:151-154`.

---

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 3 |
| P3 | 5 |
| P4 | 12 |
| **Total** | **20** |

Refuted (whole findings, this dimension): 0. Withdrawn sub-claims: 4.

Promoted from adversarial verification: 6 (PERF-15, PERF-16, PERF-17, PERF-18,
PERF-19, PERF-20).

Downgraded on verification: 5 (PERF-04 P2→P3; PERF-07, PERF-08, PERF-09,
PERF-12 P3→P4).
