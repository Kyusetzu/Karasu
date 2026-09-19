//! Jellyfin as a detection source via `/Sessions`, signed in as a user so the server scopes the sessions to that user.

use super::Playback;
use crate::sync::LockExt;
use crate::playback::recognition::parser::Parsed;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Stable codes for the failures a user sees; `lib/backendError` maps each through `t()`, and an unknown one shows as-is.
pub const ERR_SIGNED_OUT: &str = "jellyfin.signedOut";
pub const ERR_NO_TOKEN: &str = "jellyfin.noToken";
pub const ERR_NO_USER_ID: &str = "jellyfin.noUserId";
pub const ERR_BAD_CREDENTIALS: &str = "jellyfin.badCredentials";
pub const ERR_BAD_URL: &str = "jellyfin.badUrl";
/// The address answered, but not with `/System/Info/Public`: a web page, a proxy's error, some other service.
pub const ERR_NOT_JELLYFIN: &str = "jellyfin.notJellyfin";
/// The external address answers as a different Jellyfin server; not stored, because the token would go to it.
pub const ERR_EXTERNAL_OTHER_SERVER: &str = "jellyfin.externalOtherServer";
/// The server's own id is not known yet, so "the same server" cannot be checked and the external address is not stored.
pub const ERR_EXTERNAL_UNKNOWN_SERVER: &str = "jellyfin.externalUnknownServer";

/// The name in the `MediaBrowser` header, per platform so a `/Sessions` row can tell a desktop from a phone.
#[cfg(not(target_os = "android"))]
pub const CLIENT_NAME: &str = "Karasu";
#[cfg(target_os = "android")]
pub const CLIENT_NAME: &str = "Karasu Android";

#[cfg(any(windows, target_os = "linux"))]
const SERVICE: &str = "dev.kyu.karasu";
/// Credential-store entry for the Jellyfin access token.
#[cfg(any(windows, target_os = "linux"))]
const TOKEN_USER: &str = "jellyfin_token";
/// The old entry that held an admin API key, deleted on sign-in so a dead secret does not linger in the store.
#[cfg(any(windows, target_os = "linux"))]
const LEGACY_KEY_USER: &str = "jellyfin";

/// Everything the source needs to poll one user's playback on one device.
#[derive(Clone)]
pub struct JellyfinConfig {
    pub url: String,
    pub token: String,
    pub user_id: String,
    /// Empty means "any device of that user".
    pub device: String,
    pub device_name: String,
    pub device_id: String,
    /// A second base to try when `url` is out of reach, away from the LAN; empty when there is none.
    pub external_url: String,
    /// The server's id from sign-in; the external address must answer with the same one before the token travels to it.
    pub server_id: String,
}

#[cfg(any(windows, target_os = "linux"))]
fn entry(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, user).map_err(|e| format!("Credential store: {e}"))
}

/// The access token lives in the OS credential store next to the AniList one and is never handed back to the WebView.
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

/// Mobile: the token file beside the AniList one; `cfg(mobile)` keeps a macOS build failing rather than gaining a backend.
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
    // Sealed through the Keystore exactly like the AniList token: same key alias, same framing, same migration on read.
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

/// The last credential-store read; the outer `Option` is "looked yet", so a signed-out user is not re-read every tick.
static TOKEN_CACHE: Mutex<Option<Option<String>>> = Mutex::new(None);

#[cfg(any(windows, target_os = "linux"))]
pub fn load_token() -> Option<String> {
    cached_or(&TOKEN_CACHE, || {
        let Ok(entry) = entry(TOKEN_USER) else {
            crate::logging::warn("jellyfin", "cannot reach the credential store");
            // "Could not look" must not be cached as "nothing stored", or one store hiccup disables Jellyfin until restart.
            return Err(());
        };
        match entry.get_password() {
            Ok(token) => Ok(Some(token).filter(|k: &String| !k.is_empty())),
            // A genuinely absent credential is an answer, and the case this cache exists for.
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => {
                crate::logging::warn("jellyfin", format!("could not read the token: {e}"));
                Err(())
            }
        }
    })
}

/// Reads through `cache` on the first miss; `Err(())` means "could not read" and is the one answer never remembered.
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
            // Startup has not recorded the data dir yet: "could not look", which must not be cached as "nothing is stored".
            return Err(());
        };
        match std::fs::read(&path) {
            Ok(raw) => match crate::keystore::classify(&raw) {
                crate::keystore::Stored::Sealed(sealed) => match crate::keystore::open(sealed) {
                    Ok(plain) => Ok(String::from_utf8(plain).ok().filter(|t| !t.is_empty())),
                    Err(e) => {
                        // Signed out, not a crash loop, and cached since retrying cannot help.
                        crate::logging::warn(
                            "jellyfin",
                            format!("stored token would not decrypt; signed out: {e}"),
                        );
                        Ok(None)
                    }
                },
                // Written before sealing existed: re-wrapped in place; a failed re-wrap keeps the old bytes and retries next launch.
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
            // Startup has not recorded the data dir yet: "could not look", which must not be cached as "nothing is stored".
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

/// Removes the admin API key stored by earlier versions; it grants more on the server than Karasu needs.
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

/// Jellyfin writes the same user id dashed and undashed depending on the endpoint, and casing varies too.
fn normalize_guid(raw: &str) -> String {
    raw.chars()
        .filter(|c| *c != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

/// Whether a `/Sessions` entry belongs to the configured user and device; an empty `user_id` matches nothing, on purpose.
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

/// The header Jellyfin identifies the client by; a stable `DeviceId` keeps the server's device list from piling up.
fn auth_header(device: &str, device_id: &str, token: Option<&str>) -> String {
    let version = env!("CARGO_PKG_VERSION");
    // Jellyfin answers `Device=""` with HTTP 400 before looking at the credentials, so the name is floored after escaping.
    let device = match escape(device) {
        d if d.trim().is_empty() => "Karasu".to_string(),
        d => d,
    };
    let mut header = format!(
        "MediaBrowser Client=\"{CLIENT_NAME}\", Device=\"{device}\", DeviceId=\"{}\", Version=\"{version}\"",
        escape(device_id),
    );
    if let Some(t) = token {
        header.push_str(&format!(", Token=\"{}\"", escape(t)));
    }
    header
}

/// The header is a quoted-string list, so a stray quote or backslash in a hostname would corrupt every field after it.
fn escape(value: &str) -> String {
    value.replace(['\\', '"'], "")
}

/// Reads a PascalCase field, falling back to camelCase, since a casing mismatch fails as a silent "nothing is playing".
pub(super) fn get_ci<'a>(v: &'a serde_json::Value, name: &str) -> Option<&'a serde_json::Value> {
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

pub(super) fn str_field(v: &serde_json::Value, name: &str) -> String {
    get_ci(v, name)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

/// The one shared client: `reqwest::Client` owns the connection pool, and one built per call drops it on every poll.
pub(super) fn http() -> &'static reqwest::Client {
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
    if normalize_base_url(&cfg.url).is_empty() || cfg.token.is_empty() {
        return Err(ERR_SIGNED_OUT.into());
    }
    let auth = auth_header(&cfg.device_name, &cfg.device_id, Some(&cfg.token));
    let resp = send_on(cfg, |base| {
        http()
            .get(format!("{base}{path}"))
            .header("Authorization", auth.as_str())
            .header("Accept", "application/json")
            .timeout(Duration::from_secs(4))
    })
    .await?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        // A revoked token would otherwise look exactly like "nothing is playing" forever.
        return Err("Jellyfin rejected the saved sign-in — sign in again".into());
    }
    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }
    resp.json()
        .await
        .map_err(|e| format!("Could not read the server's reply: {e}"))
}

/// A completed sign-in; the password is exchanged once and never stored.
#[derive(Debug, PartialEq)]
pub struct AuthSession {
    pub token: String,
    pub user_id: String,
    pub user_name: String,
}

/// Reads an `AuthenticationResult` body, split from the request so the parsing is testable offline.
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

/// Signs in with a username and password; any Jellyfin account works, no administrator rights needed.
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
        // Not the server's body: it can echo detail that does not belong on screen, and the cause is always the same.
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
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub user: String,
    pub device: String,
    pub client: String,
    pub device_id: String,
    /// What that session is playing, or `None` when it is idle.
    pub playing: Option<String>,
    /// Whether the configured user/device filter accepts this session.
    pub matched: bool,
    /// Set when the row is a Karasu — this one included — with its platform.
    pub karasu: Option<Platform>,
    /// Seconds between this row's last activity and this instance's own row, on the server clock; what `yield_to` judges by.
    pub active_ago_sec: Option<i64>,
}

/// Every session the server reports, flagged by the filter; the only way to learn what a device is actually called.
pub async fn list_sessions(cfg: &JellyfinConfig) -> Result<Vec<SessionSummary>, String> {
    let sessions = get_json(cfg, "/Sessions").await?;
    let Some(arr) = sessions.as_array() else {
        return Ok(Vec::new());
    };
    let (own, _) = peers_from_sessions(arr, &cfg.device_id);
    let reference = own.and_then(|p| p.last_activity);
    Ok(arr
        .iter()
        .map(|s| SessionSummary {
            user: str_field(s, "UserName"),
            device: str_field(s, "DeviceName"),
            client: str_field(s, "Client"),
            device_id: str_field(s, "DeviceId"),
            playing: playback_from_session(s).map(|p| p.media_title),
            matched: session_matches(s, &cfg.user_id, &cfg.device),
            karasu: platform_of(&str_field(s, "Client")),
            active_ago_sec: match (reference, last_activity(s)) {
                (Some(now), Some(then)) => Some(now - then),
                _ => None,
            },
        })
        .collect())
}

// --- Peers: the other Karasus on the same account ----------------------------

/// Which kind of Karasu a `/Sessions` row is; ordered, because a desktop outranks a phone and that order is the rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Mobile,
    Desktop,
}

/// The platform this build announces — see `CLIENT_NAME`.
#[cfg(not(target_os = "android"))]
pub const OWN_PLATFORM: Platform = Platform::Desktop;
#[cfg(target_os = "android")]
pub const OWN_PLATFORM: Platform = Platform::Mobile;

/// Another Karasu signed in as the same Jellyfin user, as `/Sessions` lists it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub device_id: String,
    pub device_name: String,
    pub platform: Platform,
    /// `LastActivityDate` as Unix seconds; `None` when absent or unreadable.
    pub last_activity: Option<i64>,
}

/// How recently a peer must have been heard from to count as present: twice the heartbeat plus slack.
pub const FRESH: Duration = Duration::from_secs(30);
/// How often a tracking instance refreshes its own row. See `heartbeat`.
pub const HEARTBEAT: Duration = Duration::from_secs(15);

/// Reads a Karasu `Client` name into a platform; every suffixed flavour ranks below the bare desktop name and waits.
pub fn platform_of(client: &str) -> Option<Platform> {
    let client = client.trim();
    if client == "Karasu" {
        Some(Platform::Desktop)
    } else if client.starts_with("Karasu") {
        Some(Platform::Mobile)
    } else {
        None
    }
}

/// Jellyfin's timestamp spelling as Unix seconds, offsets honoured; there is no date crate in the tree for one field.
pub fn parse_utc_seconds(s: &str) -> Option<i64> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 19
        || b[4] != b'-'
        || b[7] != b'-'
        || (b[10] != b'T' && b[10] != b' ')
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let num = |from: usize, to: usize| -> Option<i64> { s.get(from..to)?.parse::<i64>().ok() };
    let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hour, minute, second) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60
    {
        return None;
    }
    // A fraction, if any, then the zone.
    let mut rest = &s[19..];
    if let Some(after) = rest.strip_prefix('.') {
        let digits = after.bytes().take_while(|c| c.is_ascii_digit()).count();
        rest = &after[digits..];
    }
    let offset = match rest {
        "" | "Z" | "z" => 0,
        _ => {
            let sign = match rest.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let tz = rest[1..].replace(':', "");
            if tz.len() != 4 {
                return None;
            }
            let h = tz[0..2].parse::<i64>().ok()?;
            let m = tz[2..4].parse::<i64>().ok()?;
            sign * (h * 3600 + m * 60)
        }
    };
    // Days since 1970-01-01, Howard Hinnant's days-from-civil.
    let (y, m) = if month <= 2 { (year - 1, month + 9) } else { (year, month - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + hour * 3600 + minute * 60 + second - offset)
}

fn last_activity(session: &serde_json::Value) -> Option<i64> {
    get_ci(session, "LastActivityDate")
        .and_then(|v| v.as_str())
        .and_then(parse_utc_seconds)
}

/// One `/Sessions` row as a peer, or `None` for anything that is not a Karasu.
pub fn peer_from_session(session: &serde_json::Value) -> Option<Peer> {
    let platform = platform_of(&str_field(session, "Client"))?;
    let device_id = str_field(session, "DeviceId");
    if device_id.is_empty() {
        return None;
    }
    Some(Peer {
        device_id,
        device_name: str_field(session, "DeviceName"),
        platform,
        last_activity: last_activity(session),
    })
}

/// The own row and every other Karasu; own prefers this build's platform, since a renamed row lingers with the same id.
pub fn peers_from_sessions(
    list: &[serde_json::Value],
    own_device_id: &str,
) -> (Option<Peer>, Vec<Peer>) {
    let mut own: Option<Peer> = None;
    let mut peers = Vec::new();
    for peer in list.iter().filter_map(peer_from_session) {
        if peer.device_id == own_device_id {
            if !own.as_ref().is_some_and(|o| o.platform == OWN_PLATFORM) {
                own = Some(peer);
            }
        } else {
            peers.push(peer);
        }
    }
    (own, peers)
}

/// Whether `a` goes before `b`: a desktop before a phone, then the lower device id, so two desktops never both defer.
pub fn outranks(a: &Peer, b: &Peer) -> bool {
    a.platform > b.platform || (a.platform == b.platform && a.device_id < b.device_id)
}

/// The peer to wait for before writing; freshness is measured against the own row, so only the server's clock counts.
pub fn yield_to<'a>(peers: &'a [Peer], own: &Peer, fresh: Duration) -> Option<&'a Peer> {
    let now = own.last_activity?;
    let fresh = fresh.as_secs() as i64;
    peers
        .iter()
        .filter(|p| p.last_activity.is_some_and(|t| now - t <= fresh))
        .filter(|p| outranks(p, own))
        .fold(None, |best: Option<&Peer>, p| match best {
            Some(b) if outranks(b, p) => Some(b),
            _ => Some(p),
        })
}

/// What the last `/Sessions` answer said about the other Karasus.
#[derive(Debug, Clone)]
pub struct PeerSnapshot {
    pub own: Option<Peer>,
    pub peers: Vec<Peer>,
    pub taken: Instant,
}

/// Side channel to the scrobbler: `Playback` is shared by every source, and the peer list is a fact about this one alone.
static PEERS: Mutex<Option<PeerSnapshot>> = Mutex::new(None);

fn record_peers(list: &[serde_json::Value], own_device_id: &str) {
    let (own, peers) = peers_from_sessions(list, own_device_id);
    *PEERS.guard() = Some(PeerSnapshot { own, peers, taken: Instant::now() });
}

/// The snapshot unless older than `max_age`; a server that stopped answering must not leave a ghost desktop to defer to.
pub fn peer_snapshot(max_age: Duration) -> Option<PeerSnapshot> {
    PEERS.guard().clone().filter(|s| s.taken.elapsed() <= max_age)
}

/// `GET /Sessions` does not refresh `LastActivityDate`; only the empty capabilities POST does, so the heartbeat stays.
pub async fn heartbeat(cfg: &JellyfinConfig) {
    static LAST_BEAT: Mutex<Option<Instant>> = Mutex::new(None);
    {
        let mut last = LAST_BEAT.guard();
        if last.is_some_and(|t| t.elapsed() < HEARTBEAT) {
            return;
        }
        *last = Some(Instant::now());
    }
    match post_empty(cfg, "/Sessions/Capabilities").await {
        Ok(()) => crate::logging::debug_changed("jellyfin", "heartbeat", "heartbeat accepted"),
        Err(e) => crate::logging::debug_changed(
            "jellyfin",
            "heartbeat",
            format!("heartbeat failed: {e}"),
        ),
    }
}

/// POST with no body, as the signed-in user. The same checks as `get_json`.
async fn post_empty(cfg: &JellyfinConfig, path: &str) -> Result<(), String> {
    if normalize_base_url(&cfg.url).is_empty() || cfg.token.is_empty() {
        return Err(ERR_SIGNED_OUT.into());
    }
    let auth = auth_header(&cfg.device_name, &cfg.device_id, Some(&cfg.token));
    let resp = send_on(cfg, |base| {
        http()
            .post(format!("{base}{path}"))
            .header("Authorization", auth.as_str())
            .header("Content-Length", "0")
            .timeout(Duration::from_secs(4))
    })
    .await?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Jellyfin rejected the saved sign-in — sign in again".into());
    }
    if !resp.status().is_success() {
        return Err(format!("Server responded with HTTP {}", resp.status()));
    }
    Ok(())
}

// --- The external address ----------------------------------------------------

/// Trims and validates the optional second address; plain http is allowed, and the pane warns about the token instead.
pub fn validate_external_url(raw: &str) -> Result<String, &'static str> {
    let base = normalize_base_url(raw);
    if base.is_empty() {
        return Ok(base);
    }
    if !crate::net::is_usable_base_url(&base) {
        return Err(ERR_BAD_URL);
    }
    Ok(base)
}

/// Whether the token would cross the public internet unencrypted on this address: http, and a host that is not local.
pub fn external_is_plain_http(base: &str) -> bool {
    reqwest::Url::parse(base).is_ok_and(|u| {
        u.scheme() == "http" && u.host_str().is_some_and(|h| !crate::net::host_is_local(h))
    })
}

/// Whether an external address's probe names the server this account signed in to; an empty stored id refuses.
pub fn external_accepted(info: &super::discovery::ServerInfo, server_id: &str) -> bool {
    let id = server_id.trim();
    !id.is_empty() && info.id.trim() == id
}

/// Which of the two addresses a request went to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Base {
    Local,
    External,
}

/// How long the external address stays in use after the local one failed before the local one is tried again.
pub const STICKY: Duration = Duration::from_secs(5 * 60);

/// Which address to try first and where to fall back to; pure, with `BASE` holding the one instance per process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BaseState {
    active: Base,
    since: Option<Instant>,
}

impl BaseState {
    pub const fn new() -> Self {
        BaseState { active: Base::Local, since: None }
    }

    /// The base to try first, now.
    pub fn first(&self, now: Instant) -> Base {
        match (self.active, self.since) {
            (Base::External, Some(since)) if now.duration_since(since) < STICKY => Base::External,
            _ => Base::Local,
        }
    }

    /// Records how a base fared and names the fallback: local failure starts the sticky clock, external failure goes home.
    pub fn record(&mut self, tried: Base, ok: bool, has_external: bool, now: Instant) -> Option<Base> {
        match (tried, ok) {
            (Base::Local, true) => {
                *self = BaseState::new();
                None
            }
            (Base::Local, false) if has_external => {
                *self = BaseState { active: Base::External, since: Some(now) };
                Some(Base::External)
            }
            (Base::Local, false) => None,
            (Base::External, true) => {
                if self.active != Base::External {
                    *self = BaseState { active: Base::External, since: Some(now) };
                }
                None
            }
            (Base::External, false) => {
                *self = BaseState::new();
                Some(Base::Local)
            }
        }
    }
}

static BASE: Mutex<BaseState> = Mutex::new(BaseState::new());
/// The external address whose probe named the same server, compared against the setting so a change re-verifies.
static VERIFIED_EXTERNAL: Mutex<Option<String>> = Mutex::new(None);
/// When the last verification failed, so an unreachable external address is probed once per `STICKY`, not per tick.
static EXTERNAL_PROBE_FAILED_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// The base the last successful request went to, which is what Test connection reports.
pub fn active_base() -> Base {
    BASE.guard().active
}

/// Forgets the base in use and the verified external address, for when the settings change under the poll.
pub fn reset_base() {
    *BASE.guard() = BaseState::new();
    *VERIFIED_EXTERNAL.guard() = None;
    *EXTERNAL_PROBE_FAILED_AT.guard() = None;
}

/// Records that `url` answered the probe as the same server.
pub fn mark_external_verified(url: &str) {
    *VERIFIED_EXTERNAL.guard() = Some(normalize_base_url(url));
}

pub fn external_verified(url: &str) -> bool {
    let url = normalize_base_url(url);
    !url.is_empty() && VERIFIED_EXTERNAL.guard().as_deref() == Some(url.as_str())
}

/// The external base once its probe has named the same server, else `None`; the token never travels on a `None`.
async fn verified_external(cfg: &JellyfinConfig) -> Option<String> {
    let external = normalize_base_url(&cfg.external_url);
    if external.is_empty() {
        return None;
    }
    if external_verified(&external) {
        return Some(external);
    }
    if cfg.server_id.trim().is_empty() {
        crate::logging::debug_changed(
            "jellyfin",
            "external",
            "external address unused: the server's id is unknown (sign in again to learn it)",
        );
        return None;
    }
    if EXTERNAL_PROBE_FAILED_AT
        .guard()
        .is_some_and(|t| t.elapsed() < STICKY)
    {
        return None;
    }
    match super::discovery::probe(&external).await {
        Ok(info) if external_accepted(&info, &cfg.server_id) => {
            mark_external_verified(&external);
            *EXTERNAL_PROBE_FAILED_AT.guard() = None;
            crate::logging::info("jellyfin", format!("external address verified as {}", info.name));
            Some(external)
        }
        Ok(info) => {
            *EXTERNAL_PROBE_FAILED_AT.guard() = Some(Instant::now());
            crate::logging::debug_changed(
                "jellyfin",
                "external",
                format!("external address answers as a different server ({}); not used", info.name),
            );
            None
        }
        Err(e) => {
            *EXTERNAL_PROBE_FAILED_AT.guard() = Some(Instant::now());
            crate::logging::debug_changed(
                "jellyfin",
                "external",
                format!("external address not verified: {e}"),
            );
            None
        }
    }
}

/// Sends a request built for a base, trying the other base once on a transport failure; an HTTP status is an answer.
async fn send_on(
    cfg: &JellyfinConfig,
    build: impl Fn(&str) -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let local = normalize_base_url(&cfg.url);
    let has_external = !normalize_base_url(&cfg.external_url).is_empty();
    let mut base = BASE.guard().first(Instant::now());
    let url = match base {
        Base::External => match verified_external(cfg).await {
            Some(u) => u,
            None => {
                base = Base::Local;
                local.clone()
            }
        },
        Base::Local => local.clone(),
    };

    let err = match build(&url).send().await {
        Ok(resp) => {
            BASE.guard().record(base, true, has_external, Instant::now());
            return Ok(resp);
        }
        Err(e) => e,
    };
    let fallback = BASE.guard().record(base, false, has_external, Instant::now());
    let Some(next) = fallback else {
        return Err(format!("Could not reach the server: {err}"));
    };
    let next_url = match next {
        Base::External => match verified_external(cfg).await {
            Some(u) => u,
            None => return Err(format!("Could not reach the server: {err}")),
        },
        Base::Local => local,
    };
    crate::logging::debug_changed(
        "jellyfin",
        "base",
        format!("{base:?} address unreachable, trying the {next:?} one"),
    );
    match build(&next_url).send().await {
        Ok(resp) => {
            BASE.guard().record(next, true, has_external, Instant::now());
            Ok(resp)
        }
        Err(e) => {
            BASE.guard().record(next, false, has_external, Instant::now());
            Err(format!("Could not reach the server: {e}"))
        }
    }
}

/// Whether the server says this session is paused; absent means "not paused", since the field only ranks candidates.
fn is_paused(session: &serde_json::Value) -> bool {
    get_ci(session, "PlayState")
        .and_then(|p| get_ci(p, "IsPaused"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// One `/Sessions` entry as a detection result, split from the HTTP call so the mapping is testable without a server.
pub fn playback_from_session(session: &serde_json::Value) -> Option<Playback> {
    // Every read goes through `get_ci`, since a casing mismatch fails as a silent "nothing is playing".
    let item = get_ci(session, "NowPlayingItem")?;
    let kind = get_ci(item, "Type").and_then(|v| v.as_str()).unwrap_or("");
    if kind != "Episode" && kind != "Movie" {
        return None;
    }

    // Paused still counts as "what you're watching"; the scrobbler's own threshold decides when to act.
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

    // A movie's own name is the title; an episode without a series name would offer a title that can never match.
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

    // Ticks are 100 ns, and both fields ride the payload the poll already fetches.
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
        // Spelled `S2E1` as Jellyfin does: the poll loop dedupes on this string, and without the season repeated names collide.
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
            // An API field, not a parse: as explicit as a spelling gets.
            episode_marked: episode.is_some(),
            // Season 1 carries nothing for matching and is dropped; season 0 is Specials and must reach `season_informed`.
            season: season.filter(|s| *s != 1),
            release_group: None,
            // A movie's name is already the title; only an episode's name is worth a line of its own.
            episode_title: (kind == "Episode" && !episode_name.is_empty()).then(|| episode_name.trim().to_string()),
        }),
        position_sec,
        duration_sec,
    })
}

/// What this user is playing on this device; every `None` leaves a `debug_changed` line, so a broken rung is not idle.
pub async fn detect(cfg: &JellyfinConfig) -> Option<Playback> {
    if cfg.user_id.trim().is_empty() {
        crate::logging::debug_changed("jellyfin", "detect", "no user id stored; rung skipped");
        return None;
    }
    let sessions = match get_json(cfg, "/Sessions").await {
        Ok(v) => v,
        Err(e) => {
            crate::logging::debug_changed("jellyfin", "detect", format!("/Sessions failed: {e}"));
            // A failed request is not an answer: hold the last good one for a few ticks instead of dropping to a lower rung.
            return hold_last_good();
        }
    };
    let Some(list) = sessions.as_array() else {
        crate::logging::debug_changed("jellyfin", "detect", "/Sessions was not a list");
        return None;
    };
    // The peers come off the same answer, recorded before the filter because a peer's row is an idle one by construction.
    record_peers(list, &cfg.device_id);
    let mut matched = 0usize;
    let candidates: Vec<&serde_json::Value> = list
        .iter()
        .filter(|s| session_matches(s, &cfg.user_id, &cfg.device))
        .inspect(|_| matched += 1)
        .collect();
    // Playing first, paused only as a fallback: a paused session left open elsewhere must not win over live playback.
    let found = candidates
        .iter()
        .filter(|s| !is_paused(s))
        .find_map(|s| playback_from_session(s))
        .or_else(|| candidates.iter().find_map(|s| playback_from_session(s)));
    if found.is_none() {
        // The two numbers separate "the filter rejects everything" from "nothing is playing".
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
    // The server answered, and "nothing" is the truth too: a finished episode must end the session at once.
    remember(found)
}

/// How many consecutive failed polls may be papered over before a server that really went away is noticed.
const HOLD_TICKS: u8 = 3;

/// The last answer the server actually gave, and how many failures have been covered with it since.
static LAST_GOOD: Mutex<Option<(Playback, u8)>> = Mutex::new(None);

/// Drops the held session, which is the previous user's playback after a sign-out or an account switch.
pub fn forget_last_good() {
    *LAST_GOOD.guard() = None;
    // The peer list is the previous account's too.
    *PEERS.guard() = None;
}

/// Records a successful poll and hands the answer straight back.
fn remember(found: Option<Playback>) -> Option<Playback> {
    let mut guard = LAST_GOOD.guard();
    *guard = found.clone().map(|p| (p, 0));
    found
}

/// The stand-in for a failed poll, reachable only from that branch, so it can never keep a finished episode alive.
fn hold_last_good() -> Option<Playback> {
    let mut guard = LAST_GOOD.guard();
    let (playback, used) = guard.as_mut()?;
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

    /// These strings are a contract with `src/lib/backendError.ts`, and nothing else can see across that boundary.
    #[test]
    fn the_error_codes_match_what_the_frontend_maps() {
        assert_eq!(ERR_SIGNED_OUT, "jellyfin.signedOut");
        assert_eq!(ERR_NO_TOKEN, "jellyfin.noToken");
        assert_eq!(ERR_NO_USER_ID, "jellyfin.noUserId");
        assert_eq!(ERR_BAD_CREDENTIALS, "jellyfin.badCredentials");
        assert_eq!(ERR_BAD_URL, "jellyfin.badUrl");
        assert_eq!(ERR_NOT_JELLYFIN, "jellyfin.notJellyfin");
        assert_eq!(ERR_EXTERNAL_OTHER_SERVER, "jellyfin.externalOtherServer");
        assert_eq!(ERR_EXTERNAL_UNKNOWN_SERVER, "jellyfin.externalUnknownServer");
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
        assert_eq!(parsed.episode_title.as_deref(), Some("The Mage's Journey"));
        assert!(p.media_title.contains("Frieren"));
    }

    /// `LAST_GOOD` is process-global and tests run in parallel, so the tests that drive it take this lock.
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

    /// A failed request is not an answer, so one slow `/Sessions` must not demote detection to the media session.
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

    /// "The server says nothing is playing" is an answer, so a finished episode ends the session immediately.
    #[test]
    fn a_clean_nothing_playing_clears_the_memory_at_once() {
        let _guard = serialize_hold();
        *LAST_GOOD.guard() = None;
        remember(Some(some_playback("Frieren")));
        assert!(remember(None).is_none());
        assert!(hold_last_good().is_none());
    }

    /// A camelCase body must detect exactly like a PascalCase one.
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

    /// An episode with no series name must not pass its own name off as the show; a movie still uses its own name.
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
        // Ticks are 100 ns, and a session without a PlayState must not invent a position.
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

    /// A paused session left open on another device must not win over live playback; its position never moves.
    #[test]
    fn a_paused_session_does_not_outrank_a_playing_one() {
        let paused = json!({
            "PlayState": { "IsPaused": true },
            "NowPlayingItem": { "Type": "Episode", "SeriesName": "Test Show", "IndexNumber": 3 }
        });
        let playing = json!({
            "PlayState": { "IsPaused": false },
            "NowPlayingItem": { "Type": "Episode", "SeriesName": "Test Show", "IndexNumber": 7 }
        });
        assert!(is_paused(&paused));
        assert!(!is_paused(&playing));

        let candidates = [&paused, &playing];
        let picked = candidates
            .iter()
            .filter(|s| !is_paused(s))
            .find_map(|s| playback_from_session(s))
            .or_else(|| candidates.iter().find_map(|s| playback_from_session(s)))
            .expect("one of them plays");
        assert_eq!(picked.parsed.as_ref().and_then(|p| p.episode), Some(7));
    }

    /// Absent or unreadable `PlayState` means "not paused", since a missing one must not make live playback look stale.
    #[test]
    fn a_missing_play_state_is_not_a_pause() {
        assert!(!is_paused(&json!({})));
        assert!(!is_paused(&json!({ "PlayState": {} })));
        assert!(!is_paused(&json!({ "PlayState": { "IsPaused": "yes" } })));
    }

    /// With nothing playing, a paused session is still what the user is watching.
    #[test]
    fn a_paused_session_is_still_used_when_it_is_all_there_is() {
        let paused = json!({
            "PlayState": { "IsPaused": true },
            "NowPlayingItem": { "Type": "Episode", "SeriesName": "Test Show", "IndexNumber": 3 }
        });
        let candidates = [&paused];
        let picked = candidates
            .iter()
            .filter(|s| !is_paused(s))
            .find_map(|s| playback_from_session(s))
            .or_else(|| candidates.iter().find_map(|s| playback_from_session(s)));
        assert!(picked.is_some(), "a pause must not blank the card");
    }

    #[test]
    fn only_the_configured_user_matches() {
        assert!(session_matches(&session(ME, "KYU-PC"), ME, "KYU-PC"));
        // Another account on the same server must never be picked up.
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

    /// Fail closed: an unconfigured user matches nothing rather than "whatever the server reports".
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

    /// Guards the casing assumption; a mismatch would surface as a permanent silent "nothing is playing".
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
        let client = format!("Client=\"{CLIENT_NAME}\"");
        for part in [client.as_str(), "Device=\"KYU-PC\"", "DeviceId=\"dev-1\""] {
            assert!(h.contains(part), "{h} is missing {part}");
        }
        // The name is what `platform_of` reads on the other side, so the two must agree about what this build is.
        assert_eq!(platform_of(CLIENT_NAME), Some(OWN_PLATFORM));
        assert!(h.contains("Version=\""));
        assert!(!h.contains("Token="), "no token before signing in");
        assert!(auth_header("d", "i", Some("tok")).contains("Token=\"tok\""));
    }

    /// The header is a quoted-string list, so an unescaped quote in a hostname would corrupt every field after it.
    #[test]
    fn quotes_cannot_break_out_of_the_auth_header() {
        let h = auth_header("we\"ird", "i", None);
        assert!(h.contains("Device=\"weird\""));
        assert_eq!(h.matches('"').count() % 2, 0);
    }

    /// Jellyfin rejects `Device=""` with HTTP 400 before checking the credentials, which Android's missing hostname hit.
    #[test]
    fn an_empty_device_never_reaches_the_wire() {
        assert!(auth_header("", "i", None).contains("Device=\"Karasu\""));
        assert!(auth_header("  ", "i", None).contains("Device=\"Karasu\""));
        // Escaping alone can empty a name; the floor comes after it.
        assert!(auth_header("\"\"", "i", None).contains("Device=\"Karasu\""));
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

    /// "We could not look" is not an answer, and caching it would disable Jellyfin until the next restart.
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

    // --- Peers -------------------------------------------------------------

    fn peer(id: &str, name: &str, platform: Platform, last_activity: Option<i64>) -> Peer {
        Peer {
            device_id: id.into(),
            device_name: name.into(),
            platform,
            last_activity,
        }
    }

    #[test]
    fn the_client_name_says_which_platform_this_is() {
        assert_eq!(platform_of("Karasu"), Some(Platform::Desktop));
        assert_eq!(platform_of("Karasu Android"), Some(Platform::Mobile));
        // A flavour this build has never met waits rather than races.
        assert_eq!(platform_of("Karasu Toaster"), Some(Platform::Mobile));
        assert_eq!(platform_of("Jellyfin Media Player"), None);
        assert_eq!(platform_of("Karasuma"), Some(Platform::Mobile), "prefix, not word");
        assert_eq!(platform_of(""), None);
    }

    /// Jellyfin's fraction-and-`Z` spelling and a proxy's offset spelling must land on the same second.
    #[test]
    fn last_activity_parses_zulu_fraction_and_an_offset() {
        assert_eq!(parse_utc_seconds("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_utc_seconds("2000-03-01T00:00:00Z"), Some(951_868_800));
        let plain = parse_utc_seconds("2026-09-11T10:12:13Z").unwrap();
        assert_eq!(parse_utc_seconds("2026-09-11T10:12:13.1234567Z"), Some(plain));
        assert_eq!(parse_utc_seconds("2026-09-11T12:12:13+02:00"), Some(plain));
        assert_eq!(parse_utc_seconds("2026-09-11T05:12:13-0500"), Some(plain));
        assert_eq!(parse_utc_seconds("2026-09-11T10:12:03Z"), Some(plain - 10));
        for junk in ["", "yesterday", "2026-13-01T00:00:00Z", "2026-09-11", "2026-09-11T10:12:13+2"] {
            assert_eq!(parse_utc_seconds(junk), None, "{junk:?}");
        }
    }

    #[test]
    fn a_peer_is_read_from_a_session_and_the_own_device_is_set_aside() {
        let list = vec![
            json!({ "Client": "Karasu", "DeviceId": "pc-1", "DeviceName": "KYU-PC",
                    "LastActivityDate": "2026-09-11T10:12:13.0000000Z" }),
            json!({ "Client": CLIENT_NAME, "DeviceId": "me", "DeviceName": "mine",
                    "LastActivityDate": "2026-09-11T10:12:20.0000000Z" }),
            json!({ "Client": "Jellyfin Web", "DeviceId": "browser", "DeviceName": "Chrome" }),
        ];
        let (own, peers) = peers_from_sessions(&list, "me");
        let own = own.expect("the own row");
        assert_eq!(own.device_id, "me");
        assert_eq!(own.last_activity, parse_utc_seconds("2026-09-11T10:12:20Z"));
        assert_eq!(peers.len(), 1, "the browser is not a peer");
        assert_eq!(peers[0].device_name, "KYU-PC");
        assert_eq!(peers[0].platform, Platform::Desktop);
    }

    /// After the Android rename the old row lingers with the same device id; it is neither the clock nor a peer.
    #[test]
    fn a_stale_row_with_the_own_device_id_is_not_a_peer() {
        let other = if OWN_PLATFORM == Platform::Desktop { "Karasu Android" } else { "Karasu" };
        let list = vec![
            json!({ "Client": other, "DeviceId": "me", "DeviceName": "old",
                    "LastActivityDate": "2026-09-11T09:00:00Z" }),
            json!({ "Client": CLIENT_NAME, "DeviceId": "me", "DeviceName": "new",
                    "LastActivityDate": "2026-09-11T10:00:00Z" }),
        ];
        let (own, peers) = peers_from_sessions(&list, "me");
        assert_eq!(own.unwrap().device_name, "new");
        assert!(peers.is_empty());
    }

    #[test]
    fn a_client_that_is_not_karasu_is_never_a_peer() {
        assert!(peer_from_session(&json!({ "Client": "Jellyfin Web", "DeviceId": "x" })).is_none());
        assert!(peer_from_session(&json!({ "Client": "Karasu" })).is_none(), "no device id");
        let p = peer_from_session(&json!({ "client": "Karasu Android", "deviceId": "p" })).unwrap();
        assert_eq!(p.platform, Platform::Mobile);
        assert_eq!(p.last_activity, None);
    }

    #[test]
    fn a_desktop_outranks_a_phone_and_the_lower_device_id_breaks_a_tie() {
        let pc = peer("zzz", "pc", Platform::Desktop, None);
        let phone = peer("aaa", "phone", Platform::Mobile, None);
        assert!(outranks(&pc, &phone));
        assert!(!outranks(&phone, &pc));
        let pc2 = peer("aaa", "pc2", Platform::Desktop, None);
        assert!(outranks(&pc2, &pc));
        assert!(!outranks(&pc, &pc2));
        assert!(!outranks(&pc, &pc), "nothing outranks itself");
    }

    #[test]
    fn a_fresh_higher_ranked_peer_is_waited_for() {
        let own = peer("phone", "phone", Platform::Mobile, Some(1_000));
        let peers = vec![
            peer("pc-b", "second", Platform::Desktop, Some(990)),
            peer("pc-a", "first", Platform::Desktop, Some(995)),
            peer("phone-2", "other phone", Platform::Mobile, Some(1_000)),
        ];
        let target = yield_to(&peers, &own, FRESH).expect("a desktop is present");
        assert_eq!(target.device_name, "first", "the highest-ranked fresh peer");
        // A desktop never waits for a phone, however fresh.
        let pc = peer("pc-a", "first", Platform::Desktop, Some(1_000));
        assert!(yield_to(std::slice::from_ref(&own), &pc, FRESH).is_none());
    }

    #[test]
    fn a_peer_older_than_fresh_does_not_block() {
        let own = peer("phone", "phone", Platform::Mobile, Some(1_000));
        let stale = vec![peer("pc", "pc", Platform::Desktop, Some(1_000 - FRESH.as_secs() as i64 - 1))];
        assert!(yield_to(&stale, &own, FRESH).is_none());
        let edge = vec![peer("pc", "pc", Platform::Desktop, Some(1_000 - FRESH.as_secs() as i64))];
        assert!(yield_to(&edge, &own, FRESH).is_some(), "exactly FRESH old still counts");
        // A peer stamped *after* us (it beat between our two requests) is fresh.
        let ahead = vec![peer("pc", "pc", Platform::Desktop, Some(1_004))];
        assert!(yield_to(&ahead, &own, FRESH).is_some());
        let unstamped = vec![peer("pc", "pc", Platform::Desktop, None)];
        assert!(yield_to(&unstamped, &own, FRESH).is_none());
    }

    #[test]
    fn without_an_own_timestamp_there_is_no_verdict() {
        let own = peer("phone", "phone", Platform::Mobile, None);
        let peers = vec![peer("pc", "pc", Platform::Desktop, Some(1_000))];
        assert!(yield_to(&peers, &own, FRESH).is_none());
    }

    /// The freshness window has to cover two missed heartbeats, or a busy desktop hands the write to the phone.
    #[test]
    fn the_freshness_window_covers_a_missed_heartbeat() {
        assert!(FRESH >= 2 * HEARTBEAT);
    }

    // --- The external address --------------------------------------------

    #[test]
    fn an_external_url_is_any_http_base_and_plain_http_is_flagged() {
        assert_eq!(validate_external_url("  "), Ok(String::new()));
        assert_eq!(
            validate_external_url(" https://jf.example.org/ "),
            Ok("https://jf.example.org".to_string())
        );
        assert_eq!(validate_external_url("ftp://jf.example.org"), Err(ERR_BAD_URL));
        assert_eq!(validate_external_url("jf.example.org"), Err(ERR_BAD_URL));
        // The maintainer's call: plain http is stored, and said out loud.
        assert_eq!(
            validate_external_url("http://jf.example.org:8096"),
            Ok("http://jf.example.org:8096".to_string())
        );
        assert!(external_is_plain_http("http://jf.example.org:8096"));
        assert!(external_is_plain_http("http://203.0.113.7:8096"));
        assert!(!external_is_plain_http("https://jf.example.org"));
        // Local hosts keep http without a warning: that is the LAN case.
        assert!(!external_is_plain_http("http://192.168.1.10:8096"));
        assert!(!external_is_plain_http("http://nas.local:8096"));
        assert!(!external_is_plain_http("http://100.64.0.5:8096"), "a Tailscale-style range is local");
    }

    #[test]
    fn the_server_id_must_match_before_the_token_travels() {
        let info = |id: &str| super::super::discovery::ServerInfo {
            name: "NAS".into(),
            id: id.into(),
            version: "10.10".into(),
        };
        assert!(external_accepted(&info("abc"), "abc"));
        assert!(external_accepted(&info(" abc "), "abc"));
        assert!(!external_accepted(&info("other"), "abc"));
        assert!(!external_accepted(&info("abc"), ""), "an unknown server is not the same server");
        assert!(!external_accepted(&info(""), ""));
    }

    #[test]
    fn the_local_base_is_tried_first() {
        let now = Instant::now();
        let state = BaseState::new();
        assert_eq!(state.first(now), Base::Local);
        assert_eq!(state.first(now + STICKY * 3), Base::Local);
    }

    #[test]
    fn a_local_transport_failure_falls_back_only_when_an_external_exists() {
        let now = Instant::now();
        let mut without = BaseState::new();
        assert_eq!(without.record(Base::Local, false, false, now), None);
        assert_eq!(without.first(now), Base::Local);
        let mut with = BaseState::new();
        assert_eq!(with.record(Base::Local, false, true, now), Some(Base::External));
        assert_eq!(with.first(now), Base::External);
    }

    #[test]
    fn the_external_base_is_sticky_for_five_minutes_then_local_is_probed_again() {
        let now = Instant::now();
        let mut state = BaseState::new();
        state.record(Base::Local, false, true, now);
        assert_eq!(state.first(now + STICKY - Duration::from_secs(1)), Base::External);
        assert_eq!(state.first(now + STICKY), Base::Local, "the LAN gets its probe");
        // Still away: the probe fails and the clock restarts.
        let later = now + STICKY;
        assert_eq!(state.record(Base::Local, false, true, later), Some(Base::External));
        assert_eq!(state.first(later + STICKY - Duration::from_secs(1)), Base::External);
        // Home again: the probe succeeds and local is active at once.
        assert_eq!(state.record(Base::Local, true, true, later + STICKY), None);
        assert_eq!(state.first(later + STICKY), Base::Local);
        // A success on the external base while sticky keeps the clock, so the local probe still comes round.
        let mut away = BaseState::new();
        away.record(Base::Local, false, true, now);
        assert_eq!(away.record(Base::External, true, true, now + Duration::from_secs(60)), None);
        assert_eq!(away.first(now + STICKY), Base::Local);
    }

    #[test]
    fn an_external_failure_returns_to_local_at_once() {
        let now = Instant::now();
        let mut state = BaseState::new();
        state.record(Base::Local, false, true, now);
        assert_eq!(state.record(Base::External, false, true, now), Some(Base::Local));
        assert_eq!(state.first(now), Base::Local);
    }
}
