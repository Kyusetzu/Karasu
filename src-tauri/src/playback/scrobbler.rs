//! The detection and scrobble loop: watch, parse, match, and write progress once the threshold has passed.

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
/// How long a due session defers to a higher-ranked Karasu; keep it longer than `jellyfin::FRESH`.
pub const YIELD_GRACE: Duration = Duration::from_secs(3 * 60);
/// The screen-off poll cadence, Android only; safe because the deadline is wall clock or position, not ticks.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
const HIDDEN_POLL_INTERVAL: Duration = Duration::from_secs(15);
/// How long a refused start of the Android tracking service is left alone before the next attempt.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
const SERVICE_RETRY: Duration = Duration::from_secs(60);
/// How often the loop reports its own tick count, and only while verbose logging is on.
const POLL_REPORT: Duration = Duration::from_secs(5 * 60);

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
    /// The season the parse carried; half of a correction's key, so the picker has to send it back.
    pub season: Option<u32>,
    /// The episode as resolved: the source's number plus any correction offset, then the relations redirect.
    pub episode: Option<u32>,
    /// The episode as the source reported it; re-resolving from the shifted one would shift it again.
    #[serde(rename = "sourceEpisode")]
    pub source_episode: Option<u32>,
    /// AniList media ID on a successful match against the list
    #[serde(rename = "mediaId")]
    pub media_id: Option<i64>,
    #[serde(rename = "matchedTitle")]
    pub matched_title: Option<String>,
    /// Whether this match came from the user's own correction; drives the "undo" affordance, nothing else.
    pub overridden: bool,
    /// Current list progress of the matched entry
    pub progress: Option<u32>,
    #[serde(rename = "totalEpisodes")]
    pub total_episodes: Option<u32>,
    /// Episode length in minutes, kept from matching so nothing re-parses the cached list for it.
    #[serde(skip)]
    pub duration_min: Option<u32>,
    /// `coverImage.large` for the Discord presence card; the frontend draws covers from its own cache.
    #[serde(skip)]
    pub cover_url: Option<String>,
    /// Playback position in seconds, refreshed every poll when the source reports one; the deadline check reads it.
    #[serde(skip)]
    pub position_sec: Option<u32>,
    /// The file's own duration in seconds, which beats the entry's rounded minutes when both exist.
    #[serde(skip)]
    pub duration_sec: Option<u32>,
    /// List status of the matched entry when detection started.
    #[serde(skip)]
    pub list_status: String,
}

/// Currently detected playback, shared by commands and the scrobbler.
pub struct PlaybackState(pub Mutex<Option<NowPlaying>>);

/// Why an auto-update will not happen, as a code the frontend translates rather than a sentence.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum BlockReason {
    /// At or behind the list's progress; forcing it would lower progress, so the card offers no button.
    AlreadyWatched { episode: u32, progress: u32 },
    /// Detected well ahead of the list; forcing moves progress forward, so the card keeps its button.
    EpisodeGap { episode: u32, progress: u32 },
    /// The source reported a season the matcher could not use, and nobody has said which entry it is.
    UnknownSeason { season: u32 },
    /// The API refused the update, so a retry is the right offer and the message is the server's own.
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
    /// Whether "Update now" may override this; forcing forward or retrying is fine, going backward is not.
    pub fn forceable(&self) -> bool {
        matches!(
            self,
            BlockReason::EpisodeGap { .. } | BlockReason::Failed { .. }
        )
    }
}

/// Who a `Yielding` session is waiting for, for the card.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YieldTarget {
    pub platform: detection::jellyfin::Platform,
    pub device: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Phase {
    Watching,
    /// Due, but an outranking Karasu gets the first write; not a `Blocked`, so "Now" forces straight through.
    Yielding(YieldTarget),
    Pending,
    Updating,
    Updated,
    /// Written to the offline queue, not yet accepted by AniList; `Updated` is a claim about the server.
    Queued,
    Blocked(BlockReason),
    Cancelled,
}

/// What a write did; `Queued` is not success, so no caller may treat it as landed.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Landed,
    Queued,
    /// Refused here before sending; a real block reason, so the card translates it and offers no futile retry.
    Refused(BlockReason),
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
    /// Wall-clock start of this session in ms since epoch; drives the Discord presence progress bar.
    pub started_ms: i64,
    /// When the auto-update is due (None = auto-update disabled)
    pub update_at: Option<Instant>,
    pub update_at_epoch_ms: Option<u64>,
    pub phase: Phase,
    /// Consecutive empty polls; a pause looks like a stop, so the session is held rather than dropped.
    pub missed_ticks: u32,
}

/// Running scrobble session (shared between the loop and commands).
pub struct ScrobbleSession(pub Mutex<Option<Session>>);

/// Whether a finished update still belongs to the session in state, which the loop may have replaced meanwhile.
fn applies_to(session: &Session, media_id: i64, episode: u32) -> bool {
    session.media_id == media_id && session.episode == episode
}

#[derive(Clone, serde::Serialize)]
struct ScrobbleEvent {
    phase: String,
    reason: Option<BlockReason>,
    /// Whether the card may offer "Update now"; emitted so the button and the refusing command cannot drift apart.
    forceable: bool,
    #[serde(rename = "mediaId")]
    media_id: Option<i64>,
    episode: Option<u32>,
    #[serde(rename = "updateAtMs")]
    update_at_ms: Option<u64>,
    /// The Karasu a `yielding` session waits for; `None` in every other phase.
    #[serde(rename = "yieldingTo")]
    yielding_to: Option<YieldTarget>,
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
            yielding_to: None,
        },
        Some(s) => ScrobbleEvent {
            phase: match &s.phase {
                Phase::Watching => "watching",
                Phase::Yielding(_) => "yielding",
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
            // Everything that is not a block is forceable; that is what the button has always meant outside this phase.
            forceable: match &s.phase {
                Phase::Blocked(r) => r.forceable(),
                _ => true,
            },
            media_id: Some(s.media_id),
            episode: Some(s.episode),
            update_at_ms: match &s.phase {
                Phase::Watching => s.update_at_epoch_ms,
                // An armed gap block carries its lift time so the card can say when; unarmed blocks never got an epoch.
                Phase::Blocked(BlockReason::EpisodeGap { .. }) => s.update_at_epoch_ms,
                // The end of the grace, so the card can count down the wait.
                Phase::Yielding(_) => s.update_at_epoch_ms,
                _ => None,
            },
            yielding_to: match &s.phase {
                Phase::Yielding(target) => Some(target.clone()),
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

/// Builds matching candidates from the SQLite list cache; for MANGA, `episodes` carries the chapter count.
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

/// `-1` for a parse with no season, because SQLite treats each NULL in a primary key as distinct.
pub(crate) fn season_key(season: Option<u32>) -> i32 {
    season.map(|s| s as i32).unwrap_or(-1)
}

/// The user's correction for this parse; the table holds a handful of rows, so it is read whole.
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

/// The episode a correction says this really is, floored at 1 because episode 0 is not a thing to write.
pub(crate) fn shift_episode(episode: u32, offset: i32) -> u32 {
    let shifted = i64::from(episode) + i64::from(offset);
    shifted.clamp(1, u32::MAX as i64) as u32
}

/// What `resolve_match` found; a struct rather than a tuple, because six positional fields is a puzzle.
struct Resolved {
    title: Option<String>,
    progress: Option<u32>,
    total: Option<u32>,
    duration_min: Option<u32>,
    cover_url: Option<String>,
    status: String,
}

/// What the cached list knows about a matched id, shared by detection and the correction command.
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
    // A source that already knows the series and episode supplies them; re-parsing its string would lose that.
    let parsed = match playback.parsed.clone() {
        Some(p) => p,
        None if playback.manga => parser::parse_manga(&playback.media_title),
        None => parser::parse(&playback.media_title),
    };
    let candidates = candidates_from_cache(db, media_type);

    // The user's own answer comes before the fuzzy sweep, the same precedence `index_files` gives the scanner.
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
    // Offset before redirect: a correction says which episode this is, relations then decide where it lands.
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

    // Logged here while the score exists, not in the matcher, where a line per scanned file would rotate the log.
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

    // The anime-relations episode redirect, anime only.
    let matched = matched.map(|m| {
        if !playback.manga {
            if let Some(ep) = parsed.episode {
                if let Some((new_id, new_ep)) = relations::redirect(rules, m.media_id, ep)
                {
                    // Otherwise invisible, and it reads as a matcher bug when an episode lands on another entry.
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
                // Only when the id is the one this correction forced: a redirect may have moved on to another entry.
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

/// The grace an episode-gap block can earn its way past by simply continuing to watch.
const GAP_GRACE: Duration = Duration::from_secs(5 * 60);

/// How many empty polls a session survives: long enough for a pause, short enough to let a closed player go.
const EMPTY_TICK_GRACE: u32 = 60;

/// Whether an armed session is still armed this tick; the tick re-reads what the tick decides on.
fn armed_now(enabled: bool, gap_auto: bool, phase: &Phase, has_deadline: bool) -> bool {
    enabled
        && has_deadline
        && match phase {
            Phase::Watching => true,
            // A yield is a wait, not a write: its deadline is the end of the grace and has to fire.
            Phase::Yielding(_) => true,
            Phase::Blocked(BlockReason::EpisodeGap { .. }) => gap_auto,
            _ => false,
        }
}

/// Whether an empty poll ends the session; a pause looks like a stop, so it survives `EMPTY_TICK_GRACE` of them.
fn grace_spent(missed_ticks: u32) -> bool {
    missed_ticks > EMPTY_TICK_GRACE
}

/// Whether to start, stop or leave the tracking service; pure, so tested everywhere but only called on Android.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn service_transition(
    running: bool,
    want: bool,
    foreground: bool,
    last_attempt: Option<Instant>,
    now: Instant,
) -> Option<bool> {
    match (running, want) {
        (true, false) => Some(false),
        (false, true)
            if foreground
                && last_attempt.is_none_or(|t| now.duration_since(t) >= SERVICE_RETRY) =>
        {
            Some(true)
        }
        _ => None,
    }
}

/// Cfg'd pair: Android keeps the foreground service in step with the tick's own reading of the setting.
#[cfg(target_os = "android")]
fn assert_tracking_service(app: &AppHandle, want: bool) {
    static STATE: Mutex<(bool, Option<Instant>)> = Mutex::new((false, None));
    let now = Instant::now();
    let decision = {
        let state = STATE.guard();
        service_transition(state.0, want, crate::background::is_foreground(), state.1, now)
    };
    let Some(on) = decision else { return };
    let (title, body) = {
        let lang = crate::i18n::lang(&app.state::<Db>());
        (
            crate::i18n::text(lang, crate::i18n::Msg::TrackingServiceTitle),
            crate::i18n::text(lang, crate::i18n::Msg::TrackingServiceBody),
        )
    };
    let mut state = STATE.guard();
    match crate::background::tracking_service(on, &title, &body) {
        Ok(()) => {
            *state = (on, None);
            crate::logging::info(
                "scrobble",
                if on { "background tracking service started" } else { "background tracking service stopped" },
            );
        }
        Err(e) => {
            state.1 = Some(now);
            crate::logging::warn(
                "scrobble",
                format!("tracking service {}: {e}", if on { "start refused" } else { "stop failed" }),
            );
        }
    }
}

#[cfg(not(target_os = "android"))]
fn assert_tracking_service(_app: &AppHandle, _want: bool) {}

/// The tick's sleep, slower with the activity paused; only Android reports the difference.
#[cfg(target_os = "android")]
fn poll_interval() -> Duration {
    if crate::background::is_foreground() {
        POLL_INTERVAL
    } else {
        HIDDEN_POLL_INTERVAL
    }
}

#[cfg(not(target_os = "android"))]
fn poll_interval() -> Duration {
    POLL_INTERVAL
}

/// Whether a due session yields to another Karasu, once; afterwards `perform_update`'s live check stops a duplicate.
fn defer_for_peer(
    phase: &Phase,
    snapshot: Option<detection::jellyfin::PeerSnapshot>,
) -> Option<YieldTarget> {
    if matches!(phase, Phase::Yielding(_)) {
        return None;
    }
    let snapshot = snapshot?;
    let own = snapshot.own.as_ref()?;
    let peer = detection::jellyfin::yield_to(&snapshot.peers, own, detection::jellyfin::FRESH)?;
    Some(YieldTarget {
        platform: peer.platform,
        device: peer.device_name.clone(),
    })
}

/// How long until the auto-update arms; a gap block arms only when opted in and never before `GAP_GRACE`.
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

/// Why this session may not auto-update; the one place the decision lives, so the button and the write agree.
fn block_reason(now: &NowPlaying, episode: u32, progress: u32) -> Option<BlockReason> {
    // First, because it is the cause where it applies; a wrong-season episode is also "already watched".
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

/// A reported season past the first that the matcher could not use and the user has not corrected.
fn unplaceable_season(now: &NowPlaying) -> Option<u32> {
    // `!= 1` rather than `> 1`: season 0 is a Specials folder, and it lands on the main entry the same way.
    let season = now.season.filter(|s| *s != 1)?;
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

/// Whether the position is past two thirds, or `None` for the wall clock; an explicit delay stays on the clock.
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

/// Threshold until the auto-update: the setting, else two thirds of the episode length, else a fallback.
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


/// Whether writing `episode` moves the list backwards; a scrobble only ever advances, except when `REPEATING`.
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
    let db = app.state::<Db>();
    let api = app.state::<crate::anilist::client::AniList>();
    let user_id = cached_user_id(&db);

    // Read the progress the list holds now, not the session's copy; this is the last point before a write.
    let cached_progress = candidates_from_cache(&db, media_type)
        .into_iter()
        .find(|c| c.media_id == media_id)
        .map(|c| c.progress);
    if would_regress(episode, cached_progress, list_status) {
        // The same fact `block_reason` states, in the same vocabulary, so it translates and is not forceable.
        return Ok(Outcome::Refused(BlockReason::AlreadyWatched {
            episode,
            progress: cached_progress.unwrap_or(0),
        }));
    }

    // Then AniList itself, once: another Karasu or the website may have written since the cache was read.
    let (progress_now, status_now) = match user_id {
        Some(uid) => match crate::commands::live_entry(&api, &token, uid, media_id).await {
            Some(Some((progress, status))) => {
                db.update_cached_progress(uid, media_type, media_id, progress, Some(&status));
                (Some(progress), status)
            }
            // Not on the list: the save below creates the entry.
            Some(None) => (None, list_status.to_string()),
            None => (cached_progress, list_status.to_string()),
        },
        None => (cached_progress, list_status.to_string()),
    };
    if would_regress(episode, progress_now, &status_now) {
        crate::logging::debug(
            "scrobble",
            format!(
                "#{media_id} ep {episode} already at {} on AniList — not writing",
                progress_now.unwrap_or(0)
            ),
        );
        return Ok(Outcome::Refused(BlockReason::AlreadyWatched {
            episode,
            progress: progress_now.unwrap_or(0),
        }));
    }

    let done = total == Some(episode);
    let status = match (done, status_now.as_str()) {
        (true, _) => "COMPLETED",
        (false, "REPEATING") => "REPEATING",
        _ => "CURRENT",
    };
    let input = json!({ "mediaId": media_id, "progress": episode, "status": status });

    let result = crate::commands::save_entry_core(app, &db, &api, &token, input).await?;
    if result.queued {
        // Nothing reached AniList, so nothing may claim it did: no cache patch, no widgets, no `scrobble-done`.
        crate::logging::debug(
            "scrobble",
            format!("#{media_id} ep {episode} queued — not claiming it landed"),
        );
        return Ok(Outcome::Queued);
    }

    // Patch the local cache so the next detection sees the new state
    if let Some(user_id) = user_id {
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
    // The presence otherwise refreshes only when detection changes, so the episode text would stay stale.
    crate::discord::sync_current(app);
    let _ = app.emit(
        "scrobble-done",
        json!({ "mediaId": media_id, "episode": episode }),
    );
    Ok(Outcome::Landed)
}

/// Re-resolves what is playing against the corrections table now, patching `NowPlaying` and re-emitting it.
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
        // The number the source gave, never the resolved one: re-resolving a shifted episode would move it again.
        source_episode = np.source_episode;
    }

    let candidates = candidates_from_cache(&db, &media_type);
    let forced = detection_override(&db, &parsed_title, season, &media_type);

    // Same order as `build_now_playing`, and it must stay so: offset first, then the redirect places the number.
    let episode = match (&forced, source_episode) {
        (Some(o), Some(ep)) => Some(shift_episode(ep, o.episode_offset)),
        _ => source_episode,
    };
    let picked = match &forced {
        Some(o) => Some(o.media_id),
        // Cleared: fall back to the matcher's guess, so "undo" returns the guess rather than leaving a hole.
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

    // The same redirect the detection pass applies, or the two paths would disagree until the title changed.
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

    // Patch under the lock, then release it before telling anyone; `discord::sync` takes the session lock itself.
    let patched = {
        let state = app.state::<PlaybackState>();
        let mut guard = state.0.guard();
        if let Some(np) = guard.as_mut() {
            np.overridden = forced.is_some();
            // The resolved number, so `drive_session` starts its next session on the episode the correction names.
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

    // The running session was started for the old id; dropping it makes the next tick build one for the new.
    *app.state::<ScrobbleSession>().0.guard() = None;
    emit_session(app, None);
}

/// Confirms or discards the pending update, for the `scrobble_now` / `scrobble_cancel` commands.
pub async fn confirm_pending(app: AppHandle, accept: bool) -> Result<(), String> {
    confirm_pending_impl(app, accept, None).await
}

/// The toast button's path: confirms only the session the toast was raised for, checked under the same lock.
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
        // Nothing left to confirm; the tray item carries no `expect`, so a late press would run the update again.
        match &session.phase {
            Phase::Updated => return Err("That episode is already updated".into()),
            Phase::Updating => return Err("That update is already running".into()),
            _ => {}
        }
        // A block the user may not override stays blocked whatever asked; the card hides the button for these.
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
                Ok(Outcome::Refused(reason)) => Phase::Blocked(reason.clone()),
                Err(e) => Phase::Blocked(BlockReason::Failed { message: e.clone() }),
            };
            emit_session(&app, Some(session));
        }
    }
    // The caller only needs to know it did not fail; which way it succeeded is already on the card.
    result.map(|_| ())
}

/// Starts the detection and scrobble loop, supervised because its silent death is the least explicable.
pub fn spawn(app: AppHandle) {
    crate::logging::supervise("scrobbler", move || {
        let app = app.clone();
        async move {
        let mut last_raw: Option<(String, String)> = None;
        let mut polls = 0u32;
        let mut polls_since = Instant::now();
        loop {
            // The poll cadence as it happened; a plain `debug`, since deduping a steady count would hide the measurement.
            polls += 1;
            if polls_since.elapsed() >= POLL_REPORT {
                crate::logging::debug(
                    "detect",
                    format!("{polls} polls in the last {} min", POLL_REPORT.as_secs() / 60),
                );
                polls = 0;
                polls_since = Instant::now();
            }
            let (media_detection, jellyfin, mpv, tracking_on, background_wanted) = {
                let db = app.state::<Db>();
                (
                    crate::commands::read_media_detection(&db),
                    crate::commands::jellyfin_config(&db),
                    crate::commands::mpv_ipc_config(&db),
                    crate::commands::read_scrobble_settings(&db).enabled,
                    crate::commands::read_jellyfin_background(&db),
                )
            };
            // The tick re-reads what it decides on: the service is wanted only while all three of these hold.
            assert_tracking_service(&app, tracking_on && jellyfin.is_some() && background_wanted);
            let heartbeat_cfg = jellyfin.clone();
            let playback = detection::detect_playback(media_detection, jellyfin, mpv).await;
            // Announce this instance to the other Karasus, but only while it tracks a Jellyfin playback and would write.
            if let (Some(cfg), Some(p)) = (heartbeat_cfg.as_ref(), playback.as_ref()) {
                if tracking_on && p.process.starts_with("jellyfin (") {
                    detection::jellyfin::heartbeat(cfg).await;
                }
            }
            let raw = playback
                .as_ref()
                .map(|p| (p.process.clone(), p.media_title.clone()));

            // Patch the position every tick of the same title, or the deadline check judges the start position forever.
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
                // What detection saw, through `debug_changed`: two alternating sources would otherwise fire this every tick.
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
            // Every tick, not only on change: `sync` re-sends by fingerprint, which is how a restarted Discord gets a presence.
            crate::discord::sync_current(&app);
            tokio::time::sleep(poll_interval()).await;
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

    // Phase decision under the lock, the update itself afterwards; no await while holding the mutex.
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
                    // The `Blocked` reasons are the most-asked "why didn't it scrobble", so they reach disk.
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
                    // Existing session: a source position beats the wall clock, but only while the auto-update is armed.
                    let session = guard.as_mut().unwrap();
                    // Playing again (or still), so the pause grace starts over.
                    session.missed_ticks = 0;
                    // `enabled` is re-read here, not just at `auto_arm`, so switching tracking off disarms a waiting session.
                    let armed = armed_now(
                        settings.enabled,
                        settings.gap_auto,
                        &session.phase,
                        session.update_at.is_some(),
                    );
                    // A gap block or a yield waits on the wall clock alone; the position is already past due and would end it at once.
                    let wall_only = matches!(
                        session.phase,
                        Phase::Blocked(BlockReason::EpisodeGap { .. }) | Phase::Yielding(_)
                    );
                    let wall_due = session.update_at.is_some_and(|at| Instant::now() >= at);
                    let due = armed
                        && if wall_only {
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
                    } else if let Some(target) = defer_for_peer(
                        &session.phase,
                        detection::jellyfin::peer_snapshot(detection::jellyfin::FRESH),
                    ) {
                        // Another Karasu goes first; wait, then come back as newly due, and the live check finds its write.
                        session.update_at = Some(Instant::now() + YIELD_GRACE);
                        session.update_at_epoch_ms = Some(epoch_ms_in(YIELD_GRACE));
                        crate::logging::debug(
                            "scrobble",
                            format!(
                                "#{} ep {} due, yielding to Karasu on {} for {} s",
                                session.media_id,
                                session.episode,
                                target.device,
                                YIELD_GRACE.as_secs()
                            ),
                        );
                        session.phase = Phase::Yielding(target);
                        emit_session(app, Some(session));
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
                        // The window may be hidden in the tray, so the ask also goes to the desk; fires once per session.
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
                // Nothing detected is a pause as often as a stop, so the session is held, deadline intact, until the grace runs out.
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
        // Spawned, not awaited, because the write can take minutes; safe because no phase with a write in flight may arm.
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = perform_update(&app, mid, &mtype, ep, total, &status).await;
            let state = app.state::<ScrobbleSession>();
            let mut guard = state.0.guard();
            if let Some(session) = guard.as_mut() {
                if applies_to(session, mid, ep) {
                    session.phase = match result {
                        Ok(Outcome::Landed) => Phase::Updated,
                        Ok(Outcome::Queued) => Phase::Queued,
                        Ok(Outcome::Refused(reason)) => Phase::Blocked(reason),
                        Err(e) => Phase::Blocked(BlockReason::Failed { message: e }),
                    };
                    emit_session(&app, Some(session));
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{
        applies_to, armed_now, auto_arm, block_reason, defer_for_peer, grace_spent, position_due,
        service_transition, shift_episode, threshold, would_regress, BlockReason, NowPlaying,
        Phase, Session, YieldTarget, DEFAULT_THRESHOLD, EMPTY_TICK_GRACE, GAP_GRACE,
        HIDDEN_POLL_INTERVAL, MANGA_THRESHOLD, POLL_INTERVAL, SERVICE_RETRY, YIELD_GRACE,
    };
    use crate::playback::detection::jellyfin::{Peer, PeerSnapshot, Platform, FRESH};
    use std::time::{Duration, Instant};

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

    /// Proves a scrobble can only advance progress, never lower it.
    #[test]
    fn a_scrobble_can_only_ever_move_progress_forward() {
        assert!(would_regress(1, Some(27), "CURRENT"));
        assert!(would_regress(27, Some(27), "CURRENT"), "the same episode is not progress");
        assert!(!would_regress(28, Some(27), "CURRENT"));
        // Forcing over a gap is still allowed: it moves forward.
        assert!(!would_regress(31, Some(27), "CURRENT"));
        // Rewatching is the one place a lower number is meant, and the user set that status themselves.
        assert!(!would_regress(1, Some(27), "REPEATING"));
        // Nothing cached to compare against: not our call to refuse.
        assert!(!would_regress(1, None, "CURRENT"));
    }

    /// Proves `forceable` is one function, so the card's button and the command cannot disagree.
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

    /// Proves the gap grace is opt-in, never under `GAP_GRACE`, never earlier than the threshold, and unique to gaps.
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

    /// Proves an unusable season is reported as the cause, ahead of the "already watched" it also looks like.
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

    /// Proves the offset lets a correction name an episode, for a server that splits one entry into cours.
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

    /// Proves a season spelled in the title was matched with it and is not blocked.
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
        // The entry's minutes say not yet but the file's own duration says due, and the file's truth wins.
        assert_eq!(position_due(Some(810), Some(1200), Some(24), 0), Some(true));
        // Without the source duration the entry's minutes decide.
        assert_eq!(position_due(Some(810), None, Some(24), 0), Some(false));
    }

    /// Proves an explicit delay is never reinterpreted by a position, and no data means no verdict.
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

    /// Proves a pause does not end the session; on a media-session-only player a pause looks like a stop.
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

    /// Proves the tick-count constant matches the duration it promises.
    #[test]
    fn the_grace_is_five_minutes_of_polls() {
        assert_eq!(EMPTY_TICK_GRACE * POLL_INTERVAL.as_secs() as u32, 300);
    }

    /// Proves switching automatic tracking off stops a write that is already waiting.
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

    /// Proves a refusal is not a `Failed`, which is forceable and untranslatable.
    #[test]
    fn a_refused_write_is_not_offered_a_retry() {
        let refused = BlockReason::AlreadyWatched { episode: 5, progress: 24 };
        assert!(!refused.forceable(), "there is nothing a retry could change");
        let failed = BlockReason::Failed { message: "AniList said no".into() };
        assert!(failed.forceable(), "a server refusal is worth retrying");
    }

    /// No phase carrying a write in flight may arm; that is what makes spawning the write safe (`Yielding` waits before it).
    #[test]
    fn no_phase_with_a_write_in_flight_can_arm() {
        for phase in [Phase::Updating, Phase::Pending, Phase::Updated, Phase::Queued] {
            assert!(
                !armed_now(true, true, &phase, true),
                "{phase:?} must not arm while or after a write"
            );
        }
    }

    /// Proves the gap grace is opt-in at the due point too, and no other blocked phase arms.
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

    /// Proves a newer episode swapped in mid-request does not take the result, or it could never be scrobbled.
    #[test]
    fn a_newer_episode_of_the_same_media_does_not_take_the_result() {
        assert!(!applies_to(&session(1, 6), 1, 5));
    }

    /// Switching to a different series entirely is the same hazard.
    #[test]
    fn a_different_media_does_not_take_the_result() {
        assert!(!applies_to(&session(2, 5), 1, 5));
    }

    // --- Yielding to another Karasu ------------------------------------------

    fn peer(id: &str, name: &str, platform: Platform, last_activity: Option<i64>) -> Peer {
        Peer {
            device_id: id.into(),
            device_name: name.into(),
            platform,
            last_activity,
        }
    }

    /// The phone's view: its own row stamped now, the desktop's a few seconds earlier.
    fn phone_sees_desktop() -> PeerSnapshot {
        PeerSnapshot {
            own: Some(peer("phone", "Pixel", Platform::Mobile, Some(1_000))),
            peers: vec![peer("pc", "KYU-PC", Platform::Desktop, Some(996))],
            taken: Instant::now(),
        }
    }

    fn target() -> YieldTarget {
        YieldTarget { platform: Platform::Desktop, device: "KYU-PC".into() }
    }

    /// Proves a yield stays armed and waits on the wall clock alone, like an armed gap block.
    #[test]
    fn a_yielding_session_stays_armed_and_waits_on_the_wall_clock() {
        assert!(armed_now(true, false, &Phase::Yielding(target()), true));
        assert!(!armed_now(false, false, &Phase::Yielding(target()), true), "off means off");
        assert!(!armed_now(true, false, &Phase::Yielding(target()), false));
    }

    /// Proves the phone yields once and then writes, or a present-but-silent desktop would hold it forever.
    #[test]
    fn a_session_yields_once_and_then_writes() {
        let first = defer_for_peer(&Phase::Watching, Some(phone_sees_desktop()));
        assert_eq!(first, Some(target()));
        assert_eq!(defer_for_peer(&Phase::Yielding(target()), Some(phone_sees_desktop())), None);
        // No snapshot, or no own row to judge freshness by: no yield.
        assert_eq!(defer_for_peer(&Phase::Watching, None), None);
        let mut blind = phone_sees_desktop();
        blind.own = None;
        assert_eq!(defer_for_peer(&Phase::Watching, Some(blind)), None);
        // The desktop never waits for the phone.
        let desktop_sees_phone = PeerSnapshot {
            own: Some(peer("pc", "KYU-PC", Platform::Desktop, Some(1_000))),
            peers: vec![peer("phone", "Pixel", Platform::Mobile, Some(1_000))],
            taken: Instant::now(),
        };
        assert_eq!(defer_for_peer(&Phase::Watching, Some(desktop_sees_phone)), None);
    }

    /// Proves the grace outlasts the freshness window, or a session could yield to the same peer again.
    #[test]
    fn the_yield_grace_outlives_the_freshness_window() {
        assert!(YIELD_GRACE > FRESH);
    }

    // --- The Android tracking service ----------------------------------------

    /// Proves a start is only asked for on screen, and after a refusal not again until `SERVICE_RETRY`.
    #[test]
    fn a_start_waits_for_the_foreground_and_backs_off_after_a_refusal() {
        let base = Instant::now();
        let now = base + 2 * SERVICE_RETRY;
        assert_eq!(service_transition(false, true, true, None, now), Some(true));
        assert_eq!(service_transition(false, true, false, None, now), None, "not from the background");
        let just_refused = Some(now - Duration::from_secs(10));
        assert_eq!(service_transition(false, true, true, just_refused, now), None);
        let long_ago = Some(now - SERVICE_RETRY);
        assert_eq!(service_transition(false, true, true, long_ago, now), Some(true));
        assert_eq!(service_transition(true, true, true, None, now), None, "already running");
    }

    #[test]
    fn a_stop_needs_nothing() {
        let now = Instant::now();
        assert_eq!(service_transition(true, false, false, Some(now), now), Some(false));
        assert_eq!(service_transition(false, false, true, None, now), None, "nothing to stop");
    }

    /// Proves the hidden poll is slower than the visible one and still inside the freshness window.
    #[test]
    fn the_hidden_poll_is_slower_than_the_visible_one_and_still_inside_fresh() {
        assert!(HIDDEN_POLL_INTERVAL > POLL_INTERVAL);
        assert!(HIDDEN_POLL_INTERVAL < FRESH);
    }
}
