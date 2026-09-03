use crate::anilist::{auth, client::AniList};
use crate::db::Db;
use serde_json::{json, Value};
use tauri::State;

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

/// users; the ID is public, not a secret). Empty = users need their own
/// client ID. Set once by the maintainer.
pub const BUILTIN_ANILIST_CLIENT_ID: &str = "46231";

/// `mediaListOptions.scoreFormat` rides along because the whole app follows
/// it — score controls, list cells, statistics. It lands in the cached
/// `anilist_viewer` kv blob and the frontend auth store at zero extra request
/// cost, which is how the list screens read it without a profile fetch.
///
/// The advanced-scoring pair rides the same way and for the same reason: the
/// entry editor needs to know whether the feature is on and what the user
/// called their categories, and this is the one call that can carry both for
/// free. Per media type, because AniList keeps them per media type — one
/// account-wide flag would be wrong. The names are populated even when the
/// flag is off (verified on a real account), so `advancedScoringEnabled` is
/// the signal and a non-empty name list is not.
///
/// `options` rides along for the airing watcher, which needs to know whether
/// the account will get AniList's *own* AIRING notification before deciding to
/// write a bell row of its own. Two switches govern that on AniList's side and
/// they are separate settings on separate pages, so both are carried — see
/// `alerts::airing::anilist_covers_airing` for why it takes both. One scalar
/// and twenty small pairs on a query that already runs at connect and on
/// `refresh_viewer`, so it costs no extra request, and this is the only
/// token-bearing path that runs with nobody waiting on it.
const VIEWER_QUERY: &str = "
query {
  Viewer {
    id
    name
    siteUrl
    avatar { large }
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
    /// The redirect URL an API client must register — built from
    /// `login::AUTH_CALLBACK_PORT` so the port has one origin. The frontend
    /// used to hardcode this string, which is exactly the drift a type
    /// checker cannot see across the IPC boundary.
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

/// The authorize URL for the manual-paste flow, where the user copies the
/// token out of the page. No callback server runs, so no `state` is needed.
#[tauri::command]
pub fn anilist_login_url(db: State<'_, Db>) -> Result<String, String> {
    Ok(auth::authorize_url(&configured_client_id(&db)?, None))
}

/// Validates a token against the Viewer query, stores it in the Windows
/// Credential Manager and caches the viewer. Shared by the manual paste flow
/// and the one-click callback server.
pub async fn connect_with_token(db: &Db, api: &AniList, input: &str) -> Result<Value, String> {
    // Accepts a raw token as well as the full redirect URL
    let token = auth::extract_token(input);
    if token.is_empty() {
        return Err("Please paste the token from the AniList page".into());
    }
    // Timed per phase: a slow first sign-in was reported on Android, and the
    // three suspects — the viewer fetch over a cold TLS handshake, the token
    // write (whose first Keystore use also generates the hardware key), and
    // the kv writes — cannot be told apart from the outside. Debug level, so
    // an ordinary sign-in stays quiet unless verbose logging is on.
    let t0 = std::time::Instant::now();
    // One bounded retry, in this path only. The token arrived seconds ago
    // from AniList's own redirect, so a rejection here is far more likely a
    // replication race than a genuinely bad token — and that is exactly what
    // a device showed: the first viewer fetch after the callback failed, an
    // immediate second press succeeded. The client already retries transport
    // errors internally; this covers the GraphQL-level rejection those
    // retries deliberately do not touch. A truly dead token still fails the
    // second attempt and surfaces exactly as before.
    let viewer = {
        let fetch = || async {
            let data = api.query(Some(&token), VIEWER_QUERY, json!({})).await?;
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
    // Identity first, credential second — and both through the one switch, so
    // the previous account's bell rows, dedupe keys, widget projection and
    // held Jellyfin session go with it. A successful connection makes AniList
    // the active profile; any local entries stay untouched until an explicit
    // merge (see local_merge_*).
    //
    // The order matters on failure: if `save_token` below fails now, the
    // install is left as "this account, no credential" — signed out, and the
    // queue drain finds no rows to send. Writing the token first left "new
    // credential, old identity", under which the drain sent one account's
    // queued edits with another account's bearer.
    switch_identity(&db, Identity::AniList(viewer.clone()))?;
    let t2 = std::time::Instant::now();
    auth::save_token(&token).inspect_err(|_| {
        // Do not leave a viewer nobody can act as.
        let _ = switch_identity(&db, Identity::None);
    })?;
    // The order of these two was swapped, which mattered more than a swapped
    // label usually does: this line exists to say *which* of three suspects is
    // slow on a device, and it named the wrong one. `t2 - t1` spans
    // `switch_identity` -- the kv writes -- and everything after `t2` is
    // `save_token`, whose first use on Android also generates the hardware
    // Keystore key. That is the expensive candidate the comment above names,
    // and the log was crediting it to the cheap one.
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

/// Starts the one-click login: spins up the localhost callback server and
/// returns the AniList authorize URL for the frontend to open in the browser.
#[tauri::command]
pub fn anilist_start_login(
    app: tauri::AppHandle,
    db: State<'_, Db>,
) -> Result<String, String> {
    let client_id = configured_client_id(&db)?;
    // The server first: it mints the nonce the URL has to carry, and starting
    // it after building the URL would mean advertising a state nothing is
    // checking against.
    let state = crate::anilist::login::start(app)?;
    Ok(auth::authorize_url(&client_id, Some(&state)))
}

/// Returns the cached viewer if a token is stored — without an API call,
/// so app startup works offline and doesn't burn rate limit.
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

/// **The only way the app changes which account it acts as.**
///
/// Identity was spread over eight stores updated by four code paths, and each
/// path cleared a different subset: the token, the cached viewer, the profile
/// mode, the per-account tables, the alert passes' dedupe keys and Jellyfin's
/// held session. What one path forgot, the next account inherited — B reading
/// A's bell rows, or being denied notifications A had already consumed.
///
/// Two ordering rules are load-bearing here:
///
/// 1. **The previous account's state goes first.** Nothing may survive into a
///    session that is already answering as someone else.
/// 2. **The identity is written before the credential.** A failure between the
///    two then leaves "new identity, no credential" — for which the queue
///    drain finds no rows and does nothing — rather than "new credential, old
///    identity", which is the pairing that drains one account's edits under
///    another account's bearer.
pub fn switch_identity(db: &Db, next: Identity) -> Result<(), String> {
    // 1. Forget the outgoing account.
    db.notif_clear_owned()?;
    // The dedupe keys record what the *previous* account was already told.
    db.kv_delete_prefix("aired:");
    db.kv_delete_prefix("sequel_seen:");
    db.kv_delete_prefix("stale_done:");
    // The site-notification cursor is per account too, and it only ever moves
    // forward: left behind, it either starves the next account (lower ids are
    // never "newer") or fires on its first pass. It leaked here until the
    // device pass looked for why a phone that had held two accounts never
    // notified.
    db.kv_delete(crate::alerts::site::SEEN_KEY);
    db.kv_delete(crate::alerts::site::LAST_CHECK_KEY);
    // The widget projection holds this account's titles and must not outlive
    // it, exactly like the token beside it.
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

/// Refetches the viewer and replaces the cached blob.
///
/// `anilist_session` deliberately never touches the network, so a
/// `scoreFormat` changed on anilist.co (or through Karasu's own pane, which
/// calls this on success) would otherwise stay stale until the next login.
/// One request, on demand, never in the background.
#[tauri::command]
pub async fn refresh_viewer(
    db: State<'_, Db>,
    api: State<'_, AniList>,
) -> Result<Value, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    let data = api.query(Some(&token), VIEWER_QUERY, json!({})).await?;
    let viewer = data
        .get("Viewer")
        .filter(|v| !v.is_null())
        .cloned()
        .ok_or("Token invalid or expired")?;
    // Deliberately not `switch_identity`: this is the *same* account with
    // fresher data (a `scoreFormat` changed on anilist.co), not a different
    // one. Routing it through the switch would throw away this account's own
    // bell rows and dedupe keys every time the pane refreshed.
    db.kv_set("anilist_viewer", &viewer.to_string())?;
    Ok(viewer)
}

/// Generic GraphQL proxy: the frontend supplies query + variables, the
/// backend attaches the token and handles rate limiting.
#[tauri::command]
pub async fn anilist_query(
    api: State<'_, AniList>,
    db: State<'_, Db>,
    query: String,
    variables: Option<Value>,
) -> Result<Value, String> {
    // Local mode sends no bearer, whatever the credential store still holds —
    // the second half of `enable_local_mode`'s fix, so a token that survives
    // by any path at all still cannot poison public queries.
    let token = if crate::commands::profile_mode(&db) == "local" {
        None
    } else {
        auth::load_token()
    };
    Ok(api
        .query(
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

    /// The site-notification cursor belongs to the account that advanced it.
    /// Deliberately the `AniList` arm: `Local` and `None` reach
    /// `auth::delete_token`, which clears this machine's real credential
    /// store — a test must never take that path.
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
