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
///
/// 300 entries a run is a *window*, not a prefix. It used to be
/// `sources.chunks(BATCH).take(MAX_BATCHES)` against a list in cache order,
/// which is the same 300 every twelve hours forever — a list longer than that
/// had a tail the watcher never once looked at.
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

/// The chunk indices one run covers, given where the last one stopped.
///
/// Pure so the rotation can be tested without a list, a database or a network:
/// the property that matters is that repeated runs eventually touch every
/// index, and that is not observable from anything `check` returns.
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

    // Record everything currently found without notifying, so we only announce
    // genuinely new relations afterwards. This has to stay on until the cursor
    // below has been all the way round *both* lists — otherwise the run that
    // first reaches entry 301 announces its long-known sequels as new.
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

        // Where this run picks up. The cursor is per media type and wraps, so
        // twelve hours later the window has moved on rather than re-reading the
        // same six chunks.
        let chunks: Vec<&[i64]> = sources.chunks(BATCH).collect();
        let covered_key = format!("sequel_covered:{media_type}");
        if chunks.is_empty() {
            // Nothing to walk. Note this also covers "the cache for this type
            // was never fetched", which is not the same thing — but a list we
            // cannot read is one we cannot announce from either, so seeding
            // must not wait on it.
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

        for at in window(start, chunks.len(), MAX_BATCHES) {
            let chunk = chunks[at];
            let vars = json!({ "ids": chunk, "type": media_type });
            let Ok(data) = api.query(None, RELATIONS_QUERY, vars).await else {
                // Keep the ground this run did cover before giving up, or a
                // flaky connection would make the window stand still.
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
            done += 1;
        }

        let _ = db.kv_set(&cursor_key, &((start + done) % chunks.len()).to_string());
        // Did the window reach the end of this list? The cursor starts at 0 and
        // only ever advances, so "start + done past the last chunk" is exactly
        // "every chunk has been seen at least once".
        //
        // Recorded per type and persisted, not ANDed inside one run. Both
        // cursors advance by six per run in their own modulus, so requiring
        // them to land in their last window *simultaneously* is a coincidence
        // of two orbits: 29 and 35 chunks would have taken 170 runs — 85 days
        // — and every sequel announced in that window is marked seen and
        // silently swallowed. Per type it is ceil(len/6) runs, which is what
        // "all the way round both lists" was supposed to mean.
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

    /// The whole point of the cursor: a list longer than one run's window is
    /// still covered, just over several runs. The old code took the first
    /// `MAX_BATCHES` chunks of a list in cache order every single time, so on a
    /// 500-entry list entries 301..500 were never once queried.
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

    /// A window shorter than the batch cap must not repeat a chunk inside one
    /// run — that would query the same fifty ids twice and pay for it twice.
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
