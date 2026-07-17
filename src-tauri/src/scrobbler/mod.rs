//! Erkennungs-Loop: Fenster beobachten, Titel parsen, gegen die Liste
//! matchen und den Zustand ans Frontend melden. (Auto-Update folgt in M6.)

use crate::db::Db;
use crate::detection;
use crate::recognition::{matcher, parser};
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const POLL_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NowPlaying {
    pub process: String,
    pub streaming: bool,
    #[serde(rename = "rawTitle")]
    pub raw_title: String,
    #[serde(rename = "parsedTitle")]
    pub parsed_title: String,
    pub episode: Option<u32>,
    /// AniList-Media-ID bei erfolgreichem Match gegen die Liste
    #[serde(rename = "mediaId")]
    pub media_id: Option<i64>,
    #[serde(rename = "matchedTitle")]
    pub matched_title: Option<String>,
    /// Aktueller Listen-Fortschritt des gematchten Eintrags
    pub progress: Option<u32>,
    #[serde(rename = "totalEpisodes")]
    pub total_episodes: Option<u32>,
}

/// Aktuell erkannte Wiedergabe, für Commands und den M6-Scrobbler.
pub struct PlaybackState(pub Mutex<Option<NowPlaying>>);

/// Baut Matching-Kandidaten aus dem SQLite-Listen-Cache.
pub fn candidates_from_cache(db: &Db) -> Vec<matcher::Candidate> {
    let Some(viewer) = db
        .kv_get("anilist_viewer")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    else {
        return Vec::new();
    };
    let Some(user_id) = viewer.get("id").and_then(|v| v.as_i64()) else {
        return Vec::new();
    };
    let Some(lists) = db
        .cached_list(user_id)
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
            out.push(matcher::Candidate {
                media_id,
                titles,
                episodes: media
                    .get("episodes")
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

fn build_now_playing(db: &Db, playback: detection::Playback) -> NowPlaying {
    let parsed = parser::parse(&playback.media_title);
    let candidates = candidates_from_cache(db);
    let matched = matcher::best_match(&parsed, &candidates);

    let (media_id, matched_title, progress, total) = match matched {
        Some(m) => {
            let c = candidates.iter().find(|c| c.media_id == m.media_id);
            (
                Some(m.media_id),
                c.map(|c| c.titles[0].clone()),
                c.map(|c| c.progress),
                c.and_then(|c| c.episodes),
            )
        }
        None => (None, None, None, None),
    };

    NowPlaying {
        process: playback.process,
        streaming: playback.streaming,
        raw_title: playback.media_title,
        parsed_title: parsed.title,
        episode: parsed.episode,
        media_id,
        matched_title,
        progress,
        total_episodes: total,
    }
}

/// Startet den Erkennungs-Loop (läuft für die Lebensdauer der App).
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
                let db = app.state::<Db>();
                let now = playback.map(|p| build_now_playing(&db, p));
                *app.state::<PlaybackState>().0.lock().unwrap() = now.clone();
                let _ = app.emit("now-playing", &now);
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}
