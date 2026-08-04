//! Background sequel watcher: periodically inspects the relations of the
//! anime/manga you've completed or are watching and fires a desktop
//! notification when a sequel or side story is announced (upcoming or newly
//! releasing) that isn't on your list yet — the kind of heads-up the website
//! never gives you. Opt-in; off by default.

use crate::anilist::client::AniList;
use crate::db::Db;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const CHECK_INTERVAL: Duration = Duration::from_secs(12 * 3600);
const STARTUP_DELAY: Duration = Duration::from_secs(120);
/// Source media queried per run (chunks of 50), to stay under the rate limit.
const BATCH: usize = 50;
const MAX_BATCHES: usize = 6;

const RELATIONS_QUERY: &str = "
query ($ids: [Int], $type: MediaType) {
  Page(perPage: 50) {
    media(id_in: $ids, type: $type) {
      id
      relations {
        edges {
          relationType
          node { id title { romaji english native } status isAdult genres }
        }
      }
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

fn viewer_id(db: &Db) -> Option<i64> {
    db.kv_get("anilist_viewer")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("id").and_then(|i| i.as_i64()))
}

/// Media ids on the cached list for a type, optionally filtered by status.
fn list_ids(db: &Db, user_id: i64, media_type: &str, statuses: Option<&[&str]>) -> Vec<i64> {
    let Some(lists) = db
        .cached_list(user_id, media_type)
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
            if let Some(allowed) = statuses {
                let status = entry.get("status").and_then(|v| v.as_str()).unwrap_or("");
                if !allowed.contains(&status) {
                    continue;
                }
            }
            if let Some(id) = entry.pointer("/media/id").and_then(|v| v.as_i64()) {
                ids.push(id);
            }
        }
    }
    ids
}

/// Whether a relation edge should raise an alert: a sequel or side story that
/// is upcoming or currently releasing and isn't already on the user's list.
fn is_alertable(rel: &str, status: &str, node_id: i64, on_list: &HashSet<i64>) -> bool {
    matches!(rel, "SEQUEL" | "SIDE_STORY")
        && matches!(status, "NOT_YET_RELEASED" | "RELEASING")
        && !on_list.contains(&node_id)
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
        .unwrap_or_else(|| "A related title".to_string())
}

async fn check(app: &AppHandle) {
    let db = app.state::<Db>();
    if db.kv_get("sequel_notify").as_deref() != Some("1") {
        return;
    }
    let Some(user_id) = viewer_id(&db) else {
        return;
    };
    let api = app.state::<AniList>();

    // On the first enabled run, record everything currently found without
    // notifying, so we only announce genuinely new relations afterwards.
    let seeding = db.kv_get("sequel_seeded").is_none();
    let level = crate::commands::read_content_filter(&db);

    for media_type in ["ANIME", "MANGA"] {
        // Everything on the list (any status) counts as "already have it".
        let on_list: HashSet<i64> =
            list_ids(&db, user_id, media_type, None).into_iter().collect();
        let sources = list_ids(
            &db,
            user_id,
            media_type,
            Some(&["COMPLETED", "CURRENT", "REPEATING"]),
        );

        for chunk in sources.chunks(BATCH).take(MAX_BATCHES) {
            let vars = json!({ "ids": chunk, "type": media_type });
            let Ok(data) = api.query(None, RELATIONS_QUERY, vars).await else {
                return; // network error — try again next round
            };
            for media in data
                .pointer("/Page/media")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
            {
                for edge in media
                    .pointer("/relations/edges")
                    .and_then(|v| v.as_array())
                    .into_iter()
                    .flatten()
                {
                    let rel = edge.get("relationType").and_then(|v| v.as_str()).unwrap_or("");
                    let status =
                        edge.pointer("/node/status").and_then(|v| v.as_str()).unwrap_or("");
                    let Some(node_id) =
                        edge.pointer("/node/id").and_then(|v| v.as_i64())
                    else {
                        continue;
                    };
                    if !is_alertable(rel, status, node_id, &on_list) {
                        continue;
                    }
                    // An announced sequel can be adult even when the source on
                    // the user's list is not.
                    if let Some(node) = edge.get("node") {
                        if crate::commands::media_blocked(node, &level) {
                            continue;
                        }
                    }
                    let key = format!("sequel_seen:{node_id}");
                    if db.kv_get(&key).is_some() {
                        continue;
                    }
                    let _ = db.kv_set(&key, "1");
                    if seeding {
                        continue; // seed silently on the first run
                    }
                    let title = pick_title(edge.pointer("/node/title"));
                    let label = if rel == "SEQUEL" { "Sequel" } else { "Side story" };
                    crate::alerts::notify::notify(
                        app,
                        "sequel",
                        &format!("{label} announced"),
                        &format!("{title} — related to something on your list."),
                    );
                }
            }
        }
    }

    if seeding {
        let _ = db.kv_set("sequel_seeded", "1");
    }
}

#[cfg(test)]
mod tests {
    use super::is_alertable;
    use std::collections::HashSet;

    #[test]
    fn alerts_on_upcoming_sequel_not_on_list() {
        let on_list = HashSet::new();
        assert!(is_alertable("SEQUEL", "NOT_YET_RELEASED", 10, &on_list));
        assert!(is_alertable("SIDE_STORY", "RELEASING", 11, &on_list));
    }

    #[test]
    fn ignores_finished_or_other_relations() {
        let on_list = HashSet::new();
        assert!(!is_alertable("SEQUEL", "FINISHED", 10, &on_list));
        assert!(!is_alertable("PREQUEL", "RELEASING", 10, &on_list));
        assert!(!is_alertable("ADAPTATION", "NOT_YET_RELEASED", 10, &on_list));
    }

    #[test]
    fn ignores_nodes_already_on_the_list() {
        let on_list = HashSet::from([10]);
        assert!(!is_alertable("SEQUEL", "RELEASING", 10, &on_list));
    }
}
