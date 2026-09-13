//! Background on-hold reminder: one notification per paused entry untouched longer than the configured months. Opt-in.

use crate::db::Db;
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 3600);
/// Let the list cache populate before the first check.
const STARTUP_DELAY: Duration = Duration::from_secs(90);
const SECS_PER_MONTH: i64 = 30 * 24 * 3600;

pub const DEFAULT_MONTHS: i64 = 3;
const MIN_MONTHS: i64 = 1;
const MAX_MONTHS: i64 = 24;

pub fn spawn(app: AppHandle) {
    // Supervised — see `logging::supervise`.
    crate::logging::supervise("stale", move || {
        let app = app.clone();
        async move {
            tokio::time::sleep(STARTUP_DELAY).await;
            loop {
                check(&app);
                tokio::time::sleep(CHECK_INTERVAL).await;
            }
        }
    });
}

fn now_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Configured threshold in months, clamped to a sane range.
pub fn stale_months(db: &Db) -> i64 {
    db.kv_get("stale_months")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(DEFAULT_MONTHS)
        .clamp(MIN_MONTHS, MAX_MONTHS)
}

fn pick_title(title: Option<&Value>) -> String {
    let get = |k: &str| {
        title
            .and_then(|t| t.get(k))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    get("english")
        .or_else(|| get("romaji"))
        .or_else(|| get("native"))
        .unwrap_or_else(|| "Title".to_string())
}

/// The stale PAUSED entries of a cached list; the content filter applies here, where the media object is in scope.
fn stale_entries(
    lists: &Value,
    now: i64,
    cutoff: i64,
    level: &str,
) -> Vec<(i64, i64, String)> {
    let mut out = Vec::new();
    for group in lists.as_array().into_iter().flatten() {
        for entry in group
            .get("entries")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            if entry.get("status").and_then(|v| v.as_str()) != Some("PAUSED") {
                continue;
            }
            let updated = entry.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0);
            if updated == 0 || now - updated < cutoff {
                continue;
            }
            if let Some(media) = entry.get("media") {
                if crate::commands::media_blocked(media, level) {
                    continue;
                }
            }
            if let Some(id) = entry.pointer("/media/id").and_then(|v| v.as_i64()) {
                out.push((id, updated, pick_title(entry.pointer("/media/title"))));
            }
        }
    }
    out
}

fn check(app: &AppHandle) {
    let db = app.state::<Db>();
    if db.kv_get("stale_notify").as_deref() != Some("1") {
        return;
    }
    let Some(user_id) = db
        .kv_get("anilist_viewer")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("id").and_then(|i| i.as_i64()))
    else {
        return;
    };

    let now = now_secs();
    let months = stale_months(&db);
    let cutoff = months * SECS_PER_MONTH;
    // A filtered title must not arrive as a desktop toast, the one place the filter cannot be taken back.
    let level = crate::commands::read_content_filter(&db);

    for media_type in ["ANIME", "MANGA"] {
        let Some(lists) = db
            .cached_list(user_id, media_type)
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        else {
            continue;
        };
        for (media_id, updated, title) in stale_entries(&lists, now, cutoff, &level) {
            // At most once per (entry, updatedAt): touching the entry makes it eligible again, the built-in dismiss.
            let key = format!("stale_done:{media_id}");
            if db.kv_get(&key).and_then(|s| s.parse::<i64>().ok()) == Some(updated) {
                continue;
            }
            crate::alerts::notify::notify(
                app,
                "stale",
                crate::i18n::Msg::StaleTitle,
                crate::i18n::Msg::StaleBody { title: &title, months },
                Some(media_id),
            );
            let _ = db.kv_set(&key, &updated.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn picks_only_old_paused_entries() {
        let now = 1_000_000_000;
        let cutoff = 3 * SECS_PER_MONTH;
        let lists = json!([{
            "entries": [
                { "status": "PAUSED", "updatedAt": now - cutoff - 10,
                  "media": { "id": 1, "title": { "romaji": "Old Paused" } } },
                { "status": "PAUSED", "updatedAt": now - 5,
                  "media": { "id": 2, "title": { "romaji": "Fresh Paused" } } },
                { "status": "CURRENT", "updatedAt": now - cutoff - 10,
                  "media": { "id": 3, "title": { "romaji": "Old Current" } } },
            ]
        }]);
        let got = stale_entries(&lists, now, cutoff, "off");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, 1);
        assert_eq!(got[0].2, "Old Paused");
    }

    #[test]
    fn ignores_entries_without_timestamp() {
        let now = 1_000_000_000;
        let lists = json!([{
            "entries": [
                { "status": "PAUSED", "updatedAt": 0,
                  "media": { "id": 1, "title": { "romaji": "No Time" } } },
            ]
        }]);
        assert!(stale_entries(&lists, now, 100, "off").is_empty());
    }

    /// A filtered title never becomes a reminder toast.
    #[test]
    fn a_filtered_title_never_becomes_a_reminder() {
        let now = 1_000_000_000;
        let cutoff = 3 * SECS_PER_MONTH;
        let lists = json!([{
            "entries": [
                { "status": "PAUSED", "updatedAt": now - cutoff - 10,
                  "media": { "id": 1, "isAdult": true, "genres": [],
                             "title": { "romaji": "Filtered" } } },
                { "status": "PAUSED", "updatedAt": now - cutoff - 10,
                  "media": { "id": 2, "isAdult": false, "genres": [],
                             "title": { "romaji": "Ordinary" } } },
            ]
        }]);

        let strict = stale_entries(&lists, now, cutoff, "strict");
        assert_eq!(strict.len(), 1, "the adult entry is left out");
        assert_eq!(strict[0].0, 2);

        // And the filter being off is still the filter being off.
        assert_eq!(stale_entries(&lists, now, cutoff, "off").len(), 2);
    }
}
