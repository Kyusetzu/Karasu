use crate::anilist::{
    auth,
    client::{AniList, ApiError, RateSnapshot, RequestLogEntry},
};
use crate::db::Db;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, State};

// Siblings in the same module tree; `mod.rs` re-exports all of it, so every command keeps its old path.
#[allow(unused_imports)]
use super::*;

/// `advancedScores` is behind `@include` because it is large, cached uncompressed, and off for most accounts.
const LIST_QUERY: &str = "
query ($userId: Int!, $type: MediaType!, $scoreFormat: ScoreFormat, $withAdvanced: Boolean!) {
  MediaListCollection(userId: $userId, type: $type) {
    lists {
      name
      status
      isCustomList
      entries {
        id
        mediaId
        status
        score(format: $scoreFormat)
        progress
        progressVolumes
        repeat
        notes
        updatedAt
        private
        hiddenFromStatusLists
        customLists
        advancedScores @include(if: $withAdvanced)
        startedAt { year month day }
        completedAt { year month day }
        media {
          id
          idMal
          type
          title { romaji english native }
          coverImage { large }
          episodes
          chapters
          volumes
          duration
          format
          countryOfOrigin
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

/// The account's score format from the cached viewer blob, validated so a corrupted blob degrades to ten-point.
pub(crate) fn viewer_score_format(db: &Db) -> &'static str {
    let stored = db
        .kv_get("anilist_viewer")
        .and_then(|blob| serde_json::from_str::<Value>(&blob).ok())
        .and_then(|v| {
            v.pointer("/mediaListOptions/scoreFormat")
                .and_then(|f| f.as_str())
                .map(String::from)
        });
    match stored.as_deref() {
        Some("POINT_100") => "POINT_100",
        Some("POINT_10_DECIMAL") => "POINT_10_DECIMAL",
        Some("POINT_5") => "POINT_5",
        Some("POINT_3") => "POINT_3",
        _ => "POINT_10",
    }
}

/// Whether this media type has advanced scoring on; the flag is the signal, since AniList seeds names even when off.
pub(crate) fn viewer_advanced_scoring(db: &Db, media_type: &str) -> bool {
    let key = if media_type == "MANGA" {
        "/mediaListOptions/mangaList/advancedScoringEnabled"
    } else {
        "/mediaListOptions/animeList/advancedScoringEnabled"
    };
    db.kv_get("anilist_viewer")
        .and_then(|blob| serde_json::from_str::<Value>(&blob).ok())
        .and_then(|v| v.pointer(key).and_then(|f| f.as_bool()))
        .unwrap_or(false)
}

/// The signed-in account from the cached viewer blob; every queue read and write is scoped by it.
pub(crate) fn viewer_id(db: &Db) -> Option<i64> {
    db.kv_get("anilist_viewer")
        .and_then(|blob| serde_json::from_str::<Value>(&blob).ok())
        .and_then(|v| v.get("id").and_then(|i| i.as_i64()))
}

/// One entry's live progress and status; a `Page`, because a `MediaList` root 404s on a missing entry.
pub(crate) const ENTRY_PROGRESS_QUERY: &str = "query ($userId: Int, $mediaId: Int) { Page(perPage: 1) { mediaList(userId: $userId, mediaId: $mediaId) { progress status } } }";

/// Reads the page shape above. `None` is the empty page — not on the list.
pub(crate) fn parse_live_entry(data: &Value) -> Option<(u32, String)> {
    let row = data.pointer("/Page/mediaList/0")?;
    let progress = row.get("progress").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let status = row
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Some((progress, status))
}

/// Asks AniList what the entry holds now; the outer `None` is "could not ask", the inner one is the empty page.
pub(crate) async fn live_entry(
    api: &AniList,
    token: &str,
    user_id: i64,
    media_id: i64,
) -> Option<Option<(u32, String)>> {
    match api
        .query(
            Some(token),
            ENTRY_PROGRESS_QUERY,
            json!({ "userId": user_id, "mediaId": media_id }),
        )
        .await
    {
        Ok(data) => Some(parse_live_entry(&data)),
        Err(e) => {
            crate::logging::debug_changed(
                "scrobble",
                "live",
                format!("live check unavailable: {}", String::from(e)),
            );
            None
        }
    }
}

/// How many edits the signed-in account is waiting to sync; zero when signed out.
pub(crate) fn pending(db: &Db) -> usize {
    viewer_id(db).map_or(0, |u| db.queue_len(u))
}

/// `$scoreRaw: Int`, never `$score: Float`: a bare score is read in the account's format and silently corrupts.
const SAVE_MUTATION: &str = "
mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int, $scoreRaw: Int, $repeat: Int, $notes: String, $private: Boolean, $hiddenFromStatusLists: Boolean, $customLists: [String], $advancedScores: [Float], $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput, $scoreFormat: ScoreFormat) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, progressVolumes: $progressVolumes, scoreRaw: $scoreRaw, repeat: $repeat, notes: $notes, private: $private, hiddenFromStatusLists: $hiddenFromStatusLists, customLists: $customLists, advancedScores: $advancedScores, startedAt: $startedAt, completedAt: $completedAt) {
    id mediaId status progress progressVolumes repeat notes updatedAt private hiddenFromStatusLists customLists advancedScores
    startedAt { year month day }
    completedAt { year month day }
    score(format: $scoreFormat)
  }
}";

const DELETE_MUTATION: &str = "
mutation ($id: Int) {
  DeleteMediaListEntry(id: $id) { deleted }
}";

/// One request for a whole selection, keyed on list-entry ids; `notes` stays out, since it would destroy every tag.
const UPDATE_ENTRIES_MUTATION: &str = "
mutation ($ids: [Int], $status: MediaListStatus, $scoreRaw: Int, $progress: Int, $progressVolumes: Int, $repeat: Int, $private: Boolean, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput, $scoreFormat: ScoreFormat) {
  UpdateMediaListEntries(ids: $ids, status: $status, scoreRaw: $scoreRaw, progress: $progress, progressVolumes: $progressVolumes, repeat: $repeat, private: $private, startedAt: $startedAt, completedAt: $completedAt) {
    id mediaId status progress progressVolumes repeat notes updatedAt private
    startedAt { year month day }
    completedAt { year month day }
    score(format: $scoreFormat)
  }
}";

/// Entry ids per request, matching the read side's `Page.media(id_in:)` bound rather than inventing a second number.
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

/// The last cached list with no network access, a head start on the fetch; `from_cache` stays false, it is not a fallback.
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
        pending: db.queue_len(user_id),
        lists: serde_json::from_str(&cached).ok()?,
    })
}

/// Loads the list, draining the offline queue first so the response already holds the user's own pending changes.
#[tauri::command]
pub async fn fetch_media_list(
    app: AppHandle,
    db: State<'_, Db>,
    api: State<'_, AniList>,
    user_id: i64,
    media_type: String,
) -> Result<ListResult, String> {
    let media_type = validate_media_type(&media_type)?;
    let token = auth::load_token();
    // Not fatal, a fetch is still worth doing with the queue undrained, but the failure is logged rather than silent.
    match process_queue(&db, &api, token.as_deref()).await {
        Ok(drained) => report_dropped(&app, &drained.dropped),
        Err(e) => crate::logging::warn("queue", format!("cannot drain the offline queue: {e}")),
    }

    match api
        .query(
            token.as_deref(),
            LIST_QUERY,
            json!({
                "userId": user_id,
                "type": media_type,
                "scoreFormat": viewer_score_format(&db),
                "withAdvanced": viewer_advanced_scoring(&db, media_type),
            }),
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
            // The home-screen widgets render a projection of exactly this cache; a fresh list is the moment it moves.
            crate::widgets::refresh(&app);
            Ok(ListResult {
                from_cache: false,
                pending: db.queue_len(user_id),
                lists,
            })
        }
        // Offline or throttled falls back to the cache; `Auth` does not, since a rejected token must reach the frontend.
        Err(e @ (ApiError::Network(_) | ApiError::Retryable(_))) => {
            let cached = db.cached_list(user_id, media_type).ok_or_else(|| {
                let _ = &e;
                "Offline and no local list cache available yet".to_string()
            })?;
            // The cache did not move, but the projection file can still be missing; refreshing is idempotent.
            crate::widgets::refresh(&app);
            Ok(ListResult {
                from_cache: true,
                pending: db.queue_len(user_id),
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

/// Core of list saving, also used by the scrobbler: straight to the API when online, into the queue when offline.
pub(crate) async fn save_entry_core(
    app: &AppHandle,
    db: &Db,
    api: &AniList,
    token: &str,
    mut input: Value,
) -> Result<MutationResult, String> {
    // The format rides along here rather than from callers, because the scrobbler saves through this path too.
    if let Some(vars) = input.as_object_mut() {
        vars.insert("scoreFormat".into(), json!(viewer_score_format(db)));
    }
    // A skipped drain takes the failed exit: a live write would otherwise be overwritten by older rows it still holds.
    if pending(db) > 0 {
        match process_queue(db, api, Some(token)).await {
            Ok(drained) if !drained.skipped => report_dropped(app, &drained.dropped),
            _ => {
                queue_push_deduped(db, "save", &input.to_string())?;
                return Ok(MutationResult { queued: true, entry: None });
            }
        }
    }

    match api.query(Some(token), SAVE_MUTATION, input.clone()).await {
        // Queued rather than raised for anything that could work later, or the edit is lost outright.
        Err(e) if e.is_retryable() => {
            queue_push_deduped(db, "save", &input.to_string())?;
            Ok(MutationResult { queued: true, entry: None })
        }
        Ok(data) => {
            let entry = data.get("SaveMediaListEntry").cloned();
            // The scrobbler's anti-regression guards read this cache, so it is patched from what AniList accepted.
            if let Some(echo) = entry.as_ref() {
                cache_entry_echo(db, echo);
            }
            Ok(MutationResult { queued: false, entry })
        }
        Err(e) => Err(e.into()),
    }
}

/// Mirrors a saved entry into the SQLite list cache; anything absent from the echo is left alone, not blanked.
pub(crate) fn cache_entry_echo(db: &Db, echo: &Value) {
    let Some(user_id) = viewer_id(db) else { return };
    let Some(media_id) = echo
        .get("mediaId")
        .and_then(|v| v.as_i64())
        .or_else(|| echo.pointer("/media/id").and_then(|v| v.as_i64()))
    else {
        return;
    };
    let media_type = echo
        .pointer("/media/type")
        .and_then(|v| v.as_str())
        .unwrap_or("ANIME");
    let mut patch = serde_json::Map::new();
    for field in [
        "progress",
        "progressVolumes",
        "status",
        "score",
        "repeat",
        "notes",
        "private",
        "startedAt",
        "completedAt",
    ] {
        if let Some(v) = echo.get(field) {
            if !v.is_null() {
                patch.insert(field.into(), v.clone());
            }
        }
    }
    db.cache_patch_entry(user_id, media_type, media_id, &Value::Object(patch));
}

/// Saves a list entry; offline, the change is queued and synced later.
#[tauri::command]
pub async fn save_list_entry(
    app: AppHandle,
    db: State<'_, Db>,
    api: State<'_, AniList>,
    input: Value,
) -> Result<MutationResult, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    save_entry_core(&app, &db, &api, &token, input).await
}

/// What a bulk edit managed and what stopped it; two fields, because a run can both write hundreds and fail.
#[derive(serde::Serialize)]
pub struct BulkResult {
    pub updated: usize,
    /// The failure that ended the run; whatever `updated` counts is already written and not undone by it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Splits ids into request-sized chunks; pure, so the bound is tested without a network call.
pub(crate) fn bulk_chunks(ids: &[i64]) -> Vec<Vec<i64>> {
    ids.chunks(BULK_CHUNK).map(|c| c.to_vec()).collect()
}

/// Applies one change to many entries in a few requests, rather than one mutation per entry against the rate budget.
#[tauri::command]
pub async fn bulk_save_list_entries(
    app: AppHandle,
    db: State<'_, Db>,
    api: State<'_, AniList>,
    ids: Vec<i64>,
    status: Option<String>,
    // The format-independent raw score, never a float.
    score_raw: Option<i64>,
    progress: Option<i64>,
    // snake_case here, camelCase on the wire: Tauri maps the two.
    progress_volumes: Option<i64>,
    repeat: Option<i64>,
    private: Option<bool>,
    // `FuzzyDateInput`, forwarded as an opaque `{year, month, day}` because every part is nullable.
    started_at: Option<Value>,
    completed_at: Option<Value>,
) -> Result<BulkResult, String> {
    if ids.is_empty() {
        return Ok(BulkResult { updated: 0, error: None });
    }
    // Every field absent is rejected, or AniList would touch every selected entry's `updatedAt` and change nothing.
    if status.is_none()
        && score_raw.is_none()
        && progress.is_none()
        && progress_volumes.is_none()
        && repeat.is_none()
        && private.is_none()
        && started_at.is_none()
        && completed_at.is_none()
    {
        return Err("Nothing to change".into());
    }
    let token = auth::load_token().ok_or("Not connected to AniList")?;

    // Anything queued lands first, and a bulk edit cannot be queued itself, so a skipped drain has to refuse.
    if pending(&db) > 0 {
        let drained = process_queue(&db, &api, Some(&token)).await?;
        if drained.skipped {
            // A stable code, not a sentence; `lib/backendError.ts` turns it into the reader's language.
            return Err("queue.busy".into());
        }
        report_dropped(&app, &drained.dropped);
    }

    let mut updated = 0usize;
    let mut failure = None;
    for chunk in bulk_chunks(&ids) {
        let vars = json!({
            "ids": chunk,
            "status": status,
            "scoreRaw": score_raw,
            "progress": progress,
            "progressVolumes": progress_volumes,
            "repeat": repeat,
            "private": private,
            "startedAt": started_at,
            "completedAt": completed_at,
            "scoreFormat": viewer_score_format(&db),
        });
        // No queue for a bulk edit, which would replay per entry; the first failure stops the run but keeps the count.
        match api.query(Some(&token), UPDATE_ENTRIES_MUTATION, vars).await {
            Ok(data) => {
                let echoed = data
                    .pointer("/UpdateMediaListEntries")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                updated += echoed.len();
                // Each accepted chunk is mirrored as it lands, so a run that dies halfway leaves the cache agreeing.
                for entry in &echoed {
                    cache_entry_echo(&db, entry);
                }
            }
            Err(e) => {
                failure = Some(String::from(e));
                break;
            }
        }
    }
    Ok(BulkResult { updated, error: failure })
}

#[tauri::command]
pub async fn delete_list_entry(
    app: AppHandle,
    db: State<'_, Db>,
    api: State<'_, AniList>,
    id: i64,
) -> Result<MutationResult, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    let input = json!({ "id": id });

    // A skipped drain takes the failed exit, or an older queued save replays after the delete and recreates the row.
    if pending(&db) > 0 {
        match process_queue(&db, &api, Some(&token)).await {
            Ok(drained) if !drained.skipped => report_dropped(&app, &drained.dropped),
            _ => {
                queue_push_deduped(&db, "delete", &input.to_string())?;
                return Ok(MutationResult { queued: true, entry: None });
            }
        }
    }

    match api.query(Some(&token), DELETE_MUTATION, input.clone()).await {
        Ok(_) => {
            // A deleted entry left in the cache stays a scrobble candidate, and a scrobble would recreate it.
            if let Some(user_id) = viewer_id(&db) {
                db.cache_forget_entry_id(user_id, id);
            }
            Ok(MutationResult { queued: false, entry: None })
        }
        Err(e) if e.is_retryable() => {
            queue_push_deduped(&db, "delete", &input.to_string())?;
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
pub(crate) fn profile_mode(db: &Db) -> String {
    db.kv_get("profile_mode")
        .unwrap_or_else(|| "anilist".to_string())
}

#[tauri::command]
pub fn get_profile_mode(db: State<'_, Db>) -> String {
    profile_mode(&db)
}

/// Switches into account-free local mode and deletes the token, which survives a reinstall the database does not.
#[tauri::command]
pub fn enable_local_mode(db: State<'_, Db>) -> Result<(), String> {
    // Through the one switch, so nothing of the outgoing account sits behind the account-free list.
    crate::commands::auth::switch_identity(&db, crate::commands::auth::Identity::Local)
}

/// Loads the local list for a media type, shaped exactly like the online `ListResult` so the UI is identical.
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

/// Saves a local entry; a first add supplies `media` so the list renders offline, later edits may omit it.
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

    // Absent means "leave it alone" for every field, exactly as it does for AniList; defaulting here reset rows.
    let status = input.get("status").and_then(|v| v.as_str());
    let progress = input.get("progress").and_then(|v| v.as_i64());
    let progress_volumes = input.get("progressVolumes").and_then(|v| v.as_i64());
    let score = input.get("score").and_then(|v| v.as_f64());
    let repeat = input.get("repeat").and_then(|v| v.as_i64());
    let notes = input.get("notes").and_then(|v| v.as_str());
    let media_json = input
        .get("media")
        .filter(|m| !m.is_null())
        .map(|m| m.to_string());
    let private = input.get("private").and_then(|v| v.as_bool());
    let started_at = fuzzy_date_text(&input, "startedAt");
    let completed_at = fuzzy_date_text(&input, "completedAt");
    let ts = now_ms();

    db.local_upsert(crate::db::LocalWrite {
        media_id,
        media_type: &media_type,
        status,
        progress,
        progress_volumes,
        score,
        repeat,
        notes,
        private,
        started_at: started_at.as_deref(),
        completed_at: completed_at.as_deref(),
        media_json: media_json.as_deref(),
        updated_ms: ts,
    })?;

    // Only the facts this call established; echoing the scalars would fabricate values the row may still hold.
    Ok(MutationResult {
        queued: false,
        entry: Some(json!({
            "id": media_id,
            "mediaId": media_id,
            "updatedAt": ts / 1000,
        })),
    })
}

/// A `FuzzyDate` argument as the JSON text the local list stores; null folds into `None`, as AniList treats it.
fn fuzzy_date_text(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .filter(|v| v.is_object())
        .map(|v| v.to_string())
}

/// Deletes a local entry; in local mode the frontend entry id equals the media id.
#[tauri::command]
pub fn local_delete_entry(db: State<'_, Db>, id: i64) -> Result<MutationResult, String> {
    if let Some(media_type) = db.local_find_type(id) {
        db.local_delete(id, &media_type)?;
    }
    Ok(MutationResult { queued: false, entry: None })
}

/// All local rows across both media types with their media metadata, for the sign-in merge's conflict prompt.
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
                // Everything the local row holds, because the merge pushes this and then deletes the local copy.
                "private": r.private,
                "startedAt": Db::fuzzy_date(r.started_at.as_deref()),
                "completedAt": Db::fuzzy_date(r.completed_at.as_deref()),
                "updatedAt": r.updated_ms / 1000,
                "media": media,
            })
        })
        .collect();
    json!(rows)
}

/// What a drain did; more than one number, because a dropped row is something the user typed and will not get back.
pub(crate) struct Drained {
    pub flushed: usize,
    /// One message per queued edit AniList refused permanently.
    pub dropped: Vec<String>,
    /// Another drain held the lock, so this call did nothing; without it, contention looks exactly like an empty queue.
    pub skipped: bool,
}

/// What a queued payload is about, shared by the dedupe and the sync panel so the two cannot disagree.
pub(crate) struct QueueParts {
    /// `mediaId` for a save, the list-entry `id` for a delete; the number spaces overlap, `kind` tells them apart.
    pub subject: i64,
    /// The non-null fields the payload changes, sorted, `scoreFormat` excluded.
    pub fields: Vec<String>,
}

pub(crate) fn queue_parts(kind: &str, payload: &str) -> Option<QueueParts> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let obj = value.as_object()?;
    let subject = match kind {
        "save" => obj.get("mediaId")?.as_i64()?,
        "delete" => obj.get("id")?.as_i64()?,
        _ => return None,
    };
    let mut fields: Vec<String> = obj
        .iter()
        .filter(|(k, v)| {
            k.as_str() != "scoreFormat"
                && !v.is_null()
                // The subject names the entry, it is not a change to it.
                && k.as_str() != if kind == "save" { "mediaId" } else { "id" }
        })
        .map(|(k, _)| k.clone())
        .collect();
    fields.sort_unstable();
    Some(QueueParts { subject, fields })
}

/// The dedupe key: kind, subject and the non-null fields, so a progress edit cannot swallow a status edit.
pub(crate) fn queue_key(kind: &str, payload: &str) -> Option<String> {
    let QueueParts { subject, fields } = queue_parts(kind, payload)?;
    Some(format!("{kind}:{subject}:{}", fields.join(",")))
}

/// Queues a mutation against the signed-in account, dropping any it makes redundant; a row with no owner is refused.
fn queue_push_deduped(db: &Db, kind: &str, payload: &str) -> Result<(), String> {
    let user_id = viewer_id(db).ok_or("Not connected to AniList")?;
    if let Some(key) = queue_key(kind, payload) {
        for row in db.queue_all(user_id) {
            if queue_key(&row.kind, &row.payload).as_deref() == Some(key.as_str()) {
                db.queue_remove(row.id);
            }
        }
    }
    db.queue_push(user_id, kind, payload)
}

/// One drain at a time, process-wide, taken with `try_lock` and skipped rather than awaited behind a sleeping drain.
static DRAIN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Whether a drain is running, readable without touching `DRAIN`, so a status poll can never make a drain skip.
static DRAINING: AtomicBool = AtomicBool::new(false);

/// Sets `DRAINING` for as long as it lives; a `Drop` guard, because `process_queue` has three exits including a panic.
struct DrainMark;

impl DrainMark {
    fn set() -> Self {
        DRAINING.store(true, Ordering::Release);
        DrainMark
    }
}

impl Drop for DrainMark {
    fn drop(&mut self) {
        DRAINING.store(false, Ordering::Release);
    }
}

pub(crate) fn drain_in_flight() -> bool {
    DRAINING.load(Ordering::Acquire)
}

async fn process_queue(
    db: &Db,
    api: &AniList,
    token: Option<&str>,
) -> Result<Drained, String> {
    let mut flushed = 0;
    let mut dropped = Vec::new();
    // Someone else is already draining; their pass covers these rows.
    let Ok(_drain) = DRAIN.try_lock() else {
        return Ok(Drained { flushed, dropped, skipped: true });
    };
    let _mark = DrainMark::set();
    // Only this account's rows: the queue outlives a sign-out, and an unscoped read drains one user's edits onto another.
    let Some(user_id) = viewer_id(db) else {
        return Ok(Drained { flushed, dropped, skipped: false });
    };
    for row in db.queue_all(user_id) {
        let (id, kind, payload) = (row.id, row.kind, row.payload);
        let mut variables: Value =
            serde_json::from_str(&payload).unwrap_or_else(|_| json!({}));
        // The format is re-stamped at drain time; `advancedScores` cannot be, since the payload lacks its category names.
        if kind == "save" {
            if let Some(vars) = variables.as_object_mut() {
                vars.insert("scoreFormat".into(), json!(viewer_score_format(db)));
            }
        }
        let mutation = if kind == "delete" { DELETE_MUTATION } else { SAVE_MUTATION };
        match api.query(token, mutation, variables).await {
            Ok(data) => {
                // The scrobbler's guards read this cache, and a drained edit is a write like any other.
                if let Some(echo) = data.get("SaveMediaListEntry") {
                    cache_entry_echo(db, echo);
                }
                db.queue_remove(id);
                flushed += 1;
            }
            Err(e) if e.is_retryable() => return Err(e.into()),
            Err(e) => {
                let reason = String::from(e);
                crate::logging::warn(
                    "queue",
                    format!("AniList refused a queued {kind} for good; dropping it: {reason}"),
                );
                db.queue_remove(id);
                dropped.push(reason);
            }
        }
    }
    Ok(Drained { flushed, dropped, skipped: false })
}

/// Tells the user through the bell when a queued edit was thrown away, since a drop is otherwise silent.
fn report_dropped(app: &AppHandle, dropped: &[String]) {
    let Some(first) = dropped.first() else { return };
    let body = match dropped.len() {
        1 => crate::i18n::Msg::QueueBodyOne { reason: first },
        n => crate::i18n::Msg::QueueBodyMany { count: n, reason: first },
    };
    // No media id: one report can stand for several titles, and a row opening one of them would misreport the rest.
    crate::alerts::notify::notify(app, "queue", crate::i18n::Msg::QueueTitle, body, None);
}

/// One queued edit, described rather than replayed; the payload itself never crosses to the frontend.
#[derive(serde::Serialize)]
pub struct QueuedEdit {
    pub id: i64,
    /// `"save"` or `"delete"`.
    pub kind: String,
    /// The media id for a save, the list-entry id for a delete, `None` when the payload does not parse but still a row.
    pub subject: Option<i64>,
    /// The fields this edit changes, for the row's summary line.
    pub fields: Vec<String>,
    #[serde(rename = "queuedAt")]
    pub queued_at: i64,
}

/// Everything the sync panel renders, at the cost of no AniList request, which is what makes polling it acceptable.
#[derive(serde::Serialize)]
pub struct SyncStatus {
    /// Signed in to AniList; false in local mode, where an empty queue is not the same statement.
    pub connected: bool,
    pub draining: bool,
    pub queued: Vec<QueuedEdit>,
    pub rate: RateSnapshot,
    /// Recent AniList traffic, newest first, so the panel can show what moved the headroom.
    pub recent: Vec<RequestLogEntry>,
}

/// The state of the sync, for the panel behind the pending badge.
#[tauri::command]
pub async fn sync_status(
    db: State<'_, Db>,
    api: State<'_, AniList>,
) -> Result<SyncStatus, String> {
    let viewer = viewer_id(&db);
    let queued = viewer
        .map(|user_id| {
            db.queue_all(user_id)
                .into_iter()
                .map(|row| {
                    let parts = queue_parts(&row.kind, &row.payload);
                    QueuedEdit {
                        id: row.id,
                        subject: parts.as_ref().map(|p| p.subject),
                        fields: parts.map(|p| p.fields).unwrap_or_default(),
                        kind: row.kind,
                        queued_at: row.created_at,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(SyncStatus {
        connected: viewer.is_some(),
        draining: drain_in_flight(),
        queued,
        rate: api.rate_snapshot().await,
        recent: api.request_log().await,
    })
}

/// Discards one queued edit, scoped to the signed-in account in the DELETE itself since the id may straddle a sign-out.
#[tauri::command]
pub fn discard_queued_edit(db: State<'_, Db>, id: i64) -> Result<bool, String> {
    let user_id = viewer_id(&db).ok_or("Not connected to AniList")?;
    Ok(db.queue_remove_for(user_id, id))
}

/// Manually triggered sync of the offline queue (e.g. a button in the UI).
#[tauri::command]
pub async fn flush_queue(
    app: AppHandle,
    db: State<'_, Db>,
    api: State<'_, AniList>,
) -> Result<usize, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    let drained = process_queue(&db, &api, Some(&token)).await?;
    report_dropped(&app, &drained.dropped);
    Ok(drained.flushed)
}

#[cfg(test)]
mod tests {
    use super::{bulk_chunks, queue_key, queue_parts, BULK_CHUNK};

    /// The parts and the key describe the same edit, so the panel and the dedupe cannot disagree.
    #[test]
    fn the_parts_and_the_key_describe_the_same_edit() {
        for (kind, payload) in [
            ("save", r#"{"mediaId":7,"progress":3,"status":"CURRENT"}"#),
            ("delete", r#"{"id":42}"#),
        ] {
            let parts = queue_parts(kind, payload).unwrap();
            let key = queue_key(kind, payload).unwrap();
            assert!(key.starts_with(&format!("{kind}:{}:", parts.subject)));
            assert!(parts.fields.iter().all(|f| key.contains(f.as_str())));
        }
        // And they agree about a payload with no subject at all.
        assert!(queue_parts("save", r#"{"progress":3}"#).is_none());
        assert!(queue_key("save", r#"{"progress":3}"#).is_none());
    }

    /// The subject names the entry rather than describing a change, so it stays out of the row's summary.
    #[test]
    fn the_subject_is_not_one_of_the_changed_fields() {
        let parts = queue_parts("save", r#"{"mediaId":7,"progress":3}"#).unwrap();
        assert_eq!(parts.fields, ["progress"]);
        assert!(queue_parts("delete", r#"{"id":42}"#).unwrap().fields.is_empty());
    }

    /// `scoreFormat` is never a changed field, since it describes the app rather than the edit.
    #[test]
    fn the_score_format_is_never_a_changed_field() {
        let parts =
            queue_parts("save", r#"{"mediaId":1,"scoreRaw":80,"scoreFormat":"POINT_5"}"#)
                .unwrap();
        assert_eq!(parts.fields, ["scoreRaw"]);
    }

    /// Repeated offline edits to one field collapse into the last one.
    #[test]
    fn repeated_edits_to_one_field_collapse() {
        let first = queue_key("save", r#"{"mediaId":1,"progress":3}"#);
        let then = queue_key("save", r#"{"mediaId":1,"progress":7}"#);
        assert_eq!(first, then);
        assert!(first.is_some());
    }

    /// Edits to different fields of one entry are kept apart, or a progress edit would be lost silently.
    #[test]
    fn edits_to_different_fields_are_kept_apart() {
        assert_ne!(
            queue_key("save", r#"{"mediaId":1,"progress":3}"#),
            queue_key("save", r#"{"mediaId":1,"status":"COMPLETED"}"#),
        );
    }

    /// Untouched fields, sent as explicit nulls, do not join the key.
    #[test]
    fn untouched_fields_do_not_join_the_key() {
        assert_eq!(
            queue_key("save", r#"{"mediaId":1,"progress":3}"#),
            queue_key("save", r#"{"mediaId":1,"progress":9,"status":null,"notes":null}"#),
        );
    }

    /// `scoreFormat` never splits two edits, since it is re-stamped at drain time anyway.
    #[test]
    fn the_score_format_never_splits_two_edits() {
        assert_eq!(
            queue_key("save", r#"{"mediaId":1,"scoreRaw":80}"#),
            queue_key("save", r#"{"mediaId":1,"scoreRaw":90,"scoreFormat":"POINT_5"}"#),
        );
    }

    #[test]
    fn entries_and_kinds_never_collide() {
        assert_ne!(
            queue_key("save", r#"{"mediaId":1,"progress":3}"#),
            queue_key("save", r#"{"mediaId":2,"progress":3}"#),
        );
        // A delete is keyed on the list-entry id, a save on the media id, and the two number spaces overlap freely.
        assert_ne!(
            queue_key("delete", r#"{"id":1}"#),
            queue_key("save", r#"{"mediaId":1}"#),
        );
    }

    /// A payload with no identifiable subject deduplicates against nothing rather than being guessed at.
    #[test]
    fn an_unrecognizable_payload_deduplicates_against_nothing() {
        assert_eq!(queue_key("save", r#"{"progress":3}"#), None);
        assert_eq!(queue_key("delete", "not json"), None);
        assert_eq!(queue_key("something-else", r#"{"mediaId":1}"#), None);
    }

    /// A whole-list selection becomes a handful of requests, not one per entry.
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

    /// A live entry is read from the page shape AniList returns for a completed entry.
    #[test]
    fn a_live_entry_is_read_from_the_page_shape() {
        let data = serde_json::json!({
            "Page": { "mediaList": [ { "progress": 25, "status": "COMPLETED" } ] }
        });
        assert_eq!(super::parse_live_entry(&data), Some((25, "COMPLETED".to_string())));
        // A null progress on a planning entry is zero, not a refusal.
        let planning = serde_json::json!({
            "Page": { "mediaList": [ { "progress": null, "status": "PLANNING" } ] }
        });
        assert_eq!(super::parse_live_entry(&planning), Some((0, "PLANNING".to_string())));
    }

    #[test]
    fn an_empty_page_means_not_on_the_list() {
        let data = serde_json::json!({ "Page": { "mediaList": [] } });
        assert_eq!(super::parse_live_entry(&data), None);
        assert_eq!(super::parse_live_entry(&serde_json::json!({})), None);
    }
}
