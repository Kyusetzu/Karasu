use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// SQLite database in the app data directory: key-value settings, the
/// list cache and the offline update queue.
pub struct Db(pub Mutex<Connection>);

const MIGRATIONS: &str = "
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS offline_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
";

/// Schema v2: list_cache per media type (ANIME/MANGA). Older caches are
/// dropped and repopulated on the next load.
const MIGRATION_V2: &str = "
DROP TABLE IF EXISTS list_cache;
CREATE TABLE list_cache (
    user_id    INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    payload    TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, media_type)
);
PRAGMA user_version = 2;
";

/// Schema v3: created a `history` table for a playback-history feature that
/// has since been removed. The table is kept (empty, unused) so databases
/// already migrated to v3 remain valid; do not rely on it.
const MIGRATION_V3: &str = "
CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id   INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    title      TEXT NOT NULL,
    episode    INTEGER NOT NULL,
    started_ms INTEGER NOT NULL,
    ended_ms   INTEGER NOT NULL,
    seconds    INTEGER NOT NULL
);
PRAGMA user_version = 3;
";

/// Schema v4: a fully local media list for account-free ("local-only") use.
/// `media_json` caches the AniList media metadata so the list renders
/// offline; `tags` is reserved (tags currently ride inside `notes`, matching
/// the AniList path, so the UI stays mode-agnostic).
const MIGRATION_V4: &str = "
CREATE TABLE IF NOT EXISTS local_list (
    media_id   INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    status     TEXT NOT NULL,
    progress   INTEGER NOT NULL DEFAULT 0,
    score      REAL NOT NULL DEFAULT 0,
    repeat     INTEGER NOT NULL DEFAULT 0,
    notes      TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '',
    updated_ms INTEGER NOT NULL,
    media_json TEXT,
    PRIMARY KEY (media_id, media_type)
);
PRAGMA user_version = 4;
";

/// Schema v5: an in-app notification centre. Every desktop toast (airing,
/// on-hold, sequel) is also recorded here so the user has one bundled place
/// to review them, with a read/unread state.
const MIGRATION_V5: &str = "
CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    read       INTEGER NOT NULL DEFAULT 0
);
PRAGMA user_version = 5;
";

/// Schema v6: the local library index. The scan used to live only in memory,
/// so every restart dropped it and the play buttons vanished until the user
/// rescanned by hand. Persisting it means the index survives a restart; stale
/// paths are caught at play time instead.
const MIGRATION_V6: &str = "
CREATE TABLE IF NOT EXISTS library_files (
    media_id INTEGER NOT NULL,
    episode  INTEGER NOT NULL,
    path     TEXT NOT NULL,
    PRIMARY KEY (media_id, episode)
);
PRAGMA user_version = 6;
";

/// Schema v7: volumes read, for the local list.
///
/// AniList tracks manga on two axes and always has (`progressVolumes`); the
/// local list only ever stored chapters, so a volume edit made without an
/// account was silently dropped. Added rather than backfilled — there is no
/// way to infer volumes from chapters, and guessing would be worse than zero.
const MIGRATION_V7: &str = "
ALTER TABLE local_list ADD COLUMN progress_volumes INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 7;
";

/// One in-app notification (mirrors a shown desktop toast).
#[derive(Debug, Clone, serde::Serialize)]
pub struct NotificationRow {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub body: String,
    #[serde(rename = "createdMs")]
    pub created_ms: i64,
    pub read: bool,
}

/// Statuses emitted as list groups in local mode. Emitting all of them
/// (even when empty) mirrors the AniList response shape so the shared
/// optimistic-cache logic finds a target group on every status change.
const LOCAL_STATUSES: [&str; 6] = [
    "CURRENT",
    "PLANNING",
    "COMPLETED",
    "DROPPED",
    "PAUSED",
    "REPEATING",
];

/// One row of the local list (used for the merge into AniList).
#[derive(Debug, Clone)]
pub struct LocalRow {
    pub media_id: i64,
    pub media_type: String,
    pub status: String,
    pub progress: i64,
    pub progress_volumes: i64,
    pub score: f64,
    pub repeat: i64,
    pub notes: String,
    pub updated_ms: i64,
    pub media_json: Option<String>,
}

impl Db {
    pub fn open(data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Could not create app data folder: {e}"))?;
        let conn = Connection::open(data_dir.join("karasu.db"))
            .map_err(|e| format!("Could not open database: {e}"))?;
        conn.execute_batch(MIGRATIONS)
            .map_err(|e| format!("Migration failed: {e}"))?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap_or(0);
        if version < 2 {
            conn.execute_batch(MIGRATION_V2)
                .map_err(|e| format!("Migration v2 failed: {e}"))?;
        }
        if version < 3 {
            conn.execute_batch(MIGRATION_V3)
                .map_err(|e| format!("Migration v3 failed: {e}"))?;
        }
        if version < 4 {
            conn.execute_batch(MIGRATION_V4)
                .map_err(|e| format!("Migration v4 failed: {e}"))?;
        }
        if version < 5 {
            conn.execute_batch(MIGRATION_V5)
                .map_err(|e| format!("Migration v5 failed: {e}"))?;
        }
        if version < 6 {
            conn.execute_batch(MIGRATION_V6)
                .map_err(|e| format!("Migration v6 failed: {e}"))?;
        }
        if version < 7 {
            conn.execute_batch(MIGRATION_V7)
                .map_err(|e| format!("Migration v7 failed: {e}"))?;
        }
        Ok(Db(Mutex::new(conn)))
    }

    pub fn kv_get(&self, key: &str) -> Option<String> {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .ok()
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )
        .map(|_| ())
        .map_err(|e| format!("Save failed: {e}"))
    }

    pub fn kv_delete(&self, key: &str) {
        let conn = self.0.lock().unwrap();
        let _ = conn.execute("DELETE FROM kv WHERE key = ?1", [key]);
    }

    // --- List cache ---------------------------------------------------------

    pub fn cache_list(
        &self,
        user_id: i64,
        media_type: &str,
        payload: &str,
    ) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO list_cache (user_id, media_type, payload, fetched_at)
             VALUES (?1, ?2, ?3, strftime('%s','now'))
             ON CONFLICT(user_id, media_type) DO UPDATE
                SET payload = excluded.payload, fetched_at = excluded.fetched_at",
            rusqlite::params![user_id, media_type, payload],
        )
        .map(|_| ())
        .map_err(|e| format!("Cache write failed: {e}"))
    }

    pub fn cached_list(&self, user_id: i64, media_type: &str) -> Option<String> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT payload FROM list_cache WHERE user_id = ?1 AND media_type = ?2",
            rusqlite::params![user_id, media_type],
            |r| r.get(0),
        )
        .ok()
    }

    /// Patches an entry's progress/status directly in the list cache so
    /// that detection sees the new state right after a scrobble.
    pub fn update_cached_progress(
        &self,
        user_id: i64,
        media_type: &str,
        media_id: i64,
        progress: u32,
        status: Option<&str>,
    ) {
        let Some(payload) = self.cached_list(user_id, media_type) else {
            return;
        };
        let Ok(mut lists) = serde_json::from_str::<serde_json::Value>(&payload) else {
            return;
        };
        for group in lists.as_array_mut().into_iter().flatten() {
            for entry in group
                .get_mut("entries")
                .and_then(|v| v.as_array_mut())
                .into_iter()
                .flatten()
            {
                if entry.get("mediaId").and_then(|v| v.as_i64()) == Some(media_id) {
                    entry["progress"] = progress.into();
                    if let Some(s) = status {
                        entry["status"] = s.into();
                    }
                }
            }
        }
        let _ = self.cache_list(user_id, media_type, &lists.to_string());
    }

    // --- Offline queue ------------------------------------------------------

    pub fn queue_push(&self, kind: &str, payload: &str) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO offline_queue (kind, payload, created_at)
             VALUES (?1, ?2, strftime('%s','now'))",
            [kind, payload],
        )
        .map(|_| ())
        .map_err(|e| format!("Queue write failed: {e}"))
    }

    pub fn queue_all(&self) -> Vec<(i64, String, String)> {
        let conn = self.0.lock().unwrap();
        let mut stmt = match conn
            .prepare("SELECT id, kind, payload FROM offline_queue ORDER BY id")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default()
    }

    pub fn queue_remove(&self, id: i64) {
        let conn = self.0.lock().unwrap();
        let _ = conn.execute("DELETE FROM offline_queue WHERE id = ?1", [id]);
    }

    pub fn queue_len(&self) -> usize {
        let conn = self.0.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM offline_queue", [], |r| {
            r.get::<_, i64>(0)
        })
        .map(|n| n as usize)
        .unwrap_or(0)
    }

    // --- Local-only list ----------------------------------------------------

    /// Insert or update a local entry. `media_json` is kept from the existing
    /// row when `None`, so field-only edits (progress/status) don't need to
    /// re-supply the media metadata.
    #[allow(clippy::too_many_arguments)]
    pub fn local_upsert(
        &self,
        media_id: i64,
        media_type: &str,
        status: &str,
        progress: i64,
        progress_volumes: i64,
        score: f64,
        repeat: i64,
        notes: &str,
        media_json: Option<&str>,
        updated_ms: i64,
    ) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO local_list
                (media_id, media_type, status, progress, progress_volumes, score, repeat, notes, tags, updated_ms, media_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '', ?9, ?10)
             ON CONFLICT(media_id, media_type) DO UPDATE SET
                status = excluded.status,
                progress = excluded.progress,
                progress_volumes = excluded.progress_volumes,
                score = excluded.score,
                repeat = excluded.repeat,
                notes = excluded.notes,
                updated_ms = excluded.updated_ms,
                media_json = COALESCE(excluded.media_json, local_list.media_json)",
            rusqlite::params![
                media_id, media_type, status, progress, progress_volumes, score,
                repeat, notes, updated_ms, media_json
            ],
        )
        .map(|_| ())
        .map_err(|e| format!("Local save failed: {e}"))
    }

    /// Media type of an existing local row (media ids are globally unique on
    /// AniList, so the id alone identifies the row).
    pub fn local_find_type(&self, media_id: i64) -> Option<String> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT media_type FROM local_list WHERE media_id = ?1",
            [media_id],
            |r| r.get(0),
        )
        .ok()
    }

    pub fn local_delete(&self, media_id: i64, media_type: &str) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "DELETE FROM local_list WHERE media_id = ?1 AND media_type = ?2",
            rusqlite::params![media_id, media_type],
        )
        .map(|_| ())
        .map_err(|e| format!("Local delete failed: {e}"))
    }

    fn local_rows(&self, media_type: Option<&str>) -> Vec<LocalRow> {
        let conn = self.0.lock().unwrap();
        // Column order here is load-bearing: `map` reads by index, and
        // `collect` below drops rows whose mapping errors. A mismatch does not
        // fail loudly — it silently returns an empty list.
        let sql = "SELECT media_id, media_type, status, progress, progress_volumes, \
                   score, repeat, notes, updated_ms, media_json FROM local_list";
        let map = |r: &rusqlite::Row| {
            Ok(LocalRow {
                media_id: r.get(0)?,
                media_type: r.get(1)?,
                status: r.get(2)?,
                progress: r.get(3)?,
                progress_volumes: r.get(4)?,
                score: r.get(5)?,
                repeat: r.get(6)?,
                notes: r.get(7)?,
                updated_ms: r.get(8)?,
                media_json: r.get(9)?,
            })
        };
        let collect = |mut stmt: rusqlite::Statement, params: &[&dyn rusqlite::ToSql]| {
            stmt.query_map(params, map)
                .map(|rows| rows.filter_map(Result::ok).collect::<Vec<_>>())
                .unwrap_or_default()
        };
        match media_type {
            Some(mt) => {
                let stmt = match conn.prepare(&format!("{sql} WHERE media_type = ?1")) {
                    Ok(s) => s,
                    Err(_) => return Vec::new(),
                };
                collect(stmt, &[&mt])
            }
            None => {
                let stmt = match conn.prepare(sql) {
                    Ok(s) => s,
                    Err(_) => return Vec::new(),
                };
                collect(stmt, &[])
            }
        }
    }

    /// Every local row across both media types (for the sign-in merge).
    pub fn local_all(&self) -> Vec<LocalRow> {
        self.local_rows(None)
    }

    /// The local list for one media type as an AniList-shaped `lists` array
    /// (JSON string), so the frontend `ListResult` is identical to online.
    pub fn local_list_json(&self, media_type: &str) -> String {
        use serde_json::{json, Value};
        let mut buckets: std::collections::HashMap<&str, Vec<Value>> =
            LOCAL_STATUSES.iter().map(|s| (*s, Vec::new())).collect();
        for row in self.local_rows(Some(media_type)) {
            let media: Value = row
                .media_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(Value::Null);
            let entry = json!({
                "id": row.media_id,
                "mediaId": row.media_id,
                "status": row.status,
                "score": row.score,
                "progress": row.progress,
                "progressVolumes": row.progress_volumes,
                "repeat": row.repeat,
                "notes": row.notes,
                "updatedAt": row.updated_ms / 1000,
                "media": media,
            });
            buckets
                .entry(
                    LOCAL_STATUSES
                        .iter()
                        .find(|s| **s == row.status)
                        .copied()
                        .unwrap_or("CURRENT"),
                )
                .or_default()
                .push(entry);
        }
        let groups: Vec<Value> = LOCAL_STATUSES
            .iter()
            .map(|s| {
                json!({
                    "name": s,
                    "status": s,
                    "isCustomList": false,
                    "entries": buckets.remove(s).unwrap_or_default(),
                })
            })
            .collect();
        serde_json::to_string(&groups).unwrap_or_else(|_| "[]".into())
    }

    // --- Notification centre ------------------------------------------------

    pub fn notif_insert(
        &self,
        kind: &str,
        title: &str,
        body: &str,
        created_ms: i64,
    ) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO notifications (kind, title, body, created_ms)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![kind, title, body, created_ms],
        )
        .map(|_| ())
        .map_err(|e| format!("Notification write failed: {e}"))
    }

    /// Most recent notifications first, capped at `limit`.
    pub fn notif_all(&self, limit: i64) -> Vec<NotificationRow> {
        let conn = self.0.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT id, kind, title, body, created_ms, read
             FROM notifications ORDER BY id DESC LIMIT ?1",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map([limit], |r| {
            Ok(NotificationRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                title: r.get(2)?,
                body: r.get(3)?,
                created_ms: r.get(4)?,
                read: r.get::<_, i64>(5)? != 0,
            })
        })
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
    }

    pub fn notif_mark_read(&self, id: i64) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute("UPDATE notifications SET read = 1 WHERE id = ?1", [id])
            .map(|_| ())
            .map_err(|e| format!("Notification update failed: {e}"))
    }

    pub fn notif_mark_all_read(&self) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute("UPDATE notifications SET read = 1 WHERE read = 0", [])
            .map(|_| ())
            .map_err(|e| format!("Notification update failed: {e}"))
    }

    pub fn notif_unread_count(&self) -> i64 {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM notifications WHERE read = 0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }

    // --- Local library ------------------------------------------------------

    /// Replaces the whole library index in one transaction — a scan always
    /// produces the complete picture, so a diff would only add failure modes.
    pub fn library_replace_all(&self, rows: &[(i64, u32, String)]) -> Result<(), String> {
        let mut conn = self.0.lock().unwrap();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Library write failed: {e}"))?;
        tx.execute("DELETE FROM library_files", [])
            .map_err(|e| format!("Library write failed: {e}"))?;
        {
            let mut stmt = tx
                .prepare("INSERT INTO library_files (media_id, episode, path) VALUES (?1, ?2, ?3)")
                .map_err(|e| format!("Library write failed: {e}"))?;
            for (media_id, episode, path) in rows {
                stmt.execute(rusqlite::params![media_id, episode, path])
                    .map_err(|e| format!("Library write failed: {e}"))?;
            }
        }
        tx.commit()
            .map_err(|e| format!("Library write failed: {e}"))
    }

    pub fn library_all(&self) -> Vec<(i64, u32, String)> {
        let conn = self.0.lock().unwrap();
        conn.prepare("SELECT media_id, episode, path FROM library_files")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn mem_db() -> Db {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        conn.execute_batch(MIGRATION_V3).unwrap();
        conn.execute_batch(MIGRATION_V4).unwrap();
        conn.execute_batch(MIGRATION_V5).unwrap();
        conn.execute_batch(MIGRATION_V6).unwrap();
        conn.execute_batch(MIGRATION_V7).unwrap();
        Db(Mutex::new(conn))
    }

    /// The index must survive a write/read round-trip, and a rescan must
    /// replace the previous contents rather than accumulate them.
    /// The list cache is what `cached_media_list` serves on a cold start, so a
    /// miss has to be distinguishable from a cached empty list — the caller
    /// falls back to a loading state on `None` and paints on `Some`.
    #[test]
    fn list_cache_round_trip_and_miss() {
        let db = mem_db();
        assert!(db.cached_list(7, "ANIME").is_none());

        db.cache_list(7, "ANIME", "[{\"entries\":[]}]").unwrap();
        assert_eq!(
            db.cached_list(7, "ANIME").as_deref(),
            Some("[{\"entries\":[]}]")
        );

        // Scoped per user *and* per media type: priming one must not serve the
        // other, or the manga list would render the anime one.
        assert!(db.cached_list(7, "MANGA").is_none());
        assert!(db.cached_list(8, "ANIME").is_none());

        // A second write replaces rather than accumulating rows.
        db.cache_list(7, "ANIME", "[]").unwrap();
        assert_eq!(db.cached_list(7, "ANIME").as_deref(), Some("[]"));
    }

    #[test]
    fn library_round_trip_and_replace() {
        let db = mem_db();
        assert!(db.library_all().is_empty());

        db.library_replace_all(&[
            (154587, 13, "C:/anime/frieren-13.mkv".into()),
            (154587, 14, "C:/anime/frieren-14.mkv".into()),
        ])
        .unwrap();
        let mut rows = db.library_all();
        rows.sort_by_key(|(_, ep, _)| *ep);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], (154587, 13, "C:/anime/frieren-13.mkv".into()));

        db.library_replace_all(&[(1, 1, "C:/anime/other-01.mkv".into())])
            .unwrap();
        let rows = db.library_all();
        assert_eq!(rows, vec![(1, 1, "C:/anime/other-01.mkv".to_string())]);
    }

    /// Schema v7. Volumes are a second axis, not a derived one: a manga read
    /// by volume and a manga read by chapter are different states, and the
    /// local list dropped the volume half entirely before this.
    #[test]
    fn local_list_round_trips_volumes() {
        let db = mem_db();
        db.local_upsert(7, "MANGA", "CURRENT", 120, 12, 0.0, 0, "", Some("{}"), 1_000)
            .unwrap();

        let lists: Value =
            serde_json::from_str(&db.local_list_json("MANGA")).unwrap();
        let entry = lists
            .as_array()
            .unwrap()
            .iter()
            .find(|g| g["status"] == "CURRENT")
            .unwrap()["entries"][0]
            .clone();
        assert_eq!(entry["progress"], 120);
        assert_eq!(entry["progressVolumes"], 12);

        // A chapter-only edit must not silently reset the volume count.
        db.local_upsert(7, "MANGA", "CURRENT", 121, 12, 0.0, 0, "", None, 2_000)
            .unwrap();
        let row = db.local_all().into_iter().find(|r| r.media_id == 7).unwrap();
        assert_eq!(row.progress, 121);
        assert_eq!(row.progress_volumes, 12);
    }

    /// The migration runs on a database that already has rows. `ALTER TABLE
    /// ... DEFAULT 0` has to leave them readable rather than erroring or
    /// yielding NULL, which `local_rows` would drop on the floor.
    #[test]
    fn migration_v7_backfills_existing_rows_with_zero() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        conn.execute_batch(MIGRATION_V3).unwrap();
        conn.execute_batch(MIGRATION_V4).unwrap();
        conn.execute_batch(MIGRATION_V5).unwrap();
        conn.execute_batch(MIGRATION_V6).unwrap();
        conn.execute(
            "INSERT INTO local_list
                (media_id, media_type, status, progress, score, repeat, notes, tags, updated_ms)
             VALUES (3, 'MANGA', 'CURRENT', 40, 0, 0, '', '', 1)",
            [],
        )
        .unwrap();

        conn.execute_batch(MIGRATION_V7).unwrap();

        let db = Db(Mutex::new(conn));
        let row = db.local_all().into_iter().find(|r| r.media_id == 3).unwrap();
        assert_eq!(row.progress, 40);
        assert_eq!(row.progress_volumes, 0);
        let version: i64 = db
            .0
            .lock()
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 7);
    }

    #[test]
    fn local_upsert_and_render() {
        let db = mem_db();
        db.local_upsert(
            5, "ANIME", "CURRENT", 3, 0, 8.0, 1, "note",
            Some(r#"{"id":5,"title":{"romaji":"X"}}"#), 2_000,
        )
        .unwrap();
        let lists: Value =
            serde_json::from_str(&db.local_list_json("ANIME")).unwrap();
        let current = lists
            .as_array()
            .unwrap()
            .iter()
            .find(|g| g["status"] == "CURRENT")
            .unwrap();
        let entries = current["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["mediaId"], 5);
        assert_eq!(entries[0]["progress"], 3);
        assert_eq!(entries[0]["updatedAt"], 2); // ms -> s
        assert_eq!(entries[0]["media"]["title"]["romaji"], "X");
        // All six groups are present so status moves always find a target.
        assert_eq!(lists.as_array().unwrap().len(), 6);
    }

    #[test]
    fn local_upsert_keeps_media_json_on_field_edit() {
        let db = mem_db();
        db.local_upsert(1, "MANGA", "PLANNING", 0, 0, 0.0, 0, "", Some("{\"id\":1}"), 1_000)
            .unwrap();
        // Edit without re-supplying media metadata.
        db.local_upsert(1, "MANGA", "CURRENT", 2, 1, 0.0, 0, "", None, 3_000)
            .unwrap();
        let rows = db.local_all();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "CURRENT");
        assert_eq!(rows[0].media_json.as_deref(), Some("{\"id\":1}"));
    }

    #[test]
    fn local_delete_removes_row() {
        let db = mem_db();
        db.local_upsert(9, "ANIME", "COMPLETED", 12, 0, 10.0, 0, "", Some("{}"), 1)
            .unwrap();
        db.local_delete(9, "ANIME").unwrap();
        assert!(db.local_all().is_empty());
    }

    #[test]
    fn notifications_insert_list_and_read() {
        let db = mem_db();
        db.notif_insert("airing", "New episode", "Ep 5 is out", 1_000).unwrap();
        db.notif_insert("sequel", "Sequel announced", "A sequel", 2_000).unwrap();

        let all = db.notif_all(50);
        assert_eq!(all.len(), 2);
        // Newest first.
        assert_eq!(all[0].kind, "sequel");
        assert_eq!(db.notif_unread_count(), 2);

        db.notif_mark_read(all[0].id).unwrap();
        assert_eq!(db.notif_unread_count(), 1);

        db.notif_mark_all_read().unwrap();
        assert_eq!(db.notif_unread_count(), 0);
        assert!(db.notif_all(50).iter().all(|n| n.read));
    }

    #[test]
    fn notif_all_respects_limit() {
        let db = mem_db();
        for i in 0..5 {
            db.notif_insert("airing", "t", "b", i).unwrap();
        }
        assert_eq!(db.notif_all(3).len(), 3);
    }
}

