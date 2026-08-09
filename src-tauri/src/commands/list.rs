use crate::anilist::{
    auth,
    client::{AniList, ApiError},
};
use crate::db::Db;
use serde_json::{json, Value};
use tauri::State;

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

const LIST_QUERY: &str = "
query ($userId: Int!, $type: MediaType!) {
  MediaListCollection(userId: $userId, type: $type) {
    lists {
      name
      status
      isCustomList
      entries {
        id
        mediaId
        status
        score(format: POINT_10)
        progress
        progressVolumes
        repeat
        notes
        updatedAt
        media {
          id
          type
          title { romaji english native }
          coverImage { large }
          episodes
          chapters
          volumes
          duration
          format
          status
          season
          seasonYear
          averageScore
          genres
          synonyms
          isAdult
          nextAiringEpisode { episode airingAt }
        }
      }
    }
  }
}";

fn validate_media_type(media_type: &str) -> Result<&str, String> {
    match media_type {
        "ANIME" | "MANGA" => Ok(media_type),
        _ => Err(format!("Invalid media type: {media_type}")),
    }
}

const SAVE_MUTATION: &str = "
mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int, $score: Float, $repeat: Int, $notes: String) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, progressVolumes: $progressVolumes, score: $score, repeat: $repeat, notes: $notes) {
    id mediaId status progress progressVolumes repeat notes updatedAt
    score(format: POINT_10)
  }
}";

const DELETE_MUTATION: &str = "
mutation ($id: Int) {
  DeleteMediaListEntry(id: $id) { deleted }
}";

/// One request for a whole selection, keyed on **list-entry** ids (not media
/// ids, unlike `SaveMediaListEntry`'s `mediaId`).
///
/// Verified against the live schema before wiring: the batch mutation is
/// `UpdateMediaListEntries(ids: [Int], …) -> [MediaList]`. It is *not* called
/// `SaveMediaListEntries`, which does not exist — the reason CLAUDE.md insists
/// on checking the schema rather than the shape one expects.
const UPDATE_ENTRIES_MUTATION: &str = "
mutation ($ids: [Int], $status: MediaListStatus, $score: Float) {
  UpdateMediaListEntries(ids: $ids, status: $status, score: $score) {
    id mediaId status progress progressVolumes repeat notes updatedAt
    score(format: POINT_10)
  }
}";

/// Entry ids per request. AniList documents no cap for this mutation, so this
/// matches the ≤50 the read side uses for `Page.media(id_in:)` rather than
/// inventing a second number.
const BULK_CHUNK: usize = 50;

#[derive(serde::Serialize)]
pub struct ListResult {
    /// true if the data comes from the local cache (offline)
    #[serde(rename = "fromCache")]
    from_cache: bool,
    /// number of changes not yet synced
    pending: usize,
    lists: Value,
}

/// The last cached list for this user and type, with no network access at all.
///
/// `fetch_media_list` always awaits AniList, so a cold start stares at a
/// loading state even though a complete list is sitting on disk. This lets the
/// frontend paint that immediately and let the real fetch land underneath it.
///
/// `from_cache` is deliberately `false` here. That flag means "you are offline
/// and this is all we have" — it drives the amber banner in MediaList — and
/// this path is a head start on a refresh that is already in flight, not an
/// offline fallback. Returns `None` when nothing has been cached yet, so the
/// caller simply falls back to the normal loading state.
#[tauri::command]
pub fn cached_media_list(
    db: State<'_, Db>,
    user_id: i64,
    media_type: String,
) -> Option<ListResult> {
    let media_type = validate_media_type(&media_type).ok()?;
    let cached = db.cached_list(user_id, media_type)?;
    Some(ListResult {
        from_cache: false,
        pending: db.queue_len(),
        lists: serde_json::from_str(&cached).ok()?,
    })
}

/// Loads the anime/manga list; offline, the last known state is served
/// from SQLite. The offline queue is drained first so that the server
/// response already includes the user's own pending changes.
#[tauri::command]
pub async fn fetch_media_list(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    user_id: i64,
    media_type: String,
) -> Result<ListResult, String> {
    let media_type = validate_media_type(&media_type)?;
    let token = auth::load_token();
    // Not fatal — a fetch is still worth doing with the queue undrained — but a
    // silent failure here presented as a stale list with a pending count that
    // never went down, and nothing said why.
    if let Err(e) = process_queue(&db, &api, token.as_deref()).await {
        crate::logging::warn("queue", format!("cannot drain the offline queue: {e}"));
    }

    match api
        .query(
            token.as_deref(),
            LIST_QUERY,
            json!({ "userId": user_id, "type": media_type }),
        )
        .await
    {
        Ok(data) => {
            let lists = data
                .pointer("/MediaListCollection/lists")
                .cloned()
                .unwrap_or_else(|| json!([]));
            if let Err(e) = db.cache_list(user_id, media_type, &lists.to_string()) {
                // Every cold start then hits the network instead of the cache.
                crate::logging::warn("cache", format!("cannot cache the {media_type} list: {e}"));
            }
            Ok(ListResult {
                from_cache: false,
                pending: db.queue_len(),
                lists,
            })
        }
        Err(ApiError::Network(_)) => {
            let cached = db
                .cached_list(user_id, media_type)
                .ok_or("Offline and no local list cache available yet")?;
            Ok(ListResult {
                from_cache: true,
                pending: db.queue_len(),
                lists: serde_json::from_str(&cached)
                    .map_err(|e| format!("Cache corrupted: {e}"))?,
            })
        }
        Err(e) => Err(e.into()),
    }
}

#[derive(serde::Serialize)]
pub struct MutationResult {
    /// true if the change was queued offline
    pub(crate) queued: bool,
    pub(crate) entry: Option<Value>,
}

/// Core of list saving, also used by the scrobbler: straight to the API
/// when online, into the queue when offline (order is preserved).
pub(crate) async fn save_entry_core(
    db: &Db,
    api: &AniList,
    token: &str,
    input: Value,
) -> Result<MutationResult, String> {
    if db.queue_len() > 0 && process_queue(db, api, Some(token)).await.is_err() {
        db.queue_push("save", &input.to_string())?;
        return Ok(MutationResult { queued: true, entry: None });
    }

    match api.query(Some(token), SAVE_MUTATION, input.clone()).await {
        Ok(data) => Ok(MutationResult {
            queued: false,
            entry: data.get("SaveMediaListEntry").cloned(),
        }),
        Err(ApiError::Network(_)) => {
            db.queue_push("save", &input.to_string())?;
            Ok(MutationResult { queued: true, entry: None })
        }
        Err(e) => Err(e.into()),
    }
}

/// Saves a list entry (status/progress/score). Offline, the change is
/// queued and synced later.
#[tauri::command]
pub async fn save_list_entry(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    input: Value,
) -> Result<MutationResult, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    save_entry_core(&db, &api, &token, input).await
}

/// Splits ids into request-sized chunks.
///
/// Pure so the bound can be tested without a network call — the whole point of
/// this command is that a 500-entry selection is ten requests rather than five
/// hundred, and nothing else would catch that regressing.
pub(crate) fn bulk_chunks(ids: &[i64]) -> Vec<Vec<i64>> {
    ids.chunks(BULK_CHUNK).map(|c| c.to_vec()).collect()
}

/// Applies one status or score to many entries at once.
///
/// Replaces a `forEach` over the selection that issued one mutation per entry:
/// selecting a whole list and picking a status fired hundreds of concurrent
/// requests against a ~30/min budget, which AniList answers with 429s, and the
/// per-entry rollback that followed then undid the ones that had succeeded.
#[tauri::command]
pub async fn bulk_save_list_entries(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    ids: Vec<i64>,
    status: Option<String>,
    score: Option<f64>,
) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    if status.is_none() && score.is_none() {
        return Err("Nothing to change".into());
    }
    let token = auth::load_token().ok_or("Not connected to AniList")?;

    // Anything already queued has to land first, or this write would be
    // overwritten by an older one replaying on top of it.
    if db.queue_len() > 0 {
        process_queue(&db, &api, Some(&token)).await?;
    }

    let mut updated = 0usize;
    for chunk in bulk_chunks(&ids) {
        let vars = json!({ "ids": chunk, "status": status, "score": score });
        // No offline queue for this one: the queue replays `SaveMediaListEntry`
        // per entry, so draining a bulk edit through it would reintroduce
        // exactly the fan-out this exists to avoid. Failing honestly lets the
        // caller roll back and say so.
        let data = api
            .query(Some(&token), UPDATE_ENTRIES_MUTATION, vars)
            .await
            .map_err(String::from)?;
        updated += data
            .pointer("/UpdateMediaListEntries")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
    }
    Ok(updated)
}

#[tauri::command]
pub async fn delete_list_entry(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    id: i64,
) -> Result<MutationResult, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    let input = json!({ "id": id });

    if db.queue_len() > 0 && process_queue(&db, &api, Some(&token)).await.is_err() {
        db.queue_push("delete", &input.to_string())?;
        return Ok(MutationResult { queued: true, entry: None });
    }

    match api.query(Some(&token), DELETE_MUTATION, input.clone()).await {
        Ok(_) => Ok(MutationResult { queued: false, entry: None }),
        Err(ApiError::Network(_)) => {
            db.queue_push("delete", &input.to_string())?;
            Ok(MutationResult { queued: true, entry: None })
        }
        Err(e) => Err(e.into()),
    }
}

// --- Local-only profile mode ------------------------------------------------

pub(super) fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Current profile mode: "anilist" (default) or "local".
#[tauri::command]
pub fn get_profile_mode(db: State<'_, Db>) -> String {
    db.kv_get("profile_mode")
        .unwrap_or_else(|| "anilist".to_string())
}

/// Switches into account-free local mode. Connecting AniList later flips it
/// back to "anilist" (and offers to merge — see the frontend merge flow).
#[tauri::command]
pub fn enable_local_mode(db: State<'_, Db>) -> Result<(), String> {
    db.kv_set("profile_mode", "local")
}

/// Loads the local list for a media type, shaped exactly like the online
/// `ListResult` so the UI is identical.
#[tauri::command]
pub fn local_fetch_list(
    db: State<'_, Db>,
    media_type: String,
) -> Result<ListResult, String> {
    let media_type = validate_media_type(&media_type)?;
    let lists: Value = serde_json::from_str(&db.local_list_json(media_type))
        .unwrap_or_else(|_| json!([]));
    Ok(ListResult {
        from_cache: false,
        pending: 0,
        lists,
    })
}

/// Saves a local entry. On a first add the caller supplies `media` (the
/// AniList media object) so the list renders offline; field-only edits may
/// omit it and the stored metadata is kept.
#[tauri::command]
pub fn local_save_entry(
    db: State<'_, Db>,
    input: Value,
) -> Result<MutationResult, String> {
    let media_id = input
        .get("mediaId")
        .and_then(|v| v.as_i64())
        .ok_or("mediaId required")?;
    let media_type = input
        .get("mediaType")
        .and_then(|v| v.as_str())
        .or_else(|| input.pointer("/media/type").and_then(|v| v.as_str()))
        .map(str::to_string)
        .or_else(|| db.local_find_type(media_id))
        .ok_or("mediaType required for a new local entry")?;
    validate_media_type(&media_type)?;

    let status = input.get("status").and_then(|v| v.as_str()).unwrap_or("PLANNING");
    let progress = input.get("progress").and_then(|v| v.as_i64()).unwrap_or(0);
    let progress_volumes = input
        .get("progressVolumes")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let score = input.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let repeat = input.get("repeat").and_then(|v| v.as_i64()).unwrap_or(0);
    let notes = input.get("notes").and_then(|v| v.as_str()).unwrap_or("");
    let media_json = input
        .get("media")
        .filter(|m| !m.is_null())
        .map(|m| m.to_string());
    let ts = now_ms();

    db.local_upsert(
        media_id,
        &media_type,
        status,
        progress,
        progress_volumes,
        score,
        repeat,
        notes,
        media_json.as_deref(),
        ts,
    )?;

    Ok(MutationResult {
        queued: false,
        entry: Some(json!({
            "id": media_id,
            "mediaId": media_id,
            "status": status,
            "progress": progress,
            "progressVolumes": progress_volumes,
            "score": score,
            "repeat": repeat,
            "notes": notes,
            "updatedAt": ts / 1000,
        })),
    })
}

/// Deletes a local entry. In local mode the frontend entry id equals the
/// media id.
#[tauri::command]
pub fn local_delete_entry(db: State<'_, Db>, id: i64) -> Result<MutationResult, String> {
    if let Some(media_type) = db.local_find_type(id) {
        db.local_delete(id, &media_type)?;
    }
    Ok(MutationResult { queued: false, entry: None })
}

/// All local rows across both media types, for the sign-in merge. Each row
/// carries its media metadata so the frontend can present a conflict prompt.
#[tauri::command]
pub fn local_all_entries(db: State<'_, Db>) -> Value {
    let rows: Vec<Value> = db
        .local_all()
        .into_iter()
        .map(|r| {
            let media: Value = r
                .media_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(Value::Null);
            json!({
                "mediaId": r.media_id,
                "mediaType": r.media_type,
                "status": r.status,
                "progress": r.progress,
                "progressVolumes": r.progress_volumes,
                "score": r.score,
                "repeat": r.repeat,
                "notes": r.notes,
                "updatedAt": r.updated_ms / 1000,
                "media": media,
            })
        })
        .collect();
    json!(rows)
}

/// Drains the offline queue in order. Network errors abort (the rest stays
/// queued); API errors drop the entry so the queue can never get stuck.
async fn process_queue(
    db: &Db,
    api: &AniList,
    token: Option<&str>,
) -> Result<usize, String> {
    let mut flushed = 0;
    for (id, kind, payload) in db.queue_all() {
        let variables: Value =
            serde_json::from_str(&payload).unwrap_or_else(|_| json!({}));
        let mutation = if kind == "delete" { DELETE_MUTATION } else { SAVE_MUTATION };
        match api.query(token, mutation, variables).await {
            Ok(_) => {
                db.queue_remove(id);
                flushed += 1;
            }
            Err(ApiError::Network(m)) => return Err(m),
            Err(ApiError::Api(_)) => db.queue_remove(id),
        }
    }
    Ok(flushed)
}

/// Manually triggered sync of the offline queue (e.g. a button in the UI).
#[tauri::command]
pub async fn flush_queue(
    db: State<'_, Db>,
    api: State<'_, AniList>,
) -> Result<usize, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    process_queue(&db, &api, Some(&token)).await
}

#[cfg(test)]
mod tests {
    use super::{bulk_chunks, BULK_CHUNK};

    /// The reason this command exists: a whole-list selection has to become a
    /// handful of requests, not one per entry against a ~30/min budget.
    #[test]
    fn a_large_selection_becomes_few_requests() {
        let ids: Vec<i64> = (1..=500).collect();
        let chunks = bulk_chunks(&ids);
        assert_eq!(chunks.len(), 10);
        assert!(chunks.iter().all(|c| c.len() <= BULK_CHUNK));
        // Every id is carried exactly once, in order.
        assert_eq!(chunks.concat(), ids);
    }

    #[test]
    fn a_partial_chunk_is_still_sent() {
        assert_eq!(bulk_chunks(&[1, 2, 3]).len(), 1);
        let ids: Vec<i64> = (1..=51).collect();
        let chunks = bulk_chunks(&ids);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[1], vec![51]);
    }

    #[test]
    fn an_empty_selection_sends_nothing() {
        assert!(bulk_chunks(&[]).is_empty());
    }
}
