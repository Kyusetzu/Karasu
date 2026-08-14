//! Detection and scrobble loop: watch windows, parse titles, match them
//! against the list and update progress on AniList automatically once the
//! threshold has passed.
//!
//! State machine per detected episode:
//! `Watching → (Pending →) Updating → Updated`, with `Blocked` on
//! plausibility problems (episode gap, already watched) and `Cancelled`
//! after user abort.

use crate::db::Db;
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
    pub episode: Option<u32>,
    /// AniList media ID on a successful match against the list
    #[serde(rename = "mediaId")]
    pub media_id: Option<i64>,
    #[serde(rename = "matchedTitle")]
    pub matched_title: Option<String>,
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

#[derive(Debug, Clone, PartialEq)]
pub enum Phase {
    Watching,
    Pending,
    Updating,
    Updated,
    Blocked(String),
    Cancelled,
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
    reason: Option<String>,
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
                Phase::Blocked(_) => "blocked",
                Phase::Cancelled => "cancelled",
            }
            .into(),
            reason: match &s.phase {
                Phase::Blocked(r) => Some(r.clone()),
                _ => None,
            },
            media_id: Some(s.media_id),
            episode: Some(s.episode),
            update_at_ms: match s.phase {
                Phase::Watching => s.update_at_epoch_ms,
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
    let matched = matcher::best_match(&parsed, &candidates);

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

    let (media_id, episode, matched_title, progress, total, duration_min, list_status) =
        match matched {
            Some((mid, ep)) => {
                let c = candidates.iter().find(|c| c.media_id == mid);
                (
                    Some(mid),
                    ep,
                    c.map(|c| c.titles[0].clone()),
                    c.map(|c| c.progress),
                    c.and_then(|c| c.episodes),
                    c.and_then(|c| c.duration_min),
                    c.map(|c| c.status.clone()).unwrap_or_default(),
                )
            }
            None => (None, parsed.episode, None, None, None, None, String::new()),
        };

    NowPlaying {
        process: playback.process,
        streaming: playback.streaming,
        media_type: media_type.to_string(),
        raw_title: playback.media_title,
        parsed_title: parsed.title,
        episode,
        media_id,
        matched_title,
        progress,
        total_episodes: total,
        duration_min,
        position_sec: playback.position_sec,
        duration_sec: playback.duration_sec,
        list_status,
    }
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


/// Performs the list update (including status logic and cache patch).
async fn perform_update(
    app: &AppHandle,
    media_id: i64,
    media_type: &str,
    episode: u32,
    total: Option<u32>,
    list_status: &str,
) -> Result<(), String> {
    let token =
        crate::anilist::auth::load_token().ok_or("Not connected to AniList")?;
    let done = total == Some(episode);
    let status = match (done, list_status) {
        (true, _) => "COMPLETED",
        (false, "REPEATING") => "REPEATING",
        _ => "CURRENT",
    };
    let input = json!({ "mediaId": media_id, "progress": episode, "status": status });

    let db = app.state::<Db>();
    let api = app.state::<crate::anilist::client::AniList>();
    crate::commands::save_entry_core(&db, &api, &token, input).await?;

    // Patch the local cache so the next detection sees the new state
    if let Some(user_id) = cached_user_id(&db) {
        db.update_cached_progress(user_id, media_type, media_id, episode, Some(status));
    }
    // Refresh the now-playing display
    {
        let state = app.state::<PlaybackState>();
        let mut guard = state.0.lock().unwrap();
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
    Ok(())
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
        let mut guard = state.0.lock().unwrap();
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
    let mut guard = state.0.lock().unwrap();
    if let Some(session) = guard.as_mut() {
        if applies_to(session, data.0, data.2) {
            session.phase = match &result {
                Ok(()) => Phase::Updated,
                Err(e) => Phase::Blocked(e.clone()),
            };
            emit_session(&app, Some(session));
        }
    }
    result
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
            let (media_detection, jellyfin) = {
                let db = app.state::<Db>();
                (
                    crate::commands::read_media_detection(&db),
                    crate::commands::jellyfin_config(&db),
                )
            };
            let playback = detection::detect_playback(media_detection, jellyfin).await;
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
                    let mut guard = state.0.lock().unwrap();
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
                crate::logging::debug(
                    "detect",
                    format!("playback changed: {last_raw:?} → {raw:?}"),
                );
                last_raw = raw;
                let now = {
                    let db = app.state::<Db>();
                    let rules = app.state::<Relations>();
                    let rules = rules.0.read().unwrap().clone();
                    playback.map(|p| build_now_playing(&db, &rules, p))
                };
                *app.state::<PlaybackState>().0.lock().unwrap() = now.clone();
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
    let now_playing = app.state::<PlaybackState>().0.lock().unwrap().clone();
    let settings = {
        let db = app.state::<Db>();
        crate::commands::read_scrobble_settings(&db)
    };

    // Phase decision under the lock, the update itself afterwards (no
    // await while holding the mutex).
    let update_data = {
        let state = app.state::<ScrobbleSession>();
        let mut guard = state.0.lock().unwrap();

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
                    let phase = if ep <= progress {
                        Phase::Blocked(format!(
                            "Episode {ep} is already watched according to your list (progress {progress})"
                        ))
                    } else if ep > progress + 1 {
                        Phase::Blocked(format!(
                            "Episode gap: detected {ep}, but your progress is {progress}"
                        ))
                    } else {
                        Phase::Watching
                    };
                    let auto = settings.enabled && phase == Phase::Watching;
                    let session = Session {
                        media_id: mid,
                        media_type: np.media_type.clone(),
                        episode: ep,
                        total: np.total_episodes,
                        list_status: np.list_status.clone(),
                        started_ms: now_ms(),
                        update_at: auto.then(|| Instant::now() + threshold),
                        update_at_epoch_ms: auto.then(|| epoch_ms_in(threshold)),
                        phase,
                    };
                    // The two `Blocked` reasons are the most-asked "why didn't it
                    // scrobble", and until now they existed only as a transient
                    // event to the WebView — nothing reached disk.
                    crate::logging::debug(
                        "scrobble",
                        format!(
                            "session #{mid} ep {ep} (progress {progress}) → {:?}, auto {}",
                            session.phase, auto
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
                    let session = guard.as_mut().unwrap();
                    let due = session.phase == Phase::Watching
                        && session.update_at.is_some()
                        && position_due(
                            np.position_sec,
                            np.duration_sec,
                            np.duration_min,
                            settings.delay_min,
                        )
                        .unwrap_or_else(|| {
                            session.update_at.is_some_and(|at| Instant::now() >= at)
                        });
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
                        // the whole point. Fires once per session: this branch
                        // is only reachable from `Watching`.
                        let body = if session.media_type == "MANGA" {
                            format!("Mark chapter {} as read?", session.episode)
                        } else {
                            format!("Mark episode {} as watched?", session.episode)
                        };
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
                if guard.is_some() {
                    *guard = None;
                    emit_session(app, None);
                }
                None
            }
        }
    };

    if let Some((mid, mtype, ep, total, status)) = update_data {
        let result = perform_update(app, mid, &mtype, ep, total, &status).await;
        let state = app.state::<ScrobbleSession>();
        let mut guard = state.0.lock().unwrap();
        if let Some(session) = guard.as_mut() {
            if applies_to(session, mid, ep) {
                session.phase = match result {
                    Ok(()) => Phase::Updated,
                    Err(e) => Phase::Blocked(e),
                };
                emit_session(app, Some(session));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        applies_to, position_due, threshold, NowPlaying, Phase, Session, DEFAULT_THRESHOLD,
        MANGA_THRESHOLD,
    };
    use std::time::Duration;

    fn now_playing(media_type: &str, duration_min: Option<u32>) -> NowPlaying {
        NowPlaying {
            process: "mpv".into(),
            streaming: false,
            media_type: media_type.into(),
            raw_title: String::new(),
            parsed_title: String::new(),
            episode: Some(1),
            media_id: Some(1),
            matched_title: None,
            progress: Some(0),
            total_episodes: Some(12),
            duration_min,
            position_sec: None,
            duration_sec: None,
            list_status: "CURRENT".into(),
        }
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
        }
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
