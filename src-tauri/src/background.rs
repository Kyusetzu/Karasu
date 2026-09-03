//! The dead-app notification check — Android's half of the scheduler.
//!
//! `NotifJobService` (Kotlin, JobScheduler) calls the one exported symbol
//! here on its own background thread, in a process where Tauri may never
//! have started: no `AppHandle`, no managed state, no tao context. Every
//! dependency is therefore taken by hand — the data dir from the passed
//! `Context`, the token file read directly (`RESOLVED_DATA_DIR` is unset
//! cold, so `auth::load_token` cannot serve), the seal opened through the
//! env-parameterized keystore core, the database opened by path. The token
//! never crosses into Kotlin: the JSON handed back is a rendered title and
//! body, nothing more — the invariant CLAUDE.md states survives the
//! dead-app path.
//!
//! Coordination with the in-app pass (`alerts/site.rs`) is the shared kv
//! vocabulary: this entry defers to a fresh `site_notif_last_check_ms`
//! (written by whichever half checked last — an alive-but-Dozed app must
//! not starve the job, which is why the predicate is freshness, not
//! app-running), advances `site_notif_seen_id` through the same
//! compare-and-set, and reads the same interval key. The request bypasses
//! the managed client's limiter by construction — there is no managed
//! client — which the freshness stamp bounds to one request per interval.

#![cfg(target_os = "android")]

use jni::objects::{JClass, JObject, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use std::path::PathBuf;

use crate::alerts::site::{
    INTERVAL_KEY, INTERVAL_MAX, INTERVAL_MIN, LAST_CHECK_KEY, SEEN_KEY, SITE_QUERY,
};
use crate::db::Db;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `context.getDataDir().getAbsolutePath()`, by hand — the package root,
/// matching tauri's own `app_data_dir` (its PathPlugin resolves `getDataDir`
/// to `activity.dataDir`), which is where the token, the database and the
/// widget projection all live. `getFilesDir` is one level below and finds
/// none of them — measured, not guessed: four empty widgets.
fn data_dir(env: &mut JNIEnv, context: &JObject) -> Result<PathBuf, String> {
    let file = env
        .call_method(context, "getDataDir", "()Ljava/io/File;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getDataDir: {e}"))?;
    let path = env
        .call_method(&file, "getAbsolutePath", "()Ljava/lang/String;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getAbsolutePath: {e}"))?;
    let s: String = env
        .get_string(&JString::from(path))
        .map_err(|e| format!("path string: {e}"))?
        .into();
    Ok(PathBuf::from(s))
}

/// The token, read and unsealed without any of the app's machinery.
///
/// `Stored::Legacy` is used read-only — migration stays the running app's
/// job (`anilist/auth.rs`), and a background worker has no business
/// rewriting secret files.
fn read_token(env: &mut JNIEnv, context: &JObject, dir: &PathBuf) -> Option<String> {
    let raw = std::fs::read(dir.join("anilist_token.dat")).ok()?;
    let plain = match crate::keystore::classify(&raw) {
        crate::keystore::Stored::Sealed(sealed) => {
            crate::keystore::jni_impl::call_with_env(env, context, "open", sealed).ok()?
        }
        crate::keystore::Stored::Legacy(plain) => plain.to_vec(),
    };
    String::from_utf8(plain).ok().filter(|t| !t.is_empty())
}

/// The whole check, returning the rendered `{"title","body"}` JSON when a
/// summary should be posted, or an empty string for "nothing to say".
fn check(env: &mut JNIEnv, context: &JObject) -> Result<String, String> {
    let dir = data_dir(env, context)?;
    let db = Db::open(dir.clone())?;

    let interval = {
        let raw = db
            .kv_get(INTERVAL_KEY)
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        if raw <= 0 { 0 } else { raw.clamp(INTERVAL_MIN, INTERVAL_MAX) }
    };
    if interval == 0 {
        return Ok(String::new());
    }
    // Freshness, not app-running: the in-app pass stamps this on every
    // successful check, so a live foreground app makes this job a no-op,
    // while a Dozed one (sockets blocked outside maintenance windows —
    // exactly when this job runs inside one) does not starve it.
    let last = db
        .kv_get(LAST_CHECK_KEY)
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    if now_ms() - last < interval * 60_000 {
        return Ok(String::new());
    }

    let Some(token) = read_token(env, context, &dir) else {
        return Ok(String::new());
    };

    // One request on a throwaway current-thread runtime. `net.rs`'s Android
    // arm needs no JNI (baked webpki roots), so this works from a bare
    // JVM-owned thread.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("runtime: {e}"))?;
    let body: serde_json::Value = rt.block_on(async {
        let client = crate::net::client_builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("client: {e}"))?;
        let resp = client
            .post("https://graphql.anilist.co")
            .bearer_auth(&token)
            .header("User-Agent", concat!("Karasu/", env!("CARGO_PKG_VERSION")))
            .json(&serde_json::json!({ "query": SITE_QUERY }))
            .send()
            .await
            .map_err(|e| format!("send: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        resp.json::<serde_json::Value>()
            .await
            .map_err(|e| format!("body: {e}"))
    })?;

    let _ = db.kv_set(LAST_CHECK_KEY, &now_ms().to_string());

    let unread = body
        .pointer("/data/Viewer/unreadNotificationCount")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let Some(newest) = body
        .pointer("/data/Page/notifications/0/id")
        .and_then(|v| v.as_i64())
    else {
        return Ok(String::new());
    };

    let seen = db.kv_get(SEEN_KEY).and_then(|s| s.parse::<i64>().ok());
    let advanced = db.kv_advance_max(SEEN_KEY, newest);
    let announce = matches!(seen, Some(s) if newest > s && unread > 0 && advanced);
    if !announce {
        return Ok(String::new());
    }

    let lang = crate::i18n::lang(&db);
    Ok(serde_json::json!({
        "title": crate::i18n::text(lang, crate::i18n::Msg::SiteNotifTitle),
        "body": crate::i18n::text(lang, crate::i18n::Msg::SiteNotifBody { count: unread }),
    })
    .to_string())
}

/// The exported symbol `dev.kyu.karasu.KarasuNative.backgroundNotifCheck`
/// binds to. A panic unwinding across JNI aborts the process, so the whole
/// body sits under `catch_unwind`; every failure — panic or error — answers
/// with an empty string, which Kotlin reads as "post nothing".
#[no_mangle]
pub extern "system" fn Java_dev_kyu_karasu_KarasuNative_backgroundNotifCheck(
    mut env: JNIEnv,
    _class: JClass,
    context: JObject,
) -> jstring {
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        check(&mut env, &context).unwrap_or_else(|e| {
            crate::logging::warn("background", format!("notif check failed: {e}"));
            String::new()
        })
    }))
    .unwrap_or_default();

    env.new_string(out)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// (Re-)asserts the JobScheduler registration to match the setting — called
/// on every settings change and once at startup. Goes through the running
/// app's tao context, exactly like the keystore's own `call`.
pub fn assert_schedule(minutes: i64) -> Result<(), String> {
    let ctx = tao::platform::android::prelude::main_android_context()
        .ok_or("background: the android context is not ready yet")?;
    let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
        .map_err(|e| format!("background vm: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("background attach: {e}"))?;
    let activity = unsafe { JObject::from_raw(ctx.context_jobject.cast()) };

    // `schedule` answers with JobScheduler's own result code; `cancel` has
    // nothing to refuse, so it reports success outright.
    let result = (|| -> jni::errors::Result<i32> {
        let loader = env
            .call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
            .l()?;
        let name = env.new_string("dev.kyu.karasu.NotifScheduler")?;
        let class = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[jni::objects::JValue::Object(&name)],
            )?
            .l()?;
        let class = JClass::from(class);
        if minutes > 0 {
            env.call_static_method(
                &class,
                "schedule",
                "(Landroid/content/Context;I)I",
                &[
                    jni::objects::JValue::Object(&activity),
                    jni::objects::JValue::Int(minutes as i32),
                ],
            )?
            .i()
        } else {
            env.call_static_method(
                &class,
                "cancel",
                "(Landroid/content/Context;)V",
                &[jni::objects::JValue::Object(&activity)],
            )?;
            Ok(RESULT_SUCCESS)
        }
    })();

    let code = result.map_err(|e| {
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        format!("background schedule: {e}")
    })?;
    // The JNI call succeeding only means Kotlin ran. Whether JobScheduler
    // accepted the job is the return value, which used to be dropped — so a
    // RESULT_FAILURE left the pane reading "every 15 minutes" with nothing
    // registered, and this function reporting Ok.
    match code {
        RESULT_SUCCESS => Ok(()),
        RESULT_FAILURE => Err(
            "JobScheduler refused the job (RESULT_FAILURE): nothing is registered".to_string(),
        ),
        other => Err(format!(
            "NotifScheduler.schedule threw (code {other}); logcat tag KarasuNotifJob has the trace"
        )),
    }
}

/// `JobScheduler.RESULT_SUCCESS` / `RESULT_FAILURE`, as `NotifScheduler.schedule`
/// returns them; anything else is its own "threw" marker.
const RESULT_SUCCESS: i32 = 1;
const RESULT_FAILURE: i32 = 0;

/// Startup re-assertion, retried briefly: `main_android_context` races the
/// spawned setup (tao populates it in `onActivityCreate`), so a bare call
/// here can land a beat too early — the keystore treats not-ready as an
/// error for the same reason.
pub fn spawn_schedule_assert(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let minutes = crate::alerts::site::interval_min(&app.state::<Db>());
        let mut last = String::new();
        for _ in 0..20 {
            match assert_schedule(minutes) {
                Ok(()) => return,
                Err(e) => {
                    last = e;
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
            }
        }
        // The last reason, not just the fact: "not ready yet" twenty times is a
        // different bug from a JobScheduler refusal.
        crate::logging::warn(
            "background",
            format!("could not re-assert the notification job schedule at startup: {last}"),
        );
    });
}
