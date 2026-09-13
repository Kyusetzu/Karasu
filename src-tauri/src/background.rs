//! The dead-app notification check, Android's half; its kv vocabulary is shared with `alerts/site.rs`, keep them in step.

#![cfg(target_os = "android")]

use jni::objects::{JClass, JObject, JString, JValue};
use jni::sys::{jboolean, jstring};
use jni::JNIEnv;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

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

/// `getDataDir` by hand, matching tauri's own `app_data_dir`; `getFilesDir` is one level below and finds nothing.
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

/// The token, read and unsealed without the app's machinery; `Legacy` is read-only, since migration is the app's job.
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

/// The whole check; the JSON handed back is a rendered title and body, and the token never crosses into Kotlin.
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
    // Freshness, not app-running: a live app makes this job a no-op, while a Dozed one must not starve it.
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

    // One request on a throwaway current-thread runtime; the Android TLS arm needs no JNI, so a bare JVM thread will do.
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
        // The live app restores this at its next start, so the job's one request is not a surprise to its limiter.
        let header = |name: &str| resp.headers().get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u32>().ok());
        if let Some(remaining) = header("x-ratelimit-remaining") {
            let state = crate::anilist::client::PersistedRate {
                remaining,
                limit: header("x-ratelimit-limit"),
                observed_ms: now_ms(),
                retry_until_ms: None,
            };
            if let Ok(json) = serde_json::to_string(&state) {
                let _ = db.kv_set(crate::anilist::RATE_STATE_KEY, &json);
            }
        }
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

/// The symbol `KarasuNative.backgroundNotifCheck` binds to; under `catch_unwind`, since a panic across JNI aborts.
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

/// Runs `f` with an attached env, the activity and an app class loaded through the activity's own class loader.
fn with_app_class<T>(
    name: &str,
    f: impl FnOnce(&mut JNIEnv<'_>, &JObject<'_>, &JClass<'_>) -> jni::errors::Result<T>,
) -> Result<T, String> {
    let ctx = tao::platform::android::prelude::main_android_context()
        .ok_or("background: the android context is not ready yet")?;
    let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }
        .map_err(|e| format!("background vm: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("background attach: {e}"))?;
    let activity = unsafe { JObject::from_raw(ctx.context_jobject.cast()) };

    let result = (|| -> jni::errors::Result<T> {
        let loader = env
            .call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
            .l()?;
        let jname = env.new_string(name)?;
        let class = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&jname)],
            )?
            .l()?;
        let class = JClass::from(class);
        f(&mut env, &activity, &class)
    })();

    result.map_err(|e| {
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
        format!("background {name}: {e}")
    })
}

/// A Kotlin static's `String` answer as Rust text; bound to a local first, since the `JavaStr` borrows it.
fn answer_text(env: &mut JNIEnv<'_>, answer: JObject<'_>) -> jni::errors::Result<String> {
    let answer = JString::from(answer);
    let text: String = env.get_string(&answer)?.into();
    Ok(text)
}

/// (Re-)asserts the JobScheduler registration to match the setting, on every settings change and once at startup.
pub fn assert_schedule(minutes: i64) -> Result<(), String> {
    // `schedule` answers with Android's own reason it could not register the job, or an empty string.
    let reason = with_app_class("dev.kyu.karasu.NotifScheduler", |env, activity, class| {
        if minutes > 0 {
            let answer = env
                .call_static_method(
                    class,
                    "schedule",
                    "(Landroid/content/Context;I)Ljava/lang/String;",
                    &[JValue::Object(activity), JValue::Int(minutes as i32)],
                )?
                .l()?;
            answer_text(env, answer)
        } else {
            env.call_static_method(
                class,
                "cancel",
                "(Landroid/content/Context;)V",
                &[JValue::Object(activity)],
            )?;
            Ok(String::new())
        }
    })?;
    // The JNI call succeeding only means Kotlin ran; whether JobScheduler accepted the job is the answer, kept verbatim.
    if reason.is_empty() {
        Ok(())
    } else {
        Err(reason)
    }
}

// --- The live app's Android-only machinery -----------------------------------

/// Whether the activity is on screen; the scrobbler reads it, since Android refuses a foreground start from behind.
static FOREGROUND: AtomicBool = AtomicBool::new(true);

/// `dev.kyu.karasu.KarasuNative.setForeground`.
#[no_mangle]
pub extern "system" fn Java_dev_kyu_karasu_KarasuNative_setForeground(
    _env: JNIEnv,
    _class: JClass,
    foreground: jboolean,
) {
    FOREGROUND.store(foreground != 0, Ordering::Relaxed);
}

pub fn is_foreground() -> bool {
    FOREGROUND.load(Ordering::Relaxed)
}

/// Starts or stops the tracking service; `Err` carries Android's own reason for a refused start.
pub fn tracking_service(on: bool, title: &str, body: &str) -> Result<(), String> {
    let reason = with_app_class("dev.kyu.karasu.TrackingControl", |env, activity, class| {
        if on {
            let title = env.new_string(title)?;
            let body = env.new_string(body)?;
            let answer = env
                .call_static_method(
                    class,
                    "start",
                    "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                    &[
                        JValue::Object(activity),
                        JValue::Object(&title),
                        JValue::Object(&body),
                    ],
                )?
                .l()?;
            answer_text(env, answer)
        } else {
            env.call_static_method(
                class,
                "stop",
                "(Landroid/content/Context;)V",
                &[JValue::Object(activity)],
            )?;
            Ok(String::new())
        }
    })?;
    if reason.is_empty() {
        Ok(())
    } else {
        Err(reason)
    }
}

/// Whether Android has exempted Karasu from battery optimisation.
pub fn battery_exempt() -> Result<bool, String> {
    with_app_class("dev.kyu.karasu.TrackingControl", |env, activity, class| {
        env.call_static_method(
            class,
            "isBatteryExempt",
            "(Landroid/content/Context;)Z",
            &[JValue::Object(activity)],
        )?
        .z()
    })
}

/// Opens the system dialog asking for the exemption; it answers nothing, so the pane re-reads `battery_exempt` on focus.
pub fn request_battery_exemption() -> Result<(), String> {
    let reason = with_app_class("dev.kyu.karasu.TrackingControl", |env, activity, class| {
        let answer = env
            .call_static_method(
                class,
                "requestBatteryExemption",
                "(Landroid/content/Context;)Ljava/lang/String;",
                &[JValue::Object(activity)],
            )?
            .l()?;
        answer_text(env, answer)
    })?;
    if reason.is_empty() {
        Ok(())
    } else {
        Err(reason)
    }
}

/// Startup re-assertion, retried briefly, since `main_android_context` races the spawned setup.
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
        // The last reason, not just the fact: "not ready yet" every time is a different bug from a JobScheduler refusal.
        crate::logging::warn(
            "background",
            format!("could not re-assert the notification job schedule at startup: {last}"),
        );
    });
}
