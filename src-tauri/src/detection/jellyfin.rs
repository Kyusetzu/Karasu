//! Jellyfin as a detection source, via the server's own `/Sessions` endpoint.
//!
//! The Windows media-session pass (see `smtc`) covers Jellyfin Media Player
//! without any setup, but it only ever sees what is playing *on this PC*, and
//! it still hands the release-name parser a string to guess at.
//!
//! Asking the server instead is exact. `NowPlayingItem` carries the series
//! name, season and episode as separate fields, so nothing has to be parsed —
//! and the server knows about every client, including a phone or a TV.
//!
//! The cost is configuration: a server URL and an API key. That's why this is
//! opt-in and silent when unconfigured.

use super::Playback;
use crate::recognition::parser::Parsed;

const SERVICE: &str = "dev.kyu.karasu";
const USER: &str = "jellyfin";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| format!("Credential store: {e}"))
}

/// The API key lives in the OS credential store, next to the AniList token,
/// and is never handed back to the WebView — the UI only ever learns whether
/// one is configured.
pub fn save_api_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return delete_api_key();
    }
    entry()?
        .set_password(key)
        .map_err(|e| format!("Could not save the API key: {e}"))
}

pub fn load_api_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.is_empty())
}

pub fn delete_api_key() -> Result<(), String> {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
    Ok(())
}

/// Trims a user-entered server URL into a base we can append paths to.
pub fn normalize_base_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

/// Turns one `/Sessions` entry into a detection result.
///
/// Split out from the HTTP call so the mapping — which is the part with real
/// decisions in it — is unit-testable without a server.
pub fn playback_from_session(session: &serde_json::Value) -> Option<Playback> {
    let item = session.get("NowPlayingItem")?;
    let kind = item.get("Type").and_then(|v| v.as_str()).unwrap_or("");
    if kind != "Episode" && kind != "Movie" {
        return None;
    }

    // Paused still counts as "what you're watching" — the scrobbler's own
    // threshold decides when to act, and a pause shouldn't drop the session.
    let episode_name = item.get("Name").and_then(|v| v.as_str()).unwrap_or("");
    let series = item
        .get("SeriesName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let episode = item
        .get("IndexNumber")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let season = item
        .get("ParentIndexNumber")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    // A movie has no series name; its own title is the title.
    let title = if series.is_empty() {
        item.get("Name").and_then(|v| v.as_str()).unwrap_or("").trim()
    } else {
        series
    };
    if title.is_empty() {
        return None;
    }

    let client = session
        .get("Client")
        .and_then(|v| v.as_str())
        .unwrap_or("Jellyfin");

    Some(Playback {
        process: format!("jellyfin ({client})"),
        // Kept human-readable for the Now Playing card; the parser is skipped.
        media_title: match (episode, episode_name.is_empty()) {
            (Some(n), false) => format!("{title} - {n} - {episode_name}"),
            (Some(n), true) => format!("{title} - {n}"),
            (None, _) => title.to_string(),
        },
        streaming: true,
        manga: false,
        parsed: Some(Parsed {
            title: title.to_string(),
            episode,
            // Season 1 carries no information for matching and would only
            // confuse the "S2" title variants the matcher generates.
            season: season.filter(|s| *s > 1),
            release_group: None,
        }),
    })
}

/// Polls the configured server. Returns `None` when unconfigured, unreachable
/// or idle — a Jellyfin box that is switched off must not break detection for
/// everything else.
pub async fn detect(base_url: &str, api_key: &str) -> Option<Playback> {
    let base = normalize_base_url(base_url);
    if base.is_empty() || api_key.is_empty() {
        return None;
    }
    let resp = reqwest::Client::new()
        .get(format!("{base}/Sessions"))
        .header("Authorization", format!("MediaBrowser Token=\"{api_key}\""))
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let sessions: serde_json::Value = resp.json().await.ok()?;
    sessions
        .as_array()?
        .iter()
        .find_map(playback_from_session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_an_episode_without_the_parser() {
        let s = json!({
            "Client": "Jellyfin Media Player",
            "NowPlayingItem": {
                "Type": "Episode",
                "Name": "The Mage's Journey",
                "SeriesName": "Frieren",
                "IndexNumber": 5,
                "ParentIndexNumber": 2
            }
        });
        let p = playback_from_session(&s).unwrap();
        let parsed = p.parsed.unwrap();
        assert_eq!(parsed.title, "Frieren");
        assert_eq!(parsed.episode, Some(5));
        assert_eq!(parsed.season, Some(2));
        assert!(p.media_title.contains("Frieren"));
    }

    #[test]
    fn season_one_is_dropped() {
        // "S1" adds nothing and would skew the matcher's title variants.
        let s = json!({
            "NowPlayingItem": {
                "Type": "Episode", "Name": "Ep", "SeriesName": "Frieren",
                "IndexNumber": 3, "ParentIndexNumber": 1
            }
        });
        assert_eq!(playback_from_session(&s).unwrap().parsed.unwrap().season, None);
    }

    #[test]
    fn a_movie_uses_its_own_title() {
        let s = json!({
            "NowPlayingItem": { "Type": "Movie", "Name": "A Silent Voice" }
        });
        let p = playback_from_session(&s).unwrap();
        assert_eq!(p.parsed.unwrap().title, "A Silent Voice");
    }

    #[test]
    fn music_and_idle_sessions_are_ignored() {
        assert!(playback_from_session(&json!({})).is_none());
        assert!(playback_from_session(&json!({
            "NowPlayingItem": { "Type": "Audio", "Name": "Some Song" }
        }))
        .is_none());
    }

    #[test]
    fn base_url_is_normalized() {
        assert_eq!(normalize_base_url("  http://nas:8096/  "), "http://nas:8096");
        assert_eq!(normalize_base_url(""), "");
    }
}
