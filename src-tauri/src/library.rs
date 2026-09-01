//! Local library: scan a folder for video files, match them to the user's
//! AniList entries with the existing parser/matcher, and let the user play
//! the next unwatched episode straight from Karasu — Taiga's killer feature
//! and a reason to use the app over the website.

use crate::db::Db;
use crate::sync::LockExt;
use crate::identify;
use crate::playback::recognition::{matcher, parser};
use crate::playback::relations;
use crate::playback::scrobbler::candidates_from_cache;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
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

/// A user-confirmed season split, in the shape `index_files` applies it:
/// "episodes `ep_from..=ep_to` of this parse are `media_id`, renumbered from
/// `dst_start`". The persisted form is `library_redirect` (schema v11), and the
/// record shape deliberately mirrors `relations::Rule`.
#[derive(Clone, Debug)]
pub struct SplitRule {
    pub title: String,
    pub season: i32,
    pub ep_from: u32,
    pub ep_to: u32,
    pub media_id: i64,
    pub dst_start: u32,
}

impl SplitRule {
    /// The renumbered episode, when this rule covers the parsed one.
    fn apply(&self, title: &str, season: i32, episode: u32) -> Option<u32> {
        (self.title == title
            && self.season == season
            && episode >= self.ep_from
            && episode <= self.ep_to)
            .then(|| episode - self.ep_from + self.dst_start)
    }
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
    /// AniList's guesses, keyed the same way everything else here is. Held
    /// separately from the groups because `reindex` rebuilds those from
    /// scratch on every correction and would otherwise drop the lot.
    suggestions: HashMap<(String, i32), Suggested>,
    /// AniList's episode count per matched id, lifted from the same candidates
    /// the matcher used — the number a folder can overflow. Only ids whose
    /// count is known appear; an airing show with `episodes: null` cannot
    /// honestly overflow anything.
    episode_counts: HashMap<i64, u32>,
    /// A snapshot of the community anime-relations rules, taken where the app
    /// state is available (scan, hydrate) so `reindex` can hint without it.
    /// Empty on a cold start before the file downloads — an overflow then
    /// simply carries no hint.
    rules: Vec<relations::Rule>,
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
                    // Per source, not only per row. One title can be the merge
                    // of several parses — a specials folder assigned onto the
                    // main show, say — and only one of them carries the
                    // override. A row-level flag says "something here was
                    // corrected" but not *which*, which is the one thing
                    // "remove correction" needs to know.
                    let seen = sources.entry(id).or_default();
                    match seen
                        .iter_mut()
                        .find(|k| k.title == f.title && k.season == f.season)
                    {
                        Some(k) => k.manual |= f.manual,
                        None => seen.push(TitleKey {
                            title: f.title.clone(),
                            season: f.season,
                            manual: f.manual,
                        }),
                    }
                }
                None => groups
                    .entry((f.title.clone(), f.season))
                    .or_default()
                    .push(LibraryFile { episode: f.episode, path: f.path.clone() }),
            }
        }

        self.summary =
            build_summary(&by_media, &scores, &manual, &sources, &self.episode_counts, &self.rules);
        self.by_media = by_media;
        self.unmatched = groups
            .into_iter()
            .map(|((title, season), mut files)| {
                files.sort_unstable_by_key(|f| f.episode);
                let suggestion = self.suggestions.get(&(title.clone(), season)).cloned();
                UnmatchedGroup { title, season, files, suggestion }
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
    /// Whether *this* parse is the one carrying a correction.
    ///
    /// `#[serde(default)]` only keeps the pre-existing `Deserialize` derive
    /// total; nothing actually deserializes a `TitleKey`. The index on disk is
    /// SQLite rows with no `sources` array, and `hydrate` rebuilds the whole
    /// thing through `reindex`, so this flag is always computed by the running
    /// binary.
    #[serde(default)]
    pub manual: bool,
}

/// Files that parsed to a title the matcher could not place.
#[derive(Clone, serde::Serialize)]
pub struct UnmatchedGroup {
    pub title: String,
    pub season: i32,
    pub files: Vec<LibraryFile>,
    /// What AniList thinks this is, if it was asked and answered convincingly.
    /// Unconfirmed: the screen shows it greyed and the user decides. A search
    /// hit is a weaker claim than a match against a list the user curated.
    pub suggestion: Option<Suggested>,
}

#[derive(Clone, serde::Serialize)]
pub struct Suggested {
    #[serde(rename = "mediaId")]
    pub media_id: i64,
    pub score: f64,
}

/// The index, and whether a scan is currently rebuilding it.
///
/// The flag is not a lock on the data — it is a lock on the *conclusion*. A
/// scan reads the corrections once at the start and ends by replacing the whole
/// index and both of its tables, so a correction saved in between is written,
/// then silently overwritten minutes later. Refusing it is the honest answer;
/// the screen already shows a rejected command's reason.
pub struct LibraryIndex(pub Mutex<LibraryData>, pub AtomicBool);

impl Default for LibraryIndex {
    fn default() -> Self {
        LibraryIndex(Mutex::new(LibraryData::default()), AtomicBool::new(false))
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
    /// More files than the matched entry has episodes — a 24-file folder on a
    /// 12-episode show, almost always a next season under one folder name.
    /// Detection only; nothing is re-pointed until the user confirms a split.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overflow: Option<Overflow>,
}

/// The facts the season-split card needs, computed at reindex time.
#[derive(Clone, serde::Serialize)]
pub struct Overflow {
    /// AniList's episode count for the matched entry.
    #[serde(rename = "knownEpisodes")]
    pub known_episodes: u32,
    /// How many on-disk episodes lie beyond it.
    #[serde(rename = "extraFiles")]
    pub extra_files: u32,
    /// The first overflowing episode number, as the files spell it.
    #[serde(rename = "firstExtra")]
    pub first_extra: u32,
    /// What the community anime-relations rules say the overflow is, when they
    /// say anything. A *suggestion* for the card to pre-select — never applied
    /// on its own; the user always confirms (maintainer's decision).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<SplitHint>,
}

#[derive(Clone, serde::Serialize)]
pub struct SplitHint {
    #[serde(rename = "mediaId")]
    pub media_id: i64,
    #[serde(rename = "dstStart")]
    pub dst_start: u32,
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
        matched: state.0.guard().summary.len(),
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
    pick_folder(&app)
}

#[cfg(desktop)]
fn pick_folder(app: &AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

/// The scanner is desktop-only — scoped storage does not hand out folder
/// walks — so on mobile there is nothing a picked folder could feed. The
/// command answers "no choice made" rather than erroring, which is also what
/// dismissing the picker answers.
#[cfg(mobile)]
fn pick_folder(_app: &AppHandle) -> Option<String> {
    None
}

/// The most recent scan's index (empty before the first scan).
///
/// Everything: absolute paths, per-title match scores, the release names each
/// match came from. Only the Library screen needs any of that, and it is
/// lazily routed — see `get_library_episodes` for what everyone else reads.
#[tauri::command]
pub fn get_library_index(state: State<'_, LibraryIndex>) -> Vec<LibraryEntry> {
    state.0.guard().summary.clone()
}

/// Just which episodes exist per media id.
///
/// This is the whole of what the app asks the library outside its own screen:
/// a "next episode" affordance on a list row and on the detail page. Serving
/// the full index for that meant cloning every absolute file path under the
/// index mutex and shipping them all through the IPC bridge on **every
/// launch** — hundreds of kilobytes of JSON, for a map of numbers, whether or
/// not the Library screen was ever opened.
#[tauri::command]
pub fn get_library_episodes(
    state: State<'_, LibraryIndex>,
) -> std::collections::HashMap<i64, Vec<u32>> {
    state
        .0
        .guard()
        .summary
        .iter()
        .map(|e| (e.media_id, e.episodes.clone()))
        .collect()
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
pub async fn scan_library(app: AppHandle) -> Result<ScanSummary, String> {
    let index = app.state::<LibraryIndex>();
    // A scan ends by replacing the whole index and both of its tables, so
    // anything that writes one meanwhile is thrown away when it lands. Claim
    // the flag before the first early return, and drop-guard it so every exit —
    // including the two `?`s below and a panic — clears it.
    if index
        .1
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A scan is already running".into());
    }
    let _scanning = ScanGuard(&index.1);

    let (root, candidates, overrides, redirects, stored, cursor) = {
        let db = app.state::<Db>();
        let root = db
            .kv_get("library_path")
            .filter(|p| !p.is_empty())
            .ok_or("No library folder set")?;
        let candidates = candidates_from_cache(&db, "ANIME");
        if candidates.is_empty() {
            // `candidates_from_cache` reads the cached *AniList* list, so in
            // the account-free profile this is not "load your list first" — it
            // is always empty and always will be. Saying so beats sending
            // someone to look for a button that would not help.
            return Err(if db.kv_get("anilist_viewer").is_some() {
                "Load your anime list first, then scan"
            } else {
                "Scanning matches files against your AniList list, so it needs \
                 an AniList account. The local profile has no list to match against."
            }
            .into());
        }
        // What AniList has already been asked. Re-asking costs a request per 25
        // titles and returns the same answer, so a rescan of a folder that
        // never changed would spend the whole identification budget learning
        // nothing.
        let stored: HashMap<(String, i32), (i64, f64)> = db
            .library_suggestions()
            .into_iter()
            .map(|(t, s, id, score)| ((t, s), (id, score)))
            .collect();
        let cursor = db
            .kv_get("identify_cursor")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        (root, candidates, override_map(&db), redirect_rules(&db), stored, cursor)
    };

    // Everything below ends in `library_publish`, which DELETEs each of its
    // three tables before inserting what this scan found.
    // So an unreachable folder — an offline NAS, an unplugged drive, a renamed
    // directory — must not reach that point: it yields zero files, and zero
    // files used to be written down as the truth and then survive a restart
    // through `hydrate`, while the command returned Ok and the pane rendered
    // the result in success styling.
    let previously_indexed = {
        let db = app.state::<Db>();
        db.library_all().len()
    };
    if let Err(e) = std::fs::read_dir(Path::new(&root)) {
        return Err(format!(
            "Cannot read the library folder ({e}). Nothing was changed — check \
             that the drive or network share is connected, then scan again."
        ));
    }

    let mut files = Vec::new();
    let unreadable = collect_videos(Path::new(&root), 0, &mut files);
    let total = files.len();
    // A mount point that is still mounted but no longer carries its contents
    // reads as an empty directory rather than an error, which is exactly what a
    // disconnected NAS looks like. Finding nothing where there was something is
    // therefore treated as a failure to look, not as an emptied library. A
    // genuinely emptied folder reports the same thing once and is resolved by
    // pointing the setting somewhere else.
    if total == 0 && (unreadable > 0 || previously_indexed > 0) {
        return Err(format!(
            "Found no video files in the library folder, but {previously_indexed} \
             were indexed before. The index was kept — check that the drive or \
             network share is connected, then scan again."
        ));
    }

    let mut data = LibraryData {
        files: index_files(&files, &candidates, &overrides, &redirects),
        episode_counts: episode_counts(&candidates),
        // Snapshotted before the identify await below — the guard on a
        // `std::sync::RwLock` must not live across one, same as the index lock.
        rules: app.state::<relations::Relations>().0.read().unwrap().clone(),
        ..Default::default()
    };
    data.reindex();

    // Whatever the list could not place, AniList is asked about directly.
    // (See below for why this sits between indexing and publishing.) This
    // is the only way an off-list show is ever identified: the matcher above
    // searches the cached list and nothing else, so a title that was never
    // added cannot be found there however clean its filename is.
    //
    // Deliberately between indexing and publishing, and deliberately holding no
    // lock: `LibraryIndex` is a `std::sync::Mutex` and its guard must not be
    // alive across an `.await`.
    let mut unknown: Vec<identify::Unidentified> = data
        .unmatched
        .iter()
        .filter(|g| !stored.contains_key(&(g.title.clone(), g.season)))
        .map(|g| identify::Unidentified { title: g.title.clone(), season: g.season })
        .collect();
    // Rotate before the cap, so successive scans work through the whole
    // unplaced set instead of re-asking the same head of it. `reindex` sorts
    // the groups most-files-first and a title that gets no answer is stored
    // nowhere, so without this a folder of 200 unanswerable extras would sit at
    // the front of the queue forever and everything behind it would never be
    // asked once. A fresh library still starts at 0, so the biggest folders are
    // still asked about first.
    let pending = unknown.len();
    let asked = if pending == 0 {
        0
    } else {
        unknown.rotate_left(cursor % pending);
        identify::MAX_TITLES.min(pending)
    };
    let fresh = if unknown.is_empty() {
        Vec::new()
    } else {
        let api = app.state::<crate::anilist::client::AniList>();
        let token = crate::anilist::auth::load_token();
        identify::identify(&api, token.as_deref(), &unknown).await
    };

    // The union, not just what this scan learned: `library_replace_suggestions`
    // empties the table first, so writing only `fresh` would delete every
    // answer the filter above just decided not to re-ask for. Carried-forward
    // rows are kept only while their group is still unplaced — a title the
    // scan has since matched, or whose files are gone, drops out here.
    let suggestions: Vec<(String, i32, i64, f64)> = fresh
        .iter()
        .map(|s| (s.title.clone(), s.season, s.media_id, s.score))
        .chain(data.unmatched.iter().filter_map(|g| {
            stored
                .get(&(g.title.clone(), g.season))
                .map(|&(id, score)| (g.title.clone(), g.season, id, score))
        }))
        .collect();

    {
        let db = app.state::<Db>();
        // Persist so the index survives a restart — without this every relaunch
        // drops the library and the play buttons disappear until a manual rescan.
        persist(&db, &data)?;
        db.library_replace_suggestions(&suggestions)?;
        // Where the next scan picks up. Modulo the set it was taken against, so
        // a shrinking unplaced set cannot park the cursor past the end.
        let next = if pending == 0 { 0 } else { (cursor + asked) % pending };
        db.kv_set("identify_cursor", &next.to_string())?;
        // The count of files *walked* is not derivable from the index — most of
        // them matched nothing — so it is stored rather than recomputed.
        db.kv_set("library_files_seen", &total.to_string())?;
    }

    data.suggestions = suggestions
        .iter()
        .map(|(title, season, media_id, score)| {
            (
                (title.clone(), *season),
                Suggested { media_id: *media_id, score: *score },
            )
        })
        .collect();
    // Cheap second pass: only the unplaced groups change, and it keeps the
    // suggestion in one place rather than patched onto the groups afterwards.
    data.reindex();

    let summary = data.summary.clone();
    let matched = summary.len();
    *index.0.guard() = data;

    Ok(ScanSummary { entries: summary, files: total, matched })
}

/// Clears the scanning flag however `scan_library` leaves.
///
/// A plain `store(false)` before each `return` would be four call sites and one
/// of them would eventually be forgotten — which is how the two early errors,
/// the ones that fire before a single file is walked, would have left the app
/// refusing corrections until it was restarted.
struct ScanGuard<'a>(&'a AtomicBool);

impl Drop for ScanGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// The user's corrections, in the shape `index_files` looks them up by.
fn override_map(db: &Db) -> HashMap<(String, i32), i64> {
    db.library_overrides()
        .into_iter()
        .map(|(title, season, media_id)| ((title, season), media_id))
        .collect()
}

/// The user's season splits, in the shape `index_files` applies them.
fn redirect_rules(db: &Db) -> Vec<SplitRule> {
    db.library_redirects()
        .into_iter()
        .map(|(title, season, ep_from, ep_to, media_id, dst_start)| SplitRule {
            title,
            season,
            ep_from,
            ep_to,
            media_id,
            dst_start,
        })
        .collect()
}

/// One confirmed season split, in display order for the Settings list.
///
/// Keyed on the *parse* — the title and season as the release names on disk
/// spell them — because that is the key `clear_library_redirect` deletes by.
/// The destination `media_id` is what the UI joins a display title onto.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRedirectRow {
    pub title: String,
    pub season: i32,
    pub ep_from: u32,
    pub ep_to: u32,
    pub media_id: i64,
    pub dst_start: u32,
}

/// The confirmed splits, for the Settings list — until this existed the rows
/// were written and applied but never shown, so the only undo was
/// `clear_library_match` taking the whole key with it.
#[tauri::command]
pub fn list_library_redirects(app: AppHandle) -> Vec<LibraryRedirectRow> {
    let db = app.state::<Db>();
    db.library_redirects()
        .into_iter()
        .map(
            |(title, season, ep_from, ep_to, media_id, dst_start)| LibraryRedirectRow {
                title,
                season,
                ep_from,
                ep_to,
                media_id,
                dst_start,
            },
        )
        .collect()
}

/// AniList's episode count per candidate id, where it states one.
fn episode_counts(candidates: &[matcher::Candidate]) -> HashMap<i64, u32> {
    candidates
        .iter()
        .filter_map(|c| c.episodes.map(|e| (c.media_id, e)))
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
    // One transaction for both tables: they are one answer. Written as two,
    // a failure in between left an index describing this scan beside an
    // unmatched list describing the previous one.
    db.library_publish(&rows, &score_rows, &data.unmatched_rows())
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
///
/// A season split is consulted before *both*: it names an episode range of the
/// same parse, which is strictly more specific than the whole-key override —
/// files 13–24 go where the split says while 1–12 still follow the override or
/// the matcher. A split file's episode is stored **renumbered** (disk 13 →
/// sequel's 1), which is what `play_next`'s progress comparison needs.
fn index_files(
    files: &[String],
    candidates: &[matcher::Candidate],
    overrides: &HashMap<(String, i32), i64>,
    redirects: &[SplitRule],
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

        if let Some((rule, renumbered)) = redirects
            .iter()
            .find_map(|r| r.apply(&parsed.title, season, episode).map(|e| (r, e)))
        {
            scanned.push(ScannedFile {
                title: parsed.title,
                season,
                episode: renumbered,
                path: path.clone(),
                media_id: Some(rule.media_id),
                score: 1.0,
                manual: true,
            });
            continue;
        }

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
    episode_counts: &HashMap<i64, u32>,
    rules: &[relations::Rule],
) -> Vec<LibraryEntry> {
    let mut summary: Vec<LibraryEntry> = by_media
        .iter()
        .map(|(id, eps)| {
            let mut files: Vec<LibraryFile> = eps
                .iter()
                .map(|(episode, path)| LibraryFile { episode: *episode, path: path.clone() })
                .collect();
            files.sort_unstable_by_key(|f| f.episode);
            let episodes: Vec<u32> = files.iter().map(|f| f.episode).collect();
            let overflow = detect_overflow(*id, &episodes, episode_counts, rules);
            LibraryEntry {
                media_id: *id,
                episodes,
                files,
                score: scores.get(id).copied().unwrap_or(0.0),
                sources: sources.get(id).cloned().unwrap_or_default(),
                manual: manual.get(id).copied().unwrap_or(false),
                overflow,
            }
        })
        .collect();
    summary.sort_by_key(|e| e.media_id);
    summary
}

/// Whether a folder holds more than the matched entry can — and, when the
/// community rules already know where the rest goes, where that is.
///
/// Only fires when AniList states an episode count: an airing show with an
/// unknown total cannot honestly overflow anything. Files already re-pointed by
/// a confirmed split have left this entry, so the check settles itself once the
/// user answers.
fn detect_overflow(
    media_id: i64,
    episodes: &[u32],
    episode_counts: &HashMap<i64, u32>,
    rules: &[relations::Rule],
) -> Option<Overflow> {
    let known = *episode_counts.get(&media_id)?;
    let extra: Vec<u32> = episodes.iter().copied().filter(|&e| e > known).collect();
    let first_extra = *extra.first()?;
    let hint = relations::redirect(rules, media_id, first_extra)
        .map(|(dst_id, dst_ep)| SplitHint { media_id: dst_id, dst_start: dst_ep });
    Some(Overflow {
        known_episodes: known,
        extra_files: extra.len() as u32,
        first_extra,
        hint,
    })
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
    let redirects = redirect_rules(&db);

    let mut files: Vec<ScannedFile> = rows
        .into_iter()
        .map(|(media_id, episode, path)| {
            let (title, season, disk_episode) = reparse(&path);
            // A split row's stored episode is the *renumbered* one, which the
            // filename cannot confirm — so the split is re-derived from its
            // rule and the filename's own number, the two sources that cannot
            // drift. A rule cleared since last run simply stops matching here
            // and the row falls back to what is stored.
            if let Some((rule, renumbered)) = disk_episode.and_then(|ep| {
                redirects
                    .iter()
                    .find_map(|r| r.apply(&title, season, ep).map(|e| (r, e)))
            }) {
                return ScannedFile {
                    title,
                    season,
                    episode: renumbered,
                    path,
                    media_id: Some(rule.media_id),
                    score: 1.0,
                    manual: true,
                };
            }
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

    let mut data = LibraryData {
        files,
        // Restored rather than re-fetched: identification costs AniList
        // requests and a restart is not new information.
        suggestions: db
            .library_suggestions()
            .into_iter()
            .map(|(title, season, media_id, score)| {
                ((title, season), Suggested { media_id, score })
            })
            .collect(),
        // The counts come from the same cached list a scan reads, so the
        // overflow chips survive a restart without one.
        episode_counts: episode_counts(&candidates_from_cache(&db, "ANIME")),
        rules: app
            .state::<relations::Relations>()
            .0
            .read()
            .map(|r| r.clone())
            .unwrap_or_default(),
        ..Default::default()
    };
    data.reindex();
    let state = app.state::<LibraryIndex>();
    *state.0.guard() = data;
}

/// Recovers the `(title, season, episode)` a path parses to.
fn reparse(path: &str) -> (String, i32, Option<u32>) {
    let name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let parsed = parser::parse(&name);
    (parsed.title, season_key(parsed.season), parsed.episode)
}

/// Files the last scan could not place, grouped by what it read them as.
#[tauri::command]
pub fn get_library_unmatched(state: State<'_, LibraryIndex>) -> Vec<UnmatchedGroup> {
    state.0.guard().unmatched.clone()
}

/// Points every file that parses to `title`/`season` at `media_id`.
///
/// Applied to the in-memory index immediately rather than by rescanning: the
/// files are already known and re-walking the disk to reach a conclusion the
/// user just handed us would make a one-click correction cost a full scan.
/// The override row is what makes the next scan agree.
#[tauri::command(async)]
pub fn set_library_match(
    app: AppHandle,
    title: String,
    season: i32,
    media_id: i64,
) -> Result<Vec<LibraryEntry>, String> {
    let state = app.state::<LibraryIndex>();
    if state.1.load(Ordering::Acquire) {
        return Err("A scan is running — try again when it finishes".into());
    }

    let db = app.state::<Db>();
    db.library_override_set(&title, season, media_id)?;

    let mut guard = state.0.guard();
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

/// Everything a confirmed split changes, computed before anything is written.
///
/// Split from the command so it is testable without Tauri state — the three
/// bugs this shape replaced (a chained split shifting the wrong files, an
/// upsert on `(title, season, ep_from)` silently swallowing an earlier rule,
/// and a zero-match confirm returning `Ok` with nothing to show) were all
/// invisible precisely because the old command mixed the decision with the
/// writes.
#[derive(Debug)]
pub struct RedirectPlan {
    /// Primary keys of existing rules to delete — every rule the new range
    /// touches, including ones that come back trimmed.
    pub delete: Vec<(String, i32, u32)>,
    /// Rules to insert: one per parse group in the range, plus the trimmed
    /// remnants of any overlapped rule.
    pub insert: Vec<SplitRule>,
    /// `(index into files, renumbered episode)` for every affected file.
    pub files: Vec<(usize, u32)>,
}

/// Plans a split of the *current-frame* episodes `from..=to` of `media_id` —
/// exactly the numbers the row and the chip display — onto `dst_media_id`,
/// renumbered from `dst_start`.
///
/// The persisted rules stay keyed on `(title, season, disk range)`, because
/// that is the frame a scan parses; the translation happens here, per file,
/// by re-reading each filename's own number. Keying the *command* on what the
/// user can see is the fix for the chained-split bug: after one split the
/// row's numbers are renumbered, and a second command still keyed on disk
/// numbers targeted files the user was not looking at.
pub fn plan_redirect(
    files: &[ScannedFile],
    existing: &[SplitRule],
    media_id: i64,
    from: u32,
    to: u32,
    dst_media_id: i64,
    dst_start: u32,
) -> Result<RedirectPlan, String> {
    // The affected files, grouped by the parse key their rule will carry.
    // `title`/`season` are already the parse key on every ScannedFile; only
    // the disk number needs the filename re-read, since `episode` may be the
    // renumbered value of an earlier split.
    let mut groups: HashMap<(String, i32), Vec<(usize, u32, u32)>> = HashMap::new();
    for (i, f) in files.iter().enumerate() {
        if f.media_id != Some(media_id) || f.episode < from || f.episode > to {
            continue;
        }
        let (_, _, disk) = reparse(&f.path);
        let Some(d) = disk else {
            return Err(format!(
                "\"{}\" has no episode number in its filename, so it cannot be split by range",
                f.path
            ));
        };
        groups.entry((f.title.clone(), f.season)).or_default().push((i, d, f.episode));
    }
    // The silent no-op this replaces: confirming against a range that matches
    // nothing must say so, not close the dialog with an unchanged screen.
    if groups.is_empty() {
        return Err(format!("No files land in episodes {from}–{to} of that title — nothing to split"));
    }

    let mut plan = RedirectPlan { delete: Vec::new(), insert: Vec::new(), files: Vec::new() };
    for ((title, season), members) in groups {
        // Within one parse, disk and current numbering may only differ by a
        // constant shift (an earlier split's renumbering). A mixed offset
        // means the range spans files this plan cannot describe with one
        // rule — refuse rather than guess.
        let offset = members[0].1 as i64 - members[0].2 as i64;
        if members.iter().any(|(_, d, e)| *d as i64 - *e as i64 != offset) {
            return Err(
                "The episode numbering inside that range is not contiguous — correct the files individually"
                    .into(),
            );
        }
        let d_min = members.iter().map(|(_, d, _)| *d).min().unwrap();
        let d_max = members.iter().map(|(_, d, _)| *d).max().unwrap();
        // A rule covers a disk range wholesale, so a same-parse file inside
        // it that the user did *not* select would be silently dragged along
        // on the next scan.
        let selected: std::collections::HashSet<usize> =
            members.iter().map(|(i, _, _)| *i).collect();
        for (i, f) in files.iter().enumerate() {
            if selected.contains(&i) || f.title != title || f.season != season {
                continue;
            }
            let (_, _, disk) = reparse(&f.path);
            if disk.is_some_and(|d| d >= d_min && d <= d_max) {
                return Err(
                    "That range overlaps files from another source — correct the files individually"
                        .into(),
                );
            }
        }

        // A chained split supersedes exactly the disk range it covers: every
        // overlapped rule is deleted, and whatever part of it lies outside
        // the new range comes back trimmed, its own mapping intact.
        for r in existing.iter().filter(|r| {
            r.title == title && r.season == season && r.ep_from <= d_max && r.ep_to >= d_min
        }) {
            plan.delete.push((r.title.clone(), r.season, r.ep_from));
            if r.ep_from < d_min {
                plan.insert.push(SplitRule { ep_to: d_min - 1, ..r.clone() });
            }
            if r.ep_to > d_max {
                plan.insert.push(SplitRule {
                    ep_from: d_max + 1,
                    dst_start: r.dst_start + (d_max + 1 - r.ep_from),
                    ..r.clone()
                });
            }
        }

        let e_of_min = members.iter().find(|(_, d, _)| *d == d_min).unwrap().2;
        plan.insert.push(SplitRule {
            title,
            season,
            ep_from: d_min,
            ep_to: d_max,
            media_id: dst_media_id,
            dst_start: dst_start + (e_of_min - from),
        });
        plan.files
            .extend(members.iter().map(|(i, _, e)| (*i, dst_start + (e - from))));
    }
    Ok(plan)
}

/// Confirms a season split: current-frame episodes `from..=to` of `media_id`
/// belong to `dst_media_id`, renumbered from `dst_start`.
///
/// Like `set_library_match`, the answer is applied to the in-memory index
/// immediately; the v11 rows `plan_redirect` produces are what make the next
/// scan and the next restart agree.
#[tauri::command(async)]
pub fn set_library_redirect(
    app: AppHandle,
    media_id: i64,
    from: u32,
    to: u32,
    dst_media_id: i64,
    dst_start: u32,
) -> Result<Vec<LibraryEntry>, String> {
    if to < from {
        return Err("The episode range is reversed".into());
    }
    let state = app.state::<LibraryIndex>();
    if state.1.load(Ordering::Acquire) {
        return Err("A scan is running — try again when it finishes".into());
    }

    let db = app.state::<Db>();
    let existing = redirect_rules(&db);
    let mut guard = state.0.guard();
    let plan = plan_redirect(&guard.files, &existing, media_id, from, to, dst_media_id, dst_start)?;

    for (title, season, ep_from) in &plan.delete {
        db.library_redirect_clear(title, *season, *ep_from)?;
    }
    for r in &plan.insert {
        db.library_redirect_set(&r.title, r.season, r.ep_from, r.ep_to, r.media_id, r.dst_start)?;
    }
    for (i, episode) in &plan.files {
        let f = &mut guard.files[*i];
        f.media_id = Some(dst_media_id);
        f.episode = *episode;
        f.score = 1.0;
        f.manual = true;
    }
    guard.reindex();
    persist(&db, &guard)?;
    Ok(guard.summary.clone())
}

/// Removes a season split, giving the range back to whatever the rest of the
/// parse still answers to — the sibling files outside every remaining split
/// know their media id, and a freed episode 13 belongs with them rather than
/// in "unplaced". When no sibling knows (the whole key was split), the range
/// honestly lands unplaced until the next scan, like `clear_library_match`.
#[tauri::command(async)]
pub fn clear_library_redirect(
    app: AppHandle,
    title: String,
    season: i32,
    ep_from: u32,
) -> Result<Vec<LibraryEntry>, String> {
    let state = app.state::<LibraryIndex>();
    if state.1.load(Ordering::Acquire) {
        return Err("A scan is running — try again when it finishes".into());
    }

    let db = app.state::<Db>();
    // The rule itself is needed to know which files it governed, so it is read
    // before it is deleted.
    let rule = redirect_rules(&db)
        .into_iter()
        .find(|r| r.title == title && r.season == season && r.ep_from == ep_from)
        .ok_or("There is no season split on that range to remove")?;
    db.library_redirect_clear(&title, season, ep_from)?;
    let remaining = redirect_rules(&db);

    let mut guard = state.0.guard();
    // The answer the freed files fall back to: any sibling of the same parse
    // that no remaining split claims.
    let fallback = guard.files.iter().find_map(|f| {
        if f.title != title || f.season != season || f.media_id.is_none() {
            return None;
        }
        let (_, _, disk) = reparse(&f.path);
        let still_split = disk
            .is_some_and(|ep| remaining.iter().any(|r| r.apply(&title, season, ep).is_some()));
        (!still_split).then(|| (f.media_id, f.score, f.manual))
    });

    for f in &mut guard.files {
        if f.title != title || f.season != season {
            continue;
        }
        let (_, _, disk) = reparse(&f.path);
        let Some(ep) = disk else { continue };
        let was_governed = rule.apply(&title, season, ep).is_some();
        let still_split = remaining.iter().any(|r| r.apply(&title, season, ep).is_some());
        if !was_governed || still_split {
            continue;
        }
        let (media_id, score, manual) = fallback.unwrap_or((None, 0.0, false));
        f.episode = ep;
        f.media_id = media_id;
        f.score = if media_id.is_some() { score } else { 0.0 };
        f.manual = manual && media_id.is_some();
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
#[tauri::command(async)]
pub fn clear_library_match(
    app: AppHandle,
    title: String,
    season: i32,
) -> Result<Vec<LibraryEntry>, String> {
    let state = app.state::<LibraryIndex>();
    if state.1.load(Ordering::Acquire) {
        return Err("A scan is running — try again when it finishes".into());
    }

    let db = app.state::<Db>();
    let dropped = db.library_override_clear(&title, season)?;
    // A season split is a correction on the same parse, so the same gesture
    // removes it too. Resetting its files while leaving the v11 rows would
    // quietly bring them back on the next restart or scan.
    let rules: Vec<SplitRule> = redirect_rules(&db)
        .into_iter()
        .filter(|r| r.title == title && r.season == season)
        .collect();
    for r in &rules {
        db.library_redirect_clear(&title, season, r.ep_from)?;
    }

    let mut guard = state.0.guard();
    let mut reset = 0usize;
    for f in &mut guard.files {
        if f.title == title && f.season == season && f.manual {
            // A split file's stored episode is the renumbered one; the
            // filename still says the disk number, which is what an unplaced
            // row is keyed by.
            if let (_, _, Some(ep)) = reparse(&f.path) {
                f.episode = ep;
            }
            f.media_id = None;
            f.score = 0.0;
            f.manual = false;
            reset += 1;
        }
    }
    // Deleting no rows and resetting no files is not a correction removed, and
    // reporting Ok for it closes the dialog and refetches as though something
    // happened. The reachable case is a row whose sources were picked in walk
    // order, so the button was offered against a parse that was never corrected.
    if dropped == 0 && rules.is_empty() && reset == 0 {
        return Err("There is no correction on that title to remove".into());
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
        let guard = state.0.guard();
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
        let guard = state.0.guard();
        guard
            .by_media
            .get(&media_id)
            .and_then(|eps| eps.get(&episode))
            .cloned()
            .ok_or("That episode is not in your library")?
    };

    open_path(&app, &path)
}

/// Opens `path`, reporting a stale index clearly — the index is persisted
/// now, so a file can legitimately have moved since the last scan.
///
/// Two doors, and the default-player contract stays the default: only a
/// configured mpv binary takes the first one, launched with
/// `--input-ipc-server=<pipe>` so the IPC source sees the playback Karasu
/// itself started — knowing the pipe name up front beats discovering a
/// running instance. A failed launch (moved binary, typo) logs and falls
/// through to the opener, so the play button never goes dead over a setting.
fn open_path(app: &AppHandle, path: &str) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("That file is no longer on disk — rescan your library".into());
    }
    if let Some((player, pipe)) = crate::commands::mpv_launch_config(&app.state::<Db>()) {
        match std::process::Command::new(&player)
            .arg(format!("--input-ipc-server={pipe}"))
            // `--` first: a file whose name begins with a dash is a filename,
            // not an option, and mpv cannot tell without being told.
            .arg("--")
            .arg(path)
            .spawn()
        {
            // The child is deliberately not held: Karasu does not manage the
            // player's lifetime. `wait` in a detached thread only so a Linux
            // exit is reaped instead of lingering as a zombie until Karasu
            // quits — on Windows the handle simply closes.
            Ok(mut child) => {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(());
            }
            Err(e) => crate::logging::warn(
                "library",
                format!(
                    "could not launch {player:?}: {e}; falling back to the default player"
                ),
            ),
        }
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Could not open the file: {e}"))
}

/// Recursively collects video files up to the depth/size caps.
///
/// Returns how many directories could not be read. A scan ends by replacing
/// all three library tables, so "found nothing" and "could not look" must not
/// arrive here as the same answer: an unreadable directory used to `return`
/// silently at every level, root included, and the empty result was then
/// persisted as the truth.
#[must_use]
fn collect_videos(dir: &Path, depth: usize, out: &mut Vec<String>) -> usize {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return 0;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            crate::logging::warn(
                "library",
                format!("cannot read {}: {e}", dir.display()),
            );
            return 1;
        }
    };
    let mut unreadable = 0;
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return unreadable;
        }
        let path = entry.path();
        if path.is_dir() {
            unreadable += collect_videos(&path, depth + 1, out);
        } else if is_video(&path) {
            out.push(path.to_string_lossy().to_string());
        }
    }
    unreadable
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
            cover_url: None,
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

    // Forward slashes on purpose: Windows' `Path` accepts both separators,
    // Linux only `/` — a backslash fixture parses its whole self as the
    // filename there, and these tests also run in the linux-build CI job.
    fn paths(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| format!("/anime/{n}")).collect()
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
        indexed_full(files, candidates, overrides, &[], &[])
    }

    /// The full pipeline as `scan_library` runs it: splits and overrides at
    /// index time, episode counts and relations rules at reindex time.
    fn indexed_full(
        files: &[String],
        candidates: &[Candidate],
        overrides: &HashMap<(String, i32), i64>,
        redirects: &[SplitRule],
        rules: &[relations::Rule],
    ) -> LibraryData {
        let mut data = LibraryData {
            files: index_files(files, candidates, overrides, redirects),
            episode_counts: episode_counts(candidates),
            rules: rules.to_vec(),
            ..Default::default()
        };
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

    fn bocchi(episodes: Option<u32>) -> Vec<Candidate> {
        vec![Candidate {
            media_id: 1,
            titles: vec!["Bocchi the Rock".into()],
            episodes,
            duration_min: Some(24),
            cover_url: None,
            progress: 0,
            status: "CURRENT".into(),
        }]
    }

    fn bocchi_files(eps: &[u32]) -> Vec<String> {
        eps.iter()
            .map(|e| format!("/anime/Bocchi the Rock - {e:02}.mkv"))
            .collect()
    }

    /// 24 files on a 12-episode show is flagged, with the facts the split card
    /// needs — and nothing is re-pointed, because detection is not a decision.
    #[test]
    fn a_folder_larger_than_the_show_is_flagged_not_repointed() {
        let data = indexed_full(
            &bocchi_files(&[11, 12, 13, 14]),
            &bocchi(Some(12)),
            &HashMap::new(),
            &[],
            &[],
        );
        let entry = data.summary.iter().find(|e| e.media_id == 1).expect("matched");
        // Everything is still on the one id…
        assert_eq!(entry.episodes, vec![11, 12, 13, 14]);
        // …but the row says the folder holds more than the show.
        let overflow = entry.overflow.as_ref().expect("overflow flagged");
        assert_eq!(overflow.known_episodes, 12);
        assert_eq!(overflow.extra_files, 2);
        assert_eq!(overflow.first_extra, 13);
        assert!(overflow.hint.is_none());
    }

    /// When the community anime-relations rules know the overflow, the flag
    /// carries their answer as a pre-selection — still never applied alone.
    #[test]
    fn the_community_rules_supply_the_hint_only() {
        let rules = vec![relations::Rule {
            src_id: 1,
            src_start: 13,
            src_end: Some(24),
            dst_id: 2,
            dst_start: 1,
        }];
        let data = indexed_full(
            &bocchi_files(&[12, 13]),
            &bocchi(Some(12)),
            &HashMap::new(),
            &[],
            &rules,
        );
        let entry = data.summary.iter().find(|e| e.media_id == 1).expect("matched");
        let hint = entry.overflow.as_ref().and_then(|o| o.hint.as_ref()).expect("hint");
        assert_eq!(hint.media_id, 2);
        assert_eq!(hint.dst_start, 1);
        // The rule is a hint, not a redirect: file 13 is still on media 1.
        assert!(data.by_media[&1].contains_key(&13));
        assert!(!data.by_media.contains_key(&2));
    }

    /// A show whose total is unknown (airing) cannot honestly overflow.
    #[test]
    fn an_unknown_episode_total_never_flags() {
        let data = indexed_full(
            &bocchi_files(&[1, 2, 50]),
            &bocchi(None),
            &HashMap::new(),
            &[],
            &[],
        );
        let entry = data.summary.iter().find(|e| e.media_id == 1).expect("matched");
        assert!(entry.overflow.is_none());
    }

    /// A confirmed split re-points its range, renumbered to the sequel's own
    /// count — disk 13 becomes the sequel's episode 1 — and the flag settles.
    #[test]
    fn a_confirmed_split_repoints_and_renumbers() {
        let parsed = parser::parse("Bocchi the Rock - 13.mkv");
        let split = SplitRule {
            title: parsed.title.clone(),
            season: season_key(parsed.season),
            ep_from: 13,
            ep_to: 24,
            media_id: 2,
            dst_start: 1,
        };
        let data = indexed_full(
            &bocchi_files(&[11, 12, 13, 14]),
            &bocchi(Some(12)),
            &HashMap::new(),
            &[split],
            &[],
        );
        // The first cour stays put and no longer overflows…
        let first = data.summary.iter().find(|e| e.media_id == 1).expect("season 1");
        assert_eq!(first.episodes, vec![11, 12]);
        assert!(first.overflow.is_none());
        // …and the range lands on the sequel, renumbered and marked as the
        // user's own placement.
        let second = data.summary.iter().find(|e| e.media_id == 2).expect("season 2");
        assert_eq!(second.episodes, vec![1, 2]);
        assert!(second.manual);
        assert!(data.by_media[&2][&1].contains("- 13"));
    }

    /// A split names an episode range, which is strictly more specific than a
    /// whole-key override — inside the range the split wins, outside it the
    /// override still does.
    #[test]
    fn a_split_beats_a_whole_key_override_inside_its_range() {
        let parsed = parser::parse("Bocchi the Rock - 13.mkv");
        let key = (parsed.title.clone(), season_key(parsed.season));
        let overrides: HashMap<(String, i32), i64> = [(key.clone(), 7)].into();
        let split = SplitRule {
            title: key.0.clone(),
            season: key.1,
            ep_from: 13,
            ep_to: 24,
            media_id: 2,
            dst_start: 1,
        };
        let data = indexed_full(
            &bocchi_files(&[12, 13]),
            &bocchi(Some(12)),
            &overrides,
            &[split],
            &[],
        );
        assert!(data.by_media[&7].contains_key(&12), "override keeps its side");
        assert!(data.by_media[&2].contains_key(&1), "split takes its range");
    }

    /// Two successive splits on one folder: the second is keyed on the
    /// numbers the row *shows* (current frame), and both rules end up in
    /// disk numbering. The old command's `(title, season, ep_from)` upsert
    /// silently overwrote the first rule here.
    #[test]
    fn a_second_split_keys_on_what_the_row_shows() {
        let eps: Vec<u32> = (1..=36).collect();
        let first = {
            let parsed = parser::parse("Bocchi the Rock - 13.mkv");
            SplitRule {
                title: parsed.title.clone(),
                season: season_key(parsed.season),
                ep_from: 13,
                ep_to: 24,
                media_id: 2,
                dst_start: 1,
            }
        };
        let data = indexed_full(
            &bocchi_files(&eps),
            &bocchi(Some(12)),
            &HashMap::new(),
            &[first.clone()],
            &[],
        );
        // After the first split, media 1 shows 1–12 and 25–36 — so the next
        // overflow the user confirms reads "25–36", in current-frame numbers
        // that happen to equal disk numbers here.
        let plan = plan_redirect(&data.files, &[first.clone()], 1, 25, 36, 3, 1)
            .expect("second split plans");
        assert!(plan.delete.is_empty(), "the first rule is untouched");
        assert_eq!(plan.insert.len(), 1);
        let rule = &plan.insert[0];
        assert_eq!((rule.ep_from, rule.ep_to, rule.media_id, rule.dst_start), (25, 36, 3, 1));
        // Disk 25 becomes the third season's episode 1.
        let renumbered: Vec<u32> = plan.files.iter().map(|(_, e)| *e).collect();
        assert_eq!(renumbered.iter().min(), Some(&1));
        assert_eq!(renumbered.iter().max(), Some(&12));
    }

    /// Splitting the *destination* of an earlier split — the row whose
    /// current numbers no longer match its filenames. The old command
    /// re-parsed disk numbers and shifted the wrong twelve files; the plan
    /// resolves per file and trims the overlapped rule to what it still
    /// covers.
    #[test]
    fn splitting_a_renumbered_row_targets_the_right_files_and_trims() {
        let eps: Vec<u32> = (1..=36).collect();
        let parsed = parser::parse("Bocchi the Rock - 13.mkv");
        let whole = SplitRule {
            title: parsed.title.clone(),
            season: season_key(parsed.season),
            ep_from: 13,
            ep_to: 36,
            media_id: 2,
            dst_start: 1,
        };
        let data = indexed_full(
            &bocchi_files(&eps),
            &bocchi(Some(12)),
            &HashMap::new(),
            &[whole.clone()],
            &[],
        );
        // Media 2 now shows 1–24; its own overflow past 12 reads "13–24" in
        // current-frame numbers, which live at disk 25–36.
        let plan = plan_redirect(&data.files, &[whole.clone()], 2, 13, 24, 3, 1)
            .expect("split of a renumbered row plans");
        assert_eq!(plan.delete, vec![(whole.title.clone(), whole.season, 13)]);
        // The overlapped rule comes back trimmed to the half it still covers,
        // plus the new rule for the moved half — both in disk numbers.
        let mut ranges: Vec<(u32, u32, i64, u32)> = plan
            .insert
            .iter()
            .map(|r| (r.ep_from, r.ep_to, r.media_id, r.dst_start))
            .collect();
        ranges.sort_unstable();
        assert_eq!(ranges, vec![(13, 24, 2, 1), (25, 36, 3, 1)]);
        // And the files that move are the disk-25–36 twelve, not disk 13–24.
        let mut moved: Vec<u32> = plan
            .files
            .iter()
            .map(|(i, _)| reparse(&data.files[*i].path).2.unwrap())
            .collect();
        moved.sort_unstable();
        assert_eq!(moved, (25..=36).collect::<Vec<u32>>());
    }

    /// Confirming a range that matches nothing is an error the dialog shows,
    /// never an `Ok` that closes it over an unchanged screen — the exact
    /// silence the user reported after their third split.
    #[test]
    fn a_split_matching_no_files_is_an_error() {
        let data = indexed_full(
            &bocchi_files(&[11, 12, 13]),
            &bocchi(Some(12)),
            &HashMap::new(),
            &[],
            &[],
        );
        let err = plan_redirect(&data.files, &[], 999, 13, 24, 3, 1).unwrap_err();
        assert!(err.contains("nothing to split"), "unexpected error: {err}");
        let err = plan_redirect(&data.files, &[], 1, 40, 50, 3, 1).unwrap_err();
        assert!(err.contains("nothing to split"), "unexpected error: {err}");
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
            "/a/[SubsPlease] Sousou no Frieren - 13 (1080p) [A].mkv".to_string(),
            "/b/[SubsPlease] Sousou no Frieren - 13 (720p) [B].mkv".to_string(),
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

    /// A row can merge two parses, and only one of them may be the corrected
    /// one. The row-level `manual` flag is the OR of them, so it cannot answer
    /// "which parse do I remove the correction from?" — the sources have to.
    ///
    /// Without the per-source flag the screen offers "remove correction" keyed
    /// on whichever parse walk order happened to put first, and picking the
    /// auto-matched one deletes nothing while reporting success.
    #[test]
    fn each_source_says_whether_it_is_the_corrected_one() {
        let files = paths(&[
            "[SubsPlease] Sousou no Frieren - 13 (1080p) [A].mkv",
            "[Group] Totally Unrelated Show - 01.mkv",
        ]);
        let plain = indexed(&files, &frieren());
        // Point the unplaceable parse at the same show the other one matched.
        let key = (plain.unmatched[0].title.clone(), plain.unmatched[0].season);
        let merged = indexed_with(&files, &frieren(), &HashMap::from([(key, 154587)]));

        let row = merged.summary.iter().find(|e| e.media_id == 154587).unwrap();
        assert_eq!(row.sources.len(), 2, "two parses, one title");
        assert!(row.manual, "the row is corrected, because one of its parses is");
        assert_eq!(
            row.sources.iter().filter(|s| s.manual).count(),
            1,
            "exactly the corrected parse carries the flag, not both",
        );
    }

    /// "Found nothing" and "could not look" used to be the same answer.
    ///
    /// `collect_videos` swallowed a `read_dir` failure at every level including
    /// the root, so an offline NAS or an unplugged drive produced an empty
    /// result — which the scan then persisted through three `DELETE`-everything
    /// writes and reported as a success. The count it returns is what
    /// `scan_library` now refuses on.
    #[test]
    fn an_unreadable_directory_is_counted_rather_than_swallowed() {
        let missing = std::env::temp_dir().join("karasu-no-such-library-dir");
        let _ = std::fs::remove_dir_all(&missing);

        let mut out = Vec::new();
        assert_eq!(collect_videos(&missing, 0, &mut out), 1, "the root counts");
        assert!(out.is_empty());

        // A real folder that is genuinely empty is a different answer, and has
        // to stay one — it is the only way to empty a library on purpose.
        let empty = std::env::temp_dir().join(format!("karasu-empty-{}", std::process::id()));
        std::fs::create_dir_all(&empty).unwrap();
        let mut out = Vec::new();
        assert_eq!(collect_videos(&empty, 0, &mut out), 0);
        assert!(out.is_empty());

        // And one with a video in it finds the video and reports no failures.
        std::fs::write(empty.join("Show - 01.mkv"), b"").unwrap();
        let mut out = Vec::new();
        assert_eq!(collect_videos(&empty, 0, &mut out), 0);
        assert_eq!(out.len(), 1);

        let _ = std::fs::remove_dir_all(&empty);
    }
}

#[cfg(test)]
mod hydrate_cost {
    /// How long the re-parse in `hydrate` actually takes, since the audit
    /// filed it as a startup cost without ever putting a number on it.
    ///
    /// Ignored by default — it is a measurement, not an assertion. Run with
    /// `cargo test --lib hydrate_cost -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn measure_the_reparse() {
        let names: Vec<String> = (1..=20_000)
            .map(|i| {
                format!(
                    "[SubsPlease] Some Long Show Title S{}  - {:02} (1080p) [A1B2C3D4].mkv",
                    (i % 4) + 1,
                    i % 24 + 1
                )
            })
            .collect();
        for n in [1_000usize, 5_000, 20_000] {
            let start = std::time::Instant::now();
            let mut sink = 0usize;
            for name in &names[..n] {
                sink += super::reparse(name).0.len();
            }
            println!("reparse {n} files: {:?} (sink {sink})", start.elapsed());
        }
    }
}
