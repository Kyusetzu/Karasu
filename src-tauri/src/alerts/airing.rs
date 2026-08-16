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
/// Must equal the `perPage` in `AIRING_QUERY`; a test pins the two together.
/// Getting a full page back is the only signal that the answer was truncated —
/// the query asks for no `pageInfo`.
const PAGE_SIZE: usize = 50;
/// How long an `aired:` dedupe key is worth keeping.
///
/// Generous on purpose: the checkpoint only ever moves forward, so a key older
/// than the longest plausible backlog-drain can never be consulted again. Thirty
/// days is far past that and still bounds the table.
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

pub fn spawn(app: AppHandle) {
    // Supervised: a panic in here used to take the airing checks down for the
    // rest of the session with nothing said. The startup delay repeating on a
    // restart is deliberate — it doubles as the first backoff.
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
    // Keep last_check and retry next round either way, but say which it was:
    // a network blip and a schema break took the same silent branch, so "airing
    // notifications stopped" had no cause anyone could report.
    let data = match api.query(None, AIRING_QUERY, vars).await {
        Ok(data) => data,
        Err(e) => {
            // `From<ApiError> for String` is what distinguishes a network error
            // from an API one, which is the distinction worth recording.
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
    // How far this run actually got. `sort: TIME` is ascending, so a full page
    // is the *oldest* 50 in the window and the newest are the ones missing.
    let mut reached = last;

    for sched in page {
        let episode = sched.get("episode").and_then(|v| v.as_i64()).unwrap_or(0);
        let media_id = sched.pointer("/media/id").and_then(|v| v.as_i64()).unwrap_or(0);
        // Before the dedupe: a schedule that was skipped was still *seen*, and
        // the checkpoint is about what the window covered, not what it notified.
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
        crate::alerts::notify::notify(
            app,
            "airing",
            crate::i18n::Msg::AiringTitle,
            crate::i18n::Msg::AiringBody { title: &title, episode },
            // `media_id` above falls back to 0, and a row carrying that would
            // mint a `/media/0` route the bell would happily open.
            (media_id > 0).then_some(media_id),
        );
        let _ = db.kv_set(&key, &now.to_string());
    }

    // One kv row per episode, kept forever, was the shape here: a few thousand
    // a year for someone following a full season, none of them ever read again
    // once the checkpoint has moved past that episode. `airing_last_check` is
    // what actually stops a re-notification — these keys only absorb the
    // overlap at the window boundary, so anything older than the retention
    // below cannot be consulted again and is safe to drop.
    db.kv_prune_older("aired:", now - AIRED_KEY_TTL_SECS);

    // A full page means the answer was cut off, and moving the checkpoint to
    // `now` would step over every episode past the fiftieth — permanently, since
    // no `aired:` key was written for them and no later window reaches back.
    // Stopping at the last one seen lets the 20-minute interval drain the
    // backlog instead. `airingAt_greater` is strictly greater, so the -1 keeps
    // any schedule sharing that second; the `aired:` keys absorb the overlap.
    let checkpoint = if page.len() >= PAGE_SIZE { reached.saturating_sub(1) } else { now };
    let _ = db.kv_set("airing_last_check", &checkpoint.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The truncation check reads a page length against `PAGE_SIZE`, and the
    /// page length is whatever the query asked for. Nothing else ties them
    /// together, so lowering `perPage` for a rate-limit tune would silently
    /// turn the checkpoint back into the bug it fixes: never full, always `now`.
    #[test]
    fn the_page_size_matches_the_query_that_produces_it() {
        assert!(
            AIRING_QUERY.contains(&format!("perPage: {PAGE_SIZE}")),
            "AIRING_QUERY no longer asks for {PAGE_SIZE} results per page",
        );
    }
}
