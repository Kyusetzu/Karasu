# AniList Sync and Rate Limiting Audit

## Scope

This report covers how Karasu talks to AniList: the shared rate limiter, retry and
backoff behaviour, request economy per screen, partial-failure handling on multi-root
documents, and the cost of cache invalidation.

Rust sources audited in full: `src-tauri/src/anilist/client.rs` (limiter, error taxonomy,
retry loop, `rate_snapshot`), `src-tauri/src/anilist/auth.rs`, `src-tauri/src/net.rs`,
`src-tauri/src/commands/list.rs` (`fetch_media_list`, `save_entry_core`, `process_queue`,
`bulk_save_list_entries`, `sync_status`), `src-tauri/src/playback/scrobbler.rs`,
`src-tauri/src/playback/relations.rs`, `src-tauri/src/identify.rs`,
`src-tauri/src/alerts/{site,airing,sequel,stale,notify}.rs`, `src-tauri/src/background.rs`,
`src-tauri/src/commands/{update,images,auth}.rs`.

Frontend sources audited in full: `src/app/main.tsx` (the `QueryClient` defaults),
`src/api/{anilist,queries,social,franchise,library}.ts`, `src/lib/apiError.ts`,
`src/lib/chunk.ts`, `src/hooks/{useListMutations,useListSummary,useManualSync,useSyncStatus,
useFollow,useSocialActions,usePrimedLists,useNotifBadge}.ts`, `src/stores/auth.ts`, and
every page under `src/pages/` plus `src/components/shell/{Bell,SyncPanel,Sidebar}.tsx`,
`src/components/media/{SeasonHero,RecommendedSection,MediaCard,NowPlayingCard}.tsx` and
`src/components/social/{ActivityFeed,ActivityCard,UserList}.tsx`.

Nothing was executed. **The app was never pointed at the live AniList API during this
audit**, no network request was made, and no file outside this report was modified.
Deliberate documented decisions recorded in `CLAUDE.md` — button-driven paging, the log
exception, the social-surface exception, `+`-spelled build metadata, the
`version_comparator`, season-inertness, gzip-without-brotli, the bio-image Rust proxy,
`usesCleartextTraffic` — are not reported as defects.

## See also

- **A3-01** (an identity change never clears the TanStack query cache, so account A's
  `mediaListEntry` — progress, score, private `notes` — is rendered under account B and one
  Save writes it to B's list; P1 after verification) belongs primarily to
  `/home/user/Karasu/audit/ACCOUNT_ISOLATION.md` and is filed in full there. It is listed
  here only as a cross-reference because its mechanism is the query cache rather than the
  sync layer.

## Request chains per screen (static analysis)

**These counts were derived by reading the code, not by running the app.** Each row is the
set of AniList HTTP requests the code *will* issue for a cold mount (empty TanStack cache)
in AniList mode on desktop, derived from each page's `useQuery` / `useInfiniteQuery`
`enabled` predicates and from each `queryFn`'s own internal loop bounds. A warm cache
(`staleTime`) suppresses most of them; the counts are the cold-start worst case.

Shell-level queries are counted once, not per page: `Bell` lives in
`components/shell/Titlebar.tsx:52`, **outside** `<main key={pathname}>`
(`src/app/App.tsx:190`), so it mounts once per session and is not remounted by navigation.
Its `["social","notifCount"]` query (`src/components/shell/Bell.tsx:262-268`) costs 1
request at boot and 1 per 10 minutes thereafter.

| Screen | Requests fired on a cold mount | Concurrent at mount | Total for the settled screen |
|---|---|---|---|
| **Dashboard** (`pages/Dashboard.tsx`) | `fetchMediaList(ANIME)` L58-61; `fetchMediaList(MANGA)` L68-70; `seasonHero` (`components/media/SeasonHero.tsx:43-47`, `enabled: isTauri && filterReady` — `ready` starts `false`, `stores/contentFilter.ts:44`, so it lands a beat later); then `favouriteBirthdays` L374-379 (1–8 requests, `FAVOURITES_MAX_PAGES = 8`, `api/social.ts:1600`); `recommendationsFor` ×2 (`components/media/RecommendedSection.tsx:79-83`, ANIME + MANGA) | **3** | **6–13** |
| **MediaList** (`pages/MediaList.tsx:292-295`) | `fetchMediaList(type)` | **1** | 1 |
| **Search**, one term typed (`pages/Search.tsx`) | `genreTagCollections` L149-155 (`staleTime: Infinity`); `browseMedia` L209-231 after a 500 ms debounce (L133) | **1** | 2 (+1 per further debounce boundary) |
| **Seasonal** (`pages/Seasonal.tsx:59-64`) | `seasonalAnime` | **1** | 1 |
| **Calendar**, default `lens=mine` (`pages/Calendar.tsx:97-101`) | `fetchMediaList(ANIME)` | **1** | 1 |
| **Calendar**, `?lens=all` (L121-126) | `fetchMediaList(ANIME)` + `airingWeek` → **up to 5 sequential pages** (`api/queries.ts:349,357-362`) | **2** | **up to 6** |
| **Statistics** (`pages/Statistics.tsx`) | `userStatistics` L165-174; `fetchMediaList(ANIME)` L183-186; `fetchMediaList(type)` L206-210 — a third request whenever `type === "MANGA"` | **2 (ANIME) / 3 (MANGA)** | 2–3 |
| **AnimeDetail** (`pages/AnimeDetail.tsx:110-114`) | `animeDetail` only. Episodes L617, cast L699, reviews L838 and trends L1054 are all `enabled: … && open` | **1** | 1 |
| **UserProfile** (`pages/UserProfile.tsx`) | `userProfile` L55-63, then `followCounts` L182-187 (needs the id, so strictly sequential) | 1 then 1 | **2** |
| **Thread** (`pages/Thread.tsx`) | `fetchThread` L184-190 + `threadComments` page 1 L192-207, in parallel. On a `?comment=` landing the paged query is gated off and `threadCommentTree` L228-256 replaces it | **2** | 2 |
| **Social feed** (`pages/Social.tsx` → `components/social/ActivityFeed.tsx:41-47`) | `activities` page 1 | **1** | 1 |
| **Wrapped** (`pages/Wrapped.tsx:654-665`) | `wrappedEntries(ANIME)` + `wrappedEntries(MANGA)` in one `Promise.all` | **2** | 2 |
| **LocalLibrary** (`pages/LocalLibrary.tsx`) | `fetchMediaList(ANIME)` L121-124; `mediaByIds(offList)` L175-181; `mediaByIds(suggestedIds)` L269-274. `getLibraryStatus` L128-132 and `getLibraryUnmatched` L248-252 are SQLite-only. Each `mediaByIds` is `ceil(n/50)` **sequential** requests (`api/queries.ts:463-470`) | **3** | **1 + ⌈offList/50⌉ + ⌈suggested/50⌉** — unbounded in the size of the local library |
| **Activity** (`pages/Activity.tsx:29-34`) | `singleActivity`, then `activityReplies` because `openReplies` is passed (L58, `components/social/ActivityCard.tsx:166-171`) | 1 then 1 | 2 |
| **Franchise** (`pages/Franchise.tsx:74`) | `loadFranchise` — `for depth in 0..=MAX_DEPTH(3)`, one request per depth, frontier sliced to 50 (`api/franchise.ts:147-155`) | 1 | **≤ 4** (worst case, proven bounded) |

### Comparison with the documented "Two queries per mount, at most"

| Screen | Documented cap | Real count | Evidence |
|---|---|---|---|
| Dashboard | 2 | **3 concurrent, 6–13 total** | `Dashboard.tsx:58,68` + `SeasonHero.tsx:43` + `Dashboard.tsx:374` + two `RecommendedSection`s |
| Statistics (`?type=MANGA`) | 2 | **3 concurrent** | `Statistics.tsx:165,183,206` |
| Calendar `?lens=all` | 2 | **up to 6** | `Calendar.tsx:97,121` + `queries.ts:349` |
| LocalLibrary | 2 | **unbounded in library size** | `LocalLibrary.tsx:121,175,269` + `queries.ts:463` |

`AnimeDetail`, `MediaList`, `Seasonal`, `Search`, `Social`, `Thread`, `Wrapped`,
`UserProfile`, `Franchise`, `Activity` and `Calendar (mine)` all honour the cap. The
overruns are filed as **A3-09**; verification established that only one of the in-file
comments claiming compliance is actually false today (`Dashboard.tsx:374-379`), and that
the limiter itself is safe against the burst because `claim()` exists.

### Background budget

| Pass | First run | Interval | Requests per fire |
|---|---|---|---|
| `alerts/airing.rs` | +30 s (L13) | 20 min (L11) | 1 (`AIRING_QUERY`, `perPage: 50`) |
| `alerts/stale.rs` | +90 s (L13) | 6 h (L11) | **0** — reads the cached list only |
| `alerts/sequel.rs` | +120 s (L15) | 12 h (L14) | up to `MAX_BATCHES(6) × 2 media types = 12`, sequential (L172-176) |
| `alerts/site.rs` | +45 s (L37) | 60 s tick, acts on a 15–720 min stamp (L36, L117-127) | 1 |
| `playback/scrobbler.rs` | 5 s poll | per episode threshold | 1 save + queue drain |
| `identify.rs` | per library scan | — | ≤ `MAX_BATCHES(8)` (L31) |

**Worst-case startup burst** (AniList mode, Dashboard restored, all opt-in alerts on):
3 concurrent at t≈0, 6–13 in the first few seconds (the Dashboard chain), 1 at t=30 s
(airing), 1 at t=45 s (site), 12 in ~10 s at t=120 s (sequel). Peak minute ≈ **13–14** of a
~28-usable budget — comfortable *alone*. The tail is what A3-03 turns into a cascade.

**Steady state** ≈ 3/h (airing) + ≤4/h (site) + ~1/h average (sequel) + scrobbles
≈ **0.15 requests per minute**. That part is healthy.

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
|---|---|---|---|---|
| A3-02 | P2 | BUG / ARCHITECTURAL PROBLEM | `src-tauri/src/anilist/client.rs:498-517` | The `Retry-After` deadline the limiter records is never consulted by the code that decides whether to send, and the window heal repairs the budget straight through it. |
| A3-04 | P2 | BUG | `src-tauri/src/playback/scrobbler.rs:1008-1073` | The AniList write is awaited inline in the 5-second detection loop, so a slow write or a queue drain freezes detection and can silently miss an episode. |
| A3-14 | P2 | BUG | `src-tauri/src/commands/list.rs:291-307` | The cached-list fallback matches only `ApiError::Network`, so a 429 or a rejected token shows the error page on every list screen even with a complete local list cached. |
| A3-03 | P2 | PERFORMANCE PROBLEM | `src/app/main.tsx:31-32` | A frontend retry stacks on the Rust retry with no cancellation, so one logical read can cost 4 HTTP requests and ~6 minutes of skeleton. |
| A3-15 | P3 | BUG | `src-tauri/src/playback/scrobbler.rs:755` | `perform_update` discards `MutationResult.queued`, so a merely-queued scrobble sets `Phase::Updated`, patches the local progress cache and emits `scrobble-done`. |
| A3-05 | P3 | PERFORMANCE PROBLEM | `src-tauri/src/alerts/site.rs:124-146` | The site-notification pass stamps only on success, so a sustained failure degrades its 15–720 minute interval to one request per 60-second tick. |
| A3-08 | P3 | BUG | `src/hooks/useListMutations.ts:143-166` | A save that was only queued shows the ordinary success receipt and leaves the sidebar's queue depth unmoved. |
| A3-11 | P3 | BUG | `src/pages/Statistics.tsx:183,206` | Both list queries destructure `data` only, so a failed fetch renders empty charts as settled fact. |
| A3-07 | P3 | BUG | `src-tauri/src/playback/relations.rs:159-165` | The relations loader is the one outbound HTTP client in the tree with no timeout at any level. |
| A3-16 | P4 | PERFORMANCE PROBLEM | `src/hooks/useManualSync.ts:59-62` | The manual sync ends with a predicate invalidation that refetches every active non-list query, so a documented "three requests per click" is six or more on a settled Dashboard. |
| A3-09 | P4 | ARCHITECTURAL PROBLEM / DOCUMENTATION ISSUE | `src/pages/Dashboard.tsx:374-379` | Four screens exceed the documented two-queries-per-mount cap and the Dashboard's own comment asserting compliance is false. |
| A3-10 | P4 | PERFORMANCE PROBLEM | `src/components/shell/Bell.tsx:321-328` | Opening the bell spends a count refetch whose answer the feed's page-1 reset discards on the success path. |
| A3-06 | P4 | BUG | `src-tauri/src/anilist/client.rs:459-473` | `rate_snapshot` reports `remaining` without the window heal, so the panel can show a budget the limiter no longer believes. |
| A3-12 | P4 | IMPROVEMENT | `src/hooks/useFollow.ts:59` | `cancelQueries(["social"])` discards in-flight reads far beyond the three scopes the optimistic patch touches. |
| A3-13 | P4 | IMPROVEMENT | `src/app/main.tsx:31-32` | `ApiError::Api` flattens to the same bare string as `Retryable`, so a permanently-refused payload is retried once. |
| A3-17 | P4 | IMPROVEMENT | `src/stores/auth.ts:128-134` | The `anilist-auth` listener's unlisten handle is dropped, so a StrictMode double-invoke of `init()` registers it twice. |

---

## Findings

---

ID: A3-02

Severity: P2

Category: BUG / ARCHITECTURAL PROBLEM

File: /home/user/Karasu/src-tauri/src/anilist/client.rs

Line: 498-517 (pre-flight loop), 312-320 (`park`), 322-327 (`throttled_for`), 343-349 (`headroom`), 578-600 (the 429 branch)

Function: `AniList::query`, `RateState::park`, `RateState::headroom`

Problem:
`RateState::sleeping_until` — the field whose doc comment at L280 calls it "the monotonic
deadline this client is deliberately not sending until", and whose forward-only,
never-cleared discipline the same comment calls "load-bearing" — is **never read by
anything that decides whether to send a request**. `grep -n "throttled_for|sleeping_until"
src-tauri/src/anilist/client.rs` shows it written by `park` (L312-320) and read by
`rate_snapshot` (L471-472) and by tests (L709-737, L818-822), and by nothing else. The
pre-flight loop at L498-517 branches on `rate.headroom(now) > RESERVE` alone.

Consequently a `park(Duration::from_secs(wait), "retryAfter")` after a real 429 (L594-597)
throttles nobody: it is a display value. The 429 branch does `sleep` in that caller
(L588-598), so the retrying task honours `Retry-After`; every *other* task on the shared
client does not.

Expected Behavior:
Once AniList has answered 429 with a `Retry-After`, no request from this client goes out
until that deadline passes. One client is shared by the scrobbler, three alert passes,
`identify.rs` and every frontend passthrough, so the deadline has to be global — which is
exactly what the field's own documentation claims it is.

Actual Behavior:
Two concrete paths let requests through a live server-mandated backoff.

1. **`remaining` may not be lowered at all.** The `RateSnapshot` doc at L370-376 states, as
   a known fact, that "If AniList omits `x-ratelimit-remaining` on a 429, `remaining` keeps
   its stale pre-429 value". In that case `headroom(now) > RESERVE` is still true, so every
   concurrent and subsequent caller sends immediately into the throttle, each earning its
   own 429 and its own `sleep(wait)` of up to 120 s.

2. **`headroom` heals through the backoff.** `headroom` (L343-349) resets `remaining` to
   `limit.unwrap_or(SEED)` once `now - counted_at() >= WINDOW` (60 s). A 429 stamps
   `observed = now` (L565-568), so 60 s later the count is repaired to 30 and full-rate
   sending resumes — while a `Retry-After` of up to 120 s (`.min(120)`, L590) is still in
   force.

Reproduction:
Static trace of path 2, the deterministic one:
- t=0 s: a request receives HTTP 429 with `retry-after: 120` and `x-ratelimit-remaining: 0`.
  L563-577 sets `remaining = 0`, `observed = Some(t0)`, `reset_at = None`. L594-597 sets
  `sleeping_until = t0 + 120 s`.
- t=1..60 s: other callers enter L498. `headroom` returns 0, so they park in `SLICE`s and,
  at t≈5 s each, hit the `MAX_PACE` escape at L511-514 and send anyway. (That escape is a
  documented trade, not part of the defect — see the Verification line.)
- t=60 s+ε: `counted_at()` is `observed = t0`; `now - t0 >= WINDOW`, so `headroom` sets
  `remaining = 30`. Every caller now clears the guard on its first iteration and sends at
  full rate, **60 seconds before the server said to resume**.

Impact:
The client's own backoff is advisory. During a rate-limit episode Karasu keeps sending into
a server that has already refused, converting one 429 into a run of them; each one costs a
wasted request out of a budget shared with the scrobbler and the alert passes, and each one
blocks its caller for up to `Retry-After` seconds. This is the amplifier that makes A3-03,
A3-04 and A3-14 as bad as they are. It also means the sync panel's "throttled for 1m 58s"
line describes a state the limiter is not actually in. No data is corrupted — mutations are
absolute-valued and idempotent — so the cost is wasted budget and stalled screens.

Root Cause:
`park` / `throttled_for` were built as a *reporting* mechanism and the pre-flight decision
was never rewired to consult them. `headroom`'s window heal — correct as a fix for the
sticky-nap bug, pinned by `a_count_from_a_rolled_window_stops_counting` (L757-771) — has no
exception for a deadline the server itself set, because there is no code path where the two
meet.

Recommended Fix:
Make the pre-flight loop consult the deadline, and make the deadline outrank the heal:

```rust
let nap = {
    let mut rate = self.rate.lock().await;
    let now = Instant::now();
    match rate.throttled_for(now) {
        // A server-set deadline is not self-pacing and must not be cut short by MAX_PACE.
        Some(d) if rate.sleeping_kind == Some("retryAfter") => Some((d.min(SLICE), true)),
        _ if rate.headroom(now) > RESERVE => { rate.claim(); None }
        _ => { rate.park(SLICE, "preflight"); Some((SLICE, false)) }
    }
};
```

and let the `MAX_PACE` escape hatch fire only for the `"preflight"` kind, preserving the
documented trade for self-imposed pacing while not overriding the server. Also gate the heal
in `headroom` on `self.throttled_for(now).is_none()`, so a rolled window cannot repair a
count while the server is still refusing.

Regression Tests Required:
- `a_retry_after_park_blocks_the_preflight_check`: park `"retryAfter"` for 120 s with
  `remaining = 30` and assert the pre-flight decision is "wait", not "claim".
- `max_pace_does_not_break_a_server_deadline`: assert the 5 s escape fires for `"preflight"`
  and not for `"retryAfter"`.
- `the_window_heal_does_not_outrun_a_retry_after`: `remaining = 0`, `observed = t0`,
  `sleeping_until = t0 + 120 s`; assert `headroom(t0 + 61 s)` is still 0.

Confidence: HIGH. Verification correction: the `MAX_PACE` escape (L511-514) is a
*deliberate and documented* trade — L260-266 states in terms that "sending into a 429 costs
a `Retry-After`; stalling costs the whole screen … the self-imposed wait is bounded and the
server's own instruction is not" — so it is recorded above as a consequence rather than as a
sub-claim of the defect. The finding stands on the core claim (the deadline is invisible to
the send decision) and on the window heal.

---

ID: A3-04

Severity: P2

Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs

Line: 1008-1073 (the poll loop), 1072 (`drive_session(&app).await`), 1224 (`perform_update(...).await`), 755 (`save_entry_core(...).await`)

Function: `scrobbler::spawn` / `drive_session` / `perform_update`

Problem:
The 5-second detection poll and the AniList write live in the same sequential loop body, so
a slow or throttled write — or a queue drain — freezes detection for as long as it takes.

```
loop {                                                      // scrobbler.rs:1008
    let playback = detection::detect_playback(...).await;   // L1017
    ...
    drive_session(&app).await;                              // L1072
    tokio::time::sleep(POLL_INTERVAL).await;                // L1073, 5 s
}
```

`drive_session` awaits `perform_update` (L1224), which awaits `save_entry_core` (L755),
which awaits `process_queue` first whenever the queue is non-empty
(`commands/list.rs:345-355`) and then `api.query` for the save itself. Nothing dispatches.

Expected Behavior:
Detection keeps running at 5-second resolution while a scrobble write is in flight; a slow
write delays the write, not the detector.

Actual Behavior:
One scrobble write can hold the loop for, in the worst case:

- pre-flight pacing ≤ 5.2 s (`client.rs:511`)
- attempt 1: ≤ 30 s (reqwest timeout, `client.rs:388`) → 429 → `sleep(Retry-After)` ≤ 120 s
- attempt 2: ≤ 30 s

≈ **185 s for a single save**. Independently of any 429, a healthy drain of N queued rows
runs N `api.query` calls **sequentially**, each paced by the limiter (`list.rs:901-925`), so
coming back online with a large queue and then crossing a scrobble threshold freezes the
detector for the length of the drain.

Reproduction:
Static trace.
1. Accumulate queued edits offline (each retryable save is queued rather than raised —
   `list.rs:357-364`).
2. Come back online while an episode is playing and the scrobble threshold fires.
3. `drive_session` → `perform_update` → `save_entry_core` → `process_queue` walks the queue,
   then sends the scrobble. During all of it `detect_playback` is not called.

Impact:
- The now-playing card and the tray title freeze; `debug_changed` records nothing, so
  `karasu.log` — the app's only diagnostic for detection — has a silent hole exactly where a
  user would look.
- A short episode or a media session that starts *and stops* inside the freeze is never
  observed at all, so it is never scrobbled. That is a missed write, not a delayed one.
- The freeze coincides with a rate-limit episode or a large backlog, i.e. with the moment
  the scrobbler is most likely to be needed.

Root Cause:
`perform_update` is awaited inline rather than dispatched. Every other long-running concern
in the tree (`alerts::*`, `relations::spawn_loader`, the backup pass) has its own task; the
scrobble write shares the detector's.

Recommended Fix:
Dispatch the write. Replace the inline `perform_update(...).await` at L1224 with a
`tauri::async_runtime::spawn` guarded by an `AtomicBool` — or by the `Phase::Updating` state
already set at L971, which is exactly the "a write is in flight" flag — so at most one write
runs at a time and a second tick does not enqueue a duplicate. The result handling at
L1225-1234 already re-checks `applies_to(session, mid, ep)` before touching the session, so
it is safe to run late.

Regression Tests Required:
- A test that `drive_session` returns within one poll interval when the write path is a
  future that has not resolved (a fake `perform_update` seam).
- A test that a second tick while `Phase::Updating` does not start a second write for the
  same `(media_id, episode)` — `applies_to` already exists to express this.

Confidence: HIGH. Verification correction to the report's arithmetic: `process_queue`
returns `Err` on the **first** retryable row (`list.rs:919`), so a *throttled* drain does not
walk all N rows — but each row's `api.query` can still sleep out a `Retry-After` inside the
loop, and a *healthy* drain of N rows does run all N sequentially. The freeze is therefore
reachable with no 429 involved at all.

---

ID: A3-14

Severity: P2

Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/list.rs

Line: 291-306 (the `Err(ApiError::Network(_))` fallback arm), 307 (`Err(e) => Err(e.into())`)

Function: `fetch_media_list`

Problem:
The cached-list fallback matches exactly one error variant:

```rust
Err(ApiError::Network(_)) => {
    let cached = db.cached_list(user_id, media_type)
        .ok_or("Offline and no local list cache available yet")?;
    ...
    Ok(ListResult { from_cache: true, pending: db.queue_len(user_id), lists: ... })
}
Err(e) => Err(e.into()),
```

A 429 or a 5xx is `ApiError::Retryable` and a rejected token is `ApiError::Auth`
(`client.rs:163-175`), so neither reaches the fallback. Both return a hard error to the
frontend **even when SQLite holds a complete, freshly written copy of the list**.

Expected Behavior:
The list cache exists so the app can still show the user's list when AniList cannot answer.
"AniList is throttling us" is at least as good a reason to serve the cache as "the socket
did not open", and the `from_cache: true` flag plus MediaList's amber banner already exist to
disclose that the data is not live.

Actual Behavior:
During a throttle every list-backed screen — MediaList, the Dashboard, Calendar, Statistics,
LocalLibrary, Wrapped — takes the error path instead of the cached list. Combined with the
stacked retry (A3-03) each of those errors costs up to four HTTP requests before it is even
shown, out of the budget that is already exhausted. It is also the reason A3-11's empty
charts are reachable in the first place: a 429 on `/stats?type=MANGA` surfaces as a
rejection rather than as a cached list, and Statistics has no error branch for it.

Reproduction:
Static trace. Spend the budget (a whole-list bulk edit is 10 requests,
`list.rs:415-511`; the sequel pass adds up to 12). Navigate to `/list/anime`. `api.query`
returns `ApiError::Retryable`; the `match` at L291 does not take the fallback arm; L307
converts it to a `String` and `MediaList` renders its error state, with the complete cached
list sitting untouched in `karasu.db`.

Impact:
The primary screens of the app go dark during exactly the episode the cache was built for.
No data is lost — the cache is intact and the offline queue is unaffected — but the app
presents itself as broken while holding a good answer. It also amplifies A3-03 (every dark
screen re-runs the whole retry ladder) and is a precondition for A3-11.

Root Cause:
The fallback was written for the offline case specifically and keyed on the variant that
names it (`Network`), rather than on the question the call site is actually asking: "did we
fail to get a fresh answer?".

Recommended Fix:
Extend the fallback arm to `ApiError::Retryable(_)` as well as `Network(_)`, keeping
`from_cache: true` so the amber banner still fires. Leave `ApiError::Auth(_)` raising —
its `String` conversion is the stable `TOKEN_REJECTED` code (`client.rs:120`) that
`api/anilist.ts:79` turns into the SessionExpired banner, and swallowing it into a silent
cached read would hide an expiry the user must act on. If a cached list under a dead token
is wanted too, it needs a distinct reason on `ListResult` so the banner can still be raised.

Regression Tests Required:
- A Rust test that `fetch_media_list` returns `ListResult { from_cache: true, .. }` when the
  API layer yields `ApiError::Retryable` and a cached list exists.
- A test that `ApiError::Auth` still propagates (so the session banner keeps firing) and that
  `Retryable` with *no* cache still yields an error rather than an empty list — an empty
  `lists` array would read as "you have no entries".

Confidence: HIGH. Source: found during adversarial verification.

---

ID: A3-03

Severity: P2

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src/app/main.tsx

Line: 31-32 (the frontend retry predicate); with /home/user/Karasu/src-tauri/src/anilist/client.rs:524 (the Rust retry), 388 (the 30 s timeout), 588-598 (`Retry-After`, clamped to 120 s)

Function: `QueryClient` default `retry` predicate × `AniList::query`

Problem:
Two independent retry layers stack multiplicatively on a read, with no cancellation between
them and no ceiling on the total wall time an `invoke` may occupy.

- Rust: `for attempt in 0..2` (L524). A 429 sleeps `Retry-After` (clamped to 120 s, L590)
  and retries once; a second 429 skips the retry branch on the `attempt == 0` guard and
  falls through to `classify(429, …) = Retryable`.
- Frontend: `retry: (count, error) => count < 1 && !isTokenRejected(error) && !isNotFound(error)`
  (`main.tsx:31-32`). A surviving 429 arrives as the bare `ApiError::Retryable` message
  (`client.rs:113-122` flattens it to a plain `String`), which is neither excluded class, so
  the query runs the whole Rust pipeline a second time.

Expected Behavior:
One logical read costs a bounded number of HTTP requests and returns — or reports failure —
in a time a user will wait for.

Actual Behavior:
Worst case for **one** `useQuery`:

```
attempt 1: preflight ≤5.2 s + request ≤30 s (client.rs:388)
           + 429 → sleep ≤120 s + request ≤30 s        →  ~185 s, 2 HTTP requests
TanStack backoff ~1 s (the default retryDelay, not overridden)
attempt 2: the same again                              →  ~185 s, 2 HTTP requests
                                                total ≈ 371 s, 4 HTTP requests
```

Realistically (not worst case) a throttle still costs roughly 2 × 60–120 s per query. The
Dashboard fires three of these concurrently (see the request-chain table), so a cold
Dashboard during a throttle spends up to **12 HTTP requests** and shows `DashboardSkeleton`
(`Dashboard.tsx:123`) for minutes with no cancel and no timeout message. Because of A3-02,
all of them are sent into a server that has already said stop; because of A3-14, none of
them falls back to the cached list.

There is no way to abort them. `invoke` has signature
`invoke<T>(cmd, args?, options?): Promise<T>` with `InvokeOptions = { headers }`
(`node_modules/@tauri-apps/api/core.d.ts:109-127`) — no `AbortSignal` — and `gql` /
`fetchMediaList` (`api/anilist.ts:83-85,130-134`) do not thread the signal TanStack supplies.
So navigating away does not stop the request (the answer is still written to the cache, so a
return visit is free), and `qc.cancelQueries` in `useListMutations.ts:173`, `useFollow.ts:59`
and `useSocialActions.ts:109` can only discard responses the budget has already paid for.

Reproduction:
Static trace. Reach the limit (a whole-list bulk edit is 10 requests,
`commands/list.rs:415-511`; the sequel pass adds 12, `alerts/sequel.rs:172-176`; a
LocalLibrary mount adds ⌈n/50⌉), then open the Dashboard. Each of its three queries follows
the ladder above.

Impact:
A rate-limit episode is self-sustaining: the retries spend the budget that would otherwise
let it recover. The user sees a skeleton for minutes with no explanation and no way to stop
it, on a screen whose loading gate exists precisely to avoid stating falsehoods.

Root Cause:
The two layers were designed independently. The frontend predicate excludes the two error
classes where retrying "cannot possibly help", but a 429 is the class where retrying helps
*least urgently* and costs *most*, and it is not excluded. Nothing bounds the total time an
`invoke` may hold.

Recommended Fix:
1. Exclude a surviving rate-limit from the frontend retry. `client.rs` already carries a
   stable code for auth (`TOKEN_REJECTED`); add one for "rate limited, already retried" and
   let `main.tsx:31` refuse it, so the Rust layer owns 429 backoff end to end.
2. Bound the Rust side: cap the `Retry-After` sleep at something a UI can wait through
   (e.g. 30 s) and return `Retryable` beyond that, letting the caller decide. The full
   `Retry-After` value is still what `park` records, so the limiter keeps the whole deadline
   (once A3-02 makes it real) while no single `invoke` is held for two minutes.
3. Honour the `AbortSignal` TanStack already supplies, at least so the frontend stops
   waiting on a request whose screen is gone.

Regression Tests Required:
- A unit test on the `retry` predicate asserting `false` for the rate-limit code and `true`
  for a generic network error.
- A Rust test asserting the `Retry-After` sleep is clamped to the new ceiling and that
  exceeding it yields `ApiError::Retryable`.

Confidence: HIGH

---

ID: A3-15

Severity: P3

Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs

Line: 755 (`save_entry_core(...).await?`), 757-761 (the cache patch), 776-781 (`scrobble-done`), 1226-1231 (`Phase::Updated`)

Function: `perform_update` / `drive_session`

Problem:
`save_entry_core` returns `Ok(MutationResult { queued: true, entry: None })` for any
retryable failure — a 429, a 5xx, an expired token, offline, or a concurrent drain that
skipped (`commands/list.rs:345-364`). `perform_update` discards that struct entirely:

```rust
crate::commands::save_entry_core(app, &db, &api, &token, input).await?;   // L755
```

The `?` only propagates an `Err`. A `queued: true` is indistinguishable from a landed write,
so everything downstream of L755 runs as though AniList had accepted it.

Expected Behavior:
A scrobble that was deferred to the offline queue is reported as deferred: the session phase
says so, the local progress cache is not moved ahead of what the server actually holds, and
`scrobble-done` is not emitted as though a write had landed.

Actual Behavior:
After a queued scrobble:
- `db.update_cached_progress(...)` (L759) writes the new progress and status into the local
  list cache.
- `crate::widgets::refresh(app)` (L761) republishes the projection file, so the home-screen
  widgets show progress the account does not have.
- The `now-playing` payload is patched and re-emitted (L763-773) and
  `crate::discord::sync_current(app)` updates the presence.
- `scrobble-done` is emitted (L776-781), which `NowPlayingCard.tsx:108-113` turns into a
  `["mediaList", …]` invalidation.
- Back in `drive_session`, `result` is `Ok(())`, so the session becomes `Phase::Updated`
  (L1230) and the card renders the "updated" state (L225).

The patched cache is the part that outlives the frame. `perform_update` reads it back on the
next episode through `candidates_from_cache` and refuses a write that would regress
(`would_regress`, L712-714). So if the queued row is later *dropped* — `process_queue` drops
rows whose failure classifies as permanent (`list.rs:920-928`) — the cache says episode N
while AniList still says N-1, and the scrobbler will refuse to re-send N as a regression.
The bell does report the drop, but nothing reconciles the cache.

Reproduction:
Static trace.
1. Spend the budget or pull the network, and let an episode cross the scrobble threshold.
2. `perform_update` → `save_entry_core` → `api.query` returns `ApiError::Retryable` →
   `list.rs:357-364` queues the payload and returns `Ok({ queued: true })`.
3. `perform_update` returns `Ok(())`. The card shows "updated", the widgets move, the
   Discord presence moves, and the local cache holds the new progress.
4. Nothing on any surface says the write has not landed. (The sync panel's queued list is
   correct — see A3-08 — but the scrobbler's own surface is not.)

Impact:
The automatic path claims a write that has not landed, on the surface where the user has no
receipt to doubt — the same class as A3-08, one layer deeper. In the common case the queue
drains on the next list mount and the claim becomes retroactively true. The residual risk is
the dropped-row path above, where the moved cache plus `would_regress` turns a reported drop
into an episode that is never re-sent.

Root Cause:
`MutationResult.queued` was plumbed through the IPC boundary for the frontend and
`save_entry_core`'s Rust callers were never revisited; `perform_update` treats "did not
raise" as "landed".

Recommended Fix:
Bind the result: `let res = save_entry_core(...).await?;` and branch on `res.queued`. When
queued, skip `update_cached_progress` and the widget refresh (the cache must track the
server, not the queue), and return a distinct outcome so `drive_session` can set a
`Phase::Queued` rather than `Phase::Updated`. Emitting `scrobble-done` is still right — the
list key genuinely needs re-reading — but the card's wording should not claim a landed write.

Regression Tests Required:
- A Rust test with a `save_entry_core` seam returning `queued: true`, asserting
  `update_cached_progress` is not called and the phase is not `Updated`.
- A test that a landed write (`queued: false`) still patches the cache, refreshes the widgets
  and sets `Phase::Updated`, so the fix does not silence the normal path.

Confidence: HIGH. Source: found during adversarial verification.

---

ID: A3-05

Severity: P3

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src-tauri/src/alerts/site.rs

Line: 107-110 (the tick loop), 124-127 (the interval gate), 130-139 (the failure exit), 142-146 (the stamp)

Function: `alerts::site::check`

Problem:
On a sustained failure the site-notification pass degrades from its configured interval
(15–720 minutes) to **one request every 60 seconds**, because the "last check" stamp is
written only on success while the loop's own gate is the only thing throttling it.

```rust
loop { check(&app).await; tokio::time::sleep(TICK /* 60 s */).await; }   // L107-110

async fn check(app: &AppHandle) {
    ...
    if now_ms() - last < interval * 60_000 { return; }        // L125-127
    ...
    let data = match api.query(...).await {
        Ok(d) => d,
        Err(e) => { debug_changed(...); return; }             // L130-139  ← no stamp
    };
    db.kv_set(LAST_CHECK_KEY, now_ms());                      // L142-146  ← success only
}
```

Because `last` is unchanged after a failure, the gate at L125 stays open and the next tick
60 seconds later issues another request.

Expected Behavior:
A failed pass waits at least until the next configured interval, or backs off. The comment
at L142-143 intends "a failed fetch must not silence the *next interval*" — which is not the
same as "retry every tick".

Actual Behavior:
At the 15-minute floor a persistent failure (an AniList 5xx, a captive portal, an expired
token) turns 4 requests/hour into **60 requests/hour** — a 15× amplification. At the
720-minute ceiling the amplification is 720×. Every one is a request out of the ~30/min
budget shared with the scrobbler and the user-facing screens, spent with nobody asking, from
a pass whose own module header calls itself "the first thing in the app that spends the
shared ~30/min budget with nobody asking".

During a 429 the amplification is partly self-limiting: `api.query` sleeps out its own
`Retry-After` inside `check`, giving roughly one attempt per 210 s. A plain 5xx or a DNS
failure returns fast and gives the full 60 s cadence.

Reproduction:
Static trace. Set the background notification interval to 15 minutes, then make `api.query`
fail persistently (an AniList 500, or a dead token: `classify` returns `ApiError::Auth`,
`client.rs:167-171`). `LAST_CHECK_KEY` is never stamped, L125 never short-circuits, and one
`SITE_QUERY` goes out on every 60-second tick.

Impact:
Budget spent 15×–720× faster than configured, precisely when the API is already unhealthy —
the interaction that turns a transient outage into a rate-limit episode. Android's
JobScheduler half defers to the same `site_notif_last_check_ms` stamp
(`background.rs:104`), so the phone inherits the behaviour. Severity is held at P3 because
the whole pass is behind an opt-in that is **off by default**: `interval_min` returns 0
unless the user set a value (`site.rs:48-59`).

Root Cause:
One stamp is being asked to mean two things — "we last got an answer" (what the toast cursor
needs) and "we last tried" (what the throttle needs). Only the first is written.

Recommended Fix:
Stamp attempts separately from successes. Keep `site_notif_last_check_ms` as the
success/cursor stamp and add a `site_notif_last_attempt_ms` written on every exit from the
request — success or failure — with the L125 gate reading the attempt stamp. A short
exponential backoff on consecutive failures, capped at the configured interval, would be
better still and costs one more kv key.

Regression Tests Required:
- A test over the gate arithmetic (extractable as a pure fn taking
  `now, last_attempt, interval_min`) asserting a failed attempt still pushes the next fire
  out by the full interval.
- A test that a success and a failure both advance the attempt stamp, and that only a success
  advances the cursor stamp.

Confidence: HIGH

---

ID: A3-08

Severity: P3

Category: BUG

File: /home/user/Karasu/src/hooks/useListMutations.ts

Line: 143-166 (`onSuccess`), 124-164 (`patchCacheMany`); also /home/user/Karasu/src/hooks/useListSummary.ts:74

Function: `useListMutations().save`

Problem:
`save_entry_core` returns `MutationResult { queued: true, entry: None }` — an `Ok` — when
AniList refuses a write for any retryable reason (`commands/list.rs:357-364`: a 429, a 5xx,
an expired token, or offline) and also when a concurrent drain skipped (L345-354). The
frontend never reads that flag on the list-editing path, so a write that did **not** land is
reported as a success and the queue depth on screen does not move.

`grep -rn "queued" src/` finds `res.queued` read only in
`components/overlays/SignInMerge.tsx:150,171`. `useListMutations.ts` contains no occurrence
of `queued` or `pending`.

Expected Behavior:
A write that was deferred to the offline queue says so, and the sidebar's "N queued" line
reflects it immediately — that line is described in `components/shell/Sidebar.tsx:196-201`
as answering "is my data safe?" without a click.

Actual Behavior:
- `onSuccess` (L143-166) shows the ordinary receipt toast — `receiptText(input, before, title)`,
  e.g. "Attack on Titan → 5" — with an Undo action, identically for a landed write and a
  queued one.
- The optimistic patch `patchCacheMany` (L124-164) rebuilds `{ ...old, lists }` and never
  touches `old.pending`.
- `useListSummary` derives the sidebar's queue depth from
  `Math.max(anime.data?.pending ?? 0, manga.data?.pending ?? 0)` (`useListSummary.ts:74`) —
  i.e. from the last `ListResult` a *list fetch* returned. The save path issues no
  invalidation of the list key, so `pending` stays at its pre-save value until some later
  `fetch_media_list` refreshes it.

So after a 429'd save the app says "saved" and "Synced 2 minutes ago", with nothing on screen
indicating an unsent edit, until the user next mounts a list page. The offline case is partly
covered elsewhere (`from_cache: true` drives MediaList's amber banner) and a dead token
raises the SessionExpired banner (`App.tsx:181`); a **429** raises neither.

Reproduction:
Static trace. Spend the budget (a bulk edit is 10 requests). Press +1 on a card.
`save_list_entry` → `save_entry_core` → `api.query` returns `ApiError::Retryable` →
`list.rs:357-364` queues the payload and returns `Ok({ queued: true })` →
`useMutation.onSuccess` fires → success receipt, sidebar unchanged.

Impact:
No data is lost — the edit is in the queue, `is_retryable` deliberately keeps it
(`client.rs:104-111`), and it drains on the next list mount. The defect is honesty: the one
surface designed to tell the user their edits are unsent stays silent at the moment it
matters. It also makes the Undo action misleading, since undoing a queued write enqueues a
second row rather than cancelling the first. Mitigation: the sync panel's queued list is read
from SQLite via `sync_status` at 1 Hz (`SyncPanel.tsx:317-322`), so the truth is one click
away.

Root Cause:
`MutationResult.queued` is plumbed through the IPC boundary (`api/types.ts`, returned by
`saveListEntry`) but no list-editing consumer reads it, and `pending` was modelled as a
property of a fetch response rather than of the client's own state.

Recommended Fix:
In `onSuccess`, branch on `res?.queued`: show a distinct receipt — the vocabulary already
exists (`sync.queuedOne` / `sync.queuedMany`) — and bump `pending` in the same `setQueryData`
that patches the entry, so the sidebar moves in the same frame as the row.

Regression Tests Required:
- A `.dom.test.tsx` asserting a `queued: true` result yields the queued receipt, not the
  success receipt.
- A unit test on the cache patch asserting `pending` increments by one for a queued save and
  is unchanged for a landed one.

Confidence: HIGH

---

ID: A3-11

Severity: P3

Category: BUG

File: /home/user/Karasu/src/pages/Statistics.tsx

Line: 183-186, 206-210

Function: `Statistics`

Problem:
The two `fetchMediaList` queries destructure only `data`. A failure leaves them
`isLoading === false` with no data, so every panel derived from them renders its empty state
as settled fact — the exact hazard `Dashboard.tsx:180-187` documents fixing for itself ("a
query in the error state has `isLoading === false` and no data, so the sections rendered
those same empty states as settled fact").

```jsx
const { data: animeList } = useQuery({ queryKey: ["mediaList","ANIME",userId], ... });  // L183
const { data: typeList }  = useQuery({ queryKey: ["mediaList",type,userId],   ... });  // L206
```

Expected Behavior:
A failed list fetch is distinguishable from "you have no entries", the way the Dashboard,
MediaList and Wrapped screens all distinguish it.

Actual Behavior:
`typeList` failing yields `localEntries = []` (L212-220), and therefore an empty sunburst
`breakdown` (L256+), `seasons = seasonalHistory([])` and — when AniList's own
`activityHistory` is absent — an empty month heatmap. These render as charts with no data
rather than as an error with a retry. `WatchTimeEstimate` degrades correctly
(`if (total <= 0) return null`, L377) and the main `userStatistics` query has a proper error
branch (L165); the defect is confined to the local-list panels.

Reproduction:
Static trace. On `/stats?type=MANGA` with a spent budget, `userStatistics` succeeds from
cache while the manga list query 429s (separate keys, separate requests). The sunburst and
the seasonal-history bars draw empty.

Impact:
A statistics screen stating "you have completed nothing in any season" because a request
failed. Lower stakes than the Dashboard's version of the same bug (this screen is not
exported and shared, the way Wrapped is), but the same class the codebase has already decided
is wrong. The failure is more reachable than "offline with no cache": `fetch_media_list`
falls back to the SQLite cache only for `ApiError::Network` (`list.rs:291-306`, and see
A3-14), so a 429 or a rejected token surfaces as a rejection here even when a complete cached
list exists.

Root Cause:
The two queries were hoisted here for a good reason (L176-180: so a cold `/stats` waits for
the longer of two requests rather than their sum) and the hoist carried the `data`-only
destructure from their original nested site.

Recommended Fix:
Destructure `error` from both and render the same error-with-retry treatment the main query
uses, or at minimum suppress the local panels (return `null`) when either errored, matching
`WatchTimeEstimate`'s honest degradation.

Regression Tests Required:
- A `.dom.test.tsx` that resolves `userStatistics` and rejects `fetch_media_list`, and
  asserts the screen does not render the empty sunburst / empty seasonal bars.

Confidence: HIGH

---

ID: A3-07

Severity: P3

Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/relations.rs

Line: 159-163 (client build), 165 (`send()`)

Function: `relations::spawn_loader`

Problem:
This is the one outbound HTTP client in the tree built with **no timeout at any level** —
neither on the client nor on the request. `reqwest`'s default is no timeout, which the
codebase states explicitly at `src-tauri/src/commands/update.rs:151-154`: "A timeout, like
every other outbound client in this codebase. Without one this inherits `reqwest`'s default
of *none*". That assertion is false for this call site, and `net.rs:33-40` sets no default
either.

Every builder in the tree (`grep -rn "client_builder" src-tauri/src/`):

| Site | Timeout |
|---|---|
| `anilist/client.rs:386-389` | `.timeout(30 s)` ✔ |
| `commands/update.rs:155-156` | `.timeout(30 s)` ✔ |
| `commands/images.rs:100-103` | `.timeout(TIMEOUT)` ✔ |
| `background.rs:120-122` | `.timeout(30 s)` ✔ |
| `playback/detection/jellyfin.rs:430-438` | none on the client, but **per-request** `.timeout(4 s)` (L456) and `.timeout(10 s)` (L523) ✔ |
| `playback/relations.rs:159-165` | **none anywhere** ✘ |

Expected Behavior:
The startup relations fetch gives up after a bounded time.

Actual Behavior:
A connection that opens and then stalls (a captive portal, a half-open TCP connection, a
black-holing middlebox) leaves the spawned task awaiting `send()` for as long as the OS keeps
the socket — potentially the life of the process. The task and its socket leak. Because the
loader is a one-shot spawn (L116-118) with no retry, the redirect rules never refresh for
that session.

Reproduction:
Static trace: `crate::net::client_builder().build()` at L159 with no `.timeout()`, and
`client.get(SOURCE_URL).send().await` at L165 with no per-request timeout.

Impact:
Bounded but real. Step 1 of the loader (L138-141) has already loaded whatever cached
`anime-relations.txt` exists, so the *stale* rules stay in force and episode redirects keep
working from the last good copy. On a machine with no cache yet, no redirect rules load at
all for the session, so a split-season scrobble lands on the parent entry unredirected. Plus
one leaked task and socket per launch on such a network.

Root Cause:
This call site was retrofitted onto the `net::client_builder` seam (the comment at L152-158
records that migration) and picked up the seam's TLS behaviour without picking up the timeout
every other caller adds.

Recommended Fix:
`crate::net::client_builder().timeout(std::time::Duration::from_secs(30)).build()`. Better:
move a default timeout into `net::client_builder()` itself, so the seam's one-place guarantee
covers timeouts as well as TLS, and let the two Jellyfin call sites keep overriding
per-request as they already do.

Regression Tests Required:
- A grep-style guard test (a Rust `#[test]` reading the source, as `airing.rs:262-269`
  already does for `PAGE_SIZE`) asserting that every `net::client_builder()` call is followed
  by a `.timeout(` — or, once the default moves into `net.rs`, a doc test on `client_builder`
  asserting the default is set.

Confidence: HIGH

---

ID: A3-16

Severity: P4

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src/hooks/useManualSync.ts

Line: 59-62 (the closing invalidation), 26-27 (the doc comment that counts the cost)

Function: `useManualSync().sync`

Problem:
The manual sync (the sidebar button and Ctrl+R) ends with

```ts
await qc.invalidateQueries({
  predicate: (q) => q.queryKey[0] !== "mediaList",
});
```

`invalidateQueries` refetches every **active** observer it matches, and this predicate
matches everything except the two list keys. The hook's own doc four lines above says "Three
AniList requests per click, behind an explicit user action — the shared ~30/min budget is
spent with somebody asking."

Expected Behavior:
Either the click costs the three requests the comment claims (drain, two lists, viewer), or
the comment states the real bound.

Actual Behavior:
On a settled Dashboard the active non-list observers are `seasonHero`
(`SeasonHero.tsx:43-47`), two `recommendationsFor` queries
(`RecommendedSection.tsx:79-83`), `favouriteBirthdays` (`Dashboard.tsx:374-379`, itself 1–8
pages) and the shell's `["social","notifCount"]` (`Bell.tsx:262-268`, mounted for the whole
session outside `<main>`). One Ctrl+R therefore costs the two list fetches plus the viewer
refresh plus five or more further requests — and on a profile or a thread the social feeds
are invalidated too.

Reproduction:
Static trace of the predicate against the Dashboard's mounted observers, as tabulated in the
request-chain section above.

Impact:
Small and user-initiated, which is why it is P4: the budget is spent with somebody asking,
and nothing breaks. But the cost is roughly double what the hook documents, and the invariant
the codebase leans on ("paging is a button… the shared budget is not spent without a
request") is weakened when a single button quietly fans out.

Root Cause:
The predicate expresses "everything except the lists I just fetched", which was the right
*exclusion* and the wrong *scope*: it was written to avoid double-fetching the lists rather
than to name what a sync should refresh.

Recommended Fix:
Invalidate with `refetchType: "none"` (mark stale, refetch on the next mount) or name the
keys a sync genuinely needs to move, and correct the doc comment to state the real bound.
Marking stale rather than refetching keeps "Synced just now" honest — the lists are still
fetched explicitly above, which is what advances `dataUpdatedAt`.

Regression Tests Required:
- A `.dom.test.tsx` that mounts a screen with several active queries, runs `sync()` against a
  mocked `invoke`, and asserts the number of `anilist_query` calls matches the documented
  bound.

Confidence: HIGH. Source: found during adversarial verification.

---

ID: A3-09

Severity: P4

Category: ARCHITECTURAL PROBLEM / DOCUMENTATION ISSUE

File: /home/user/Karasu/src/pages/Dashboard.tsx

Line: 58-70 (two list queries), 121 (`<SeasonHero />`), 374-379 (`Birthdays`); also src/pages/Statistics.tsx:165,183,206; src/pages/Calendar.tsx:97,121; src/pages/LocalLibrary.tsx:121,175,269

Function: `DashboardContent`, `Statistics`, `Calendar`, `LocalLibrary`

Problem:
`CLAUDE.md` states the invariant "**Two queries per mount, at most.**" Four screens exceed
it, and the Dashboard carries an in-file comment asserting it does not.

- **Dashboard**: `Dashboard.tsx:374-379` says the birthdays query "waits for the two list
  queries to settle (`settled`) so the dashboard's mount burst stays at two concurrent
  requests". But `<SeasonHero />` is rendered at L121 *above* the loading gate and its own
  query (`SeasonHero.tsx:43-47`) is `enabled: isTauri && filterReady` — gated on nothing the
  Dashboard controls. `ready` starts `false` (`stores/contentFilter.ts:44`) and flips after
  one IPC round trip, so it fires alongside the two lists. Mount burst is **three**; the
  settled screen costs **6–13**.
- **Statistics**: three list-shaped queries at L165, L183 and L206 whenever
  `type === "MANGA"` — a URL the app itself writes (L155-160).
- **Calendar** `?lens=all`: `fetchMediaList` plus `airingWeek`, up to 5 sequential pages
  (`queries.ts:349,357-362`). The route is restorable (`App.tsx:238-241`), so this can be a
  cold mount.
- **LocalLibrary**: three concurrent queries, two of which each expand to `⌈n/50⌉` sequential
  requests (`queries.ts:463-470`) — unbounded in the size of the local library.

Expected Behavior:
Either the screens honour the cap, or the invariant is restated with its real bound and the
comment that claims compliance is corrected.

Actual Behavior:
The cap exists because the limiter "reads its budget then drops the lock *before* any
response header lands, so it cannot see a burst it has not sent" (`CLAUDE.md`). That specific
hazard is already handled: `claim()` (`client.rs:503, 359-361`) books each request before it
goes out, so concurrent callers do see each other and the *limiter* is safe. What remains is
the interaction with A3-02, A3-03 and A3-14: three concurrent queries × two retry layers =
up to twelve HTTP requests for one cold Dashboard during a throttle, none of which falls back
to the cache.

Reproduction:
Static analysis of the `enabled` predicates, as tabulated in the request-chain section.

Impact:
No user-visible failure by itself. The cost is documentation that is no longer true on the
app's landing screen, on the one invariant that governs burst spending: a future screen
author reading `Dashboard.tsx:374` will believe the Dashboard costs two requests.

Root Cause:
`SeasonHero` was added above the loading gate (correctly, for UX) without revisiting the
comment two hundred lines below that counts the mount burst.

Recommended Fix:
Pick one per screen:
- Dashboard: gate `SeasonHero`'s query on the same `settled` signal `Birthdays` uses, or
  update the comment at L374-379 and the `CLAUDE.md` sentence to state the real bound.
- Statistics: accept and document three for the MANGA case.
- LocalLibrary: bound the `mediaByIds` expansion per mount (resolve the first page and fetch
  the rest behind a button, matching the app's own paging-is-a-button rule).

Regression Tests Required:
- A `.dom.test.tsx` per screen that renders it against a mocked `invoke` and asserts the
  number of `anilist_query` / `fetch_media_list` calls made before any user interaction. This
  is the only kind of test that can hold the invariant.

Confidence: HIGH. Verification: downgraded from P3 — this is convention drift with no
user-visible failure; `claim()` already closes the burst hazard the cap was written for, and
only one of the three comments said to claim compliance actually does. `Statistics.tsx:202-205`
says "*on anime* this is the request already in flight above", which is accurate; only
`Dashboard.tsx:374-379` is false today.

---

ID: A3-10

Severity: P4

Category: PERFORMANCE PROBLEM

File: /home/user/Karasu/src/components/shell/Bell.tsx

Line: 321-328 (the rising-edge effect), 277-291 (the site feed query)

Function: `Bell` — the `open` rising-edge effect

Problem:
Opening the bell spends an AniList request whose answer is, on the success path, discarded.

```jsx
// rising edge of `open`
setSiteUnseen(count.data ?? 0);
void qc.invalidateQueries({ queryKey: ["social", "notifCount", viewerId] });   // L328  → request A
```
```jsx
const site = useInfiniteQuery({                                               // L277
  queryFn: async ({ pageParam }) => {
    const reset = pageParam === 1;
    const page = await siteNotifications(pageParam, reset);                   // L280  → request B
    if (reset) {
      await qc.cancelQueries({ queryKey: ["social", "notifCount", viewerId] });
      qc.setQueryData(["social", "notifCount", viewerId], 0);                 // L285
    }
    return page;
  },
  enabled: isTauri && open && anilist,                                        // L290
  staleTime: 60_000,                                                          // L291
});
```

Expected Behavior:
Opening the bell costs the one request that fetches the feed.

Actual Behavior:
On an open more than 60 s after the last one it costs two. Request B fetches page 1 with
`resetNotificationCount: true` (`api/social.ts:1462`), which zeroes the count **server-side**
and then, at L285, zeroes it **client-side** regardless of what A returned. `invoke` cannot be
cancelled, so `cancelQueries` at L283 discards a response the budget has already paid for.

Reproduction:
Static trace of the two effects above.

Impact:
One extra request per bell open, out of a ~30/min budget shared with the scrobbler and the
alert passes. Bounded by an explicit user action and small in absolute terms.

Root Cause:
The count refetch predates the feed's unconditional page-1 reset (the comment at L253-261
describes the older design).

Recommended Fix:
Move the recovery to the feed's failure path —
`if (site.isError) qc.invalidateQueries({ queryKey: ["social","notifCount", viewerId] })` —
and drop the unconditional invalidation at L328. The snapshot at L327
(`setSiteUnseen(count.data ?? 0)`) already reads whatever the 10-minute interval last
fetched, which is what the dots need.

Regression Tests Required:
- A `.dom.test.tsx` opening the bell against a mocked `invoke` and asserting exactly one
  `anilist_query` call for a successful feed fetch, and two when the feed fetch rejects.

Confidence: HIGH. Verification: downgraded from P3 — the redundancy is not total. The feed
carries `staleTime: 60_000` (L291), so a re-open inside a minute does not refetch page 1 and
the count refetch is then the only freshness the badge gets; it is also load-bearing on the
feed's failure path, which is the purpose the comment at L253-261 states. One request per
user-initiated open, with a stated purpose and a live use.

---

ID: A3-06

Severity: P4

Category: BUG

File: /home/user/Karasu/src-tauri/src/anilist/client.rs

Line: 459-473 (`rate_snapshot`), 343-349 (`headroom`)

Function: `AniList::rate_snapshot`

Problem:
`rate_snapshot` reports `remaining` straight out of the struct without applying the window
heal that `headroom` applies, so the sync panel can report a budget the limiter itself no
longer believes.

```rust
pub async fn rate_snapshot(&self) -> RateSnapshot {
    let now = Instant::now();
    let rate = self.rate.lock().await;      // L461 — a shared borrow, so `headroom` cannot be called
    RateSnapshot {
        remaining: rate.observed.map(|_| rate.remaining),   // L466
        ...
```

`headroom` takes `&mut self` (L343) and is the only thing that repairs a count belonging to a
rolled window. `rate_snapshot` takes a shared borrow and therefore never repairs.

Expected Behavior:
The panel's headroom figure agrees with the number the limiter would act on.

Actual Behavior:
After a response reports a low count and the app then goes idle past `WINDOW`, the panel
keeps rendering the stale low number for as long as the user watches it. `useSyncStatus`
polls at 1 Hz while the panel is open (`useSyncStatus.ts:26`), so the number sits there,
unmoving, until some other code path issues a request and lands a new header.

Reproduction:
Static trace.
1. A response returns `x-ratelimit-remaining: 3`. L565-568 sets `remaining = 3`,
   `observed = Some(t0)`, `reset_at = None`.
2. Idle for ten minutes (no query, so `headroom` is never called).
3. Open the sync panel. `rate_snapshot` returns `remaining: Some(3)` with
   `observed_ago_ms ≈ 600_000`. The panel draws "3 of 30".
4. The very next `query` call runs `headroom(now)`, sees `now - t0 >= WINDOW`, and sets
   `remaining = 30` — the limiter's real answer all along.

Impact:
Display only, and disclosed rather than hidden: the panel renders the measurement's age right
beside the number ("observed N s ago", `components/shell/SyncPanel.tsx:277-296`), and the
throttle line is driven by `throttledForMs`, which `RateSnapshot`'s own doc (L370-376) names
as the signal to branch on. A user reading only the first number can still be misled about
why the app feels slow.

Root Cause:
The heal is a side effect of the decision path rather than a property of the state, and the
reader deliberately takes a shared lock so it cannot trigger side effects.

Recommended Fix:
Split the arithmetic out of `headroom` into a pure `fn available(&self, now: Instant) -> u32`
(returning `limit.unwrap_or(SEED)` when `counted_at()` is `None` or older than `WINDOW`, else
`remaining`) and have both `headroom` (which then also writes `reset_at`) and `rate_snapshot`
read it. `rate_snapshot` keeps its shared lock and its `observed` gate.

Regression Tests Required:
- `the_panel_and_the_limiter_agree_after_a_window_rolls`: `remaining = 3`, `observed = t0`;
  assert `available(t0 + WINDOW + 1s) == headroom(t0 + WINDOW + 1s)`.
- Keep `healing_the_count_does_not_fake_an_observation` (L797-806) green — the `observed`
  gate must not start reporting the seed.

Confidence: MEDIUM. Verification: downgraded from P3 — calling this a defect fights the
module's own stated rule three lines above the code: `remaining` is gated on `observed`
because "without a header this is the seed, and reporting a guess as a measurement is the one
thing a headroom display must not do" (L464-466), and the heal's repaired value *is* that
seed (`limit.unwrap_or(SEED)`, L345). Display-only, disclosed by the adjacent age line, and
arguably intended.

---

ID: A3-12

Severity: P4

Category: IMPROVEMENT

File: /home/user/Karasu/src/hooks/useFollow.ts

Line: 59; also /home/user/Karasu/src/hooks/useSocialActions.ts:109

Function: `useFollow().follow.onMutate` and siblings

Problem:
`await qc.cancelQueries({ queryKey: ["social"] })` cancels every in-flight query under the
whole `social` prefix — the feed, every profile, every thread, every comment page, user
search — because one follow button was pressed. Since `invoke` has no cancellation
(`node_modules/@tauri-apps/api/core.d.ts:109-127`, `InvokeOptions = { headers }` only) and
`gql` ignores the `AbortSignal` TanStack supplies (`api/anilist.ts:83-85`), the Rust commands
run to completion and spend their budget; only the *answers* are thrown away.

Expected Behavior:
The house rule "cancel before an optimistic write" is scoped to the queries the write
actually patches.

Actual Behavior:
`patch()` (`useFollow.ts:25-53`) touches exactly `["social","user"]`,
`["social","followers"]`, `["social","following"]` and `["social","userSearch"]`. Cancelling
`["social"]` additionally discards in-flight `["social","feed"]`, `["social","activities"]`,
`["social","thread*"]`, `["social","reviews"]` and `["social","siteNotifs"]` reads.
`useListMutations.ts:173` has the same shape but is correctly scoped to the one list key.

Reproduction:
Static trace: open a profile's Followers tab and, while page 2 is loading, press Follow on
another row. The page-2 read is discarded; the Rust request still ran.

Impact:
Small. A few discarded responses out of a ~30/min budget, and a visible reload of a list that
was mid-flight. Not a correctness problem.

Root Cause:
The prefix was chosen for convenience; the patch set is narrower than the cancel set.

Recommended Fix:
Cancel only the scopes `patch` touches, and thread the `AbortSignal` through `gql` / `invoke`
for the frontend's own benefit even though the backend cannot honour it.

Regression Tests Required:
- A unit test asserting `cancelQueries` is called with each of the scoped keys and not with
  the bare `["social"]` prefix.

Confidence: HIGH

---

ID: A3-13

Severity: P4

Category: IMPROVEMENT

File: /home/user/Karasu/src/app/main.tsx

Line: 31-32

Function: `QueryClient` default `retry` predicate

Problem:
The predicate excludes a rejected token and a not-found, on the stated ground that "retrying
cannot possibly help". It does not exclude `ApiError::Api` — AniList refusing a payload on
its own terms (validation, a bad enum, a malformed variable) — which `client.rs:163-175`
classifies as permanent and which `process_queue` drops from the offline queue for exactly
that reason (`list.rs:920-928`).

Expected Behavior:
A failure the Rust layer has already classified as permanent is not retried.

Actual Behavior:
Every permanent API rejection costs two round trips instead of one. There is no
machine-readable marker for the class on the wire: `From<ApiError> for String`
(`client.rs:113-122`) passes `Api` and `Retryable` through as the same bare message, so the
frontend cannot tell them apart today.

Reproduction:
Static trace of the predicate against the `Api` variant.

Impact:
Negligible in steady state; these failures indicate a code bug and should be rare. Worth
recording because the fix is the same stable-code plumbing A3-03 recommends.

Root Cause:
The error taxonomy is rich in Rust and flattens to a string at the IPC boundary.

Recommended Fix:
Carry the class across the boundary the way `TOKEN_REJECTED` already is — a prefix or a
structured payload — and let the predicate refuse `Api` and the rate-limit class alike.

Regression Tests Required:
- A unit test on the predicate over one instance of each error class.

Confidence: MEDIUM (the mechanism is certain; the practical impact is small and the fix is
coupled to A3-03).

---

ID: A3-17

Severity: P4

Category: IMPROVEMENT

File: /home/user/Karasu/src/stores/auth.ts

Line: 128-134

Function: `useAuth.init`

Problem:
The `anilist-auth` listener is registered without keeping its unlisten handle:

```ts
listen<Viewer>("anilist-auth", (e) =>
  set({ viewer: applyViewer(e.payload), mode: applyMode("anilist"), sessionExpired: false }),
);
```

`init()` is called from a React effect (`src/app/App.tsx:84-89`), so React StrictMode's
double-invoke in development registers the listener twice and nothing can remove either.

Expected Behavior:
A listener registered from an effect is removable, and a double-invoke leaves exactly one
registration — the lesson `NowPlayingCard.tsx:108-115` already records ("the registration
promise is awaited before unlistening, so a StrictMode remount does not leak a handler").

Actual Behavior:
Two handlers run for each `anilist-auth` event in development. Both call `set()` with the
same payload, so the observable outcome is identical and no request is made. In production
`init()` runs once, so there is one registration.

Reproduction:
Static trace: `App.tsx:84-89` mounts the effect; StrictMode invokes it twice; `init()` at
`auth.ts:117` reaches L128 both times; the returned `Promise<UnlistenFn>` is discarded both
times.

Impact:
Development only and harmless today — the handler is idempotent. It is filed because the same
shape becomes a real leak the moment the handler stops being idempotent (a toast, a request,
a counter), and the codebase has already paid for that lesson once.

Root Cause:
`init()` is an async store action rather than an effect body, so the natural place to return
a cleanup does not exist at the call site.

Recommended Fix:
Have `init()` return its unlisten handle (or store it on the module and no-op on a second
registration) and have the effect in `App.tsx` await and call it on cleanup, matching
`NowPlayingCard.tsx:113-115`.

Regression Tests Required:
- A `.dom.test.tsx` rendering `App` under StrictMode against a mocked `listen`, asserting one
  surviving registration after mount and zero after unmount.

Confidence: HIGH. Source: found during adversarial verification.

---

## Verified sound

Scenarios checked that **are** correctly handled, each naming the guard that handles it.

**Rate limiter**
- *A burst of concurrent callers all reading the same pre-burst budget.* `RateState::claim`
  (`client.rs:359-361`) books each request before it goes out; pinned by
  `a_claim_is_visible_to_the_next_caller` (L775-783).
- *A count wrapping to ~4 billion under a burst.* `saturating_sub` in `claim`; pinned by
  `claiming_past_empty_stops_at_zero` (L787-794).
- *A count from a window that has since rolled pinning the limiter at 0 forever (the "sticky
  nap").* `headroom` heals it (L343-349); pinned by
  `a_count_from_a_rolled_window_stops_counting` (L757-771).
- *A caller parking forever.* Cannot happen: `headroom` heals every `WINDOW` and `MAX_PACE`
  bounds each caller to ~5.2 s (L511-514). `RESERVE > 1`, `MAX_PACE < WINDOW` and
  `SLICE < MAX_PACE` are asserted by `the_reserve_is_more_than_the_last_request` (L820-826).
- *Idle for hours, then the user acts.* `counted_at()` (L331-336) returns the newer of
  `observed` and `reset_at`; a stale reading is repaired on the first `headroom` call, so the
  first request after an idle period is not penalised. (The panel's view of this is A3-06;
  the limiter's own is correct.)
- *A short pre-flight nap shortening a long `Retry-After` in the reported wait.* The
  forward-only rule in `park` (L312-320); pinned by `a_short_park_never_shortens_a_long_one`
  (L723-738).
- *An expired deadline reading as a live throttle.* `throttled_for` filters on `*t > now`
  (L322-327); pinned by `an_expired_deadline_is_not_a_throttle` (L705-715).
- *A user moving the system clock inventing or erasing a throttle.* `tokio::time::Instant`
  (L7) is monotonic.

**Error taxonomy and the offline queue**
- *A 429 or an expired token deleting a queued edit.* `ApiError::Retryable` / `Auth` and
  `is_retryable` (`client.rs:104-111`); `process_queue` returns `Err` and leaves the queue
  standing (`list.rs:919`). Pinned by `recoverable_failures_survive`,
  `a_rejected_token_never_drops_an_edit`, `a_rejected_token_is_not_the_same_as_a_busy_server`.
- *A permanently-refused payload wedging every edit behind it.* Dropped and reported through
  `report_dropped` → the bell (`list.rs:920-928, 954-971`); pinned by
  `payload_failures_are_permanent`.
- *A tokenless Cloudflare 403 signing the user out.* The `sent_token` argument to `classify`
  (`client.rs:163-175`); pinned inside `an_expired_token_is_read_out_of_the_message`.
- *A drain that skipped being mistaken for a drain that succeeded, letting a live write be
  overwritten by an older queued one.* `Drained.skipped` and the `_ =>` arm in
  `save_entry_core` (`list.rs:345-355`).
- *Two concurrent list mounts each replaying the whole queue.* `DRAIN.try_lock()` +
  `DrainMark` (`list.rs:861-919`).
- *A drain writing one account's edits onto another's list.* `viewer_id(db)` scoping in
  `process_queue` (L908-911) and in `discard_queued_edit` (L1064-1069) — schema v16.
- *Repeated offline progress bumps replaying as N identical mutations.* `queue_key` dedupe;
  pinned by `repeated_edits_to_one_field_collapse` and its four sibling tests.

**Idempotency of retried writes**
- *The Rust 429 retry duplicating a write.* `SAVE_MUTATION` / `UPDATE_ENTRIES_MUTATION` set
  **absolute** values (`progress: N`, `status: X`, `scoreRaw: N`), so a replay converges, and
  a 429 means the resolver never ran. `progress: entry.progress + 1`
  (`Dashboard.tsx:214-217`) is computed frontend-side and sent as an absolute number.
- *A save timing out client-side after AniList applied it, then being queued and replayed.*
  The same absolute-value property; the replay is a no-op.
- *Non-idempotent mutations (`SaveTextActivity`, `SaveThreadComment`, `SaveThread`) being
  auto-retried into duplicates.* The Rust retry fires only on 429; a timeout yields
  `ApiError::Network` and is not retried (`client.rs:539-548`), and `useMutation` has no
  `retry` configured (`main.tsx:20-33` sets defaults for `queries` only, so mutations keep
  TanStack's `retry: 0`).
- *A whole-list selection firing one mutation per entry.* `bulk_save_list_entries` chunks
  (`list.rs:415-511`); pinned by `a_large_selection_becomes_few_requests`.
- *A bulk edit that died on chunk 7 rolling back the 300 entries that landed.* `BulkResult`
  carries `updated` alongside `error` and `BulkSaveError` carries it to the frontend
  (`api/anilist.ts:200-227`); `useListMutations.ts:281` invalidates instead of reverting on a
  partial.

**Bounded traversal**
- `franchise.ts:147-204` — `MAX_DEPTH = 3` gives at most 4 requests; the frontier is
  `.slice(0, 50)` with `truncated = true` when it overflows, and `MAX_NODES = 60` breaks the
  loop. Proven bound: **4**.
- `identify.rs:147-167` — `chunks(25).take(8)`, and the caller rotates rather than prefixes;
  pinned by `successive_scans_ask_about_every_unplaced_title`.
- `alerts/sequel.rs:172` — `window(start, len, MAX_BATCHES=6)` per media type, cursor-rotated
  and persisted, so a long list is a window rather than a prefix.
- `alerts/airing.rs:255` — a full page means truncation, so the checkpoint stops at the last
  schedule seen rather than jumping to `now`; pinned by
  `the_page_size_matches_the_query_that_produces_it`.
- `queries.ts:349` — `CALENDAR_MAX_PAGES = 5`; `social.ts:1600` — `FAVOURITES_MAX_PAGES = 8`.
- `lib/chunk.ts` — `PAGE_MAX = 50` matches every `Page(perPage: 50)` it feeds; `mediaByIds`
  iterates chunks **sequentially** (`queries.ts:463`) precisely so the limiter can see the
  burst it is sending.
- `resolveMalChunk` — 50 per request and the caller loops
  (`pages/settings/AdvancedPane.tsx:439-450`); the per-row `saveListEntry` after it is
  **local-mode only** (`AdvancedPane.tsx:414` returns `null` otherwise), so a 2,000-entry
  import is 40 AniList requests plus 2,000 SQLite writes, not 2,000 mutations.

**Partial failure — multi-root documents**
- A pass over every backtick GraphQL template in `src/api/*.ts` (roots counted at selection
  depth 1) found exactly **one** multi-root document: `social.ts:246` `FOLLOW_COUNTS_QUERY`,
  which aliases `followers: Page` + `following: Page`. A `Page` cannot 404, so the
  sibling-null hazard `CLAUDE.md` records does not apply.
- **No query anywhere aliases a `User` root beside anything else.** `USER_PROFILE_QUERY`
  (`social.ts:175`), `USER_STATS_QUERY` (`queries.ts:902`), `FAVOURITES_PAGE_QUERY`
  (`social.ts:1572`), `BIRTHDAYS_QUERY` (`social.ts:1667`) and `NOTIF_OPTIONS_QUERY`
  (`social.ts:1156`) are each a single `User(…)` root.
- On the Rust side only `alerts/site.rs:67` `SITE_QUERY` is multi-root (`Viewer` + `Page`).
  `Viewer` resolves against the bearer token and cannot be "not found" the way `User(id:)`
  can; an absent or dead token fails the whole request with an auth error, which `classify`
  (`client.rs:163`) already handles.
- `identify.rs:66-77` alias-batches 25 roots, but every one is `Page(perPage: 1)`, so a miss
  returns an empty array instead of nulling the batch; pinned by
  `the_query_uses_page_so_one_miss_cannot_fail_the_batch` (L203-211).
- *What the frontend renders when a root nulls.* `client.rs:601-644` returns `Err` whenever
  `body.errors` is present, discarding any partial `data`, so a nulled-sibling response
  reaches the frontend as a plain rejection rather than half a payload. Pages with an
  explicit error branch handle it (`Dashboard.tsx:124-133`, `MediaList`,
  `ActivityFeed.tsx:66-72`, `UserProfile.tsx:97-113` via `isNotFound`, `LocalLibrary`,
  `Wrapped`). The two that drop it are A3-11.
- *A profile typo costing two requests.* `UserProfile` distinguishes "does not exist" from
  "could not ask" via `isNotFound` (`lib/apiError.ts:29-34`) and sets `retry: false`.
- *A failed replies fetch reading as "no replies".* `ActivityCard.tsx:180-182` renders
  `social.repliesFailed` instead.

**Request economy**
- The sidebar's list summary is `enabled: false` (`useListSummary.ts:51`) — a pure cache
  observer, zero requests.
- The sync panel costs zero AniList requests: `sync_status` reads SQLite plus two in-process
  values (`list.rs:1025-1062`), which is why the 1 Hz poll is acceptable.
- `useNotifBadge` reuses the bell's exact key including `viewerId`, adding an observer rather
  than a request (`useNotifBadge.ts:38-44`).
- `anilist_session` never touches the network (`commands/auth.rs:200-204`), so a cold start
  spends nothing on identity.
- `usePrimedLists` backdates with `{ updatedAt: 0 }` (`usePrimedLists.ts:43`) so the primed
  SQLite read does not suppress the real fetch for a whole `staleTime`.
- `RecommendedSection` sorts `seedIds` before using them as a query key
  (`RecommendedSection.tsx:70-78`) so a save does not mint a fresh key.
- Search debounces 500 ms (`Search.tsx:133`) and gates on `term.length >= 2`; entity scopes
  gate on `USER_SEARCH_MIN`.
- Every paginated list is button-driven; `grep -rn "IntersectionObserver" src/` returns
  nothing.
- `Bell` closes by trimming retained pages while preserving `dataUpdatedAt`
  (`Bell.tsx:301-312`), avoiding the "refetch every retained page" trap.
- The `scrobble-done` listener awaits its registration promise before unlistening
  (`NowPlayingCard.tsx:108-115`), reads the media type from the store at fire time, and keeps
  its broad-key fallback.
- All six outbound HTTP clients are born in `net::client_builder` — no bare
  `reqwest::Client::builder()` or `reqwest::get` exists outside `net.rs` — so the Android TLS
  arm cannot be bypassed. (Five of six also set a timeout; the sixth is A3-07.)
- `SITE_QUERY` never sends `resetNotificationCount`, pinned by
  `the_query_never_resets_the_unread_count` (`alerts/site.rs:174-179`).
- `airing.rs` moves its checkpoint even while the feature is off (L159-165), so re-enabling it
  does not replay months of backlog.
- `stale.rs` costs **zero** AniList requests — it reads the cached list only.

## Refuted during verification

No finding in this dimension was refuted: every claimed defect was re-derived from the source
and found mechanically real. Three were **downgraded** rather than dropped, and each carries
its "Verification: downgraded from Pn" line in the finding above — A3-09 (P3 → P4, the burst
hazard the cap guards is already closed by `claim()`, and only one of the comments said to
claim compliance actually does), A3-10 (P3 → P4, the bell's count refetch is load-bearing on
the feed's failure path and inside the feed's 60 s `staleTime`) and A3-06 (P3 → P4, the
panel's stale figure is display-only and disclosed by the age line beside it). A3-01 was
downgraded P0 → P1 and is filed in `ACCOUNT_ISOLATION.md`. One sub-claim was corrected rather
than dropped: A3-02's `MAX_PACE` escape is a documented trade (`client.rs:260-266`), not an
oversight, so the finding rests on the unread deadline and the window heal.

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 (A3-01 is filed in `ACCOUNT_ISOLATION.md`) |
| P2 | 4 |
| P3 | 5 |
| P4 | 7 |
| **Total** | **16** |

Refuted during verification: 0. Downgraded: 3 (plus A3-01, filed elsewhere).
