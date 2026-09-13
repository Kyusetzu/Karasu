use crate::anilist::{auth, client::AniList};
use crate::db::Db;
use serde_json::{json, Value};
use tauri::State;

// Siblings in the same module tree; `mod.rs` re-exports all of it, so every command keeps its old path.
#[allow(unused_imports)]
use super::*;

/// The built-in AniList client id (public, never a secret); empty means every user needs their own.
pub const BUILTIN_ANILIST_CLIENT_ID: &str = "46231";

/// The viewer plus score format, advanced-scoring names and notification options, all cached at no extra request.
const VIEWER_QUERY: &str = "
query {
  Viewer {
    id
    name
    siteUrl
    avatar { large }
    donatorTier
    mediaListOptions {
      scoreFormat
      animeList { advancedScoring advancedScoringEnabled }
      mangaList { advancedScoring advancedScoringEnabled }
    }
    options {
      airingNotifications
      notificationOptions { type enabled }
    }
  }
}";

#[derive(serde::Serialize)]
pub struct AuthInfo {
    /// true if a client ID is compiled in (login works without any setup)
    #[serde(rename = "hasBuiltinClientId")]
    pub has_builtin_client_id: bool,
    #[serde(rename = "customClientId")]
    pub custom_client_id: Option<String>,
    /// The redirect URL an API client must register, built from `login::AUTH_CALLBACK_PORT` so the port has one origin.
    #[serde(rename = "callbackUrl")]
    pub callback_url: String,
}

#[tauri::command]
pub fn anilist_auth_info(db: State<'_, Db>) -> AuthInfo {
    AuthInfo {
        has_builtin_client_id: !BUILTIN_ANILIST_CLIENT_ID.is_empty(),
        custom_client_id: db.kv_get("anilist_client_id"),
        callback_url: format!(
            "http://localhost:{}/callback",
            crate::anilist::login::AUTH_CALLBACK_PORT
        ),
    }
}

#[tauri::command]
pub fn set_client_id(db: State<'_, Db>, client_id: String) -> Result<(), String> {
    let trimmed = client_id.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err(
            "The client ID is the number from your AniList developer settings".into(),
        );
    }
    db.kv_set("anilist_client_id", trimmed)
}

fn configured_client_id(db: &Db) -> Result<String, String> {
    let client_id = db
        .kv_get("anilist_client_id")
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| BUILTIN_ANILIST_CLIENT_ID.to_string());
    if client_id.is_empty() {
        return Err("No AniList client ID configured".into());
    }
    Ok(client_id)
}

/// The authorize URL for the manual-paste flow; no callback server runs, so no `state` is needed.
#[tauri::command]
pub fn anilist_login_url(db: State<'_, Db>) -> Result<String, String> {
    Ok(auth::authorize_url(&configured_client_id(&db)?, None))
}

/// Validates a token against the Viewer query, stores it and caches the viewer; shared by both sign-in flows.
pub async fn connect_with_token(db: &Db, api: &AniList, input: &str) -> Result<Value, String> {
    // Accepts a raw token as well as the full redirect URL
    let token = auth::extract_token(input);
    if token.is_empty() {
        return Err("Please paste the token from the AniList page".into());
    }
    // Timed per phase, so a slow sign-in can name the viewer fetch, the kv writes or the token save.
    let t0 = std::time::Instant::now();
    // One bounded retry here only: a token AniList just issued is more likely caught in a replication race than dead.
    let viewer = {
        let fetch = || async {
            let data = api.query_from("connect", Some(&token), VIEWER_QUERY, json!({})).await?;
            data.get("Viewer")
                .filter(|v| !v.is_null())
                .cloned()
                .ok_or_else(|| "Token invalid or expired".to_string())
        };
        match fetch().await {
            Ok(v) => v,
            Err(first) => {
                crate::logging::warn(
                    "auth",
                    format!("first viewer fetch after connect failed, retrying once: {first}"),
                );
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                fetch().await?
            }
        }
    };
    let t1 = std::time::Instant::now();
    // Identity before credential: a failed `save_token` then leaves no bearer that could drain another account's edits.
    switch_identity(&db, Identity::AniList(viewer.clone()))?;
    let t2 = std::time::Instant::now();
    auth::save_token(&token).inspect_err(|_| {
        // Do not leave a viewer nobody can act as.
        let _ = switch_identity(&db, Identity::None);
    })?;
    // `t2 - t1` is `switch_identity` and everything after `t2` is `save_token`; the labels must not swap again.
    crate::logging::debug(
        "auth",
        format!(
            "connect timings: viewer {}ms, kv {}ms, token save {}ms",
            (t1 - t0).as_millis(),
            (t2 - t1).as_millis(),
            t2.elapsed().as_millis()
        ),
    );
    Ok(viewer)
}

#[tauri::command]
pub async fn anilist_connect(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    token: String,
) -> Result<Value, String> {
    connect_with_token(&db, &api, &token).await
}

/// Starts the one-click login: spins up the localhost callback server and returns the authorize URL.
#[tauri::command]
pub fn anilist_start_login(
    app: tauri::AppHandle,
    db: State<'_, Db>,
) -> Result<String, String> {
    let client_id = configured_client_id(&db)?;
    // The server first: it mints the nonce the URL carries, so nothing advertises a state nobody checks.
    let state = crate::anilist::login::start(app)?;
    Ok(auth::authorize_url(&client_id, Some(&state)))
}

/// Returns the cached viewer if a token is stored, without an API call, so startup works offline.
#[tauri::command]
pub fn anilist_session(db: State<'_, Db>) -> Option<Value> {
    auth::load_token()?;
    let cached = db.kv_get("anilist_viewer")?;
    serde_json::from_str(&cached).ok()
}

/// Which account the app is about to act as.
pub enum Identity {
    /// A signed-in AniList account, with its cached viewer blob.
    AniList(Value),
    /// The account-free local list.
    Local,
    /// Signed out entirely.
    None,
}

/// The only way the app changes account: the old state goes first, and the identity is written before the credential.
pub fn switch_identity(db: &Db, next: Identity) -> Result<(), String> {
    // 1. Forget the outgoing account.
    db.notif_clear_owned()?;
    // The dedupe keys record what the *previous* account was already told.
    db.kv_delete_prefix("aired:");
    db.kv_delete_prefix("sequel_seen:");
    db.kv_delete_prefix("stale_done:");
    // The site-notification cursor only moves forward, so left behind it starves the next account or misfires.
    db.kv_delete(crate::alerts::site::SEEN_KEY);
    db.kv_delete(crate::alerts::site::LAST_CHECK_KEY);
    // The widget projection holds this account's titles and must not outlive it.
    crate::widgets::clear();
    // A held Jellyfin session belongs to whoever was signed in to Jellyfin.
    crate::playback::detection::jellyfin::forget_last_good();

    // 2. Then become the next one, identity before credential.
    match next {
        Identity::AniList(viewer) => {
            db.kv_set("anilist_viewer", &viewer.to_string())?;
            db.kv_set("profile_mode", "anilist")?;
        }
        Identity::Local => {
            db.kv_delete("anilist_viewer");
            db.kv_set("profile_mode", "local")?;
            auth::delete_token();
        }
        Identity::None => {
            db.kv_delete("anilist_viewer");
            auth::delete_token();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn anilist_logout(db: State<'_, Db>) {
    if let Err(e) = switch_identity(&db, Identity::None) {
        crate::logging::error("auth", format!("sign-out could not clear everything: {e}"));
    }
}

/// Refetches the viewer and replaces the cached blob, on demand only, since `anilist_session` never goes online.
#[tauri::command]
pub async fn refresh_viewer(
    db: State<'_, Db>,
    api: State<'_, AniList>,
) -> Result<Value, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    let data = api.query_from("viewer", Some(&token), VIEWER_QUERY, json!({})).await?;
    let viewer = data
        .get("Viewer")
        .filter(|v| !v.is_null())
        .cloned()
        .ok_or("Token invalid or expired")?;
    // Deliberately not `switch_identity`: the same account with fresher data must keep its bell rows and dedupe keys.
    db.kv_set("anilist_viewer", &viewer.to_string())?;
    Ok(viewer)
}

/// A passthrough source as the frontend named it, or `gql:<root field>` when it did not; never anything it could not spell.
fn passthrough_source(source: Option<&str>, query: &str) -> String {
    match source {
        Some(s)
            if (1..=32).contains(&s.len())
                && s.starts_with(|c: char| c.is_ascii_lowercase())
                && s.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            s.to_string()
        }
        _ => format!("gql:{}", crate::anilist::client::operation_name(query)),
    }
}

/// Generic GraphQL proxy: the frontend supplies query and variables, Rust attaches the token and paces the request.
#[tauri::command]
pub async fn anilist_query(
    api: State<'_, AniList>,
    db: State<'_, Db>,
    query: String,
    variables: Option<Value>,
    source: Option<String>,
) -> Result<Value, String> {
    let source = passthrough_source(source.as_deref(), &query);
    // Local mode sends no bearer whatever the credential store holds, so a surviving token cannot poison public queries.
    let token = if crate::commands::profile_mode(&db) == "local" {
        None
    } else {
        auth::load_token()
    };
    Ok(api
        .query_from(
            &source,
            token.as_deref(),
            &query,
            variables.unwrap_or_else(|| json!({})),
        )
        .await?)
}

// --- Media list: loading with cache, mutations with offline queue -----------

#[cfg(test)]
mod tests {
    use super::*;

    /// Switching accounts drops the site-notification cursor; the `AniList` arm only, since the others delete a real token.
    #[test]
    fn switching_accounts_forgets_the_site_notification_cursor() {
        let db = crate::db::tests::mem_db();
        db.kv_set(crate::alerts::site::SEEN_KEY, "123456").unwrap();
        db.kv_set(crate::alerts::site::LAST_CHECK_KEY, "1788000000000").unwrap();
        db.kv_set("aired:1:1", "1").unwrap();

        switch_identity(&db, Identity::AniList(json!({ "id": 2, "name": "b" }))).unwrap();

        assert_eq!(db.kv_get(crate::alerts::site::SEEN_KEY), None);
        assert_eq!(db.kv_get(crate::alerts::site::LAST_CHECK_KEY), None);
        assert_eq!(db.kv_get("aired:1:1"), None, "the older dedupe keys still go too");
        assert_eq!(db.kv_get("profile_mode").as_deref(), Some("anilist"));
    }
}
