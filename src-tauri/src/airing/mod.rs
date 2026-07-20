//! Background airing watcher: periodically asks AniList which episodes of
//! the user's watching anime have aired since the last check and fires a
//! native desktop notification for each — something the website cannot do.

use crate::anilist::client::AniList;
use crate::db::Db;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const CHECK_INTERVAL: Duration = Duration::from_secs(20 * 60);
/// Let the list cache populate before the first check.
const STARTUP_DELAY: Duration = Duration::from_secs(30);

const AIRING_QUERY: &str = "
query ($ids: [Int], $from: Int, $to: Int) {
  Page(perPage: 50) {
    airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      episode
      airingAt
      media { id title { romaji english native } }
    }
  }
}";

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            check(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
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

/// Media IDs the user is actively watching (CURRENT/REPEATING), from cache.
fn watching_ids(db: &Db) -> Vec<i64> {
    let Some(user_id) = db
        .kv_get("anilist_viewer")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("id").and_then(|i| i.as_i64()))
    else {
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
        return;
    }
    let ids = watching_ids(&db);
    if ids.is_empty() {
        return;
    }

    let now = now_secs();
    // First run: only look back a little so we don't spam old episodes.
    let last = db
        .kv_get("airing_last_check")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(now - 3 * 3600);

    let api = app.state::<AniList>();
    let vars = json!({ "ids": ids, "from": last, "to": now });
    let Ok(data) = api.query(None, AIRING_QUERY, vars).await else {
        return; // network error — keep last_check, retry next round
    };

    for sched in data
        .pointer("/Page/airingSchedules")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
    {
        let episode = sched.get("episode").and_then(|v| v.as_i64()).unwrap_or(0);
        let media_id = sched.pointer("/media/id").and_then(|v| v.as_i64()).unwrap_or(0);
        let key = format!("aired:{media_id}:{episode}");
        if db.kv_get(&key).is_some() {
            continue; // already notified
        }
        let title = pick_title(sched.pointer("/media/title"));
        crate::notify::notify(
            app,
            "airing",
            "New episode aired",
            &format!("{title} — episode {episode} is out"),
        );
        let _ = db.kv_set(&key, "1");
    }

    let _ = db.kv_set("airing_last_check", &now.to_string());
}
