use crate::sync::LockExt;
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

/// A user-confirmed season split: \"episodes `ep_from..=ep_to` of this parse
/// belong to `media_id`, renumbered from `dst_start`\".
///
/// The record shape is exactly `relations::Rule` — a source range and a
/// destination start — but keyed on the parsed `(title, season)` like
/// `library_override`, because the user is correcting the *parse* and the
/// correction must survive the next scan. Unlike an override it also carries an
/// episode range: a 24-file folder for a 12-episode show holds two shows under
/// one parse key, which is precisely what `library_override` cannot express.
///
/// `season` is `-1` where the release name carried none, matching v9's
/// convention and for the same reason. User data: a scan must never clear it.
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

/// What the user says a *detected* title really is.
///
/// The same `(title, season)` idea as v9's `library_override`, and for the same
/// reason — the correction must outlive the thing that produced it — but a
/// deliberately separate table, because the two key spaces are different
/// populations that happen to share a shape:
///
/// - The producers differ. `index_files` parses a *filename*; `build_now_playing`
///   parses a cleaned window or media-session title, or takes Jellyfin's own
///   `SeriesName`. They coincide for a local file in mpv and diverge everywhere
///   else, so one table would let a correction typed against a browser tab
///   silently re-point files on disk at the next scan.
/// - Detection covers manga; the library scanner does not. Hence `media_type` in
///   the key: a chapter title and an episode title may normalise to the same
///   string and mean different entries.
/// - `clear_library_match` deletes an override *and every redirect on its key*,
///   and `set_library_match` refuses while a scan is running. Sharing would make
///   "undo" on one screen quietly undo the other, and make a now-playing button
///   fail for a reason the user cannot connect to what they clicked.
///
/// `display_title` is the chosen entry's title, stored because the picker has it
/// in hand at correction time. It costs one column and buys two things with no
/// request at all: the Settings list can name what each row points at, and a
/// forced entry that is not on the cached list still reads as itself on screen.
///
/// `season = -1` where the parse carried none, per v9. User data: nothing on a
/// scan or a poll may clear it.
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

/// How far the source's episode numbering sits from the entry's.
///
/// v12 could say *which entry* a detected title is, and nothing about *which
/// episode*. That covers a franchise whose seasons are separate AniList
/// entries — Jellyfin's S2E1 is episode 1 of the sequel — but not the other
/// layout, where a server splits one continuously-numbered entry into cours
/// and its S2E1 is episode 13. Only the viewer knows which they are looking
/// at, so it is stored beside the entry they picked.
///
/// Signed, and applied as `reported + offset`: a source can number *ahead* of
/// AniList as easily as behind. Zero for every existing row, which is exactly
/// what those corrections meant.
const MIGRATION_V13: &str = "
ALTER TABLE detection_override ADD COLUMN episode_offset INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 13;
";

/// Schema v14: start date, finish date and privacy on the local list.
///
/// The account-free list had none of them, so `local_list_json` emitted a
/// hard-coded `false` and two nulls and the editor hid the controls — three
/// fields the app understands everywhere else, missing for the one user who
/// chose not to sign in. Nothing about them needs an account: a date is a date,
/// and "private" locally means the same thing it means in an export.
///
/// The dates are stored as the JSON text of AniList's own `FuzzyDate`
/// (`{"year":2024,"month":3,"day":null}`) rather than as an ISO string, because
/// every part is independently nullable and the frontend already speaks that
/// shape end to end. A partial date is a real answer here, not a broken one.
const MIGRATION_V14: &str = "
ALTER TABLE local_list ADD COLUMN started_at TEXT;
ALTER TABLE local_list ADD COLUMN completed_at TEXT;
ALTER TABLE local_list ADD COLUMN private INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 14;
";

/// Schema v15: which media a notification is about.
///
/// The table stored rendered sentences and nothing else, so the one thing
/// anyone wants from a "new episode aired" row — the show it is about — was a
/// search away. AniList's own rows in the same panel have opened the title
/// since they landed, which left Karasu's half of the bell looking inert beside
/// them. Every writer already had the id in hand and dropped it on the floor.
///
/// Nullable rather than defaulted, because two of the five callers genuinely
/// have nothing to point at: the app-update notice is not about a title, and a
/// dropped-queue report with `n > 1` covers several. NULL therefore reads as
/// "nothing to open" rather than "not migrated" — which is also the truth about
/// every row written before this step, so they need no backfill and could not
/// have one: their rendered title is the only handle, and matching that back to
/// an id would be a guess.
const MIGRATION_V15: &str = "
ALTER TABLE notifications ADD COLUMN media_id INTEGER;
PRAGMA user_version = 15;
";

/// Schema v16: which account a queued edit belongs to.
///
/// `anilist_logout` deletes the token and the cached viewer and left the queue
/// alone, and a queued row carried only a `mediaId` — so edits made under one
/// account were drained under whatever token signed in next. Signing out of A
/// and into B wrote A's unsynced progress onto B's list, silently, on B's first
/// list fetch.
///
/// Clearing the queue on logout would have closed it without a migration, but
/// an offline queue exists precisely so unsynced edits survive; discarding them
/// because someone signed out to fix a token is the same class of loss one step
/// removed. Stamping the row is what lets both hold.
///
/// Rows that predate the column are attributed to the cached viewer, which is
/// the only account that could have written them. With no cached viewer there
/// is nobody to attribute them to, and an unattributable queued write is the
/// exact hazard this closes — so those are dropped rather than guessed at.
/// `json_extract` is built into SQLite itself since 3.38, well below what
/// rusqlite bundles.
const MIGRATION_V16: &str = "
ALTER TABLE offline_queue ADD COLUMN user_id INTEGER;
UPDATE offline_queue
   SET user_id = (SELECT json_extract(value, '$.id') FROM kv
                   WHERE key = 'anilist_viewer' AND json_valid(value));
DELETE FROM offline_queue WHERE user_id IS NULL;
PRAGMA user_version = 16;
";

/// Schema v17: `blur_adult` defaults on for new installs only.
///
/// The setting arrived defaulting to on for everyone, and `get_blur_adult`
/// reads absence as on — so an existing user who had never opened the setting
/// would have their covers blurred by an update they did not ask for. Turning
/// it on for people choosing their settings for the first time is the wanted
/// behaviour; changing it under people who already had a working screen is not.
///
/// Absence of the key cannot tell those two populations apart, so the answer is
/// written down once, here, while the difference is still observable: **an
/// empty `kv` table means nothing has ever been stored, which only happens on a
/// database being created right now.** Every migration below runs before any
/// setting is written, so on a fresh install this sees an empty table.
///
/// The imprecision, stated rather than hidden: a long-standing install that
/// never signed in and never changed a single setting also has an empty `kv`,
/// and is read as new. That user gets the blur on — the same answer a new
/// install gets, for someone who has expressed no preference either way.
///
/// `WHERE NOT EXISTS` on the key itself keeps the step re-runnable, which the
/// `ALTER TABLE` steps above cannot be, and means an explicit choice already
/// made is never overwritten.
const MIGRATION_V17: &str = "
INSERT INTO kv (key, value)
SELECT 'blur_adult', CASE WHEN EXISTS (SELECT 1 FROM kv) THEN '0' ELSE '1' END
WHERE NOT EXISTS (SELECT 1 FROM kv WHERE key = 'blur_adult');
PRAGMA user_version = 17;
";

/// v18 gives `notifications` an owner, for the reason v16 gave one to
/// `offline_queue`: the table had no account column at all, so every bell row
/// the app wrote for one account was read back for the next one. Signing out
/// of A and into B showed B a list of A's aired episodes and sequel
/// announcements.
///
/// `user_id` is **nullable, and the null is a real answer**: an app-update
/// notice belongs to the install rather than to an account, and must stay
/// readable while signed out and in local mode. Account-scoped rows carry an
/// id; app-wide rows carry null; the readers ask for `user_id IS NULL OR
/// user_id = ?`.
///
/// The backfill attributes existing rows to the cached viewer, skipping the
/// `update` kind so the one app-wide row that predates this keeps its meaning.
/// A row that cannot be attributed (nobody signed in) simply stays null, which
/// is the harmless direction here — unlike v16, where an unattributable queue
/// row could be *written* to the wrong account and was therefore deleted.
///
/// `json_valid(value)` guards the extract because `json_extract` raises on
/// malformed JSON rather than returning null, and a migration that throws
/// leaves an app that will not start.
const MIGRATION_V18: &str = "
ALTER TABLE notifications ADD COLUMN user_id INTEGER;
UPDATE notifications
   SET user_id = (SELECT json_extract(value, '$.id') FROM kv
                   WHERE key = 'anilist_viewer' AND json_valid(value))
 WHERE kind <> 'update';
PRAGMA user_version = 18;
";

/// One detection correction: what was detected, and what it really is.
///
/// A struct rather than the tuple this started as, because the row grew a
/// sixth field and `(String, i32, String, i64, String, i32)` at three call
/// sites is a puzzle rather than a signature.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionOverride {
    /// The parsed title this fires on — what detection saw.
    pub title: String,
    /// `-1` where the parse carried no season.
    pub season: i32,
    pub media_type: String,
    pub media_id: i64,
    /// The chosen entry's title, stored so the Settings list and an off-list
    /// entry read correctly without a request.
    pub display_title: String,
    /// Added to the detected episode. Signed: a source may number ahead of
    /// AniList as easily as behind.
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
    /// What the bell row opens, when there is something to open. `None` for the
    /// app-update notice, for a dropped-queue report, and for every row written
    /// before schema v15. Renamed individually because this struct carries no
    /// `rename_all` — `created_ms` above is the precedent.
    #[serde(rename = "mediaId")]
    pub media_id: Option<i64>,
    pub read: bool,
}

/// One row of the offline queue.
///
/// `created_at` has been written since the table existed and was never read
/// back — the drain does not care how old a write is, it just sends it. The
/// sync panel does care: "queued 20 minutes ago" is the difference between a
/// backlog that is moving and one that is stuck, and it is the only thing in a
/// queued row that a user can sanity-check against their own memory. No
/// migration; the column was always there.
#[derive(Debug, Clone)]
pub struct QueuedRow {
    pub id: i64,
    pub kind: String,
    pub payload: String,
    /// Unix seconds, from SQLite's own clock (`strftime('%s','now')`).
    pub created_at: i64,
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
    pub private: bool,
    /// AniList's `FuzzyDate` as JSON text, or `None` for no date.
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub updated_ms: i64,
    pub media_json: Option<String>,
}

/// One write to the local list.
///
/// A struct rather than the thirteen positional arguments this would otherwise
/// be — the same reason `DetectionOverride` stopped being a tuple.
///
/// **Every field but the key and the timestamp is `Option`, and `None` means
/// "leave it alone" rather than "set it to nothing"** — the same contract
/// AniList gives an absent GraphQL variable. That has to hold for all of them,
/// because almost nothing in the UI sends a whole entry: `+1` on a list row
/// sends `progress` alone, the status dropdown sends `status` alone, the bulk
/// bar sends one field across a whole selection, and the detail editor omits
/// `progressVolumes` entirely. v14 gave the contract to `private` and the two
/// dates and left the other six defaulting to `PLANNING`/`0`/`""`, so a `+1`
/// reset the status, score, repeat, volume count and notes of the row it was
/// incrementing — and the tags with the notes, since they share the column.
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
        // Before the migrations, which run DDL on *every* open: SQLite's
        // default is an immediate SQLITE_BUSY, and on Android a background
        // job (JobScheduler) can hold a second connection on this file while
        // the app cold-starts — whose open failing aborts startup outright.
        // Five seconds of retry protects both directions. Deliberately not
        // WAL: `snapshot_to` encodes rollback-journal assumptions.
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
        if version < 11 {
            apply(&conn, 11, MIGRATION_V11)?;
        }
        if version < 12 {
            apply(&conn, 12, MIGRATION_V12)?;
        }
        if version < 13 {
            // `ALTER TABLE ADD COLUMN` again, so the same guard v7 needed: it
            // fails outright when the column is already there, and a database
            // interrupted between the ALTER and its version bump would then
            // refuse to open on every launch from then on.
            if has_column(&conn, "detection_override", "episode_offset") {
                apply(&conn, 13, "PRAGMA user_version = 13;")?;
            } else {
                apply(&conn, 13, MIGRATION_V13)?;
            }
        }
        if version < 14 {
            // Three `ALTER TABLE ADD COLUMN`s, so the guard v7 and v13 carry.
            // `apply` wraps the step in a transaction, so all three land or
            // none do and the first column decides the answer for all of them.
            if has_column(&conn, "local_list", "started_at") {
                apply(&conn, 14, "PRAGMA user_version = 14;")?;
            } else {
                apply(&conn, 14, MIGRATION_V14)?;
            }
        }
        if version < 15 {
            // The fourth `ALTER TABLE ADD COLUMN` in the schema, so v7's guard
            // for the fourth time and for the same reason.
            if has_column(&conn, "notifications", "media_id") {
                apply(&conn, 15, "PRAGMA user_version = 15;")?;
            } else {
                apply(&conn, 15, MIGRATION_V15)?;
            }
        }
        if version < 16 {
            // The fifth `ALTER TABLE ADD COLUMN`, so v7's guard again. The
            // attribution and the delete ride in the same step, and `apply`
            // wraps the whole thing in a transaction — a database that gained
            // the column but not the attribution would be one where every
            // pre-existing row is unowned and therefore invisible.
            if has_column(&conn, "offline_queue", "user_id") {
                apply(&conn, 16, "PRAGMA user_version = 16;")?;
            } else {
                apply(&conn, 16, MIGRATION_V16)?;
            }
        }
        if version < 17 {
            // Re-runnable on its own terms, so no `has_column` guard: it is an
            // INSERT guarded on the key it inserts.
            apply(&conn, 17, MIGRATION_V17)?;
        }
        if version < 18 {
            // The sixth `ALTER TABLE ADD COLUMN`, so v7's guard once more: the
            // column and its backfill land together or not at all.
            if has_column(&conn, "notifications", "user_id") {
                apply(&conn, 18, "PRAGMA user_version = 18;")?;
            } else {
                apply(&conn, 18, MIGRATION_V18)?;
            }
        }
        Ok(Db(Mutex::new(conn)))
    }

    pub fn kv_get(&self, key: &str) -> Option<String> {
        let conn = self.0.guard();
        conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .ok()
    }

    /// Sets `key` to `value` only when it grows — a compare-and-set in the
    /// UPDATE itself, so two connections racing the same cursor (the app's
    /// pass and Android's background job) cannot both believe they advanced
    /// it. Returns whether this call was the one that moved it.
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
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM kv
             WHERE substr(key, 1, length(?1)) = ?1
               AND CAST(value AS INTEGER) < ?2",
            rusqlite::params![prefix, cutoff],
        )
        .unwrap_or(0)
    }

    /// Deletes every key under a prefix, whatever its value.
    ///
    /// The sibling of `kv_prune_older` for the case where age is not the
    /// question: on an account change the alert passes' dedupe keys
    /// (`aired:`, `sequel_seen:`, `stale_done:`) are about what the *previous*
    /// account had already been told, and holding them would silently deny the
    /// next account notifications it has never seen.
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
        let conn = self.0.guard();
        conn.execute("VACUUM INTO ?1", rusqlite::params![dest.to_string_lossy()])
            .map(|_| ())
            .map_err(|e| format!("Could not copy the database: {e}"))
    }

    /// `snapshot_to`, but over a file that may already be there.
    ///
    /// `VACUUM INTO` refuses an existing destination — there is a test in this
    /// file asserting exactly that — so portable mode's "replace the database
    /// beside the executable" branch could never succeed: it printed a raw
    /// SQLite error, and the only route to a portable copy was deleting the old
    /// file by hand.
    ///
    /// Written beside the destination and renamed over it, rather than deleting
    /// first: a rename within one directory is atomic, so an interrupted copy
    /// leaves the old database intact instead of neither. The temp file is
    /// cleaned up on the failure path, since a half-written `.tmp` next to a
    /// user's database is its own small alarm.
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

    /// Queues an edit against the account that made it.
    ///
    /// `user_id` is not optional and the drain filters on it: a queued row is a
    /// write waiting to happen, and the one thing it must never do is happen to
    /// somebody else's list. See `MIGRATION_V16`.
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

    /// Everything queued by `user_id`, oldest first. Another account's rows are
    /// not returned — not as an empty-list fallback, not at all.
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

    /// `queue_remove` with the owner in the WHERE clause. The unscoped one is
    /// fine for the drain, which only ever holds ids it read via `queue_all`;
    /// a user-triggered discard resolves its id from a UI snapshot that can be
    /// stale across a sign-out, and v16 exists precisely because rows crossing
    /// accounts was a real data-loss bug. Returns whether a row went.
    pub fn queue_remove_for(&self, user_id: i64, id: i64) -> bool {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM offline_queue WHERE id = ?1 AND user_id = ?2",
            [id, user_id],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    }

    /// The schema version the database is actually on.
    ///
    /// A diagnostics fact worth having because several readers here return an
    /// empty list rather than an error when the shape does not match what they
    /// expect — so "my library is empty" and "the migration did not run" look
    /// identical from the outside.
    pub fn schema_version(&self) -> u32 {
        let conn = self.0.guard();
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .map(|v| v as u32)
            .unwrap_or(0)
    }

    /// The pending badge. Scoped like the drain, so it counts what *this*
    /// account is waiting on rather than what is in the table.
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

    /// Insert or update a local entry. `media_json` is kept from the existing
    /// row when `None`, so field-only edits (progress/status) don't need to
    /// re-supply the media metadata.
    pub fn local_upsert(&self, w: LocalWrite<'_>) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute(
            // Absent means "unchanged" for every column here — the same contract
            // AniList gives an absent GraphQL variable, and what the whole UI
            // relies on, since almost nothing sends a complete entry. A first
            // insert has no previous value to keep, so the `VALUES` list carries
            // the neutral defaults; the `DO UPDATE` clause keeps what is there.
            //
            // Clearing a date is spelled the way AniList spells it, as an object
            // with every part null, which is a present value here rather than an
            // absent one.
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

    /// Media type of an existing local row (media ids are globally unique on
    /// AniList, so the id alone identifies the row).
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
        // Column order here is load-bearing: `map` reads by index, and
        // `collect` below drops rows whose mapping errors. A mismatch does not
        // fail loudly — it silently returns an empty list.
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

    /// A stored `FuzzyDate` back as JSON, or null.
    ///
    /// Unparseable text becomes null rather than an error: the column is
    /// written by exactly one place, so a row that does not parse is a row from
    /// a Karasu that no longer exists, and the entry is worth more than the
    /// date is.
    pub(crate) fn fuzzy_date(stored: Option<&str>) -> serde_json::Value {
        stored
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null)
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
                // Real values since v14. They were a hard-coded `false` and two
                // nulls for as long as the local list existed, which made the
                // shape match the API's while quietly saying "no" to three
                // questions nobody had asked the database. Still emitted
                // explicitly rather than left absent: `MediaListEntry` declares
                // them, so omitting them would make the type a lie and
                // `entry.startedAt` would be `undefined` where the compiler
                // promised an object or null.
                //
                // "Private" locally cannot mean hidden from anyone — there is no
                // account and no feed. It means left out of the MAL export, the
                // one export that hands the list to someone else; the JSON
                // backup keeps the entry and carries the flag with it.
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

    /// Most recent notifications first, capped at `limit`, for one account.
    ///
    /// `viewer` is who is asking. A row with a null `user_id` belongs to the
    /// install rather than to an account — the app-update notice — and is
    /// returned to everyone, including a signed-out or local-mode caller.
    /// Everything else answers only to its owner, which is what stops one
    /// account's aired-episode rows appearing in the next account's bell.
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

    /// Removes every row of one kind — the update notice's exit. A "new
    /// release" row must not outlive the install it announces, and the
    /// retention trim above (newest 500) never reaches it on a quiet
    /// account, so without this the row was effectively permanent.
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

    /// Forgets every account-scoped bell row, keeping the install's own.
    ///
    /// Called when the app changes which account it acts as. The app-update
    /// notice survives because it is not about an account and the user has not
    /// acted on it yet.
    pub fn notif_clear_owned(&self) -> Result<(), String> {
        let conn = self.0.guard();
        conn.execute("DELETE FROM notifications WHERE user_id IS NOT NULL", [])
            .map(|_| ())
            .map_err(|e| format!("Notification clear failed: {e}"))
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
        let mut conn = self.0.guard();
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

    /// Records a correction. Upsert rather than insert: pointing the same
    /// release name somewhere new is a correction of the correction, not a
    /// second opinion to be kept alongside the first.
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

    /// Forgets a correction, letting the matcher have its guess back.
    ///
    /// Returns how many rows that was. Discarding the count made "there was no
    /// correction here" indistinguishable from "removed it", and the caller
    /// needs to tell those apart to avoid reporting success for a no-op.
    pub fn library_override_clear(&self, title: &str, season: i32) -> Result<usize, String> {
        let conn = self.0.guard();
        conn.execute(
            "DELETE FROM library_override WHERE title = ?1 AND season = ?2",
            rusqlite::params![title, season],
        )
        .map_err(|e| format!("Could not clear the correction: {e}"))
    }

    // --- Detection corrections ------------------------------------------------

    /// Every correction the user has made on the now-playing card. Small by
    /// nature — one row per title the matcher gets wrong — so it is read whole
    /// and matched in memory.
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

    /// Records a detection correction. Upsert for `library_override_set`'s
    /// reason: pointing the same detected title somewhere new corrects the
    /// correction rather than adding a second opinion.
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

    /// Forgets one, giving the matcher its guess back. Returns the row count so
    /// a no-op is distinguishable from a removal, exactly as v9's clear does.
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

    /// Every user-confirmed episode-range redirect:
    /// `(title, season, ep_from, ep_to, media_id, dst_start)`.
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

    /// Records a season split. Upsert on the range start, like the overrides:
    /// re-pointing the same range is a correction of the correction.
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

    /// Removes a season split. Returns the row count, for the same reason
    /// `library_override_clear` does.
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

    /// Replaces the suggestions in one transaction. Scan output, like the
    /// unplaced files — and like them, `library_override` is left alone: a
    /// confirmed correction outranks anything a later search comes up with.
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

    /// Replaces the unplaced files in one transaction.
    ///
    /// `library_override` is deliberately untouched: it is the user's, not the
    /// scan's, and wiping it here would undo every correction on the next scan
    /// — which is precisely the failure the whole design exists to avoid.
    pub fn library_replace_unmatched(
        &self,
        unmatched: &[(String, i32, u32, String)],
    ) -> Result<(), String> {
        let mut conn = self.0.guard();
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
        conn.execute_batch(MIGRATION_V11).unwrap();
        conn.execute_batch(MIGRATION_V12).unwrap();
        conn.execute_batch(MIGRATION_V13).unwrap();
        conn.execute_batch(MIGRATION_V14).unwrap();
        conn.execute_batch(MIGRATION_V15).unwrap();
        conn.execute_batch(MIGRATION_V16).unwrap();
        conn.execute_batch(MIGRATION_V17).unwrap();
        conn.execute_batch(MIGRATION_V18).unwrap();
        Db(Mutex::new(conn))
    }

    /// v17 has to tell two populations apart that the key itself cannot.
    #[test]
    fn v17_blurs_by_default_only_where_nothing_was_ever_stored() {
        // A database being created right now: kv is empty when v17 runs, so
        // the person choosing settings for the first time gets the blur on.
        let fresh = mem_db();
        assert_eq!(fresh.kv_get("blur_adult").as_deref(), Some("1"));

        // A database that has been in use: something is already stored, so the
        // screen the user already had does not change under them on an update.
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

    /// The offset is what makes a correction able to say *which episode*, not
    /// only which entry — and it defaults to the "same numbering" every
    /// pre-v13 row meant.
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

    /// The detection correction is its own key space, and the two tables must
    /// not be able to reach into each other — the whole reason v12 exists
    /// rather than a `media_type` column bolted onto v9.
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

    /// A season split keys on its range start, so re-pointing the same range
    /// replaces the earlier answer, a second range on the same parse is its own
    /// row, and clearing returns the honest count.
    #[test]
    fn a_season_split_is_replaced_then_cleared() {
        let db = mem_db();
        db.library_redirect_set("frieren", -1, 13, 24, 555, 1).unwrap();
        db.library_redirect_set("frieren", -1, 13, 28, 556, 1).unwrap();
        assert_eq!(
            db.library_redirects(),
            vec![("frieren".into(), -1, 13, 28, 556, 1)]
        );

        // A second overflow of the same parse — a three-cour folder — is a
        // second range, not a correction of the first.
        db.library_redirect_set("frieren", -1, 29, 40, 557, 1).unwrap();
        assert_eq!(db.library_redirects().len(), 2);

        assert_eq!(db.library_redirect_clear("frieren", -1, 13).unwrap(), 1);
        assert_eq!(
            db.library_redirects(),
            vec![("frieren".into(), -1, 29, 40, 557, 1)]
        );
        assert_eq!(db.library_redirect_clear("frieren", -1, 13).unwrap(), 0);
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
        assert_eq!(version, 18, "and must end up fully migrated");
        drop(conn);

        // v13, v14, v15 and v18 are the other `ALTER TABLE ADD COLUMN` steps,
        // so each needs the same guard and the same proof: the column present,
        // the version behind. v14 adds three columns in one transaction, which
        // is why checking the first one is enough to decide for all three.
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
            assert_eq!(version, 18);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// v14. Three fields the app understands everywhere else, which the local
    /// list answered with a hard-coded `false` and two nulls.
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

        // The editor sends a date only once it has been touched, and a `+1
        // progress` from a list row sends none of the three. Absent has to mean
        // "leave it alone" or an unrelated save would quietly wipe all of them.
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

        // Clearing is AniList's own spelling — the object with every part null
        // — which is a value rather than an absence and therefore lands.
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

    /// The contract above, for the other six columns.
    ///
    /// v14 gave "absent means unchanged" to `private` and the two dates and left
    /// status, progress, volumes, score, repeat and notes writing `excluded.*`
    /// unconditionally — so a `+1` from a list row, which sends `progress` and
    /// nothing else, reset the status to PLANNING and the rest to zero, taking
    /// the tags with the notes they share a column with. Every quick control in
    /// the app sends exactly one field, so this was the common case, not an edge.
    ///
    /// Built from `patch()` rather than `write()` on purpose: the older helper
    /// always supplies a status, which is what kept the test above blind to this.
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

        // The status dropdown is the same shape and used to zero `progress`
        // too — an entry at episode 137 came back at 0 for being paused.
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

    /// A row that does not exist yet has no previous value to keep, so the
    /// neutral defaults still apply — they just moved to the `VALUES` list.
    /// `LocalLibrary`'s "add to list" sends `{mediaId, status}` and relies on it.
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

    /// The other half of the line above: portable mode's "replace what is
    /// there" branch called `snapshot_to` on a path that by definition exists,
    /// so it could never succeed — it printed a raw SQLite error and the only
    /// way to a portable copy was deleting the file by hand.
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
    /// Every field a test does not care about, so the ones it does care about
    /// are the only ones written out at the call site.
    ///
    /// `status` is `Some("CURRENT")` because most tests here read the row back
    /// out of `local_list_json`, which groups by status. That makes this helper
    /// blind to the partial-save bug by construction — a `LocalWrite` built
    /// from it always *sends* a status — so the test for that uses `patch()`.
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

    /// What the UI actually sends: a key, a timestamp, and nothing else.
    ///
    /// The shape `local_save_entry` produces for `{mediaId, progress}` — a `+1`
    /// from a list row. Every absent field must survive the write.
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
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 7);

        // The rest of the ladder, because `local_rows` reads every column the
        // *current* schema has. Stopping at v7 here made this test fail the
        // moment v14 added three more — silently, as an empty list rather than
        // an error, which is the failure mode that function's comment warns
        // about and is worth having a test walk into.
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
        // v14's three columns backfill the same way: a row written before them
        // reads as not private, with no dates.
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

    /// v16. A queued edit belongs to the account that made it.
    ///
    /// `anilist_logout` clears the token and the cached viewer and leaves the
    /// queue standing, and the drain runs on every list fetch with whatever
    /// token is loaded *now* — so before this, signing out of one account and
    /// into another replayed the first account's unsynced edits onto the
    /// second's list.
    #[test]
    fn a_queued_edit_is_invisible_to_another_account() {
        let db = mem_db();
        db.queue_push(111, "save", r#"{"mediaId":1,"progress":5}"#).unwrap();
        db.queue_push(111, "save", r#"{"mediaId":2,"progress":9}"#).unwrap();
        db.queue_push(222, "save", r#"{"mediaId":3,"progress":1}"#).unwrap();

        assert_eq!(db.queue_all(111).len(), 2);
        assert_eq!(db.queue_len(111), 2);
        // The account that signed in next sees its own row and nothing else —
        // not the other two, and not an empty-list fallback that would hide the
        // distinction.
        let theirs = db.queue_all(222);
        assert_eq!(theirs.len(), 1);
        assert!(theirs[0].payload.contains("\"mediaId\":3"));
        // `created_at` is read back rather than merely written. It is stamped by
        // SQLite, so any positive value proves the column reached the struct.
        assert!(theirs[0].created_at > 0);
        assert_eq!(db.queue_len(222), 1);
        // A third account with nothing queued drains nothing.
        assert!(db.queue_all(333).is_empty());
        assert_eq!(db.queue_len(333), 0);
    }

    /// The scoped discard: another account's id must not delete, and the
    /// answer says whether anything went — the UI reports "already gone"
    /// honestly instead of pretending a stale row was removed.
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

    /// The v16 backfill. Rows written before the column existed belong to
    /// whoever was cached at upgrade time — the only account that could have
    /// written them.
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

    /// And with nobody cached there is nobody to attribute them to. An
    /// unattributable queued write is the exact hazard v16 closes, so those
    /// rows are dropped rather than left for the next account to inherit.
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

    /// v15. A bell row that cannot say which title it is about is a sentence,
    /// and the AniList rows in the same panel have opened theirs all along.
    /// The v18 rule, and the reason it exists: bell rows had no owner at all,
    /// so signing out of A and into B showed B a list of A's aired episodes.
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

    /// The null is a real answer: the app-update notice belongs to the install,
    /// not to an account, so it must survive a sign-out and stay readable in
    /// local mode — where there is no viewer to match against at all.
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

    /// The dedupe keys record what the *previous* account was already told.
    /// Keeping them would silently deny the next account notifications it has
    /// never seen.
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

    /// `json_extract` raises on malformed JSON rather than returning null, and
    /// a migration that throws leaves an app that will not start. Both
    /// attributing steps guard with `json_valid`.
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

