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
    if !today.exists() {
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
                run_once(&app);
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
}
