# Scrobbling and Matching Audit

## Scope

This report covers the detection-to-AniList write pipeline end to end: release-name
parsing, candidate matching, season handling, the correction `episode_offset`, the
anime-relations redirect, the block reasons, the phase machine, and every path by which a
wrong, duplicate or missing scrobble can occur.

Files read in full or traced through: `src-tauri/src/playback/scrobbler.rs` (all 1492
lines); `src-tauri/src/playback/recognition/matcher.rs` and `.../parser.rs`;
`src-tauri/src/playback/relations.rs`; `src-tauri/src/playback/detection/mod.rs`,
`.../jellyfin.rs`, `.../mpv_ipc.rs`, `.../media_session/mod.rs`, `.../profiles.rs`;
`src-tauri/src/commands/playback.rs` (settings defaults and the override commands),
`src-tauri/src/commands/list.rs` (`save_entry_core`, `process_queue`),
`src-tauri/src/db.rs` (`update_cached_progress`, `detection_override_*`),
`src-tauri/src/lib.rs` (tray), `src-tauri/src/discord.rs` (lock order),
`src-tauri/src/sync.rs`; and on the frontend `src/components/media/NowPlayingCard.tsx`,
`src/components/overlays/MatchPicker.tsx`, `src/stores/nowPlaying.ts`,
`src/pages/settings/DetectionPane.tsx`, `src/lib/backendError.ts`, `src/i18n/en.ts`.

Findings were produced by a first audit pass and then re-checked line by line by an
adversarial verification pass; the verification pass's verdicts are applied below, and the
issues it found that the first pass missed are filed here as full findings.

Decisions CLAUDE.md records as deliberate — the season-inert-unless-in-the-title rule, the
verbose log, button paging, gzip-not-brotli, the `+` build-metadata version, the Rust
bio-image proxy — are treated as decisions, not defects.

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
| --- | --- | --- | --- | --- |
| A2-01 | P2 | BUG / DATA INTEGRITY RISK | `src/components/media/NowPlayingCard.tsx:446,458-461` | The correction dialog measures `episode_offset` against the *resolved* episode, so re-picking wipes a working offset and can destroy a relations redirect into a false `COMPLETED` |
| A2-04 | P2 | BUG | `src-tauri/src/playback/recognition/matcher.rs:115,188-193` | The season-stripped variant participates in the exact-match short circuit, so `Show S2` binds to the season-1 entry whenever that entry comes first in the list |
| A2-02 | P2 | BUG | `src-tauri/src/playback/scrobbler.rs:1143-1148` | Switching "Update progress automatically" off mid-episode does not disarm the running session; it still writes |
| A3-04 | P2 | BUG | `src-tauri/src/playback/scrobbler.rs:1072,1224,755` | The AniList write is awaited inside the 5 s detection poll, so a slow write freezes detection and can miss a short session entirely (also filed as A3-04 in SYNC_AUDIT.md) |
| A2-15 | P3 | DATA INTEGRITY RISK | `src-tauri/src/playback/scrobbler.rs:755` | A save that was only *queued* is recorded as a completed scrobble — cache patched, `scrobble-done` emitted, phase `Updated` |
| A2-03 | P3 | BUG | `src-tauri/src/playback/scrobbler.rs:1149-1158` | The five-minute gap grace is bypassed for any source that reports a playback position |
| A2-06 | P3 | BUG / DATA INTEGRITY RISK | `src-tauri/src/playback/detection/jellyfin.rs:667` | Jellyfin season 0 (Specials) collapses into "no season", so a special matches the main entry and shares its correction row |
| A2-14 | P3 | BUG | `src-tauri/src/playback/detection/jellyfin.rs:589,600-602` | A movie is detected and displayed but can never be scrobbled — no `IndexNumber`, so no session is ever created |
| A2-10 | P3 | BUG | `src-tauri/src/db.rs:756-786` | `update_cached_progress` cannot insert, so a scrobble that *creates* a list entry leaves the cache at progress 0 |
| A2-08 | P3 | BUG | `src-tauri/src/lib.rs:258-266` | The tray "Scrobble now" item has no phase guard and turns a successful scrobble into a `Blocked(Failed)` |
| A2-07 | P3 | BUG | `src-tauri/src/playback/scrobbler.rs:738-743` | `would_regress`'s own refusal is returned as an English sentence in a forceable `Failed` block |
| A2-05 | P4 | IMPROVEMENT | `src-tauri/src/playback/scrobbler.rs:611-613` | `block_reason` ignores `REPEATING`, so a rewatch left at full progress can never auto-scrobble |
| A2-16 | P4 | BUG | `src-tauri/src/playback/scrobbler.rs:242-249,1143-1148` | The gap countdown keeps running on the card after the grace setting is switched off |
| A2-09 | P4 | DATA INTEGRITY RISK | `src-tauri/src/playback/scrobbler.rs:376-379` | `shift_episode` clamps an impossible mapping to episode 1 instead of refusing |
| A2-13 | P4 | IMPROVEMENT | `src-tauri/src/playback/detection/jellyfin.rs:600-602` | `IndexNumberEnd` is not read, so a double-length file writes one episode short and gap-blocks the next |
| A2-12 | P4 | INVESTIGATION | `src-tauri/src/playback/scrobbler.rs:745-751` | Completing a rewatch never sends `repeat`; whether AniList auto-increments it is unverified |
| A2-11 | P4 | IMPROVEMENT | `src-tauri/src/playback/relations.rs:116-195` | `spawn_loader` is unsupervised and `Relations`' `RwLock` sits outside the `LockExt` panic-tolerant idiom |

---

ID: A2-01

Severity: P2

Category: BUG / DATA INTEGRITY RISK

File: `/home/user/Karasu/src/components/media/NowPlayingCard.tsx`

Line: 446 and 458-461 (with `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs:48-49,
459-463, 811-822`, `/home/user/Karasu/src/components/overlays/MatchPicker.tsx:61-65, 87-89`
and `/home/user/Karasu/src-tauri/src/db.rs:1323-1329`)

Function: `ScrobbleActions` → `MatchPicker.onPick`

Problem:
The correction dialog computes the stored `episode_offset` as
`realEpisode - np.episode`, but `np.episode` is the **resolved** episode — the source's
number *after* any existing offset and *after* the anime-relations redirect. The number the
offset must be measured against is `source_episode`, and that field is `#[serde(skip)]`
(`scrobbler.rs:48-49`), so the frontend cannot see it at all. `MatchPicker`'s own contract
documents the parameter as "The episode the source reported" (`MatchPicker.tsx:61-65`); the
call site hands it something else.

Expected Behavior:
`episode_offset` is a signed delta applied to the *source* number (`scrobbler.rs:459-463`:
`parsed.episode = Some(shift_episode(ep, o.episode_offset))`, before the redirect).
Re-editing an existing correction, or correcting a title whose episode was redirected, must
produce an offset that still maps the source number onto the episode the user typed.

Actual Behavior:
The upsert **replaces** `episode_offset` (`db.rs:1323-1329`,
`ON CONFLICT … episode_offset = excluded.episode_offset`), while the delta was measured
against the already-shifted and already-redirected number. The two disagree, so the next
resolve lands on a different episode than the user asked for. The episode field is *seeded*
with `detectedEpisode` (`MatchPicker.tsx:87-89`,
`useState(detectedEpisode != null ? String(detectedEpisode) : "")`), so the cheapest
reproduction needs no arithmetic mistake at all.

Reproduction:

*(a) Re-picking the same entry wipes a working offset — one click.*
1. A correction with `episode_offset = 12` already exists for a title;
   `source_episode = 2`, `episode = 14`, card reads 14.
2. Open the picker to check the entry, leave the pre-filled `14` alone, pick the same entry.
3. Offset stored = `14 - 14 = 0`, replacing the `12`.
4. `requeue_match` (`scrobbler.rs:811-822`) → `shift_episode(2, 0) = 2`. The correction is
   gone and every later episode of that title resolves one cour low.

*(b) Editing an existing correction — offset double-accounting.*
1. Jellyfin reports `Frieren – S2E2` of a two-cour AniList entry.
   `build_now_playing` → `source_episode = 2`, `episode = 2`.
2. Correct it once: dialog says "detected 2", user types `14`. Offset stored = `14 - 2 = 12`.
   `requeue_match` → `shift_episode(2, 12) = 14`. Card shows 14. Correct.
3. Same episode, the user realises the mapping is off by one and re-opens the picker.
   `detectedEpisode = np.episode = 14`, prefilled `14`. User types `15`.
4. Offset stored = `15 - 14 = 1`, replacing the `12`.
5. `requeue_match` → `shift_episode(2, 1) = 3`. The card shows episode **3**, and the
   correction is permanently wrong for every future episode (`S2E5` → `6` instead of `18`).

*(c) Correcting a redirected title — the redirect is destroyed.*
Take a relations rule without the `!` self-redirect flag, e.g. the fixture at
`relations.rs:208`, `1575:26-51 -> 2759:1-26`.
1. Detection parses episode 26 and matches id 1575. `build_now_playing` redirects to
   `(2759, 1)`. `source_episode = 26`, `episode = 1`, `media_id = 2759`.
2. The user opens the picker to confirm the entry, leaves the seeded `1` alone, and picks
   2759. Offset = `1 - 1 = 0`.
3. `requeue_match` → `shift_episode(26, 0) = 26`; `picked = 2759`;
   `relations::redirect(rules, 2759, 26)` finds no rule whose `src_id` is 2759 — one exists
   only when the line ends in `!` (`relations.rs:72-81`) — so the episode stays **26**.
4. Session `(2759, 26)`. `perform_update` computes `done = total == Some(26)` → `true` →
   status `COMPLETED`, progress 26 (`scrobbler.rs:745-751`). Confirming a *correct* match
   has just marked a 26-episode entry finished.

Impact:
Wrong `progress` written to AniList, and in case (c) a wrong `COMPLETED` status on top. Case
(c) is gated by `block_reason` unless the entry's progress is exactly 25 or `gapAuto` is on,
but the on-screen episode number is wrong either way and the stored correction stays wrong
for every later episode. The library picker (`LocalLibrary.tsx:585`) passes no
`detectedEpisode`, so this is the only offset call site — and the only one that can be got
wrong.

Root Cause:
`NowPlaying.episode` is documented (`scrobbler.rs:40-42`) as "the episode as *resolved*: the
source's number plus any correction's offset, then whatever the relations redirect made of
it", and `source_episode` exists precisely so a re-resolve does not shift an already-shifted
number (`scrobbler.rs:44-47`). The Rust side honours that in `requeue_match`; the frontend
does not, because `source_episode` is `#[serde(skip)]` and never reaches it.

Recommended Fix:
Serialize `source_episode` (e.g. `sourceEpisode`) on the `now-playing` payload, add it to the
TS `NowPlaying` interface, pass it as `MatchPicker`'s `detectedEpisode`, and compute
`episodeOffset = realEpisode - sourceEpisode`. That fixes all three reproductions with one
change: in (c) the offset becomes `1 - 26 = -25`, `shift_episode(26, -25) = 1`, and the
redirect then finds nothing to do — which is the right answer. Keep displaying `np.episode`
on the card; only the dialog's arithmetic needs the source number.

Regression Tests Required:
- Rust: `build_now_playing` then `requeue_match` with an offset already stored, asserting the
  second resolve starts from `source_episode` (partially covered today by the field itself,
  but not by a test that exercises a *frontend-supplied* offset).
- A pure TS helper `offsetFor(sourceEpisode, realEpisode)` with a unit test, so the
  arithmetic is testable at all — today it is an inline expression inside a JSX prop and
  untestable by construction.
- Rust: a case pinning that a correction on a redirected match reproduces the same
  `(media_id, episode)` the redirect produced when the user changes nothing.

Confidence: HIGH

---

ID: A2-04

Severity: P2

Category: BUG

File: `/home/user/Karasu/src-tauri/src/playback/recognition/matcher.rs`

Line: 115 (`out.push(stripped)`) and 188-193 (the exact-match short circuit)

Function: `variants` / `best_match_prepared`

Problem:
`variants` appends the season-**stripped** title as a needle, and `best_match_prepared`
returns immediately on the first exact string equality between *any* needle and *any*
candidate title. A season-2 detection therefore binds to the season-1 entry outright
whenever that entry appears earlier in the candidate list — and `season_informed` reports
`true` (the marker *is* in the title), so `unplaceable_season` (`scrobbler.rs:628-641`) does
not block it.

Expected Behavior:
A title that spells out its season should prefer a candidate that also carries that season.
The stripped variant is a fallback, not a first-class exact match.

Actual Behavior:
```rust
for candidate in candidates {
    for (hay, hay_grams) in &candidate.titles {
        for (needle, needle_grams) in &needles {
            if hay == needle { return Some(Match { media_id: candidate.media_id, score: 1.0 }); }
```
The loop is candidate-major, so *all* needles of candidate #1 — including the bare stripped
title — are tried before candidate #2 is looked at.

Reproduction:
1. List holds `Oshi no Ko` (season 1) and `Oshi no Ko 2nd Season`, in that order as
   `candidates_from_cache` yields them (`scrobbler.rs:276-343` walks the cached
   `MediaListCollection` groups in AniList's own order, first-seen wins at `:293`; nothing
   sorts).
2. Detection sees `Oshi no Ko S2 - 03.mkv`. `parse` → `title = "Oshi no Ko S2"`,
   `season = Some(2)`, `episode = Some(3)` (pinned by `parser.rs:264-269`).
3. `variants` (`matcher.rs:98-120`) → `["oshi no ko s2", "oshi no ko season 2",
   "oshi no ko 2nd season", "oshi no ko 2", "oshi no ko"]`.
4. Candidate 1 (`Oshi no Ko`) normalizes to `"oshi no ko"`. Needle #5 is byte-identical →
   **return media_id of the season-1 entry, score 1.0**. The season-2 candidate is never
   examined.
5. `unplaceable_season`: `without_season_marker` (`matcher.rs:69-94`) strips `" s2"` and
   returns `Some("oshi no ko")` → `season_informed == true` → no `UnknownSeason` block.
6. `block_reason` then judges episode 3 against the *season-1* entry's progress. With
   progress 2 the phase is `Watching` and the scrobbler writes progress 3 to season 1. With
   any other progress it is blocked — but the card still names the wrong entry, and with
   `gapAuto` on the gap block writes it anyway (see A2-03 for how quickly).

Impact:
Wrong entry on the card in every case; a wrong `progress` write when the season-1 entry
happens to sit at `episode - 1`, or whenever `gapAuto` is on. The wrong write additionally
needs that exact progress alignment — the common ordering (S2 in CURRENT, S1 in COMPLETED)
happens to be safe, because a completed S1 blocks with `AlreadyWatched`. What is
unconditional is the wrong entry on the card, the wrong progress line, and a documented
season guard silently standing down. Which entry wins is decided by AniList's list ordering,
so the same title behaves differently on two accounts.

Root Cause:
The stripped variant was added so a release name carrying `S2` can still reach an AniList
entry whose title has no marker. Putting it in the same needle list that feeds an
unconditional exact-match short circuit makes it able to beat a strictly better later
candidate.

Recommended Fix:
Rank needles. Either (a) run the exact-match pass over the season-bearing needles across all
candidates first and only then over the stripped needle, or (b) drop the stripped needle out
of the equality check and let it score through `dice` only, or (c) keep a per-needle tier in
the score so `stripped` can never outrank a marker-bearing hit. Do **not** stop generating
the stripped variant — that is what lets `Show Season 1` reach `Show`.

Regression Tests Required:
Add to `matcher.rs`'s fixture a season-1 candidate *before* the season-2 one
(`Kusuriya no Hitorigoto` before `Kusuriya no Hitorigoto 2nd Season`) and assert
`second_season_matches_correct_entry` (`matcher.rs:265-271`) still picks 166531 — it passes
today only because the fixture has no season-1 entry. Also assert the reverse ordering, so
the result is proven independent of list order.

Confidence: HIGH

---

ID: A2-02

Severity: P2

Category: BUG

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 1143-1148 (with 580-588 and 1107)

Function: `drive_session`

Problem:
Turning "Update progress automatically" (`scrobble_enabled`) **off** while an episode is
playing does not disarm the session that is already running. The per-tick `armed` check
consults `settings.gap_auto` but never `settings.enabled`.

Expected Behavior:
`settings.enabled` is the master switch. The gap grace deliberately re-reads its setting
every tick — "the settings are re-read every tick, so switching the grace off disarms a
waiting gap immediately" (`scrobbler.rs:1136-1141`) — and the master switch should behave at
least as responsively.

Actual Behavior:
```rust
let armed = session.update_at.is_some()
    && match &session.phase {
        Phase::Watching => true,
        Phase::Blocked(BlockReason::EpisodeGap { .. }) => settings.gap_auto,
        _ => false,
    };
```
`settings.enabled` appears only in `auto_arm` (`scrobbler.rs:580-588`), which runs once, at
session creation (`scrobbler.rs:1107`). `set_scrobble_settings` (`commands/playback.rs:53-64`)
writes kv only; it does not touch `ScrobbleSession`, and the frontend path
(`stores/nowPlaying.ts:142`, `DetectionPane.tsx:77`) adds nothing. A session armed while the
setting was on stays armed after it is switched off, and fires.

Reproduction:
1. Scrobbling on, "Ask before updating" off, threshold automatic.
2. Start episode 5 of a 24-minute show. The session arms at ~16 minutes (`threshold`,
   `scrobbler.rs:679-682`).
3. Two minutes in, go to Settings → Detection and switch "Update progress automatically" off.
4. Keep the episode playing. At the 16-minute mark `drive_session` reaches
   `Phase::Watching => true`, `due` is satisfied, and `perform_update` writes progress 5 to
   AniList.

Impact:
A write to the user's AniList list after they explicitly disabled automatic writes. The
window is up to one full threshold (default 2/3 of an episode). The only in-app workaround
is to also press the card's skip (X) button, which is not what the setting's own text
(`en.ts:1347-1349`, "Mark detected episodes as watched on AniList after the threshold")
leads anyone to expect.

Root Cause:
`enabled` is captured into `update_at` at session start rather than re-read at the due point,
unlike `gap_auto` and `confirm`.

Recommended Fix:
Add `settings.enabled &&` to the `armed` expression, or hoist an early
`if !settings.enabled { … }` that clears `update_at` on the running session. Extract the
whole thing as a pure `fn is_armed(enabled: bool, gap_auto: bool, phase: &Phase, has_deadline:
bool) -> bool` beside `auto_arm`, so the two cannot drift again.

Regression Tests Required:
A unit test on that pure function asserting `enabled = false` disarms `Watching` and an armed
`EpisodeGap` alike — mirroring `a_gap_block_arms_only_when_opted_in_and_never_under_five_minutes`
(`scrobbler.rs:1316`), which today tests only the arming side.

Confidence: HIGH

---

ID: A3-04

Severity: P2

Category: BUG

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 1008-1073 (the poll loop), 1072 (`drive_session(&app).await`), 1224
(`perform_update(...).await`), 755 (`save_entry_core(...).await`)

Function: `scrobbler::spawn` / `drive_session` / `perform_update`

Problem:
The 5-second detection poll and the AniList write live in the same sequential loop body, so
a slow or throttled write freezes detection for as long as the write takes.
*(also filed as A3-04 in SYNC_AUDIT.md)*

```
loop {                                                      // scrobbler.rs:1008
    let playback = detection::detect_playback(...).await;   // L1017
    ...
    drive_session(&app).await;                              // L1072
    tokio::time::sleep(POLL_INTERVAL).await;                // L1073, 5 s
}
```
`drive_session` awaits `perform_update` (L1224), which awaits `save_entry_core` (L755),
which awaits `process_queue` first when the queue is non-empty (`commands/list.rs:345-355`)
and then `api.query` for the save itself.

Expected Behavior:
Detection keeps running at 5-second resolution while a scrobble write is in flight; a slow
write delays the write, not the detector.

Actual Behavior:
One scrobble write can hold the loop for, in the worst case: pre-flight pacing ≤ 5.2 s
(`client.rs:511`); attempt 1 ≤ 30 s (reqwest timeout) → 429 → `sleep(Retry-After)` ≤ 120 s;
attempt 2 ≤ 30 s — roughly **185 s** for a single save. `process_queue` returns `Err` on the
*first* retryable row (`list.rs:919`), so a throttled drain does not walk all N rows — but
each row's `api.query` can still sleep out a `Retry-After` inside the loop, and a *healthy*
drain of N queued rows does run all N sequentially, paced by the limiter. The freeze is
therefore reachable without any 429 at all.

Reproduction:
Static trace.
1. Accumulate queued edits offline (each retryable save is queued rather than raised,
   `list.rs:356-365`).
2. Come back online while an episode is playing and the scrobble threshold fires.
3. `drive_session` → `perform_update` → `save_entry_core` → `process_queue` walks the whole
   queue, then sends the scrobble. During all of it `detect_playback` is not called.

Impact:
- The now-playing card and the tray title freeze; `debug_changed` records nothing, so the
  log — the app's only diagnostic for detection — has a silent hole exactly where a user
  would look.
- A short episode, or a media session that starts *and stops* inside the freeze, is never
  observed at all, so it is never scrobbled. That is a missed write, not merely a delayed one.
- The freeze coincides with a rate-limit episode or a queue drain, i.e. with the moment the
  scrobbler is most likely to be needed for a backlog.

Root Cause:
`drive_session` is awaited inline rather than dispatched. Every other long-running concern in
the tree (`alerts::*`, `relations::spawn_loader`, `backups`) has its own task; the scrobble
write shares the detector's.

Recommended Fix:
Dispatch the write. In `drive_session`, replace the inline `perform_update(...).await` at
L1224 with a `tauri::async_runtime::spawn` guarded by an `AtomicBool` (or the
`Phase::Updating` state already set at L971, which is exactly the "a write is in flight"
flag) so at most one write runs at a time and a second tick does not enqueue a duplicate. The
result handling at L1225-1234 already re-checks `applies_to(session, mid, ep)` before
touching the session, so it is safe to run late.

Regression Tests Required:
- A test that `drive_session` returns within one poll interval when the write path is a
  future that has not resolved (a fake `perform_update` seam).
- A test that a second tick while `Phase::Updating` does not start a second write for the
  same `(media_id, episode)` — `applies_to` already exists to express this.

Confidence: HIGH

---

ID: A2-15

Severity: P3

Category: DATA INTEGRITY RISK

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 755 (with 758-762 and 779, and `/home/user/Karasu/src-tauri/src/commands/list.rs:346-363`)

Function: `perform_update`

Problem:
`perform_update` discards `save_entry_core`'s `MutationResult`, so a payload that was only
*enqueued* rather than sent is treated exactly like a successful write: the local cache is
patched, the widgets refresh, `scrobble-done` is emitted and the phase becomes `Updated`
("Updated ✓" on the card).

Expected Behavior:
A queued save is a promise, not a fact. The card, the cache and the widgets should either say
"queued" or wait for the drain before claiming the episode is on the account.

Actual Behavior:
```rust
crate::commands::save_entry_core(app, &db, &api, &token, input).await?;   // :755
...
db.update_cached_progress(user_id, media_type, media_id, episode, Some(status));  // :759
crate::widgets::refresh(app);                                                     // :761
```
`save_entry_core` returns `Ok(MutationResult { queued: true, entry: None })` on two paths — a
drain that failed or skipped (`list.rs:346-355`) and a retryable send error such as a 429
(`list.rs:356-363`). Both reach `?` as `Ok`, so the `queued` flag is thrown away.

Reproduction:
1. Go offline (or reach the rate limit) while an episode is playing.
2. Let the threshold fire. `save_entry_core` queues the payload and returns
   `queued: true`.
3. The card shows "Updated ✓ Episode N", the cached progress becomes N, the widgets show N,
   and `scrobble-done` invalidates the list queries.
4. If the queued row is later dropped as permanently rejected (`report_dropped`,
   `list.rs:348`), the account never receives the progress — while the local cache claims it.
5. Play episode N again. `perform_update` re-reads the cache (`:731-737`) and
   `would_regress(N, Some(N), "CURRENT")` (`:712-714`) now refuses the write outright.

Impact:
A scrobble presented as complete when it is not, and — in the drop case — an episode that can
no longer be scrobbled at all, because the local cache is the very value `would_regress`
consults. Self-heals whenever a real list fetch rewrites the cache (`commands/list.rs:278`),
so it is bounded rather than permanent, but the phase and the toast are wrong in the moment
and the block that follows is silent about why.

Root Cause:
`MutationResult.queued` exists precisely to distinguish the two outcomes, and the one caller
whose UI claims success ignores it.

Recommended Fix:
Bind the result: on `queued == true`, keep the session out of `Phase::Updated` (a `Queued`
phase, or `Pending` retained) and skip the cache patch and `scrobble-done` until the drain
confirms. At minimum, do not patch `update_cached_progress` for a queued save, since that
value is what later blocks the retry.

Regression Tests Required:
A `perform_update`-level test with a `save_entry_core` seam returning `queued: true`,
asserting the cache is untouched and the phase is not `Updated`; plus a
`would_regress`-after-queue case pinning that the episode can still be written once the drain
completes.

Confidence: HIGH — Source: found during adversarial verification

---

ID: A2-03

Severity: P3

Category: BUG

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 1149-1158 (with 568-596 and 653-668)

Function: `drive_session` / `position_due` / `auto_arm`

Problem:
The five-minute `GAP_GRACE` that an episode-gap block must "earn" is bypassed entirely for
any source that reports a playback position (Jellyfin and mpv IPC). `position_due` is
consulted first and, when it answers, the wall-clock deadline — the only thing that carries
`GAP_GRACE` — is never read.

Expected Behavior:
Per `auto_arm`'s own doc (`scrobbler.rs:574-579`) and the setting's hint (`en.ts:1353-1354`,
"five minutes of watching counts as being sure"), a gap-blocked session must not write before
`max(threshold, 5 min)` of continued watching.

Actual Behavior:
```rust
let due = armed
    && position_due(np.position_sec, np.duration_sec, np.duration_min, settings.delay_min)
        .unwrap_or_else(|| session.update_at.is_some_and(|at| Instant::now() >= at));
```
`position_due` returns `Some(true)` as soon as `position * 3 >= total * 2`
(`scrobbler.rs:667`). It knows nothing about `GAP_GRACE`, about when the session started, or
about how long the user has actually been watching. When it answers `Some(true)`, `update_at`
— the only value `auto_arm` put the grace into (`:570`, `:591-593`) — is never compared.

Reproduction:
1. Settings → Detection: "Track past an episode gap" on. AniList progress for *Show* is 2.
2. Open episode 9 of *Show* in Jellyfin and let it resume from a saved position past two
   thirds (Jellyfin's `PlayState.PositionTicks` reports the live position,
   `jellyfin.rs:634-640`; mpv IPC reports `playback-time`, `mpv_ipc.rs:102`).
3. Tick 1: session created, `Phase::Blocked(EpisodeGap { 9, 2 })`,
   `update_at = now + max(16 min, 5 min)`.
4. Tick 2, five seconds later: `armed` is true, `position_due(...) == Some(true)`, `due` is
   true → `perform_update` writes progress 9.

Impact:
The grace window that exists so a wrong gap can be noticed and walked away from lasts one
poll interval instead of five minutes, for exactly the two sources most likely to be
producing a wrong gap (A2-04 and A2-06 both surface as `EpisodeGap` on a mismatched entry).
The countdown on the card (`NowPlayingCard.tsx:275-280`) also becomes a lie: it shows minutes
remaining while the write has already gone out. In practice the loss is narrower than it
looks — for playback started at zero, `position_due` fires at 2/3 of the file, which for any
episode of eight minutes or more is *later* than the five-minute floor, so the grace is only
really lost on a resume or seek past 2/3, or on very short episodes.

Root Cause:
`GAP_GRACE` lives only inside the wall-clock deadline, and the position path is an
unconditional short circuit past it. `auto_arm` returns a `Duration` that the position branch
has no access to.

Recommended Fix:
Give the session an explicit earliest-write instant (`not_before`) set by `auto_arm`, and
gate *both* paths on it: `due = armed && Instant::now() >= not_before && (position_due(..) ||
wall clock)`. For `Phase::Watching`, `not_before` is the session start (no behaviour change);
for an armed `EpisodeGap`, it is `start + GAP_GRACE`.

Regression Tests Required:
A pure `fn due(now: Instant, not_before: Instant, position: Option<bool>, deadline:
Option<Instant>) -> bool` with cases: position says yes but the grace has not elapsed →
false; grace elapsed and position says yes → true; `Watching` with a position past two thirds
→ true immediately (the current, wanted behaviour must not regress).

Confidence: HIGH (mechanism)

Verification: downgraded from P2 — the whole path is opt-in and off by default
(`gap_auto: kv == Some("1")`, `commands/playback.rs:43`); for playback from zero the 2/3
position point is later than the five-minute floor on any episode ≥ 8 min, so the grace is
lost only on a resume/seek past 2/3 or on very short episodes; and `auto_arm`'s
`threshold.max(GAP_GRACE)` still governs the wall-clock path.

---

ID: A2-06

Severity: P3

Category: BUG / DATA INTEGRITY RISK

File: `/home/user/Karasu/src-tauri/src/playback/detection/jellyfin.rs`

Line: 667 (with 603-605)

Function: `playback_from_session`

Problem:
`season: season.filter(|s| *s > 1)` collapses Jellyfin's season 0 (the Specials season) and
season 1 to the same "no season" value. Two consequences: a special is matched against the
main-series entry and its `IndexNumber` is scrobbled as a main-series episode; and a
`detection_override` stored for one is keyed identically to the other (`season_key(None) ==
-1`, `scrobbler.rs:351-353`), so a correction and its `episode_offset` made against a special
silently apply to regular episodes, and vice versa.

Expected Behavior:
A season-0 item is not episode N of the series. It should either be skipped, or carried as a
distinct key so it cannot share a correction with the real season.

Actual Behavior:
`ParentIndexNumber = 0` → `filter(|s| *s > 1)` → `None`. Downstream, `unplaceable_season`
(`scrobbler.rs:628-629`) starts with `now.season.filter(|s| *s > 1)?`, so there is nothing to
block, and `block_reason` judges the special's `IndexNumber` against the series' progress.
`media_title` does keep the `S0E2` spelling (`jellyfin.rs:650-655`), so only the *matching*
half is affected.

Reproduction:
1. Jellyfin library with a "Specials" season. Play special 2 of *Show*
   (`NowPlayingItem: { Type: "Episode", SeriesName: "Show", IndexNumber: 2,
   ParentIndexNumber: 0 }`).
2. `playback_from_session` → `Parsed { title: "Show", episode: Some(2), season: None }`.
3. `build_now_playing` matches the main *Show* entry exactly.
4. AniList progress for *Show* is 1 → `block_reason(np, 2, 1)` returns `None` →
   `Phase::Watching` → progress 2 is written for the main series while a special is playing.
   (Any other progress blocks — `AlreadyWatched` below, `EpisodeGap` above — but with
   `gapAuto` on the gap case writes too, see A2-03.)
5. Key collision: correct that special with an offset. The row is
   `(title = "Show", season = -1, media_type = "ANIME")` — the same row a correction for the
   regular (season 1) episodes of *Show* would occupy, and `detection_override`
   (`scrobbler.rs:359-369`) finds it for both.

Impact:
Wrong progress on the main entry when the numbers happen to line up, and a correction store
where two genuinely different populations share one key. The CLAUDE.md v12 note is explicit
that the *point* of a separate `detection_override` table is that different key spaces must
not collide; season 0 reintroduces a collision inside the table.

Root Cause:
The `> 1` filter was written to suppress the useless "S1" hint for the matcher
(`jellyfin.rs:665-667`, pinned by `season_one_is_dropped`, `jellyfin.rs:940`) and happens to
swallow 0 with it.

Recommended Fix:
Handle 0 separately from 1. Minimal: `if season == Some(0) { return None; }` before composing
the `Playback`, so a special is simply not detected — which is honest, since AniList models
most specials as their own entries anyway. If detecting them is wanted, carry
`season = Some(0)` through so `season_key` is 0 and a correction for a special gets its own
row.

Regression Tests Required:
A `playback_from_session` case with `ParentIndexNumber: 0`, asserting the chosen behaviour,
sitting beside the existing `season_one_is_dropped`.

Confidence: MEDIUM — the code path is certain and provable from the file. What could not be
verified offline is that Jellyfin's Specials season really reports `ParentIndexNumber: 0` on
`/Sessions` (network access was out of scope); Specials-as-season-0 is the standard Jellyfin
convention, and the key collision holds regardless of which value is used, for any value ≤ 1.
A captured `/Sessions` payload for a special would settle the first half.

---

ID: A2-14

Severity: P3

Category: BUG

File: `/home/user/Karasu/src-tauri/src/playback/detection/jellyfin.rs`

Line: 589 (the `Type` gate), 600-602 (`IndexNumber` only), 610-614 (the movie's title), with
`/home/user/Karasu/src-tauri/src/playback/scrobbler.rs:1094` and `948-950`

Function: `playback_from_session` / `drive_session` / `confirm_pending_impl`

Problem:
A movie is accepted by detection and rendered on the now-playing card, but it can never be
scrobbled. `jellyfin.rs:589` admits `Type == "Movie"` and `:610-614` gives it a title from
`Name` when there is no `SeriesName`, but a movie has no `IndexNumber`, so `Parsed.episode`
is `None`. `drive_session` requires `np.episode.is_some()` (`scrobbler.rs:1094`) before it
will create a session at all, so no session is ever created: the countdown never starts and
nothing is ever written. The same holds for a movie played through mpv IPC, whose filename
carries no episode number for `parser::parse` to find.

Expected Behavior:
An AniList movie entry is `episodes: 1`, so watching it should be scrobblable — progress 1,
status `COMPLETED` — the same way an episode is. If it is deliberately out of scope, the code
should say so and the card should not imply otherwise.

Actual Behavior:
```rust
match now_playing {
    Some(np) if np.media_id.is_some() && np.episode.is_some() => { … }   // :1094
    _ => { /* clear the session */ }                                      // :1213-1219
}
```
The `_` arm clears any session and returns `None`, so the film sits on the card with a match
and no phase. Both manual routes then fail as well: `confirm_pending` and the tray item reach
`confirm_pending_impl`, which finds no session and returns `"Nothing is currently playing"`
(`scrobbler.rs:948-950`) while the film is plainly on screen.

Reproduction:
1. Have a movie on the AniList list (e.g. any film entry, `episodes: 1`).
2. Play it in Jellyfin. The card shows the film with its matched entry.
3. Watch past the threshold. Nothing happens: no countdown, no `Pending` toast, no write.
4. Press "Scrobble now" in the tray. The log records `scrobble now: Nothing is currently
   playing` (`lib.rs:258-266`).

Impact:
A whole media class — films, OVAs and specials that AniList models as one-episode entries —
is detected, displayed and matched but is untrackable, with no comment anywhere in the
pipeline saying that is intended and no message telling the user why. Every film has to be
marked watched by hand.

Root Cause:
The pipeline is episode-shaped end to end: `Parsed.episode` is the carrier, and the one
source that knows it is watching a film (Jellyfin's `Type == "Movie"`) has no field to put a
number in. Nothing substitutes the implicit "episode 1" a single-episode entry has.

Recommended Fix:
For a `Movie` item with no `IndexNumber`, set `episode = Some(1)` and `episode_marked = true`
in `playback_from_session` — the number is not a guess, it is what a one-episode entry means.
Guard the write side by refusing when the matched entry's `total` is not `Some(1)`, so a
mis-matched film cannot write episode 1 onto a series. If films are meant to stay out of
scope, say so in a comment at `jellyfin.rs:589` and surface a distinct block reason instead of
silence.

Regression Tests Required:
- `playback_from_session` with `{ Type: "Movie", Name: "…", RunTimeTicks: … }` and no
  `IndexNumber`, asserting the chosen episode value.
- A `drive_session`-level case asserting a movie either creates a session (with the `total ==
  Some(1)` guard) or produces a named block, never the current silent no-op.

Confidence: HIGH — Source: found during adversarial verification

---

ID: A2-10

Severity: P3

Category: BUG

File: `/home/user/Karasu/src-tauri/src/db.rs`

Line: 756-786 (with `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs:757-762` and
`/home/user/Karasu/src/components/media/NowPlayingCard.tsx:106-117`)

Function: `Db::update_cached_progress`

Problem:
After a scrobble that *creates* a list entry — the documented "off-list forced entry" path
(`scrobbler.rs:385-387`) — the SQLite list cache is not updated, because
`update_cached_progress` only patches an entry that is already in the cached payload. The
only thing that would refresh it is the frontend's `scrobble-done` listener, and that listener
lives inside `NowPlayingCard`, which is mounted **only on the Dashboard**
(`src/pages/Dashboard.tsx:114`).

Expected Behavior:
Once an entry exists on AniList, the next episode of the same title should resolve against a
progress of N, not 0.

Actual Behavior:
```rust
let Some(payload) = self.cached_list(user_id, media_type) else { return; };
… for entry … if entry["mediaId"] == media_id { entry["progress"] = progress.into(); }
```
An id that is not in the payload matches nothing and the function returns having written the
payload back unchanged.

Reproduction:
1. Use the correction picker to point a detected title at an AniList entry that is *not* on
   the list (the picker searches all of AniList precisely for this, `MatchPicker.tsx:16-27`).
2. Watch episode 1. `resolve_match` returns `progress: None` → `progress.unwrap_or(0) == 0` →
   `Watching` → `perform_update` writes progress 1 and creates the entry.
   `update_cached_progress` no-ops.
3. Navigate away from the Dashboard (or leave the app in the tray on any other route) so the
   `scrobble-done` listener is unregistered.
4. Watch episode 2. `candidates_from_cache` still does not contain the id → `progress` `None`
   → 0 → `block_reason(np, 2, 0)` → `EpisodeGap { 2, 0 }`. Every further episode is
   gap-blocked with the same wrong "your progress is 0".

Impact:
Automatic tracking stops for that title until something refetches the list — visiting the
anime list page does, via `commands/list.rs:278`. Self-healing but confusing, and the block
text states a progress that is not true. The window is narrower than it first appears: it is
masked entirely whenever the user is on the Dashboard (the listener fires) or opens a list
page.

Root Cause:
Cache maintenance after a write is split between Rust (patch in place) and the frontend
(invalidate + refetch), and the Rust half cannot express "insert".

Recommended Fix:
Give `update_cached_progress` a boolean return and, on `false`, have the scrobbler emit an
event the frontend handles regardless of route (or fetch the single entry and splice it in).
Do not respond by clearing the cache: an empty `candidates_from_cache` is worse than a stale
one.

Regression Tests Required:
`db.rs`: assert `update_cached_progress` reports whether it patched anything — a `mem_db()`
test with a `media_id` absent from the payload.

Confidence: HIGH (mechanism, all three call sites read) / MEDIUM (that the listener is
genuinely absent off-Dashboard — the mount point is unique per grep, and `<main
key={pathname}>` remounting is stated in the component's own comment, but the app was not run)

---

ID: A2-08

Severity: P3

Category: BUG

File: `/home/user/Karasu/src-tauri/src/lib.rs`

Line: 258-266 (with `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs:941-996`)

Function: tray `on_menu_event` → `confirm_pending`

Problem:
The tray's "Scrobble now" item is always enabled and calls `confirm_pending(app, true)` with
no phase check, unlike the toast button, which goes through `confirm_pending_for` and verifies
both the target and `phase == Pending` (`scrobbler.rs:952-956`). Pressing it after a
successful scrobble turns the session's `Updated` phase into `Blocked(Failed)`.

Expected Behavior:
An already-completed session should ignore a second confirmation, the way the card does —
`canScrobble` (`NowPlayingCard.tsx:378-385`) deliberately excludes `updated`.

Actual Behavior:
`confirm_pending_impl` checks `applies_to`/`Pending` only when `expect` is `Some`, which is
the toast path; it otherwise refuses only a `Blocked` phase whose reason is non-forceable.
`Phase::Updated` is not `Blocked`, so it sets `Updating`, calls `perform_update`, which
re-reads the cache it just patched (`:731-737`, patched at `:758-759`) and hits
`would_regress(episode, Some(episode), "CURRENT")` → true → `Err`, stamping
`Blocked(Failed { "Refusing to set progress back to 5 from 5" })` on the session, which
`emit_session` pushes to the card.

Reproduction:
1. Let episode 5 scrobble automatically. Card reads "Updated ✓ Episode 5".
2. Right-click the tray icon → "Scrobble now".
3. The card flips to the gold blocked line with the English sentence from A2-07, and now
   offers an "Update now" button that loops on the same error.

Impact:
A successful scrobble is presented as a failure. Nothing is written wrongly —
`would_regress` is doing its job — but the state on screen is a lie and the tray item is the
only route to it.

Root Cause:
Two confirmation entry points with different guards.

Recommended Fix:
Make `confirm_pending` refuse phases with nothing to confirm (`Updated`, `Updating`) the same
way it refuses non-forceable blocks, and/or disable the tray item while the session is not
confirmable (the handle is already retained in `TrayItems.scrobble`, `lib.rs:115`, exactly so
its state can be changed).

Regression Tests Required:
A pure `fn confirmable(phase: &Phase) -> bool` covering all six phases, called from
`confirm_pending_impl`, with a unit test — the phase gate is currently expressed only as an
inline `if let`, which no test can reach.

Confidence: HIGH

---

ID: A2-07

Severity: P3

Category: BUG

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 738-743 (with 115-118, 144-149, 988-991 and 1229-1232)

Function: `perform_update` / `BlockReason::Failed`

Problem:
`would_regress`'s refusal is returned as a free-form English `Err` string that becomes
`BlockReason::Failed { message }`, which is (a) rendered verbatim in the UI, untranslated,
and (b) marked `forceable()`, so the card offers "Update now" for a condition that will refuse
identically on every retry.

Expected Behavior:
`BlockReason`'s own doc (`scrobbler.rs:115-118`) says `Failed` means "the API refused it.
**Not a refusal of ours**, so retrying is exactly the right offer — and the message is the
server's own, which no translation could improve." This message is ours, in English, and
retrying cannot help. CLAUDE.md's convention is the same: a pure function returns an i18n key,
never a sentence.

Actual Behavior:
```rust
if would_regress(episode, cached_progress, list_status) {
    return Err(format!("Refusing to set progress back to {episode} from {}",
        cached_progress.unwrap_or(0)));
}
```
`drive_session:1229-1232` (and `confirm_pending_impl:988-991`) wrap it as
`Blocked(Failed { message })`. `NowPlayingCard.blockedText` passes it straight into
`t("nowPlaying.blockedFailed", { message })` (`NowPlayingCard.tsx:333`), and
`backendErrorText` (`src/lib/backendError.ts:22-41`) has no case for it, so it falls through
unchanged — an English sentence in a German UI.

Reproduction:
1. Start episode 5; AniList progress is 4 → `Phase::Watching`, armed.
2. Before the threshold, raise progress to 6 from another device (or in the entry editor,
   which refreshes the SQLite cache via `commands/list.rs:278 cache_list`).
3. Threshold fires. `perform_update` re-reads the cache (`scrobbler.rs:731-737`),
   `would_regress(5, Some(6), "CURRENT")` → true → `Err`.
4. Card shows `Update failed: Refusing to set progress back to 5 from 6`, in English, with an
   enabled "Update now" that reproduces the same error every time it is pressed.

Impact:
Untranslated text on a user-facing surface — the exact failure mode the `BlockReason` enum was
introduced to eliminate — plus a button that cannot succeed. No data is written, so this is a
UX/i18n defect rather than a safety one.

Root Cause:
One variant is carrying two different meanings — "the server said no" and "we said no" — and
`forceable()` is right for only one of them.

Recommended Fix:
Add a distinct non-forceable variant (e.g. `BlockReason::WouldRegress { episode, progress }`)
with numbers rather than a sentence, mapped through a literal `t()` in `blockedText` the way
the other three are. Keep `Failed` for real API errors.

Regression Tests Required:
`assert!(!BlockReason::WouldRegress { .. }.forceable())` in
`only_a_forward_force_or_a_retry_is_offered` (`scrobbler.rs:1291`), plus the two new i18n keys
(`i18nKeys.test.ts` covers the literal `t()` side automatically).

Confidence: HIGH

---

ID: A2-05

Severity: P4

Category: IMPROVEMENT

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 611-613 (with 702-714 and 86-87)

Function: `block_reason` / `would_regress`

Problem:
`block_reason` ignores `NowPlaying.list_status`, so an entry marked `REPEATING` with its
progress still at the total can never be scrobbled: every episode of the rewatch trips
`AlreadyWatched`, which `forceable()` (`scrobbler.rs:144-149`) refuses, so the card offers no
button either.

Expected Behavior:
`would_regress` states the intent plainly (`scrobbler.rs:706-708`): "Rewatching is the one
case where a lower number is meant, and it is spelled `REPEATING`". The decision function that
gates the write could know the same thing the write does.

Actual Behavior:
```rust
if episode <= progress { return Some(BlockReason::AlreadyWatched { episode, progress }); }
```
`now.list_status` is carried in the struct (`scrobbler.rs:86-87`) and is not read here.

Reproduction:
1. Finish a 12-episode show. AniList: `status = COMPLETED`, `progress = 12`.
2. Set it to "Rewatching" in Karasu's entry editor. Nothing in the frontend resets `progress`
   (grepped: no `REPEATING` handler anywhere under `src/` touches progress), so it stays 12
   and `status = REPEATING`.
3. Play episode 1. `block_reason(np, 1, 12)` → `AlreadyWatched { 1, 12 }`.
4. Phase `Blocked`, `forceable() == false`, so `canScrobble` (`NowPlayingCard.tsx:378-385`)
   hides "Update now" and `confirm_pending_impl` would refuse it anyway
   (`scrobbler.rs:966-970`).
5. Every episode of the rewatch behaves identically until progress is reset by hand.

Impact:
Automatic tracking does nothing for a rewatch until the user resets progress. The block is
self-explaining on the card (`blockedText` → `nowPlaying.blockedAlreadyWatched` with both
numbers, `NowPlayingCard.tsx:320-324`), and the workaround is the workflow the adjacent doc
states, so this is a rough edge rather than a defect.

Root Cause:
Two functions decide "may this write happen", and only one of them was taught about
`REPEATING` — deliberately, since the doc at `:702-711` says the count is the user's to
restart.

Recommended Fix:
Either pass the list status into `block_reason` and skip the `AlreadyWatched` branch when it
is `REPEATING` (the `EpisodeGap` branch should still apply), or — more in keeping with the
stated intent — reset `progress` to 0 when the user picks "Rewatching" in the editor, which is
what the `would_regress` doc's "the count is theirs to restart" assumes and what a rewatch on
anilist.co requires.

Regression Tests Required:
Extend `the_block_decision_names_which_way_it_went_wrong` (`scrobbler.rs:1298`) with
`list_status = "REPEATING"`, asserting whichever behaviour is chosen, and pinning that
`block_reason(&np, 9, 2)` is still `EpisodeGap`.

Confidence: HIGH

Verification: downgraded from P3 — the adjacent doc at `:702-711` is an explicit design
statement that a rewatch is `REPEATING` plus a progress reset, the resulting block names both
numbers on the card, and `would_regress`'s carve-out is not dead code (it still guards a
progress that moved after session start). A design gap with a stated workflow and a visible
explanation is an improvement, not a bug.

---

ID: A2-16

Severity: P4

Category: BUG

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 242-249 (with 1143-1148 and
`/home/user/Karasu/src/components/media/NowPlayingCard.tsx:269-281`)

Function: `emit_session` / `drive_session`

Problem:
The card's gap countdown keeps running after "Track past an episode gap" is switched off.
`armed` re-reads `settings.gap_auto` every tick (`:1146`) and correctly goes false, but
nothing re-emits the session, so the frontend still holds the `update_at_ms` it was given when
the gap was armed and counts down to a write that will never happen.

Expected Behavior:
Switching the grace off should take the countdown off the card in the same tick it disarms
the session — the sibling promise the code makes at `:1136-1141` ("switching the grace off
disarms a waiting gap immediately") should be visible, not only internal.

Actual Behavior:
`emit_session` is called only where the phase changes (session creation, `Pending`,
`Updating`, `Updated`, `Blocked`, `Cancelled`). Disarming changes no phase — the session stays
`Blocked(EpisodeGap { .. })` — so no event goes out. The already-delivered event carried
```rust
update_at_ms: match &s.phase {
    Phase::Watching => s.update_at_epoch_ms,
    Phase::Blocked(BlockReason::EpisodeGap { .. }) => s.update_at_epoch_ms,
    _ => None,
},
```
and the card renders `nowPlaying.blockedGapAuto` from it (`NowPlayingCard.tsx:273-280`), whose
own comment says "Only an armed episode gap ever has a countdown here" — which is exactly the
invariant that has just been broken.

Reproduction:
1. Turn "Track past an episode gap" on. Start an episode that gap-blocks; the card shows the
   block plus "… in 4:31".
2. Go to Settings → Detection and turn the grace back off.
3. Return to the Dashboard. The countdown continues to tick down and reaches zero. No write
   occurs (`armed` is false), and the countdown simply expires having promised something.

Impact:
Cosmetic, and the mirror image of A2-03: there the countdown under-promises (the write has
already gone out), here it over-promises (no write will ever go out). No data is at risk.

Root Cause:
`update_at_ms` is a snapshot pushed on phase change, while `armed` is recomputed per tick from
settings the snapshot cannot see.

Recommended Fix:
Have `drive_session` re-emit when the computed `armed` value for an `EpisodeGap` session
differs from what was last emitted (keep a `last_emitted_armed` on the `Session`), and gate
`update_at_ms` on that value rather than on the phase alone.

Regression Tests Required:
A pure `fn gap_countdown_at(phase: &Phase, gap_auto: bool, update_at: Option<i64>) ->
Option<i64>` used by `emit_session`, with a case asserting `gap_auto = false` yields `None`
for an `EpisodeGap` phase.

Confidence: HIGH — Source: found during adversarial verification

---

ID: A2-09

Severity: P4

Category: DATA INTEGRITY RISK

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 376-379 (with the doc at 371-375)

Function: `shift_episode`

Problem:
`shift_episode` clamps a non-positive result to 1. Its own doc says such an offset "describes
a mapping that cannot be true" — but instead of refusing, it produces episode 1, which is a
perfectly writable number and can be auto-scrobbled.

Expected Behavior:
A mapping the correction cannot satisfy could yield no episode (`episode = None`), which stops
`drive_session` (`scrobbler.rs:1094` requires `np.episode.is_some()`) and leaves the card
showing the title without a number.

Actual Behavior:
```rust
let shifted = i64::from(episode) + i64::from(offset);
shifted.clamp(1, u32::MAX as i64) as u32
```

Reproduction:
1. A source numbers a franchise absolutely (1..51) and reports no season, so the correction
   key is `(title, -1)`. The user corrects it to the season-2 AniList entry with
   `episode_offset = -26` while watching episode 27, so 27 → 1.
2. Later they play episode 10 of the same title. The same override row applies (there is only
   one, keyed on the same parse).
3. `shift_episode(10, -26)` = **1**, not "impossible".
4. The season-2 entry is at progress 0 → `block_reason` returns `None` → `Phase::Watching` →
   progress 1 is written to the season-2 entry while season 1 episode 10 is playing.

Impact:
A wrong progress write that looks plausible on screen. Bounded: it can only ever write 1, and
only when the target entry's progress is 0 and a negative-offset override also matches
lower-numbered episodes.

Root Cause:
The clamp was chosen to avoid writing episode 0, and the doc comment at `:371-375` shows the
author considered the impossible mapping and folded it into the floor deliberately.

Recommended Fix:
Return `Option<u32>` — `None` when `episode + offset < 1` — and let
`build_now_playing`/`requeue_match` carry the `None` through as "no episode". Keep the
saturation at the top end.

Regression Tests Required:
Replace the `shift_episode(1, -5) == 1` assertion
(`an_offset_moves_the_episode_and_never_below_one`, `scrobbler.rs:1376-1385`) with
`shift_episode(1, -5).is_none()`, and add a `drive_session`-level assertion that a session is
not created when the shifted episode is absent.

Confidence: MEDIUM

Verification: downgraded from P3 — the doc comment shows the floor was a deliberate choice
rather than an oversight and the existing test pins it, so this is a proposed behaviour change
the maintainer has to sign off on; impact is bounded to writing episode 1, and only when a
negative-offset override also matches lower-numbered episodes *and* the target entry sits at
progress 0.

---

ID: A2-13

Severity: P4

Category: IMPROVEMENT

File: `/home/user/Karasu/src-tauri/src/playback/detection/jellyfin.rs`

Line: 600-602

Function: `playback_from_session`

Problem:
Only `IndexNumber` is read. Jellyfin also publishes `IndexNumberEnd` for a file that contains
more than one episode (the common "S01E01-E02" double-length release), which is dropped.

Expected Behavior:
A file covering episodes 5–6 should end up writing progress 6, not 5.

Actual Behavior:
`episode = IndexNumber` only. The session is created for episode 5; when the file ends, the
next file starts at 7 and `block_reason` reports `EpisodeGap { 7, 5 }` — a gap the user then
has to force past, once per double-length file.

Reproduction:
Play a Jellyfin item with `IndexNumber: 5, IndexNumberEnd: 6` and watch the subsequent episode
7 be gap-blocked.

Impact:
Cosmetic plus one extra manual confirmation per multi-episode file. No wrong write — the
progress written is simply one short.

Root Cause:
The field was not modelled.

Recommended Fix:
Read `IndexNumberEnd` through `get_ci` and use it as the episode when it is greater than
`IndexNumber` (progress must reflect the last episode watched). Note this interacts with
`media_title`, which is what the poll loop dedupes on.

Regression Tests Required:
A `playback_from_session` case with `IndexNumberEnd`.

Confidence: MEDIUM — the code path is certain; `IndexNumberEnd` is part of `BaseItemDto` so it
is plausibly present on `NowPlayingItem`, but that it is populated there (rather than only on
`/Items`) could not be verified offline.

---

ID: A2-12

Severity: P4

Category: INVESTIGATION

File: `/home/user/Karasu/src-tauri/src/playback/scrobbler.rs`

Line: 745-751

Function: `perform_update`

Problem:
Finishing a **rewatch** through the scrobbler writes `{ mediaId, progress, status:
"COMPLETED" }` and never touches `repeat`. If AniList does not auto-increment `repeat` on a
`REPEATING → COMPLETED` transition, the rewatch count is silently lost.

Expected Behavior:
Completing a rewatch should leave the entry with `repeat = n + 1`, which is what the AniList
website does when the user finishes a rewatch there.

Actual Behavior:
```rust
let done = total == Some(episode);
let status = match (done, list_status) {
    (true, _) => "COMPLETED",
    (false, "REPEATING") => "REPEATING",
    _ => "CURRENT",
};
let input = json!({ "mediaId": media_id, "progress": episode, "status": status });
```
`repeat` is absent from the payload, so `SaveMediaListEntry` leaves it as-is.
`bulk_save_list_entries` (`commands/list.rs:427`) *does* carry a `repeat` argument, so the
field is otherwise plumbed through the app.

Reproduction (contingent on the missing evidence below):
1. Complete a 12-episode show, set it to Rewatching, reset progress to 0 (required — see
   A2-05).
2. Scrobble episodes 1..12. On 12, `done` is true → status `COMPLETED`.
3. Inspect the entry's `repeat` on AniList.

Impact:
If AniList does not increment it, a rewatch tracked entirely through Karasu is
indistinguishable from one that never happened, and Statistics/Wrapped read `repeat`. Only
reachable after the A2-05 workaround.

Root Cause:
The scrobble payload was written for the forward path only.

Recommended Fix:
Only after the fact below is established: when transitioning `REPEATING → COMPLETED`, send
`repeat: current + 1` alongside. The session would need to carry the entry's current `repeat`
the way it already carries `list_status` (`scrobbler.rs:170-171`).

Regression Tests Required:
A pure `fn completion_payload(done, list_status, repeat) -> (status, Option<i64>)` with a unit
test, once the behaviour is decided.

Confidence: LOW — **missing evidence**: whether AniList's `SaveMediaListEntry`
auto-increments `repeat` when `status` moves from `REPEATING` to `COMPLETED`. This audit was
network-free by instruction, and the CLAUDE.md convention says a mutation must be checked by
schema introspection rather than by running it, so the answer needs `__type(name: "Mutation")`
plus a documented reading of AniList's own behaviour before anything is changed.

---

ID: A2-11

Severity: P4

Category: IMPROVEMENT

File: `/home/user/Karasu/src-tauri/src/playback/relations.rs`

Line: 116-195 (write guards at 140 and 193), with the read guards at
`/home/user/Karasu/src-tauri/src/playback/scrobbler.rs:847` and `:1058`

Function: `spawn_loader`

Problem:
`spawn_loader` is a bare `tauri::async_runtime::spawn` — not `logging::supervise` — and
`Relations` is the only lock in the playback pipeline reached with `.read().unwrap()` /
`.write().unwrap()` rather than the panic-tolerant `sync::LockExt` idiom the codebase adopted
(`src/sync.rs:1-21`).

Expected Behavior:
Consistency with the documented idiom: a panicked background task is restarted, and a poisoned
lock does not turn one panic into a permanent outage.

Actual Behavior:
`Relations` is an `RwLock`, which `LockExt` (Mutex-only) does not cover. If a panic ever
occurred while the write guard was held (`relations.rs:140`, `:193`), every later
`rules.0.read().unwrap()` would panic — including the one in the scrobbler's own poll loop
(`scrobbler.rs:1058`) and the one in `requeue_match` (`scrobbler.rs:847`), which `supervise`
would then restart into the same panic until `MAX_RESTARTS` is exhausted and detection is off
for the session. Separately, `spawn_loader` is one-shot: if the task dies, redirect rules stay
unloaded until the app is restarted, with no retry and no log line.

Reproduction:
Not reproducible from the code as written — the only operations under the write guard are a
`Vec` assignment and a `clone`. This is an inconsistency with a documented safety idiom, not a
demonstrated failure.

Impact:
None demonstrated. Listed because `net.rs`'s own header records a real Android panic in
exactly this task, which is what makes the loader's failure mode worth naming.

Root Cause:
`LockExt` was introduced for `Mutex` and `Relations` predates it as an `RwLock`.

Recommended Fix:
Extend `sync::LockExt` with `read_guard()`/`write_guard()` for `RwLock` and use them for
`Relations`; consider `logging::supervise` for the loader, or at least an `error` line when the
task exits without having set any rules.

Regression Tests Required:
Mirror `a_poisoned_lock_still_hands_over_its_data` (`sync.rs:41`) for the `RwLock` variants.

Confidence: MEDIUM (the inconsistency is certain; that it can be triggered is not). The
original write-up placed the `read().unwrap()` call sites in `relations.rs`; they are in
`scrobbler.rs:847` and `:1058`.

---

## Verified sound

Scenarios traced and found correctly handled, each with the guard that handles it:

1. **Offset then redirect, in that order, in both resolve paths.** `build_now_playing` applies
   `shift_episode` at `scrobbler.rs:459-463` and the relations redirect at `495-515`;
   `requeue_match` repeats the same order at `819-822` and `844-854`. The order matches
   CLAUDE.md's v12/v13 note.

2. **`requeue_match` re-resolves from the untouched source number.** `scrobbler.rs:811` reads
   `np.source_episode`, and the patch block (`874-904`) writes `np.episode` but never
   `np.source_episode`, so repeated corrections cannot compound *inside Rust*. (The frontend's
   arithmetic is A2-01; the Rust half is right.)

3. **A redirect cannot be applied twice on one resolve.** `relations::redirect`
   (`relations.rs:105-112`) is a single `find_map` over the rules and its output is never fed
   back in; `build_now_playing` returns immediately from the `map` closure at `510`.

4. **Self-redirect (`!`) rules keep a user-confirmed redirect target working.** `parse_line`
   emits the extra `dst_id → dst_id` rule (`relations.rs:72-81`), so a correction pinned to the
   redirect target still resolves through the rule on the next episode. (Only the no-`!` case
   breaks, and only via A2-01.)

5. **Jellyfin's season-beside-the-name case is blocked, not guessed.** `unplaceable_season`
   (`scrobbler.rs:628-641`) → `matcher::season_informed` (`matcher.rs:92-94`) →
   `without_season_marker`, and `UnknownSeason` is non-forceable (`forceable`,
   `scrobbler.rs:144-149`). Pinned by
   `a_season_the_matcher_could_not_use_blocks_before_anything_else` (`scrobbler.rs:1353`).

6. **`UnknownSeason` is reported before `AlreadyWatched`/`EpisodeGap`.** `block_reason` orders
   them at `scrobbler.rs:608-616`; pinned by the same test.

7. **A season marker inside the title is not blocked.**
   `a_season_spelled_in_the_title_is_left_alone` (`scrobbler.rs:1390`). (What is *not* sound is
   which entry it then matches — A2-04.)

8. **Progress can never be lowered by a scrobble.** `would_regress` (`scrobbler.rs:712-714`)
   re-reads the *live* cached progress inside `perform_update` (`731-737`) rather than trusting
   the minutes-old session. Pinned by `a_scrobble_can_only_ever_move_progress_forward`
   (`scrobbler.rs:1275`).

9. **`AlreadyWatched` is not forceable and the card does not offer it.** `forceable()` plus
   `canScrobble` (`NowPlayingCard.tsx:378-385`) plus the backend refusal in
   `confirm_pending_impl` (`scrobbler.rs:966-970`) — three layers, emitted rather than
   re-derived (`ScrobbleEvent.forceable`, `scrobbler.rs:198-202`).

10. **No double scrobble on an end screen or on autoplay.** After a write the phase is
    `Updated`, and the per-tick `armed` match (`scrobbler.rs:1143-1148`) admits only `Watching`
    and an armed `EpisodeGap`, so `due` is false forever after. Autoplay changes `raw`, which
    rebuilds `NowPlaying` and starts a fresh session (`is_same`, `scrobbler.rs:1096-1099`).

11. **A result cannot be stamped onto the wrong episode.** `applies_to`
    (`scrobbler.rs:191-193`) guards both write-back sites (`1228`, `987`). Pinned by three
    tests (`scrobbler.rs:1474-1491`). The poll loop cannot race itself either —
    `drive_session(&app).await` is awaited inside the loop (`scrobbler.rs:1072`), so no second
    tick starts mid-update. (That the await is *inline* is A3-04's complaint, but it is what
    makes the race impossible.)

12. **The toast button confirms only the session it was raised for.** `confirm_pending_for` →
    `applies_to` **and** `phase == Pending`, checked under the same lock that reads the session
    out (`scrobbler.rs:952-956`).

13. **`requeue_match` drops the running session so the corrected entry gets a fresh one**
    (`scrobbler.rs:918-919`), and an in-flight update whose session vanished is discarded rather
    than written back (`1227-1235`).

14. **No `await` while holding a mutex, and no lock-order inversion.** Both update paths close
    their `ScrobbleSession` guard before `perform_update` (`scrobbler.rs:1089-1221`, `946-983`).
    `discord::sync` takes `Discord` then `ScrobbleSession` (`discord.rs:118`, `95-96`); nothing
    anywhere takes them in the other order. `requeue_match`'s comment at `870-873` is accurate.

15. **The position is patched in place on every tick of an unchanged title.**
    `scrobbler.rs:1028-1037` — without it the deadline check would judge the session-start
    position forever, and a "not yet" verdict suppresses the wall-clock fallback.

16. **Position arithmetic has no division and no zero-duration hazard.** `position_due` returns
    `None` for a missing position, a missing duration and `total == 0` (`scrobbler.rs:662-666`),
    and compares by multiplication (`667`). Pinned by
    `a_position_stands_down_for_an_explicit_delay_or_missing_data` (`scrobbler.rs:1423`).

17. **An explicit `delay_min` is not reinterpreted as a fraction of the file.** `position_due`
    returns `None` when `delay_min > 0` (`scrobbler.rs:659-661`); `threshold` honours it first
    (`673-675`).

18. **A pause stops the clock where a position exists, and the wall clock remains the fallback
    where it does not.** `position_due(...).unwrap_or_else(wall)` at `scrobbler.rs:1149-1158`;
    `media_session` drops non-`playing` sessions (`is_playing`, `media_session/mod.rs:84-86`),
    and a paused mpv is demoted to last resort rather than dropped
    (`detection/mod.rs:216-224, 258-267`).

19. **Manga carries the same guards.** `MANGA_THRESHOLD` (`scrobbler.rs:676-678`), chapters as
    the total (`candidates_from_cache:316`), no relations redirect (`495`, `!playback.manga`),
    the same `block_reason`/`would_regress`, and a separate override key space via `media_type`
    (`db.rs:1287-1301`, `a_correction_is_per_media_type`).

20. **A manga tab whose title parses to nothing cannot become a correction key.** `parse_manga`
    yields an empty title for `"Chapter 45 - Site"`, which scores 0 against every candidate
    (`dice`'s empty-set guard, `matcher.rs:47-53`), and `set_detection_override` refuses an empty
    title (`commands/playback.rs:479-482`). `media_session::playback_from` rejects such titles
    up front (`media_session/mod.rs:288-299`).

21. **The trigram NaN guard and the exact short-circuit are intact** (`matcher.rs:47-53`,
    `188-193`), and `prepare` preserves candidate and within-candidate title order
    (`matcher.rs:145-161`), pinned by `first_candidate_wins_a_tie` and
    `prepared_agrees_with_the_original_algorithm`.

22. **A title not on the list produces silence, not a guess.** `candidates_from_cache` reads
    only the cached list; `best_match` returns `None` below 0.7 (`matcher.rs:204`);
    `drive_session`'s `_` arm clears the session (`scrobbler.rs:1213-1219`); the card shows
    `nowPlaying.noMatch` with the correction button. `identify.rs` is reachable only from
    `library.rs:526` — the scanner — so detection never spends AniList requests on an unmatched
    title.

23. **A Jellyfin session belonging to another account is never picked up.** `session_matches`
    (`jellyfin.rs:346-363`) fails closed on an empty `user_id`, normalises GUID dashing and
    case, and is backed by seven tests. The module header documents why a user token rather than
    an admin API key is used.

24. **A failed Jellyfin poll holds the last answer for at most three ticks and a clean "nothing
    playing" clears it immediately** (`hold_last_good` / `remember`, `jellyfin.rs:743-775`),
    pinned by two tests that serialise on the process-global.

25. **The parser will not panic on a slice boundary** — every `work[..title_end]` uses a regex
    match start or `work.len()` (`parser.rs:126, 211`) — and a trailing year is not mistaken for
    an episode (`parser.rs:110`).

26. **The scrobbler loop is supervised** (`scrobbler.rs:1004`, `logging::supervise`), with
    bounded restarts.

## Refuted during verification

No finding was refuted. Verification confirmed thirteen of the thirteen filed findings as real
defects, downgrading three of them (A2-03, A2-05, A2-09) and correcting details in two more
(A2-01's cheapest reproduction, A2-11's call-site file), and added three the first pass had
missed (A2-14, A2-15, A2-16).

## Counts

- **P0:** 0
- **P1:** 0
- **P2:** 4 (A2-01, A2-04, A2-02, A3-04)
- **P3:** 7 (A2-15, A2-03, A2-06, A2-14, A2-10, A2-08, A2-07)
- **P4:** 6 (A2-05, A2-16, A2-09, A2-13, A2-12, A2-11)
- **Refuted:** 0

Total: 17 findings.
