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
}
