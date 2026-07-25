//! Local library: scan a folder for video files, match them to the user's
//! AniList entries with the existing parser/matcher, and let the user play
//! the next unwatched episode straight from Karasu — Taiga's killer feature
//! and a reason to use the app over the website.

use crate::db::Db;
use crate::recognition::{matcher, parser};
use crate::scrobbler::candidates_from_cache;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Depth and size caps so a mistakenly picked huge folder can't hang the scan.
const MAX_DEPTH: usize = 6;
const MAX_FILES: usize = 20_000;

/// media_id → (episode → absolute file path), plus the summary last returned.
#[derive(Default)]
pub struct LibraryData {
    by_media: HashMap<i64, HashMap<u32, String>>,
    summary: Vec<LibraryEntry>,
}

pub struct LibraryIndex(pub Mutex<LibraryData>);

impl Default for LibraryIndex {
    fn default() -> Self {
        LibraryIndex(Mutex::new(LibraryData::default()))
    }
}

/// One episode present on disk.
#[derive(Clone, serde::Serialize)]
pub struct LibraryFile {
    pub episode: u32,
    pub path: String,
}

/// Which episodes of a matched entry are present on disk. `episodes` is kept
/// as a bare sorted list so existing callers stay unchanged; `files` carries
/// the paths for the library page.
#[derive(Clone, serde::Serialize)]
pub struct LibraryEntry {
    #[serde(rename = "mediaId")]
    pub media_id: i64,
    pub episodes: Vec<u32>,
    pub files: Vec<LibraryFile>,
}

#[derive(serde::Serialize)]
pub struct ScanSummary {
    pub entries: Vec<LibraryEntry>,
    /// Total video files seen (matched or not).
    pub files: usize,
    pub matched: usize,
}

#[tauri::command]
pub fn get_library_path(db: State<'_, Db>) -> Option<String> {
    db.kv_get("library_path")
}

#[tauri::command]
pub fn set_library_path(db: State<'_, Db>, path: String) -> Result<(), String> {
    db.kv_set("library_path", path.trim())
}

/// Opens a native folder picker and returns the chosen path.
#[tauri::command]
pub fn pick_library_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

/// The most recent scan's index (empty before the first scan).
#[tauri::command]
pub fn get_library_index(state: State<'_, LibraryIndex>) -> Vec<LibraryEntry> {
    state.0.lock().unwrap().summary.clone()
}

/// Scans the configured folder and rebuilds the index.
#[tauri::command]
pub fn scan_library(app: AppHandle) -> Result<ScanSummary, String> {
    let db = app.state::<Db>();
    let root = db
        .kv_get("library_path")
        .filter(|p| !p.is_empty())
        .ok_or("No library folder set")?;

    let candidates = candidates_from_cache(&db, "ANIME");
    if candidates.is_empty() {
        return Err("Load your anime list first, then scan".into());
    }

    let mut files = Vec::new();
    collect_videos(Path::new(&root), 0, &mut files);
    let total = files.len();

    let mut by_media: HashMap<i64, HashMap<u32, String>> = HashMap::new();
    for path in &files {
        let name = Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let parsed = parser::parse(&name);
        let Some(episode) = parsed.episode else { continue };
        if let Some(m) = matcher::best_match(&parsed, &candidates) {
            by_media
                .entry(m.media_id)
                .or_default()
                .entry(episode)
                .or_insert_with(|| path.clone());
        }
    }

    let summary = build_summary(&by_media);

    // Persist so the index survives a restart — without this every relaunch
    // drops the library and the play buttons disappear until a manual rescan.
    let rows: Vec<(i64, u32, String)> = by_media
        .iter()
        .flat_map(|(id, eps)| eps.iter().map(move |(ep, path)| (*id, *ep, path.clone())))
        .collect();
    db.library_replace_all(&rows)?;

    let matched = summary.len();
    let state = app.state::<LibraryIndex>();
    *state.0.lock().unwrap() = LibraryData { by_media, summary: summary.clone() };

    Ok(ScanSummary { entries: summary, files: total, matched })
}

/// Builds the sorted, frontend-facing summary from the index map.
fn build_summary(by_media: &HashMap<i64, HashMap<u32, String>>) -> Vec<LibraryEntry> {
    let mut summary: Vec<LibraryEntry> = by_media
        .iter()
        .map(|(id, eps)| {
            let mut files: Vec<LibraryFile> = eps
                .iter()
                .map(|(episode, path)| LibraryFile { episode: *episode, path: path.clone() })
                .collect();
            files.sort_unstable_by_key(|f| f.episode);
            let episodes = files.iter().map(|f| f.episode).collect();
            LibraryEntry { media_id: *id, episodes, files }
        })
        .collect();
    summary.sort_by_key(|e| e.media_id);
    summary
}

/// Restores the index from the database at startup (no disk walk).
pub fn hydrate(app: &AppHandle) {
    let db = app.state::<Db>();
    let rows = db.library_all();
    if rows.is_empty() {
        return;
    }
    let mut by_media: HashMap<i64, HashMap<u32, String>> = HashMap::new();
    for (media_id, episode, path) in rows {
        by_media.entry(media_id).or_default().insert(episode, path);
    }
    let summary = build_summary(&by_media);
    let state = app.state::<LibraryIndex>();
    *state.0.lock().unwrap() = LibraryData { by_media, summary };
}

/// Opens the next unwatched episode of `media_id` in the default player.
/// The existing detection then picks it up and scrobbles it as usual.
#[tauri::command]
pub fn play_next(app: AppHandle, media_id: i64) -> Result<(), String> {
    let db = app.state::<Db>();
    let progress = candidates_from_cache(&db, "ANIME")
        .iter()
        .find(|c| c.media_id == media_id)
        .map(|c| c.progress)
        .unwrap_or(0);

    let path = {
        let state = app.state::<LibraryIndex>();
        let guard = state.0.lock().unwrap();
        let eps = guard
            .by_media
            .get(&media_id)
            .ok_or("No files for this title — scan your library")?;
        // Prefer exactly progress+1, else the earliest episode beyond progress.
        eps.get(&(progress + 1))
            .cloned()
            .or_else(|| {
                eps.iter()
                    .filter(|(ep, _)| **ep > progress)
                    .min_by_key(|(ep, _)| **ep)
                    .map(|(_, p)| p.clone())
            })
            .ok_or("No unwatched episode on disk")?
    };

    open_path(&app, &path)
}

/// Opens `path` in the default player, reporting a stale index clearly — the
/// index is persisted now, so a file can legitimately have moved since the
/// last scan.
fn open_path(app: &AppHandle, path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("That file is no longer on disk — rescan your library".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Could not open the file: {e}"))
}

/// Recursively collects video files up to the depth/size caps.
fn collect_videos(dir: &Path, depth: usize, out: &mut Vec<String>) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_videos(&path, depth + 1, out);
        } else if is_video(&path) {
            out.push(path.to_string_lossy().to_string());
        }
    }
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| parser::VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recognition::matcher::Candidate;

    fn frieren() -> Vec<Candidate> {
        vec![Candidate {
            media_id: 154587,
            titles: vec!["Sousou no Frieren".into()],
            episodes: Some(28),
            duration_min: Some(24),
            progress: 12,
            status: "CURRENT".into(),
        }]
    }

    /// A real release filename must match and yield the right episode.
    #[test]
    fn matches_release_filename_to_episode() {
        let candidates = frieren();
        let name = "[SubsPlease] Sousou no Frieren - 13 (1080p) [ABCD1234].mkv";
        let parsed = parser::parse(name);
        assert_eq!(parsed.episode, Some(13));
        let m = matcher::best_match(&parsed, &candidates).expect("should match");
        assert_eq!(m.media_id, 154587);
    }

    #[test]
    fn ignores_non_video_and_unmatched() {
        assert!(!is_video(Path::new("notes.txt")));
        assert!(is_video(Path::new("ep.mkv")));
        let parsed = parser::parse("Totally Unrelated Show - 03.mkv");
        assert!(matcher::best_match(&parsed, &frieren()).is_none());
    }
}
