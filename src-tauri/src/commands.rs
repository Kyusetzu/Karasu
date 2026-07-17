use crate::anilist::{auth, client::AniList};
use crate::db::Db;
use serde_json::{json, Value};
use tauri::State;

const VIEWER_QUERY: &str = "
query {
  Viewer {
    id
    name
    siteUrl
    avatar { large }
  }
}";

#[tauri::command]
pub fn get_client_id(db: State<'_, Db>) -> Option<String> {
    db.kv_get("anilist_client_id")
}

#[tauri::command]
pub fn set_client_id(db: State<'_, Db>, client_id: String) -> Result<(), String> {
    let trimmed = client_id.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Die Client-ID ist die Zahl aus deinen AniList-Developer-Einstellungen".into());
    }
    db.kv_set("anilist_client_id", trimmed)
}

#[tauri::command]
pub fn anilist_login_url(db: State<'_, Db>) -> Result<String, String> {
    let client_id = db
        .kv_get("anilist_client_id")
        .ok_or("Bitte zuerst die Client-ID speichern")?;
    Ok(auth::authorize_url(&client_id))
}

/// Validiert den eingefügten Token gegen die Viewer-Query und speichert ihn
/// im Windows Credential Manager. Gibt das Viewer-Objekt zurück.
#[tauri::command]
pub async fn anilist_connect(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    token: String,
) -> Result<Value, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Bitte den Token von der AniList-Seite einfügen".into());
    }
    let data = api.query(Some(&token), VIEWER_QUERY, json!({})).await?;
    let viewer = data
        .get("Viewer")
        .filter(|v| !v.is_null())
        .cloned()
        .ok_or("Token ungültig oder abgelaufen")?;
    auth::save_token(&token)?;
    db.kv_set("anilist_viewer", &viewer.to_string())?;
    Ok(viewer)
}

/// Gibt den gecachten Viewer zurück, wenn ein Token gespeichert ist —
/// ohne API-Call, damit der App-Start offline und ratelimit-schonend ist.
#[tauri::command]
pub fn anilist_session(db: State<'_, Db>) -> Option<Value> {
    auth::load_token()?;
    let cached = db.kv_get("anilist_viewer")?;
    serde_json::from_str(&cached).ok()
}

#[tauri::command]
pub fn anilist_logout(db: State<'_, Db>) {
    auth::delete_token();
    db.kv_delete("anilist_viewer");
}

/// Generischer GraphQL-Proxy: Das Frontend definiert Query + Variablen,
/// das Backend hängt den Token an und übernimmt das Rate-Limiting.
#[tauri::command]
pub async fn anilist_query(
    api: State<'_, AniList>,
    query: String,
    variables: Option<Value>,
) -> Result<Value, String> {
    let token = auth::load_token();
    api.query(
        token.as_deref(),
        &query,
        variables.unwrap_or_else(|| json!({})),
    )
    .await
}
