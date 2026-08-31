//! Detection and scrobble loop: watch windows, parse titles, match them
//! against the list and update progress on AniList automatically once the
//! threshold has passed.
//!
//! State machine per detected episode:
//! `Watching → (Pending →) Updating → Updated`, with `Blocked` on
//! plausibility problems (episode gap, already watched) and `Cancelled`
//! after user abort.

use crate::db::Db;
use crate::sync::LockExt;
use crate::playback::detection;
use crate::playback::recognition::{matcher, parser};
use crate::playback::relations::{self, Relations};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const POLL_INTERVAL: Duration = Duration::from_secs(5);
/// Fallback threshold when no episode length is known.
const DEFAULT_THRESHOLD: Duration = Duration::from_secs(15 * 60);
/// Threshold for manga chapters (reading is faster than watching).
const MANGA_THRESHOLD: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NowPlaying {
    pub process: String,
    pub streaming: bool,
    /// "ANIME" or "MANGA" — for manga, `episode` carries the chapter number
    #[serde(rename = "mediaType")]
    pub media_type: String,
    #[serde(rename = "rawTitle")]
    pub raw_title: String,
    #[serde(rename = "parsedTitle")]
    pub parsed_title: String,
    /// The season the parse carried, if any — half the key a correction is
    /// stored under, so the picker has to be able to send it back.
    pub season: Option<u32>,
    /// The episode as *resolved*: the source's number plus any correction's
    /// offset, then whatever the relations redirect made of it.
    pub episode: Option<u32>,
    /// The episode the source actually reported, before either of those.
    ///
    /// Kept because `requeue_match` re-resolves from this object rather than
    /// from a fresh detection: without the untouched number it would shift an
    /// already-shifted one and drift a little further on every correction.
    ///
    /// Serialised for the same reason the correction dialog needs it: an
    /// offset is `chosen - detected`, and `episode` below is already shifted
    /// and already redirected. Measuring against that number stored a wrong
    /// offset the moment a correction was edited a second time, and confirming
    /// the pre-filled figure stored `0` — destroying a working correction.
    #[serde(rename = "sourceEpisode")]
    pub source_episode: Option<u32>,
    /// AniList media ID on a successful match against the list
    #[serde(rename = "mediaId")]
    pub media_id: Option<i64>,
    #[serde(rename = "matchedTitle")]
    pub matched_title: Option<String>,
    /// Whether this match came from the user's own correction rather than the
    /// matcher. Drives the "undo" affordance; nothing else reads it.
    pub overridden: bool,
    /// Current list progress of the matched entry
    pub progress: Option<u32>,
    #[serde(rename = "totalEpisodes")]
    pub total_episodes: Option<u32>,
    /// Episode length of the matched entry, in minutes.
    ///
    /// Carried here rather than re-derived because finding the entry means
    /// deserializing the whole cached list. Matching already did that once and
    /// held the answer; `threshold` and the Discord presence used to each throw
    /// that away and parse the list again. Internal — the frontend has no use
    /// for either of these, so they stay off the `now-playing` payload.
    #[serde(skip)]
    pub duration_min: Option<u32>,
    /// `coverImage.large` of the matched entry, for the Discord presence
    /// card. Same carriage as `duration_min`, same reason, same `skip` — the
    /// frontend draws its covers from its own cache and has no use for this.
    #[serde(skip)]
    pub cover_url: Option<String>,
    /// Playback position in seconds, refreshed every poll when the source
    /// reports one (Jellyfin). Internal like `duration_min`: the deadline
    /// check reads it, the frontend does not.
    #[serde(skip)]
    pub position_sec: Option<u32>,
    /// The file's own duration in seconds from the same source — beats the
    /// entry's rounded minutes when both exist.
    #[serde(skip)]
    pub duration_sec: Option<u32>,
    /// List status of the matched entry when detection started.
    #[serde(skip)]
    pub list_status: String,
}

/// Currently detected playback, shared by commands and the scrobbler.
pub struct PlaybackState(pub Mutex<Option<NowPlaying>>);

/// Why an auto-update will not happen — a code and its numbers, never a
/// sentence.
///
/// It used to be a `String` formatted in Rust and rendered verbatim on the
/// card, so a German UI read an English sentence. This is the shape CLAUDE.md
/// names for exactly that reason: the backend decides *what* is wrong, the
/// component maps the code through a literal `switch` to a translated line.
/// The log still gets prose, built on this side by `Display`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum BlockReason {
    /// The detected episode is at or behind the list's progress. Forcing it
    /// would *lower* progress, so the card offers no way to.
    AlreadyWatched { episode: u32, progress: u32 },
    /// Detected well ahead of the list. Forcing this is legitimate — it moves
    /// progress forward — so the card keeps its button.
    EpisodeGap { episode: u32, progress: u32 },
    /// The source reported a season the matcher provably could not use, and
    /// nobody has said which AniList entry it is. Scrobbling would write to
    /// whatever the bare title hit — for a franchise whose seasons are
    /// separate entries, that is season one, at season two's episode numbers.
    UnknownSeason { season: u32 },
    /// The update was attempted and the API refused it. Not a refusal of ours,
    /// so retrying is exactly the right offer — and the message is the
    /// server's own, which no translation could improve.
    Failed { message: String },
}

impl std::fmt::Display for BlockReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlockReason::AlreadyWatched { episode, progress } => write!(
                f,
                "episode {episode} is already watched according to your list (progress {progress})"
            ),
            BlockReason::EpisodeGap { episode, progress } => {
                write!(f, "episode gap: detected {episode}, but your progress is {progress}")
            }
            BlockReason::UnknownSeason { season } => write!(
                f,
                "season {season} cannot be placed on AniList without a correction"
            ),
            BlockReason::Failed { message } => write!(f, "{message}"),
        }
    }
}

impl BlockReason {
    /// Whether "Update now" may override this. Forcing *forward* is a choice
    /// worth offering and a failed request is worth retrying; moving progress
    /// backward and guessing which entry a season is are not.
    pub fn forceable(&self) -> bool {
        matches!(
            self,
            BlockReason::EpisodeGap { .. } | BlockReason::Failed { .. }
        )
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Phase {
    Watching,
    Pending,
    Updating,
    Updated,
    /// Written locally, not yet accepted by AniList.
    ///
    /// A distinct phase because `Updated` is a claim about the server. The
    /// write went to the offline queue — offline, throttled, or behind a drain
    /// that was already running — and saying "Updated ✓" for it is the one
    /// assurance a tracker cannot get wrong.
    Queued,
    Blocked(BlockReason),
    Cancelled,
}

/// What a write actually did.
///
/// `save_entry_core` answers `queued` for anything that could still work
/// later, and that answer used to be discarded by every caller in this file:
/// the session went to `Updated`, the local cache was patched with progress
/// the account did not have, and `scrobble-done` fired. If the queued row was
/// later refused for good, the cache kept a number that had never landed — and
/// `would_regress`, which reads that cache, then refused the correct rewrite.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Outcome {
    Landed,
    Queued,
}

#[derive(Debug, Clone)]
pub struct Session {
    pub media_id: i64,
    /// "ANIME" or "MANGA"
    pub media_type: String,
    /// Episode or chapter number
    pub episode: u32,
    pub total: Option<u32>,
    /// List status of the entry when detection started
    pub list_status: String,
    /// Wall-clock start of this session (ms since epoch); drives the Discord
    /// presence progress bar.
    pub started_ms: i64,
    /// When the auto-update is due (None = auto-update disabled)
    pub update_at: Option<Instant>,
    pub update_at_epoch_ms: Option<u64>,
    pub phase: Phase,
    /// Consecutive polls that detected nothing at all.
    ///
    /// A pause is indistinguishable from a stop on any source that reports
    /// only playing sessions — which is every media-session player, and on
    /// Linux that is the whole of local detection. Dropping the session on the
    /// first empty tick therefore threw away the accumulated watch time and
    /// restarted the threshold from zero on resume, so a twice-paused episode
    /// could never scrobble. Counted rather than acted on immediately, and
    /// reset the moment the same content is seen again.
    pub missed_ticks: u32,
}

/// Running scrobble session (shared between the loop and commands).
pub struct ScrobbleSession(pub Mutex<Option<Session>>);

/// Whether a finished update still belongs to the session now in state.
///
/// Both update paths drop the lock across the AniList request, and the poll
/// loop replaces the session wholesale whenever the detected episode changes.
/// Writing the result back unconditionally would stamp one episode's outcome
/// onto another — and since the threshold check only fires on `Watching`, the
/// wrongly-stamped episode could never be scrobbled at all.
fn applies_to(session: &Session, media_id: i64, episode: u32) -> bool {
    session.media_id == media_id && session.episode == episode
}

#[derive(Clone, serde::Serialize)]
struct ScrobbleEvent {
    phase: String,
    reason: Option<BlockReason>,
    /// Whether the card may offer "Update now" against this block. Emitted
    /// rather than re-derived on the other side, so the button and the command
    /// that refuses it cannot drift apart.
    forceable: bool,
    #[serde(rename = "mediaId")]
    media_id: Option<i64>,
    episode: Option<u32>,
    #[serde(rename = "updateAtMs")]
    update_at_ms: Option<u64>,
}

fn emit_session(app: &AppHandle, session: Option<&Session>) {
    let event = match session {
        None => ScrobbleEvent {
            phase: "idle".into(),
            reason: None,
            forceable: false,
            media_id: None,
            episode: None,
            update_at_ms: None,
        },
        Some(s) => ScrobbleEvent {
            phase: match &s.phase {
                Phase::Watching => "watching",
                Phase::Pending => "pending",
                Phase::Updating => "updating",
                Phase::Updated => "updated",
                Phase::Queued => "queued",
                Phase::Blocked(_) => "blocked",
                Phase::Cancelled => "cancelled",
            }
            .into(),
            reason: match &s.phase {
                Phase::Blocked(r) => Some(r.clone()),
                _ => None,
            },
            // Everything that is not a block is forceable — that is what the
            // button has always meant outside this phase.
            forceable: match &s.phase {
                Phase::Blocked(r) => r.forceable(),
                _ => true,
            },
            media_id: Some(s.media_id),
            episode: Some(s.episode),
            update_at_ms: match &s.phase {
                Phase::Watching => s.update_at_epoch_ms,
                // An armed gap block carries its lift time, so the card can
                // say *when* rather than only *that* — unarmed blocks have
                // no epoch to leak, since `auto_arm` never set one.
                Phase::Blocked(BlockReason::EpisodeGap { .. }) => s.update_at_epoch_ms,
                _ => None,
            },
        },
    };
    let _ = app.emit("scrobble-state", &event);
}

fn cached_user_id(db: &Db) -> Option<i64> {
    db.kv_get("anilist_viewer")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("id").and_then(|i| i.as_i64()))
}

/// Builds matching candidates from the SQLite list cache.
/// For MANGA, `episodes` carries the chapter count.
pub fn candidates_from_cache(db: &Db, media_type: &str) -> Vec<matcher::Candidate> {
    let Some(user_id) = cached_user_id(db) else {
        return Vec::new();
    };
    let Some(lists) = db
        .cached_list(user_id, media_type)
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    else {
        return Vec::new();
    };

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for group in lists.as_array().into_iter().flatten() {
        if group
            .get("isCustomList")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        for entry in group
            .get("entries")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let Some(media_id) = entry.get("mediaId").and_then(|v| v.as_i64()) else {
                continue;
            };
            if !seen.insert(media_id) {
                continue;
            }
            let media = &entry["media"];
            let mut titles: Vec<String> = Vec::new();
            for key in ["romaji", "english", "native"] {
                if let Some(t) = media.pointer(&format!("/title/{key}")).and_then(|v| v.as_str()) {
                    titles.push(t.to_string());
                }
            }
            for syn in media
                .get("synonyms")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
            {
                if let Some(s) = syn.as_str() {
                    titles.push(s.to_string());
                }
            }
            if titles.is_empty() {
                continue;
            }
            let total_key = if media_type == "MANGA" { "chapters" } else { "episodes" };
            out.push(matcher::Candidate {
                media_id,
                titles,
                episodes: media
                    .get(total_key)
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32),
                duration_min: media
                    .get("duration")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as u32),
                cover_url: media
                    .get("coverImage")
                    .and_then(|c| c.get("large"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                progress: entry
                    .get("progress")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32,
                status: entry
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            });
        }
    }
    out
}

/// `-1` for a parse that carried no season — the sentinel `library_override`
/// established in schema v9, and the reason it is a sentinel rather than NULL
/// is that SQLite would treat each NULL in a primary key as distinct.
pub(crate) fn season_key(season: Option<u32>) -> i32 {
    season.map(|s| s as i32).unwrap_or(-1)
}

/// The user's correction for this parse.
///
/// Read whole and matched in memory: the table holds one row per title the
/// matcher gets wrong, which is a handful, and this runs on a 5 s poll.
pub(crate) fn detection_override(
    db: &Db,
    title: &str,
    season: Option<u32>,
    media_type: &str,
) -> Option<crate::db::DetectionOverride> {
    let key = season_key(season);
    db.detection_overrides()
        .into_iter()
        .find(|o| o.title == title && o.season == key && o.media_type == media_type)
}

/// The episode a correction says this really is.
///
/// Saturating, and floored at 1: an offset that would take the number to zero
/// or below describes a mapping that cannot be true, and episode 0 is not a
/// thing to write to a list.
pub(crate) fn shift_episode(episode: u32, offset: i32) -> u32 {
    let shifted = i64::from(episode) + i64::from(offset);
    shifted.clamp(1, u32::MAX as i64) as u32
}

/// What the cached list knows about a matched id.
///
/// Shared by the detection pass and the correction command so the card cannot
/// say one thing when a title is detected and another when it is corrected.
/// A forced id that is not on the list yet resolves to the stored display
/// title with no progress — honest, and it self-heals on the first scrobble,
/// since `SaveMediaListEntry` creates the entry.
/// What `resolve_match` found. A struct rather than the 5-tuple this grew out
/// of: at six fields, `(Option<String>, Option<u32>, Option<u32>, …)` at two
/// call sites is a puzzle, not a signature — the same call `DetectionOverride`
/// made in db.rs.
struct Resolved {
    title: Option<String>,
    progress: Option<u32>,
    total: Option<u32>,
    duration_min: Option<u32>,
    cover_url: Option<String>,
    status: String,
}

fn resolve_match(
    candidates: &[matcher::Candidate],
    media_id: i64,
    fallback_title: Option<&str>,
) -> Resolved {
    match candidates.iter().find(|c| c.media_id == media_id) {
        Some(c) => Resolved {
            title: Some(c.titles[0].clone()),
            progress: Some(c.progress),
            total: c.episodes,
            duration_min: c.duration_min,
            cover_url: c.cover_url.clone(),
            status: c.status.clone(),
        },
        None => Resolved {
            title: fallback_title.map(str::to_string),
            progress: None,
            total: None,
            duration_min: None,
            cover_url: None,
            status: String::new(),
        },
    }
}

fn build_now_playing(
    db: &Db,
    rules: &[relations::Rule],
    playback: detection::Playback,
) -> NowPlaying {
    let media_type = if playback.manga { "MANGA" } else { "ANIME" };
    // A source that already knows the series and episode (the Jellyfin API)
    // supplies them directly; guessing at a formatted string would only throw
    // away information it handed us.
    let parsed = match playback.parsed.clone() {
        Some(p) => p,
        None if playback.manga => parser::parse_manga(&playback.media_title),
        None => parser::parse(&playback.media_title),
    };
    let candidates = candidates_from_cache(db, media_type);

    // The user's own answer, before the fuzzy sweep — the same precedence
    // `index_files` documents for the library scanner. A title the matcher gets
    // wrong (or cannot place at all) is corrected once on the card and every
    // later detection of that parse skips the guessing entirely.
    let forced = detection_override(db, &parsed.title, parsed.season, media_type);
    if let Some(o) = &forced {
        crate::logging::debug(
            "recognize",
            format!(
                "{:?} → your correction: #{} offset {:+}",
                parsed.title, o.media_id, o.episode_offset
            ),
        );
    }
    // The corrected number, *before* the relations redirect: a correction says
    // which episode of the entry this is, and anime-relations then decides
    // where that episode lands — the order the v12 note in CLAUDE.md sets out.
    let source_episode = parsed.episode;
    let mut parsed = parsed;
    if let (Some(o), Some(ep)) = (&forced, parsed.episode) {
        parsed.episode = Some(shift_episode(ep, o.episode_offset));
    }
    let parsed = parsed;

    let matched = match &forced {
        Some(o) => Some(matcher::Match { media_id: o.media_id, score: 1.0 }),
        None => matcher::best_match(&parsed, &candidates),
    };

    // The verdict, while the score still exists. The `.map()` below rewrites
    // `matched` into `(id, episode)` and the score is gone for good — so this is
    // the only point where "matched the wrong show" can be told apart from
    // "matched nothing", which is the top detection question. Logged here rather
    // than inside the matcher on purpose: `best_match` is also the library
    // scanner's and `identify.rs`'s, and a line in there fires once per scanned
    // file — thousands per scan, enough to rotate this story off disk.
    crate::logging::debug(
        "recognize",
        match &matched {
            Some(m) => format!(
                "{:?} → {:?} ep {:?} matched #{} score {:.2} of {} candidates",
                playback.media_title, parsed.title, parsed.episode, m.media_id,
                m.score, candidates.len()
            ),
            None => format!(
                "{:?} → {:?} ep {:?} matched nothing among {} candidates",
                playback.media_title, parsed.title, parsed.episode, candidates.len()
            ),
        },
    );

    // Episode redirect (anime-relations): e.g. combined release "Ep 25"
    // → season 2, episode 1 of a different AniList entry. Anime only.
    let matched = matched.map(|m| {
        if !playback.manga {
            if let Some(ep) = parsed.episode {
                if let Some((new_id, new_ep)) = relations::redirect(rules, m.media_id, ep)
                {
                    // Invisible today, and it reads as a matcher bug: a combined
                    // release's "Ep 25" quietly becomes season 2 episode 1 of a
                    // different AniList entry.
                    crate::logging::debug(
                        "relations",
                        format!(
                            "redirect #{} ep {ep} → #{new_id} ep {new_ep}",
                            m.media_id
                        ),
                    );
                    return (new_id, Some(new_ep));
                }
            }
        }
        (m.media_id, parsed.episode)
    });

    let (media_id, episode, resolved) = match matched {
        Some((mid, ep)) => {
            let r = resolve_match(
                &candidates,
                mid,
                // Only when the id is the one *this* correction forced: a
                // redirect may have moved on to another entry, whose title
                // the stored one would misreport.
                forced
                    .as_ref()
                    .filter(|o| o.media_id == mid)
                    .map(|o| o.display_title.as_str()),
            );
            (Some(mid), ep, r)
        }
        None => (
            None,
            parsed.episode,
            Resolved {
                title: None,
                progress: None,
                total: None,
                duration_min: None,
                cover_url: None,
                status: String::new(),
            },
        ),
    };

    NowPlaying {
        process: playback.process,
        streaming: playback.streaming,
        media_type: media_type.to_string(),
        raw_title: playback.media_title,
        parsed_title: parsed.title,
        season: parsed.season,
        episode,
        source_episode,
        media_id,
        matched_title: resolved.title,
        overridden: forced.is_some(),
        progress: resolved.progress,
        total_episodes: resolved.total,
        duration_min: resolved.duration_min,
        cover_url: resolved.cover_url,
        position_sec: playback.position_sec,
        duration_sec: playback.duration_sec,
        list_status: resolved.status,
    }
}

/// The grace an episode-gap block can earn its way past: five minutes of
/// simply continuing to watch.
const GAP_GRACE: Duration = Duration::from_secs(5 * 60);

/// How many consecutive empty polls a session survives before it is dropped.
///
/// Five minutes at the 5 s poll: long enough for an ordinary pause — a door, a
/// kettle — and short enough that a player closed for good does not hold the
/// card for the rest of the evening. The card keeps showing the last state
/// while this runs down, which is the accepted trade: a stale card for a few
/// minutes is cheaper than an episode that never scrobbles.
const EMPTY_TICK_GRACE: u32 = 60;

/// Whether an armed session is still armed *this* tick.
///
/// Separate from [`auto_arm`], which answers the question once when the
/// session starts. The settings can change while an episode plays, and two of
/// them must be honoured at the moment the update comes due rather than at the
/// moment it was scheduled: switching automatic tracking off has to stop a
/// write that is already waiting, and the gap grace is opt-in the same way.
fn armed_now(enabled: bool, gap_auto: bool, phase: &Phase, has_deadline: bool) -> bool {
    enabled
        && has_deadline
        && match phase {
            Phase::Watching => true,
            Phase::Blocked(BlockReason::EpisodeGap { .. }) => gap_auto,
            _ => false,
        }
}

/// Whether an empty poll ends the session, given how many came before it.
///
/// The session survives [`EMPTY_TICK_GRACE`] of them: on any source that
/// reports only playing sessions a pause looks exactly like a stop, and
/// ending the session there restarts the threshold from zero on resume.
fn grace_spent(missed_ticks: u32) -> bool {
    missed_ticks > EMPTY_TICK_GRACE
}

/// How long until this session's automatic update arms, or `None` for never.
///
/// Watching arms at the normal threshold. An episode-gap block arms only
/// when the user opted in (`gap_auto`) — and at the *later* of the threshold
/// and [`GAP_GRACE`], so continuing to watch is what counts as being sure
/// and a mis-clicked episode has time to be walked away from. Every other
/// phase stays unarmed: a backwards write and an unplaced season have no
/// timer to earn, and a failed update is retried by hand.
fn auto_arm(
    enabled: bool,
    gap_auto: bool,
    phase: &Phase,
    threshold: Duration,
) -> Option<Duration> {
    if !enabled {
        return None;
    }
    match phase {
        Phase::Watching => Some(threshold),
        Phase::Blocked(BlockReason::EpisodeGap { .. }) if gap_auto => {
            Some(threshold.max(GAP_GRACE))
        }
        _ => None,
    }
}

/// Why this session may not auto-update, or `None` to go ahead.
///
/// Pure, and the single place the decision lives: `drive_session` builds a
/// session from it, and `perform_update` refuses anything it calls
/// unforceable, so the button on screen and the write to AniList cannot
/// disagree about what is allowed.
fn block_reason(now: &NowPlaying, episode: u32, progress: u32) -> Option<BlockReason> {
    // First, because it is the *cause* where it applies. A Jellyfin season-2
    // episode 1 detected against the season-1 entry is also "already watched",
    // and saying so would send the reader after the wrong thing entirely.
    if let Some(season) = unplaceable_season(now) {
        return Some(BlockReason::UnknownSeason { season });
    }
    if episode <= progress {
        return Some(BlockReason::AlreadyWatched { episode, progress });
    }
    if episode > progress + 1 {
        return Some(BlockReason::EpisodeGap { episode, progress });
    }
    None
}

/// The season this detection reports and cannot account for, if any.
///
/// Three things have to be true. The source named a season past the first;
/// the matcher provably could not use it (`season_informed` — a title that
/// carries no marker leaves the season inert, so the match is really a match
/// on the bare series name); and the user has not already said which entry
/// this is. The last is what makes a correction stick: once made, this
/// returns `None` and the session proceeds normally.
fn unplaceable_season(now: &NowPlaying) -> Option<u32> {
    let season = now.season.filter(|s| *s > 1)?;
    if now.overridden {
        return None;
    }
    let parsed = parser::Parsed {
        title: now.parsed_title.clone(),
        episode: now.episode,
        episode_marked: now.episode.is_some(),
        season: Some(season),
        release_group: None,
    };
    (!matcher::season_informed(&parsed)).then_some(season)
}

/// Whether a source-reported position has crossed the update point — `None`
/// when there is nothing to judge by, so the caller falls back to the wall
/// clock. Two thirds of the file's own duration when the source reports one,
/// of the entry's rounded minutes otherwise.
///
/// An explicit `delay_min` keeps the wall clock on purpose: "update after N
/// minutes" is the user's own sentence, and reinterpreting it as a fraction
/// of the file would change what the setting means the day a source starts
/// reporting positions. The wall clock also remains the safety net a paused
/// player used to abuse — with a position, pausing simply stops the number.
fn position_due(
    position_sec: Option<u32>,
    duration_sec: Option<u32>,
    duration_min: Option<u32>,
    delay_min: u32,
) -> Option<bool> {
    if delay_min > 0 {
        return None;
    }
    let pos = position_sec?;
    let total = duration_sec.or(duration_min.map(|m| m.saturating_mul(60)))?;
    if total == 0 {
        return None;
    }
    Some(u64::from(pos) * 3 >= u64::from(total) * 2)
}

/// Threshold until the auto-update: setting in minutes, or 2/3 of the
/// episode length (anime), or 5 minutes (manga), otherwise 15 minutes.
fn threshold(now: &NowPlaying, delay_min: u32) -> Duration {
    if delay_min > 0 {
        return Duration::from_secs(u64::from(delay_min) * 60);
    }
    if now.media_type == "MANGA" {
        return MANGA_THRESHOLD;
    }
    match now.duration_min {
        Some(min) => Duration::from_secs(u64::from(min) * 60 * 2 / 3),
        None => DEFAULT_THRESHOLD,
    }
}

fn epoch_ms_in(d: Duration) -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    (SystemTime::now() + d)
        .duration_since(UNIX_EPOCH)
        .map(|t| t.as_millis() as u64)
        .unwrap_or(0)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|t| t.as_millis() as i64)
        .unwrap_or(0)
}


/// Whether writing `episode` would move the list *backwards*.
///
/// A scrobble may only ever advance progress. Rewatching is the one case where
/// a lower number is meant, and it is spelled `REPEATING` — a status the user
/// sets deliberately, at which point the count is theirs to restart.
///
/// This is a data-safety rule, not a UI one, which is why it lives next to the
/// write rather than beside the button: a Jellyfin season-2 episode 1 detected
/// against a season-1 entry with progress 27 used to be one click away from
/// setting that entry back to 1, on AniList and in the local cache.
fn would_regress(episode: u32, progress: Option<u32>, list_status: &str) -> bool {
    list_status != "REPEATING" && progress.is_some_and(|p| episode <= p)
}

/// Performs the list update (including status logic and cache patch).
async fn perform_update(
    app: &AppHandle,
    media_id: i64,
    media_type: &str,
    episode: u32,
    total: Option<u32>,
    list_status: &str,
) -> Result<Outcome, String> {
    let token =
        crate::anilist::auth::load_token().ok_or("Not connected to AniList")?;

    // Read the progress the list actually holds, not what the session was
    // built with: the session may be minutes old, and this is the last point
    // before a write that cannot be taken back.
    let cached_progress = {
        let db = app.state::<Db>();
        candidates_from_cache(&db, media_type)
            .into_iter()
            .find(|c| c.media_id == media_id)
            .map(|c| c.progress)
    };
    if would_regress(episode, cached_progress, list_status) {
        return Err(format!(
            "Refusing to set progress back to {episode} from {}",
            cached_progress.unwrap_or(0)
        ));
    }

    let done = total == Some(episode);
    let status = match (done, list_status) {
        (true, _) => "COMPLETED",
        (false, "REPEATING") => "REPEATING",
        _ => "CURRENT",
    };
    let input = json!({ "mediaId": media_id, "progress": episode, "status": status });

    let db = app.state::<Db>();
    let api = app.state::<crate::anilist::client::AniList>();
    let result = crate::commands::save_entry_core(app, &db, &api, &token, input).await?;
    if result.queued {
        // Nothing reached AniList, so nothing here may claim it did: no cache
        // patch, no widget refresh, no `scrobble-done`. The queue owns it now
        // and the card says so.
        crate::logging::debug(
            "scrobble",
            format!("#{media_id} ep {episode} queued — not claiming it landed"),
        );
        return Ok(Outcome::Queued);
    }

    // Patch the local cache so the next detection sees the new state
    if let Some(user_id) = cached_user_id(&db) {
        db.update_cached_progress(user_id, media_type, media_id, episode, Some(status));
        // A scrobble is the other writer of that cache; the widgets follow.
        crate::widgets::refresh(app);
    }
    // Refresh the now-playing display
    {
        let state = app.state::<PlaybackState>();
        let mut guard = state.0.guard();
        if let Some(np) = guard.as_mut() {
            if np.media_id == Some(media_id) {
                np.progress = Some(episode);
            }
        }
        let _ = app.emit("now-playing", &guard.clone());
    }
    // The presence otherwise only refreshes when detection *changes*, so the
    // "Episode 3 / 12" text would keep showing the pre-scrobble number until
    // the user switched files.
    crate::discord::sync_current(app);
    let _ = app.emit(
        "scrobble-done",
        json!({ "mediaId": media_id, "episode": episode }),
    );
    Ok(Outcome::Landed)
}

/// Re-resolves what is playing against the corrections table, right now.
///
/// The poll loop rebuilds a match only when the detected *title* changes, so a
/// correction made mid-episode would otherwise show nothing until the next
/// file. This patches the stored `NowPlaying` in place and re-emits everything
/// that renders it, exactly as `perform_update` does after a scrobble — the
/// card, the tray and the Discord presence all read from that one object.
///
/// `drive_session` re-reads `PlaybackState` on its next tick and starts a fresh
/// session whenever `(media_id, episode)` differs, so the scrobbler follows the
/// corrected entry without being told separately.
pub fn requeue_match(app: &AppHandle) {
    let db = app.state::<Db>();
    let media_type;
    let parsed_title;
    let season;
    let source_episode;
    {
        let state = app.state::<PlaybackState>();
        let guard = state.0.guard();
        let Some(np) = guard.as_ref() else { return };
        media_type = np.media_type.clone();
        parsed_title = np.parsed_title.clone();
        season = np.season;
        // The number the *source* gave, never the resolved one: re-resolving
        // from an already-shifted episode would move it again.
        source_episode = np.source_episode;
    }

    let candidates = candidates_from_cache(&db, &media_type);
    let forced = detection_override(&db, &parsed_title, season, &media_type);

    // Same order as `build_now_playing`, and it has to stay that way: offset
    // first, then the redirect decides where that number lands.
    let episode = match (&forced, source_episode) {
        (Some(o), Some(ep)) => Some(shift_episode(ep, o.episode_offset)),
        _ => source_episode,
    };
    let picked = match &forced {
        Some(o) => Some(o.media_id),
        // Cleared: fall back to what the matcher makes of the same parse, so
        // "undo" really returns the guess rather than leaving a hole.
        None => matcher::best_match(
            &parser::Parsed {
                title: parsed_title.clone(),
                episode,
                episode_marked: episode.is_some(),
                season,
                release_group: None,
            },
            &candidates,
        )
        .map(|m| m.media_id),
    };

    // The same episode redirect the detection pass applies, for the same
    // reason: a correction settles which *series* this is, and anime-relations
    // still decides which entry a combined release's episode number lands on.
    // Without this the two paths would disagree until the title changed.
    let (picked, episode) = match picked {
        Some(mid) if media_type == "ANIME" => {
            let rules = app.state::<Relations>();
            let rules = rules.0.read().unwrap();
            match episode.and_then(|ep| relations::redirect(&rules, mid, ep)) {
                Some((new_id, new_ep)) => (Some(new_id), Some(new_ep)),
                None => (Some(mid), episode),
            }
        }
        other => (other, episode),
    };

    let resolved = picked.map(|mid| {
        (
            mid,
            resolve_match(
                &candidates,
                mid,
                forced
                    .as_ref()
                    .filter(|o| o.media_id == mid)
                    .map(|o| o.display_title.as_str()),
            ),
        )
    });

    // Patch under the lock, then let go of it before telling anyone: the poll
    // loop's own idiom, and `discord::sync` takes the session lock on its way
    // through. Holding two of these at once is how a lock order becomes a
    // deadlock the day one of them grows a caller.
    let patched = {
        let state = app.state::<PlaybackState>();
        let mut guard = state.0.guard();
        if let Some(np) = guard.as_mut() {
            np.overridden = forced.is_some();
            // The resolved number, so `drive_session` starts its next session
            // on the episode the correction actually names.
            np.episode = episode;
            match resolved {
                Some((mid, r)) => {
                    np.media_id = Some(mid);
                    np.matched_title = r.title;
                    np.progress = r.progress;
                    np.total_episodes = r.total;
                    np.duration_min = r.duration_min;
                    np.cover_url = r.cover_url;
                    np.list_status = r.status;
                }
                None => {
                    np.media_id = None;
                    np.matched_title = None;
                    np.progress = None;
                    np.total_episodes = None;
                    np.duration_min = None;
                    np.cover_url = None;
                    np.list_status = String::new();
                }
            }
        }
        guard.clone()
    };

    let _ = app.emit("now-playing", &patched);
    crate::discord::sync(app, patched.as_ref());
    crate::tray_set_now_playing(
        app,
        patched
            .as_ref()
            .map(|n| n.matched_title.as_deref().unwrap_or(&n.parsed_title)),
    );

    // The running session was started for the *old* id; dropping it makes the
    // next tick build one for the corrected entry rather than scrobbling the
    // episode onto whatever the matcher had guessed.
    *app.state::<ScrobbleSession>().0.guard() = None;
    emit_session(app, None);
}

/// Confirms (or discards) the pending update — invoked by the frontend
/// through the `scrobble_now` / `scrobble_cancel` commands.
pub async fn confirm_pending(app: AppHandle, accept: bool) -> Result<(), String> {
    confirm_pending_impl(app, accept, None).await
}

/// The toast button's path: confirm only the session the toast was raised
/// for. The check happens under the same lock that reads the session out, so
/// a click arriving after the next episode started fails here instead of
/// stamping its confirmation onto whatever is pending now.
#[cfg(any(windows, target_os = "linux"))]
pub async fn confirm_pending_for(
    app: AppHandle,
    media_id: i64,
    episode: u32,
) -> Result<(), String> {
    confirm_pending_impl(app, true, Some((media_id, episode))).await
}

async fn confirm_pending_impl(
    app: AppHandle,
    accept: bool,
    expect: Option<(i64, u32)>,
) -> Result<(), String> {
    let data = {
        let state = app.state::<ScrobbleSession>();
        let mut guard = state.0.guard();
        let Some(session) = guard.as_mut() else {
            return Err("Nothing is currently playing".into());
        };
        if let Some((mid, ep)) = expect {
            if !applies_to(session, mid, ep) || session.phase != Phase::Pending {
                return Err("That update has moved on".into());
            }
        }
        if !accept {
            session.phase = Phase::Cancelled;
            emit_session(&app, Some(session));
            return Ok(());
        }
        // Nothing left to confirm. The tray item is always enabled and carries
        // no `expect`, so without this a press after a successful scrobble ran
        // the update again, tripped `would_regress`, and turned a finished
        // session's `Updated` into a `Blocked(Failed)` on the card.
        match &session.phase {
            Phase::Updated => return Err("That episode is already updated".into()),
            Phase::Updating => return Err("That update is already running".into()),
            _ => {}
        }
        // A block the user is not allowed to override stays blocked, whatever
        // asked. The card hides the button for these, so reaching here means
        // a stale event or a caller that never saw it — either way the answer
        // is the same one the phase already gave.
        if let Phase::Blocked(reason) = &session.phase {
            if !reason.forceable() {
                return Err(format!("Not updating: {reason}"));
            }
        }
        session.phase = Phase::Updating;
        let d = (
            session.media_id,
            session.media_type.clone(),
            session.episode,
            session.total,
            session.list_status.clone(),
        );
        emit_session(&app, Some(session));
        d
    };

    let result = perform_update(&app, data.0, &data.1, data.2, data.3, &data.4).await;
    let state = app.state::<ScrobbleSession>();
    let mut guard = state.0.guard();
    if let Some(session) = guard.as_mut() {
        if applies_to(session, data.0, data.2) {
            session.phase = match &result {
                Ok(Outcome::Landed) => Phase::Updated,
                Ok(Outcome::Queued) => Phase::Queued,
                Err(e) => Phase::Blocked(BlockReason::Failed { message: e.clone() }),
            };
            emit_session(&app, Some(session));
        }
    }
    // The caller only needs to know it did not fail; which of the two ways it
    // succeeded is already on the card.
    result.map(|_| ())
}

/// Starts the detection and scrobble loop (runs for the app's lifetime).
///
/// Supervised, because this is the loop whose silent death is most visible and
/// least explicable: a panic here used to end detection for the session, and the
/// only symptom was that scrobbling stopped happening.
pub fn spawn(app: AppHandle) {
    crate::logging::supervise("scrobbler", move || {
        let app = app.clone();
        async move {
        let mut last_raw: Option<(String, String)> = None;
        loop {
            let (media_detection, jellyfin, mpv) = {
                let db = app.state::<Db>();
                (
                    crate::commands::read_media_detection(&db),
                    crate::commands::jellyfin_config(&db),
                    crate::commands::mpv_ipc_config(&db),
                )
            };
            let playback = detection::detect_playback(media_detection, jellyfin, mpv).await;
            let raw = playback
                .as_ref()
                .map(|p| (p.process.clone(), p.media_title.clone()));

            // The block below rebuilds the match only when the *title* changes,
            // but the position moves every tick of the same title. Patch it in
            // place first, whatever happens next: without this the deadline
            // check judges the session-start position forever — and since a
            // position verdict of "not yet" suppresses the wall-clock fallback,
            // a source that reports positions would simply never scrobble.
            if raw == last_raw {
                if let Some(p) = playback.as_ref() {
                    let state = app.state::<PlaybackState>();
                    let mut guard = state.0.guard();
                    if let Some(np) = guard.as_mut() {
                        np.position_sec = p.position_sec;
                        np.duration_sec = p.duration_sec;
                    }
                }
            }

            if raw != last_raw {
                // What detection saw. Per *change*, never per tick: the poll runs
                // every 5s, so a line here would be 17,280 a day and would rotate
                // everything else off a 1 MB file.
                //
                // `debug_changed` rather than `debug`, because "changed" is not
                // the same as "different from last time": two sources that
                // disagree make this branch fire every single tick while
                // alternating, which is the 17,280 lines the paragraph above
                // is about — from the one line meant to prevent them.
                crate::logging::debug_changed(
                    "detect",
                    "playback",
                    format!("playback changed: {last_raw:?} → {raw:?}"),
                );
                last_raw = raw;
                let now = {
                    let db = app.state::<Db>();
                    let rules = app.state::<Relations>();
                    let rules = rules.0.read().unwrap().clone();
                    playback.map(|p| build_now_playing(&db, &rules, p))
                };
                *app.state::<PlaybackState>().0.guard() = now.clone();
                let _ = app.emit("now-playing", &now);
                crate::discord::sync(&app, now.as_ref());
                // The tray mirrors the same change: menu row + tooltip.
                crate::tray_set_now_playing(
                    &app,
                    now.as_ref()
                        .map(|n| n.matched_title.as_deref().unwrap_or(&n.parsed_title)),
                );
            }

            drive_session(&app).await;
            tokio::time::sleep(POLL_INTERVAL).await;
        }
        }
    });
}

/// One tick of the scrobble state machine.
async fn drive_session(app: &AppHandle) {
    let now_playing = app.state::<PlaybackState>().0.guard().clone();
    let settings = {
        let db = app.state::<Db>();
        crate::commands::read_scrobble_settings(&db)
    };

    // Phase decision under the lock, the update itself afterwards (no
    // await while holding the mutex).
    let update_data = {
        let state = app.state::<ScrobbleSession>();
        let mut guard = state.0.guard();

        match now_playing {
            Some(np) if np.media_id.is_some() && np.episode.is_some() => {
                let (mid, ep) = (np.media_id.unwrap(), np.episode.unwrap());
                let is_same = guard
                    .as_ref()
                    .is_some_and(|s| s.media_id == mid && s.episode == ep);

                if !is_same {
                    // Start a new session
                    let threshold = threshold(&np, settings.delay_min);
                    let progress = np.progress.unwrap_or(0);
                    let phase = block_reason(&np, ep, progress)
                        .map(Phase::Blocked)
                        .unwrap_or(Phase::Watching);
                    let armed_in = auto_arm(settings.enabled, settings.gap_auto, &phase, threshold);
                    let session = Session {
                        media_id: mid,
                        media_type: np.media_type.clone(),
                        episode: ep,
                        total: np.total_episodes,
                        list_status: np.list_status.clone(),
                        started_ms: now_ms(),
                        update_at: armed_in.map(|d| Instant::now() + d),
                        update_at_epoch_ms: armed_in.map(epoch_ms_in),
                        phase,
                        missed_ticks: 0,
                    };
                    // The two `Blocked` reasons are the most-asked "why didn't it
                    // scrobble", and until now they existed only as a transient
                    // event to the WebView — nothing reached disk.
                    crate::logging::debug(
                        "scrobble",
                        format!(
                            "session #{mid} ep {ep} (progress {progress}) → {:?}, auto {}",
                            session.phase,
                            armed_in.is_some()
                        ),
                    );
                    emit_session(app, Some(&session));
                    *guard = Some(session);
                    None
                } else {
                    // Existing session: check the threshold. A position from
                    // the source is believed over the wall clock — it is the
                    // clock, one that pausing actually stops — but only while
                    // the auto-update is armed at all (`update_at` present).
                    // An armed gap block rides the same check: the settings
                    // are re-read every tick, so switching the grace off
                    // disarms a waiting gap immediately, while `update_at`
                    // was only ever set if it was on when the session began.
                    let session = guard.as_mut().unwrap();
                    // Playing again (or still), so the pause grace starts over.
                    session.missed_ticks = 0;
                    // `enabled` is re-read here, not just at `auto_arm`: turning
                    // automatic tracking off mid-episode used to leave an
                    // already-armed session to fire anyway, up to a full
                    // threshold later, which is precisely what the switch is
                    // asked to prevent.
                    let armed = armed_now(
                        settings.enabled,
                        settings.gap_auto,
                        &session.phase,
                        session.update_at.is_some(),
                    );
                    // A gap block waits out `GAP_GRACE` on the wall clock and
                    // nothing else. A source-reported position must not
                    // short-circuit it: resuming a part-watched episode already
                    // sits past two thirds, so believing the position here
                    // would lift the block within one 5 s tick and hand the
                    // grace no time to mean anything.
                    let gap_armed =
                        matches!(session.phase, Phase::Blocked(BlockReason::EpisodeGap { .. }));
                    let wall_due = session.update_at.is_some_and(|at| Instant::now() >= at);
                    let due = armed
                        && if gap_armed {
                            wall_due
                        } else {
                            position_due(
                                np.position_sec,
                                np.duration_sec,
                                np.duration_min,
                                settings.delay_min,
                            )
                            .unwrap_or(wall_due)
                        };
                    if !due {
                        None
                    } else if settings.confirm {
                        session.phase = Phase::Pending;
                        crate::logging::debug(
                            "scrobble",
                            format!(
                                "#{} ep {} due, waiting for confirmation",
                                session.media_id, session.episode
                            ),
                        );
                        emit_session(app, Some(session));
                        // The window may be hidden in the tray, so the ask
                        // also goes to the desk — with the one button that is
                        // the whole point. Fires once per session: reachable
                        // only from `Watching` or an armed gap block, and both
                        // leave those phases here.
                        let lang = crate::i18n::lang(&app.state::<Db>());
                        let body = crate::i18n::text(
                            lang,
                            if session.media_type == "MANGA" {
                                crate::i18n::Msg::ConfirmChapter { chapter: session.episode }
                            } else {
                                crate::i18n::Msg::ConfirmEpisode { episode: session.episode }
                            },
                        );
                        crate::alerts::notify::notify_scrobble_confirm(
                            app,
                            np.matched_title.as_deref().unwrap_or(&np.parsed_title),
                            &body,
                            session.media_id,
                            session.episode,
                        );
                        None
                    } else {
                        session.phase = Phase::Updating;
                        crate::logging::debug(
                            "scrobble",
                            format!(
                                "#{} ep {} due, updating",
                                session.media_id, session.episode
                            ),
                        );
                        emit_session(app, Some(session));
                        Some((
                            session.media_id,
                            session.media_type.clone(),
                            session.episode,
                            session.total,
                            session.list_status.clone(),
                        ))
                    }
                }
            }
            _ => {
                // Nothing detected this tick. That is a pause as often as it is
                // a stop, and the two are indistinguishable from here, so the
                // session is held — with its `update_at` intact — until the
                // grace runs out.
                if let Some(session) = guard.as_mut() {
                    session.missed_ticks = session.missed_ticks.saturating_add(1);
                    if grace_spent(session.missed_ticks) {
                        *guard = None;
                        emit_session(app, None);
                    }
                }
                None
            }
        }
    };

    if let Some((mid, mtype, ep, total, status)) = update_data {
        let result = perform_update(app, mid, &mtype, ep, total, &status).await;
        let state = app.state::<ScrobbleSession>();
        let mut guard = state.0.guard();
        if let Some(session) = guard.as_mut() {
            if applies_to(session, mid, ep) {
                session.phase = match result {
                    Ok(Outcome::Landed) => Phase::Updated,
                    Ok(Outcome::Queued) => Phase::Queued,
                    Err(e) => Phase::Blocked(BlockReason::Failed { message: e }),
                };
                emit_session(app, Some(session));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        applies_to, armed_now, auto_arm, block_reason, grace_spent, position_due, shift_episode,
        threshold, would_regress, BlockReason, NowPlaying, Phase, Session, DEFAULT_THRESHOLD,
        EMPTY_TICK_GRACE, GAP_GRACE, MANGA_THRESHOLD, POLL_INTERVAL,
    };
    use std::time::Duration;

    fn now_playing(media_type: &str, duration_min: Option<u32>) -> NowPlaying {
        NowPlaying {
            process: "mpv".into(),
            streaming: false,
            media_type: media_type.into(),
            raw_title: String::new(),
            parsed_title: String::new(),
            season: None,
            episode: Some(1),
            source_episode: Some(1),
            media_id: Some(1),
            matched_title: None,
            overridden: false,
            progress: Some(0),
            total_episodes: Some(12),
            duration_min,
            cover_url: None,
            position_sec: None,
            duration_sec: None,
            list_status: "CURRENT".into(),
        }
    }

    /// The data-safety rule. A scrobble may advance progress and never lower
    /// it — the Jellyfin season-2 case (episode 1 detected against a
    /// season-1 entry sitting at 27) was one click from writing 1.
    #[test]
    fn a_scrobble_can_only_ever_move_progress_forward() {
        assert!(would_regress(1, Some(27), "CURRENT"));
        assert!(would_regress(27, Some(27), "CURRENT"), "the same episode is not progress");
        assert!(!would_regress(28, Some(27), "CURRENT"));
        // Forcing over a gap is still allowed: it moves forward.
        assert!(!would_regress(31, Some(27), "CURRENT"));
        // Rewatching is the one place a lower number is meant, and the user
        // set that status themselves.
        assert!(!would_regress(1, Some(27), "REPEATING"));
        // Nothing cached to compare against: not our call to refuse.
        assert!(!would_regress(1, None, "CURRENT"));
    }

    /// The card's button and the command that would carry it out must agree,
    /// which is why `forceable` is one function rather than two opinions.
    #[test]
    fn only_a_forward_force_or_a_retry_is_offered() {
        assert!(!BlockReason::AlreadyWatched { episode: 1, progress: 27 }.forceable());
        assert!(BlockReason::EpisodeGap { episode: 9, progress: 2 }.forceable());
        assert!(BlockReason::Failed { message: "timeout".into() }.forceable());
    }

    #[test]
    fn the_block_decision_names_which_way_it_went_wrong() {
        let np = now_playing("ANIME", None);
        assert!(matches!(
            block_reason(&np, 1, 27),
            Some(BlockReason::AlreadyWatched { episode: 1, progress: 27 })
        ));
        assert!(matches!(
            block_reason(&np, 9, 2),
            Some(BlockReason::EpisodeGap { .. })
        ));
        // The ordinary case: the very next episode.
        assert!(block_reason(&np, 3, 2).is_none());
    }

    /// The gap grace: continuing to watch is what counts as being sure.
    /// Opt-in, never under five minutes, never earlier than the normal
    /// threshold — and no other block can earn a timer.
    #[test]
    fn a_gap_block_arms_only_when_opted_in_and_never_under_five_minutes() {
        let gap = Phase::Blocked(BlockReason::EpisodeGap { episode: 9, progress: 2 });
        let short = Duration::from_secs(60);
        let long = Duration::from_secs(20 * 60);

        assert_eq!(auto_arm(true, true, &Phase::Watching, short), Some(short));
        assert_eq!(auto_arm(true, true, &gap, short), Some(GAP_GRACE));
        assert_eq!(auto_arm(true, true, &gap, long), Some(long));
        assert_eq!(auto_arm(true, false, &gap, short), None, "opt-in only");
        assert_eq!(auto_arm(false, true, &gap, short), None, "scrobbling off");
        assert_eq!(
            auto_arm(
                true,
                true,
                &Phase::Blocked(BlockReason::AlreadyWatched { episode: 1, progress: 5 }),
                short,
            ),
            None,
            "a backwards write earns no timer"
        );
        assert_eq!(
            auto_arm(
                true,
                true,
                &Phase::Blocked(BlockReason::UnknownSeason { season: 2 }),
                short,
            ),
            None,
            "an unplaced season earns no timer"
        );
    }

    /// The Beyblade case. Jellyfin reports season 2 beside a bare series
    /// name, so the matcher never saw the season and landed on the season-1
    /// entry — where episode 1 is both wrong and, at progress 27, "already
    /// watched". The season is the cause and has to be the thing reported.
    #[test]
    fn a_season_the_matcher_could_not_use_blocks_before_anything_else() {
        let mut np = now_playing("ANIME", None);
        np.parsed_title = "Beyblade: Metal Fusion".into();
        np.season = Some(2);

        assert!(matches!(
            block_reason(&np, 1, 27),
            Some(BlockReason::UnknownSeason { season: 2 })
        ));
        // Not forceable: scrobbling would write to the wrong entry.
        assert!(!BlockReason::UnknownSeason { season: 2 }.forceable());

        // Corrected once, it never asks again.
        np.overridden = true;
        assert!(matches!(
            block_reason(&np, 1, 27),
            Some(BlockReason::AlreadyWatched { .. })
        ));
    }

    /// The offset is what lets a correction name an *episode*, for the layout
    /// where a server splits one continuously-numbered entry into cours.
    #[test]
    fn an_offset_moves_the_episode_and_never_below_one() {
        // Jellyfin S2E1 of a 2-cour entry is episode 13.
        assert_eq!(shift_episode(1, 12), 13);
        assert_eq!(shift_episode(11, 12), 23);
        // A source numbering *ahead* of AniList is the same tool, negated.
        assert_eq!(shift_episode(27, -26), 1);
        // Nonsense cannot produce episode 0, which is not a thing to write.
        assert_eq!(shift_episode(1, -5), 1);
        assert_eq!(shift_episode(1, 0), 1);
    }

    /// A release name that carries its own season marker was matched *with*
    /// the season, so it is not ambiguous and must not be blocked.
    #[test]
    fn a_season_spelled_in_the_title_is_left_alone() {
        let mut np = now_playing("ANIME", None);
        np.parsed_title = "Kusuriya no Hitorigoto 2nd Season".into();
        np.season = Some(2);
        assert!(block_reason(&np, 3, 2).is_none());

        // And season one is never ambiguous: there is nothing to place.
        np.parsed_title = "Frieren".into();
        np.season = Some(1);
        assert!(block_reason(&np, 3, 2).is_none());
    }

    /// The position crosses at exactly two thirds, not a second before.
    #[test]
    fn a_position_is_due_at_two_thirds_of_the_file() {
        // 24 min file: 1440 s, two thirds is 960.
        assert_eq!(position_due(Some(959), Some(1440), None, 0), Some(false));
        assert_eq!(position_due(Some(960), Some(1440), None, 0), Some(true));
    }

    /// The file's own duration beats the entry's rounded minutes.
    #[test]
    fn the_sources_duration_beats_the_entrys_minutes() {
        // The entry says 24 min (due at 960 s) but the file is 20 min
        // (due at 800 s) — a position of 810 is due by the file's truth.
        assert_eq!(position_due(Some(810), Some(1200), Some(24), 0), Some(true));
        // Without the source duration the entry's minutes decide.
        assert_eq!(position_due(Some(810), None, Some(24), 0), Some(false));
    }

    /// "Update after N minutes" is the user's own sentence; a position must
    /// not reinterpret it. And with nothing to judge by, there is no verdict.
    #[test]
    fn a_position_stands_down_for_an_explicit_delay_or_missing_data() {
        assert_eq!(position_due(Some(2000), Some(1440), None, 3), None);
        assert_eq!(position_due(None, Some(1440), Some(24), 0), None);
        assert_eq!(position_due(Some(900), None, None, 0), None);
        assert_eq!(position_due(Some(900), Some(0), None, 0), None);
    }

    /// An explicit delay setting wins over everything the entry knows.
    #[test]
    fn the_configured_delay_beats_the_episode_length() {
        assert_eq!(
            threshold(&now_playing("ANIME", Some(24)), 3),
            Duration::from_secs(180)
        );
    }

    /// Two thirds of the episode, from the length matching already found.
    #[test]
    fn a_known_episode_length_gives_two_thirds_of_it() {
        assert_eq!(
            threshold(&now_playing("ANIME", Some(24)), 0),
            Duration::from_secs(24 * 60 * 2 / 3)
        );
    }

    #[test]
    fn an_unknown_episode_length_falls_back() {
        assert_eq!(threshold(&now_playing("ANIME", None), 0), DEFAULT_THRESHOLD);
    }

    /// Reading is faster, and chapters carry no duration to reason from.
    #[test]
    fn manga_uses_its_own_threshold() {
        assert_eq!(threshold(&now_playing("MANGA", None), 0), MANGA_THRESHOLD);
    }

    fn session(media_id: i64, episode: u32) -> Session {
        Session {
            media_id,
            media_type: "ANIME".into(),
            episode,
            total: Some(12),
            list_status: "CURRENT".into(),
            started_ms: 0,
            update_at: None,
            update_at_epoch_ms: None,
            phase: Phase::Watching,
            missed_ticks: 0,
        }
    }

    /// The P1 this grace exists for: on a media-session-only player a pause
    /// makes `is_playing` false, detection returns nothing, and the session
    /// used to be destroyed on that single tick — taking the accumulated watch
    /// time with it and restarting the threshold from zero on resume. On Linux
    /// there is no window-title rung to fall back to, so this is every player.
    #[test]
    fn a_pause_does_not_end_the_session() {
        assert!(!grace_spent(0), "the tick that just happened");
        assert!(!grace_spent(1));
        assert!(
            !grace_spent(EMPTY_TICK_GRACE),
            "still inside the grace at the boundary"
        );
        assert!(
            grace_spent(EMPTY_TICK_GRACE + 1),
            "a player closed for good does eventually let go"
        );
    }

    /// Five minutes at the 5 s poll. Written down because the constant is a
    /// tick count and the promise is a duration.
    #[test]
    fn the_grace_is_five_minutes_of_polls() {
        assert_eq!(EMPTY_TICK_GRACE * POLL_INTERVAL.as_secs() as u32, 300);
    }

    /// Turning automatic tracking off must stop a write that is already
    /// waiting. `auto_arm` answers only at session start, so before this the
    /// switch had no effect until the next episode.
    #[test]
    fn switching_automatic_updates_off_disarms_a_waiting_session() {
        let watching = Phase::Watching;
        assert!(armed_now(true, false, &watching, true));
        assert!(
            !armed_now(false, false, &watching, true),
            "off means off, mid-episode included"
        );
        assert!(
            !armed_now(true, false, &watching, false),
            "nothing to disarm without a deadline"
        );
    }

    /// The gap grace is opt-in at the due point too, and no other blocked
    /// phase ever arms.
    #[test]
    fn only_a_gap_block_arms_and_only_when_opted_in() {
        let gap = Phase::Blocked(BlockReason::EpisodeGap { episode: 9, progress: 5 });
        assert!(armed_now(true, true, &gap, true));
        assert!(!armed_now(true, false, &gap, true));
        let watched = Phase::Blocked(BlockReason::AlreadyWatched { episode: 3, progress: 12 });
        assert!(!armed_now(true, true, &watched, true));
    }

    #[test]
    fn the_result_applies_to_the_session_it_was_started_for() {
        assert!(applies_to(&session(1, 5), 1, 5));
    }

    /// The case that made this a bug: the poll loop swapped in the next
    /// episode while the AniList request was in flight. Stamping "updated"
    /// here would both lie about episode 6 and — because the threshold only
    /// fires on `Watching` — stop it ever being scrobbled.
    #[test]
    fn a_newer_episode_of_the_same_media_does_not_take_the_result() {
        assert!(!applies_to(&session(1, 6), 1, 5));
    }

    /// Switching to a different series entirely is the same hazard.
    #[test]
    fn a_different_media_does_not_take_the_result() {
        assert!(!applies_to(&session(2, 5), 1, 5));
    }
}
