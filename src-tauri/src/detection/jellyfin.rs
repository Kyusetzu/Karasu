//! Jellyfin as a detection source, via the server's own `/Sessions` endpoint.
//!
//! The Windows media-session pass (see `smtc`) covers Jellyfin Media Player
//! without any setup, but it only ever sees what is playing *on this PC*, and
//! it still hands the release-name parser a string to guess at.
//!
//! Asking the server instead is exact. `NowPlayingItem` carries the series
//! name, season and episode as separate fields, so nothing has to be parsed.
//!
//! The catch is that `/Sessions` reports the *whole server* — every user on
//! every device. Scrobbling the first thing it returns means a housemate
//! watching something on their own account lands on your AniList list. So a
//! session only counts when it matches the configured user, and (unless the
//! device field is cleared) the configured device. Nothing is configured by
//! default, and an unconfigured user means this source is off entirely: it
//! fails closed, because the failure mode of guessing is writing to someone
//! else's list.
//!
//! The cost is configuration: a server URL, an API key and a user. That's why
//! this is opt-in and silent when unconfigured.

use super::Playback;
use crate::recognition::parser::Parsed;

const SERVICE: &str = "dev.kyu.karasu";
const USER: &str = "jellyfin";

/// Everything the source needs to poll one user's playback on one device.
pub struct JellyfinConfig {
    pub url: String,
    pub key: String,
    pub user_id: String,
    /// Empty means "any device of that user".
    pub device: String,
}

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

/// Jellyfin writes the same user id both dashed and undashed depending on the
/// endpoint (`/Users` vs. `/Sessions`), and casing is not guaranteed either.
/// Comparing on a normalised form keeps a stored id matching regardless.
fn normalize_guid(raw: &str) -> String {
    raw.chars()
        .filter(|c| *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

/// Whether a `/Sessions` entry belongs to the configured user and device.
///
/// An empty `device` means "any device of that user" — useful for scrobbling
/// from a phone or a TV. An empty `user_id` matches nothing: callers are
/// expected to skip the whole source in that case, and this is the backstop
/// that keeps a misconfiguration from silently tracking the entire server.
pub fn session_matches(session: &serde_json::Value, user_id: &str, device: &str) -> bool {
    if user_id.trim().is_empty() {
        return false;
    }
    let session_user = session.get("UserId").and_then(|v| v.as_str()).unwrap_or("");
    if normalize_guid(session_user) != normalize_guid(user_id) {
        return false;
    }
    let device = device.trim();
    if device.is_empty() {
        return true;
    }
    let session_device = session
        .get("DeviceName")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    session_device.trim().eq_ignore_ascii_case(device)
}

/// GET a JSON endpoint on the configured server.
async fn get_json(
    base: &str,
    path: &str,
    api_key: &str,
) -> Result<serde_json::Value, String> {
    let base = normalize_base_url(base);
    if base.is_empty() || api_key.is_empty() {
        return Err("Enter your server URL and an API key first".into());
    }
    let resp = reqwest::Client::new()
        .get(format!("{base}{path}"))
        .header("Authorization", format!("MediaBrowser Token=\"{api_key}\""))
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
        .map_err(|e| format!("Could not reach the server: {e}"))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("The server rejected the API key".into());
    }
    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }
    resp.json()
        .await
        .map_err(|e| format!("Could not read the server's reply: {e}"))
}

#[derive(serde::Serialize)]
pub struct JellyfinUser {
    pub id: String,
    pub name: String,
}

/// The server's user list, for the picker in Settings.
pub async fn list_users(base: &str, api_key: &str) -> Result<Vec<JellyfinUser>, String> {
    let users = get_json(base, "/Users", api_key).await?;
    Ok(users
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|u| {
                    Some(JellyfinUser {
                        id: u.get("Id")?.as_str()?.to_string(),
                        name: u.get("Name")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

/// One row of the Test-connection diagnostic.
#[derive(serde::Serialize)]
pub struct SessionSummary {
    pub user: String,
    pub device: String,
    pub client: String,
    /// What that session is playing, or `None` when it is idle.
    pub playing: Option<String>,
    /// Whether the configured user/device filter accepts this session.
    pub matched: bool,
}

/// Every session the server reports, annotated with whether the filter accepts
/// it. This is the only way a user can find out what their device is actually
/// called — Jellyfin Media Player usually reports the machine hostname, but it
/// is configurable and a browser session reports the browser name instead.
pub async fn list_sessions(
    base: &str,
    api_key: &str,
    user_id: &str,
    device: &str,
) -> Result<Vec<SessionSummary>, String> {
    let sessions = get_json(base, "/Sessions", api_key).await?;
    Ok(sessions
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|s| SessionSummary {
                    user: field(s, "UserName"),
                    device: field(s, "DeviceName"),
                    client: field(s, "Client"),
                    playing: playback_from_session(s).map(|p| p.media_title),
                    matched: session_matches(s, user_id, device),
                })
                .collect()
        })
        .unwrap_or_default())
}

fn field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
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

/// Polls the configured server for what *this* user is playing on *this*
/// device. Returns `None` when unconfigured, unreachable or idle — a Jellyfin
/// box that is switched off must not break detection for everything else.
pub async fn detect(
    base_url: &str,
    api_key: &str,
    user_id: &str,
    device: &str,
) -> Option<Playback> {
    if user_id.trim().is_empty() {
        return None;
    }
    let sessions = get_json(base_url, "/Sessions", api_key).await.ok()?;
    sessions
        .as_array()?
        .iter()
        .filter(|s| session_matches(s, user_id, device))
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

    const ME: &str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const SOMEONE_ELSE: &str = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    fn session(user: &str, device: &str) -> serde_json::Value {
        json!({ "UserId": user, "DeviceName": device, "UserName": "whoever" })
    }

    #[test]
    fn only_the_configured_user_matches() {
        assert!(session_matches(&session(ME, "KYU-PC"), ME, "KYU-PC"));
        // The whole point of this commit: another account on the same server
        // must never be picked up.
        assert!(!session_matches(&session(SOMEONE_ELSE, "KYU-PC"), ME, "KYU-PC"));
    }

    #[test]
    fn user_ids_match_across_dashing_and_case() {
        // /Users and /Sessions disagree about both, so neither may matter.
        let undashed = ME.replace('-', "").to_uppercase();
        assert!(session_matches(&session(&undashed, "KYU-PC"), ME, "KYU-PC"));
        assert!(session_matches(&session(ME, "KYU-PC"), &undashed, "KYU-PC"));
    }

    #[test]
    fn device_is_matched_case_insensitively() {
        assert!(session_matches(&session(ME, "KYU-PC"), ME, "kyu-pc"));
        assert!(session_matches(&session(ME, " KYU-PC "), ME, "KYU-PC"));
        assert!(!session_matches(&session(ME, "Chrome"), ME, "KYU-PC"));
    }

    #[test]
    fn an_empty_device_accepts_any_of_that_users_devices() {
        // Deliberate escape hatch for scrobbling from a phone or a TV.
        assert!(session_matches(&session(ME, "Pixel"), ME, ""));
        assert!(session_matches(&session(ME, "Pixel"), ME, "   "));
        assert!(!session_matches(&session(SOMEONE_ELSE, "Pixel"), ME, ""));
    }

    /// Fail closed. An unconfigured user must match nothing at all, rather
    /// than degrading to "track whatever the server reports".
    #[test]
    fn an_empty_user_matches_nothing() {
        assert!(!session_matches(&session(ME, "KYU-PC"), "", "KYU-PC"));
        assert!(!session_matches(&session(ME, "KYU-PC"), "  ", ""));
    }

    #[test]
    fn a_session_without_a_user_is_rejected() {
        assert!(!session_matches(&json!({ "DeviceName": "KYU-PC" }), ME, ""));
    }
}
