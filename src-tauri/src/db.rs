use crate::sync::LockExt;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// SQLite database in the app data directory: key-value settings, the list cache and the offline update queue.
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

/// Schema v2: list_cache per media type; older caches are dropped and repopulated on the next load.
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

/// Schema v3: a `history` table for a removed feature, kept empty so migrated databases stay valid; do not rely on it.
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

/// Schema v4: the account-free local list; `media_json` caches the media so it renders offline, `tags` is reserved.
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

/// Schema v5: the in-app notification centre, recording every desktop toast with a read/unread state.
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

/// Schema v6: the local library index, persisted so it survives a restart; stale paths are caught at play time.
const MIGRATION_V6: &str = "
CREATE TABLE IF NOT EXISTS library_files (
    media_id INTEGER NOT NULL,
    episode  INTEGER NOT NULL,
    path     TEXT NOT NULL,
    PRIMARY KEY (media_id, episode)
);
PRAGMA user_version = 6;
";

/// Schema v7: volumes read on the local list, defaulted rather than backfilled because chapters cannot infer them.
const MIGRATION_V7: &str = "
ALTER TABLE local_list ADD COLUMN progress_volumes INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 7;
";

/// Schema v8: the scanner's per-title match confidence, its own table so the score is not repeated down every episode row.
const MIGRATION_V8: &str = "
CREATE TABLE IF NOT EXISTS library_match (
  media_id INTEGER PRIMARY KEY,
  score REAL NOT NULL
);
PRAGMA user_version = 8;
";

/// Schema v9: match corrections and the unplaced list, keyed on the parsed `(title, season)` so they survive the next scan.
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

/// Schema v10: AniList's guess for an unplaceable title, applied only once confirmed because a search hit is not a match.
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

/// Schema v11: confirmed season splits, keyed on the parse plus a disk episode range; a scan never clears them.
const MIGRATION_V11: &str = "
CREATE TABLE IF NOT EXISTS library_redirect (
  title TEXT NOT NULL,
  season INTEGER NOT NULL,
  ep_from INTEGER NOT NULL,
  ep_to INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  dst_start INTEGER NOT NULL,
  PRIMARY KEY (title, season, ep_from)
);
PRAGMA user_version = 11;
";

/// Schema v12: detection corrections, apart from `library_override` because titles and filenames are different key spaces.
const MIGRATION_V12: &str = "
CREATE TABLE IF NOT EXISTS detection_override (
  title TEXT NOT NULL,
  season INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  media_id INTEGER NOT NULL,
  display_title TEXT NOT NULL,
  PRIMARY KEY (title, season, media_type)
);
PRAGMA user_version = 12;
";

/// Schema v13: a signed episode offset on a detection correction, for a server that splits one numbered entry into cours.
const MIGRATION_V13: &str = "
ALTER TABLE detection_override ADD COLUMN episode_offset INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 13;
";

/// Schema v14: dates and privacy on the local list; the dates are `FuzzyDate` JSON because every part is nullable.
const MIGRATION_V14: &str = "
ALTER TABLE local_list ADD COLUMN started_at TEXT;
ALTER TABLE local_list ADD COLUMN completed_at TEXT;
ALTER TABLE local_list ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 14;
";

/// Schema v15: which media a notification is about, nullable because the update notice has none.
const MIGRATION_V15: &str = "
ALTER TABLE notifications ADD COLUMN media_id INTEGER;
PRAGMA user_version = 15;
";

/// Schema v16: the account a queued edit belongs to, so one account's queue never drains under the next one's token.
const MIGRATION_V16: &str = "
ALTER TABLE offline_queue ADD COLUMN user_id INTEGER;
UPDATE offline_queue
   SET user_id = (SELECT json_extract(value, '$.id') FROM kv
                   WHERE key = 'anilist_viewer' AND json_valid(value));
DELETE FROM offline_queue WHERE user_id IS NULL;
PRAGMA user_version = 16;
";

/// Schema v17: `blur_adult` seeded on for new installs only, decided by whether `kv` is still empty when this runs.
const MIGRATION_V17: &str = "
INSERT INTO kv (key, value)
SELECT 'blur_adult', CASE WHEN EXISTS (SELECT 1 FROM kv) THEN '0' ELSE '1' END
WHERE NOT EXISTS (SELECT 1 FROM kv WHERE key = 'blur_adult');
PRAGMA user_version = 17;
";

/// Schema v18: a nullable owner on `notifications`, null being the app's own row, so one account never sees another's bell.
const MIGRATION_V18: &str = "
ALTER TABLE notifications ADD COLUMN user_id INTEGER;
UPDATE notifications
   SET user_id = (SELECT json_extract(value, '$.id') FROM kv
                   WHERE key = 'anilist_viewer' AND json_valid(value))
 WHERE kind <> 'update';
PRAGMA user_version = 18;
";

/// Schema v19: an install predating the Stable channel stays on Nightly; `open` decides by the file's version, not `kv`.
const MIGRATION_V19: &str = "
INSERT INTO kv (key, value)
SELECT 'update_channel', 'prerelease'
WHERE NOT EXISTS (SELECT 1 FROM kv WHERE key = 'update_channel');
PRAGMA user_version = 19;
";

/// v19 for a database that did not exist before it: nothing to preserve.
const MIGRATION_V19_FRESH: &str = "PRAGMA user_version = 19;";

/// One detection correction: what was detected, and what it really is.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionOverride {
    /// The parsed title this fires on — what detection saw.
    pub title: String,
    /// `-1` where the parse carried no season.
    pub season: i32,
    pub media_type: String,
    pub media_id: i64,
    /// The chosen entry's title, stored so the Settings list and an off-list entry read correctly without a request.
    pub display_title: String,
    /// Added to the detected episode; signed because a source may number ahead of AniList as easily as behind.
    pub episode_offset: i32,
}

/// One in-app notification (mirrors a shown desktop toast).
#[derive(Debug, Clone, serde::Serialize)]
pub struct NotificationRow {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub body: String,
    #[serde(rename = "createdMs")]
    pub created_ms: i64,
    /// What the bell row opens; `None` for the update notice, a dropped-queue report and every row older than v15.
    #[serde(rename = "mediaId")]
    pub media_id: Option<i64>,
    pub read: bool,
}

/// One row of the offline queue, with `created_at` because the sync panel needs to tell a moving backlog from a stuck one.
#[derive(Debug, Clone)]
pub struct QueuedRow {
    pub id: i64,
    pub kind: String,
    pub payload: String,
    /// Unix seconds, from SQLite's own clock (`strftime('%s','now')`).
    pub created_at: i64,
}

/// Statuses emitted as list groups in local mode, even when empty, so the optimistic cache always finds a target group.
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
    pub private: bool,
    /// AniList's `FuzzyDate` as JSON text, or `None` for no date.
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub updated_ms: i64,
    pub media_json: Option<String>,
}

/// One write to the local list; every `None` means "leave it alone", because a `+1` sends `progress` alone.
pub struct LocalWrite<'a> {
    pub media_id: i64,
    pub media_type: &'a str,
    pub status: Option<&'a str>,
    pub progress: Option<i64>,
    pub progress_volumes: Option<i64>,
    pub score: Option<f64>,
    pub repeat: Option<i64>,
    pub notes: Option<&'a str>,
    pub private: Option<bool>,
    pub started_at: Option<&'a str>,
    pub completed_at: Option<&'a str>,
    pub media_json: Option<&'a str>,
    pub updated_ms: i64,
}

/// Notifications retained: scrollback headroom rather than a display limit, so the table cannot grow without bound.
const NOTIF_KEEP: i64 = 500;

/// Applies one migration step inside a transaction, so the schema change and the `user_version` bump land together.
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
        // Before the migrations: Android's background job can hold a second connection while the app cold-starts.
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| format!("Could not set the lock timeout: {e}"))?;
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
            // `ALTER TABLE ADD COLUMN` fails if the column is there, so a database interrupted mid-step must still open.
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
        if version < 11 {
            apply(&conn, 11, MIGRATION_V11)?;
        }
        if version < 12 {
            apply(&conn, 12, MIGRATION_V12)?;
        }
        if version < 13 {
            // `ALTER TABLE ADD COLUMN` again, so v7's guard again.
            if has_column(&conn, "detection_override", "episode_offset") {
                apply(&conn, 13, "PRAGMA user_version = 13;")?;
            } else {
                apply(&conn, 13, MIGRATION_V13)?;
            }
        }
        if version < 14 {
            // Three `ALTER TABLE ADD COLUMN`s in one transaction, so v7's guard and the first column decides for all three.
            if has_column(&conn, "local_list", "started_at") {
                apply(&conn, 14, "PRAGMA user_version = 14;")?;
            } else {
                apply(&conn, 14, MIGRATION_V14)?;
            }
        }
        if version < 15 {
            // `ALTER TABLE ADD COLUMN` again, so v7's guard again.
            if has_column(&conn, "notifications", "media_id") {
                apply(&conn, 15, "PRAGMA user_version = 15;")?;
            } else {
                apply(&conn, 15, MIGRATION_V15)?;
            }
        }
        if version < 16 {
            // v7's guard again; `apply` keeps the column and its attribution in one transaction, or every old row is unowned.
            if has_column(&conn, "offline_queue", "user_id") {
                apply(&conn, 16, "PRAGMA user_version = 16;")?;
            } else {
                apply(&conn, 16, MIGRATION_V16)?;
            }
        }
        if version < 17 {
            // No `has_column` guard: an INSERT guarded on the key it inserts is re-runnable on its own.
            apply(&conn, 17, MIGRATION_V17)?;
        }
        if version < 18 {
            // An `ALTER TABLE ADD COLUMN` is not re-runnable, so v7's guard: the column and its backfill land together.
            if has_column(&conn, "notifications", "user_id") {
                apply(&conn, 18, "PRAGMA user_version = 18;")?;
            } else {
                apply(&conn, 18, MIGRATION_V18)?;
            }
        }
        if version < 19 {
            // `version` is what the file said before any step ran; 0 means created just now, with no channel to keep.
            if version == 0 {
                apply(&conn, 19, MIGRATION_V19_FRESH)?;
            } else {
                apply(&conn, 19, MIGRATION_V19)?;
            }
        }
        Ok(Db(Mutex::new(conn)))
    }

    pub fn kv_get(&self, key: &str) -> Option<String> {
        let conn = self.0.guard();
        conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .ok()
    }

    /// Sets `key` to `value` only when it grows, as one compare-and-set so two racing connections cannot both claim the move.
    pub fn kv_advance_max(&self, key: &str, value: i64) -> bool {
        let conn = self.0.guard();
        conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value
             WHERE CAST(kv.value AS INTEGER) < CAST(excluded.value AS INTEGER)",
            rusqlite::params![key, value.to_string()],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )
        .map(|_| ())
        .map_err(|e| format!("Save failed: {e}"))
    }

    pub fn kv_delete(&self, key: &str) {
        let conn = self.0.guard();
        let _ = conn.execute("DELETE FROM kv WHERE key = ?1", [key]);
    }

    /// Drops `prefix`-keyed rows stamped older than `cutoff`; `substr` rather than `LIKE` because `_` is a LIKE wildcard.
    pub fn kv_prune_older(&self, prefix: &str, cutoff: i64) -> usize {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM kv
             WHERE substr(key, 1, length(?1)) = ?1
               AND CAST(value AS INTEGER) < ?2",
            rusqlite::params![prefix, cutoff],
        )
        .unwrap_or(0)
    }

    /// Deletes every key under a prefix, so an account change drops the alert dedupe keys the previous account earned.
    pub fn kv_delete_prefix(&self, prefix: &str) -> usize {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM kv WHERE substr(key, 1, length(?1)) = ?1",
            rusqlite::params![prefix],
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
        let conn = self.0.guard();
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

    /// Writes a consistent copy to `dest`, which must not exist; `std::fs::copy` cannot see the rollback journal.
    pub fn snapshot_to(&self, dest: &std::path::Path) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute("VACUUM INTO ?1", rusqlite::params![dest.to_string_lossy()])
            .map(|_| ())
            .map_err(|e| format!("Could not copy the database: {e}"))
    }

    /// `snapshot_to` over a file that may exist, written beside it and renamed so an interrupted copy keeps the old one.
    pub fn snapshot_over(&self, dest: &std::path::Path) -> Result<(), String> {
        if !dest.exists() {
            return self.snapshot_to(dest);
        }
        let tmp = dest.with_extension("db.replacing");
        let _ = std::fs::remove_file(&tmp);
        self.snapshot_to(&tmp)?;
        std::fs::rename(&tmp, dest).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("Could not replace the database: {e}")
        })
    }

    pub fn cached_list(&self, user_id: i64, media_type: &str) -> Option<String> {
        let conn = self.0.guard();
        conn.query_row(
            "SELECT payload FROM list_cache WHERE user_id = ?1 AND media_type = ?2",
            rusqlite::params![user_id, media_type],
            |r| r.get(0),
        )
        .ok()
    }

    /// Reads, edits and writes the cached list under one lock, or a fetch landing in the gap is overwritten by a stale copy.
    fn edit_cached_list<F>(&self, user_id: i64, media_type: &str, edit: F) -> bool
    where
        F: FnOnce(&mut serde_json::Value) -> bool,
    {
        let conn = self.0.guard();
        let payload: String = match conn.query_row(
            "SELECT payload FROM list_cache WHERE user_id = ?1 AND media_type = ?2",
            rusqlite::params![user_id, media_type],
            |r| r.get(0),
        ) {
            Ok(p) => p,
            Err(_) => return false,
        };
        let Ok(mut lists) = serde_json::from_str::<serde_json::Value>(&payload) else {
            return false;
        };
        if !edit(&mut lists) {
            return false;
        }
        conn.execute(
            "INSERT INTO list_cache (user_id, media_type, payload, fetched_at)
             VALUES (?1, ?2, ?3, strftime('%s','now'))
             ON CONFLICT(user_id, media_type) DO UPDATE
                SET payload = excluded.payload, fetched_at = excluded.fetched_at",
            rusqlite::params![user_id, media_type, lists.to_string()],
        )
        .is_ok()
    }

    /// Patches one cached entry; every write path must call it, because the scrobbler's regression guards read this table.
    pub fn cache_patch_entry(
        &self,
        user_id: i64,
        media_type: &str,
        media_id: i64,
        patch: &serde_json::Value,
    ) -> bool {
        let Some(fields) = patch.as_object() else {
            return false;
        };
        if fields.is_empty() {
            return false;
        }
        self.edit_cached_list(user_id, media_type, |lists| {
            let mut touched = false;
            for group in lists.as_array_mut().into_iter().flatten() {
                for entry in group
                    .get_mut("entries")
                    .and_then(|v| v.as_array_mut())
                    .into_iter()
                    .flatten()
                {
                    if entry.get("mediaId").and_then(|v| v.as_i64()) == Some(media_id) {
                        for (k, v) in fields {
                            entry[k.as_str()] = v.clone();
                        }
                        touched = true;
                    }
                }
            }
            touched
        })
    }

    /// Drops an entry from both cached lists by entry id, or a deleted entry stays a scrobble candidate and gets recreated.
    pub fn cache_forget_entry_id(&self, user_id: i64, entry_id: i64) -> bool {
        let anime = self.forget_where(user_id, "ANIME", "id", entry_id);
        let manga = self.forget_where(user_id, "MANGA", "id", entry_id);
        anime || manga
    }

    fn forget_where(&self, user_id: i64, media_type: &str, field: &str, value: i64) -> bool {
        self.edit_cached_list(user_id, media_type, |lists| {
            let mut removed = false;
            for group in lists.as_array_mut().into_iter().flatten() {
                if let Some(entries) = group.get_mut("entries").and_then(|v| v.as_array_mut()) {
                    let before = entries.len();
                    entries.retain(|e| e.get(field).and_then(|v| v.as_i64()) != Some(value));
                    removed |= entries.len() != before;
                }
            }
            removed
        })
    }

    /// Progress and status, the scrobbler's own patch.
    pub fn update_cached_progress(
        &self,
        user_id: i64,
        media_type: &str,
        media_id: i64,
        progress: u32,
        status: Option<&str>,
    ) {
        let mut patch = serde_json::json!({ "progress": progress });
        if let Some(s) = status {
            patch["status"] = s.into();
        }
        self.cache_patch_entry(user_id, media_type, media_id, &patch);
    }

    // --- Offline queue ------------------------------------------------------

    /// Queues an edit against the account that made it, so the drain can never write it to somebody else's list.
    pub fn queue_push(&self, user_id: i64, kind: &str, payload: &str) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            "INSERT INTO offline_queue (kind, payload, created_at, user_id)
             VALUES (?1, ?2, strftime('%s','now'), ?3)",
            rusqlite::params![kind, payload, user_id],
        )
        .map(|_| ())
        .map_err(|e| format!("Queue write failed: {e}"))
    }

    /// Everything queued by `user_id`, oldest first; another account's rows are never returned.
    pub fn queue_all(&self, user_id: i64) -> Vec<QueuedRow> {
        let conn = self.0.guard();
        let mut stmt = match conn.prepare(
            "SELECT id, kind, payload, created_at FROM offline_queue WHERE user_id = ?1 ORDER BY id",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map([user_id], |r| {
            Ok(QueuedRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                payload: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
    }

    pub fn queue_remove(&self, id: i64) {
        let conn = self.0.guard();
        let _ = conn.execute("DELETE FROM offline_queue WHERE id = ?1", [id]);
    }

    /// `queue_remove` scoped to the owner, for a user-triggered discard whose id came from a snapshot stale across a sign-out.
    pub fn queue_remove_for(&self, user_id: i64, id: i64) -> bool {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM offline_queue WHERE id = ?1 AND user_id = ?2",
            [id, user_id],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    /// The schema version the database is on, for diagnostics, since readers here answer a shape mismatch with an empty list.
    pub fn schema_version(&self) -> u32 {
        let conn = self.0.guard();
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .map(|v| v as u32)
            .unwrap_or(0)
    }

    /// The pending badge, scoped like the drain so it counts what this account is waiting on.
    pub fn queue_len(&self, user_id: i64) -> usize {
        let conn = self.0.guard();
        conn.query_row(
            "SELECT COUNT(*) FROM offline_queue WHERE user_id = ?1",
            [user_id],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n as usize)
        .unwrap_or(0)
    }

    // --- Local-only list ----------------------------------------------------

    /// Inserts or updates a local entry, keeping every column an absent field does not mention.
    pub fn local_upsert(&self, w: LocalWrite<'_>) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            // Absent means unchanged, as for an absent GraphQL variable; a cleared date is an object with every part null.
            "INSERT INTO local_list
                (media_id, media_type, status, progress, progress_volumes, score, repeat,
                 notes, tags, private, started_at, completed_at, updated_ms, media_json)
             VALUES (?1, ?2, COALESCE(?3, 'PLANNING'), COALESCE(?4, 0), COALESCE(?5, 0),
                     COALESCE(?6, 0.0), COALESCE(?7, 0), COALESCE(?8, ''), '',
                     COALESCE(?9, 0), ?10, ?11, ?12, ?13)
             ON CONFLICT(media_id, media_type) DO UPDATE SET
                status = COALESCE(?3, local_list.status),
                progress = COALESCE(?4, local_list.progress),
                progress_volumes = COALESCE(?5, local_list.progress_volumes),
                score = COALESCE(?6, local_list.score),
                repeat = COALESCE(?7, local_list.repeat),
                notes = COALESCE(?8, local_list.notes),
                private = COALESCE(?9, local_list.private),
                started_at = COALESCE(?10, local_list.started_at),
                completed_at = COALESCE(?11, local_list.completed_at),
                updated_ms = excluded.updated_ms,
                media_json = COALESCE(excluded.media_json, local_list.media_json)",
            rusqlite::params![
                w.media_id,
                w.media_type,
                w.status,
                w.progress,
                w.progress_volumes,
                w.score,
                w.repeat,
                w.notes,
                w.private,
                w.started_at,
                w.completed_at,
                w.updated_ms,
                w.media_json
            ],
        )
        .map(|_| ())
        .map_err(|e| format!("Local save failed: {e}"))
    }

    /// Media type of an existing local row; AniList media ids are globally unique, so the id alone identifies it.
    pub fn local_find_type(&self, media_id: i64) -> Option<String> {
        let conn = self.0.guard();
        conn.query_row(
            "SELECT media_type FROM local_list WHERE media_id = ?1",
            [media_id],
            |r| r.get(0),
        )
        .ok()
    }

    pub fn local_delete(&self, media_id: i64, media_type: &str) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM local_list WHERE media_id = ?1 AND media_type = ?2",
            rusqlite::params![media_id, media_type],
        )
        .map(|_| ())
        .map_err(|e| format!("Local delete failed: {e}"))
    }

    fn local_rows(&self, media_type: Option<&str>) -> Vec<LocalRow> {
        let conn = self.0.guard();
        // Column order is load-bearing: `map` reads by index, and a mismatch silently returns an empty list.
        let sql = "SELECT media_id, media_type, status, progress, progress_volumes, \
                   score, repeat, notes, updated_ms, media_json, private, \
                   started_at, completed_at FROM local_list";
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
                private: r.get::<_, i64>(10)? != 0,
                started_at: r.get(11)?,
                completed_at: r.get(12)?,
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

    /// A stored `FuzzyDate` back as JSON, or null; unparseable text is null because the entry is worth more than the date.
    pub(crate) fn fuzzy_date(stored: Option<&str>) -> serde_json::Value {
        stored
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null)
    }

    /// The local list for one media type as an AniList-shaped `lists` JSON array, so the frontend sees one shape.
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
                // Emitted explicitly because `MediaListEntry` declares them; "private" locally means left out of the MAL export.
                "private": row.private,
                "startedAt": Self::fuzzy_date(row.started_at.as_deref()),
                "completedAt": Self::fuzzy_date(row.completed_at.as_deref()),
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
        media_id: Option<i64>,
        user_id: Option<i64>,
    ) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            "INSERT INTO notifications (kind, title, body, created_ms, media_id, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![kind, title, body, created_ms, media_id, user_id],
        )
        .map_err(|e| format!("Notification write failed: {e}"))?;

        // Trimming on write keeps the table bounded without a separate pass to forget to run.
        let _ = conn.execute(
            "DELETE FROM notifications WHERE id NOT IN
                 (SELECT id FROM notifications ORDER BY created_ms DESC, id DESC LIMIT ?1)",
            rusqlite::params![NOTIF_KEEP],
        );
        Ok(())
    }

    /// Newest notifications first for one account, plus the install's own null-owner rows, which everyone sees.
    pub fn notif_all(&self, limit: i64, viewer: Option<i64>) -> Vec<NotificationRow> {
        let conn = self.0.guard();
        let mut stmt = match conn.prepare(
            "SELECT id, kind, title, body, created_ms, media_id, read
             FROM notifications
             WHERE user_id IS NULL OR user_id = ?2
             ORDER BY id DESC LIMIT ?1",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map(rusqlite::params![limit, viewer], |r| {
            Ok(NotificationRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                title: r.get(2)?,
                body: r.get(3)?,
                created_ms: r.get(4)?,
                media_id: r.get(5)?,
                read: r.get::<_, i64>(6)? != 0,
            })
        })
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
    }

    pub fn notif_mark_read(&self, id: i64) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute("UPDATE notifications SET read = 1 WHERE id = ?1", [id])
            .map(|_| ())
            .map_err(|e| format!("Notification update failed: {e}"))
    }

    pub fn notif_mark_all_read(&self) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute("UPDATE notifications SET read = 1 WHERE read = 0", [])
            .map(|_| ())
            .map_err(|e| format!("Notification update failed: {e}"))
    }

    /// Removes every row of one kind, the update notice's exit, since the retention trim never reaches it on a quiet account.
    pub fn notif_clear_kind(&self, kind: &str) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute("DELETE FROM notifications WHERE kind = ?1", [kind])
            .map(|_| ())
            .map_err(|e| format!("Notification delete failed: {e}"))
    }

    /// Unread rows this account may see — same scoping rule as `notif_all`.
    pub fn notif_unread_count(&self, viewer: Option<i64>) -> i64 {
        let conn = self.0.guard();
        conn.query_row(
            "SELECT COUNT(*) FROM notifications
              WHERE read = 0 AND (user_id IS NULL OR user_id = ?1)",
            rusqlite::params![viewer],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }

    /// Forgets every account-scoped bell row on an account change, keeping the install's own update notice.
    pub fn notif_clear_owned(&self) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute("DELETE FROM notifications WHERE user_id IS NOT NULL", [])
            .map(|_| ())
            .map_err(|e| format!("Notification clear failed: {e}"))
    }

    // --- Local library ------------------------------------------------------

    /// The index half of a scan result, with its scores, inside a caller's transaction so neither survives without the other.
    fn write_index(
        tx: &rusqlite::Transaction<'_>,
        rows: &[(i64, u32, String)],
        scores: &[(i64, f64)],
    ) -> Result<(), String> {
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
        Ok(())
    }

    /// Match confidence per media, for the rows the library screen draws.
    pub fn library_scores(&self) -> Vec<(i64, f64)> {
        let conn = self.0.guard();
        conn.prepare("SELECT media_id, score FROM library_match")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                    .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .unwrap_or_default()
    }

    pub fn library_all(&self) -> Vec<(i64, u32, String)> {
        let conn = self.0.guard();
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
        let conn = self.0.guard();
        conn.prepare("SELECT title, season, media_id FROM library_override")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .unwrap_or_default()
    }

    /// Records a correction as an upsert, because re-pointing the same release name corrects the correction.
    pub fn library_override_set(
        &self,
        title: &str,
        season: i32,
        media_id: i64,
    ) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            "INSERT INTO library_override (title, season, media_id) VALUES (?1, ?2, ?3)
             ON CONFLICT(title, season) DO UPDATE SET media_id = excluded.media_id",
            rusqlite::params![title, season, media_id],
        )
        .map(|_| ())
        .map_err(|e| format!("Could not save the correction: {e}"))
    }

    /// Forgets a correction and returns the row count, so the caller can tell a removal from a no-op.
    pub fn library_override_clear(&self, title: &str, season: i32) -> Result<usize, String> {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM library_override WHERE title = ?1 AND season = ?2",
            rusqlite::params![title, season],
        )
        .map_err(|e| format!("Could not clear the correction: {e}"))
    }

    // --- Detection corrections ------------------------------------------------

    /// Every correction made on the now-playing card, read whole and matched in memory because the table stays small.
    pub fn detection_overrides(&self) -> Vec<DetectionOverride> {
        let conn = self.0.guard();
        conn.prepare(
            "SELECT title, season, media_type, media_id, display_title, episode_offset
             FROM detection_override",
        )
        .and_then(|mut stmt| {
            stmt.query_map([], |r| {
                Ok(DetectionOverride {
                    title: r.get(0)?,
                    season: r.get(1)?,
                    media_type: r.get(2)?,
                    media_id: r.get(3)?,
                    display_title: r.get(4)?,
                    episode_offset: r.get(5)?,
                })
            })
            .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .unwrap_or_default()
    }

    /// Records a detection correction as an upsert, for `library_override_set`'s reason.
    pub fn detection_override_set(
        &self,
        title: &str,
        season: i32,
        media_type: &str,
        media_id: i64,
        display_title: &str,
        episode_offset: i32,
    ) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            "INSERT INTO detection_override
               (title, season, media_type, media_id, display_title, episode_offset)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(title, season, media_type) DO UPDATE SET
               media_id = excluded.media_id,
               display_title = excluded.display_title,
               episode_offset = excluded.episode_offset",
            rusqlite::params![
                title,
                season,
                media_type,
                media_id,
                display_title,
                episode_offset
            ],
        )
        .map(|_| ())
        .map_err(|e| format!("Could not save the correction: {e}"))
    }

    /// Forgets one detection correction and returns the row count, so a no-op is distinguishable from a removal.
    pub fn detection_override_clear(
        &self,
        title: &str,
        season: i32,
        media_type: &str,
    ) -> Result<usize, String> {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM detection_override
             WHERE title = ?1 AND season = ?2 AND media_type = ?3",
            rusqlite::params![title, season, media_type],
        )
        .map_err(|e| format!("Could not clear the correction: {e}"))
    }

    // --- Season splits --------------------------------------------------------

    /// Every user-confirmed episode-range redirect as `(title, season, ep_from, ep_to, media_id, dst_start)`.
    pub fn library_redirects(&self) -> Vec<(String, i32, u32, u32, i64, u32)> {
        let conn = self.0.guard();
        conn.prepare(
            "SELECT title, season, ep_from, ep_to, media_id, dst_start FROM library_redirect",
        )
        .and_then(|mut stmt| {
            stmt.query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })
            .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .unwrap_or_default()
    }

    /// Records a season split as an upsert on the range start, because re-pointing the same range corrects the correction.
    pub fn library_redirect_set(
        &self,
        title: &str,
        season: i32,
        ep_from: u32,
        ep_to: u32,
        media_id: i64,
        dst_start: u32,
    ) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            "INSERT INTO library_redirect (title, season, ep_from, ep_to, media_id, dst_start)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(title, season, ep_from) DO UPDATE SET
               ep_to = excluded.ep_to,
               media_id = excluded.media_id,
               dst_start = excluded.dst_start",
            rusqlite::params![title, season, ep_from, ep_to, media_id, dst_start],
        )
        .map(|_| ())
        .map_err(|e| format!("Could not save the season split: {e}"))
    }

    /// Removes a season split and returns the row count, for the same reason `library_override_clear` does.
    pub fn library_redirect_clear(
        &self,
        title: &str,
        season: i32,
        ep_from: u32,
    ) -> Result<usize, String> {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM library_redirect WHERE title = ?1 AND season = ?2 AND ep_from = ?3",
            rusqlite::params![title, season, ep_from],
        )
        .map_err(|e| format!("Could not clear the season split: {e}"))
    }

    /// Files the scan could not place, grouped by the title it parsed out.
    pub fn library_unmatched(&self) -> Vec<(String, i32, u32, String)> {
        let conn = self.0.guard();
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
        let conn = self.0.guard();
        conn.prepare("SELECT title, season, media_id, score FROM library_suggestion")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                    .map(|rows| rows.filter_map(Result::ok).collect())
            })
            .unwrap_or_default()
    }

    /// Replaces the suggestions in one transaction, leaving `library_override` alone: a correction outranks a search.
    pub fn library_replace_suggestions(
        &self,
        rows: &[(String, i32, i64, f64)],
    ) -> Result<(), String> {
        let mut conn = self.0.guard();
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

    /// Publishes a whole scan result in one transaction, never touching `library_override`, which is the user's.
    pub fn library_publish(
        &self,
        rows: &[(i64, u32, String)],
        scores: &[(i64, f64)],
        unmatched: &[(String, i32, u32, String)],
    ) -> Result<(), String> {
        let mut conn = self.0.guard();
        let tx = conn
            .transaction()
            .map_err(|e| format!("Library write failed: {e}"))?;
        Self::write_index(&tx, rows, scores)?;
        Self::write_unmatched(&tx, unmatched)?;
        tx.commit()
            .map_err(|e| format!("Library write failed: {e}"))
    }

    /// The unmatched half of a scan result, inside a caller's transaction.
    fn write_unmatched(
        tx: &rusqlite::Transaction<'_>,
        unmatched: &[(String, i32, u32, String)],
    ) -> Result<(), String> {
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
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::Value;

    /// A migrated in-memory database, `pub(crate)` so tests elsewhere can take a `Db` without opening a file.
    pub(crate) fn mem_db() -> Db {
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
        conn.execute_batch(MIGRATION_V11).unwrap();
        conn.execute_batch(MIGRATION_V12).unwrap();
        conn.execute_batch(MIGRATION_V13).unwrap();
        conn.execute_batch(MIGRATION_V14).unwrap();
        conn.execute_batch(MIGRATION_V15).unwrap();
        conn.execute_batch(MIGRATION_V16).unwrap();
        conn.execute_batch(MIGRATION_V17).unwrap();
        conn.execute_batch(MIGRATION_V18).unwrap();
        // The fresh-database arm, which is what an in-memory database is.
        conn.execute_batch(MIGRATION_V19_FRESH).unwrap();
        Db(Mutex::new(conn))
    }

    /// Measures the cached-list read that is the other half of `hydrate`'s startup cost; a measurement, not an assertion.
    #[test]
    #[ignore]
    fn measure_the_cache_read() {
        for entries in [500usize, 2_000, 8_000] {
            let rows: Vec<Value> = (1..=entries)
                .map(|i| {
                    serde_json::json!({
                        "mediaId": i,
                        "progress": i % 24,
                        "status": "CURRENT",
                        "media": {
                            "id": i,
                            "episodes": 24,
                            "title": {
                                "romaji": format!("Some Long Show Title Number {i}"),
                                "english": format!("Some Long Show Title Number {i}"),
                                "native": "\u{3042}\u{306e}\u{4f5c}\u{54c1}",
                            },
                            "synonyms": [format!("Alt Title {i}"), format!("Second Alt {i}")],
                        }
                    })
                })
                .collect();
            let blob = serde_json::json!([{ "isCustomList": false, "entries": rows }]).to_string();
            let db = mem_db();
            db.kv_set("anilist_viewer", "{\"id\":1}").unwrap();
            db.cache_list(1, "ANIME", &blob).unwrap();

            let start = std::time::Instant::now();
            let candidates = crate::playback::scrobbler::candidates_from_cache(&db, "ANIME");
            println!(
                "cache {entries} entries ({} KiB): {:?}, {} candidates",
                blob.len() / 1024,
                start.elapsed(),
                candidates.len()
            );
        }
    }

    /// v17 has to tell two populations apart that the key itself cannot.
    #[test]
    fn v17_blurs_by_default_only_where_nothing_was_ever_stored() {
        // A database being created right now: kv is empty when v17 runs, so the blur comes on.
        let fresh = mem_db();
        assert_eq!(fresh.kv_get("blur_adult").as_deref(), Some("1"));

        // A database in use: something is already stored, so the screen the user had does not change under them.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute_batch("INSERT INTO kv (key, value) VALUES ('theme', 'karasu');")
            .unwrap();
        conn.execute_batch(MIGRATION_V17).unwrap();
        let existing = Db(Mutex::new(conn));
        assert_eq!(existing.kv_get("blur_adult").as_deref(), Some("0"));
    }

    /// Re-runnable, and — more to the point — it never argues with a choice.
    #[test]
    fn v17_leaves_an_explicit_choice_alone() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute_batch("INSERT INTO kv (key, value) VALUES ('blur_adult', '0');")
            .unwrap();
        conn.execute_batch(MIGRATION_V17).unwrap();
        conn.execute_batch(MIGRATION_V17).unwrap();
        let db = Db(Mutex::new(conn));
        assert_eq!(db.kv_get("blur_adult").as_deref(), Some("0"));
    }

    /// Proves v19 seeds Nightly for an existing install and leaves a fresh one on the Stable default.
    #[test]
    fn v19_keeps_an_existing_install_on_nightly_and_a_fresh_one_on_stable() {
        // Fresh: no row, so the reader's default — Stable — applies.
        let fresh = mem_db();
        assert_eq!(fresh.kv_get("update_channel"), None);

        // Existing: the seed writes the channel the install was living with.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute_batch("INSERT INTO kv (key, value) VALUES ('theme', 'karasu');")
            .unwrap();
        conn.execute_batch(MIGRATION_V19).unwrap();
        let existing = Db(Mutex::new(conn));
        assert_eq!(
            existing.kv_get("update_channel").as_deref(),
            Some("prerelease")
        );
    }

    /// Proves `open` seeds a file that arrived at v18 and not one that did not exist, since `kv` cannot tell them apart.
    #[test]
    fn v19_decides_by_the_version_the_file_arrived_with() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "karasu-v19-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        // A database written by a v18 build, then opened by this one.
        {
            let conn = Connection::open(dir.join("karasu.db")).unwrap();
            conn.execute_batch(MIGRATIONS).unwrap();
            for step in [
                MIGRATION_V2, MIGRATION_V3, MIGRATION_V4, MIGRATION_V5, MIGRATION_V6,
                MIGRATION_V7, MIGRATION_V8, MIGRATION_V9, MIGRATION_V10, MIGRATION_V11,
                MIGRATION_V12, MIGRATION_V13, MIGRATION_V14, MIGRATION_V15, MIGRATION_V16,
                MIGRATION_V17, MIGRATION_V18,
            ] {
                conn.execute_batch(step).unwrap();
            }
        }
        let upgraded = Db::open(dir.clone()).unwrap();
        assert_eq!(
            upgraded.kv_get("update_channel").as_deref(),
            Some("prerelease")
        );
        drop(upgraded);

        // A database that did not exist until this open.
        let fresh_dir = dir.join("fresh");
        let fresh = Db::open(fresh_dir).unwrap();
        assert_eq!(fresh.kv_get("update_channel"), None);
        drop(fresh);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Re-runnable, and it never argues with a choice.
    #[test]
    fn v19_leaves_an_explicit_choice_alone() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute_batch("INSERT INTO kv (key, value) VALUES ('update_channel', 'stable');")
            .unwrap();
        conn.execute_batch(MIGRATION_V19).unwrap();
        conn.execute_batch(MIGRATION_V19).unwrap();
        let db = Db(Mutex::new(conn));
        assert_eq!(db.kv_get("update_channel").as_deref(), Some("stable"));
    }

    /// Proves a correction carries an episode offset, defaulting to the same numbering every pre-v13 row meant.
    #[test]
    fn a_correction_can_carry_an_episode_offset() {
        let db = mem_db();
        db.detection_override_set("beyblade metal fusion", 2, "ANIME", 8410, "Metal Masters", 0)
            .unwrap();
        db.detection_override_set("some 2 cour show", 2, "ANIME", 99, "Some Show", 12)
            .unwrap();

        let rows = db.detection_overrides();
        let masters = rows.iter().find(|o| o.media_id == 8410).unwrap();
        assert_eq!(masters.episode_offset, 0, "separate entries keep their numbering");
        let cour = rows.iter().find(|o| o.media_id == 99).unwrap();
        assert_eq!(cour.episode_offset, 12);

        // Re-correcting replaces the offset too, rather than keeping the old.
        db.detection_override_set("some 2 cour show", 2, "ANIME", 99, "Some Show", 13)
            .unwrap();
        let rows = db.detection_overrides();
        assert_eq!(rows.iter().find(|o| o.media_id == 99).unwrap().episode_offset, 13);
        assert_eq!(rows.len(), 2, "and does not add a row");
    }

    /// Proves a detection correction is keyed by medium and cannot reach into the library's table, which is why v12 exists.
    #[test]
    fn a_detection_correction_is_keyed_by_medium_and_leaves_the_library_alone() {
        let db = mem_db();
        db.library_override_set("frieren", -1, 1).unwrap();
        db.detection_override_set("frieren", -1, "ANIME", 2, "Frieren", 0).unwrap();
        // Same parse, other medium: a different row, not a replacement.
        db.detection_override_set("frieren", -1, "MANGA", 3, "Frieren (manga)", 0)
            .unwrap();

        let mut rows = db.detection_overrides();
        rows.sort_by_key(|r| r.media_id);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].media_type, "ANIME");
        assert_eq!(rows[0].display_title, "Frieren");
        assert_eq!(rows[1].media_type, "MANGA");
        // The library's own correction is untouched by any of it.
        assert_eq!(db.library_overrides(), vec![("frieren".to_string(), -1, 1)]);

        // Correcting the correction replaces, never accumulates.
        db.detection_override_set("frieren", -1, "ANIME", 9, "Frieren S2", 0).unwrap();
        let anime: Vec<_> = db
            .detection_overrides()
            .into_iter()
            .filter(|r| r.media_type == "ANIME")
            .collect();
        assert_eq!(anime.len(), 1);
        assert_eq!(anime[0].media_id, 9);
        assert_eq!(anime[0].display_title, "Frieren S2");

        // Clearing reports what it did, so a no-op cannot pass for a removal.
        assert_eq!(db.detection_override_clear("frieren", -1, "ANIME").unwrap(), 1);
        assert_eq!(db.detection_override_clear("frieren", -1, "ANIME").unwrap(), 0);
        assert_eq!(db.detection_overrides().len(), 1);
        assert_eq!(db.library_overrides().len(), 1);
    }

    /// Proves a rescan replaces every suggestion and no correction, since only the former is the scan's opinion.
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

    /// Proves a rescan replaces the index and unmatched files while leaving every override where it was.
    #[test]
    fn a_rescan_keeps_corrections_and_replaces_everything_else() {
        let db = mem_db();
        db.library_override_set("shingeki no kyojin", -1, 16498).unwrap();
        db.library_publish(&[], &[], &[("mystery show".into(), 2, 3, "C:/a/E03.mkv".into())])
            .unwrap();

        db.library_publish(&[], &[], &[("mystery show".into(), 2, 4, "C:/a/E04.mkv".into())])
            .unwrap();

        assert_eq!(db.library_overrides(), vec![("shingeki no kyojin".into(), -1, 16498)]);
        assert_eq!(
            db.library_unmatched(),
            vec![("mystery show".into(), 2, 4, "C:/a/E04.mkv".into())]
        );
    }

    /// Proves re-pointing a release name replaces the earlier answer and clearing gives the matcher its guess back.
    #[test]
    fn an_override_is_replaced_then_cleared() {
        let db = mem_db();
        db.library_override_set("bleach", 2, 100).unwrap();
        db.library_override_set("bleach", 2, 200).unwrap();
        assert_eq!(db.library_overrides(), vec![("bleach".into(), 2, 200)]);

        // A different season of the same show is a different key, not the same correction seen twice.
        db.library_override_set("bleach", -1, 300).unwrap();
        assert_eq!(db.library_overrides().len(), 2);

        assert_eq!(db.library_override_clear("bleach", 2).unwrap(), 1);
        assert_eq!(db.library_overrides(), vec![("bleach".into(), -1, 300)]);

        // Clearing a key with no correction is not an error, but it must not read as a removal either.
        assert_eq!(db.library_override_clear("bleach", 2).unwrap(), 0);
        assert_eq!(db.library_override_clear("never-corrected", 1).unwrap(), 0);
    }

    /// Proves a season split keys on its range start, so a second range is its own row and clearing counts honestly.
    #[test]
    fn a_season_split_is_replaced_then_cleared() {
        let db = mem_db();
        db.library_redirect_set("frieren", -1, 13, 24, 555, 1).unwrap();
        db.library_redirect_set("frieren", -1, 13, 28, 556, 1).unwrap();
        assert_eq!(
            db.library_redirects(),
            vec![("frieren".into(), -1, 13, 28, 556, 1)]
        );

        // A second overflow of the same parse is a second range, not a correction of the first.
        db.library_redirect_set("frieren", -1, 29, 40, 557, 1).unwrap();
        assert_eq!(db.library_redirects().len(), 2);

        assert_eq!(db.library_redirect_clear("frieren", -1, 13).unwrap(), 1);
        assert_eq!(
            db.library_redirects(),
            vec![("frieren".into(), -1, 29, 40, 557, 1)]
        );
        assert_eq!(db.library_redirect_clear("frieren", -1, 13).unwrap(), 0);
    }

    /// Proves pruning takes the old unstamped rows too, or the ones already on disk would never go.
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
            db.notif_insert("airing", "New episode", "body", i, None, None)
                .unwrap();
        }
        let count: i64 = db
            .0
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, NOTIF_KEEP);
        // And it is the newest that survive.
        assert_eq!(db.notif_all(1, None)[0].created_ms, NOTIF_KEEP + 24);
    }

    /// Proves a database with a column already added but the version still behind opens instead of failing every launch.
    #[test]
    fn a_database_left_mid_upgrade_still_opens() {
        let dir = std::env::temp_dir().join(format!("karasu-mig-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        drop(Db::open(dir.clone()).unwrap());

        // Exactly the interrupted state: the ALTER committed, the version bump did not.
        let conn = Connection::open(dir.join("karasu.db")).unwrap();
        assert!(has_column(&conn, "local_list", "progress_volumes"));
        conn.execute_batch("PRAGMA user_version = 6;").unwrap();
        drop(conn);

        Db::open(dir.clone()).expect("a half-migrated database must still open");

        let conn = Connection::open(dir.join("karasu.db")).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 19, "and must end up fully migrated");
        drop(conn);

        // Every other `ALTER TABLE ADD COLUMN` step needs the same proof: the column present, the version behind.
        for (version_behind, table, column) in [
            (12, "detection_override", "episode_offset"),
            (13, "local_list", "started_at"),
            (14, "notifications", "media_id"),
            (15, "offline_queue", "user_id"),
            (17, "notifications", "user_id"),
        ] {
            let conn = Connection::open(dir.join("karasu.db")).unwrap();
            assert!(has_column(&conn, table, column));
            conn.execute_batch(&format!("PRAGMA user_version = {version_behind};"))
                .unwrap();
            drop(conn);

            Db::open(dir.clone())
                .unwrap_or_else(|e| panic!("a half-migrated v{} must still open: {e}", version_behind + 1));

            let conn = Connection::open(dir.join("karasu.db")).unwrap();
            let version: i64 = conn
                .query_row("PRAGMA user_version", [], |r| r.get(0))
                .unwrap();
            assert_eq!(version, 19);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Proves a local entry carries dates and privacy, and that an absent field leaves them alone.
    #[test]
    fn a_local_entry_carries_dates_and_privacy() {
        let db = mem_db();
        db.local_upsert(LocalWrite {
            private: Some(true),
            started_at: Some(r#"{"year":2024,"month":3,"day":null}"#),
            media_json: Some("{}"),
            ..write(4, "ANIME")
        })
        .unwrap();

        let entry = |db: &Db| -> Value {
            let lists: Value = serde_json::from_str(&db.local_list_json("ANIME")).unwrap();
            lists
                .as_array()
                .unwrap()
                .iter()
                .find(|g| g["status"] == "CURRENT")
                .unwrap()["entries"][0]
                .clone()
        };

        let e = entry(&db);
        assert_eq!(e["private"], true);
        assert_eq!(e["startedAt"]["year"], 2024);
        // A partial date is a real answer, not a broken one.
        assert_eq!(e["startedAt"]["day"], Value::Null);
        assert_eq!(e["completedAt"], Value::Null);

        // A `+1` sends none of the three, so absent has to mean "leave it alone" or an unrelated save wipes them.
        db.local_upsert(LocalWrite {
            progress: Some(5),
            updated_ms: 2_000,
            ..write(4, "ANIME")
        })
        .unwrap();
        let e = entry(&db);
        assert_eq!(e["progress"], 5);
        assert_eq!(e["private"], true);
        assert_eq!(e["startedAt"]["year"], 2024);

        // Clearing is AniList's own spelling, an object with every part null, which is a value and therefore lands.
        db.local_upsert(LocalWrite {
            private: Some(false),
            started_at: Some(r#"{"year":null,"month":null,"day":null}"#),
            updated_ms: 3_000,
            ..write(4, "ANIME")
        })
        .unwrap();
        let e = entry(&db);
        assert_eq!(e["private"], false);
        assert_eq!(e["startedAt"]["year"], Value::Null);
    }

    /// Proves a one-field save leaves the other six columns alone; built from `patch()`, since `write()` always sends a status.
    #[test]
    fn a_partial_local_save_leaves_every_untouched_field_alone() {
        let db = mem_db();
        db.local_upsert(LocalWrite {
            status: Some("CURRENT"),
            progress: Some(3),
            progress_volumes: Some(12),
            score: Some(8.0),
            repeat: Some(2),
            notes: Some("a note"),
            media_json: Some("{}"),
            ..write(4, "ANIME")
        })
        .unwrap();

        // What `local_save_entry` builds for `{ mediaId, progress }`.
        db.local_upsert(LocalWrite {
            progress: Some(4),
            ..patch(4, "ANIME")
        })
        .unwrap();

        let row = db.local_all().into_iter().find(|r| r.media_id == 4).unwrap();
        assert_eq!(row.progress, 4, "the field that was sent");
        assert_eq!(row.status, "CURRENT", "not reset to PLANNING");
        assert_eq!(row.score, 8.0);
        assert_eq!(row.repeat, 2);
        assert_eq!(row.progress_volumes, 12);
        assert_eq!(row.notes, "a note", "and so the tags sharing the column");

        // The status dropdown is the same shape and must not zero `progress`.
        db.local_upsert(LocalWrite {
            status: Some("PAUSED"),
            ..patch(4, "ANIME")
        })
        .unwrap();
        let row = db.local_all().into_iter().find(|r| r.media_id == 4).unwrap();
        assert_eq!(row.status, "PAUSED");
        assert_eq!(row.progress, 4, "not zeroed by a status-only save");
        assert_eq!(row.score, 8.0);
    }

    /// Proves a first write still gets the neutral defaults, which "add to list" relies on when it sends only a status.
    #[test]
    fn a_first_local_write_still_gets_the_neutral_defaults() {
        let db = mem_db();
        db.local_upsert(LocalWrite {
            status: Some("PLANNING"),
            media_json: Some("{}"),
            ..patch(42, "ANIME")
        })
        .unwrap();

        let row = db.local_all().into_iter().find(|r| r.media_id == 42).unwrap();
        assert_eq!(row.status, "PLANNING");
        assert_eq!(row.progress, 0);
        assert_eq!(row.score, 0.0);
        assert_eq!(row.repeat, 0);
        assert_eq!(row.progress_volumes, 0);
        assert_eq!(row.notes, "");
        assert!(!row.private);
    }

    /// Proves a snapshot is a readable copy and that `VACUUM INTO` takes a bound parameter, so an apostrophe in a path is safe.
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

        // VACUUM INTO refuses to overwrite, which is what makes the caller's absent-destination guard load-bearing.
        assert!(db.snapshot_to(&dest).is_err());

        drop(copy);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Proves `snapshot_over` replaces a database already there, which portable mode's copy branch needs.
    #[test]
    fn a_snapshot_can_replace_the_database_already_there() {
        let db = mem_db();
        db.kv_set("anilist_viewer", r#"{"id":7}"#).unwrap();

        let dir = std::env::temp_dir().join(format!("karasu-over-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("karasu.db");
        let _ = std::fs::remove_file(&dest);

        // A first write, then a second over it with different contents.
        db.snapshot_over(&dest).unwrap();
        db.kv_set("anilist_viewer", r#"{"id":42}"#).unwrap();
        db.snapshot_over(&dest).unwrap();

        let copy = Db(Mutex::new(Connection::open(&dest).unwrap()));
        assert_eq!(copy.kv_get("anilist_viewer").as_deref(), Some(r#"{"id":42}"#));
        // And the temp file it renames through does not survive.
        assert!(!dest.with_extension("db.replacing").exists());

        drop(copy);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Proves a cache miss is distinguishable from a cached empty list, since the caller shows a loading state on `None`.
    #[test]
    fn list_cache_round_trip_and_miss() {
        let db = mem_db();
        assert!(db.cached_list(7, "ANIME").is_none());

        db.cache_list(7, "ANIME", "[{\"entries\":[]}]").unwrap();
        assert_eq!(
            db.cached_list(7, "ANIME").as_deref(),
            Some("[{\"entries\":[]}]")
        );

        // Scoped per user and per media type, or the manga list would render the anime one.
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

        db.library_publish(
            &[
                (154587, 13, "C:/anime/frieren-13.mkv".into()),
                (154587, 14, "C:/anime/frieren-14.mkv".into()),
            ],
            &[(154587, 1.0)],
            &[],
        )
        .unwrap();
        let mut rows = db.library_all();
        rows.sort_by_key(|(_, ep, _)| *ep);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], (154587, 13, "C:/anime/frieren-13.mkv".into()));

        db.library_publish(&[(1, 1, "C:/anime/other-01.mkv".into())], &[(1, 0.82)], &[])
            .unwrap();
        let rows = db.library_all();
        assert_eq!(rows, vec![(1, 1, "C:/anime/other-01.mkv".to_string())]);
    }

    /// Proves the scanner's confidence survives a restart with the index and is replaced by a rescan.
    #[test]
    fn library_scores_round_trip_and_replace() {
        let db = mem_db();
        assert!(db.library_scores().is_empty());

        db.library_publish(
            &[
                (154587, 13, "C:/anime/frieren-13.mkv".into()),
                (1, 1, "C:/anime/other-01.mkv".into()),
            ],
            &[(154587, 1.0), (1, 0.74)],
            &[],
        )
        .unwrap();
        let mut scores = db.library_scores();
        scores.sort_by_key(|(id, _)| *id);
        assert_eq!(scores, vec![(1, 0.74), (154587, 1.0)]);

        // A rescan is the whole picture, so the previous confidences go with the previous paths.
        db.library_publish(&[(1, 1, "C:/anime/other-01.mkv".into())], &[(1, 0.91)], &[])
            .unwrap();
        assert_eq!(db.library_scores(), vec![(1, 0.91)]);
    }

    /// A `LocalWrite` with every field a test does not care about filled in; it always sends a status, so `patch()` exists.
    fn write(media_id: i64, media_type: &'static str) -> LocalWrite<'static> {
        LocalWrite {
            media_id,
            media_type,
            status: Some("CURRENT"),
            progress: Some(0),
            progress_volumes: Some(0),
            score: Some(0.0),
            repeat: Some(0),
            notes: Some(""),
            private: None,
            started_at: None,
            completed_at: None,
            media_json: None,
            updated_ms: 1_000,
        }
    }

    /// What the UI actually sends for a `+1`: a key, a timestamp, and nothing else.
    fn patch(media_id: i64, media_type: &'static str) -> LocalWrite<'static> {
        LocalWrite {
            media_id,
            media_type,
            status: None,
            progress: None,
            progress_volumes: None,
            score: None,
            repeat: None,
            notes: None,
            private: None,
            started_at: None,
            completed_at: None,
            media_json: None,
            updated_ms: 2_000,
        }
    }

    #[test]
    fn local_list_round_trips_volumes() {
        let db = mem_db();
        db.local_upsert(LocalWrite {
            progress: Some(120),
            progress_volumes: Some(12),
            media_json: Some("{}"),
            ..write(7, "MANGA")
        })
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
        db.local_upsert(LocalWrite {
            progress: Some(121),
            progress_volumes: Some(12),
            updated_ms: 2_000,
            ..write(7, "MANGA")
        })
        .unwrap();
        let row = db.local_all().into_iter().find(|r| r.media_id == 7).unwrap();
        assert_eq!(row.progress, 121);
        assert_eq!(row.progress_volumes, 12);
    }

    /// Proves v7 leaves existing rows readable with a zero, which `local_rows` would otherwise drop as NULL.
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
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 7);

        // The rest of the ladder, because `local_rows` reads every column the current schema has.
        conn.execute_batch(MIGRATION_V8).unwrap();
        conn.execute_batch(MIGRATION_V9).unwrap();
        conn.execute_batch(MIGRATION_V10).unwrap();
        conn.execute_batch(MIGRATION_V11).unwrap();
        conn.execute_batch(MIGRATION_V12).unwrap();
        conn.execute_batch(MIGRATION_V13).unwrap();
        conn.execute_batch(MIGRATION_V14).unwrap();
        conn.execute_batch(MIGRATION_V15).unwrap();
        conn.execute_batch(MIGRATION_V16).unwrap();

        let db = Db(Mutex::new(conn));
        let row = db.local_all().into_iter().find(|r| r.media_id == 3).unwrap();
        assert_eq!(row.progress, 40);
        assert_eq!(row.progress_volumes, 0);
        // v14's three columns backfill the same way: not private, no dates.
        assert!(!row.private);
        assert_eq!(row.started_at, None);
        assert_eq!(row.completed_at, None);
    }

    #[test]
    fn local_upsert_and_render() {
        let db = mem_db();
        db.local_upsert(LocalWrite {
            progress: Some(3),
            score: Some(8.0),
            repeat: Some(1),
            notes: Some("note"),
            media_json: Some(r#"{"id":5,"title":{"romaji":"X"}}"#),
            updated_ms: 2_000,
            ..write(5, "ANIME")
        })
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
        db.local_upsert(LocalWrite {
            status: Some("PLANNING"),
            media_json: Some("{\"id\":1}"),
            ..write(1, "MANGA")
        })
        .unwrap();
        // Edit without re-supplying media metadata.
        db.local_upsert(LocalWrite {
            progress: Some(2),
            progress_volumes: Some(1),
            updated_ms: 3_000,
            ..write(1, "MANGA")
        })
        .unwrap();
        let rows = db.local_all();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "CURRENT");
        assert_eq!(rows[0].media_json.as_deref(), Some("{\"id\":1}"));
    }

    #[test]
    fn local_delete_removes_row() {
        let db = mem_db();
        db.local_upsert(LocalWrite {
            status: Some("COMPLETED"),
            progress: Some(12),
            score: Some(10.0),
            media_json: Some("{}"),
            ..write(9, "ANIME")
        })
        .unwrap();
        db.local_delete(9, "ANIME").unwrap();
        assert!(db.local_all().is_empty());
    }

    #[test]
    fn notifications_insert_list_and_read() {
        let db = mem_db();
        db.notif_insert("airing", "New episode", "Ep 5 is out", 1_000, None, None)
            .unwrap();
        db.notif_insert("sequel", "Sequel announced", "A sequel", 2_000, None, None)
            .unwrap();

        let all = db.notif_all(50, None);
        assert_eq!(all.len(), 2);
        // Newest first.
        assert_eq!(all[0].kind, "sequel");
        assert_eq!(db.notif_unread_count(None), 2);

        db.notif_mark_read(all[0].id).unwrap();
        assert_eq!(db.notif_unread_count(None), 1);

        db.notif_mark_all_read().unwrap();
        assert_eq!(db.notif_unread_count(None), 0);
        assert!(db.notif_all(50, None).iter().all(|n| n.read));
    }

    #[test]
    fn clearing_one_kind_spares_the_rest() {
        let db = mem_db();
        db.notif_insert("update", "Update ready", "1.0 is out", 1_000, None, None)
            .unwrap();
        db.notif_insert("airing", "New episode", "Ep 5 is out", 2_000, None, None)
            .unwrap();

        db.notif_clear_kind("update").unwrap();

        let all = db.notif_all(50, None);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].kind, "airing");
    }

    #[test]
    fn notif_all_respects_limit() {
        let db = mem_db();
        for i in 0..5 {
            db.notif_insert("airing", "t", "b", i, None, None).unwrap();
        }
        assert_eq!(db.notif_all(3, None).len(), 3);
    }

    /// Proves a queued edit is served only to the account that made it, never to whoever signs in next.
    #[test]
    fn a_queued_edit_is_invisible_to_another_account() {
        let db = mem_db();
        db.queue_push(111, "save", r#"{"mediaId":1,"progress":5}"#).unwrap();
        db.queue_push(111, "save", r#"{"mediaId":2,"progress":9}"#).unwrap();
        db.queue_push(222, "save", r#"{"mediaId":3,"progress":1}"#).unwrap();

        assert_eq!(db.queue_all(111).len(), 2);
        assert_eq!(db.queue_len(111), 2);
        // The account that signed in next sees its own row and nothing else, not even an empty-list fallback.
        let theirs = db.queue_all(222);
        assert_eq!(theirs.len(), 1);
        assert!(theirs[0].payload.contains("\"mediaId\":3"));
        // `created_at` is stamped by SQLite, so any positive value proves the column reached the struct.
        assert!(theirs[0].created_at > 0);
        assert_eq!(db.queue_len(222), 1);
        // A third account with nothing queued drains nothing.
        assert!(db.queue_all(333).is_empty());
        assert_eq!(db.queue_len(333), 0);
    }

    /// Proves a discard under another account deletes nothing and the answer says whether anything went.
    #[test]
    fn a_discard_only_removes_the_owners_row() {
        let db = mem_db();
        db.queue_push(111, "save", r#"{"mediaId":1,"progress":5}"#).unwrap();
        let id = db.queue_all(111)[0].id;

        assert!(!db.queue_remove_for(222, id));
        assert_eq!(db.queue_len(111), 1);

        assert!(db.queue_remove_for(111, id));
        assert_eq!(db.queue_len(111), 0);
        // Gone means gone: a second discard reports nothing removed.
        assert!(!db.queue_remove_for(111, id));
    }

    /// Proves v16 attributes pre-existing rows to the cached viewer, the only account that could have written them.
    #[test]
    fn the_queue_migration_attributes_rows_to_the_cached_viewer() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute(
            "INSERT INTO kv (key, value) VALUES ('anilist_viewer', ?1)",
            [r#"{"id":6421433,"name":"Kyusetzu"}"#],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO offline_queue (kind, payload, created_at) VALUES ('save', '{}', 1)",
            [],
        )
        .unwrap();

        conn.execute_batch(MIGRATION_V16).unwrap();

        let owner: i64 = conn
            .query_row("SELECT user_id FROM offline_queue", [], |r| r.get(0))
            .unwrap();
        assert_eq!(owner, 6421433);
    }

    /// Proves v16 drops rows it cannot attribute rather than leaving them for the next account to inherit.
    #[test]
    fn the_queue_migration_drops_rows_it_cannot_attribute() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute(
            "INSERT INTO offline_queue (kind, payload, created_at) VALUES ('save', '{}', 1)",
            [],
        )
        .unwrap();

        conn.execute_batch(MIGRATION_V16).unwrap();

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM offline_queue", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    /// A cached anime list with two entries, for the cache-patch tests.
    fn seed_list(db: &Db) {
        db.cache_list(
            1,
            "ANIME",
            &serde_json::json!([{
                "name": "Watching",
                "entries": [
                    { "id": 10, "mediaId": 100, "progress": 4, "status": "CURRENT" },
                    { "id": 11, "mediaId": 200, "progress": 1, "status": "CURRENT" }
                ]
            }])
            .to_string(),
        )
        .unwrap();
    }

    fn cached_entry(db: &Db, media_id: i64) -> Option<serde_json::Value> {
        let payload = db.cached_list(1, "ANIME")?;
        let lists: serde_json::Value = serde_json::from_str(&payload).ok()?;
        lists
            .as_array()?
            .iter()
            .flat_map(|g| g.get("entries").and_then(|e| e.as_array()).cloned().unwrap_or_default())
            .find(|e| e.get("mediaId").and_then(|v| v.as_i64()) == Some(media_id))
    }

    /// Proves the index and the unmatched list land together and a second publish replaces both.
    #[test]
    fn a_scan_publishes_both_tables_at_once() {
        let db = mem_db();
        db.library_publish(
            &[(100, 1, "/a/ep1.mkv".into())],
            &[(100, 0.95)],
            &[("Unplaceable".into(), -1, 3, "/a/x.mkv".into())],
        )
        .unwrap();
        assert_eq!(db.library_all().len(), 1);
        assert_eq!(db.library_unmatched().len(), 1);

        // A second publish replaces both, rather than merging into either.
        db.library_publish(&[], &[], &[]).unwrap();
        assert!(db.library_all().is_empty());
        assert!(db.library_unmatched().is_empty(), "no stale leftovers");
    }

    #[test]
    fn a_saved_entry_reaches_the_cache_the_guards_read() {
        let db = mem_db();
        seed_list(&db);
        db.cache_patch_entry(
            1,
            "ANIME",
            100,
            &serde_json::json!({ "progress": 24, "status": "COMPLETED" }),
        );
        let entry = cached_entry(&db, 100).expect("still cached");
        assert_eq!(entry["progress"], 24);
        assert_eq!(entry["status"], "COMPLETED");
        // The neighbour is untouched.
        assert_eq!(cached_entry(&db, 200).unwrap()["progress"], 1);
    }

    /// Proves a patch changes only the fields it names, the same absent-means-unchanged rule the mutation follows.
    #[test]
    fn a_patch_leaves_the_fields_it_does_not_name() {
        let db = mem_db();
        seed_list(&db);
        db.cache_patch_entry(1, "ANIME", 100, &serde_json::json!({ "score": 9 }));
        let entry = cached_entry(&db, 100).unwrap();
        assert_eq!(entry["score"], 9);
        assert_eq!(entry["progress"], 4, "not blanked by a patch about score");
        assert_eq!(entry["status"], "CURRENT");
    }

    /// Proves a deleted entry leaves the cache, or it stays a scrobble candidate and gets recreated on the next episode.
    #[test]
    fn a_deleted_entry_stops_being_a_scrobble_candidate() {
        let db = mem_db();
        seed_list(&db);
        assert!(db.cache_forget_entry_id(1, 10), "the entry id is what delete has");
        assert!(cached_entry(&db, 100).is_none(), "gone from the cache");
        assert!(cached_entry(&db, 200).is_some(), "and only that one");
    }

    /// Proves patching an uncached entry writes nothing, so it cannot resurrect a list since replaced.
    #[test]
    fn patching_an_uncached_entry_changes_nothing() {
        let db = mem_db();
        seed_list(&db);
        assert!(!db.cache_patch_entry(1, "ANIME", 999, &serde_json::json!({ "progress": 3 })));
        assert!(!db.cache_forget_entry_id(1, 999));
        assert_eq!(cached_entry(&db, 100).unwrap()["progress"], 4);
    }

    #[test]
    fn a_bell_row_is_invisible_to_another_account() {
        let db = mem_db();
        db.notif_insert("airing", "Ep 5", "is out", 1_000, Some(16498), Some(1))
            .unwrap();
        db.notif_insert("sequel", "A sequel", "announced", 2_000, None, Some(2))
            .unwrap();

        let mine = db.notif_all(50, Some(1));
        assert_eq!(mine.len(), 1, "only this account's row");
        assert_eq!(mine[0].title, "Ep 5");
        assert_eq!(db.notif_unread_count(Some(1)), 1);
        assert_eq!(db.notif_unread_count(Some(2)), 1);
    }

    /// Proves the update notice belongs to the install, surviving a sign-out and readable with no viewer at all.
    #[test]
    fn the_update_notice_belongs_to_the_install() {
        let db = mem_db();
        db.notif_insert("update", "Update ready", "1.0 is out", 1_000, None, None)
            .unwrap();
        db.notif_insert("airing", "Ep 5", "is out", 2_000, None, Some(1))
            .unwrap();

        assert_eq!(db.notif_all(50, Some(1)).len(), 2);
        assert_eq!(db.notif_all(50, Some(2)).len(), 1, "the update notice only");
        assert_eq!(db.notif_all(50, None).len(), 1, "signed out, same answer");

        db.notif_clear_owned().unwrap();
        let left = db.notif_all(50, None);
        assert_eq!(left.len(), 1, "the account's row goes, the install's stays");
        assert_eq!(left[0].kind, "update");
    }

    /// Proves the alert dedupe keys go with the account, or the next one is silently denied what it has never seen.
    #[test]
    fn the_alert_dedupe_keys_do_not_outlive_an_account() {
        let db = mem_db();
        db.kv_set("aired:1:5", "9000").unwrap();
        db.kv_set("sequel_seen:42", "1").unwrap();
        db.kv_set("stale_done:7", "1").unwrap();
        db.kv_set("blur_adult", "1").unwrap();

        assert_eq!(db.kv_delete_prefix("aired:"), 1);
        assert_eq!(db.kv_delete_prefix("sequel_seen:"), 1);
        assert_eq!(db.kv_delete_prefix("stale_done:"), 1);
        assert!(db.kv_get("aired:1:5").is_none());
        assert_eq!(
            db.kv_get("blur_adult").as_deref(),
            Some("1"),
            "a setting is not an account's business"
        );
    }

    /// Proves a malformed viewer blob does not throw in v16 or v18, since `json_extract` raises without `json_valid`.
    #[test]
    fn a_malformed_viewer_blob_does_not_block_the_upgrade() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        conn.execute_batch(MIGRATION_V2).unwrap();
        conn.execute_batch(MIGRATION_V3).unwrap();
        conn.execute_batch(MIGRATION_V4).unwrap();
        conn.execute_batch(MIGRATION_V5).unwrap();
        conn.execute(
            "INSERT INTO kv (key, value) VALUES ('anilist_viewer', 'not json')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO offline_queue (kind, payload, created_at) VALUES ('save', '{}', 1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO notifications (kind, title, body, created_ms) VALUES ('airing','t','b',1)", [])
            .unwrap();

        conn.execute_batch(MIGRATION_V16)
            .expect("v16 must survive a malformed viewer blob");
        conn.execute_batch(MIGRATION_V18)
            .expect("v18 must survive a malformed viewer blob");
    }

    #[test]
    fn a_notification_remembers_the_media_it_is_about() {
        let db = mem_db();
        db.notif_insert("airing", "New episode", "Ep 5 is out", 1_000, Some(16498), None)
            .unwrap();
        db.notif_insert("update", "Update ready", "0.24.0", 2_000, None, None)
            .unwrap();

        // Newest first.
        let all = db.notif_all(50, None);
        assert_eq!(all[0].media_id, None, "an app update is not about a title");
        assert_eq!(all[1].media_id, Some(16498));
    }
}

