use crate::anilist::{
    auth,
    client::{AniList, ApiError},
};
use crate::db::Db;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

/// `advancedScores` is behind `@include`, not merely optional.
///
/// Measured on a real 638-entry list in this exact shape: the field adds
/// 51,040 JSON characters, +8.3% of the whole response and +26% of the entry
/// fields alone. `reqwest`'s gzip crushes a repetitive map on the wire, but
/// `cache_list` stores the blob uncompressed, so the disk cost is the full
/// figure. Most accounts have advanced scoring off — `advancedScoringEnabled`
/// is false even on ones AniList has seeded category names for — so the
/// default is to not ask for it at all.
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

/// The account's score format, from the cached viewer blob.
///
/// Every `score(format:)` selection in this file takes it as a variable, so
/// scores arrive in the scale the user actually chose — the display half of
/// the `scoreRaw` note on `SAVE_MUTATION`. Validated against the enum rather
/// than passed through: a corrupted blob must degrade to ten-point, not to a
/// GraphQL error on every list fetch.
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

/// Whether this media type has advanced scoring switched on, from the same
/// cached viewer blob `viewer_score_format` reads.
///
/// The flag is the signal, never the name list: AniList seeds
/// `advancedScoring` with five defaults on accounts that have the feature
/// *off*, so "there are category names" would turn it on for almost everyone.
/// Anything unexpected in the blob reads as off, which costs the field on the
/// list query and nothing else.
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

/// `startedAt`/`completedAt` are `FuzzyDateInput` — `{ year, month, day }`, each
/// nullable, because AniList lets a date be partial ("2024", "March 2024"). That
/// is why they are not plain dates on the frontend either.
///
/// **`$scoreRaw: Int`, never `$score: Float`.** The bare `score` argument is
/// interpreted in the *account's* scoreFormat, so a ten-point value written to
/// a 100-point account stored 8/100 — a silent corruption this app shipped for
/// months. `scoreRaw` is the format-independent 0–100 integer; the frontend
/// converts through `lib/scoreFormat.toRaw` before invoking, which also makes
/// the offline queue safe to replay across a format change.
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

/// One request for a whole selection, keyed on **list-entry** ids (not media
/// ids, unlike `SaveMediaListEntry`'s `mediaId`).
///
/// Verified against the live schema before wiring: the batch mutation is
/// `UpdateMediaListEntries(ids: [Int], …) -> [MediaList]`. It is *not* called
/// `SaveMediaListEntries`, which does not exist — the reason CLAUDE.md insists
/// on checking the schema rather than the shape one expects.
/// Widened past status/score after checking the live schema by introspection
/// rather than by running it — a mutation cannot be validated by executing it
/// against real data. `UpdateMediaListEntries` accepts `progress`,
/// `progressVolumes`, `repeat`, `private`, `startedAt` and `completedAt` too.
///
/// `notes` is deliberately **not** here even though the schema accepts it: tags
/// are serialized into the notes field, so setting it across a selection would
/// destroy every selected entry's tags. Appending instead would be a
/// read-modify-write per entry, which is the fan-out this mutation exists to
/// avoid — so bulk tag editing is a separate problem, not a missing argument.
const UPDATE_ENTRIES_MUTATION: &str = "
mutation ($ids: [Int], $status: MediaListStatus, $scoreRaw: Int, $progress: Int, $progressVolumes: Int, $repeat: Int, $private: Boolean, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput, $scoreFormat: ScoreFormat) {
  UpdateMediaListEntries(ids: $ids, status: $status, scoreRaw: $scoreRaw, progress: $progress, progressVolumes: $progressVolumes, repeat: $repeat, private: $private, startedAt: $startedAt, completedAt: $completedAt) {
    id mediaId status progress progressVolumes repeat notes updatedAt private
    startedAt { year month day }
    completedAt { year month day }
    score(format: $scoreFormat)
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
    app: AppHandle,
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
    //
    // This is also the drain that runs on every list mount, so it is where a
    // dropped edit is most likely to be noticed and reported.
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
    mut input: Value,
) -> Result<MutationResult, String> {
    // The echoed entry must come back in the account's display format, so the
    // format rides along as a variable. Injected here rather than by callers
    // because the scrobbler saves through this path too — and injected at
    // replay time as well, since a queued payload's format may have changed
    // between enqueue and drain.
    if let Some(vars) = input.as_object_mut() {
        vars.insert("scoreFormat".into(), json!(viewer_score_format(db)));
    }
    if db.queue_len() > 0 && process_queue(db, api, Some(token)).await.is_err() {
        queue_push_deduped(db, "save", &input.to_string())?;
        return Ok(MutationResult { queued: true, entry: None });
    }

    match api.query(Some(token), SAVE_MUTATION, input.clone()).await {
        // Queued rather than raised for anything that could work later. A 429
        // used to surface as a hard error here, which lost the edit outright:
        // it was never written and never queued either.
        Err(e) if e.is_retryable() => {
            queue_push_deduped(db, "save", &input.to_string())?;
            Ok(MutationResult { queued: true, entry: None })
        }
        Ok(data) => Ok(MutationResult {
            queued: false,
            entry: data.get("SaveMediaListEntry").cloned(),
        }),
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

/// What a bulk edit managed, and what stopped it if anything did.
///
/// Two fields rather than a `Result` because the two facts are independent: a
/// run can both write hundreds of entries and fail, and the caller needs the
/// number to decide whether rolling its optimistic update back would be a lie.
#[derive(serde::Serialize)]
pub struct BulkResult {
    pub updated: usize,
    /// The failure that ended the run. Whatever `updated` counts is already
    /// written to AniList and is not undone by it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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
    app: AppHandle,
    db: State<'_, Db>,
    api: State<'_, AniList>,
    ids: Vec<i64>,
    status: Option<String>,
    // The 0–100 raw score — see `SAVE_MUTATION`'s note on why never a float.
    score_raw: Option<i64>,
    progress: Option<i64>,
    // snake_case here, camelCase on the wire: Tauri maps the two, the same way
    // `save_image`'s `default_name` receives `defaultName`.
    progress_volumes: Option<i64>,
    repeat: Option<i64>,
    private: Option<bool>,
    // `FuzzyDateInput`, forwarded as an opaque `{year, month, day}` rather than
    // re-modelled here: every part is nullable and this layer only passes it on.
    started_at: Option<Value>,
    completed_at: Option<Value>,
) -> Result<BulkResult, String> {
    if ids.is_empty() {
        return Ok(BulkResult { updated: 0, error: None });
    }
    // Every field absent means the caller asked for nothing. Worth rejecting
    // rather than sending: AniList would happily accept the mutation, touch
    // every selected entry's `updatedAt`, and change nothing — which would
    // reorder a list sorted by "last updated" for no reason.
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

    // Anything already queued has to land first, or this write would be
    // overwritten by an older one replaying on top of it.
    if db.queue_len() > 0 {
        let drained = process_queue(&db, &api, Some(&token)).await?;
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
        // No offline queue for this one: the queue replays `SaveMediaListEntry`
        // per entry, so draining a bulk edit through it would reintroduce
        // exactly the fan-out this exists to avoid. Failing honestly lets the
        // caller roll back and say so.
        //
        // Stopping on the first failure, but reporting rather than discarding
        // what landed before it. A bare `?` here threw the count away, so a
        // selection of 500 that died on chunk 7 told the caller only "it
        // failed" — and the caller's rollback then put 300 already-written
        // entries back to their old values on screen while AniList held the
        // new ones.
        match api.query(Some(&token), UPDATE_ENTRIES_MUTATION, vars).await {
            Ok(data) => {
                updated += data
                    .pointer("/UpdateMediaListEntries")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
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
    db: State<'_, Db>,
    api: State<'_, AniList>,
    id: i64,
) -> Result<MutationResult, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    let input = json!({ "id": id });

    if db.queue_len() > 0 && process_queue(&db, &api, Some(&token)).await.is_err() {
        queue_push_deduped(&db, "delete", &input.to_string())?;
        return Ok(MutationResult { queued: true, entry: None });
    }

    match api.query(Some(&token), DELETE_MUTATION, input.clone()).await {
        Ok(_) => Ok(MutationResult { queued: false, entry: None }),
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
    // Absent means "leave it alone", exactly as it does for AniList — the
    // editor sends a date only once the user has touched one, and a `+1
    // progress` from a list row sends neither. Stored as the `FuzzyDate` object
    // the frontend already speaks; clearing a date arrives as that object with
    // every part null, which is a value rather than an absence.
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

/// A `FuzzyDate` argument as the JSON text the local list stores, or `None`
/// when the caller did not send one.
///
/// Null is folded into `None` on purpose: AniList treats an explicit null and
/// an absent variable the same way, and the frontend's `?? null` idiom means
/// both spellings reach here for "not touched".
fn fuzzy_date_text(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .filter(|v| v.is_object())
        .map(|v| v.to_string())
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

/// What a drain did. More than one number, because a dropped row is something
/// the user typed and will not get back.
pub(crate) struct Drained {
    pub flushed: usize,
    /// One message per queued edit AniList refused permanently.
    pub dropped: Vec<String>,
}

/// The identity a newly queued mutation supersedes.
///
/// A second offline edit to the same entry *touching the same fields* makes the
/// first one dead weight: replaying both spends two requests out of a ~30/min
/// budget to reach the state the second one already describes — and running
/// that budget down is what provokes the 429 the classification above now has
/// to survive.
///
/// The field set is half the key on purpose, and the *non-null* fields at that.
/// The frontend sends an explicit `null` for everything the user did not touch,
/// so keying on which keys are present would make every save on one entry look
/// alike and let a queued progress edit swallow an earlier status one, with no
/// error anywhere. `scoreFormat` is excluded because it is re-stamped at drain
/// time and says nothing about what changed.
///
/// `None` for a payload with no identifiable subject: it is left alone rather
/// than guessed at.
pub(crate) fn queue_key(kind: &str, payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let obj = value.as_object()?;
    let subject = match kind {
        "save" => obj.get("mediaId")?.as_i64()?,
        "delete" => obj.get("id")?.as_i64()?,
        _ => return None,
    };
    let mut fields: Vec<&str> = obj
        .iter()
        .filter(|(k, v)| k.as_str() != "scoreFormat" && !v.is_null())
        .map(|(k, _)| k.as_str())
        .collect();
    fields.sort_unstable();
    Some(format!("{kind}:{subject}:{}", fields.join(",")))
}

/// Queues a mutation, dropping any queued one it makes redundant.
fn queue_push_deduped(db: &Db, kind: &str, payload: &str) -> Result<(), String> {
    if let Some(key) = queue_key(kind, payload) {
        for (id, queued_kind, queued_payload) in db.queue_all() {
            if queue_key(&queued_kind, &queued_payload).as_deref() == Some(key.as_str()) {
                db.queue_remove(id);
            }
        }
    }
    db.queue_push(kind, payload)
}

/// Drains the offline queue in order.
///
/// Anything that could succeed later — offline, rate limited, an expired token,
/// AniList being down — aborts the drain and leaves the whole queue intact.
/// Only a payload AniList rejects on its own terms (validation, an entry that
/// no longer exists) is dropped, because replaying that one forever would wedge
/// every edit queued behind it.
///
/// That split is the entire point of this function, and it is newer than the
/// function is. It used to drop a row for *any* non-transport error while
/// `client.rs` classed an expired token and a surviving 429 as exactly that:
/// the pending badge fell to zero and the edits were gone, with no error and no
/// log line, because the `Ok(0)` it returned told the caller all was well.
async fn process_queue(
    db: &Db,
    api: &AniList,
    token: Option<&str>,
) -> Result<Drained, String> {
    let mut flushed = 0;
    let mut dropped = Vec::new();
    for (id, kind, payload) in db.queue_all() {
        let mut variables: Value =
            serde_json::from_str(&payload).unwrap_or_else(|_| json!({}));
        // Re-stamped at drain time: the format may have changed since the
        // payload was queued, and the echoed entry should come back in the
        // format the app is displaying *now*. The score itself is `scoreRaw`,
        // so the write is format-independent either way.
        //
        // `advancedScores` deliberately is *not* re-stamped, and cannot be: it
        // is a positional `[Float]` whose meaning comes from the account's
        // category order at the moment it was built. Renaming or reordering a
        // category on anilist.co between queueing and draining would move a
        // value into the wrong category — but re-keying it here would need the
        // names the payload was built against, which the payload does not
        // carry. The window is small (a queued edit drains on the next list
        // mount) and the alternative is guessing.
        if kind == "save" {
            if let Some(vars) = variables.as_object_mut() {
                vars.insert("scoreFormat".into(), json!(viewer_score_format(db)));
            }
        }
        let mutation = if kind == "delete" { DELETE_MUTATION } else { SAVE_MUTATION };
        match api.query(token, mutation, variables).await {
            Ok(_) => {
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
    Ok(Drained { flushed, dropped })
}

/// Tells the user when a queued edit was thrown away.
///
/// Otherwise a drop is silent by construction: the row is gone, the pending
/// badge falls to zero, and the list simply does not contain the change. The
/// bell is the right place for it because the window may well be in the tray
/// when a background drain runs.
fn report_dropped(app: &AppHandle, dropped: &[String]) {
    let Some(first) = dropped.first() else { return };
    let body = match dropped.len() {
        1 => crate::i18n::Msg::QueueBodyOne { reason: first },
        n => crate::i18n::Msg::QueueBodyMany { count: n, reason: first },
    };
    crate::alerts::notify::notify(app, "queue", crate::i18n::Msg::QueueTitle, body);
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
    use super::{bulk_chunks, queue_key, BULK_CHUNK};

    /// The case the dedupe exists for: bump progress five times offline and
    /// five identical mutations replay into a ~30/min budget to reach the
    /// state the last one already describes.
    #[test]
    fn repeated_edits_to_one_field_collapse() {
        let first = queue_key("save", r#"{"mediaId":1,"progress":3}"#);
        let then = queue_key("save", r#"{"mediaId":1,"progress":7}"#);
        assert_eq!(first, then);
        assert!(first.is_some());
    }

    /// The case it must *not* swallow. Both payloads name the same entry and
    /// carry one field each; collapsing them loses the progress edit, and
    /// nothing anywhere would report it.
    #[test]
    fn edits_to_different_fields_are_kept_apart() {
        assert_ne!(
            queue_key("save", r#"{"mediaId":1,"progress":3}"#),
            queue_key("save", r#"{"mediaId":1,"status":"COMPLETED"}"#),
        );
    }

    /// The frontend sends an explicit null for every field the user did not
    /// touch, so a key built from which *keys* are present would make the two
    /// payloads above identical. Only the non-null fields count.
    #[test]
    fn untouched_fields_do_not_join_the_key() {
        assert_eq!(
            queue_key("save", r#"{"mediaId":1,"progress":3}"#),
            queue_key("save", r#"{"mediaId":1,"progress":9,"status":null,"notes":null}"#),
        );
    }

    /// `scoreFormat` is re-stamped at drain time from the account's current
    /// setting, so it describes the app rather than the edit.
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
        // A delete is keyed on the list-entry id, a save on the media id, and
        // the two number spaces overlap freely.
        assert_ne!(
            queue_key("delete", r#"{"id":1}"#),
            queue_key("save", r#"{"mediaId":1}"#),
        );
    }

    /// A payload with no identifiable subject is left alone rather than
    /// guessed at — the fallback is the old behaviour, one row per edit.
    #[test]
    fn an_unrecognizable_payload_deduplicates_against_nothing() {
        assert_eq!(queue_key("save", r#"{"progress":3}"#), None);
        assert_eq!(queue_key("delete", "not json"), None);
        assert_eq!(queue_key("something-else", r#"{"mediaId":1}"#), None);
    }

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
