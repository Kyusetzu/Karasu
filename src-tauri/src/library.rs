//! Local library: scan a folder for video files, match them to the user's
//! AniList entries with the existing parser/matcher, and let the user play
//! the next unwatched episode straight from Karasu — Taiga's killer feature
//! and a reason to use the app over the website.

use crate::db::Db;
use crate::playback::recognition::{matcher, parser};
use crate::playback::scrobbler::candidates_from_cache;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Depth and size caps so a mistakenly picked huge folder can't hang the scan.
const MAX_DEPTH: usize = 6;
const MAX_FILES: usize = 20_000;

/// One video file, as the scan understood it.
///
/// The index is this list and nothing else; `by_media`, the summary and the
/// unplaced groups are all derived from it. That matters because of what a
/// correction has to do: re-point exactly the files whose release name parsed
/// to a given title, and no others. A map keyed by media id cannot express
/// that — when two folders match one title, their files are already merged and
/// no longer separable — so the flat list is what makes "this one is wrong"
/// answerable without a rescan.
#[derive(Clone)]
pub struct ScannedFile {
    pub title: String,
    /// `-1` where the release name carried no season, matching `library_*`.
    pub season: i32,
    pub episode: u32,
    pub path: String,
    /// `None` until something places it — the matcher, or the user.
    pub media_id: Option<i64>,
    pub score: f64,
    /// Placed by a correction rather than by the matcher.
    pub manual: bool,
}

/// Every scanned file, plus the two views the frontend asks for.
#[derive(Default)]
pub struct LibraryData {
    files: Vec<ScannedFile>,
    by_media: HashMap<i64, HashMap<u32, String>>,
    /// The confidences live on the summary rows themselves — the only thing
    /// that reads them is the screen, and it reads the summary.
    summary: Vec<LibraryEntry>,
    unmatched: Vec<UnmatchedGroup>,
}

impl LibraryData {
    /// Rebuilds every derived view from `files`. Called after a scan and after
    /// each correction, so the two can never disagree.
    fn reindex(&mut self) {
        let mut by_media: HashMap<i64, HashMap<u32, String>> = HashMap::new();
        let mut scores: HashMap<i64, f64> = HashMap::new();
        let mut manual: HashMap<i64, bool> = HashMap::new();
        let mut sources: HashMap<i64, Vec<TitleKey>> = HashMap::new();
        let mut groups: HashMap<(String, i32), Vec<LibraryFile>> = HashMap::new();

        for f in &self.files {
            match f.media_id {
                Some(id) => {
                    by_media
                        .entry(id)
                        .or_default()
                        .entry(f.episode)
                        .or_insert_with(|| f.path.clone());
                    // Two folders can land on one title — a season and its
                    // batch re-encode, say. The best of them is what the row
                    // should claim.
                    let best = scores.entry(id).or_insert(f.score);
                    if f.score > *best {
                        *best = f.score;
                    }
                    *manual.entry(id).or_insert(false) |= f.manual;
                    let key = TitleKey { title: f.title.clone(), season: f.season };
                    let seen = sources.entry(id).or_default();
                    if !seen.iter().any(|k| k.title == key.title && k.season == key.season) {
                        seen.push(key);
                    }
                }
                None => groups
                    .entry((f.title.clone(), f.season))
                    .or_default()
                    .push(LibraryFile { episode: f.episode, path: f.path.clone() }),
            }
        }

        self.summary = build_summary(&by_media, &scores, &manual, &sources);
        self.by_media = by_media;
        self.unmatched = groups
            .into_iter()
            .map(|((title, season), mut files)| {
                files.sort_unstable_by_key(|f| f.episode);
                UnmatchedGroup { title, season, files }
            })
            .collect();
        // Most files first: the folder with a season in it is the one worth
        // placing, and a stray extra that parsed to its own title is not.
        self.unmatched
            .sort_by(|a, b| b.files.len().cmp(&a.files.len()).then(a.title.cmp(&b.title)));
    }

    fn unmatched_rows(&self) -> Vec<(String, i32, u32, String)> {
        self.unmatched
            .iter()
            .flat_map(|g| {
                g.files
                    .iter()
                    .map(move |f| (g.title.clone(), g.season, f.episode, f.path.clone()))
            })
            .collect()
    }
}

/// The parse a correction is keyed on: what the release name said it was.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct TitleKey {
    pub title: String,
    pub season: i32,
}

/// Files that parsed to a title the matcher could not place.
#[derive(Clone, serde::Serialize)]
pub struct UnmatchedGroup {
    pub title: String,
    pub season: i32,
    pub files: Vec<LibraryFile>,
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
    /// Matcher confidence, 0–1. `1.0` is the exact-title short circuit; the
    /// screen says "exact" there and "close" below it, because a fuzzy match
    /// is a guess and the user is the only one who can check it.
    pub score: f64,
    /// The release names that led here — what a correction has to be keyed on.
    pub sources: Vec<TitleKey>,
    /// Placed by the user rather than by the matcher, so the screen can say so
    /// instead of reporting a confidence nothing measured.
    pub manual: bool,
}

#[derive(serde::Serialize)]
pub struct ScanSummary {
    pub entries: Vec<LibraryEntry>,
    /// Total video files seen (matched or not).
    pub files: usize,
    pub matched: usize,
}

/// What the library screen's path row says, without needing a scan to say it.
#[derive(serde::Serialize)]
pub struct LibraryStatus {
    pub path: Option<String>,
    /// Video files the last scan walked past, matched or not.
    #[serde(rename = "filesSeen")]
    pub files_seen: usize,
    /// Titles it could identify.
    pub matched: usize,
}

/// The folder, and what the last scan made of it.
///
/// `ScanSummary` carries the same two counts but only as the return value of a
/// scan, so a restart forgot them and the row had nothing to show until the
/// user rescanned.
#[tauri::command]
pub fn get_library_status(db: State<'_, Db>, state: State<'_, LibraryIndex>) -> LibraryStatus {
    LibraryStatus {
        path: db.kv_get("library_path").filter(|p| !p.is_empty()),
        files_seen: db
            .kv_get("library_files_seen")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        matched: state.0.lock().unwrap().summary.len(),
    }
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
///
/// `async` is load-bearing rather than decorative: `tauri-macros` defaults a
/// plain `#[tauri::command]` to `ExecutionContext::Blocking`, which runs the
/// body inline on the WebView2 UI thread. A recursive walk of up to
/// `MAX_FILES` plus a fuzzy match per file froze the whole window — the
/// "scanning" spinner could not even animate, because the thread that would
/// have animated it was doing the scan.
#[tauri::command(async)]
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

    let overrides = override_map(&db);
    let mut data = LibraryData {
        files: index_files(&files, &candidates, &overrides),
        ..Default::default()
    };
    data.reindex();

    // Persist so the index survives a restart — without this every relaunch
    // drops the library and the play buttons disappear until a manual rescan.
    persist(&db, &data)?;
    // The count of files *walked* is not derivable from the index — most of
    // them matched nothing — so it is stored rather than recomputed.
    db.kv_set("library_files_seen", &total.to_string())?;

    let summary = data.summary.clone();
    let matched = summary.len();
    let state = app.state::<LibraryIndex>();
    *state.0.lock().unwrap() = data;

    Ok(ScanSummary { entries: summary, files: total, matched })
}

/// The user's corrections, in the shape `index_files` looks them up by.
fn override_map(db: &Db) -> HashMap<(String, i32), i64> {
    db.library_overrides()
        .into_iter()
        .map(|(title, season, media_id)| ((title, season), media_id))
        .collect()
}

/// Writes the whole index — files, confidences, sources and the unplaced —
/// so a restart and a correction see the same picture a scan just built.
fn persist(db: &Db, data: &LibraryData) -> Result<(), String> {
    let rows: Vec<(i64, u32, String)> = data
        .by_media
        .iter()
        .flat_map(|(id, eps)| eps.iter().map(move |(ep, path)| (*id, *ep, path.clone())))
        .collect();
    let score_rows: Vec<(i64, f64)> =
        data.summary.iter().map(|e| (e.media_id, e.score)).collect();
    db.library_replace_all(&rows, &score_rows)?;
    db.library_replace_unmatched(&data.unmatched_rows())
}

/// Maps every video file that parses to an episode onto the entry it belongs
/// to. The first path wins for a given (media, episode) pair.
///
/// A library is organised per series, so the same (title, season) recurs once
/// per episode file. `best_match` is pure in that pair plus `candidates`, so it
/// only has to run once per distinct series rather than once per file — which
/// collapses its input from the file count (up to `MAX_FILES`) to the
/// distinct-title count, typically a few hundred.
///
/// Negative results are cached too, deliberately: an unmatched file (an OP, an
/// ED, an extra) never hits the exact-match short circuit inside `best_match`
/// and so costs a full fuzzy sweep over every candidate — the most expensive
/// case there is, and the one most likely to repeat across a season folder.
///
/// The candidate list is normalized and trigrammed once up front rather than
/// per lookup, which is the other half of the same idea.
/// An override is consulted *before* the matcher rather than applied after it.
/// Running the matcher first and then overwriting its answer would waste the
/// expensive fuzzy sweep on precisely the titles the user has already told us
/// the matcher gets wrong.
fn index_files(
    files: &[String],
    candidates: &[matcher::Candidate],
    overrides: &HashMap<(String, i32), i64>,
) -> Vec<ScannedFile> {
    let prepared = matcher::prepare(candidates);
    let mut scanned = Vec::new();
    let mut matched_titles: HashMap<(String, Option<u32>), Option<(i64, f64)>> = HashMap::new();

    for path in files {
        let name = Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let parsed = parser::parse(&name);
        let Some(episode) = parsed.episode else { continue };
        let season = season_key(parsed.season);

        let forced = overrides.get(&(parsed.title.clone(), season)).copied();
        let hit = match forced {
            Some(id) => Some((id, 1.0)),
            None => *matched_titles
                .entry((parsed.title.clone(), parsed.season))
                .or_insert_with(|| {
                    matcher::best_match_prepared(&parsed, &prepared).map(|m| (m.media_id, m.score))
                }),
        };

        scanned.push(ScannedFile {
            title: parsed.title,
            season,
            episode,
            path: path.clone(),
            media_id: hit.map(|(id, _)| id),
            score: hit.map(|(_, s)| s).unwrap_or(0.0),
            manual: forced.is_some(),
        });
    }
    scanned
}

/// `Option<u32>` seasons become `-1`, so the in-memory key and the database key
/// are the same value and neither has to translate for the other.
fn season_key(season: Option<u32>) -> i32 {
    season.map(|s| s as i32).unwrap_or(-1)
}

/// Builds the sorted, frontend-facing summary from the derived maps.
fn build_summary(
    by_media: &HashMap<i64, HashMap<u32, String>>,
    scores: &HashMap<i64, f64>,
    manual: &HashMap<i64, bool>,
    sources: &HashMap<i64, Vec<TitleKey>>,
) -> Vec<LibraryEntry> {
    let mut summary: Vec<LibraryEntry> = by_media
        .iter()
        .map(|(id, eps)| {
            let mut files: Vec<LibraryFile> = eps
                .iter()
                .map(|(episode, path)| LibraryFile { episode: *episode, path: path.clone() })
                .collect();
            files.sort_unstable_by_key(|f| f.episode);
            let episodes = files.iter().map(|f| f.episode).collect();
            LibraryEntry {
                media_id: *id,
                episodes,
                files,
                score: scores.get(id).copied().unwrap_or(0.0),
                sources: sources.get(id).cloned().unwrap_or_default(),
                manual: manual.get(id).copied().unwrap_or(false),
            }
        })
        .collect();
    summary.sort_by_key(|e| e.media_id);
    summary
}

/// Restores the index from the database at startup (no disk walk).
///
/// The stored rows carry no title, so each one's is recovered by re-parsing its
/// filename. That is not a shortcut around a missing column: `parser::parse` is
/// pure and the filename has not changed, so it returns exactly what the scan
/// saw — and a title derived this way cannot drift out of step with the parser
/// the way a copy written months ago could.
pub fn hydrate(app: &AppHandle) {
    let db = app.state::<Db>();
    let rows = db.library_all();
    let unmatched = db.library_unmatched();
    if rows.is_empty() && unmatched.is_empty() {
        return;
    }
    let scores: HashMap<i64, f64> = db.library_scores().into_iter().collect();
    let overrides = override_map(&db);

    let mut files: Vec<ScannedFile> = rows
        .into_iter()
        .map(|(media_id, episode, path)| {
            let (title, season) = reparse(&path);
            ScannedFile {
                manual: overrides.get(&(title.clone(), season)) == Some(&media_id),
                title,
                season,
                episode,
                path,
                media_id: Some(media_id),
                score: scores.get(&media_id).copied().unwrap_or(0.0),
            }
        })
        .collect();

    files.extend(unmatched.into_iter().map(|(title, season, episode, path)| {
        ScannedFile { title, season, episode, path, media_id: None, score: 0.0, manual: false }
    }));

    let mut data = LibraryData { files, ..Default::default() };
    data.reindex();
    let state = app.state::<LibraryIndex>();
    *state.0.lock().unwrap() = data;
}

/// Recovers the `(title, season)` a path parses to.
fn reparse(path: &str) -> (String, i32) {
    let name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let parsed = parser::parse(&name);
    (parsed.title, season_key(parsed.season))
}

/// Files the last scan could not place, grouped by what it read them as.
#[tauri::command]
pub fn get_library_unmatched(state: State<'_, LibraryIndex>) -> Vec<UnmatchedGroup> {
    state.0.lock().unwrap().unmatched.clone()
}

/// Points every file that parses to `title`/`season` at `media_id`.
///
/// Applied to the in-memory index immediately rather than by rescanning: the
/// files are already known and re-walking the disk to reach a conclusion the
/// user just handed us would make a one-click correction cost a full scan.
/// The override row is what makes the next scan agree.
#[tauri::command]
pub fn set_library_match(
    app: AppHandle,
    title: String,
    season: i32,
    media_id: i64,
) -> Result<Vec<LibraryEntry>, String> {
    let db = app.state::<Db>();
    db.library_override_set(&title, season, media_id)?;

    let state = app.state::<LibraryIndex>();
    let mut guard = state.0.lock().unwrap();
    for f in &mut guard.files {
        if f.title == title && f.season == season {
            f.media_id = Some(media_id);
            f.score = 1.0;
            f.manual = true;
        }
    }
    guard.reindex();
    persist(&db, &guard)?;
    Ok(guard.summary.clone())
}

/// Drops a correction and gives the file back to the matcher's own answer.
///
/// The matcher is not re-run here — its candidates are the cached list and
/// re-preparing them for one title is work the next scan does anyway — so the
/// files land in "unplaced" until then. That is honest: without the override
/// there is no answer on record, and inventing the old guess back would be
/// claiming knowledge this function does not have.
#[tauri::command]
pub fn clear_library_match(
    app: AppHandle,
    title: String,
    season: i32,
) -> Result<Vec<LibraryEntry>, String> {
    let db = app.state::<Db>();
    db.library_override_clear(&title, season)?;

    let state = app.state::<LibraryIndex>();
    let mut guard = state.0.lock().unwrap();
    for f in &mut guard.files {
        if f.title == title && f.season == season && f.manual {
            f.media_id = None;
            f.score = 0.0;
            f.manual = false;
        }
    }
    guard.reindex();
    persist(&db, &guard)?;
    Ok(guard.summary.clone())
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

/// Opens one specific episode — the library page lets the user pick, which
/// `play_next` cannot express.
#[tauri::command]
pub fn play_episode(app: AppHandle, media_id: i64, episode: u32) -> Result<(), String> {
    let path = {
        let state = app.state::<LibraryIndex>();
        let guard = state.0.lock().unwrap();
        guard
            .by_media
            .get(&media_id)
            .and_then(|eps| eps.get(&episode))
            .cloned()
            .ok_or("That episode is not in your library")?
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
    use crate::playback::recognition::matcher::Candidate;

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

    fn paths(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| format!("D:\\Anime\\{n}")).collect()
    }

    /// Scans without any correction on record, then derives every view — the
    /// same two steps `scan_library` takes.
    fn indexed(files: &[String], candidates: &[Candidate]) -> LibraryData {
        indexed_with(files, candidates, &HashMap::new())
    }

    fn indexed_with(
        files: &[String],
        candidates: &[Candidate],
        overrides: &HashMap<(String, i32), i64>,
    ) -> LibraryData {
        let mut data =
            LibraryData { files: index_files(files, candidates, overrides), ..Default::default() };
        data.reindex();
        data
    }

    /// The memoized index must agree with calling `best_match` per file — the
    /// cache key is exactly that function's input, so results are identical.
    #[test]
    fn indexes_a_season_folder_by_episode() {
        let files = paths(&[
            "[SubsPlease] Sousou no Frieren - 13 (1080p) [ABCD1234].mkv",
            "[SubsPlease] Sousou no Frieren - 14 (1080p) [BCDE2345].mkv",
            "[SubsPlease] Sousou no Frieren - 15 (1080p) [CDEF3456].mkv",
        ]);
        let index = indexed(&files, &frieren()).by_media;

        let eps = index.get(&154587).expect("Frieren should be indexed");
        assert_eq!(eps.len(), 3);
        // Each episode maps to its own file, not to whichever was seen last.
        for ep in [13u32, 14, 15] {
            assert!(eps[&ep].contains(&format!("- {ep} ")), "ep {ep} -> {}", eps[&ep]);
        }
    }

    /// Repeated titles are what the cache exists for, and unmatched files are
    /// the expensive case it must also cover — neither may change the result.
    #[test]
    fn repeated_and_unmatched_titles_are_handled_once() {
        let mut files = paths(&["Totally Unrelated Show - 01.mkv", "Totally Unrelated Show - 02.mkv"]);
        files.extend(paths(&["[SubsPlease] Sousou no Frieren - 13 (1080p) [A].mkv"]));

        let data = indexed(&files, &frieren());
        // The unmatched series contributes nothing to the index…
        assert_eq!(data.by_media.len(), 1);
        // …and the matched one is unaffected by sharing the scan with it.
        assert_eq!(data.by_media[&154587].len(), 1);
        assert!(data.by_media[&154587].contains_key(&13));
        // It is not discarded either: it is exactly what "unplaced" is for,
        // and both its episodes belong to the one group.
        assert_eq!(data.unmatched.len(), 1);
        assert_eq!(data.unmatched[0].files.len(), 2);
    }

    /// A file with no parseable episode number is skipped, not mis-filed.
    #[test]
    fn files_without_an_episode_are_skipped() {
        let files = paths(&["Sousou no Frieren [Movie].mkv"]);
        let data = indexed(&files, &frieren());
        assert!(data.by_media.get(&154587).is_none_or(|eps| !eps.is_empty()));
        // Skipped means skipped: no episode number is not the same as an
        // unplaced episode, and it must not turn up in the list to be assigned.
        assert!(data.unmatched.is_empty());
    }

    /// The match confidence rides along with the index. It is the difference
    /// between "this is the show" and "this is my best guess", and the library
    /// screen says which — so the scanner has to hand it over rather than
    /// dropping it the moment it has an id.
    #[test]
    fn the_index_carries_its_match_confidence() {
        let files = paths(&["[SubsPlease] Sousou no Frieren - 13 (1080p) [A].mkv"]);
        let data = indexed(&files, &frieren());
        assert!(data.by_media.contains_key(&154587));
        let row = &data.summary[0];
        assert!(row.score > 0.0 && row.score <= 1.0, "score out of range: {}", row.score);
        // The matcher found this one, so the row must not claim the user did.
        assert!(!row.manual);
        assert!(!row.sources.is_empty(), "a row has to say what parse produced it");
    }

    /// The first path wins for a duplicate (media, episode) — a re-encode in a
    /// second folder must not silently replace the original.
    #[test]
    fn the_first_path_wins_for_a_duplicate_episode() {
        let files = vec![
            "D:\\A\\[SubsPlease] Sousou no Frieren - 13 (1080p) [A].mkv".to_string(),
            "D:\\B\\[SubsPlease] Sousou no Frieren - 13 (720p) [B].mkv".to_string(),
        ];
        let index = indexed(&files, &frieren()).by_media;
        assert_eq!(index[&154587][&13], files[0]);
    }

    /// The point of the whole design: a correction is consulted by the *next*
    /// scan, so re-scanning cannot quietly undo what the user told us.
    ///
    /// The show here is one the matcher has no candidate for, so without the
    /// override these files are unplaceable — which makes the assertion about
    /// the override rather than about the matcher getting lucky.
    #[test]
    fn a_correction_outlives_the_scan_that_disagreed() {
        let files = paths(&[
            "[Group] Totally Unrelated Show - 01.mkv",
            "[Group] Totally Unrelated Show - 02.mkv",
        ]);
        let plain = indexed(&files, &frieren());
        assert!(plain.by_media.is_empty());
        assert_eq!(plain.unmatched.len(), 1);

        // Whatever the parser made of that name is the key the user's answer
        // gets stored under — read it back rather than assuming its spelling.
        let key = (plain.unmatched[0].title.clone(), plain.unmatched[0].season);
        let corrected = indexed_with(&files, &frieren(), &HashMap::from([(key, 154587)]));

        assert_eq!(corrected.by_media[&154587].len(), 2);
        assert!(corrected.unmatched.is_empty());
        let row = &corrected.summary[0];
        assert!(row.manual, "a corrected row has to say the user placed it");
        assert_eq!(row.score, 1.0);
    }

    /// A correction moves only the files that parse to the corrected title.
    /// Re-pointing one show in a library must not drag an unrelated one along.
    #[test]
    fn a_correction_moves_only_its_own_files() {
        let mut files = paths(&["[Group] Totally Unrelated Show - 01.mkv"]);
        files.extend(paths(&["[SubsPlease] Sousou no Frieren - 13 (1080p) [A].mkv"]));

        let plain = indexed(&files, &frieren());
        let key = (plain.unmatched[0].title.clone(), plain.unmatched[0].season);
        let corrected = indexed_with(&files, &frieren(), &HashMap::from([(key, 999)]));

        assert_eq!(corrected.by_media[&999].len(), 1);
        assert_eq!(corrected.by_media[&154587].len(), 1);
        let frieren_row = corrected.summary.iter().find(|e| e.media_id == 154587).unwrap();
        assert!(!frieren_row.manual, "the untouched row must not become manual");
    }
}
