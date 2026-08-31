# Detection and Platform Audit

## Scope

Read-only audit of Karasu's detection and playback layer, with every finding
re-derived against the source a second time during adversarial verification.
Covered:

- `src-tauri/src/playback/detection/**` — source precedence in `detect_playback`,
  the mpv IPC probe, the Jellyfin `/Sessions` client, Win32 window enumeration,
  and the `media_session` module with both backends (SMTC on Windows, MPRIS on
  Linux)
- `src-tauri/src/playback/scrobbler.rs` — session lifetime, `auto_arm`,
  `position_due`, `block_reason`, `would_regress`, `perform_update`
- `src-tauri/src/playback/relations.rs` — the episode-redirect loader and
  `redirect`
- `src-tauri/src/logging.rs` — `supervise`, `debug_changed`, the panic hook
- `src-tauri/src/discord.rs` — Rich Presence, its content-filter guard and the
  resend fingerprint
- `src-tauri/src/alerts/*` — the airing, stale, sequel and site passes plus
  `notify`
- `src-tauri/src/widgets.rs`, `background.rs`, `lib.rs` spawn sites, and the
  commands that configure all of the above (`commands/playback.rs`,
  `commands/auth.rs`, `commands/prefs.rs`, `commands/system.rs`)

Documented, deliberate decisions in `CLAUDE.md` and in the modules' own header
comments are not reported as defects. Where a finding touches one, the
verification note says so and the severity reflects it.

## Detection sources at a glance

"Can be paused-blind?" means: can this source report a *paused* player as if it
were playing, so the scrobbler's clock keeps running? A "no" for the media
session backends is not a compliment — there a pause makes the source report
nothing at all, which is B3-01.

| Source | Platform | Reports play state? | Reports position? | Can be paused-blind? | Findings affecting it |
| --- | --- | --- | --- | --- | --- |
| mpv IPC | Windows + Linux (`connect` is cfg'd; the `mobile` arm returns `Unsupported`, so Android never has a pipe) | Yes — the `pause` property (`mpv_ipc.rs:39`, request id 5) is returned beside the candidate by `detect` and used by `detect_playback` to demote a paused pipe to last resort | Yes — `time-pos` → `position_sec` and `duration` → `duration_sec` (`playback_from_state`, mpv_ipc.rs:130-150) | No — pausedness is read, and the reported position freezes, so `position_due` stops the clock. `Playback` itself carries no paused flag, so downstream the frozen position is the only signal | B3-04, B3-06 |
| Jellyfin `/Sessions` | Windows, Linux and Android (the only source on Android) | **No** — `playback_from_session` reads `PlayState.PositionTicks` (jellyfin.rs:635-638) and never `IsPaused` | Yes — `PositionTicks` and `RunTimeTicks`, both off the payload the poll already fetches | **Yes** — a paused session is reported as current playback, deliberately for the single-session case (jellyfin.rs:592-594); the frozen position then makes `position_due` answer `Some(false)` forever | B3-06, B3-07, B3-08, B3-21 |
| Win32 window titles | Windows only — `enumerate_windows` is `Vec::new()` on every other platform (detection/mod.rs:66-73) | **No** — a title carries no state, and `IsWindowVisible` (detection/mod.rs:76) is true for minimized windows | **No** — every `detect_windows` branch sets `position_sec: None` (detection/mod.rs:142-185), as the struct field documents (`:45-48`) | **Yes**, completely — a paused or minimized player is indistinguishable from a playing one and the wall clock alone matures `update_at` | B3-02, B3-17 |
| SMTC (media session, Windows) | Windows only | Yes — the OS session status, but only `"playing"` passes `MediaSession::is_playing` (media_session/mod.rs:84-86), and `watchable` filters both tiers on it | **No** — `smtc.rs` reads no timeline property, and `playback_from` hard-codes `position_sec: None` / `duration_sec: None` (media_session/mod.rs:262-266, :306-310) | No — the opposite failure: a pause makes the rung report nothing, and the scrobble session is destroyed on that one tick | B3-01, B3-11, B3-17 |
| MPRIS (media session, Linux) | Linux only | Yes — `PlaybackStatus` from `GetAll`, lower-cased onto SMTC's vocabulary (mpris.rs:160-165) | **No, though it is already on the wire** — the same `GetAll` reply carries `Position`, and `Metadata` carries `mpris:length`; neither is mapped (B3-19) | No — same as SMTC: paused yields nothing and the session is dropped | B3-01, B3-11, B3-19 |

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
| --- | --- | --- | --- | --- |
| B3-01 | P1 | BUG | src-tauri/src/playback/scrobbler.rs:1213 | One tick with nothing detected destroys the scrobble session, so an ordinary pause resets the whole wall-clock threshold on media-session-only players |
| B3-02 | P3 | DATA INTEGRITY RISK | src-tauri/src/playback/detection/mod.rs:142 | The window-title rung sees no play state, so a paused or minimized player still matures the wall clock and writes progress |
| B3-03 | P3 | DATA INTEGRITY RISK | src-tauri/src/commands/auth.rs:206 | `anilist_logout` leaves the `notifications` table and the alert dedupe keys behind, so account B sees A's bell rows and misses its own notifications |
| B3-04 | P3 | BUG | src-tauri/src/playback/detection/mpv_ipc.rs:130 | The mpv IPC rung has no media-kind filter, so a music file outranks every other source |
| B3-06 | P3 | BUG | src-tauri/src/playback/scrobbler.rs:1148 | A source-reported position past two thirds fires an armed episode-gap block immediately, bypassing the five-minute grace the setting promises |
| B3-07 | P3 | BUG | src-tauri/src/playback/detection/jellyfin.rs:706 | Jellyfin session selection ignores `IsPaused` and takes the server's first match, so a stale paused session can suppress scrobbling entirely |
| B3-09 | P3 | ARCHITECTURAL PROBLEM | src-tauri/src/playback/relations.rs:116 | The relations loader is an unsupervised one-shot, and `redirect` with zero rules silently passes the unredirected episode through |
| B3-18 | P3 | BUG | src-tauri/src/playback/scrobbler.rs:1145 | `scrobble_enabled` is read only when a session is created, so switching automatic scrobbling off mid-episode still lets the armed session write |
| B3-19 | P3 | IMPROVEMENT | src-tauri/src/playback/detection/media_session/mpris.rs:153 | MPRIS discards a position it has already fetched, leaving Linux detection on the wall clock for no round-trip saving |
| B3-05 | P4 | SECURITY RISK (privacy) | src-tauri/src/discord.rs:140 | The Discord presence's content-filter guard falls open for unmatched detections and broadcasts the raw parsed title |
| B3-08 | P4 | DATA INTEGRITY RISK | src-tauri/src/playback/detection/jellyfin.rs:740 | `LAST_GOOD` survives a Jellyfin sign-out, so a failed first poll after a different sign-in can replay the previous account's playback |
| B3-10 | P4 | BUG | src-tauri/src/alerts/airing.rs:262 | The non-truncated airing checkpoint shares its second with two strict bounds, potentially losing one notification per boundary |
| B3-11 | P4 | BUG (platform divergence) | src-tauri/src/playback/detection/media_session/mod.rs:106 | SMTC's verbatim `"music"` label and MPRIS's inferred `"unknown"` reach different verdicts in `is_watchable` for the same browser session |
| B3-12 | P4 | BUG (observability) | src-tauri/src/logging.rs:443 | A background loop that gives up after five panics, and a panicking detection sweep, have no user-visible signal beyond a log line |
| B3-13 | P4 | BUG | src-tauri/src/discord.rs:38 | `RESEND_SECS` has no periodic caller, so a Discord restart mid-episode drops the presence until the next title or page change |
| B3-14 | P4 | IMPROVEMENT | src-tauri/src/alerts/notify.rs:238 | Each Linux confirm toast parks an OS thread with no timeout and no handle kept |
| B3-15 | P4 | IMPROVEMENT | src-tauri/src/widgets.rs:296 | `widgets::clear()` deletes the projection without poking the refresher, so the home-screen widgets keep the signed-out account's titles |
| B3-16 | P4 | CODE SMELL | src-tauri/src/playback/scrobbler.rs:847 | The `Relations` `RwLock` bypasses `sync::LockExt`, the one idiom that keeps a poisoned lock from becoming a permanent outage |
| B3-17 | P4 | DOCUMENTATION ISSUE | src-tauri/src/i18n.rs:181 | The tray item labelled "Media detection" toggles only the media-session rung; three other sources keep detecting |
| B3-20 | P4 | DATA INTEGRITY RISK | src-tauri/src/alerts/stale.rs:136 | `stale_done:` is a third account-less dedupe key with the same logout lifetime problem as B3-03's |
| B3-21 | P4 | BUG | src-tauri/src/playback/detection/jellyfin.rs:753 | `hold_last_good` replays a frozen position for up to three ticks, feeding the scrobbler a stale verdict rather than no verdict |

---

ID: B3-01
Severity: P1
Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs
Line: 1213 (the `_ =>` arm of `drive_session`), with 1094-1131 and 1115
Function: `drive_session`, together with `media_session::watchable` / `MediaSession::is_playing`

Problem:
The scrobble session is destroyed on the *first* tick in which detection reports
nothing, and a new session re-arms its wall clock from `Instant::now()`. The
media-session rung reports nothing whenever the desktop session is not exactly
`"playing"` (`is_playing`, media_session/mod.rs:84-86, filtered in both tiers of
`watchable`, :176-190). For a player that is only visible through the system
media session — Jellyfin Media Player is the module's own motivating case, "its
title never changes, so it was invisible to detection" — a plain **pause**
therefore erases all accumulated watch time.

Expected Behavior:
Pausing an episode for a minute should pause the scrobble clock, not reset it.
Both other rungs are careful about exactly this: the Jellyfin API rung keeps
paused sessions ("Paused still counts as 'what you're watching' … a pause
shouldn't drop the session", jellyfin.rs:592-594) and the mpv IPC rung keeps a
paused pipe as a candidate (mpv_ipc.rs:120-129).

Actual Behavior:
1. Tick N: SMTC/MPRIS reports `status = "paused"`. `watchable` yields nothing,
   `media_session::detect` returns `None`, and `detect_playback` has no fallback
   below it except a paused mpv IPC pipe, so the sweep returns `None`.
2. The poll loop sees `raw != last_raw` and writes `PlaybackState = None`
   (scrobbler.rs:1039-1061).
3. `drive_session` falls into the `_` arm (scrobbler.rs:1213-1219), sets
   `*guard = None` and emits `idle`. The `Session` — and with it `update_at` —
   is gone.
4. On resume a brand-new `Session` is built (1100-1131) with
   `update_at = Instant::now() + threshold` (1115). No watch time carries over.
Because `playback_from` sets `position_sec: None` (media_session/mod.rs:265,
:311), `position_due` returns `None` here (scrobbler.rs:661) and the wall clock
is the only clock there is.

Reproduction:
Windows, Jellyfin Media Player (or any SMTC-only player), a 24-minute episode
(threshold = 2/3 = 16 min), "Use system media info" on, Jellyfin API source not
configured. Watch 10 minutes, pause for 5 seconds, resume, watch the remaining
14 minutes. The episode ends before 16 further continuous minutes elapse, so no
scrobble ever happens and the phase never leaves `watching`.

Impact:
Automatic scrobbling is unreliable for the whole class of players the
media-session pass exists to cover, and unreliable in the most ordinary way a
user watches (pause for a drink, a phone call, an ad). The failure is silent:
the card simply goes idle and comes back, and nothing says the clock restarted.
On Linux the window rung is empty by construction (detection/mod.rs:66-73), so
MPRIS is the whole of generic local detection there: pausing *any* Linux player
without an mpv IPC pipe resets the threshold.

Root Cause:
"What is playing right now" (a per-tick fact, correctly `None` while paused) and
"which session is being timed" (a fact that should survive a gap) are the same
variable. `is_same` (scrobbler.rs:1096-1098) only helps while a session is
alive. The Jellyfin rung grew a hold for the identical problem
(`HOLD_TICKS`/`hold_last_good`, jellyfin.rs:732-775) but that hold is local to
one source; the session state machine has no equivalent.

Recommended Fix:
Give the session a grace of a few ticks before it is dropped — e.g. keep the
`Session` (and its `update_at`) while `PlaybackState` is `None` for fewer than N
consecutive ticks, dropping it only after that, or freeze and resume the
remaining duration rather than recomputing from `Instant::now()`. Whichever
shape, the timer must not restart because a source blinked. B3-19 (surfacing the
MPRIS position that is already fetched) is the cheapest independent mitigation
on Linux, since a real position makes pausing stop the clock instead of
resetting it.

Regression Tests Required:
- A pure test over the session lifecycle: session armed at T, one (and two, and
  three) ticks of `None`, then the same `(media_id, episode)` again — the
  remaining time must be within a tick of what it was, not the full threshold.
- A test that a *different* `(media_id, episode)` after the gap still starts a
  fresh session.
- A test that a long absence (past the grace) does end the session, so a stopped
  episode still goes idle.

Confidence: HIGH

---

ID: B3-02
Severity: P3
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/playback/detection/mod.rs
Line: 142-185 (`detect_windows`), consumed at scrobbler.rs:1115 and 1148-1158
Function: `detect_windows` / `drive_session`

Problem:
The window-title rung reports playback purely from a window's existence and its
title. It cannot see play state, and it reports no position, so the scrobbler
arms and fires its wall-clock threshold against a player that is paused, stopped
at a frame, or simply left open in the background. `IsWindowVisible`
(detection/mod.rs:76-79) is true for minimized windows as well.

Expected Behavior:
Progress should only be written for an episode that was actually played for the
threshold duration.

Actual Behavior:
mpv/VLC/MPC-HC left open on `[Group] Show - 05.mkv`, paused or minimized, is
returned by `detect_windows` on every tick. `raw` never changes, the session is
never rebuilt, `update_at` matures, `position_due` returns `None` (every
`detect_windows` branch sets `position_sec: None`), and the wall clock alone
decides: `perform_update` writes progress 5 to AniList and patches the local
cache.

Reproduction:
Open episode 5 in mpv (IPC *not* configured, so the window rung serves), pause
it after two minutes, leave the machine for twenty. The list is set to episode 5
without the episode having been watched.

Impact:
A wrong list write — progress advanced for content the user did not watch — and
one that also silences the real episode later, because `block_reason` will then
report `AlreadyWatched` for it (scrobbler.rs:611-613). This is the one
irreversible direction: `would_regress` (712) refuses to put the number back.
Mitigated by the fact that the user did open the episode, and by the "ask before
updating" setting for people who want a gate.

Root Cause:
`detect_playback`'s ranking fix for a stale paused player was applied to the mpv
IPC rung only ("an mpv window left paused an hour ago sat at the top of this
order forever", detection/mod.rs:198-208). The window rung has the same failure
mode and no equivalent guard, because a window title carries no play state at
all.

Recommended Fix:
No fix exists from a title alone, and the trade is documented, so this is new
machinery rather than a missing guard: cross-check the media-session list for a
*paused* session belonging to the same short app name before letting the wall
clock advance. `short_app_name` (media_session/mod.rs:154) already normalises
both sources to the same shape.

Regression Tests Required:
- A pure test of whatever "is this tick watch time" predicate is introduced:
  paused-session-for-the-same-process must not accumulate.
- Keep a test that a player reporting nothing at all (no media session) still
  scrobbles on the wall clock, so the fallback is not lost.

Confidence: HIGH on the mechanism; the frequency of "paused and walked away" is
a judgement about users, not code.
Verification: downgraded from P2 — the position-free window source is a
documented, deliberate trade (`Playback::position_sec`, detection/mod.rs:45-48,
and `position_due`'s own doc at scrobbler.rs:648-652 naming the paused-player
case), the user did open that episode, and the confirm setting exists as the
gate; the suggested cross-check is new machinery, not an omitted guard.

---

ID: B3-03
Severity: P3
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/commands/auth.rs
Line: 206-213 (`anilist_logout`), with db.rs:1113-1135 and alerts/airing.rs:214-254
Function: `anilist_logout`, `Db::notif_all`, `airing::check`, `sequel::check`

Problem:
Account B sees account A's Karasu-written bell rows. The `notifications` table
has no user column, `notif_all` (db.rs:1113-1135) filters on nothing but a
limit, and `anilist_logout` clears the token, the cached viewer and the widget
projection but *not* the notifications table. The same is true of the alert
dedupe keys.

Expected Behavior:
Signing out should leave nothing behind that describes the previous account's
list — the same rule `widgets::clear()` was added for on the line above ("the
widget projection holds this account's titles and must not outlive it",
auth.rs:209-211) — and a new account should get its own notifications.

Actual Behavior:
Two distinct consequences, both traced:
1. **Leakage.** Rows written by the airing, stale and sequel passes carry
   account A's titles ("New episode — <title> Ep 5") and, since schema v15, A's
   `media_id`. They survive `anilist_logout` and are rendered by `notif_all(100)`
   (commands/system.rs:660) to account B, whose bell now links into media A was
   watching.
2. **Missed notifications.** The airing dedupe key is
   `aired:{media_id}:{episode}` (airing.rs:214) and the sequel key is
   `sequel_seen:{node_id}` (sequel.rs:214) — neither carries a user. Within the
   30-day `AIRED_KEY_TTL_SECS` (and forever for `sequel_seen:`, which is never
   pruned), account B is *not* notified about any episode or sequel account A
   was already notified about. `airing_last_check` and `site_notif_seen_id` are
   likewise global cursors that carry over. Nothing else clears them —
   `notif_clear_kind` is used only for the update notice
   (commands/update.rs:328). See also B3-20 for the third such key.

Reproduction:
Sign in as A, let the airing pass fire (or wait for any bell row), sign out, sign
in as B. The bell still lists A's rows. Then let an episode air that A was
already told about while both accounts follow the show — B gets nothing.

Impact:
Local, same-OS-user leakage into a read-only surface plus one silently missed
notification per already-notified episode. Both halves are bounded and
self-healing (the 500-row `NOTIF_KEEP` trim, the 30-day `aired:` TTL).

Root Cause:
Sign-out cleanup was extended per-artifact (token, viewer, widgets) rather than
as a rule; the notification store and the alert dedupe vocabulary were never
account-scoped.

Recommended Fix:
Either give `notifications` and the `aired:`/`sequel_seen:`/`stale_done:` keys a
user id (a migration, matching v16's shape), or clear them in `anilist_logout`
the way `widgets::clear()` is called. Clearing is the smaller change and loses
nothing of value: these rows expire at 500 and are read the day they arrive. The
dedupe keys must be cleared with them or the second half of the bug survives.

Regression Tests Required:
- `Db` test: a logout helper removes every `notifications` row and every
  `aired:`/`sequel_seen:`/`stale_done:` key, and leaves unrelated kv untouched.
- A test pinning that a fresh viewer id sees an empty bell.

Confidence: HIGH
Verification: downgraded from P2 — unlike the v16 `offline_queue` precedent it
invokes, nothing here *writes* to account B; B only reads stale local rows and
may miss a notification, and both halves are bounded and self-healing.

---

ID: B3-04
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/detection/mpv_ipc.rs
Line: 130-150 (`playback_from_state`), ranked at detection/mod.rs:216-222
Function: `playback_from_state` / `detect_playback`

Problem:
The mpv IPC rung applies no media-kind filter at all: any file mpv has open
becomes a `Playback`, and a *playing* pipe returns from `detect_playback`
immediately, before Jellyfin, the window pass and the media-session pass are
even consulted. The media-session module maintains `AUDIO_EXTENSIONS`
(media_session/mod.rs:42-46) precisely to keep music out of detection; mpv_ipc
never consults it, and mpv is a common music player.

Expected Behavior:
A music file (or any obviously non-video file) playing in mpv should not
suppress a video source further down the ranking.

Actual Behavior:
`state.path = "/music/album/03 - Track.flac"` → `file_name` returns the name →
`playback_from_state` returns `Some(Playback)` with `paused = false` →
`detect_playback` returns it at detection/mod.rs:217-221 and never reaches
Jellyfin or the media session. Detection reports the track, matching fails, the
now-playing card shows a music file, and the Jellyfin episode actually playing
elsewhere is invisible for as long as the music does. The inconsistency is
provable inside one tree: the same `.flac` seen through MPRIS infers `"music"`
(media_session/mod.rs:224-244) and is dropped, while through the IPC pipe it
wins the whole sweep.

Reproduction:
Enable "Ask mpv directly", play any `.flac`/`.mp3` in mpv, and start an episode
on Jellyfin from the same account. The card shows the track.

Impact:
Scrobbling silently stops for the duration of a music session — precisely the
"an mpv window … hides the episode you are streaming right now" failure the
paused-mpv demotion was written to fix (mpv_ipc.rs:120-129), reappearing for
playing-but-irrelevant content. Bounded to users who configured an IPC pipe,
which is an opt-in feature.

Root Cause:
The pausedness demotion in `detect_playback` treats "is mpv the right answer" as
a function of play state only; the *kind* of what it is playing is never asked,
although the vocabulary for asking already exists one module away.

Recommended Fix:
In `playback_from_state`, return `None` (or mark the candidate as non-video, to
be demoted like the paused one) when the path's extension is in
`media_session::AUDIO_EXTENSIONS`. Reuse that constant rather than a second
list, the way `VIDEO_EXTENSIONS` is already shared (profiles.rs:21-24) — note it
carries `cfg_attr(not(target_os = "linux"), allow(dead_code))`, so sharing it
means relaxing that attribute.

Regression Tests Required:
- `playback_from_state` with `.flac`/`.mp3`/`.opus` paths yields nothing.
- `.mkv` and an extensionless streaming `media-title` still yield a candidate
  (the existing `the_file_name_beats_the_composed_title_and_a_url_does_not` test
  must keep passing).

Confidence: HIGH

---

ID: B3-06
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs
Line: 1148-1158, against `auto_arm` at 580-596 and `GAP_GRACE` at 570
Function: `drive_session`

Problem:
`auto_arm` deliberately arms an episode-gap block at `threshold.max(GAP_GRACE)`
so that "five minutes of simply continuing to watch" is what lifts the block.
The due check then overrides that entirely when the source reports a position:
`position_due(...).unwrap_or_else(wall clock)` returns `Some(true)` as soon as
the position is past two thirds of the file, regardless of how long the session
has existed.

Expected Behavior:
An episode-gap block auto-lifts only after at least five minutes of watching,
which is what the setting's own hint promises ("five minutes of watching counts
as being sure", src/i18n/en.ts:1354, de.ts:1355).

Actual Behavior:
Jellyfin (and mpv IPC) resume playback at the stored position. If that position
is already past 2/3 — an episode previously watched to 80% and resumed, a
deliberate seek, a mis-clicked "resume" — then on the *second* tick of the
session (about five seconds after detection) `due` is true, the phase moves to
`Updating` and `perform_update` writes the gap-jumping progress.

Reproduction:
With "Track past an episode gap" on and Jellyfin configured: list progress 2,
resume episode 9 at 80% in Jellyfin. Progress 9 is written within about five
seconds instead of five minutes.

Impact:
A forward jump over several episodes lands on the list without the grace period
that exists to let a mis-click be walked away from. `would_regress` (712)
permits it because it moves forward, and undoing it means editing the entry by
hand.

Root Cause:
Two independent notions of "due" — a duration to wait and a fraction of the file
— are combined by letting the position win unconditionally, without asking
whether the *reason* for the wait was elapsed time rather than progress.

Recommended Fix:
Make the position verdict subject to the arming deadline for gap blocks: for
`Phase::Blocked(BlockReason::EpisodeGap { .. })` require both the position
verdict and `Instant::now() >= update_at`. `Phase::Watching` keeps today's
behaviour.

Regression Tests Required:
- A pure test: gap block armed at T+5min, position already past 2/3 → not due
  before T+5min, due after.
- The existing two-thirds behaviour for `Watching` (pinned at
  scrobbler.rs:1404-1407) must be unchanged.

Confidence: HIGH

---

ID: B3-07
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/detection/jellyfin.rs
Line: 583-673 (`playback_from_session`) and 706-712 (`detect`)
Function: `playback_from_session` / `detect`

Problem:
Session selection is "the first entry in the server's array that passes the
user/device filter and maps" (`find_map`, :711). `PlayState.IsPaused` is never
read — the mapping reads `PlayState.PositionTicks` two lines away (:635-638) and
ignores the pause flag beside it — and the array order from `/Sessions` is not
specified by Jellyfin.

Expected Behavior:
When one of the user's own sessions is playing and another is merely holding a
paused item, the playing one should be reported.

Actual Behavior:
Both sessions carry a `NowPlayingItem`, both pass `session_matches` when the
device filter is empty (the documented default, "any device of that user"), and
whichever the server lists first wins. If that is the paused one, detection
reports it — and because it supplies a `position_sec` that never moves,
`position_due` (scrobbler.rs:653-668) returns `Some(false)` on every tick, which
*suppresses the wall-clock fallback* (`unwrap_or_else`, scrobbler.rs:1150-1158).
Nothing is ever scrobbled for as long as the stale session exists.

Reproduction:
Pause an episode in jellyfin-web and leave the tab open; start another episode on
a second device with the same Jellyfin account and no device filter set. Whether
detection follows the right one depends on server ordering, and when it does not,
the correct episode never scrobbles.

Impact:
Scrobbling silently stops, and the now-playing card names the wrong episode. The
`hold_last_good` machinery cannot help — the poll succeeded, it just answered
with the wrong session.

Root Cause:
"Paused still counts as what you're watching" (:592-594) is right for a *single*
session and was never revisited for the multi-session case the device filter's
"any device" default makes ordinary.

Recommended Fix:
Rank matched sessions before mapping: prefer `PlayState.IsPaused == false`, then
fall back to a paused one, mirroring `media_session::watchable`'s two-tier
iterator and `detect_playback`'s paused-mpv demotion. Read `IsPaused` through
`get_ci` like every other field in the file.

Regression Tests Required:
- `detect`-level (or an extracted pure `pick_session`) test: a paused session
  listed first and a playing one second → the playing one is chosen.
- A single paused session with nothing else is still reported (keeps :592-594
  true).

Confidence: MEDIUM-HIGH — the code path is certain; how often a user has two of
their own sessions holding a `NowPlayingItem` is the uncertain part.

---

ID: B3-09
Severity: P3
Category: ARCHITECTURAL PROBLEM

File: /home/user/Karasu/src-tauri/src/playback/relations.rs
Line: 116-194 (`spawn_loader`), consumed at scrobbler.rs:498-515
Function: `spawn_loader` / `relations::redirect`

Problem:
The anime-relations loader is the one long-lived-ish background task spawned
with a bare `tauri::async_runtime::spawn` (lib.rs:385) rather than
`logging::supervise`, which every other loop at lib.rs:386-406 uses. It is also
one-shot: every failure path `return`s — dir creation (:127), client build
(:157), fetch (:165), body read (:172), empty parse (:180) — and nothing retries
before the next app start.

`redirect` with no rules silently passes the wrong episode through: on an empty
slice it returns `None` (relations.rs:105-112) and `build_now_playing` keeps
`parsed.episode` unchanged. Nothing distinguishes "no rule applies" from "no
rules are loaded", nothing is logged, and the card shows the unredirected number
as if it were authoritative.

Expected Behavior:
Either the rules load, or the fact that they did not is visible somewhere a user
or a bug report can see.

Actual Behavior:
On a fresh install with no cached `anime-relations.txt`, a first launch without
network leaves `Relations` empty for the entire session — the fetch failure logs
a `warn` and returns, and the loader is never re-entered. A combined release
numbered 26-51 then scrobbles episode 26+ against the season-1 entry instead of
being redirected to the sequel's episode 1. The write passes `block_reason` (no
gap: the numbers are contiguous) and `would_regress` (it moves forward). The
Android panic recorded in the loader's own comment (:152-157) is precedent that
this task really does die.

Reproduction:
Delete `anime-relations.txt` from the data dir, start offline, play a file whose
episode number needs a redirect (e.g. FMA:B numbering, rule
`1575:26-51 -> 2759:1-26` in the sample fixture). Progress is written to 1575.

Impact:
Wrong progress on the wrong entry, silently, for a whole session — for exactly
the releases the relations file exists to handle. A panic in the loader (it uses
`.write().unwrap()`, :140 and :193) would produce the same end state with no
supervisor to notice.

Root Cause:
The loader is treated as a startup one-shot rather than as a dependency of a
correctness-critical transform, and the transform has no "rules unavailable"
state to report.

Recommended Fix:
Retry the fetch on a schedule (or at least once more after a delay) and put the
task under `supervise` for uniformity; log once, at `warn`, when a redirect is
attempted with zero rules loaded, so the log says why an episode was not
redirected. A count of loaded rules in the diagnostics report would make it
reportable.

Regression Tests Required:
- An explicit `redirect(&[], id, ep) == None` test plus a `rules_loaded()`-style
  accessor test, so the "empty" state is nameable.
- A test that the loader records the empty state when parsing yields nothing.

Confidence: HIGH

---

ID: B3-18
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs
Line: 1145-1158, against 1107 (`auto_arm(settings.enabled, …)`)
Function: `drive_session`

Problem:
`settings.enabled` (the "scrobble automatically" master switch) is consulted only
when a session is *created*. The armed test on an existing session reads
`session.update_at.is_some()` and the phase — and, for a gap block,
`settings.gap_auto` — but never `settings.enabled`; `perform_update`
(scrobbler.rs:716-780) does not check it either. Turning automatic scrobbling
off mid-episode therefore still lets the already-armed session write to AniList
up to a full threshold later.

Expected Behavior:
The master switch behaves like the grace switch beside it. The comment three
lines above the check states the intended rule: "the settings are re-read every
tick, so switching the grace off disarms a waiting gap immediately".

Actual Behavior:
1. An episode is detected while automatic scrobbling is on; `auto_arm` returns
   `Some(threshold)` and `update_at` is set (scrobbler.rs:1107, :1113-1115).
2. The user opens Settings and turns automatic scrobbling off. Nothing touches
   the live session — the phase is unchanged and `update_at` is still `Some`.
3. On the tick where `update_at` matures (or where the source position crosses
   two thirds), `armed` is `true` because `Phase::Watching => true`, `due` is
   `true`, and `perform_update` writes progress to AniList and patches the cache.

Reproduction:
Start an episode with automatic scrobbling on, turn the setting off a minute in,
keep watching past the threshold. The list is updated anyway.

Impact:
An unwanted write to the user's AniList list, after the user explicitly switched
the feature off — the same class of unwanted write as B3-02 and B3-06, but this
one directly contradicts an explicit user action taken during the episode.

Root Cause:
Arming and firing read different snapshots of the same settings object: arming
is a creation-time decision, firing re-reads the settings every tick but only
consults `gap_auto` out of them.

Recommended Fix:
Include `settings.enabled` in the per-tick `armed` test alongside the phase check
(and, defensively, in `perform_update`), so the master switch disarms a waiting
session exactly as `gap_auto` disarms a waiting gap block.

Regression Tests Required:
- A pure test over the armed/due predicate: session armed while enabled, then
  `enabled = false` → not due at or past `update_at`; re-enabling makes it due
  again.
- The existing `gap_auto` disarm behaviour must be unchanged.

Confidence: HIGH
Source: found during adversarial verification

---

ID: B3-19
Severity: P3
Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/playback/detection/media_session/mpris.rs
Line: 153-160 (`GetAll`), with media_session/mod.rs:262-266 and :306-310
Function: `read_sessions` / `playback_from`

Problem:
MPRIS discards a position it has already fetched. `read_sessions` calls `GetAll`
on `org.mpris.MediaPlayer2.Player` — one round trip, chosen deliberately for
that reason — and the reply carries `Position` alongside `PlaybackStatus` and
`Metadata` (whose `mpris:length` is the duration). Neither is read: only
`PlaybackStatus`, `Metadata`'s title/artist/album and `xesam:url` are mapped, the
`MediaSession` struct has no position field, and `playback_from` hard-codes
`position_sec: None` / `duration_sec: None`.

Expected Behavior:
A source that already has the real clock should hand it to the scrobbler, which
was built to prefer it (`position_due`, scrobbler.rs:645-668).

Actual Behavior:
Linux detection through MPRIS always falls back to the wall clock, with all the
consequences that follow from it: the pause reset in B3-01, and the paused/
minimized advance in B3-02's shape wherever a player keeps a session alive.

Reproduction:
Play an episode in any MPRIS-publishing player on Linux and inspect the
now-playing state: `positionSec` and `durationSec` are null, although
`busctl --user get-property … Position` answers for the same player.

Impact:
The cheapest available mitigation of B3-01 on Linux is left on the table, at
zero extra round trips — with a real position, pausing stops the number instead
of destroying the session's clock, which is exactly the behaviour
`position_due`'s doc describes.

Root Cause:
`MediaSession` was modelled on what SMTC publishes (which has no position in the
properties `smtc.rs` reads), and the MPRIS backend was written to fill the same
struct rather than to expose what it additionally knows.

Recommended Fix:
Add optional `position_sec` / `duration_sec` to `MediaSession`, populate them in
`read_sessions` from `Position` (microseconds) and `Metadata`'s `mpris:length`
(microseconds), and pass them through both `playback_from` branches. SMTC keeps
leaving them `None`, so the shared decision code is unchanged.

Regression Tests Required:
- A pure test over the microsecond → second conversion, including a missing and
  a zero `Position`.
- A `playback_from` test that both branches (local file and composed title)
  carry the position through, and that a session without one still yields
  `None` rather than `Some(0)`.

Confidence: HIGH
Source: found during adversarial verification

---

ID: B3-05
Severity: P4
Category: SECURITY RISK (privacy)

File: /home/user/Karasu/src-tauri/src/discord.rs
Line: 139-144, with 149-154
Function: `sync`

Problem:
The content-filter guard on the Discord presence is keyed on `media_id` and
falls open for anything unmatched:
`np.media_id.map(|id| !media_id_blocked(...)).unwrap_or(true)`. An unmatched
detection has no id, so it is never checked — and the presence then publishes
`np.parsed_title`, i.e. the raw parsed window/file title, to everyone who can
see the user's Discord profile.

Expected Behavior:
The comment two lines above states the rule: "Never broadcast a title the user's
content filter hides — the presence is the one surface other people see, so it
matters most here."

Actual Behavior:
An unmatched detection takes the `unwrap_or(true)` branch and its raw parsed
title — which for a local file is a release name off the user's filesystem —
reaches the presence verbatim.

Reproduction:
Play any local video that is not on the AniList list (mpv/VLC, or via mpv IPC)
with Discord presence on. The presence reads `Watching <filename as parsed>`.

Impact:
A gap between the comment's stated rule and the code. The disclosure is not
undoable, but it is on an opt-in feature (`discord_enabled` defaults off) and
the unmatched case is by design what the presence broadcasts.

Root Cause:
The filter was written against matched entries, and the unmatched case was given
the permissive default without the decision being recorded.

Recommended Fix:
Decide the unmatched case explicitly and write the decision next to the comment.
The conservative reading of the stated rule is: when the content filter is not
`off` and the detection is unmatched, fall back to the idle presence (as the
matched-and-blocked branch already does), or show a generic "Watching something"
rather than the raw title. A setting ("only show matched titles") would also
close it and is a one-line kv.

Regression Tests Required:
- A pure test over the presence-eligibility predicate: unmatched + filter on →
  whatever is decided; unmatched + filter off → broadcast; matched + blocked →
  not broadcast (pins today's behaviour).

Confidence: MEDIUM
Verification: downgraded from P3 — the severity rested on the premise that adult
content is "most likely unmatched", which is not substantiated: adult titles
exist on AniList and a user tracking them has them on the list, where
`media_id_blocked` (commands/prefs.rs:200-225) classifies them correctly. The
filter cannot classify a title it has no id for, so the unmatched case is a
product decision rather than a missing guard, on an opt-in feature.

---

ID: B3-08
Severity: P4
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/playback/detection/jellyfin.rs
Line: 740 (`LAST_GOOD`), 743-775, against commands/playback.rs:402-409
Function: `remember` / `hold_last_good` / `jellyfin_sign_out`

Problem:
`TOKEN_CACHE` is correctly invalidated on both sign-in and sign-out
(`set_cached_token`), and a test pins it
(`signing_in_or_out_replaces_what_was_cached`). The *other* process-wide
Jellyfin state, `LAST_GOOD`, is not: neither `delete_token` (:206-213) nor
`jellyfin_sign_out` (commands/playback.rs:402-409) clears it.

Expected Behavior:
Signing out of a Jellyfin account should drop everything remembered about that
account's playback, exactly as the token is dropped.

Actual Behavior:
After sign-out `jellyfin_config` returns `None` (commands/playback.rs:93-108) so
the rung is skipped, but `LAST_GOOD` still holds the last `Playback` observed
for the previous account, with `used = 0`. On the next sign-in — possibly as a
*different* Jellyfin user on the same server — the first `/Sessions` request
that fails (a timeout, a proxy hiccup) calls `hold_last_good()`, which hands
that stale playback back as the current answer for up to three ticks.

Reproduction:
Sign in as Jellyfin user A, play an episode, sign out, sign in as user B, and
have the first poll time out. Detection reports A's episode; if it matches an
entry on the AniList list it starts a scrobble session against it.

Impact:
A cross-account (Jellyfin-side) leak into the now-playing card and, in the worst
case, a scrobble for something the signed-in user did not watch. Reachability is
narrow: it needs live playback at sign-out, a *different* account signing in, and
that account's very first poll to fail — then at most three ticks before
`remember` overwrites it.

Root Cause:
`hold_last_good` was designed around "the server hiccupped mid-episode" and the
memory's lifetime was tied to poll outcomes only, never to the account it
describes.

Recommended Fix:
Clear `LAST_GOOD` in `delete_token` (and in `save_token`, so a re-sign-in also
starts clean), next to `set_cached_token`.

Regression Tests Required:
- After `remember(Some(p))` followed by the sign-out path, `hold_last_good()`
  returns `None`. (The existing `HOLD_STATE` serialisation idiom at :820
  applies.)

Confidence: HIGH on the mechanism, MEDIUM on the timing
Verification: downgraded from P3 — while signed out the rung never runs, so the
stale value surfaces only through a three-condition coincidence and for at most
three ticks.

---

ID: B3-10
Severity: P4
Category: BUG

File: /home/user/Karasu/src-tauri/src/alerts/airing.rs
Line: 28 (`AIRING_QUERY`), 262 (`checkpoint`)
Function: `check`

Problem:
The window is `airingAt_greater: from` / `airingAt_lesser: to`, and on the
non-truncated path the checkpoint is set to the very same `now` used as `to`. If
`airingAt_lesser` is exclusive, an episode whose `airingAt` is exactly the
checkpoint second falls between the two windows and is never notified.

Expected Behavior:
Every airing schedule is covered by exactly one window; consecutive windows must
overlap or abut inclusively.

Actual Behavior:
Window k asks for `airingAt < now`; the checkpoint becomes `now`; window k+1
asks for `airingAt > now`. The truncated branch already steps back a second
(`reached.saturating_sub(1)`, :262) with a comment explaining that the `aired:`
keys absorb the resulting overlap — the non-truncated branch does not.

Reproduction:
Not reproducible by hand: it needs an `airingAt` equal to the exact second the
pass ran. Stated as a code-level asymmetry, both bounds and the shared `now`
being visible in the same function.

Impact:
At worst one missed episode notification, at a probability of roughly one second
per 20-minute window per schedule, and only if `_lesser` is exclusive.

Root Cause:
The `-1` safeguard was reasoned about only for the truncation branch.

Recommended Fix:
Use `now - 1` on both branches — the `aired:` dedupe keys already make an
overlapping window free.

Regression Tests Required:
- A pure test over the checkpoint decision: given a page shorter than
  `PAGE_SIZE`, the stored checkpoint is strictly less than the `to` bound used
  for that request.

Confidence: LOW
Verification: downgraded from P3 — the defect exists only if `airingAt_lesser`
is exclusive, which the file evidences for `_greater` only and which could not
be measured (AniList is unreachable from the audit sandbox); if `_lesser` is
inclusive there is no gap at all, only an overlap the `aired:` keys absorb.

---

ID: B3-11
Severity: P4
Category: BUG (platform divergence)

File: /home/user/Karasu/src-tauri/src/playback/detection/media_session/mod.rs
Line: 106-120 (`is_watchable`), against smtc.rs:81-90 and mpris.rs:183
Function: `MediaSession::is_watchable`

Problem:
The two backends supply `playback_type` from different authorities, and the
shared decision treats them as one vocabulary. SMTC hands over the OS's own
`MediaPlaybackType` verbatim; MPRIS has no such property in its `GetAll` reply
and infers one, deliberately defaulting to `"unknown"` rather than guessing
(`infer_playback_type`, mod.rs:224-244). The music carve-out then applies the
`episode_marked` requirement only to sessions labelled `"music"`.

Expected Behavior:
The same site, in the same browser, playing the same episode, should be detected
identically on both platforms — the stated reason the decisions live in the
shared module ("the backends supply data, the shared module decides").

Actual Behavior:
Browsers on Windows report `type: music` for tab audio (measured, per the
comment at mod.rs:93-104), so a browser session is only watchable there when the
title *spells out* an episode — `"Some Show - 28"` is `episode_marked == false`
(pinned by `only_spelled_out_episodes_count_as_marked`, parser.rs:283-290) and is
dropped. On Linux the same session infers `"unknown"` (no extension in a
streaming URL, and the browser is not in `MUSIC_PLAYERS`), which is watchable
unconditionally, so the dash-form title *is* detected.

Reproduction:
A streaming site not covered by `STREAMING_MARKERS` (profiles.rs:60-65) whose tab
title is `"Show - 28"`: detected through MPRIS on Linux, invisible through SMTC
on Windows.

Impact:
A platform difference in what gets detected, in the pass whose own diagnostic is
meant to answer "why was my player not detected". The Windows side is the
stricter one, so nothing is scrobbled wrongly — a coverage gap, never a bad
write.

Root Cause:
Both halves are documented, deliberate decisions taken for stated reasons — the
music carve-out is keyed on marker strength because Windows browser AUMIDs are
opaque (mod.rs:93-104), and `"unknown"` is the MPRIS fallback precisely so a
player that says nothing is not invisible (mod.rs:224-232). The divergence is
their product, and nobody has held the two side by side.

Recommended Fix:
Normalise at the boundary or apply one predicate: either treat SMTC's `Music`
from a session with no `url` and an unclassifiable app id as `"unknown"`, or
apply the `episode_marked` requirement to `"unknown"` browser-ish sessions too.
Whichever way, one predicate — and it needs a measurement on Windows to settle
which.

Regression Tests Required:
- The same `MediaSession` fixture with `playback_type` `"music"` and `"unknown"`
  must produce the same `is_watchable` verdict for a dash-form title, whichever
  way the project decides.

Confidence: MEDIUM — the SMTC-labels-browsers-as-music premise comes from the
repository's own measured report (commit 715d928 and mod.rs:93-104) rather than
from a measurement takeable here.
Verification: downgraded from P3 — the divergence is the product of two
documented deliberate decisions rather than an oversight, the stricter side is
the one that could produce a bad write, and settling it requires a Windows
measurement.

---

ID: B3-12
Severity: P4
Category: BUG (observability)

File: /home/user/Karasu/src-tauri/src/logging.rs
Line: 443-452 (`supervise`), with detection/mod.rs:255 (`.unwrap_or(None)`)
Function: `supervise` / `detect_playback`

Problem:
There is no user-visible signal when the scrobbler dies permanently after five
panics, beyond a log line. `supervise`'s give-up branch writes
`error(name, "… giving up after 5 restarts. Restart Karasu to bring it back.")`
and returns. Nothing is emitted to the WebView, no toast is raised, no bell row
is written, and the tray is untouched. The only way to learn about it is opening
Settings → the log viewer, which a user has no reason to do because the symptom
is "scrobbling silently stopped".

A second variant: a panic inside the detection sweep does not reach the
supervisor at all. `detect_playback` runs the window and media-session passes in
`spawn_blocking` and flattens the `JoinError` with `.unwrap_or(None)`
(detection/mod.rs:234-255). A deterministic panic there (a Win32 or D-Bus edge
case) is therefore indistinguishable from "nothing is playing": the supervised
loop keeps ticking healthily, forever, detecting nothing.

Expected Behavior:
A permanently dead background loop, and a permanently failing detection sweep,
should be visible in the app.

Actual Behavior:
As above. The good half: the panic hook records both (`install_panic_hook`,
logging.rs:477-500), so a submitted log file explains it — which is the stated
design ("Restarting is not a fix and does not pretend to be one — the log line
is the point", logging.rs:424-426).

Reproduction:
Not reproducible without injecting a panic; the give-up branch and the
`.unwrap_or(None)` are both plainly visible in the named functions.

Impact:
The feature is off with no in-app indication. The user's model is "Karasu
stopped scrobbling", which is unreportable without being told to look in the
log.

Root Cause:
`supervise` was scoped to restarting and logging, and nothing was wired to the
UI. The `spawn_blocking` flattening trades a panic for a normal-looking `None`.

Recommended Fix:
Emit an event (or write one bell row) when `supervise` gives up — one row per
process, exactly the kind of news the bell exists for. For the blocking sweep,
count consecutive `JoinError`s and log or emit once at a threshold rather than
silently mapping them to `None`.

Regression Tests Required:
- `restart_plan` is already tested; add a test that the give-up path calls the
  notification hook (behind a small injectable sink, so no Tauri app is needed).

Confidence: HIGH on the facts
Verification: downgraded from P3 — the give-up branch does exactly what the
function's own doc says it does, and the panic hook records both cases, which is
the stated design for making this reportable; wiring a bell row is an
improvement on a deliberate scope rather than a defect.

---

ID: B3-13
Severity: P4
Category: BUG

File: /home/user/Karasu/src-tauri/src/discord.rs
Line: 29-49 (`LastPresence` / `RESEND_SECS`), 105-134
Function: `sync` / `sync_current`

Problem:
`LastPresence`'s documented purpose is that "an identical payload is therefore
re-sent once the last real send is older than `RESEND_SECS` … frequent enough
that a killed pipe is noticed and reconnected within a minute". That requires a
periodic caller, and there is none. The complete call-site census
(`grep -rn "discord::"`): lib.rs:408 (once at startup), commands/system.rs:21
(`set_ui_page`, a route change), commands/prefs.rs:44 (a settings save),
scrobbler.rs:777 (after a scrobble), :907 (`requeue_match`) and :1063 (**only**
inside `if raw != last_raw`, i.e. when the detected title changes).

Expected Behavior:
As documented: a Discord restart is noticed within about a minute and the
presence comes back; a Discord started after Karasu picks up the presence.

Actual Behavior:
During a whole episode the detected title does not change, so `sync` is not
called on the poll. If Discord is restarted mid-episode the pipe dies, nothing
sends, nothing notices, and the presence stays gone until the next title change,
route change, scrobble or settings save. Likewise, launching Discord after
Karasu produces no presence until one of those events occurs — the "connect
lazily … retry later" comment (:125) has no "later" of its own.

Reproduction:
Start Karasu with Discord running, begin an episode (presence appears), restart
Discord. The presence does not return until one of the listed events fires.

Impact:
Cosmetic — a missing presence for at most the remainder of one episode, since
any route change or the next title change reconnects. The mechanism written to
prevent it does not run, so the code reads as if the case were handled.

Root Cause:
The fingerprint/resend logic was designed for a caller frequency that the
detection loop's change-gate removes.

Recommended Fix:
Call `sync_current` from the scrobbler's poll loop unconditionally (it is cheap:
the fingerprint check exits early), or add a 30-60 s ticker. Either gives
`RESEND_SECS` the driver its comment assumes. If neither is taken, correct the
comment.

Regression Tests Required:
- Not unit-testable without a Discord socket; a call-site assertion is not
  meaningful. At minimum, correct the comment if the fix is not taken.

Confidence: HIGH — the call-site census is exhaustive
Verification: downgraded from P3 — the impact is cosmetic and the window is
smaller than filed, since a route change, a scrobble or the next title change
all reconnect.

---

ID: B3-14
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/alerts/notify.rs
Line: 236-251
Function: `toast_with_action` (Linux)

Problem:
Each confirm toast spawns an OS thread that blocks in
`handle.wait_for_action(...)` until the notification is acted on **or closed**.
Notification daemons that keep notifications in a persistent tray until the user
dismisses them do not emit a close promptly, so the thread parks indefinitely.
No timeout, no handle kept.

Expected Behavior:
A per-toast helper thread ends within a bounded time.

Actual Behavior:
One thread per confirm prompt, each holding a D-Bus connection, accumulating for
as long as the app runs. The comment acknowledges the design ("parks its thread
until the toast is acted on or dismissed — a spawned thread's, never the async
runtime's"), but not the unbounded case.

Reproduction:
"Ask before updating" on, Linux, a binge session: one thread per episode, none
of them retired if the daemon holds notifications.

Impact:
Slow resource growth on a long-running process, bounded in practice by the
number of episodes watched in one session. It is the only per-event thread spawn
in the tree.

Root Cause:
`notify-rust`'s blocking action API has no timeout.

Recommended Fix:
Close the previous confirm notification when a new one is raised (keep the last
handle), so at most one such thread exists. The toast is about a session that
has already moved on anyway, which `confirm_pending_for`'s `applies_to` check
(scrobbler.rs:952-956) already relies on.

Regression Tests Required:
None practical (D-Bus); a comment recording the bound would be the minimum.

Confidence: MEDIUM — the accumulation depends on daemon close semantics that
could not be measured here; the unbounded spawn itself is certain.

---

ID: B3-15
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/widgets.rs
Line: 293-300
Function: `clear`

Problem:
`clear()` deletes `widgets.json` but does not call `poke_refresher()`, which is
what `write_projection` does after every write (:239). Nothing tells the placed
widgets to re-render.

Expected Behavior:
"The projection holds list titles, and the file must not outlive the account it
describes" (:293-295) — including what is already drawn on the home screen.

Actual Behavior:
The file is gone, but the four widgets keep displaying the previous account's
titles until Android's own `updatePeriodMillis` fires (1 800 000 ms in all four
`res/xml/widget_*.xml`, i.e. 30 minutes), or until something else triggers an
update.

Reproduction:
Android, widgets placed, sign out. The home screen still lists the signed-out
account's watching titles for up to half an hour.

Impact:
The stated invariant is half-kept; a signed-out account's titles stay on a home
screen for a bounded but long window.

Root Cause:
The refresh poke lives in the write path only.

Recommended Fix:
Call `poke_refresher()` at the end of `clear()` (it already fails soft through
`debug_changed`).

Regression Tests Required:
Android-only, not unit-testable here; the fix is one line and self-evident.

Confidence: HIGH

---

ID: B3-16
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs
Line: 847 and 1058, with library.rs:487 and relations.rs:140, :193
Function: `requeue_match` / `spawn` / `library` index build

Problem:
`sync::LockExt::guard` exists so that "one panic does not become a permanent
outage" for a supervised loop (sync.rs:1-20), and every `Mutex` in the crate goes
through it. The `Relations` `RwLock` does not — the three readers use
`.read().unwrap()` (scrobbler.rs:847, scrobbler.rs:1058, library.rs:487) and the
two writers `.write().unwrap()` (relations.rs:140, :193). If that lock were ever
poisoned, the supervised scrobbler would panic on its first tick after every
restart, burn `MAX_RESTARTS` and stay down for the process — precisely the
outage `sync` was written to prevent.

Expected Behavior:
One idiom for taking a lock in the detection path.

Actual Behavior:
Two.

Reproduction:
Not reachable today, and stated plainly: the only writers hold the guard across
a plain assignment and the readers hold it across pure code, so nothing in the
current tree can poison it.

Impact:
None today; a latent trap for the next change that does work under the guard.

Root Cause:
`LockExt` was added for `Mutex` and the one `RwLock` was not revisited.

Recommended Fix:
Extend `LockExt` with `read_guard`/`write_guard` for `RwLock` and use it at all
five sites.

Regression Tests Required:
- A `sync` test mirroring `a_poisoned_lock_still_hands_over_its_data` for
  `RwLock`.

Confidence: HIGH on the code, LOW on reachability — reported as robustness, not
a live defect. (The report named two reader sites; there are three.)

---

ID: B3-17
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src-tauri/src/i18n.rs
Line: 181-182, against commands/playback.rs:70, :83-90 and detection/mod.rs:245-247
Function: tray menu item `TrayDetection`

Problem:
The tray check item is labelled "Media detection" / "Medienerkennung" but toggles
`MEDIA_DETECTION_KEY` (`smtc_enabled`), which gates only the media-session rung:
`detect_playback` still runs mpv IPC (:217-225), Jellyfin (:226-231) and
`detect_windows` (:241-244) with the box unchecked, since all three sit *before*
the `if !media_detection` return at :245-247.

Expected Behavior:
The label should say what it switches. The Settings pane gets this right — "Use
system media info" with a hint naming the players it covers
(src/i18n/en.ts:1359-1361).

Actual Behavior:
A user unchecking "Media detection" from the tray to stop tracking keeps being
tracked by three other sources.

Reproduction:
Uncheck the tray item with an mpv or Jellyfin source configured; detection
continues and the now-playing card keeps updating.

Impact:
A surprised user, and possibly an unwanted scrobble the user believed they had
switched off.

Root Cause:
The tray label was written for the setting's old, narrower scope.

Recommended Fix:
Reuse the Settings wording ("System media info") for the tray item, in both
languages (the `de: typeof en` parity rule applies). Renaming the *key* is
correctly ruled out by CLAUDE.md and by the constant's own comment; the label is
free to fix.

Regression Tests Required:
None beyond the existing i18n key tests.

Confidence: HIGH

---

ID: B3-20
Severity: P4
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/alerts/stale.rs
Line: 136
Function: `check`

Problem:
`stale_done:{media_id}` is a third account-less dedupe key, alongside the
`aired:` and `sequel_seen:` keys named in B3-03. It is keyed on the media id and
compared against that entry's `updatedAt`, with no user component, and nothing
clears it on `anilist_logout`.

Expected Behavior:
A dedupe key that decides whether *this account* has already been nudged about
an entry should not be consulted for a different account.

Actual Behavior:
After signing out of A and into B, a stale nudge for an entry both accounts hold
is suppressed for B whenever B's cached `updatedAt` for that entry happens to
equal the value stored under A. Unlike the `aired:` family it is never pruned
(no TTL sweep exists for this prefix), so the row persists for the life of the
database.

Reproduction:
Sign in as A, let the stale pass write `stale_done:<id>` for an entry, sign out,
sign in as B whose copy of that entry carries the same `updatedAt`. B is never
nudged about it.

Impact:
One silently missed stale nudge per colliding entry — the mildest of the three
notification families, and it needs an `updatedAt` collision on top of the shared
key, which is why it stands below B3-03.

Root Cause:
The same as B3-03: the alert dedupe vocabulary was never account-scoped, and the
third key was added after the pattern was set.

Recommended Fix:
Fold it into B3-03's fix — whichever shape is chosen (a user id in the key, or
clearing on logout), `stale_done:` must be covered with `aired:` and
`sequel_seen:`.

Regression Tests Required:
- Covered by B3-03's `Db` test, extended to assert `stale_done:` keys are
  removed as well.

Confidence: HIGH
Source: found during adversarial verification

---

ID: B3-21
Severity: P4
Category: BUG

File: /home/user/Karasu/src-tauri/src/playback/detection/jellyfin.rs
Line: 753-775
Function: `hold_last_good`

Problem:
`hold_last_good` hands the cached `Playback` back unchanged for up to three
ticks, position included. The scrobbler cannot tell a held answer from a fresh
one, so a frozen `position_sec` is read as a real position rather than as "no
verdict" — and via `unwrap_or_else` (scrobbler.rs:1150-1158) a `Some(false)`
from `position_due` *suppresses* the wall-clock fallback for those ticks.

Expected Behavior:
A held answer papers over a failed poll for the *identity* of what is playing;
it should not also assert a position that is known to be stale.

Actual Behavior:
For up to `HOLD_TICKS` (3 × 5 s = 15 s) the scrobbler evaluates its due check
against a position that has not moved, either suppressing a wall-clock verdict
that would have fired or — if the held position was already past two thirds —
asserting `Some(true)` from data the server did not just confirm.

Reproduction:
Play an episode through Jellyfin and make `/Sessions` fail for one to three
consecutive polls (stop the server, or block the port). The held ticks carry the
last position verbatim.

Impact:
Bounded to at most 15 seconds of a stale due verdict. It is the same suppression
mechanism B3-07 turns on for an unbounded time, which is why it is worth naming
separately from the hold itself — the hold is otherwise sound (see "Verified
sound").

Root Cause:
`hold_last_good` was designed to preserve "what is playing" and the `Playback`
struct carries the position in the same value, so preserving one preserves the
other.

Recommended Fix:
Blank `position_sec` (and `duration_sec`) on the held clone, so the scrobbler
falls back to the wall clock for the held ticks instead of trusting a frozen
number.

Regression Tests Required:
- `remember(Some(p))` with a position, then `hold_last_good()` → the returned
  `Playback` has `position_sec: None` while the title and ids are unchanged.

Confidence: HIGH
Source: found during adversarial verification

---

## Verified sound

Scenarios checked that are handled correctly, with the guard that handles each:

- **Source flap that resolves to the same entry does not reset the timer.** The
  scrobble session is keyed on `(media_id, episode)`, not on the detection
  string: `is_same` at scrobbler.rs:1096-1099. So mpv IPC → window title for the
  same file (different `process`, same title) rebuilds `NowPlaying` but keeps
  the session and its `update_at`. Pinned in spirit by `applies_to` and its three
  tests (:1473-1491).
- **Blocking-pool exhaustion from the 5 s sweep.** `detect_playback` `await`s its
  single `spawn_blocking` (detection/mod.rs:234-255) inside a loop that only
  sleeps afterwards, so at most one blocking task exists per tick; a hung Win32
  or D-Bus call stalls the detection loop but cannot accumulate threads. The
  stall itself is documented and deliberate (smtc.rs:26-30, mpris.rs:124-127).
- **Jellyfin's hold cannot resurrect a finished episode.** `hold_last_good` is
  only reachable from the request-failed branch and `remember(None)` clears the
  memory (jellyfin.rs:743-775); pinned by
  `a_clean_nothing_playing_clears_the_memory_at_once` (:865).
- **Jellyfin cross-user scoping.** User-token auth plus the `session_matches`
  backstop, including the fail-closed empty-user case (jellyfin.rs:346-363),
  pinned by six tests (:982-1024).
- **Jellyfin credential-store cost and sign-in/sign-out cache coherence.**
  `cached_or` distinguishes "nothing stored" from "could not look" (:192-205),
  and `save_token`/`delete_token` both write through `set_cached_token`; four
  tests pin it (:1106-1180), including
  `signing_in_or_out_replaces_what_was_cached`.
- **Jellyfin poll cost.** One `GET /Sessions` per tick on a shared,
  `OnceLock`-held `reqwest::Client` with a 4 s timeout (:430-457); failures go
  through `debug_changed` keyed `"detect"`, so an unreachable server writes one
  line per state change, not 17 280 a day (:693).
- **`debug_changed`'s dedupe map cannot grow.** Keyed on `&'static str`
  (logging.rs:357-369), so it is bounded by the number of call sites.
- **Log ring and notification table are bounded** — `RING_CAPACITY` 1000
  (logging.rs:38) and the `NOTIF_KEEP` trim inside `notif_insert`
  (db.rs:1105-1110, tested at :1749).
- **`aired:` keys are pruned** (`kv_prune_older`, airing.rs:254);
  `sequel_seen:` keys are not, but they are bounded by the number of related
  media on the user's list and are load-bearing for dedupe (sequel.rs:213-218) —
  growth is acceptable, not a leak.
- **mpv paused handling.** `detect` returns the pausedness and `detect_playback`
  demotes a paused pipe to last resort (detection/mod.rs:216-223, :257-267);
  pinned by `paused_stays_a_candidate_and_nothing_usable_is_none`
  (mpv_ipc.rs:282). With a live position, pausing genuinely stops the clock
  (`position_due`, scrobbler.rs:645-668), matching the settings hint.
- **mpv probe cannot hang the loop.** One 500 ms timeout over connect, write and
  reads together, plus a 32-line read bound (mpv_ipc.rs:184-201), and the pipe
  path is shape-checked before use (`is_pipe_path`, commands/playback.rs).
- **A session with no usable metadata does not end the media-session sweep.**
  `watchable(...).find_map(playback_from)` rather than `playback_from(pick())`
  (media_session/mod.rs:352), pinned by
  `an_empty_session_falls_through_to_the_next_one` (:571).
- **A scrobble can never lower progress.** `would_regress` is checked inside
  `perform_update`, against freshly re-read cached progress, not the session's
  stale copy (scrobbler.rs:731-743); pinned by
  `a_scrobble_can_only_ever_move_progress_forward` (:1275).
- **A late toast/confirm cannot stamp the wrong episode.** `applies_to` under the
  same lock that reads the session (scrobbler.rs:941-996).
- **The unplaceable-season block.** `unplaceable_season` + `season_informed`
  (scrobbler.rs:628-641) refuses to guess, is not forceable, and clears once a
  correction exists — the documented Beyblade rule, tested at :1352.
- **The airing pass does not replay a backlog when re-enabled** — the checkpoint
  advances while the setting is off (airing.rs:154-161) — and a truncated page
  does not step over the tail (`checkpoint`/`reached`, :204-263, with
  `the_page_size_matches_the_query_that_produces_it` pinning the coupling).
- **The site pass never marks the user's AniList feed read**
  (`resetNotificationCount` absent, pinned at site.rs:186) and arms silently on
  the first fetch (:161-165).
- **The Android background job cannot corrupt the database** — `busy_timeout(5s)`
  before the migrations, explicitly for the JobScheduler second connection
  (db.rs:515-522) — and it never hands the token to Kotlin (background.rs:1-13).
- **The widget projection reads the path Rust writes** — `dataDir`, not
  `filesDir`, documented on both sides (widgets.rs:44-49 comment chain and
  Widgets.kt:76-80).
- **Every long-lived loop except the relations loader is supervised**: scrobbler,
  airing, stale, sequel, site, backups (lib.rs:386-406). The two unsupervised
  spawns are one-shots (relations — see B3-09 — and the 3 s widget projection).
- **Discord presence on exit.** No explicit clear exists, but `app.exit(0)`
  terminates the process and Discord drops the presence when the IPC socket
  closes; the in-app "off" path does disconnect and clear (discord.rs:76-83,
  reached at :117-123 via the settings save at commands/prefs.rs:44).
- **Discord respects the setting on every path**, including the idle-page
  presence: `sync` re-reads `discord_enabled` at the top of every call (:113-114)
  and disconnects when it is off, before any presence is built.
- **Poisoned mutexes cannot permanently disable detection** — `sync::LockExt`
  (sync.rs:24-33), used by `PlaybackState`, `ScrobbleSession`, `Discord`, the
  Jellyfin caches and the MPRIS bus handle. (The one exception is the `Relations`
  `RwLock`; see B3-16.)

## Counts

| Severity | Count |
| --- | --- |
| P0 | 0 |
| P1 | 1 |
| P2 | 0 |
| P3 | 8 |
| P4 | 12 |
| Refuted | 0 |

Total findings: 21. Nothing was refuted during verification; eight findings were
downgraded (B3-02, B3-03, B3-05, B3-08, B3-10, B3-11, B3-12, B3-13) and four were promoted from the verifier's own pass (B3-18, B3-19,
B3-20, B3-21).
