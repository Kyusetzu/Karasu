use crate::db::Db;
use crate::sync::LockExt;
use serde_json::Value;
use tauri::State;

// Siblings in the same module tree; `mod.rs` re-exports all of it, so every command keeps its old path.
#[allow(unused_imports)]
use super::*;

/// Monotonic commit counter, the fourth version segment, bumped by one on every commit.
pub const COMMIT_NUMBER: u32 = 714;

/// The full four-part display version; the semver core comes from the crate version.
pub fn app_version_string() -> String {
    format!("{}.{}", env!("CARGO_PKG_VERSION"), COMMIT_NUMBER)
}

/// The running four-part version, shown in the About window.
#[tauri::command]
#[specta::specta]
pub fn app_version() -> String {
    app_version_string()
}

// --- Update check ------------------------------------------------------------

#[derive(serde::Serialize, specta::Type)]
pub struct UpdateInfo {
    /// The running app version.
    pub current: String,
    /// Latest published release tag (without a leading "v"), if any.
    pub latest: Option<String>,
    /// Release page URL.
    pub url: Option<String>,
    #[serde(rename = "isNewer")]
    pub is_newer: bool,
    /// The selected channel has no release to compare against, which is not the same as "up to date".
    #[serde(rename = "channelEmpty")]
    pub channel_empty: bool,
}

/// Update channel, `stable` or `prerelease`; the default reaches new installs only, older ones were seeded by migration.
pub(crate) fn stored_channel(db: &Db) -> String {
    db.kv_get("update_channel")
        .unwrap_or_else(|| "stable".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn get_update_channel(db: State<'_, Db>) -> String {
    stored_channel(&db)
}

#[tauri::command]
#[specta::specta]
pub fn set_update_channel(
    db: State<'_, Db>,
    pending: State<'_, PendingUpdate>,
    channel: String,
) -> Result<(), String> {
    if channel != "prerelease" && channel != "stable" {
        return Err("Unknown update channel".into());
    }
    // The stash, the throttle and the announcement all belong to the channel that produced them, so all three go.
    *pending.0.guard() = None;
    db.kv_delete("last_update_check_ms");
    db.kv_delete("last_notified_update_version");
    let _ = db.notif_clear_kind("update");
    db.kv_set("update_channel", &channel)
}

/// Whether Karasu checks for updates automatically on startup; manual checks from About always work.
#[tauri::command]
#[specta::specta]
pub fn get_update_check_auto(db: State<'_, Db>) -> bool {
    db.kv_get("update_check_auto").as_deref() != Some("0")
}

#[tauri::command]
#[specta::specta]
pub fn set_update_check_auto(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("update_check_auto", if enabled { "1" } else { "0" })
}

/// Human-facing release page for `channel`, linked from the About card.
fn update_channel_release_url(channel: &str) -> &'static str {
    match channel {
        "stable" => "https://github.com/Kyusetzu/Karasu/releases/latest",
        _ => "https://github.com/Kyusetzu/Karasu/releases/tag/latest",
    }
}

/// The `latest.json` manifest the in-app updater downloads from, matching `channel`.
fn update_channel_manifest_url(channel: &str) -> &'static str {
    match channel {
        "stable" => "https://github.com/Kyusetzu/Karasu/releases/latest/download/latest.json",
        _ => "https://github.com/Kyusetzu/Karasu/releases/download/latest/latest.json",
    }
}

const UPDATE_CHECK_THROTTLE_MS: i64 = 24 * 60 * 60 * 1000;

/// Whether a background check may run; a stamp in the future counts as no stamp, or a clock jump disables checks.
fn check_due(last: Option<i64>, now: i64, throttle: i64) -> bool {
    match last {
        None => true,
        Some(last) => !(0..throttle).contains(&(now - last)),
    }
}

/// Compares the running version against the selected channel's manifest; `force: false` respects the daily throttle.
#[tauri::command]
#[specta::specta]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    force: bool,
) -> Result<UpdateInfo, String> {
    // Desktop never reads `app` on this path — the notify below is Android's.
    #[cfg(not(target_os = "android"))]
    let _ = &app;
    // The full four-part version, so a commit-only bump still registers as an update.
    let current = app_version_string();
    let channel = stored_channel(&db);

    if !force {
        let last_check = db
            .kv_get("last_update_check_ms")
            .and_then(|s| s.parse::<i64>().ok());
        // An F-Droid build (packaging/fdroid) neither installs nor announces: its client is the update path.
        if self_update_disabled() || !check_due(last_check, now_ms(), UPDATE_CHECK_THROTTLE_MS) {
            return Ok(UpdateInfo {
                current,
                latest: None,
                url: None,
                is_newer: false,
                channel_empty: false,
            });
        }
    }

    // The version comes from `latest.json`, never the tag: the rolling tag is literally "latest", which parses as 0.
    let resp = crate::net::client_builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Update check failed: {e}"))?
        .get(update_channel_manifest_url(&channel))
        .header("User-Agent", concat!("Karasu/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    // Stamped after the request, not before it, so a check that failed offline does not burn the whole day.
    let _ = db.kv_set("last_update_check_ms", &now_ms().to_string());

    // 404 is not "up to date": it means the channel has nothing behind it, which About says and the background pass does not.
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo {
            current,
            latest: None,
            url: Some(update_channel_release_url(&channel).to_string()),
            is_newer: false,
            channel_empty: true,
        });
    }
    if !resp.status().is_success() {
        return Err(format!("Update check failed: HTTP {}", resp.status()));
    }

    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let latest = body
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("Update manifest has no version")?
        .trim_start_matches('v')
        .to_string();
    // Both need their platform in the manifest; on Android the leg is the APK the updater will fetch, kept in kv.
    #[cfg(target_os = "android")]
    let is_newer = {
        let key = crate::apk_update::abi_key(&crate::apk_update::device_abi().unwrap_or_default());
        let asset = crate::apk_update::parse_asset(&body, key).filter(|_| version_gt(&latest, &current));
        match &asset {
            Some(a) => {
                let _ = db.kv_set(crate::apk_update::PENDING_KEY, &serde_json::to_string(a).unwrap_or_default());
            }
            None => db.kv_delete(crate::apk_update::PENDING_KEY),
        }
        asset.is_some()
    };
    #[cfg(not(target_os = "android"))]
    let is_newer = {
        let platform_key = if cfg!(target_os = "linux") {
            "linux-x86_64"
        } else {
            "windows-x86_64"
        };
        let has_platform = body
            .pointer("/platforms")
            .and_then(|p| p.get(platform_key))
            .is_some();
        has_platform && version_gt(&latest, &current)
    };

    // Android posts its own bell row on the background path, once per version; the download follows from the frontend.
    #[cfg(target_os = "android")]
    if !force && is_newer && db.kv_get("last_notified_update_version").as_deref() != Some(&latest)
    {
        let _ = db.kv_set("last_notified_update_version", &latest);
        let shown = display_version(&latest);
        crate::alerts::notify::notify(
            &app,
            "update",
            crate::i18n::Msg::UpdateTitle,
            crate::i18n::Msg::UpdateBodyAndroid { version: &shown },
            None,
        );
    }

    Ok(UpdateInfo {
        current,
        latest: Some(display_version(&latest)),
        url: Some(update_channel_release_url(&channel).to_string()),
        is_newer,
        channel_empty: false,
    })
}

/// Splits a version into numeric segments, treating `+` like `.`, so the manifest spelling matches the running one.
fn version_parts(s: &str) -> Vec<u32> {
    s.split(['.', '+'])
        .map(|p| p.parse::<u32>().unwrap_or(0))
        .collect()
}

/// The four-part version in its dotted display form, whatever separator it arrived with.
fn display_version(s: &str) -> String {
    s.replace('+', ".")
}

/// Whether the updater plugin exists in this build at all; `attach_desktop` registers it on desktop only.
#[cfg(desktop)]
fn updater_available() -> bool {
    true
}

#[cfg(mobile)]
fn updater_available() -> bool {
    false
}

/// Set at build time for a store that owns updates; today only the F-Droid recipe sets it.
pub(crate) fn self_update_disabled() -> bool {
    option_env!("KARASU_NO_SELF_UPDATE").is_some()
}

/// Whether an in-place update can be installed; the `is_linux` half is what keeps the updater on for every Windows user.
fn can_install(is_linux: bool, from_appimage: bool) -> bool {
    !is_linux || from_appimage
}

/// True if dotted-numeric version `a` is strictly greater than `b`.
pub(crate) fn version_gt(a: &str, b: &str) -> bool {
    let (va, vb) = (version_parts(a), version_parts(b));
    for i in 0..va.len().max(vb.len()) {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// Drops the "new release" bell row and its marker once the running build has caught up with what they announce.
pub fn clear_stale_update_notice(db: &crate::db::Db) {
    let Some(notified) = db.kv_get("last_notified_update_version") else {
        return;
    };
    if version_gt(&notified, &app_version_string()) {
        return;
    }
    db.kv_delete("last_notified_update_version");
    let _ = db.notif_clear_kind("update");
}

#[cfg(test)]
mod tests {
    use super::{can_install, check_due, display_version, version_gt, version_parts};

    /// One day in milliseconds, the throttle the checks below exercise.
    const DAY: i64 = 24 * 60 * 60 * 1000;

    #[test]
    fn a_check_is_due_when_nothing_was_ever_stamped() {
        assert!(check_due(None, 1_700_000_000_000, DAY));
    }

    #[test]
    fn the_throttle_holds_within_the_window_and_lifts_after_it() {
        let now = 1_700_000_000_000;
        assert!(!check_due(Some(now), now, DAY), "stamped this instant");
        assert!(!check_due(Some(now - DAY + 1), now, DAY), "one ms short");
        assert!(check_due(Some(now - DAY), now, DAY), "exactly a day");
        assert!(check_due(Some(now - 2 * DAY), now, DAY), "long overdue");
    }

    /// A stamp in the future does not disable checking, which the naive `now - last < throttle` would.
    #[test]
    fn a_stamp_in_the_future_does_not_disable_checking() {
        let now = 1_700_000_000_000;
        assert!(check_due(Some(now + 1), now, DAY), "one ms ahead");
        assert!(check_due(Some(now + 365 * DAY), now, DAY), "a year ahead");
    }

    /// Windows first, because the obvious `if !running_from_appimage()` gate would disable the updater for every Windows user.
    #[test]
    fn only_a_linux_build_outside_an_appimage_refuses_to_install() {
        assert!(can_install(false, false), "Windows, where the users are");
        assert!(can_install(false, true));
        assert!(can_install(true, true), "a mounted AppImage updates itself");
        assert!(
            !can_install(true, false),
            "a self-built Linux binary has nothing to install into"
        );
    }

    /// The manifest's `+` spelling compares equal to the dotted one; the updater plugin rejects a fourth dotted segment.
    #[test]
    fn the_manifest_spelling_compares_equal_to_the_dotted_one() {
        let manifest = "0.136.4+361";
        let running = "0.136.4.361";
        assert_eq!(version_parts(manifest), version_parts(running));
        assert!(!version_gt(manifest, running));
        assert!(!version_gt(running, manifest));
        // And the commit number still decides, which is the whole reason the fourth segment exists.
        assert!(version_gt("0.136.4+362", running));

        // The shape the generator emits, pinned so a "tidy" back to a dot fails a test rather than a release.
        let re_core: Vec<&str> = manifest.split('+').collect();
        assert_eq!(re_core.len(), 2, "exactly one '+'");
        assert_eq!(re_core[0].split('.').count(), 3, "a three-part semver core");
        assert!(re_core[1].chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn version_comparison() {
        assert!(version_gt("0.2.0", "0.1.0"));
        assert!(version_gt("1.0.0", "0.9.9"));
        assert!(version_gt("0.1.1", "0.1.0"));
        assert!(!version_gt("0.1.0", "0.1.0"));
        assert!(!version_gt("0.1.0", "0.2.0"));
        // Shorter vs longer: 0.1 == 0.1.0
        assert!(!version_gt("0.1", "0.1.0"));
        assert!(version_gt("0.1.0.1", "0.1.0"));
    }

    /// A non-numeric tag such as the rolling "latest" never reports an update, which is why the manifest is read.
    #[test]
    fn non_numeric_tag_never_reports_an_update() {
        assert!(!version_gt("latest", "0.19.2.82"));
        assert!(version_gt("0.19.3.83", "0.19.2.82"));
    }

    /// Semver build metadata reads as the fourth segment, so the two spellings compare identically.
    #[test]
    fn build_metadata_reads_as_the_fourth_segment() {
        assert!(version_gt("0.23.2+90", "0.23.1.89"));
        assert!(version_gt("0.23.1+90", "0.23.1.89"));
        assert!(!version_gt("0.23.1+89", "0.23.1.89"));
        assert!(!version_gt("0.23.1+88", "0.23.1.89"));
        // A commit-only bump is still an update.
        assert!(version_gt("0.23.1+90", "0.23.1+89"));
    }

    /// The comparator uses the running commit number, so the manifest for the running build does not sort above it.
    #[test]
    fn remote_is_newer_uses_the_running_commit_number() {
        use super::{remote_is_newer, COMMIT_NUMBER};
        let running = (0u64, 23u64, 2u64);
        let n = COMMIT_NUMBER as u64;

        assert!(!remote_is_newer((0, 23, 2, n), running), "same build");
        assert!(!remote_is_newer((0, 23, 2, n - 1), running), "older commit");
        assert!(!remote_is_newer((0, 23, 2, 0), running), "no build metadata");
        assert!(remote_is_newer((0, 23, 2, n + 1), running), "newer commit");
        assert!(remote_is_newer((0, 24, 0, 0), running), "newer minor");
        assert!(!remote_is_newer((0, 22, 9, n + 5), running), "older minor");
    }

    /// Versions display with dots; the manifest separator must not leak into the UI.
    #[test]
    fn versions_display_with_dots() {
        assert_eq!(display_version("0.23.2+90"), "0.23.2.90");
        assert_eq!(display_version("0.23.2.90"), "0.23.2.90");
    }

    /// The content filter levels stay in lockstep with `isBlocked` in `src/lib/contentFilter.ts`.
    #[test]
    fn content_filter_levels() {
        use super::media_blocked;
        use serde_json::json;

        let adult = json!({ "isAdult": true, "genres": ["Hentai"] });
        let ecchi = json!({ "isAdult": false, "genres": ["Comedy", "Ecchi"] });
        let plain = json!({ "isAdult": false, "genres": ["Action"] });

        for m in [&adult, &ecchi, &plain] {
            assert!(!media_blocked(m, "off"));
        }

        assert!(media_blocked(&adult, "moderate"));
        assert!(!media_blocked(&ecchi, "moderate"));
        assert!(!media_blocked(&plain, "moderate"));

        assert!(media_blocked(&adult, "strict"));
        assert!(media_blocked(&ecchi, "strict"));
        assert!(!media_blocked(&plain, "strict"));

        // Case-insensitive, and missing fields must not block.
        assert!(media_blocked(&json!({ "genres": ["ECCHI"] }), "strict"));
        assert!(!media_blocked(&json!({}), "strict"));
    }
}

// --- In-app updater ------------------------------------------------------------

/// Whether a manifest version is newer than the running build, whose commit number is `COMMIT_NUMBER`; pure, for the test.
fn remote_is_newer(remote: (u64, u64, u64, u64), current_core: (u64, u64, u64)) -> bool {
    let (major, minor, patch) = current_core;
    remote > (major, minor, patch, COMMIT_NUMBER as u64)
}

/// A downloaded update held until `install_pending_update`, so installing stays a separate, explicit user action.
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

#[derive(serde::Serialize, specta::Type)]
pub struct DownloadedUpdate {
    pub version: String,
    pub notes: Option<String>,
}

/// Checks the selected channel's manifest, downloads a newer build into the stash and notifies once it is there.
#[tauri::command]
#[specta::specta]
pub async fn download_pending_update(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<DownloadedUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;

    // `updater_builder()` panics where the plugin never ran, and the Linux guard below reads Android as Windows.
    if !updater_available() {
        crate::logging::debug_changed(
            "update",
            "install",
            "no updater on this platform; skipping the update download",
        );
        return Ok(None);
    }

    // A Linux build outside an AppImage has nothing to install into, so this refuses before downloading or notifying.
    if !can_install(cfg!(target_os = "linux"), crate::portable::running_from_appimage()) {
        crate::logging::debug_changed(
            "update",
            "install",
            "not an AppImage; skipping the update download",
        );
        return Ok(None);
    }

    let channel = stored_channel(&db);
    let endpoint = reqwest::Url::parse(update_channel_manifest_url(&channel))
        .map_err(|e| e.to_string())?;

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        // Keep this comparator: the plugin's own current version has no commit number, so every install re-downloads itself.
        .version_comparator(|current, release| {
            remote_is_newer(
                (
                    release.version.major,
                    release.version.minor,
                    release.version.patch,
                    release.version.build.as_str().parse::<u64>().unwrap_or(0),
                ),
                (current.major, current.minor, current.patch),
            )
        })
        .build()
        .map_err(|e| e.to_string())?;

    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };

    // Already downloaded: compared on the manifest spelling both sides carry, so the same bytes are not fetched daily.
    if let Some((held, _)) = pending.0.guard().as_ref() {
        if held.version == update.version {
            crate::logging::debug_changed(
                "update",
                "download",
                "the stash already holds this version; not downloading it again",
            );
            return Ok(Some(DownloadedUpdate {
                version: display_version(&held.version),
                notes: held.body.clone(),
            }));
        }
    }

    let version = display_version(&update.version);
    // Manifest form, not display form: `clear_stale_update_notice` compares it against the running build at startup.
    let raw_version = update.version.clone();
    let notes = update.body.clone();
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    *pending.0.guard() = Some((update, bytes));

    // One bell row per version, not per download: a restart empties the stash but the row it posted is still in SQLite.
    let already_announced =
        db.kv_get("last_notified_update_version").as_deref() == Some(raw_version.as_str());
    let _ = db.kv_set("last_notified_update_version", &raw_version);
    if !already_announced {
        crate::alerts::notify::notify(
            &app,
            "update",
            crate::i18n::Msg::UpdateTitle,
            // Never "restart to install it": the download lives in process memory, and a restart throws it away.
            crate::i18n::Msg::UpdateBody { version: &version },
            // An app update is not about a title, so there is nothing to open.
            None,
        );
    }

    Ok(Some(DownloadedUpdate { version, notes }))
}

/// What is sitting in the stash, so About can show a download the startup check made.
#[tauri::command]
#[specta::specta]
pub fn pending_update(pending: State<'_, PendingUpdate>) -> Option<DownloadedUpdate> {
    let guard = pending.0.guard();
    let (update, _) = guard.as_ref()?;
    Some(DownloadedUpdate {
        version: display_version(&update.version),
        notes: update.body.clone(),
    })
}

/// Installs the stashed update and restarts the app; on success this call does not return.
#[tauri::command]
#[specta::specta]
pub fn install_pending_update(
    app: tauri::AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    // Held, not taken: `install` borrows the bytes, and taking them first dropped the download on any failure.
    let guard = pending.0.guard();
    let Some((update, bytes)) = guard.as_ref() else {
        return Err("No update has been downloaded yet".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    drop(guard);
    app.restart();
}
