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
use crate::sync::LockExt;
use crate::playback::recognition::parser::Parsed;
use std::sync::Mutex;

/// Stable codes for the failures a user actually sees, rather than sentences.
///
/// A command's `Err(String)` is rendered verbatim by the frontend — there is no
/// mapping layer — so an English sentence composed here reached a German UI in
/// English. These are the `BlockReason` treatment applied to the one path a
/// user hits routinely: Settings → Detection → Jellyfin, with the wrong
/// password. `lib/backendError` maps each through a literal `t()`, and an
/// unrecognised string still falls through and is shown as-is, so a code that
/// loses its translation degrades to what shipped before rather than to
/// nothing.
///
/// Transport detail deliberately stays untranslated: "Could not reach the
/// server: <reqwest error>" carries the diagnosis in the part no dictionary
/// covers.
pub const ERR_SIGNED_OUT: &str = "jellyfin.signedOut";
pub const ERR_NO_TOKEN: &str = "jellyfin.noToken";
pub const ERR_NO_USER_ID: &str = "jellyfin.noUserId";
pub const ERR_BAD_CREDENTIALS: &str = "jellyfin.badCredentials";

#[cfg(any(windows, target_os = "linux"))]
const SERVICE: &str = "dev.kyu.karasu";
/// Credential-store entry for the Jellyfin access token.
#[cfg(any(windows, target_os = "linux"))]
const TOKEN_USER: &str = "jellyfin_token";
/// The pre-0.26 entry, which held an admin API key. Deleted on sign-in — a
/// dead secret has no business lingering in the user's credential store.
#[cfg(any(windows, target_os = "linux"))]
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

#[cfg(any(windows, target_os = "linux"))]
fn entry(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, user).map_err(|e| format!("Credential store: {e}"))
}

/// The access token lives in the OS credential store, next to the AniList
/// token, and is never handed back to the WebView — the UI only ever learns
/// whether one is stored and which account it belongs to.
#[cfg(any(windows, target_os = "linux"))]
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

/// Mobile: the token file next to the AniList one, same trade, same follow-up
/// (Keystore), same preserved invariant — see `anilist::auth`'s mobile block.
/// `cfg(mobile)` rather than not-windows-not-linux keeps the macOS stance:
/// that build still fails to compile rather than gaining an untested backend.
#[cfg(mobile)]
const MOBILE_TOKEN_FILE: &str = "jellyfin_token.dat";

#[cfg(target_os = "android")]
pub fn save_token(token: &str) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return delete_token();
    }
    let path = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE)
        .ok_or("The data directory is not known yet")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Sealed through the Keystore, exactly like the AniList token — the
    // follow-up this block's comment always promised. Same key alias, same
    // `KRSA1` framing, same migration on read below.
    let sealed = crate::keystore::seal(token.as_bytes())?;
    std::fs::write(path, crate::keystore::frame(&sealed))
        .map_err(|e| format!("Could not save the access token: {e}"))?;
    set_cached_token(Some(token.to_string()));
    Ok(())
}

#[cfg(all(mobile, not(target_os = "android")))]
pub fn save_token(token: &str) -> Result<(), String> {
    let token = token.trim();
    if token.is_empty() {
        return delete_token();
    }
    let path = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE)
        .ok_or("The data directory is not known yet")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, token.as_bytes())
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

#[cfg(any(windows, target_os = "linux"))]
pub fn load_token() -> Option<String> {
    cached_or(&TOKEN_CACHE, || {
        let Ok(entry) = entry(TOKEN_USER) else {
            crate::logging::warn("jellyfin", "cannot reach the credential store");
            // `Err` here means "we could not look", which must not be cached
            // as "nothing is stored": one transient Credential Manager hiccup
            // would otherwise disable Jellyfin until the next restart.
            return Err(());
        };
        match entry.get_password() {
            Ok(token) => Ok(Some(token).filter(|k: &String| !k.is_empty())),
            // A genuinely absent credential is an answer, and worth caching —
            // that is the 17,280-reads-a-day case this cache exists for.
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => {
                crate::logging::warn("jellyfin", format!("could not read the token: {e}"));
                Err(())
            }
        }
    })
}

/// Reads through `cache`, filling it on the first miss.
///
/// Split out from `load_token` so the caching itself is testable without
/// touching the real credential store.
///
/// `read` returns `Err(())` for "the store could not be read at all", which is
/// the one answer that must **not** be remembered — see `load_token`. `Ok(None)`
/// ("looked, nothing there") is cached like any other answer, because that is
/// the signed-out case this cache exists to stop hammering.
///
/// A poisoned lock is recovered from rather than propagated: a panic elsewhere
/// should not permanently break Jellyfin detection, and the worst case is one
/// stale read that the next sign-in overwrites.
fn cached_or<F>(cache: &Mutex<Option<Option<String>>>, read: F) -> Option<String>
where
    F: FnOnce() -> Result<Option<String>, ()>,
{
    let mut guard = cache.guard();
    if let Some(known) = guard.as_ref() {
        return known.clone();
    }
    let Ok(fresh) = read() else {
        return None;
    };
    *guard = Some(fresh.clone());
    fresh
}

fn set_cached_token(token: Option<String>) {
    *TOKEN_CACHE.guard() = Some(token);
}

#[cfg(any(windows, target_os = "linux"))]
pub fn delete_token() -> Result<(), String> {
    if let Ok(e) = entry(TOKEN_USER) {
        let _ = e.delete_credential();
    }
    set_cached_token(None);
    Ok(())
}

#[cfg(target_os = "android")]
pub fn load_token() -> Option<String> {
    cached_or(&TOKEN_CACHE, || {
        let Some(path) = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE) else {
            // Startup has not recorded the data dir yet — "could not look",
            // which must not be cached as "nothing is stored".
            return Err(());
        };
        match std::fs::read(&path) {
            Ok(raw) => match crate::keystore::classify(&raw) {
                crate::keystore::Stored::Sealed(sealed) => match crate::keystore::open(sealed) {
                    Ok(plain) => Ok(String::from_utf8(plain).ok().filter(|t| !t.is_empty())),
                    Err(e) => {
                        // Signed out, not a crash loop — same stance as the
                        // AniList arm; cached, since retrying cannot help.
                        crate::logging::warn(
                            "jellyfin",
                            format!("stored token would not decrypt; signed out: {e}"),
                        );
                        Ok(None)
                    }
                },
                // Written before sealing existed: re-wrap in place; a failed
                // re-wrap keeps the session on the old bytes and retries on
                // the next launch.
                crate::keystore::Stored::Legacy(plain) => {
                    let token = String::from_utf8(plain.to_vec())
                        .ok()
                        .filter(|t| !t.is_empty());
                    if let Some(t) = &token {
                        match crate::keystore::seal(t.as_bytes()) {
                            Ok(sealed) => {
                                if let Err(e) =
                                    std::fs::write(&path, crate::keystore::frame(&sealed))
                                {
                                    crate::logging::warn(
                                        "jellyfin",
                                        format!("could not rewrite the migrated token: {e}"),
                                    );
                                } else {
                                    crate::logging::info(
                                        "jellyfin",
                                        "token migrated to the Keystore",
                                    );
                                }
                            }
                            Err(e) => crate::logging::warn(
                                "jellyfin",
                                format!("token migration failed, keeping plaintext: {e}"),
                            ),
                        }
                    }
                    Ok(token)
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => {
                crate::logging::warn("jellyfin", format!("could not read the token: {e}"));
                Err(())
            }
        }
    })
}

#[cfg(all(mobile, not(target_os = "android")))]
pub fn load_token() -> Option<String> {
    cached_or(&TOKEN_CACHE, || {
        let Some(path) = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE) else {
            // Startup has not recorded the data dir yet — "could not look",
            // which must not be cached as "nothing is stored".
            return Err(());
        };
        match std::fs::read(&path) {
            Ok(raw) => Ok(String::from_utf8(raw).ok().filter(|t| !t.is_empty())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => {
                crate::logging::warn("jellyfin", format!("could not read the token: {e}"));
                Err(())
            }
        }
    })
}

#[cfg(mobile)]
pub fn delete_token() -> Result<(), String> {
    if let Some(path) = crate::portable::mobile_secret_file(MOBILE_TOKEN_FILE) {
        let _ = std::fs::remove_file(path);
    }
    set_cached_token(None);
    Ok(())
}

/// Removes the admin API key stored by earlier versions. It is useless now,
/// and it grants more on the server than Karasu ever needs.
#[cfg(any(windows, target_os = "linux"))]
pub fn delete_legacy_api_key() {
    if let Ok(e) = entry(LEGACY_KEY_USER) {
        let _ = e.delete_credential();
    }
}

/// The legacy key predates any mobile build, so there is nothing to clean up.
#[cfg(mobile)]
pub fn delete_legacy_api_key() {}

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
        crate::net::client_builder()
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
        return Err(ERR_SIGNED_OUT.into());
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
        return Err(ERR_NO_TOKEN.into());
    }
    let user = get_ci(body, "User").cloned().unwrap_or_default();
    let user_id = str_field(&user, "Id");
    if user_id.is_empty() {
        return Err(ERR_NO_USER_ID.into());
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
        return Err(ERR_BAD_CREDENTIALS.into());
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
    // Every read here goes through `get_ci`, for the reason that function was
    // written: a casing mismatch fails as a silent "nothing is playing", and
    // this mapping used to be the one place in the file that did not use it.
    let item = get_ci(session, "NowPlayingItem")?;
    let kind = get_ci(item, "Type").and_then(|v| v.as_str()).unwrap_or("");
    if kind != "Episode" && kind != "Movie" {
        return None;
    }

    // Paused still counts as "what you're watching" — the scrobbler's own
    // threshold decides when to act, and a pause shouldn't drop the session.
    let episode_name = get_ci(item, "Name").and_then(|v| v.as_str()).unwrap_or("");
    let series = get_ci(item, "SeriesName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let episode = get_ci(item, "IndexNumber")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let season = get_ci(item, "ParentIndexNumber")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    // A movie has no series name; its own title is the title. An *episode*
    // without one is a different animal: falling back would put the episode
    // name into `Parsed.title`, which can never match anything and reads on
    // screen as "it detected the episode, not the show". Better to yield
    // nothing with a reason, and let a lower rung try.
    let title = match (kind, series.is_empty()) {
        (_, false) => series,
        ("Movie", true) => episode_name.trim(),
        (_, true) => {
            crate::logging::debug_changed(
                "jellyfin",
                "detect",
                format!("episode {episode_name:?} carries no SeriesName; skipped"),
            );
            return None;
        }
    };
    if title.is_empty() {
        return None;
    }

    let client = get_ci(session, "Client")
        .and_then(|v| v.as_str())
        .unwrap_or("Jellyfin");

    // Ticks are 100 ns; both fields ride the payload the poll already fetches,
    // so the position costs zero extra requests.
    const TICKS_PER_SEC: u64 = 10_000_000;
    let position_sec = get_ci(session, "PlayState")
        .and_then(|p| get_ci(p, "PositionTicks"))
        .and_then(|v| v.as_u64())
        .map(|t| (t / TICKS_PER_SEC) as u32);
    let duration_sec = get_ci(item, "RunTimeTicks")
        .and_then(|v| v.as_u64())
        .map(|t| (t / TICKS_PER_SEC) as u32);

    Some(Playback {
        process: format!("jellyfin ({client})"),
        // Human-readable, and spelled the way Jellyfin itself displays it —
        // `S2E1`, not a bare `1`. The season is not decoration here: this
        // string is what the poll loop dedupes on, and without it S1E1 and
        // S2E1 are byte-identical whenever the episode names repeat (German
        // "Folge 1" in every season does exactly that), so moving between
        // seasons at the same episode number never rebuilt the match.
        media_title: match (season, episode, episode_name.is_empty()) {
            (Some(s), Some(n), false) => format!("{title} - S{s}E{n} - {episode_name}"),
            (Some(s), Some(n), true) => format!("{title} - S{s}E{n}"),
            (None, Some(n), false) => format!("{title} - {n} - {episode_name}"),
            (None, Some(n), true) => format!("{title} - {n}"),
            (_, None, _) => title.to_string(),
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
///
/// Every one of those `None`s used to be silent, and that is what made a
/// broken rung indistinguishable from an idle one: a revoked token, an
/// unreachable server and "nothing is playing" all produced the same nothing,
/// while detection quietly demoted to a window title. The failures now leave a
/// line — through `debug_changed`, so a 5 s poll writes one line per *change*
/// rather than 17,280 a day.
pub async fn detect(cfg: &JellyfinConfig) -> Option<Playback> {
    if cfg.user_id.trim().is_empty() {
        crate::logging::debug_changed("jellyfin", "detect", "no user id stored; rung skipped");
        return None;
    }
    let sessions = match get_json(cfg, "/Sessions").await {
        Ok(v) => v,
        Err(e) => {
            crate::logging::debug_changed("jellyfin", "detect", format!("/Sessions failed: {e}"));
            // A failed request is not an answer, and treating it as one is
            // what made a single slow response visible: detection dropped to
            // the media session, which composes an episode-name title, and
            // the card flipped to it for that tick. Hold the last good answer
            // for a few ticks instead. See `last_good`.
            return hold_last_good();
        }
    };
    let Some(list) = sessions.as_array() else {
        crate::logging::debug_changed("jellyfin", "detect", "/Sessions was not a list");
        return None;
    };
    let mut matched = 0usize;
    let found = list
        .iter()
        .filter(|s| session_matches(s, &cfg.user_id, &cfg.device))
        .inspect(|_| matched += 1)
        .find_map(playback_from_session);
    if found.is_none() {
        // The two numbers separate "the filter rejects everything" from
        // "nothing is playing" — the exact question the Test-connection
        // button answers by hand, now answered in the log automatically.
        crate::logging::debug_changed(
            "jellyfin",
            "detect",
            format!(
                "no playback: {} of {} sessions matched the user/device filter",
                matched,
                list.len()
            ),
        );
    }
    // The server answered. Whatever it said is the truth, including "nothing"
    // — an episode that just finished must end the session at once, not three
    // ticks later.
    remember(found)
}

/// How many consecutive failed polls may be papered over. Three ticks of a
/// 5 s poll is fifteen seconds — long enough to ride out one slow `/Sessions`
/// response or a proxy hiccup, short enough that a server which really went
/// away is noticed while the episode is still playing.
const HOLD_TICKS: u8 = 3;

/// The last answer the server actually gave, and how many failures have been
/// covered with it since.
static LAST_GOOD: Mutex<Option<(Playback, u8)>> = Mutex::new(None);

/// Records a successful poll and hands the answer straight back.
fn remember(found: Option<Playback>) -> Option<Playback> {
    let mut guard = LAST_GOOD.guard();
    *guard = found.clone().map(|p| (p, 0));
    found
}

/// The stand-in for a failed poll, while there is one to give.
///
/// Deliberately only reachable from the request-failed branch: "the server
/// says nothing is playing" is an answer and clears the memory through
/// `remember`, so this can never keep a finished episode alive.
fn hold_last_good() -> Option<Playback> {
    let mut guard = LAST_GOOD.guard();
    let Some((playback, used)) = guard.as_mut() else {
        return None;
    };
    if *used >= HOLD_TICKS {
        crate::logging::debug_changed(
            "jellyfin",
            "hold",
            "server still unreachable; letting the lower sources answer",
        );
        *guard = None;
        return None;
    }
    *used += 1;
    crate::logging::debug_changed(
        "jellyfin",
        "hold",
        format!("holding the last answer while the server is unreachable ({used}/{HOLD_TICKS})"),
    );
    Some(playback.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These four strings are a contract with `src/lib/backendError.ts`, which
    /// maps each to a translated sentence. Nothing in either language's
    /// tooling can see across the boundary, so the coupling is pinned here —
    /// renaming a code in Rust alone makes this fail rather than silently
    /// showing the raw code to a user.
    #[test]
    fn the_error_codes_match_what_the_frontend_maps() {
        assert_eq!(ERR_SIGNED_OUT, "jellyfin.signedOut");
        assert_eq!(ERR_NO_TOKEN, "jellyfin.noToken");
        assert_eq!(ERR_NO_USER_ID, "jellyfin.noUserId");
        assert_eq!(ERR_BAD_CREDENTIALS, "jellyfin.badCredentials");
    }

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

    /// `LAST_GOOD` is process-global and `cargo test` runs in parallel, so the
    /// two tests that drive it take this lock. The logging suite learned the
    /// same lesson the expensive way: without it the suite is green by
    /// scheduling luck and fails on a CI runner instead.
    static HOLD_STATE: Mutex<()> = Mutex::new(());

    /// A failed assertion in one locked test must not poison the other.
    fn serialize_hold() -> std::sync::MutexGuard<'static, ()> {
        HOLD_STATE.guard()
    }

    fn some_playback(title: &str) -> Playback {
        playback_from_session(&json!({
            "NowPlayingItem": {
                "Type": "Episode", "Name": "Ep", "SeriesName": title, "IndexNumber": 1
            }
        }))
        .unwrap()
    }

    /// A failed request is not an answer. One slow `/Sessions` used to demote
    /// detection to the media session for that tick, which composes a title
    /// out of the *episode* name — the "sometimes it just says Folge 1" case.
    #[test]
    fn a_failed_poll_holds_the_last_answer_but_not_for_ever() {
        let _guard = serialize_hold();
        *LAST_GOOD.guard() = None;

        // Nothing to hold yet: a failure before any success stays a failure.
        assert!(hold_last_good().is_none());

        let playback = some_playback("Beyblade: Metal Fusion");
        remember(Some(playback.clone()));

        for _ in 0..HOLD_TICKS {
            assert_eq!(
                hold_last_good().map(|p| p.media_title.clone()),
                Some(playback.media_title.clone()),
                "a transient failure must not change what is playing"
            );
        }
        // Past the window the server is genuinely gone; let the lower rungs try.
        assert!(hold_last_good().is_none());
        assert!(hold_last_good().is_none(), "and it stays given up");
    }

    /// The other half, and the one that matters for correctness: "the server
    /// says nothing is playing" is an answer, so a finished episode ends the
    /// session immediately rather than lingering for three ticks.
    #[test]
    fn a_clean_nothing_playing_clears_the_memory_at_once() {
        let _guard = serialize_hold();
        *LAST_GOOD.guard() = None;
        remember(Some(some_playback("Frieren")));
        assert!(remember(None).is_none());
        assert!(hold_last_good().is_none());
    }

    /// The whole reason `get_ci` exists, applied to the mapping that used to
    /// skip it: a camelCase body must detect exactly like a PascalCase one.
    #[test]
    fn a_camel_case_session_maps_the_same_as_a_pascal_case_one() {
        let s = json!({
            "client": "Jellyfin Web",
            "playState": { "positionTicks": 7_740_000_000u64 },
            "nowPlayingItem": {
                "type": "Episode",
                "name": "The Mage's Journey",
                "seriesName": "Frieren",
                "indexNumber": 5,
                "parentIndexNumber": 2,
                "runTimeTicks": 14_200_000_000u64
            }
        });
        let p = playback_from_session(&s).unwrap();
        let parsed = p.parsed.unwrap();
        assert_eq!(parsed.title, "Frieren");
        assert_eq!(parsed.episode, Some(5));
        assert_eq!(parsed.season, Some(2));
        assert_eq!(p.position_sec, Some(774));
        assert_eq!(p.duration_sec, Some(1420));
    }

    /// An episode with no series name must not pass its *own* name off as the
    /// show: that title can never match, and on screen it reads as "Karasu
    /// detected the episode, not the anime". A movie still uses its own name.
    #[test]
    fn an_episode_without_a_series_yields_nothing_but_a_movie_keeps_its_name() {
        let orphan = json!({
            "NowPlayingItem": { "Type": "Episode", "Name": "The Mage's Journey", "IndexNumber": 5 }
        });
        assert!(playback_from_session(&orphan).is_none());

        let movie = json!({
            "NowPlayingItem": { "Type": "Movie", "Name": "A Silent Voice" }
        });
        let p = playback_from_session(&movie).unwrap();
        assert_eq!(p.parsed.unwrap().title, "A Silent Voice");
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
                Ok(Some("tok".to_string()))
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
                    Ok(None)
                }),
                None
            );
        }
        assert_eq!(reads, 1, "'nothing stored' must not be re-read every tick");
    }

    /// The distinction the `Result` exists for: "we could not look" is not an
    /// answer, and caching it would disable Jellyfin until the next restart
    /// over one transient credential-store failure.
    #[test]
    fn a_failed_read_is_retried_rather_than_remembered() {
        let cache = Mutex::new(None);
        let mut reads = 0;
        for _ in 0..3 {
            assert_eq!(
                cached_or(&cache, || {
                    reads += 1;
                    Err(())
                }),
                None
            );
        }
        assert_eq!(reads, 3, "a failure must be retried on the next poll");

        // And the moment it succeeds, that answer is cached like any other.
        assert_eq!(
            cached_or(&cache, || Ok(Some("tok".into()))).as_deref(),
            Some("tok")
        );
        assert_eq!(
            cached_or(&cache, || panic!("must not read the credential store")).as_deref(),
            Some("tok")
        );
    }

    #[test]
    fn signing_in_or_out_replaces_what_was_cached() {
        let cache = Mutex::new(Some(Some("old".to_string())));
        *cache.guard() = Some(Some("new".to_string()));
        assert_eq!(
            cached_or(&cache, || panic!("must not read the credential store")),
            Some("new".to_string()),
        );

        *cache.guard() = Some(None);
        assert_eq!(
            cached_or(&cache, || panic!("must not read the credential store")),
            None,
        );
    }
}
