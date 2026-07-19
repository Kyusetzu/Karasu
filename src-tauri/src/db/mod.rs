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
}

