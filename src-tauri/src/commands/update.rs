use crate::db::Db;
use serde_json::Value;
use tauri::State;

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

/// Monotonic commit counter — the 4th version segment
/// (`MAJOR.MINOR.PATCH.COMMIT#`). Bumped by one on every commit.
pub const COMMIT_NUMBER: u32 = 240;

/// Full four-part display version, e.g. `0.1.1.38`. The `MAJOR.MINOR.PATCH`
/// core comes from the crate version (kept in sync across the manifests).
pub fn app_version_string() -> String {
    format!("{}.{}", env!("CARGO_PKG_VERSION"), COMMIT_NUMBER)
}

/// The running four-part version, shown in the About window.
#[tauri::command]
pub fn app_version() -> String {
    app_version_string()
}

// --- Update check ------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    /// The running app version.
    pub current: String,
    /// Latest published release tag (without a leading "v"), if any.
    pub latest: Option<String>,
    /// Release page URL.
    pub url: Option<String>,
    #[serde(rename = "isNewer")]
    pub is_newer: bool,
}

/// Update channel: `"prerelease"` (the rolling `latest` tag, default — the
/// only channel with real releases today) or `"stable"` (GitHub's
/// latest-non-prerelease alias, for whenever stable tags start being
/// published).
#[tauri::command]
pub fn get_update_channel(db: State<'_, Db>) -> String {
    db.kv_get("update_channel")
        .unwrap_or_else(|| "prerelease".to_string())
}

#[tauri::command]
pub fn set_update_channel(db: State<'_, Db>, channel: String) -> Result<(), String> {
    if channel != "prerelease" && channel != "stable" {
        return Err("Unknown update channel".into());
    }
    db.kv_set("update_channel", &channel)
}

/// Whether Karasu checks for updates automatically (once/day on startup).
/// Manual checks from the About page always work regardless.
#[tauri::command]
pub fn get_update_check_auto(db: State<'_, Db>) -> bool {
    db.kv_get("update_check_auto").as_deref() != Some("0")
}

#[tauri::command]
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

/// Compares the running version against the latest release on the selected
/// channel. Background/automatic callers should pass `force: false` (respects
/// a 24h throttle so startup checks don't hit the API every launch); the
/// manual "Check for Updates" button always passes `force: true`.
#[tauri::command]
pub async fn check_for_updates(db: State<'_, Db>, force: bool) -> Result<UpdateInfo, String> {
    // Compare the full four-part version so a release tagged with the commit
    // number lines up with what's running.
    let current = app_version_string();
    let channel = db
        .kv_get("update_channel")
        .unwrap_or_else(|| "prerelease".to_string());

    if !force {
        let last_check = db
            .kv_get("last_update_check_ms")
            .and_then(|s| s.parse::<i64>().ok());
        if let Some(last) = last_check {
            if now_ms() - last < UPDATE_CHECK_THROTTLE_MS {
                return Ok(UpdateInfo { current, latest: None, url: None, is_newer: false });
            }
        }
    }
    let _ = db.kv_set("last_update_check_ms", &now_ms().to_string());

    // Read the version from `latest.json`, not from the release's tag name.
    // The prerelease channel publishes to a rolling tag literally called
    // "latest", which `version_gt` parses as 0 — so a tag-based comparison can
    // never report an update. The manifest carries the real four-part version
    // (see scripts/release/generate-update-manifest.ps1) and is what the updater
    // downloads from anyway.
    let resp = reqwest::Client::new()
        .get(update_channel_manifest_url(&channel))
        .header("User-Agent", concat!("Karasu/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    // No release published yet on this channel — treat as "up to date".
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo { current, latest: None, url: None, is_newer: false });
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
    let is_newer = version_gt(&latest, &current);
    Ok(UpdateInfo {
        current,
        latest: Some(display_version(&latest)),
        url: Some(update_channel_release_url(&channel).to_string()),
        is_newer,
    })
}

/// Splits a version into numeric segments, treating `+` exactly like `.`.
///
/// `latest.json` carries the commit number as semver build metadata
/// (`0.23.2+90`) rather than a fourth dotted segment, because the updater
/// plugin parses that field as strict semver. Both spellings have to compare
/// identically here, so the running `0.23.2.90` lines up with the manifest.
fn version_parts(s: &str) -> Vec<u32> {
    s.split(['.', '+'])
        .map(|p| p.parse::<u32>().unwrap_or(0))
        .collect()
}

/// The four-part version in its display form, whatever separator it arrived
/// with — the UI has always shown `MAJOR.MINOR.PATCH.COMMIT#`.
fn display_version(s: &str) -> String {
    s.replace('+', ".")
}

/// True if dotted-numeric version `a` is strictly greater than `b`.
fn version_gt(a: &str, b: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::{display_version, version_gt};

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

    /// Why `check_for_updates` reads the manifest instead of the release tag.
    /// The prerelease channel publishes to a rolling tag literally named
    /// "latest", which parses to 0 here — so a tag-based comparison silently
    /// reported "up to date" forever. Feeding a version string in still has to
    /// work, so both halves are pinned.
    #[test]
    fn non_numeric_tag_never_reports_an_update() {
        assert!(!version_gt("latest", "0.19.2.82"));
        assert!(version_gt("0.19.3.83", "0.19.2.82"));
    }

    /// `latest.json` spells the commit number as semver build metadata
    /// (`0.23.2+90`) because tauri-plugin-updater parses that field as strict
    /// semver and a fourth dotted segment makes it fail to deserialize —
    /// which is what broke installing with "unexpected character '.' after
    /// patch version number". The two spellings must compare identically.
    #[test]
    fn build_metadata_reads_as_the_fourth_segment() {
        assert!(version_gt("0.23.2+90", "0.23.1.89"));
        assert!(version_gt("0.23.1+90", "0.23.1.89"));
        assert!(!version_gt("0.23.1+89", "0.23.1.89"));
        assert!(!version_gt("0.23.1+88", "0.23.1.89"));
        // A commit-only bump is still an update.
        assert!(version_gt("0.23.1+90", "0.23.1+89"));
    }

    /// The comparator handed to tauri-plugin-updater. The case that matters
    /// most is the *equal* one: the plugin's own `current_version` comes from
    /// Cargo.toml and has no commit number, so without this the manifest for
    /// the running build would sort above it and the app would reinstall
    /// itself on a loop.
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

    /// The About page has always shown MAJOR.MINOR.PATCH.COMMIT#; the manifest
    /// separator is an implementation detail and must not leak into the UI.
    #[test]
    fn versions_display_with_dots() {
        assert_eq!(display_version("0.23.2+90"), "0.23.2.90");
        assert_eq!(display_version("0.23.2.90"), "0.23.2.90");
    }

    /// Must stay in lockstep with `isBlocked` in src/lib/contentFilter.ts —
    /// the background passes would otherwise notify about titles the UI hides.
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

/// Whether a manifest's `(major, minor, patch, commit)` is newer than the
/// running build, whose commit number is `COMMIT_NUMBER` rather than anything
/// the plugin can see (see the comparator in `download_pending_update`).
///
/// Split out from the closure so the comparison is testable without
/// constructing a `semver::Version`.
fn remote_is_newer(remote: (u64, u64, u64, u64), current_core: (u64, u64, u64)) -> bool {
    let (major, minor, patch) = current_core;
    remote > (major, minor, patch, COMMIT_NUMBER as u64)
}

/// Downloaded-but-not-yet-installed update, held between
/// `download_pending_update` and `install_pending_update` so applying it is a
/// separate, explicit user action (installing closes and restarts the app).
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

#[derive(serde::Serialize)]
pub struct DownloadedUpdate {
    pub version: String,
    pub notes: Option<String>,
}

/// Checks the selected channel's manifest and, if a newer version is
/// available, downloads it and stashes it for `install_pending_update`.
/// Notifies the user (kind: "update") once the download finishes.
#[tauri::command]
pub async fn download_pending_update(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<DownloadedUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;

    let channel = db
        .kv_get("update_channel")
        .unwrap_or_else(|| "prerelease".to_string());
    let endpoint = reqwest::Url::parse(update_channel_manifest_url(&channel))
        .map_err(|e| e.to_string())?;

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        // Without this the app would re-offer the build it is already running,
        // forever. The plugin's default is `remote > current` using semver's
        // *derived* Ord, which does compare build metadata — but its
        // `current_version` comes from `package_info()`, i.e. Cargo.toml, which
        // carries only `MAJOR.MINOR.PATCH` and no commit number at all. So the
        // running 0.23.2.90 arrives here as a bare `0.23.2`, and any manifest
        // with build metadata (`0.23.2+90` — the very same build) sorts above
        // it: download, restart, repeat.
        //
        // COMMIT_NUMBER is a compile-time const in this file, so supplying the
        // running commit number here is exact rather than reconstructed.
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

    let version = display_version(&update.version);
    let notes = update.body.clone();
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    *pending.0.lock().unwrap() = Some((update, bytes));
    crate::alerts::notify::notify(
        &app,
        "update",
        "Update ready",
        // Emphatically *not* "restart to install it", which is what this said.
        // The download lives in process memory, so restarting is precisely the
        // action that throws it away — the instruction undid the thing it was
        // announcing, and the next check downloaded the whole installer again.
        &format!("Karasu {version} is ready. Open About to install it."),
    );

    Ok(Some(DownloadedUpdate { version, notes }))
}

/// What is sitting in the stash, if anything.
///
/// Without this the frontend could not tell. `About` only ever learned about a
/// download from its own call, so an update fetched automatically at startup
/// was invisible there: no Restart button, and the only way forward was to
/// check again and download the identical installer a second time.
#[tauri::command]
pub fn pending_update(pending: State<'_, PendingUpdate>) -> Option<DownloadedUpdate> {
    let guard = pending.0.lock().unwrap();
    let (update, _) = guard.as_ref()?;
    Some(DownloadedUpdate {
        version: display_version(&update.version),
        notes: update.body.clone(),
    })
}

/// Installs the update stashed by `download_pending_update` and restarts the
/// app. On Windows the NSIS installer requires the running process to exit,
/// so this call does not return on success.
#[tauri::command]
pub fn install_pending_update(
    app: tauri::AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    // Held, not taken. `install` borrows the bytes, and taking them first meant
    // a failure — an AV agent blocking the extracted installer, an unwritable
    // %TEMP%, a refused UAC prompt — dropped the download on the floor. The
    // second click then answered "No update has been downloaded yet" directly
    // underneath a line saying it had been, and the only recovery was to
    // download the whole thing again.
    let guard = pending.0.lock().unwrap();
    let Some((update, bytes)) = guard.as_ref() else {
        return Err("No update has been downloaded yet".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    drop(guard);
    app.restart();
}
