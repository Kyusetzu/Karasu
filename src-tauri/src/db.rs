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

/// How confident the scanner was about each matched title.
///
/// Its own table rather than a column on `library_files`: the score belongs to
/// the *title*, and a column there would repeat it down every episode row and
/// invite the two copies to disagree.
const MIGRATION_V8: &str = "
CREATE TABLE IF NOT EXISTS library_match (
  media_id INTEGER PRIMARY KEY,
  score REAL NOT NULL
);
PRAGMA user_version = 8;
";

/// Manual match corrections, and the two things they need to be possible.
///
/// All three key on the `(title, season)` pair the parser extracts from a
/// release name — the same pair `index_files` already memoises its matcher
/// lookups on. Keying on anything else (a path, a media id) would not survive
/// the next scan, and surviving the next scan is the entire point: the user is
/// correcting the *parse*, not this one row.
///
/// `season` is `-1` rather than NULL where the release name carried none.
/// SQLite permits NULLs in a PRIMARY KEY and treats each one as distinct, so a
/// nullable column here would let the same seasonless title be overridden
/// twice and neither row would win.
///
/// - `library_override` is user data. A scan must never clear it.
/// - `library_unmatched` is what the scan could *not* place, kept so the
///   \"unplaced\" list is still there after a restart rather than only until one.
///
/// There is deliberately no table recording which parsed title produced each
/// matched row. `hydrate` recovers that by re-parsing the stored filenames, and
/// a stored copy could only ever drift away from what the parser says today.
const MIGRATION_V9: &str = "
CREATE TABLE IF NOT EXISTS library_override (
  title TEXT NOT NULL,
  season INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  PRIMARY KEY (title, season)
);
CREATE TABLE IF NOT EXISTS library_unmatched (
  title TEXT NOT NULL,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (title, season, episode)
);
PRAGMA user_version = 9;
";

/// What AniList thinks an unplaceable title is, pending the user's agreement.
///
/// The local matcher can only ever search the cached list, so a show that was
/// never added is outside its universe entirely — no filename is clean enough
/// to be found. A scan now asks AniList about the leftovers, but a search hit
/// is a weaker thing than a match against a known list: searching "Pokemon"
/// returns *something* whether or not it is the right something. So these are
/// stored as suggestions and applied only when confirmed, at which point they
/// become an ordinary `library_override` row and this table stops mattering.
const MIGRATION_V10: &str = "
CREATE TABLE IF NOT EXISTS library_suggestion (
  title TEXT NOT NULL,
  season INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (title, season)
);
PRAGMA user_version = 10;
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

/// Notifications retained. The bell reads the newest 100, so this is scrollback
/// headroom rather than a display limit — it exists only so the table cannot
/// grow without bound.
const NOTIF_KEEP: i64 = 500;

/// Applies one migration step atomically.
///
/// The wrapping transaction is the whole point. `execute_batch` otherwise runs
/// in autocommit, so each statement lands on its own and a crash between a
/// schema change and the `PRAGMA user_version` that records it left a database
/// that had been migrated but was still labelled with the old version — and the
/// next launch would try to migrate it again. SQLite's DDL and `user_version`
/// are both transactional, so either the whole step lands or none of it does.
fn apply(conn: &Connection, version: u32, sql: &str) -> Result<(), String> {
    conn.execute_batch(&format!("BEGIN;\n{sql}\nCOMMIT;"))
        .map_err(|e| format!("Migration v{version} failed: {e}"))
}

/// Whether a table already has a column, asked of SQLite rather than assumed.
fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, column],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .unwrap_or(false)
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
            apply(&conn, 2, MIGRATION_V2)?;
        }
        if version < 3 {
            apply(&conn, 3, MIGRATION_V3)?;
        }
        if version < 4 {
            apply(&conn, 4, MIGRATION_V4)?;
        }
        if version < 5 {
            apply(&conn, 5, MIGRATION_V5)?;
        }
        if version < 6 {
            apply(&conn, 6, MIGRATION_V6)?;
        }
        if version < 7 {
            // The one migration that cannot simply be re-run: every other step
            // is `CREATE TABLE IF NOT EXISTS`, but `ALTER TABLE ADD COLUMN`
            // fails outright if the column is there. A database interrupted
            // between that ALTER and its version bump — possible on any build
            // before `apply` made the pair atomic — would otherwise fail to
            // open on every launch from then on, with no way back short of
            // deleting it. Recovering costs one query.
            if has_column(&conn, "local_list", "progress_volumes") {
                apply(&conn, 7, "PRAGMA user_version = 7;")?;
            } else {
                apply(&conn, 7, MIGRATION_V7)?;
            }
        }
        if version < 8 {
            apply(&conn, 8, MIGRATION_V8)?;
        }
        if version < 9 {
            apply(&conn, 9, MIGRATION_V9)?;
        }
        if version < 10 {
            apply(&conn, 10, MIGRATION_V10)?;
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

    /// Drops `prefix`-keyed rows whose value is an epoch-seconds stamp older
    /// than `cutoff`. Returns how many went.
    ///
    /// `substr` rather than `LIKE prefix || '%'` because `_` is a LIKE
    /// wildcard, and several of these prefixes contain one.
    ///
    /// Rows written before the value carried a stamp hold `"1"`, which casts to
    /// 1 and is therefore always older than the cutoff. That is correct: they
    /// are by definition from an earlier run.
    pub fn kv_prune_older(&self, prefix: &str, cutoff: i64) -> usize {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "DELETE FROM kv
             WHERE substr(key, 1, length(?1)) = ?1
               AND CAST(value AS INTEGER) < ?2",
            rusqlite::params![prefix, cutoff],
        )
        .unwrap_or(0)
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

    /// Writes a consistent copy of the database to `dest`, which must not
    /// exist yet.
    ///
    /// `std::fs::copy` is not a substitute. The connection runs in SQLite's
    /// default rollback-journal mode, where a database mid-transaction is only
    /// consistent read together with its `-journal` sidecar — and the alert
    /// passes, the scrobbler and a library scan all write from background
    /// threads at any moment. Copying the main file alone can capture pages
    /// whose originals still live in a journal that was never copied.
    /// `VACUUM INTO` asks SQLite for the snapshot instead, and taking the same
    /// mutex every other writer takes keeps it from racing them.
    pub fn snapshot_to(&self, dest: &std::path::Path) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute("VACUUM INTO ?1", rusqlite::params![dest.to_string_lossy()])
            .map(|_| ())
            .map_err(|e| format!("Could not copy the database: {e}"))
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
        .map_err(|e| format!("Notification write failed: {e}"))?;

        // The table was insert-only, so a long-lived install accumulated every
        // notification it had ever shown — thousands a year, of which nothing
        // can read past the newest hundred. Trimming on write keeps the bound
        // without a separate pass to forget to run. Well above the read limit,
        // so scrolling back is unaffected.
        let _ = conn.execute(
            "DELETE FROM notifications WHERE id NOT IN
                 (SELECT id FROM notifications ORDER BY created_ms DESC, id DESC LIMIT ?1)",
            rusqlite::params![NOTIF_KEEP],
        );
        Ok(())
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
    ///
    /// `scores` goes in the same transaction for the same reason: an index that
    /// survived a crash without its confidences would show every title as an
    /// exact match, which is the one thing the column exists to deny.
    pub fn library_replace_all(
        &self,
        rows: &[(i64, u32, String)],
        scores: &[(i64, f64)],
    ) -> Result<(), String> {
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
        tx.execute("DELETE FROM library_match", [])
            .map_err(|e| format!("Library write failed: {e}"))?;
        {
            let mut stmt = tx
                .prepare("INSERT INTO library_match (media_id, score) VALUES (?1, ?2)")
                .map_err(|e| format!("Library write failed: {e}"))?;
            for (media_id, score) in scores {
                stmt.execute(rusqlite::params![media_id, score])
                    .map_err(|e| format!("Library write failed: {e}"))?;
            }
        }
        tx.commit()
            .map_err(|e| format!("Library write failed: {e}"))
    }

    /// Match confidence per media, for the rows the library screen draws.
    pub fn library_scores(&self) -> Vec<(i64, f64)> {
        let conn = self.0.lock().unwrap();
        conn.prepare("SELECT media_id, score FROM library_match")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                    .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .unwrap_or_default()
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

    // --- Manual match corrections -------------------------------------------

    /// Every user-set `(title, season) -> media_id` correction.
    pub fn library_overrides(&self) -> Vec<(String, i32, i64)> {
        let conn = self.0.lock().unwrap();
        conn.prepare("SELECT title, season, media_id FROM library_override")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .unwrap_or_default()
    }

    /// Records a correction. Upsert rather than insert: pointing the same
    /// release name somewhere new is a correction of the correction, not a
    /// second opinion to be kept alongside the first.
    pub fn library_override_set(
        &self,
        title: &str,
        season: i32,
        media_id: i64,
    ) -> Result<(), String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO library_override (title, season, media_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(title, season) DO UPDATE SET media_id = excluded.media_id",
            rusqlite::params![title, season, media_id],
        )
        .map(|_| ())
        .map_err(|e| format!("Could not save the correction: {e}"))
    }

    /// Forgets a correction, letting the matcher have its guess back.
    ///
    /// Returns how many rows that was. Discarding the count made "there was no
    /// correction here" indistinguishable from "removed it", and the caller
    /// needs to tell those apart to avoid reporting success for a no-op.
    pub fn library_override_clear(&self, title: &str, season: i32) -> Result<usize, String> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "DELETE FROM library_override WHERE title = ?1 AND season = ?2",
            rusqlite::params![title, season],
        )
        .map_err(|e| format!("Could not clear the correction: {e}"))
    }

    /// Files the scan could not place, grouped by the title it parsed out.
    pub fn library_unmatched(&self) -> Vec<(String, i32, u32, String)> {
        let conn = self.0.lock().unwrap();
        conn.prepare("SELECT title, season, episode, path FROM library_unmatched")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })
                .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .unwrap_or_default()
    }

    /// AniList's guess at each unplaceable title, with its score.
    pub fn library_suggestions(&self) -> Vec<(String, i32, i64, f64)> {
        let conn = self.0.lock().unwrap();
        conn.prepare("SELECT title, season, media_id, score FROM library_suggestion")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                    .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .unwrap_or_default()
    }

    /// Replaces the suggestions in one transaction. Scan output, like the
    /// unplaced files — and like them, `library_override` is left alone: a
    /// confirmed correction outranks anything a later search comes up with.
    pub fn library_replace_suggestions(
        &self,
        rows: &[(String, i32, i64, f64)],
    ) -> Result<(), String> {
        let mut conn = self.0.lock().unwrap();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Library write failed: {e}"))?;
        tx.execute("DELETE FROM library_suggestion", [])
            .map_err(|e| format!("Library write failed: {e}"))?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO library_suggestion (title, season, media_id, score)
                     VALUES (?1, ?2, ?3, ?4)",
                )
                .map_err(|e| format!("Library write failed: {e}"))?;
            for (title, season, media_id, score) in rows {
                stmt.execute(rusqlite::params![title, season, media_id, score])
                    .map_err(|e| format!("Library write failed: {e}"))?;
            }
        }
        tx.commit()
            .map_err(|e| format!("Library write failed: {e}"))
    }

    /// Replaces the unplaced files in one transaction.
    ///
    /// `library_override` is deliberately untouched: it is the user's, not the
    /// scan's, and wiping it here would undo every correction on the next scan
    /// — which is precisely the failure the whole design exists to avoid.
    pub fn library_replace_unmatched(
        &self,
        unmatched: &[(String, i32, u32, String)],
    ) -> Result<(), String> {
        let mut conn = self.0.lock().unwrap();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Library write failed: {e}"))?;
        tx.execute("DELETE FROM library_unmatched", [])
            .map_err(|e| format!("Library write failed: {e}"))?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT OR REPLACE INTO library_unmatched (title, season, episode, path)
                     VALUES (?1, ?2, ?3, ?4)",
                )
                .map_err(|e| format!("Library write failed: {e}"))?;
            for (title, season, episode, path) in unmatched {
                stmt.execute(rusqlite::params![title, season, episode, path])
                    .map_err(|e| format!("Library write failed: {e}"))?;
            }
        }
        tx.commit()
            .map_err(|e| format!("Library write failed: {e}"))
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
        conn.execute_batch(MIGRATION_V8).unwrap();
        conn.execute_batch(MIGRATION_V9).unwrap();
        conn.execute_batch(MIGRATION_V10).unwrap();
        Db(Mutex::new(conn))
    }

    /// A suggestion is the scan's opinion and a correction is the user's, so a
    /// rescan may replace all of the former and none of the latter.
    #[test]
    fn a_rescan_replaces_suggestions_but_never_corrections() {
        let db = mem_db();
        db.library_override_set("hunter x hunter", -1, 136).unwrap();
        db.library_replace_suggestions(&[("digimon".into(), 1, 552, 0.91)])
            .unwrap();
        assert_eq!(db.library_suggestions(), vec![("digimon".into(), 1, 552, 0.91)]);

        db.library_replace_suggestions(&[("sailor moon".into(), -1, 530, 1.0)])
            .unwrap();
        assert_eq!(db.library_suggestions(), vec![("sailor moon".into(), -1, 530, 1.0)]);
        assert_eq!(db.library_overrides(), vec![("hunter x hunter".into(), -1, 136)]);
    }

    /// A correction is the user's answer and has to outlive the scan that
    /// disagreed with it — so a rescan replaces sources and unmatched files
    /// while leaving every override exactly where it was.
    #[test]
    fn a_rescan_keeps_corrections_and_replaces_everything_else() {
        let db = mem_db();
        db.library_override_set("shingeki no kyojin", -1, 16498).unwrap();
        db.library_replace_unmatched(&[("mystery show".into(), 2, 3, "C:/a/E03.mkv".into())])
            .unwrap();

        db.library_replace_unmatched(&[("mystery show".into(), 2, 4, "C:/a/E04.mkv".into())])
            .unwrap();

        assert_eq!(db.library_overrides(), vec![("shingeki no kyojin".into(), -1, 16498)]);
        assert_eq!(
            db.library_unmatched(),
            vec![("mystery show".into(), 2, 4, "C:/a/E04.mkv".into())]
        );
    }

    /// Re-pointing the same release name replaces the earlier answer instead of
    /// leaving two rows for one key, and clearing gives the matcher its guess
    /// back rather than pinning the title to nothing.
    #[test]
    fn an_override_is_replaced_then_cleared() {
        let db = mem_db();
        db.library_override_set("bleach", 2, 100).unwrap();
        db.library_override_set("bleach", 2, 200).unwrap();
        assert_eq!(db.library_overrides(), vec![("bleach".into(), 2, 200)]);

        // A different season of the same show is a different key, not the same
        // correction seen twice.
        db.library_override_set("bleach", -1, 300).unwrap();
        assert_eq!(db.library_overrides().len(), 2);

        assert_eq!(db.library_override_clear("bleach", 2).unwrap(), 1);
        assert_eq!(db.library_overrides(), vec![("bleach".into(), -1, 300)]);

        // Clearing a key that holds no correction is not an error, but it must
        // not read as a removal either — the caller reports success on the
        // strength of this number, and 0 is the whole no-op case.
        assert_eq!(db.library_override_clear("bleach", 2).unwrap(), 0);
        assert_eq!(db.library_override_clear("never-corrected", 1).unwrap(), 0);
    }

    /// The index must survive a write/read round-trip, and a rescan must
    /// replace the previous contents rather than accumulate them.
    /// The list cache is what `cached_media_list` serves on a cold start, so a
    /// The airing watcher writes one of these per episode, forever. Pruning
    /// has to take the old unstamped rows too, or the ones already on disk
    /// would never go.
    #[test]
    fn pruning_takes_stale_and_legacy_keys_and_leaves_the_rest() {
        let db = mem_db();
        db.kv_set("aired:1:5", "1").unwrap(); // pre-stamp format
        db.kv_set("aired:1:6", "1000").unwrap(); // old
        db.kv_set("aired:1:7", "9000").unwrap(); // recent
        db.kv_set("airing_last_check", "1000").unwrap();

        assert_eq!(db.kv_prune_older("aired:", 5000), 2);
        assert!(db.kv_get("aired:1:5").is_none());
        assert!(db.kv_get("aired:1:6").is_none());
        assert_eq!(db.kv_get("aired:1:7").as_deref(), Some("9000"));
        // A prefix match, not a LIKE — and nothing outside it is touched.
        assert_eq!(db.kv_get("airing_last_check").as_deref(), Some("1000"));
    }

    /// `_` is a LIKE wildcard, and these prefixes are full of them.
    #[test]
    fn pruning_a_prefix_does_not_match_it_as_a_wildcard() {
        let db = mem_db();
        db.kv_set("sequel_seen:1", "1").unwrap();
        db.kv_set("sequelXseen:1", "1").unwrap();

        assert_eq!(db.kv_prune_older("sequel_seen:", 5000), 1);
        assert_eq!(db.kv_get("sequelXseen:1").as_deref(), Some("1"));
    }

    /// The table was insert-only; nothing can read past the newest 100.
    #[test]
    fn notifications_stop_at_the_retention_limit() {
        let db = mem_db();
        for i in 0..(NOTIF_KEEP + 25) {
            db.notif_insert("airing", "New episode", "body", i).unwrap();
        }
        let count: i64 = db
            .0
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, NOTIF_KEEP);
        // And it is the newest that survive.
        assert_eq!(db.notif_all(1)[0].created_ms, NOTIF_KEEP + 24);
    }

    /// v7 adds a column, and `ALTER TABLE ADD COLUMN` cannot be re-run. A
    /// database that had the column but was still labelled v6 — what an
    /// interrupted upgrade used to leave behind — failed to open on every
    /// launch from then on, permanently, with the whole list and library
    /// unreachable behind it.
    #[test]
    fn a_database_left_mid_upgrade_still_opens() {
        let dir = std::env::temp_dir().join(format!("karasu-mig-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        drop(Db::open(dir.clone()).unwrap());

        // Exactly the interrupted state: the ALTER committed, the version bump
        // did not.
        let conn = Connection::open(dir.join("karasu.db")).unwrap();
        assert!(has_column(&conn, "local_list", "progress_volumes"));
        conn.execute_batch("PRAGMA user_version = 6;").unwrap();
        drop(conn);

        Db::open(dir.clone()).expect("a half-migrated database must still open");

        let conn = Connection::open(dir.join("karasu.db")).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 10, "and must end up fully migrated");
        drop(conn);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Portable mode's copy step. Also pins that SQLite accepts a bound
    /// parameter as the `VACUUM INTO` destination — building that path by
    /// string concatenation would break on any apostrophe in a user's folder
    /// name.
    #[test]
    fn a_snapshot_is_a_readable_database_with_the_same_rows() {
        let db = mem_db();
        db.kv_set("anilist_viewer", r#"{"id":7}"#).unwrap();

        let dir = std::env::temp_dir().join(format!("karasu-snap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("copy.db");
        let _ = std::fs::remove_file(&dest);

        db.snapshot_to(&dest).unwrap();
        let copy = Db(Mutex::new(Connection::open(&dest).unwrap()));
        assert_eq!(copy.kv_get("anilist_viewer").as_deref(), Some(r#"{"id":7}"#));

        // VACUUM INTO refuses to overwrite, which is what makes the caller's
        // "only when the destination is absent" guard load-bearing.
        assert!(db.snapshot_to(&dest).is_err());

        drop(copy);
        let _ = std::fs::remove_dir_all(&dir);
    }

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

        db.library_replace_all(
            &[
                (154587, 13, "C:/anime/frieren-13.mkv".into()),
                (154587, 14, "C:/anime/frieren-14.mkv".into()),
            ],
            &[(154587, 1.0)],
        )
        .unwrap();
        let mut rows = db.library_all();
        rows.sort_by_key(|(_, ep, _)| *ep);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], (154587, 13, "C:/anime/frieren-13.mkv".into()));

        db.library_replace_all(&[(1, 1, "C:/anime/other-01.mkv".into())], &[(1, 0.82)])
            .unwrap();
        let rows = db.library_all();
        assert_eq!(rows, vec![(1, 1, "C:/anime/other-01.mkv".to_string())]);
    }

    /// Schema v8. The scanner's confidence is the difference between "this is
    /// the show" and "this is my best guess", and the screen says so — but only
    /// if the number survives the restart the index already survives.
    #[test]
    fn library_scores_round_trip_and_replace() {
        let db = mem_db();
        assert!(db.library_scores().is_empty());

        db.library_replace_all(
            &[
                (154587, 13, "C:/anime/frieren-13.mkv".into()),
                (1, 1, "C:/anime/other-01.mkv".into()),
            ],
            &[(154587, 1.0), (1, 0.74)],
        )
        .unwrap();
        let mut scores = db.library_scores();
        scores.sort_by_key(|(id, _)| *id);
        assert_eq!(scores, vec![(1, 0.74), (154587, 1.0)]);

        // A rescan is the whole picture, so the previous confidences go with
        // the previous paths rather than lingering beside them.
        db.library_replace_all(&[(1, 1, "C:/anime/other-01.mkv".into())], &[(1, 0.91)])
            .unwrap();
        assert_eq!(db.library_scores(), vec![(1, 0.91)]);
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

