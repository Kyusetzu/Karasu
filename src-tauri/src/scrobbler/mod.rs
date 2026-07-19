//! Detection and scrobble loop: watch windows, parse titles, match them
//! against the list and update progress on AniList automatically once the
//! threshold has passed.
//!
//! State machine per detected episode:
//! `Watching → (Pending →) Updating → Updated`, with `Blocked` on
//! plausibility problems (episode gap, already watched) and `Cancelled`
//! after user abort.

use crate::db::Db;
use crate::detection;
use crate::recognition::{matcher, parser};
use crate::relations::{self, Relations};
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
    let parsed = if playback.manga {
        parser::parse_manga(&playback.media_title)
    } else {
        parser::parse(&playback.media_title)
    };
    let candidates = candidates_from_cache(db, media_type);
    let matched = matcher::best_match(&parsed, &candidates);

    // Episode redirect (anime-relations): e.g. combined release "Ep 25"
    // → season 2, episode 1 of a different AniList entry. Anime only.
    let matched = matched.map(|m| {
        if !playback.manga {
            if let Some(ep) = parsed.episode {
                if let Some((new_id, new_ep)) = relations::redirect(rules, m.media_id, ep)
                {
                    return (new_id, Some(new_ep));
                }
            }
        }
        (m.media_id, parsed.episode)
    });

    let (media_id, episode, matched_title, progress, total) = match matched {
        Some((mid, ep)) => {
            let c = candidates.iter().find(|c| c.media_id == mid);
            (
                Some(mid),
                ep,
                c.map(|c| c.titles[0].clone()),
                c.map(|c| c.progress),
                c.and_then(|c| c.episodes),
            )
        }
        None => (None, parsed.episode, None, None, None),
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
    }
}

/// Threshold until the auto-update: setting in minutes, or 2/3 of the
/// episode length (anime), or 5 minutes (manga), otherwise 15 minutes.
fn threshold(now: &NowPlaying, db: &Db, delay_min: u32) -> Duration {
    if delay_min > 0 {
        return Duration::from_secs(u64::from(delay_min) * 60);
    }
    if now.media_type == "MANGA" {
        return MANGA_THRESHOLD;
    }
    let duration = now.media_id.and_then(|mid| {
        candidates_from_cache(db, &now.media_type)
            .iter()
            .find(|c| c.media_id == mid)
            .and_then(|c| c.duration_min)
    });
    match duration {
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
    let _ = app.emit(
        "scrobble-done",
        json!({ "mediaId": media_id, "episode": episode }),
    );
    Ok(())
}

/// Confirms (or discards) the pending update — invoked by the frontend
/// through the `scrobble_now` / `scrobble_cancel` commands.
pub async fn confirm_pending(app: AppHandle, accept: bool) -> Result<(), String> {
    let data = {
        let state = app.state::<ScrobbleSession>();
        let mut guard = state.0.lock().unwrap();
        let Some(session) = guard.as_mut() else {
            return Err("Nothing is currently playing".into());
        };
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
        session.phase = match &result {
            Ok(()) => Phase::Updated,
            Err(e) => Phase::Blocked(e.clone()),
        };
        emit_session(&app, Some(session));
    }
    result
}

/// Starts the detection and scrobble loop (runs for the app's lifetime).
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_raw: Option<(String, String)> = None;
        loop {
            let playback = detection::detect_playback();
            let raw = playback
                .as_ref()
                .map(|p| (p.process.clone(), p.media_title.clone()));

            if raw != last_raw {
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
            }

            drive_session(&app).await;
            tokio::time::sleep(POLL_INTERVAL).await;
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
                    let db = app.state::<Db>();
                    let threshold = threshold(&np, &db, settings.delay_min);
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
                        list_status: candidates_from_cache(&db, &np.media_type)
                            .iter()
                            .find(|c| c.media_id == mid)
                            .map(|c| c.status.clone())
                            .unwrap_or_default(),
                        started_ms: now_ms(),
                        update_at: auto.then(|| Instant::now() + threshold),
                        update_at_epoch_ms: auto.then(|| epoch_ms_in(threshold)),
                        phase,
                    };
                    emit_session(app, Some(&session));
                    *guard = Some(session);
                    None
                } else {
                    // Existing session: check the threshold
                    let session = guard.as_mut().unwrap();
                    let due = session.phase == Phase::Watching
                        && session
                            .update_at
                            .is_some_and(|at| Instant::now() >= at);
                    if !due {
                        None
                    } else if settings.confirm {
                        session.phase = Phase::Pending;
                        emit_session(app, Some(session));
                        None
                    } else {
                        session.phase = Phase::Updating;
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
            if session.media_id == mid && session.episode == ep {
                session.phase = match result {
                    Ok(()) => Phase::Updated,
                    Err(e) => Phase::Blocked(e),
                };
                emit_session(app, Some(session));
            }
        }
    }
}
