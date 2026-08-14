//! Jellyfin as a detection source, via the server's own `/Sessions` endpoint.
//!
//! The system media-session pass (see `media_session`) covers Jellyfin Media Player
//! without any setup, but it only ever sees what is playing *on this PC*, and
//! it still hands the release-name parser a string to guess at.
//!
//! Asking the server instead is exact. `NowPlayingItem` carries the series
//! name, season and episode as separate fields, so nothing has to be parsed.
//!
//! Karasu signs in as *a user*, not with an admin API key, and that choice is
//! load-bearing rather than cosmetic. `GET /Sessions` is only `[Authorize]`,
//! and hands the caller's identity to Jellyfin's `SessionManager::GetSessions`,
//! which branches on it:
//!
//! - an **API key** sets `userIsAdmin = true` and returns *every* session on
//!   the server — which is exactly how an earlier version of this file ended
//!   up scrobbling a housemate's playback;
//! - a **user token** gets `result.Where(i => i.UserId.IsEmpty() ||
//!   i.ContainsUser(userId))` — the server hands back only that user's own
//!   sessions.
//!
//! So the scoping is enforced server-side, and an ordinary account is enough:
//! creating an API key needs admin rights that most users of a shared server
//! do not have. Jellyfin has no OAuth, so `POST /Users/AuthenticateByName` is
//! the standard sign-in for third-party clients. The password is exchanged
//! once for an access token and never stored.
//!
//! `session_matches` still checks the user id on top of that. The server's own
//! filter lets through sessions with an *empty* `UserId`, so this is a real
//! backstop rather than belt-and-braces, and it is where the optional
//! "only this device" narrowing lives.

use super::Playback;
use crate::playback::recognition::parser::Parsed;
use std::sync::Mutex;

const SERVICE: &str = "dev.kyu.karasu";
/// Credential-store entry for the Jellyfin access token.
const TOKEN_USER: &str = "jellyfin_token";
/// The pre-0.26 entry, which held an admin API key. Deleted on sign-in — a
/// dead secret has no business lingering in the user's credential store.
const LEGACY_KEY_USER: &str = "jellyfin";

/// Everything the source needs to poll one user's playback on one device.
pub struct JellyfinConfig {
    pub url: String,
    pub token: String,
    pub user_id: String,
    /// Empty means "any device of that user".
    pub device: String,
    pub device_name: String,
    pub device_id: String,
}

fn entry(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, user).map_err(|e| format!("Credential store: {e}"))
}

/// The access token lives in the OS credential store, next to the AniList
/// token, and is never handed back to the WebView — the UI only ever learns
/// whether one is stored and which account it belongs to.
pub fn save_token(token: &str) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return delete_token();
    }
    entry(TOKEN_USER)?
        .set_password(token)
        .map_err(|e| format!("Could not save the access token: {e}"))?;
    set_cached_token(Some(token.to_string()));
    Ok(())
}

/// The last credential-store read.
///
/// The scrobbler polls Jellyfin every 5 seconds and each tick used to hit the
/// Windows Credential Manager — 17,280 reads a day for anyone with Jellyfin
/// set up. The token only changes through `save_token` and `delete_token`, both
/// in this module, so caching it here is safe as long as they keep updating it.
///
/// The outer `Option` is "have we looked yet", the inner one is what we found.
/// That distinction matters: without it a signed-out user would re-read the
/// credential store on every single tick, which is the case being fixed.
static TOKEN_CACHE: Mutex<Option<Option<String>>> = Mutex::new(None);

pub fn load_token() -> Option<String> {
    cached_or(&TOKEN_CACHE, || {
        entry(TOKEN_USER)
            .ok()?
            .get_password()
            .ok()
            .filter(|k| !k.is_empty())
    })
}

/// Reads through `cache`, filling it on the first miss.
///
/// Split out from `load_token` so the caching itself is testable without
/// touching the real credential store.
///
/// A poisoned lock is recovered from rather than propagated: a panic elsewhere
/// should not permanently break Jellyfin detection, and the worst case is one
/// stale read that the next sign-in overwrites.
fn cached_or<F>(cache: &Mutex<Option<Option<String>>>, read: F) -> Option<String>
where
    F: FnOnce() -> Option<String>,
{
    let mut guard = cache.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(known) = guard.as_ref() {
        return known.clone();
    }
    let fresh = read();
    *guard = Some(fresh.clone());
    fresh
}

fn set_cached_token(token: Option<String>) {
    *TOKEN_CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(token);
}

pub fn delete_token() -> Result<(), String> {
    if let Ok(e) = entry(TOKEN_USER) {
        let _ = e.delete_credential();
    }
    set_cached_token(None);
    Ok(())
}

/// Removes the admin API key stored by earlier versions. It is useless now,
/// and it grants more on the server than Karasu ever needs.
pub fn delete_legacy_api_key() {
    if let Ok(e) = entry(LEGACY_KEY_USER) {
        let _ = e.delete_credential();
    }
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

/// Jellyfin identifies the calling client through this header, and requires it
/// on `AuthenticateByName`. A *stable* `DeviceId` matters: with a fresh one per
/// launch, Karasu would pile up a new entry in the server's device list every
/// time it started.
fn auth_header(device: &str, device_id: &str, token: Option<&str>) -> String {
    let version = env!("CARGO_PKG_VERSION");
    let mut header = format!(
        "MediaBrowser Client=\"Karasu\", Device=\"{}\", DeviceId=\"{}\", Version=\"{version}\"",
        escape(device),
        escape(device_id),
    );
    if let Some(t) = token {
        header.push_str(&format!(", Token=\"{}\"", escape(t)));
    }
    header
}

/// The header is a quoted-string list, so a stray quote or backslash in a
/// hostname would corrupt every field after it.
fn escape(value: &str) -> String {
    value.replace('\\', "").replace('"', "")
}

/// Reads a field by its PascalCase name, falling back to camelCase.
///
/// Jellyfin serialises PascalCase, but this cannot be checked against a live
/// server from the machine this was written on, and a casing mismatch would
/// fail as a silent "nothing is playing" rather than an error. Accepting both
/// costs one lookup and removes the whole failure mode.
fn get_ci<'a>(v: &'a serde_json::Value, name: &str) -> Option<&'a serde_json::Value> {
    v.get(name).or_else(|| {
        let mut chars = name.chars();
        let lower: String = chars
            .next()
            .map(|c| c.to_lowercase().to_string())?
            .chars()
            .chain(chars)
            .collect();
        v.get(&lower)
    })
}

fn str_field(v: &serde_json::Value, name: &str) -> String {
    get_ci(v, name)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// The one client both calls share.
///
/// `reqwest::Client` owns the connection pool, so building it inline dropped
/// the pool with the future — and detection polls every 5 seconds, forever.
/// That is a fresh TCP handshake ~17k times a day, plus a rebuilt rustls config
/// and root store on an https server, for a request that should be riding a
/// kept-alive connection. Per-request timeouts still work on a shared client,
/// which matters because the two callers want different ones.
fn http() -> &'static reqwest::Client {
    static HTTP: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Karasu/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("reqwest client")
    })
}

/// GET a JSON endpoint on the configured server, as the signed-in user.
async fn get_json(
    cfg: &JellyfinConfig,
    path: &str,
) -> Result<serde_json::Value, String> {
    let base = normalize_base_url(&cfg.url);
    if base.is_empty() || cfg.token.is_empty() {
        return Err("Sign in to your Jellyfin server first".into());
    }
    let resp = http()
        .get(format!("{base}{path}"))
        .header(
            "Authorization",
            auth_header(&cfg.device_name, &cfg.device_id, Some(&cfg.token)),
        )
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
        .map_err(|e| format!("Could not reach the server: {e}"))?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        // Jellyfin's "sign out all devices" revokes tokens, and a silent
        // failure here would look exactly like "nothing is playing" forever.
        return Err("Jellyfin rejected the saved sign-in — sign in again".into());
    }
    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }
    resp.json()
        .await
        .map_err(|e| format!("Could not read the server's reply: {e}"))
}

/// A completed sign-in. The password is not part of this — it is exchanged
/// once, here, and never stored.
#[derive(Debug, PartialEq)]
pub struct AuthSession {
    pub token: String,
    pub user_id: String,
    pub user_name: String,
}

/// Reads an `AuthenticationResult` body. Split out from the request so the
/// parsing — the part that can actually be wrong — is testable offline.
pub fn parse_auth_result(body: &serde_json::Value) -> Result<AuthSession, String> {
    let token = str_field(body, "AccessToken");
    if token.is_empty() {
        return Err("The server's reply contained no access token".into());
    }
    let user = get_ci(body, "User").cloned().unwrap_or_default();
    let user_id = str_field(&user, "Id");
    if user_id.is_empty() {
        return Err("The server's reply contained no user id".into());
    }
    Ok(AuthSession {
        token,
        user_id,
        user_name: str_field(&user, "Name"),
    })
}

/// Signs in with a username and password, returning an access token and the
/// account's own id. Any Jellyfin account works — no administrator rights.
pub async fn authenticate(
    base_url: &str,
    username: &str,
    password: &str,
    device: &str,
    device_id: &str,
) -> Result<AuthSession, String> {
    let base = normalize_base_url(base_url);
    if base.is_empty() {
        return Err("Enter your server URL first".into());
    }
    if username.trim().is_empty() {
        return Err("Enter your Jellyfin username".into());
    }
    let resp = http()
        .post(format!("{base}/Users/AuthenticateByName"))
        .header("Authorization", auth_header(device, device_id, None))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "Username": username.trim(), "Pw": password }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Could not reach the server: {e}"))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        // Deliberately not the server's body: it can echo back detail that
        // does not belong on screen, and the cause is always the same.
        return Err("Wrong username or password".into());
    }
    if !resp.status().is_success() {
        return Err(format!("Sign-in failed: HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Could not read the server's reply: {e}"))?;
    parse_auth_result(&body)
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
/// it — now only the signed-in user's own, since the server scopes them.
///
/// This is the only way a user can find out what their device is actually
/// called: Jellyfin Media Player usually reports the machine hostname, but it
/// is configurable and a browser session reports the browser name instead.
pub async fn list_sessions(cfg: &JellyfinConfig) -> Result<Vec<SessionSummary>, String> {
    let sessions = get_json(cfg, "/Sessions").await?;
    Ok(sessions
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|s| SessionSummary {
                    user: str_field(s, "UserName"),
                    device: str_field(s, "DeviceName"),
                    client: str_field(s, "Client"),
                    playing: playback_from_session(s).map(|p| p.media_title),
                    matched: session_matches(s, &cfg.user_id, &cfg.device),
                })
                .collect()
        })
        .unwrap_or_default())
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

    // Ticks are 100 ns; both fields ride the payload the poll already fetches,
    // so the position costs zero extra requests.
    const TICKS_PER_SEC: u64 = 10_000_000;
    let position_sec = session
        .pointer("/PlayState/PositionTicks")
        .and_then(|v| v.as_u64())
        .map(|t| (t / TICKS_PER_SEC) as u32);
    let duration_sec = item
        .get("RunTimeTicks")
        .and_then(|v| v.as_u64())
        .map(|t| (t / TICKS_PER_SEC) as u32);

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
        position_sec,
        duration_sec,
    })
}

/// Polls the configured server for what *this* user is playing on *this*
/// device. Returns `None` when unconfigured, unreachable or idle — a Jellyfin
/// box that is switched off must not break detection for everything else.
pub async fn detect(cfg: &JellyfinConfig) -> Option<Playback> {
    if cfg.user_id.trim().is_empty() {
        return None;
    }
    let sessions = get_json(cfg, "/Sessions").await.ok()?;
    sessions
        .as_array()?
        .iter()
        .filter(|s| session_matches(s, &cfg.user_id, &cfg.device))
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
    fn the_play_state_position_rides_the_same_payload() {
        // Ticks are 100 ns: 774 s in, of a 1,420 s file. The absence case
        // matters equally — a session without a PlayState must not invent one.
        let s = json!({
            "PlayState": { "PositionTicks": 7_740_000_000u64 },
            "NowPlayingItem": {
                "Type": "Episode", "Name": "Ep", "SeriesName": "Frieren",
                "IndexNumber": 3, "RunTimeTicks": 14_200_000_000u64
            }
        });
        let p = playback_from_session(&s).unwrap();
        assert_eq!(p.position_sec, Some(774));
        assert_eq!(p.duration_sec, Some(1420));

        let bare = json!({
            "NowPlayingItem": { "Type": "Episode", "Name": "Ep", "SeriesName": "Frieren" }
        });
        let p = playback_from_session(&bare).unwrap();
        assert_eq!(p.position_sec, None);
        assert_eq!(p.duration_sec, None);
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

    #[test]
    fn auth_result_is_read_from_a_pascal_case_body() {
        // The shape Jellyfin actually serialises.
        let body = json!({
            "AccessToken": "tok-123",
            "ServerId": "srv",
            "User": { "Id": ME, "Name": "Kyu" }
        });
        assert_eq!(
            parse_auth_result(&body).unwrap(),
            AuthSession {
                token: "tok-123".into(),
                user_id: ME.into(),
                user_name: "Kyu".into(),
            }
        );
    }

    /// Guards the casing assumption rather than betting on it: a mismatch
    /// would surface as a permanent silent "nothing is playing".
    #[test]
    fn auth_result_is_read_from_a_camel_case_body() {
        let body = json!({
            "accessToken": "tok-123",
            "user": { "id": ME, "name": "Kyu" }
        });
        let s = parse_auth_result(&body).unwrap();
        assert_eq!(s.token, "tok-123");
        assert_eq!(s.user_id, ME);
        assert_eq!(s.user_name, "Kyu");
    }

    #[test]
    fn auth_result_without_a_token_or_id_is_an_error() {
        // Must not degrade into an empty token that then 401s forever.
        assert!(parse_auth_result(&json!({})).is_err());
        assert!(parse_auth_result(&json!({ "User": { "Id": ME } })).is_err());
        assert!(parse_auth_result(&json!({ "AccessToken": "t" })).is_err());
        assert!(parse_auth_result(&json!({ "AccessToken": "t", "User": {} })).is_err());
    }

    #[test]
    fn a_missing_user_name_is_tolerated() {
        // Cosmetic only -- it must not block a working sign-in.
        let body = json!({ "AccessToken": "t", "User": { "Id": ME } });
        assert_eq!(parse_auth_result(&body).unwrap().user_name, "");
    }

    #[test]
    fn the_auth_header_carries_what_jellyfin_requires() {
        let h = auth_header("KYU-PC", "dev-1", None);
        assert!(h.starts_with("MediaBrowser "));
        for part in ["Client=\"Karasu\"", "Device=\"KYU-PC\"", "DeviceId=\"dev-1\""] {
            assert!(h.contains(part), "{h} is missing {part}");
        }
        assert!(h.contains("Version=\""));
        assert!(!h.contains("Token="), "no token before signing in");
        assert!(auth_header("d", "i", Some("tok")).contains("Token=\"tok\""));
    }

    /// The header is a quoted-string list, so an unescaped quote in a hostname
    /// would corrupt every field after it.
    #[test]
    fn quotes_cannot_break_out_of_the_auth_header() {
        let h = auth_header("we\"ird", "i", None);
        assert!(h.contains("Device=\"weird\""));
        assert_eq!(h.matches('"').count() % 2, 0);
    }

    #[test]
    fn the_credential_store_is_read_once_not_once_per_poll() {
        let cache = Mutex::new(None);
        let mut reads = 0;
        for _ in 0..5 {
            let got = cached_or(&cache, || {
                reads += 1;
                Some("tok".to_string())
            });
            assert_eq!(got.as_deref(), Some("tok"));
        }
        assert_eq!(reads, 1, "five polls must cost one credential-store read");
    }

    /// The case the scrobbler actually spends most of its time in.
    #[test]
    fn a_missing_token_is_cached_too() {
        let cache = Mutex::new(None);
        let mut reads = 0;
        for _ in 0..5 {
            assert_eq!(
                cached_or(&cache, || {
                    reads += 1;
                    None
                }),
                None
            );
        }
        assert_eq!(reads, 1, "'nothing stored' must not be re-read every tick");
    }

    #[test]
    fn signing_in_or_out_replaces_what_was_cached() {
        let cache = Mutex::new(Some(Some("old".to_string())));
        *cache.lock().unwrap() = Some(Some("new".to_string()));
        assert_eq!(
            cached_or(&cache, || panic!("must not read the credential store")),
            Some("new".to_string()),
        );

        *cache.lock().unwrap() = Some(None);
        assert_eq!(
            cached_or(&cache, || panic!("must not read the credential store")),
            None,
        );
    }
}
