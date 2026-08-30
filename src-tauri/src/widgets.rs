//! The home-screen widgets' data projection.
//!
//! Android's four widgets (Airing Today, Continue Watching, Continue
//! Reading, Weekly Calendar) are classic RemoteViews with no network and no
//! schema knowledge: they render `<dataDir>/widgets.json` (tauri's app_data_dir = the package root), which this
//! module writes whenever the list cache moves. A new pattern for this
//! repo — nothing else writes a file for an outside consumer — named as
//! such on purpose: Rust owns the format the way `keystore.rs` owns
//! `TokenCipher`'s, so a `MIGRATION_V*` can never break a widget that
//! parses SQLite on its own.
//!
//! Display strings are pre-rendered here (one i18n home, per `i18n.rs`'s
//! own header — Android res strings would fork the system and track the
//! device locale, not the app language). Timestamps ship raw
//! (`airingAtMs`): Kotlin buckets "today" and the weekday at *render*
//! time, so a days-stale file still renders correctly dated — its airing
//! rows honestly age out rather than showing yesterday as today. Weekly
//! Calendar is "the next episode per show, this week": the cache only
//! knows `nextAiringEpisode`, and the projection says so rather than
//! promising a full schedule.
//!
//! The content filter is applied at projection time, and `blur_adult`
//! *hides* here rather than blurring — a widget cannot blur, and the home
//! screen is the one surface where erring toward absence is obviously
//! right.

use serde_json::{json, Value};

use crate::i18n::Lang;

/// Rows per list — a widget shows a handful, and the file stays small.
const MAX_ROWS: usize = 8;
/// The airing window, and the calendar's whole span.
const WEEK_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// The widget vocabulary, local rather than `Msg` variants: these are
/// captions, not notifications, and the exhaustive `(Lang, Msg)` match
/// would grow eight arms that no toast ever renders.
fn labels(lang: Lang) -> Value {
    match lang {
        Lang::En => json!({
            "airingToday": "Airing today",
            "continueWatching": "Continue watching",
            "continueReading": "Continue reading",
            "week": "This week",
            "episode": "Ep",
            "empty": "Nothing here right now",
            "stale": "Open Karasu to refresh",
        }),
        Lang::De => json!({
            "airingToday": "Läuft heute",
            "continueWatching": "Weiterschauen",
            "continueReading": "Weiterlesen",
            "week": "Diese Woche",
            "episode": "Ep",
            "empty": "Gerade nichts hier",
            "stale": "Karasu öffnen zum Aktualisieren",
        }),
    }
}

/// Monday-first short day names, indexable by Kotlin from the epoch ms.
fn day_names(lang: Lang) -> Value {
    match lang {
        Lang::En => json!(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]),
        Lang::De => json!(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]),
    }
}

/// English → romaji → native, the airing watcher's own preference order.
fn title_of(media: &Value) -> String {
    let title = media.get("title");
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
        .unwrap_or_else(|| "—".to_string())
}

/// Every visible CURRENT/REPEATING entry across the payload's groups,
/// content-filtered, custom lists skipped (they duplicate the status lists).
fn watching_rows<'a>(
    payload: &'a Value,
    level: &str,
    hide_adult: bool,
) -> Vec<&'a Value> {
    let mut out = Vec::new();
    let Some(lists) = payload.as_array() else {
        return out;
    };
    for group in lists {
        if group["isCustomList"].as_bool() == Some(true) {
            continue;
        }
        let Some(entries) = group["entries"].as_array() else {
            continue;
        };
        for e in entries {
            let status = e["status"].as_str().unwrap_or("");
            if status != "CURRENT" && status != "REPEATING" {
                continue;
            }
            let media = &e["media"];
            if crate::commands::media_blocked(media, level) {
                continue;
            }
            if hide_adult && media["isAdult"].as_bool() == Some(true) {
                continue;
            }
            out.push(e);
        }
    }
    out
}

/// The continue-list projection: newest activity first.
fn continue_rows(entries: &[&Value], total_key: &str) -> Value {
    let mut rows: Vec<&&Value> = entries.iter().collect();
    rows.sort_by_key(|e| -(e["updatedAt"].as_i64().unwrap_or(0)));
    Value::Array(
        rows.iter()
            .take(MAX_ROWS)
            .map(|e| {
                json!({
                    "title": title_of(&e["media"]),
                    "progress": e["progress"].as_i64().unwrap_or(0),
                    "total": e["media"][total_key].as_i64(),
                })
            })
            .collect(),
    )
}

/// Next episodes inside the coming week, soonest first.
fn airing_rows(entries: &[&Value], now_ms: i64) -> Value {
    let mut rows: Vec<(i64, i64, String)> = entries
        .iter()
        .filter_map(|e| {
            let next = &e["media"]["nextAiringEpisode"];
            let at_ms = next["airingAt"].as_i64()? * 1000;
            if at_ms < now_ms - 60 * 60 * 1000 || at_ms > now_ms + WEEK_MS {
                return None;
            }
            Some((at_ms, next["episode"].as_i64().unwrap_or(0), title_of(&e["media"])))
        })
        .collect();
    rows.sort();
    Value::Array(
        rows.into_iter()
            .take(MAX_ROWS * 2)
            .map(|(at_ms, episode, title)| {
                json!({ "title": title, "episode": episode, "airingAtMs": at_ms })
            })
            .collect(),
    )
}

/// The whole projection, pure and tested: payloads in, widget document out.
pub fn project(
    anime_payload: Option<&Value>,
    manga_payload: Option<&Value>,
    level: &str,
    hide_adult: bool,
    lang: Lang,
    now_ms: i64,
) -> Value {
    let empty = Value::Array(Vec::new());
    let anime = watching_rows(anime_payload.unwrap_or(&empty), level, hide_adult);
    let manga = watching_rows(manga_payload.unwrap_or(&empty), level, hide_adult);

    json!({
        "generatedAtMs": now_ms,
        "labels": labels(lang),
        "days": day_names(lang),
        "airing": airing_rows(&anime, now_ms),
        "continueWatching": continue_rows(&anime, "episodes"),
        "continueReading": continue_rows(&manga, "chapters"),
    })
}

/// Re-projects and rewrites the file from whatever the database holds.
/// Cheap enough to run on every hook (two cached blobs, one small write),
/// and a no-op off Android — the projection logic still compiles and tests
/// everywhere, per the media_session pattern.
pub fn refresh(app: &tauri::AppHandle) {
    #[cfg(target_os = "android")]
    write_projection(app);
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

#[cfg(target_os = "android")]
fn write_projection(app: &tauri::AppHandle) {
    use tauri::Manager;
    let db = app.state::<crate::db::Db>();
    let Some(user_id) = db
        .kv_get("anilist_viewer")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v["id"].as_i64())
    else {
        return;
    };
    let parse = |t: &str| {
        db.cached_list(user_id, t)
            .and_then(|p| serde_json::from_str::<Value>(&p).ok())
    };
    let anime = parse("ANIME");
    let manga = parse("MANGA");
    let level = crate::commands::read_content_filter(&db);
    // Absent means ON, matching `get_blur_adult` (v17 seeds it for new
    // installs) — reading `== "1"` here would invert the default.
    let hide_adult = db.kv_get("blur_adult").as_deref() != Some("0");
    let lang = crate::i18n::lang(&db);
    let doc = project(
        anime.as_ref(),
        manga.as_ref(),
        &level,
        hide_adult,
        lang,
        crate::alerts::notify::now_ms(),
    );

    let Some(path) = crate::portable::mobile_secret_file("widgets.json") else {
        return;
    };
    if let Err(e) = std::fs::write(&path, doc.to_string()) {
        crate::logging::warn("widgets", format!("cannot write the projection: {e}"));
        return;
    }
    poke_refresher();
}

/// Broadcasts the standard widget update through Kotlin's `WidgetRefresher`
/// so placed widgets re-render the fresh file — the same tao-context JNI
/// route the keystore and the job scheduler ride. Failures are per-write
/// noise, logged only on transition.
#[cfg(target_os = "android")]
fn poke_refresher() {
    let go = || -> Result<(), String> {
        let ctx = tao::platform::android::prelude::main_android_context()
            .ok_or("widgets: the android context is not ready yet")?;
        let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
            .map_err(|e| format!("widgets vm: {e}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("widgets attach: {e}"))?;
        let activity =
            unsafe { jni::objects::JObject::from_raw(ctx.context_jobject.cast()) };
        let result = (|| -> jni::errors::Result<()> {
            let loader = env
                .call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
                .l()?;
            let name = env.new_string("dev.kyu.karasu.WidgetRefresher")?;
            let class = env
                .call_method(
                    &loader,
                    "loadClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[jni::objects::JValue::Object(&name)],
                )?
                .l()?;
            env.call_static_method(
                &jni::objects::JClass::from(class),
                "refresh",
                "(Landroid/content/Context;)V",
                &[jni::objects::JValue::Object(&activity)],
            )?;
            Ok(())
        })();
        result.map_err(|e| {
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            format!("widgets refresh: {e}")
        })
    };
    if let Err(e) = go() {
        crate::logging::debug_changed("widgets", "poke", e);
    }
}

/// Sign-out: the projection holds list titles, and the file must not
/// outlive the account it describes. The widgets fall back to their empty
/// state on the next render.
pub fn clear() {
    #[cfg(target_os = "android")]
    if let Some(path) = crate::portable::mobile_secret_file("widgets.json") {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(entries: Value) -> Value {
        json!([{ "isCustomList": false, "entries": entries }])
    }

    fn entry(status: &str, progress: i64, updated: i64, title: &str) -> Value {
        json!({
            "status": status,
            "progress": progress,
            "updatedAt": updated,
            "media": {
                "title": { "romaji": title, "english": null, "native": null },
                "episodes": 12,
                "chapters": null,
                "isAdult": false,
                "genres": [],
                "nextAiringEpisode": null,
            },
        })
    }

    #[test]
    fn only_current_and_repeating_rows_survive_sorted_by_activity() {
        let p = payload(json!([
            entry("CURRENT", 3, 100, "Old"),
            entry("COMPLETED", 12, 500, "Done"),
            entry("REPEATING", 5, 300, "Again"),
        ]));
        let doc = project(Some(&p), None, "off", false, Lang::En, 0);
        let rows = doc["continueWatching"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["title"], "Again");
        assert_eq!(rows[1]["title"], "Old");
    }

    #[test]
    fn the_filter_and_the_blur_both_hide_on_the_home_screen() {
        let mut adult = entry("CURRENT", 1, 100, "Hidden");
        adult["media"]["isAdult"] = json!(true);
        let p = payload(json!([adult, entry("CURRENT", 1, 50, "Shown")]));

        // Filter level catches it…
        let doc = project(Some(&p), None, "moderate", false, Lang::En, 0);
        let rows = doc["continueWatching"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["title"], "Shown");

        // …and with the filter off, blur-adult still hides rather than blurs.
        let doc = project(Some(&p), None, "off", true, Lang::En, 0);
        assert_eq!(doc["continueWatching"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn airing_rows_keep_only_the_coming_week_soonest_first() {
        let now = 1_000_000_000_000i64;
        let with_airing = |title: &str, at_s: i64| {
            let mut e = entry("CURRENT", 1, 0, title);
            e["media"]["nextAiringEpisode"] = json!({ "episode": 2, "airingAt": at_s });
            e
        };
        let p = payload(json!([
            with_airing("Later", now / 1000 + 3600 * 30),
            with_airing("Soon", now / 1000 + 3600),
            with_airing("NextMonth", now / 1000 + 3600 * 24 * 20),
            entry("CURRENT", 1, 0, "NoSchedule"),
        ]));
        let doc = project(Some(&p), None, "off", false, Lang::En, now);
        let rows = doc["airing"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["title"], "Soon");
        assert_eq!(rows[1]["title"], "Later");
        // Raw ms, for Kotlin to bucket at render time.
        assert!(rows[0]["airingAtMs"].as_i64().unwrap() > now);
    }

    #[test]
    fn custom_lists_do_not_duplicate_rows() {
        let doc = project(
            Some(&json!([
                { "isCustomList": true, "entries": [entry("CURRENT", 1, 0, "Dup")] },
                { "isCustomList": false, "entries": [entry("CURRENT", 1, 0, "Dup")] },
            ])),
            None,
            "off",
            false,
            Lang::En,
            0,
        );
        assert_eq!(doc["continueWatching"].as_array().unwrap().len(), 1);
    }
}
