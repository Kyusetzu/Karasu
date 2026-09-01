use crate::db::Db;
use crate::sync::LockExt;
use serde_json::Value;
use tauri::State;

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

/// Monotonic commit counter — the 4th version segment
/// (`MAJOR.MINOR.PATCH.COMMIT#`). Bumped by one on every commit.
pub const COMMIT_NUMBER: u32 = 525;

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
    /// The selected channel has no release to compare against.
    ///
    /// Distinct from "up to date", which is what a 404 used to report. On
    /// `stable` that was a standing false claim — no non-prerelease release has
    /// ever been published, so `/releases/latest/` 404s and the manual check on
    /// the About page said, in green with a tick, that the app was current.
    #[serde(rename = "channelEmpty")]
    pub channel_empty: bool,
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
pub fn set_update_channel(
    db: State<'_, Db>,
    pending: State<'_, PendingUpdate>,
    channel: String,
) -> Result<(), String> {
    if channel != "prerelease" && channel != "stable" {
        return Err("Unknown update channel".into());
    }
    // Both stashes belong to the channel that produced them. A download held in
    // memory for the rolling build is not an update on `stable`, and the daily
    // throttle would otherwise keep the new channel unchecked for up to 24
    // hours — so About kept offering to install a build the selected channel
    // does not have.
    *pending.0.guard() = None;
    db.kv_delete("last_update_check_ms");
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

/// Whether a background check may run, given the stamp of the last one.
///
/// The obvious form — `now - last < throttle` — has no lower bound, and the
/// stamp is wall-clock rather than monotonic. A clock that jumps *backwards*
/// (a dead CMOS battery, a restored VM snapshot, a timezone-confused first
/// boot) leaves a stamp in the future, `now - last` goes negative, and
/// negative is smaller than the throttle: automatic checks stay off until
/// real time crawls past the bad stamp, which can be years. A stamp ahead of
/// now describes no elapsed interval at all, so it is treated as no stamp —
/// the check runs, and the write after the request replaces it with a sane
/// one.
fn check_due(last: Option<i64>, now: i64, throttle: i64) -> bool {
    match last {
        None => true,
        Some(last) => !(0..throttle).contains(&(now - last)),
    }
}

/// Compares the running version against the latest release on the selected
/// channel. Background/automatic callers should pass `force: false` (respects
/// a 24h throttle so startup checks don't hit the API every launch); the
/// manual "Check for Updates" button always passes `force: true`.
#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    force: bool,
) -> Result<UpdateInfo, String> {
    // Desktop never reads `app` on this path — the notify below is Android's.
    #[cfg(not(target_os = "android"))]
    let _ = &app;
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
        if !check_due(last_check, now_ms(), UPDATE_CHECK_THROTTLE_MS) {
            return Ok(UpdateInfo {
                current,
                latest: None,
                url: None,
                is_newer: false,
                channel_empty: false,
            });
        }
    }

    // Read the version from `latest.json`, not from the release's tag name.
    // The prerelease channel publishes to a rolling tag literally called
    // "latest", which `version_gt` parses as 0 — so a tag-based comparison can
    // never report an update. The manifest carries the real four-part version
    // (see scripts/release/generate-update-manifest.ps1) and is what the updater
    // downloads from anyway.
    // A timeout, like every other outbound client in this codebase. Without one
    // this inherits `reqwest`'s default of *none*, so a connection that opens
    // and then stalls parks the About page's spinner until the OS gives up —
    // and on the startup path, holds a task open for as long as that takes.
    let resp = crate::net::client_builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Update check failed: {e}"))?
        .get(update_channel_manifest_url(&channel))
        .header("User-Agent", concat!("Karasu/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    // The throttle is written here, not before the request: it used to be
    // stamped on entry, so a check that failed — offline, DNS not up yet —
    // burned the whole day. With autostart the startup check runs at exactly
    // the moment the network is least likely to be ready.
    let _ = db.kv_set("last_update_check_ms", &now_ms().to_string());

    // 404 is not "up to date". On the prerelease channel the rolling tag has
    // always existed, so it means GitHub is having a bad minute. On `stable` it
    // means no non-prerelease release exists at all — which has been true for
    // the whole life of the channel, and the app answered a manual check with a
    // green tick and "you are on the latest version". That is a standing lie
    // about a channel with nothing behind it.
    //
    // The background pass stays silent either way: a toast about a transient
    // 404 is worse than saying nothing. `channel_empty` is what the About page
    // reads to say so on a check the user asked for.
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
    // A manifest that does not describe this platform is not an update for it.
    // `release.yml` publishes a Windows-only manifest whenever the Linux leg
    // fails — deliberately, so a packaging hiccup cannot hold back a Windows
    // release — and a Linux client used to be told an update was available and
    // then fail at the download, once a day, with no way to tell why.
    // Android is the exception to the platform gate: the APK is never in
    // `platforms` (the manifest is desktop-only on purpose, and until this
    // branch existed Android fell into the windows-x86_64 arm and reported
    // "up to date" against a build that never matches). The check here is a
    // *notice* and nothing more — per the ROADMAP, "Android has no updater
    // and must not gain one by accident" — so the version alone decides and
    // `url` already points at the release page where the APK lives.
    #[cfg(target_os = "android")]
    let is_newer = version_gt(&latest, &current);
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

    // The desktop learns about an update from the bell row the *download*
    // posts; Android never downloads, so the check itself is where the row
    // comes from. Only on the background path (`!force` — a manual check has
    // the About page open in front of it), and once per version rather than
    // once per 24 h throttle window.
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

/// Whether an in-place update can actually be installed over this build.
///
/// Both arguments rather than reading the world, because the shape of this
/// predicate is the whole risk. `running_from_appimage()` is false on Windows —
/// there are no AppImages there — so the natural-looking
/// `if !running_from_appimage() { return }` disables the updater for **every**
/// Windows user, which is all of them. The `is_linux` half is what keeps that
/// from happening, and the first assertion in the test below is the one that
/// would catch it.
/// Whether the updater plugin exists in this build at all — the cfg'd pair
/// for `attach_desktop` registering it only on desktop.
#[cfg(desktop)]
fn updater_available() -> bool {
    true
}

#[cfg(mobile)]
fn updater_available() -> bool {
    false
}

fn can_install(is_linux: bool, from_appimage: bool) -> bool {
    !is_linux || from_appimage
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

/// Startup: a "new release" bell row must not outlive the install it
/// announces. Both notify paths record the announced version in this kv
/// (manifest form — `version_parts` reads `+` and `.` alike), so once the
/// running build has caught up the rows and the marker go together. The
/// row's own body can't be consulted — it froze the version as display
/// text — which is why the kv is the key. Nothing here touches a notice
/// that is still ahead of the running build.
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

    /// Windows first, and deliberately: `running_from_appimage()` is false
    /// there, so the obvious one-line form of this gate —
    /// `if !running_from_appimage() { return }` — disables the updater for
    /// every actual user of the app. This assertion is the one that catches it.
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

    /// The one this function exists for. `now - last < throttle` is true for
    /// every negative difference, so a stamp in the future — a clock pushed
    /// backwards by a dead CMOS battery or a restored snapshot — disabled
    /// automatic checks until real time caught up with it. A year ahead is a
    /// year of no update checks.
    #[test]
    fn a_stamp_in_the_future_does_not_disable_checking() {
        let now = 1_700_000_000_000;
        assert!(check_due(Some(now + 1), now, DAY), "one ms ahead");
        assert!(check_due(Some(now + 365 * DAY), now, DAY), "a year ahead");
    }

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

    /// The `+` in `latest.json`'s version field is load-bearing and was the one
    /// line with no automated check.
    ///
    /// `tauri-plugin-updater` parses that field with `semver::Version::from_str`,
    /// which rejects a fourth dotted segment outright — every install then dies
    /// with "unexpected character '.' after patch version number". So the
    /// manifest spells the commit number as build metadata, and `version_parts`
    /// has to read both spellings identically or the comparator stops matching
    /// the running build.
    #[test]
    fn the_manifest_spelling_compares_equal_to_the_dotted_one() {
        let manifest = "0.136.4+361";
        let running = "0.136.4.361";
        assert_eq!(version_parts(manifest), version_parts(running));
        assert!(!version_gt(manifest, running));
        assert!(!version_gt(running, manifest));
        // And the commit number still decides, which is the whole reason the
        // fourth segment exists.
        assert!(version_gt("0.136.4+362", running));

        // The shape the generator emits, pinned so a "tidy" back to a dot is a
        // test failure rather than a broken release.
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

    // The updater plugin is registered only on desktop (`attach_desktop`), and
    // `updater_builder()` reaches for its managed state — which *panics* when
    // the plugin never ran. The guard below cannot catch this: it asks "is
    // this Linux?", and Android answers no, which reads as Windows. Same
    // quiet-refusal shape as the AppImage case, so the auto check stays
    // silent and the About button reports "nothing downloaded" — mobile
    // distribution is the store or a sideloaded APK, never this plugin.
    if !updater_available() {
        crate::logging::debug_changed(
            "update",
            "install",
            "no updater on this platform; skipping the update download",
        );
        return Ok(None);
    }

    // Nothing to install into. `tauri-plugin-updater` replaces
    // `current_exe()` — it has no notion of `$APPIMAGE` — so on a Linux build
    // that is not a mounted AppImage the best outcome of "Install" is
    // overwriting the binary the user compiled, in place, with a different
    // build. Karasu ships exactly one Linux artifact, so today that means every
    // Linux user who did not download the AppImage.
    //
    // Downloading is the expensive half (~100 MB held in memory) and the
    // notification is the misleading half, so this refuses before either.
    if !can_install(cfg!(target_os = "linux"), crate::portable::running_from_appimage()) {
        crate::logging::debug_changed(
            "update",
            "install",
            "not an AppImage; skipping the update download",
        );
        return Ok(None);
    }

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

    // Already downloaded. The stash is the whole installer — ~100 MB held in
    // process memory — and this pass runs once a day, so without this check a
    // user who is offered an update and simply does not restart pays for it
    // again every 24 h, forever, on their own bandwidth. Downloading the same
    // bytes on top of the bytes we already hold buys nothing: `install` reads
    // the stash, and the version is the only thing that decides whether the
    // stash is still the right answer.
    //
    // Compared on `update.version`, the manifest spelling, because that is what
    // both sides carry; `display_version` is for the UI and would compare two
    // renderings rather than two versions.
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
    // Manifest form, not display form: it is what `clear_stale_update_notice`
    // compares against the running build at the next startup, so the "new
    // release" row cannot outlive its own install. The same marker the
    // Android arm writes.
    let raw_version = update.version.clone();
    let notes = update.body.clone();
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    *pending.0.guard() = Some((update, bytes));

    // One row per version, not one per download. The stash lives in process
    // memory, so a restart empties it and the next background pass downloads
    // the same version again — legitimately, the bytes are gone — but the bell
    // row it posted the first time is in SQLite and is still there. Posting
    // another announces the same release twice. `clear_stale_update_notice`
    // removes the marker and the rows together once the running build catches
    // up, so the next genuinely new version still gets its row.
    //
    // This is the guard the Android arm of `check_for_updates` has always had;
    // the desktop path notified unconditionally.
    let already_announced =
        db.kv_get("last_notified_update_version").as_deref() == Some(raw_version.as_str());
    let _ = db.kv_set("last_notified_update_version", &raw_version);
    if !already_announced {
        crate::alerts::notify::notify(
            &app,
            "update",
            crate::i18n::Msg::UpdateTitle,
            // Emphatically *not* "restart to install it", which is what this
            // said. The download lives in process memory, so restarting is
            // precisely the action that throws it away — the instruction undid
            // the thing it was announcing, and the next check downloaded the
            // whole installer again. The wording is in `i18n.rs` now, with
            // that note beside it.
            crate::i18n::Msg::UpdateBody { version: &version },
            // An app update is not about a title, so there is nothing to open.
            None,
        );
    }

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
    let guard = pending.0.guard();
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
    let guard = pending.0.guard();
    let Some((update, bytes)) = guard.as_ref() else {
        return Err("No update has been downloaded yet".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    drop(guard);
    app.restart();
}
