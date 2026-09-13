//! Background airing watcher: asks AniList which watched episodes aired since the last check and toasts each one.

use crate::anilist::client::AniList;
use crate::db::Db;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const CHECK_INTERVAL: Duration = Duration::from_secs(20 * 60);
/// Let the list cache populate before the first check.
const STARTUP_DELAY: Duration = Duration::from_secs(30);
/// Must equal the `perPage` in `AIRING_QUERY`; a full page is the only signal that the answer was truncated.
const PAGE_SIZE: usize = 50;
/// How long an `aired:` dedupe key is kept; generous, since the checkpoint only ever moves forward.
const AIRED_KEY_TTL_SECS: i64 = 30 * 24 * 3600;

const AIRING_QUERY: &str = "
query ($ids: [Int], $from: Int, $to: Int) {
  Page(perPage: 50) {
    airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      episode
      airingAt
      media { id title { romaji english native } isAdult genres }
    }
  }
}";

/// Woken by a list refresh, so a show added a minute ago is scheduled without waiting out the current sleep.
static REPLAN: tokio::sync::Notify = tokio::sync::Notify::const_new();

pub fn replan() {
    REPLAN.notify_one();
}

pub fn spawn(app: AppHandle) {
    // Supervised so a panic cannot silently end the airing checks; the repeated startup delay is the first backoff.
    crate::logging::supervise("airing", move || {
        let app = app.clone();
        async move {
            tokio::time::sleep(STARTUP_DELAY).await;
            loop {
                check(&app).await;
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

/// The cached viewer blob, parsed once for both readers below.
fn cached_viewer(db: &Db) -> Option<Value> {
    db.kv_get("anilist_viewer")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
}

/// Whether AniList will raise its own AIRING row: both switches must be on, and anything unknown reads as `false`.
fn anilist_covers_airing(viewer: Option<&Value>) -> bool {
    let Some(options) = viewer
        .and_then(|v| v.get("options"))
        .filter(|v| !v.is_null())
    else {
        return false;
    };
    if options.get("airingNotifications").and_then(Value::as_bool) != Some(true) {
        return false;
    }
    match options.get("notificationOptions").and_then(Value::as_array) {
        None => true,
        Some(list) => list
            .iter()
            .find(|o| o.get("type").and_then(Value::as_str) == Some("AIRING"))
            .and_then(|o| o.get("enabled").and_then(Value::as_bool))
            .unwrap_or(true),
    }
}

/// Media IDs the user is actively watching (CURRENT/REPEATING), from cache.
fn watching_ids(db: &Db, viewer: Option<&Value>) -> Vec<i64> {
    let Some(user_id) = viewer.and_then(|v| v.get("id").and_then(|i| i.as_i64())) else {
        return Vec::new();
    };
    let Some(lists) = db
        .cached_list(user_id, "ANIME")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for group in lists.as_array().into_iter().flatten() {
        for entry in group
            .get("entries")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let status = entry.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if status != "CURRENT" && status != "REPEATING" {
                continue;
            }
            if let Some(id) = entry.pointer("/media/id").and_then(|v| v.as_i64()) {
                ids.push(id);
            }
        }
    }
    ids
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
        .unwrap_or_else(|| "Anime".to_string())
}

async fn check(app: &AppHandle) {
    let db = app.state::<Db>();
    if db.kv_get("airing_notify").as_deref() == Some("0") {
        // The checkpoint moves even while the setting is off, or re-enabling it replays every episode aired since.
        let _ = db.kv_set("airing_last_check", &now_secs().to_string());
        return;
    }
    let viewer = cached_viewer(&db);
    let ids = watching_ids(&db, viewer.as_ref());
    if ids.is_empty() {
        return;
    }
    // Decided once per pass: it is an account setting, and the blob cannot change mid-loop.
    let anilist_has_it = anilist_covers_airing(viewer.as_ref());

    let now = now_secs();
    // First run: only look back a little so we don't spam old episodes.
    let last = db
        .kv_get("airing_last_check")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(now - 3 * 3600);

    let api = app.state::<AniList>();
    let vars = json!({ "ids": ids, "from": last, "to": now });
    // The token when there is one: an outage refusing unauthenticated requests still answers signed-in ones.
    let token = crate::anilist::auth::load_token();
    let data = match api.query_from("airing", token.as_deref(), AIRING_QUERY, vars).await {
        Ok(data) => data,
        Err(e) => {
            // `From<ApiError> for String` distinguishes a network error from an API one, which is worth recording.
            crate::logging::warn(
                "airing",
                format!("the airing check failed: {}", String::from(e)),
            );
            return;
        }
    };

    let level = crate::commands::read_content_filter(&db);

    let page: &[Value] = data
        .pointer("/Page/airingSchedules")
        .and_then(|v| v.as_array())
        .map(|v| v.as_slice())
        .unwrap_or(&[]);
    // How far this run got: `sort: TIME` is ascending, so a full page is the oldest and the newest are missing.
    let mut reached = last;

    for sched in page {
        let episode = sched.get("episode").and_then(|v| v.as_i64()).unwrap_or(0);
        let media_id = sched.pointer("/media/id").and_then(|v| v.as_i64()).unwrap_or(0);
        // Before the dedupe: a skipped schedule was still seen, and the checkpoint covers the window, not the notices.
        reached = reached.max(sched.get("airingAt").and_then(|v| v.as_i64()).unwrap_or(0));
        let key = format!("aired:{media_id}:{episode}");
        if db.kv_get(&key).is_some() {
            continue; // already notified
        }
        // A filtered title must not surface as a desktop toast either.
        if let Some(media) = sched.get("media") {
            if crate::commands::media_blocked(media, &level) {
                continue;
            }
        }
        let title = pick_title(sched.pointer("/media/title"));
        let head = crate::i18n::Msg::AiringTitle;
        let body = crate::i18n::Msg::AiringBody { title: &title, episode };
        if anilist_has_it {
            // AniList's own row is the better one, so only the desktop toast, the half AniList cannot do, is sent.
            crate::alerts::notify::notify_toast(app, "airing", head, body);
        } else {
            crate::alerts::notify::notify(
                app,
                "airing",
                head,
                body,
                // `media_id` falls back to 0, and a row carrying that would mint a `/media/0` route the bell would open.
                (media_id > 0).then_some(media_id),
            );
        }
        // Either way the episode is done: the toast fired.
        let _ = db.kv_set(&key, &now.to_string());
    }

    // The `aired:` keys only absorb the window-boundary overlap, so anything older than the retention is safe to drop.
    db.kv_prune_older("aired:", now - AIRED_KEY_TTL_SECS);

    // A full page was cut off: stop at the last one seen so later rounds drain the backlog; the -1 keeps a shared second.
    let checkpoint = if page.len() >= PAGE_SIZE { reached.saturating_sub(1) } else { now };
    let _ = db.kv_set("airing_last_check", &checkpoint.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lowering `perPage` without `PAGE_SIZE` would silently make the checkpoint never full and always `now`.
    #[test]
    fn the_page_size_matches_the_query_that_produces_it() {
        assert!(
            AIRING_QUERY.contains(&format!("perPage: {PAGE_SIZE}")),
            "AIRING_QUERY no longer asks for {PAGE_SIZE} results per page",
        );
    }

    /// Both switches on is the only state in which Karasu leaves the bell row to AniList.
    #[test]
    fn both_switches_on_means_anilist_covers_it() {
        let viewer = json!({
            "id": 6421433,
            "options": {
                "airingNotifications": true,
                "notificationOptions": [
                    { "type": "FOLLOWING", "enabled": true },
                    { "type": "AIRING", "enabled": true },
                ],
            },
        });
        assert!(anilist_covers_airing(Some(&viewer)));
    }

    /// An entry AniList has never stored reads as on, which is AniList's own default.
    #[test]
    fn an_unlisted_airing_entry_reads_as_on() {
        let listed = json!({
            "options": {
                "airingNotifications": true,
                "notificationOptions": [{ "type": "FOLLOWING", "enabled": true }],
            },
        });
        assert!(anilist_covers_airing(Some(&listed)));

        let no_array = json!({ "options": { "airingNotifications": true } });
        assert!(anilist_covers_airing(Some(&no_array)));
    }

    /// Either switch off is enough to keep the row; neither setting may speak for the other.
    #[test]
    fn either_switch_off_keeps_karasus_own_row() {
        let account_wide_off = json!({
            "options": {
                "airingNotifications": false,
                "notificationOptions": [{ "type": "AIRING", "enabled": true }],
            },
        });
        assert!(!anilist_covers_airing(Some(&account_wide_off)));

        let per_type_off = json!({
            "options": {
                "airingNotifications": true,
                "notificationOptions": [{ "type": "AIRING", "enabled": false }],
            },
        });
        assert!(!anilist_covers_airing(Some(&per_type_off)));
    }

    /// A blob without `options`, or no account at all, must read as "AniList will not cover this".
    #[test]
    fn anything_unknown_keeps_karasus_own_row() {
        assert!(!anilist_covers_airing(None), "signed out");

        let older = json!({ "id": 6421433, "name": "Kyusetzu" });
        assert!(!anilist_covers_airing(Some(&older)), "no options block");

        let explicit_null = json!({ "options": null });
        assert!(!anilist_covers_airing(Some(&explicit_null)));

        let no_flag = json!({ "options": { "notificationOptions": [] } });
        assert!(!anilist_covers_airing(Some(&no_flag)), "flag absent");
    }
}
