//! Daily local snapshots of `karasu.db` — the no-cloud answer to backup.
//!
//! One file per civil UTC day in `<data>/backups/`, written through
//! `Db::snapshot_to` (`VACUUM INTO`, which also requires the target not to
//! exist — the skip-if-present check below is load-bearing, not an
//! optimisation). Retention keeps the newest N and touches only names this
//! module writes; a stray file in the folder is someone else's business.
//!
//! The loop wakes hourly rather than sleeping a day: after today's file
//! exists a pass is one metadata check, and the short interval is what makes
//! a laptop that sleeps through the appointed hour still get its backup.

use crate::db::Db;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const BACKUP_ENABLED_KEY: &str = "backup_enabled";
const BACKUP_KEEP_KEY: &str = "backup_keep";
const DEFAULT_KEEP: usize = 7;
/// A sanity rail, not a policy: sixty daily files of a small database.
const MAX_KEEP: usize = 60;

pub(crate) fn read_enabled(db: &Db) -> bool {
    db.kv_get(BACKUP_ENABLED_KEY).as_deref() != Some("0")
}

pub(crate) fn read_keep(db: &Db) -> usize {
    db.kv_get(BACKUP_KEEP_KEY)
        .and_then(|v| v.parse().ok())
        .filter(|&n| (1..=MAX_KEEP).contains(&n))
        .unwrap_or(DEFAULT_KEEP)
}

/// `karasu-YYYYMMDD.db` for the given instant. Civil UTC on purpose — the
/// name is an identity, and a timezone-dependent one would write two files
/// for one day across a travel day.
fn backup_name(epoch_secs: i64) -> String {
    let (y, m, d) = crate::logging::civil_date(epoch_secs);
    format!("karasu-{y:04}{m:02}{d:02}.db")
}

fn is_backup_name(name: &str) -> bool {
    const PREFIX: &str = "karasu-";
    name.len() == "karasu-00000000.db".len()
        && name.starts_with(PREFIX)
        && name.ends_with(".db")
        && name[PREFIX.len()..PREFIX.len() + 8]
            .bytes()
            .all(|b| b.is_ascii_digit())
}

/// Which files to delete, given a listing and how many to keep. `YYYYMMDD`
/// sorts chronologically as text, so the oldest are simply the front of the
/// sorted list.
fn prune_candidates(names: &[String], keep: usize) -> Vec<String> {
    let mut ours: Vec<&String> = names.iter().filter(|n| is_backup_name(n)).collect();
    ours.sort();
    let excess = ours.len().saturating_sub(keep);
    ours.into_iter().take(excess).cloned().collect()
}

pub(crate) fn write_settings(db: &Db, enabled: bool, keep: usize) -> Result<(), String> {
    db.kv_set(BACKUP_ENABLED_KEY, if enabled { "1" } else { "0" })?;
    db.kv_set(BACKUP_KEEP_KEY, &keep.clamp(1, MAX_KEEP).to_string())
}

fn now_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Whether a file on disk is a database that would actually open.
///
/// `quick_check` rather than `integrity_check`: it reads the pages it needs
/// instead of the whole file, which is what catches the failures that matter
/// here — a truncated or half-written snapshot — without spending seconds on a
/// large database once an hour. A file SQLite refuses to open at all fails at
/// the first step, which is the most common shape of the problem.
fn is_readable_database(path: &Path) -> bool {
    rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .and_then(|c| c.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0)))
    .map(|answer| answer == "ok")
    .unwrap_or(false)
}

/// Puts the newest readable backup in place of a database that will not open.
///
/// Called from `setup` when `Db::open` fails. Without it, a corrupt or
/// truncated `karasu.db` meant the app never started at all — while up to a
/// week of good snapshots sat in a folder beside it, reachable only through
/// the app that would not launch. The user's own copy is kept as
/// `karasu.db.unreadable` rather than deleted: it is still their data, and a
/// support request is easier to answer with it than without.
///
/// Returns the path it restored from, or `None` when there was nothing
/// usable — in which case the caller fails as it did before.
pub fn restore_newest(data_dir: &Path) -> Option<PathBuf> {
    let dir = data_dir.join("backups");
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| is_backup_name(n))
        .collect();
    // Newest first: the names carry a sortable date, which is why they are
    // shaped the way `backup_name` shapes them.
    names.sort_unstable_by(|a, b| b.cmp(a));

    let target = data_dir.join("karasu.db");
    for name in names {
        let candidate = dir.join(&name);
        if !is_readable_database(&candidate) {
            crate::logging::warn("backups", format!("{name} is not readable either; trying older"));
            continue;
        }
        // Move the unreadable file aside rather than overwrite it.
        if target.exists() {
            let aside = data_dir.join("karasu.db.unreadable");
            let _ = std::fs::remove_file(&aside);
            if let Err(e) = std::fs::rename(&target, &aside) {
                crate::logging::error("backups", format!("cannot set the broken database aside: {e}"));
                return None;
            }
        }
        match std::fs::copy(&candidate, &target) {
            Ok(_) => {
                crate::logging::info("backups", format!("restored the database from {name}"));
                return Some(candidate);
            }
            Err(e) => {
                crate::logging::error("backups", format!("cannot restore {name}: {e}"));
                return None;
            }
        }
    }
    None
}

/// One pass: today's snapshot if absent, then the prune. Also called
/// directly when the setting is switched on, so enabling produces a backup
/// now rather than within the hour.
pub(crate) fn run_once(app: &AppHandle) {
    let db = app.state::<Db>();
    if !read_enabled(&db) {
        return;
    }
    let Ok(base) = app.path().app_data_dir() else {
        return;
    };
    let dir = crate::portable::data_dir(base).join("backups");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        crate::logging::warn("backup", format!("cannot create the backup folder: {e}"));
        return;
    }

    let name = backup_name(now_secs());
    let today = dir.join(&name);
    // Presence used to be the whole test, so a file truncated by a full disk or
    // a process killed mid-`VACUUM` was never rewritten and still occupied one
    // of the retained slots — a backup that cannot be restored, held in the
    // place of one that could. Rewriting an unreadable one is cheap; finding
    // out at restore time is not.
    if !today.exists() || !is_readable_database(&today) {
        if today.exists() {
            crate::logging::warn(
                "backup",
                format!("{name} is not a readable database; writing it again"),
            );
            if let Err(e) = std::fs::remove_file(&today) {
                // `VACUUM INTO` refuses an existing destination, so a file that
                // cannot be removed cannot be replaced either.
                crate::logging::warn("backup", format!("could not remove {name}: {e}"));
                return;
            }
        }
        match db.snapshot_to(&today) {
            Ok(()) => crate::logging::info("backup", format!("wrote {name}")),
            Err(e) => {
                crate::logging::warn("backup", format!("could not write {name}: {e}"));
                return;
            }
        }
    }

    let names: Vec<String> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    for stale in prune_candidates(&names, read_keep(&db)) {
        if let Err(e) = std::fs::remove_file(dir.join(&stale)) {
            crate::logging::warn("backup", format!("could not prune {stale}: {e}"));
        }
    }
}

pub fn spawn(app: AppHandle) {
    crate::logging::supervise("backups", move || {
        let app = app.clone();
        async move {
            loop {
                // `spawn_blocking`, not a bare call. `run_once` is all
                // synchronous filesystem work, and its expensive step is
                // `VACUUM INTO` over the whole database — bounded by the file's
                // size and the disk's speed, neither of which this code gets to
                // choose. On the async runtime that parks a worker thread for
                // the duration, and the workers are shared with every other
                // background pass and with the AniList client.
                //
                // A join error means the blocking task itself panicked;
                // `supervise` restarts the loop, so it is logged and the sleep
                // still happens rather than spinning.
                let handle = app.clone();
                if let Err(e) = tokio::task::spawn_blocking(move || run_once(&handle)).await {
                    crate::logging::warn("backup", format!("the backup pass failed: {e}"));
                }
                tokio::time::sleep(std::time::Duration::from_secs(60 * 60)).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_name_is_the_civil_utc_day() {
        assert_eq!(backup_name(0), "karasu-19700101.db");
        // A leap day, to lean on the era arithmetic rather than a happy path.
        assert_eq!(backup_name(1_709_164_800), "karasu-20240229.db");
        assert_eq!(backup_name(1_786_000_000), "karasu-20260806.db");
    }

    #[test]
    fn pruning_keeps_the_newest_and_ignores_what_it_did_not_write() {
        let names = vec![
            "karasu-20260801.db".to_string(),
            "karasu-20260803.db".to_string(),
            "karasu-20260802.db".to_string(),
            "karasu.db".to_string(),
            "karasu-notadate.db".to_string(),
            "unrelated.txt".to_string(),
        ];
        assert_eq!(prune_candidates(&names, 2), vec!["karasu-20260801.db"]);
        assert!(prune_candidates(&names, 3).is_empty());
        assert!(prune_candidates(&[], 7).is_empty());
    }

    #[test]
    fn only_this_modules_names_are_candidates() {
        assert!(is_backup_name("karasu-20260814.db"));
        assert!(!is_backup_name("karasu.db"));
        assert!(!is_backup_name("karasu-2026081.db"));
        assert!(!is_backup_name("karasu-2026081411.db"));
        assert!(!is_backup_name("karasu-abcdefgh.db"));
        assert!(!is_backup_name("karasu-20260814.db.bak"));
    }

    /// The failure this exists for: a database that will not open, with good
    /// snapshots sitting beside it that only the app could reach.
    #[test]
    fn a_broken_database_is_replaced_by_the_newest_readable_backup() {
        let dir = std::env::temp_dir().join(format!("karasu-restore-{}", std::process::id()));
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();

        // Two real databases, and a newer one that is not.
        for (name, good) in [("karasu-20260829.db", true), ("karasu-20260830.db", true)] {
            let path = backups.join(name);
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE marker (which TEXT);").unwrap();
            conn.execute("INSERT INTO marker (which) VALUES (?1)", [name]).unwrap();
            drop(conn);
            assert_eq!(is_readable_database(&path), good);
        }
        std::fs::write(backups.join("karasu-20260831.db"), b"not a database").unwrap();
        std::fs::write(dir.join("karasu.db"), b"also not a database").unwrap();

        let from = restore_newest(&dir).expect("a readable backup exists");
        assert!(
            from.ends_with("karasu-20260830.db"),
            "the newest *readable* one, skipping the corrupt newer file: {from:?}"
        );

        // The restored file is the one that was chosen, and the broken
        // original is kept rather than thrown away.
        let conn = rusqlite::Connection::open(dir.join("karasu.db")).unwrap();
        let which: String = conn
            .query_row("SELECT which FROM marker", [], |r| r.get(0))
            .unwrap();
        assert_eq!(which, "karasu-20260830.db");
        drop(conn);
        assert!(dir.join("karasu.db.unreadable").exists(), "the user's own file is kept");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Nothing usable means the caller fails exactly as it did before, rather
    /// than starting on an empty database and looking like data loss.
    #[test]
    fn no_usable_backup_restores_nothing() {
        let dir = std::env::temp_dir().join(format!("karasu-restore-none-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("backups")).unwrap();
        std::fs::write(dir.join("backups").join("karasu-20260830.db"), b"junk").unwrap();
        assert!(restore_newest(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}