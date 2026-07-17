use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// SQLite-Datenbank im App-Data-Verzeichnis: Key-Value-Settings,
/// Listen-Cache und (ab M3) die Offline-Update-Queue.
pub struct Db(pub Mutex<Connection>);

const MIGRATIONS: &str = "
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS list_cache (
    user_id    INTEGER NOT NULL,
    payload    TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (user_id)
);
CREATE TABLE IF NOT EXISTS offline_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
";

impl Db {
    pub fn open(data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("App-Datenordner nicht anlegbar: {e}"))?;
        let conn = Connection::open(data_dir.join("karasu.db"))
            .map_err(|e| format!("Datenbank nicht öffenbar: {e}"))?;
        conn.execute_batch(MIGRATIONS)
            .map_err(|e| format!("Migration fehlgeschlagen: {e}"))?;
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
        .map_err(|e| format!("Speichern fehlgeschlagen: {e}"))
    }

    pub fn kv_delete(&self, key: &str) {
        let conn = self.0.lock().unwrap();
        let _ = conn.execute("DELETE FROM kv WHERE key = ?1", [key]);
    }

    // --- Listen-Cache -----------------------------------------------------

    pub fn cache_list(&self, user_id: i64, payload: &str) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO list_cache (user_id, payload, fetched_at)
             VALUES (?1, ?2, strftime('%s','now'))
             ON CONFLICT(user_id) DO UPDATE
                SET payload = excluded.payload, fetched_at = excluded.fetched_at",
            rusqlite::params![user_id, payload],
        )
        .map(|_| ())
        .map_err(|e| format!("Cache-Schreiben fehlgeschlagen: {e}"))
    }

    pub fn cached_list(&self, user_id: i64) -> Option<String> {
        let conn = self.0.lock().unwrap();
        conn.query_row(
            "SELECT payload FROM list_cache WHERE user_id = ?1",
            [user_id],
            |r| r.get(0),
        )
        .ok()
    }

    /// Patcht Fortschritt/Status eines Eintrags direkt im Listen-Cache,
    /// damit die Erkennung nach einem Scrobble sofort den neuen Stand sieht.
    pub fn update_cached_progress(
        &self,
        user_id: i64,
        media_id: i64,
        progress: u32,
        status: Option<&str>,
    ) {
        let Some(payload) = self.cached_list(user_id) else {
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
        let _ = self.cache_list(user_id, &lists.to_string());
    }

    // --- Offline-Queue ------------------------------------------------------

    pub fn queue_push(&self, kind: &str, payload: &str) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO offline_queue (kind, payload, created_at)
             VALUES (?1, ?2, strftime('%s','now'))",
            [kind, payload],
        )
        .map(|_| ())
        .map_err(|e| format!("Queue-Schreiben fehlgeschlagen: {e}"))
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
