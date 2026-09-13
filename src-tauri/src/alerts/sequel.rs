//! Background sequel watcher: notifies when a sequel or side story of a listed title is announced. Opt-in.

use crate::anilist::client::AniList;
use crate::db::Db;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const CHECK_INTERVAL: Duration = Duration::from_secs(12 * 3600);
const STARTUP_DELAY: Duration = Duration::from_secs(120);
/// Source media per run, a rotating window rather than a fixed prefix, so a long list's tail is reached.
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
    // Supervised — see `logging::supervise`.
    crate::logging::supervise("sequel", move || {
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

/// Whether an edge is a sequel or side story that is upcoming or releasing and not on the list yet.
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

/// The chunk indices one run covers; pure so the rotation is testable without a list or a network.
fn window(start: usize, len: usize, max: usize) -> Vec<usize> {
    if len == 0 {
        return Vec::new();
    }
    (0..max.min(len)).map(|i| (start + i) % len).collect()
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

    // Seed silently until the cursor has been all the way round both lists, or a long-known sequel reads as new.
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

        // Where this run picks up: the cursor is per media type and wraps, so the window moves on every run.
        let chunks: Vec<&[i64]> = sources.chunks(BATCH).collect();
        let covered_key = format!("sequel_covered:{media_type}");
        if chunks.is_empty() {
            // Nothing to walk, a never-fetched cache included; a list we cannot read must not hold seeding up either.
            let _ = db.kv_set(&covered_key, "1");
            continue;
        }
        let cursor_key = format!("sequel_cursor:{media_type}");
        let start = db
            .kv_get(&cursor_key)
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0)
            % chunks.len();
        let mut done = 0usize;
        // The token when there is one: an outage refusing only unauthenticated requests no longer stalls the pass.
        let token = crate::anilist::auth::load_token();

        for at in window(start, chunks.len(), MAX_BATCHES) {
            let chunk = chunks[at];
            let vars = json!({ "ids": chunk, "type": media_type });
            let Ok(data) = api.query_from("sequel", token.as_deref(), RELATIONS_QUERY, vars).await else {
                // Keep the ground this run did cover before giving up, or a flaky connection leaves the window still.
                if done > 0 {
                    let _ = db.kv_set(&cursor_key, &((start + done) % chunks.len()).to_string());
                }
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
                    // An announced sequel can be adult even when the source on the user's list is not.
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
                    crate::alerts::notify::notify(
                        app,
                        "sequel",
                        crate::i18n::Msg::SequelTitle { side_story: rel != "SEQUEL" },
                        crate::i18n::Msg::SequelBody { title: &title },
                        // The sequel's id, not the source entry's: the row names the sequel, so that is what it opens.
                        Some(node_id),
                    );
                }
            }
            done += 1;
        }

        let _ = db.kv_set(&cursor_key, &((start + done) % chunks.len()).to_string());
        // Coverage is recorded per type and persisted; requiring both cursors to wrap in one run would swallow sequels.
        if start + done >= chunks.len() {
            let _ = db.kv_set(&covered_key, "1");
        }
    }

    if seeding
        && ["ANIME", "MANGA"]
            .iter()
            .all(|t| db.kv_get(&format!("sequel_covered:{t}")).is_some())
    {
        let _ = db.kv_set("sequel_seeded", "1");
    }
}

#[cfg(test)]
mod tests {
    use super::{is_alertable, window, MAX_BATCHES};
    use std::collections::HashSet;

    /// A list longer than one run's window is still covered, just over several runs.
    #[test]
    fn successive_runs_cover_a_list_longer_than_one_window() {
        let len = 17; // 17 chunks of 50 — a ~850-entry list
        let mut seen = HashSet::new();
        let mut start = 0;
        for _ in 0..3 {
            let w = window(start, len, MAX_BATCHES);
            assert_eq!(w.len(), MAX_BATCHES, "a full window every run");
            seen.extend(w.iter().copied());
            start = (start + w.len()) % len;
        }
        assert_eq!(seen.len(), len, "three runs of six cover all seventeen");
    }

    /// A window shorter than the batch cap must not repeat a chunk inside one run.
    #[test]
    fn a_short_list_is_covered_once_per_run() {
        assert_eq!(window(0, 3, MAX_BATCHES), vec![0, 1, 2]);
        assert_eq!(window(2, 3, MAX_BATCHES), vec![2, 0, 1]);
        assert!(window(0, 0, MAX_BATCHES).is_empty());
    }

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
