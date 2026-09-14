//! The Android in-app updater: fetch, verify and hand over the manifest's APK; only `android` below touches the device.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use crate::db::Db;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// kv: the JSON of the `ApkAsset` the last check found newer than the running build.
pub const PENDING_KEY: &str = "apk_pending";
/// kv: the version the start-time installer prompt was already shown for, so "cancel" is honoured until the next one.
pub const PROMPTED_KEY: &str = "apk_prompted_version";
/// kv: "1" lets the automatic download use a metered network; off by default, a nightly is 23 MB a time.
pub const METERED_KEY: &str = "apk_download_metered";
/// Gradle adds this to `COMMIT_NUMBER` for `versionCode`; the sweep compares file codes against it.
pub const VERSION_CODE_BASE: u32 = 1_000_000;

/// One APK leg of `latest.json`, plus the manifest version it belongs to.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ApkAsset {
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// The manifest key for a device ABI; only arm64 has its own build, everything else takes the universal APK.
pub fn abi_key(abi: &str) -> &'static str {
    if abi == "arm64-v8a" {
        "android-arm64"
    } else {
        "android-universal"
    }
}

/// The asset under `platforms[key]`, with the manifest's own `version`; `None` when the leg is absent or malformed.
pub fn parse_asset(manifest: &Value, key: &str) -> Option<ApkAsset> {
    let version = manifest.get("version")?.as_str()?.trim_start_matches('v').to_string();
    let leg = manifest.pointer(&format!("/platforms/{key}"))?;
    let url = leg.get("url")?.as_str()?.to_string();
    let sha256 = leg.get("sha256")?.as_str()?.to_ascii_lowercase();
    let size = leg.get("size")?.as_u64()?;
    if sha256.len() != 64 || size == 0 {
        return None;
    }
    Some(ApkAsset { version, url, sha256, size })
}

/// What to do with a `.part` file left by an earlier run.
#[derive(Debug, PartialEq)]
pub enum Resume {
    /// Ask the server for the rest, starting at this offset.
    From(u64),
    /// The part is as long as the whole or longer, so it was never verified; start over.
    Restart,
}

pub fn resume_plan(part_len: u64, size: u64) -> Resume {
    if part_len > 0 && part_len < size {
        Resume::From(part_len)
    } else {
        Resume::Restart
    }
}

/// Room for the download plus the installer's own copy of it.
pub fn enough_space(free_bytes: u64, size: u64) -> bool {
    free_bytes >= size.saturating_mul(2)
}

/// Whether a file under `updates/` stays: only the pending version, and only if it would still be an upgrade.
pub fn sweep_keeps(file_version_code: u32, installed_code: u32, is_pending_version: bool) -> bool {
    is_pending_version && file_version_code > installed_code
}

/// The version code Gradle stamps on a build with this commit number.
pub fn version_code_for(commit_number: u32) -> u32 {
    commit_number + VERSION_CODE_BASE
}

/// What About and the bell show; `available` is false on every platform but an Android release build.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApkUpdateState {
    pub available: bool,
    /// `none` · `downloading` · `ready` · `blocked`.
    pub status: String,
    pub version: Option<String>,
    /// For `blocked`: `metered` · `space` · `signature` · `stale` · `foreground` · `network`.
    pub reason: Option<String>,
    pub needs_install_permission: bool,
    pub received: u64,
    pub total: u64,
}

/// The "download over mobile data" switch; read on Android only, kept everywhere so the setting has one home.
#[tauri::command]
pub fn get_apk_download_metered(db: tauri::State<'_, Db>) -> bool {
    db.kv_get(METERED_KEY).as_deref() == Some("1")
}

#[tauri::command]
pub fn set_apk_download_metered(db: tauri::State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set(METERED_KEY, if enabled { "1" } else { "0" })
}

/// The pending asset from kv, if the last check stored one.
pub fn pending(db: &Db) -> Option<ApkAsset> {
    db.kv_get(PENDING_KEY)
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[cfg(target_os = "android")]
pub use android::*;

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use crate::background::with_app_class;
    use jni::objects::JValue;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use tauri::{AppHandle, Emitter, State};

    const CLASS: &str = "dev.kyu.karasu.UpdateInstaller";

    /// One download at a time; a second caller sees `downloading` and leaves.
    static DOWNLOADING: AtomicBool = AtomicBool::new(false);
    static RECEIVED: AtomicU64 = AtomicU64::new(0);
    static TOTAL: AtomicU64 = AtomicU64::new(0);
    /// The reason the last attempt stopped, shown until the next one; empty when it succeeded or never ran.
    static BLOCKED: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

    fn kotlin_string_arg(method: &str, arg: &str) -> Result<String, String> {
        with_app_class(CLASS, |env, activity, class| {
            let jarg = env.new_string(arg)?;
            let answer = env
                .call_static_method(
                    class,
                    method,
                    "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                    &[JValue::Object(activity), JValue::Object(&jarg)],
                )?
                .l()?;
            let answer = jni::objects::JString::from(answer);
            let text: String = env.get_string(&answer)?.into();
            Ok(text)
        })
    }

    fn kotlin_plain(method: &str) -> Result<String, String> {
        with_app_class(CLASS, |env, activity, class| {
            let answer = env
                .call_static_method(class, method, "(Landroid/content/Context;)Ljava/lang/String;", &[JValue::Object(activity)])?
                .l()?;
            let answer = jni::objects::JString::from(answer);
            let text: String = env.get_string(&answer)?.into();
            Ok(text)
        })
    }

    pub fn device_abi() -> Result<String, String> {
        kotlin_plain("abi")
    }

    fn updates_dir() -> Result<PathBuf, String> {
        let cache = kotlin_plain("cacheDir")?;
        let dir = Path::new(&cache).join("updates");
        std::fs::create_dir_all(&dir).map_err(|e| format!("updates dir: {e}"))?;
        Ok(dir)
    }

    fn apk_path(dir: &Path, version: &str) -> PathBuf {
        dir.join(format!("{version}.apk"))
    }

    fn set_blocked(reason: &str) {
        *BLOCKED.lock().unwrap_or_else(|p| p.into_inner()) = reason.to_string();
    }

    fn blocked() -> String {
        BLOCKED.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// Whether this build may update itself: only a release build carries the project signature the APKs have.
    pub fn apk_updater_available_impl() -> bool {
        !cfg!(debug_assertions)
    }

    /// `"<versionCode>|same"`, `"<versionCode>|different"` or `"unreadable"` for a file on disk.
    fn inspect(path: &Path) -> Result<(u32, bool), String> {
        let answer = kotlin_string_arg("inspect", &path.to_string_lossy())?;
        let (code, sig) = answer.split_once('|').ok_or_else(|| format!("apk inspect: {answer}"))?;
        let code: u32 = code.parse().map_err(|_| format!("apk inspect: {answer}"))?;
        Ok((code, sig == "same"))
    }

    /// Deletes every file under `updates/` except an unverified `.part` and the verified APK of the pending version.
    pub fn sweep(db: &Db) {
        let Ok(dir) = updates_dir() else { return };
        let installed = version_code_for(crate::commands::COMMIT_NUMBER);
        let mut pending = pending(db);
        // A pending version the running build has caught up with is over; the kv row goes with its files.
        if let Some(p) = &pending {
            if !crate::commands::version_gt(&p.version, &crate::commands::app_version_string()) {
                db.kv_delete(PENDING_KEY);
                pending = None;
            }
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let is_pending = pending
                .as_ref()
                .map(|p| name == format!("{}.apk", p.version) || name == format!("{}.apk.part", p.version))
                .unwrap_or(false);
            let keep = if name.ends_with(".part") {
                is_pending
            } else {
                match inspect(&path) {
                    Ok((code, _)) => sweep_keeps(code, installed, is_pending),
                    Err(_) => false,
                }
            };
            if !keep {
                let _ = std::fs::remove_file(&path);
                crate::logging::info("apk", format!("swept {name}"));
            }
        }
    }

    /// The state About renders; reads the disk so a verified file from an earlier run counts as ready.
    pub fn state(db: &Db) -> ApkUpdateState {
        let mut s = ApkUpdateState {
            available: apk_updater_available_impl(),
            status: "none".into(),
            needs_install_permission: kotlin_plain("canInstall").map(|r| r == "permission").unwrap_or(false),
            ..Default::default()
        };
        let Some(p) = pending(db) else { return s };
        s.version = Some(p.version.replace('+', "."));
        if DOWNLOADING.load(Ordering::SeqCst) {
            s.status = "downloading".into();
            s.received = RECEIVED.load(Ordering::SeqCst);
            s.total = TOTAL.load(Ordering::SeqCst);
            return s;
        }
        if let Ok(dir) = updates_dir() {
            if apk_path(&dir, &p.version).is_file() {
                s.status = "ready".into();
                return s;
            }
        }
        let reason = blocked();
        if !reason.is_empty() {
            s.status = "blocked".into();
            s.reason = Some(reason);
        }
        s
    }

    fn emit_progress(app: &AppHandle, received: u64, total: u64) {
        RECEIVED.store(received, Ordering::SeqCst);
        TOTAL.store(total, Ordering::SeqCst);
        let _ = app.emit("apk-download-progress", serde_json::json!({ "received": received, "total": total }));
    }

    /// Fetches the pending APK unless something forbids it; `force_metered` is the user's own "load anyway".
    pub async fn download(app: AppHandle, db: &Db, force_metered: bool) -> Result<ApkUpdateState, String> {
        if !apk_updater_available_impl() {
            return Ok(state(db));
        }
        let Some(asset) = pending(db) else { return Ok(state(db)) };
        let dir = updates_dir()?;
        let target = apk_path(&dir, &asset.version);
        if target.is_file() {
            return Ok(state(db));
        }
        if DOWNLOADING.swap(true, Ordering::SeqCst) {
            return Ok(state(db));
        }
        let result = download_inner(&app, db, &asset, &dir, &target, force_metered).await;
        DOWNLOADING.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                set_blocked("");
                crate::logging::info("apk", format!("{} downloaded and verified", asset.version));
            }
            Err(reason) => {
                crate::logging::warn("apk", format!("download of {} stopped: {reason}", asset.version));
                set_blocked(reason.split(':').next().unwrap_or("network"));
            }
        }
        Ok(state(db))
    }

    async fn download_inner(
        app: &AppHandle,
        db: &Db,
        asset: &ApkAsset,
        dir: &Path,
        target: &Path,
        force_metered: bool,
    ) -> Result<(), String> {
        if !crate::background::is_foreground() {
            return Err("foreground".into());
        }
        let allow_metered = force_metered || db.kv_get(METERED_KEY).as_deref() == Some("1");
        if !allow_metered && kotlin_plain("isMetered")? == "true" {
            return Err("metered".into());
        }
        let free: u64 = kotlin_plain("freeBytes")?.parse().unwrap_or(u64::MAX);
        if !enough_space(free, asset.size) {
            return Err("space".into());
        }

        let part = dir.join(format!("{}.apk.part", asset.version));
        let existing = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        let mut hasher = Sha256::new();
        let mut received = 0u64;
        let offset = match resume_plan(existing, asset.size) {
            Resume::From(n) => {
                // The hash covers the whole file, so what is already on disk goes through it first.
                let mut f = std::fs::File::open(&part).map_err(|e| format!("network: {e}"))?;
                let mut buf = vec![0u8; 256 * 1024];
                loop {
                    let n = f.read(&mut buf).map_err(|e| format!("network: {e}"))?;
                    if n == 0 {
                        break;
                    }
                    hasher.update(&buf[..n]);
                }
                received = n;
                n
            }
            Resume::Restart => {
                let _ = std::fs::remove_file(&part);
                0
            }
        };
        emit_progress(app, received, asset.size);

        let client = crate::net::client_builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("network: {e}"))?;
        let mut req = client
            .get(&asset.url)
            .header("User-Agent", concat!("Karasu/", env!("CARGO_PKG_VERSION")));
        if offset > 0 {
            req = req.header("Range", format!("bytes={offset}-"));
        }
        let mut resp = req.send().await.map_err(|e| format!("network: {e}"))?;
        let resumed = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if !resp.status().is_success() {
            return Err(format!("network: HTTP {}", resp.status()));
        }
        let mut file = if resumed && offset > 0 {
            std::fs::OpenOptions::new().append(true).open(&part)
        } else {
            // The server ignored the range: start the file and the hash over.
            hasher = Sha256::new();
            received = 0;
            std::fs::File::create(&part)
        }
        .map_err(|e| format!("network: {e}"))?;

        let mut last_emit = received;
        while let Some(chunk) = resp.chunk().await.map_err(|e| format!("network: {e}"))? {
            if !crate::background::is_foreground() {
                return Err("foreground".into());
            }
            file.write_all(&chunk).map_err(|e| format!("network: {e}"))?;
            hasher.update(&chunk);
            received += chunk.len() as u64;
            if received > asset.size {
                return Err("network: longer than the manifest says".into());
            }
            if received - last_emit >= 256 * 1024 {
                last_emit = received;
                emit_progress(app, received, asset.size);
            }
        }
        file.flush().map_err(|e| format!("network: {e}"))?;
        drop(file);
        emit_progress(app, received, asset.size);

        if received != asset.size {
            return Err("network: short download".into());
        }
        let digest = format!("{:x}", hasher.finalize());
        if digest != asset.sha256 {
            let _ = std::fs::remove_file(&part);
            return Err("network: checksum mismatch".into());
        }
        let (code, same) = inspect(&part)?;
        if !same {
            let _ = std::fs::remove_file(&part);
            return Err("signature".into());
        }
        if code <= version_code_for(crate::commands::COMMIT_NUMBER) {
            let _ = std::fs::remove_file(&part);
            return Err("stale".into());
        }
        std::fs::rename(&part, target).map_err(|e| format!("network: {e}"))?;
        Ok(())
    }

    /// Hands the verified file to the system installer; the "unknown apps" switch is the one thing it cannot bypass.
    pub fn install(db: &Db) -> Result<(), String> {
        let asset = pending(db).ok_or("nothing to install")?;
        let path = apk_path(&updates_dir()?, &asset.version);
        if !path.is_file() {
            return Err("not downloaded yet".into());
        }
        if kotlin_plain("canInstall")? == "permission" {
            return Err("permission".into());
        }
        let reason = kotlin_string_arg("install", &path.to_string_lossy())?;
        if reason.is_empty() {
            crate::logging::info("apk", format!("installer opened for {}", asset.version));
            Ok(())
        } else {
            Err(reason)
        }
    }

    pub fn open_install_permission() -> Result<(), String> {
        let reason = kotlin_plain("openInstallPermission")?;
        if reason.is_empty() {
            Ok(())
        } else {
            Err(reason)
        }
    }

    /// Forgets the pending version and removes its files; the next check may find it again.
    pub fn discard(db: &Db) {
        if let (Some(p), Ok(dir)) = (pending(db), updates_dir()) {
            let _ = std::fs::remove_file(apk_path(&dir, &p.version));
            let _ = std::fs::remove_file(dir.join(format!("{}.apk.part", p.version)));
        }
        db.kv_delete(PENDING_KEY);
        set_blocked("");
    }

    #[tauri::command]
    pub fn apk_updater_available() -> bool {
        apk_updater_available_impl()
    }

    #[tauri::command]
    pub fn apk_update_state(db: State<'_, Db>) -> ApkUpdateState {
        state(&db)
    }

    #[tauri::command]
    pub async fn apk_download(
        app: AppHandle,
        db: State<'_, Db>,
        force_metered: Option<bool>,
    ) -> Result<ApkUpdateState, String> {
        download(app, &db, force_metered.unwrap_or(false)).await
    }

    #[tauri::command]
    pub fn apk_install(db: State<'_, Db>) -> Result<(), String> {
        install(&db)
    }

    #[tauri::command]
    pub fn apk_open_install_permission() -> Result<(), String> {
        open_install_permission()
    }

    #[tauri::command]
    pub fn apk_discard(db: State<'_, Db>) {
        discard(&db)
    }

    /// Opens the installer once per pending version at start, when the file is ready; a cancel is honoured after that.
    #[tauri::command]
    pub fn apk_prompt_if_ready(db: State<'_, Db>) -> bool {
        let s = state(&db);
        if s.status != "ready" || s.needs_install_permission {
            return false;
        }
        let Some(p) = pending(&db) else { return false };
        if db.kv_get(PROMPTED_KEY).as_deref() == Some(p.version.as_str()) {
            return false;
        }
        let _ = db.kv_set(PROMPTED_KEY, &p.version);
        install(&db).is_ok()
    }
}

#[cfg(not(target_os = "android"))]
pub use desktop::*;

/// The same commands on desktop, all answering "not here", so the frontend has one vocabulary.
#[cfg(not(target_os = "android"))]
mod desktop {
    use super::*;
    use tauri::State;

    #[tauri::command]
    pub fn apk_updater_available() -> bool {
        false
    }

    #[tauri::command]
    pub fn apk_update_state(_db: State<'_, Db>) -> ApkUpdateState {
        ApkUpdateState { status: "none".into(), ..Default::default() }
    }

    #[tauri::command]
    pub async fn apk_download(
        _db: State<'_, Db>,
        _force_metered: Option<bool>,
    ) -> Result<ApkUpdateState, String> {
        Ok(ApkUpdateState { status: "none".into(), ..Default::default() })
    }

    #[tauri::command]
    pub fn apk_install(_db: State<'_, Db>) -> Result<(), String> {
        Err("not on this platform".into())
    }

    #[tauri::command]
    pub fn apk_open_install_permission() -> Result<(), String> {
        Err("not on this platform".into())
    }

    #[tauri::command]
    pub fn apk_discard(_db: State<'_, Db>) {}

    #[tauri::command]
    pub fn apk_prompt_if_ready(_db: State<'_, Db>) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest() -> Value {
        json!({
            "version": "1.11.0+630",
            "platforms": {
                "windows-x86_64": { "signature": "x", "url": "https://x/setup.exe" },
                "android-arm64": { "url": "https://x/Karasu_1.11.0.630_arm64.apk", "signature": "", "sha256": "AB".repeat(32), "size": 23141036 }
            }
        })
    }

    #[test]
    fn arm64_has_its_own_leg_and_everything_else_takes_universal() {
        assert_eq!(abi_key("arm64-v8a"), "android-arm64");
        assert_eq!(abi_key("armeabi-v7a"), "android-universal");
        assert_eq!(abi_key("x86_64"), "android-universal");
    }

    #[test]
    fn the_asset_comes_with_the_manifest_version_and_a_lowercase_hash() {
        let a = parse_asset(&manifest(), "android-arm64").unwrap();
        assert_eq!(a.version, "1.11.0+630");
        assert_eq!(a.size, 23141036);
        assert_eq!(a.sha256, "ab".repeat(32));
    }

    /// A manifest from before the Android legs, or one for an ABI without a build, must read as "nothing for this device".
    #[test]
    fn a_missing_or_malformed_leg_is_none() {
        assert!(parse_asset(&manifest(), "android-universal").is_none());
        let mut m = manifest();
        m["platforms"]["android-arm64"]["sha256"] = json!("short");
        assert!(parse_asset(&m, "android-arm64").is_none());
        m["platforms"]["android-arm64"]["sha256"] = json!("ab".repeat(32));
        m["platforms"]["android-arm64"]["size"] = json!(0);
        assert!(parse_asset(&m, "android-arm64").is_none());
    }

    #[test]
    fn a_short_part_resumes_and_anything_else_restarts() {
        assert_eq!(resume_plan(1000, 5000), Resume::From(1000));
        assert_eq!(resume_plan(0, 5000), Resume::Restart);
        assert_eq!(resume_plan(5000, 5000), Resume::Restart);
        assert_eq!(resume_plan(6000, 5000), Resume::Restart);
    }

    #[test]
    fn the_installer_needs_a_second_copy_worth_of_room() {
        assert!(enough_space(50_000_000, 23_000_000));
        assert!(!enough_space(40_000_000, 23_000_000));
        assert!(enough_space(u64::MAX, u64::MAX / 2), "no overflow at the top");
    }

    /// Only the pending version survives a sweep, and only while it is still an upgrade over the running build.
    #[test]
    fn the_sweep_keeps_one_file_at_most() {
        let installed = version_code_for(624);
        assert!(sweep_keeps(version_code_for(630), installed, true));
        assert!(!sweep_keeps(version_code_for(630), installed, false), "not the pending one");
        assert!(!sweep_keeps(version_code_for(624), installed, true), "same build");
        assert!(!sweep_keeps(version_code_for(600), installed, true), "older");
    }

    /// The desktop plugin parses every platform entry as {url, signature}; an Android leg must not break its manifest.
    #[test]
    fn the_desktop_updater_still_reads_a_manifest_with_android_legs() {
        let mut m = manifest();
        m["platforms"]["android-arm64"]["signature"] = json!("");
        m["pub_date"] = json!("2026-09-14T12:00:00Z");
        let release: tauri_plugin_updater::RemoteRelease = serde_json::from_value(m).expect("manifest parses");
        assert!(release.download_url("windows-x86_64").is_ok());
        assert_eq!(release.version.to_string(), "1.11.0+630");
        let mut bare = manifest();
        bare["platforms"]["android-arm64"].as_object_mut().unwrap().remove("signature");
        bare["pub_date"] = json!("2026-09-14T12:00:00Z");
        assert!(serde_json::from_value::<tauri_plugin_updater::RemoteRelease>(bare).is_err(), "without the key the whole manifest dies");
    }

    #[test]
    fn the_version_code_matches_gradle() {
        assert_eq!(version_code_for(621), 1_000_621);
    }
}
