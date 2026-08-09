//! The background log: what Karasu was doing when something went wrong.
//!
//! Until this existed a shipped build had no diagnostics at all. `main.rs` sets
//! `windows_subsystem = "windows"`, so a release binary on Windows has no
//! console and every `eprintln!` is written to an invalid handle and dropped on
//! the floor; on Linux the AppImage is started from a desktop file, a tray click
//! or autostart, so its stderr reaches the session journal at best and nothing
//! at worst. A user could not tell us why the tray failed, why a notification
//! never appeared, or why scrobbling stopped — and neither could we.
//!
//! Two sinks, on purpose. A bounded **ring in memory** is what the in-app viewer
//! reads, so opening it never touches the disk. A **rotating file** beside the
//! database is what survives a crash and gets attached to an issue.
//!
//! Deliberately a file rather than a table in `karasu.db`, for three reasons
//! that each decide it on their own: the panic hook must never take the `Db`
//! mutex (a panic *inside* a `Db` lock would re-enter it and abort the process);
//! `Db` is a single mutex already shared with the five-second detection poll and
//! whole-transaction library scans, so a chatty logger would contend with the
//! app's hot path; and `enable_portable` copies the database with `VACUUM INTO`,
//! which would carry the log onto a USB stick with it.
//!
//! **Everything is scrubbed on write, not on read.** `anilist_connect` receives
//! the raw access token and `jellyfin_sign_in` receives a plaintext password —
//! both as ordinary command arguments — so a careless `format!` anywhere could
//! put a live credential in a file the user is about to paste into a public
//! issue. Scrubbing at the write boundary means the file on disk is safe, and
//! that `get_logs` can never become a way for the WebView to read a token back
//! out (CLAUDE.md: the token stays in the backend).

use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// How many entries the viewer can see. Bounded so a long uptime cannot grow
/// the process; the file is the durable half.
pub const RING_CAPACITY: usize = 1000;
/// Roll over at a megabyte, keeping one previous file — so the worst case on
/// disk is ~2 MB whatever happens.
const ROTATE_BYTES: u64 = 1024 * 1024;
const LOG_FILE: &str = "karasu.log";
const ROTATED_FILE: &str = "karasu.log.1";

// --- Redaction vocabulary ---------------------------------------------------
// A named placeholder rather than a blanket `***`: the log still records *that*
// a credential was about to be written and *which* one, which is itself a
// diagnostic (it says which code path is leaking) and makes the scrubber's own
// coverage auditable from a log file alone.
pub const ANILIST_LOGIN: &str = "<CREDENTIAL_anilist-login>";
pub const JELLYFIN_LOGIN: &str = "<CREDENTIAL_jellyfin-login>";
pub const JELLYFIN_PASSWORD: &str = "<CREDENTIAL_jellyfin-password>";
pub const PORTABLE_KEY: &str = "<CREDENTIAL_portable-key>";
/// Anything secret-shaped that matched no specific rule. This is what makes an
/// unforeseen leak fail *safe* rather than land in the file unnoticed.
pub const UNKNOWN_CREDENTIAL: &str = "<CREDENTIAL_unknown>";

/// Severity. Ordered `Error < Warn < Info < Debug`, so "is this at or above the
/// threshold" is a plain comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
    Info,
    Debug,
}

impl Level {
    pub fn label(self) -> &'static str {
        match self {
            Level::Error => "ERROR",
            Level::Warn => "WARN",
            Level::Info => "INFO",
            Level::Debug => "DEBUG",
        }
    }
}

/// One line. `target` is the subsystem ("tray", "scrobbler", "jellyfin"), so the
/// viewer can group without parsing the message.
#[derive(Debug, Clone, serde::Serialize)]
pub struct LogEntry {
    pub ms: i64,
    pub level: Level,
    pub target: String,
    pub message: String,
}

fn ring() -> &'static Mutex<VecDeque<LogEntry>> {
    static RING: OnceLock<Mutex<VecDeque<LogEntry>>> = OnceLock::new();
    RING.get_or_init(|| Mutex::new(VecDeque::with_capacity(RING_CAPACITY)))
}

fn sink() -> &'static Mutex<Option<PathBuf>> {
    static SINK: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    SINK.get_or_init(|| Mutex::new(None))
}

static DEBUG_ON: AtomicBool = AtomicBool::new(false);

/// Takes a lock without caring whether it is poisoned.
///
/// The whole point of this module is to still work when something has panicked,
/// and a poisoned mutex means exactly that. `unwrap()` here would turn "we
/// logged a panic" into "we panicked while logging a panic", which aborts.
/// Same reasoning as the Jellyfin session cache.
fn guard<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|t| t.as_millis() as i64)
        .unwrap_or(0)
}

// --- Timestamps -------------------------------------------------------------

/// `YYYY-MM-DDTHH:MM:SSZ` from epoch milliseconds.
///
/// Hand-rolled because the tree has no date crate and pulling one in for a log
/// header is not worth a dependency. The civil-date conversion is Howard
/// Hinnant's `civil_from_days`, which is exact for every day this will ever see
/// and, being pure arithmetic, is testable without a clock.
pub fn format_utc(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (h, min, s) = (rem / 3_600_000, (rem / 60_000) % 60, (rem / 1000) % 60);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{min:02}:{s:02}Z")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// --- Scrubbing --------------------------------------------------------------

/// The rules, most specific first. Each is `(pattern, replacement)` where the
/// replacement may use `$1` to keep the surrounding context — knowing that a
/// bearer header was present is useful; knowing its value is a liability.
fn rules() -> &'static [(regex::Regex, String)] {
    static RULES: OnceLock<Vec<(regex::Regex, String)>> = OnceLock::new();
    RULES.get_or_init(|| {
        let r = |p: &str| regex::Regex::new(p).expect("scrub pattern");
        vec![
            // `Authorization: Bearer <token>` — anilist/client.rs `bearer_auth`.
            (
                r(r"(?i)(bearer\s+)[A-Za-z0-9._\-~+/=]{8,}"),
                format!("${{1}}{ANILIST_LOGIN}"),
            ),
            // `access_token=…` from the OAuth redirect (anilist/login.rs).
            (
                r(r#"(?i)("?access_?token"?\s*[:=]\s*"?)[A-Za-z0-9._\-~+/=]{8,}"#),
                format!("${{1}}{ANILIST_LOGIN}"),
            ),
            // Jellyfin's plaintext sign-in body: `{"Username":…,"Pw":"…"}`.
            (
                r(r#"(?i)("Pw"\s*:\s*")[^"]*"#),
                format!("${{1}}{JELLYFIN_PASSWORD}"),
            ),
            // `MediaBrowser … Token="…"` — jellyfin.rs `auth_header`.
            (
                r(r#"(?i)(token\s*=\s*")[^"]{8,}"#),
                format!("${{1}}{JELLYFIN_LOGIN}"),
            ),
            // `X-Emby-Token: …` and the `"AccessToken":"…"` in the auth result.
            (
                r(r"(?i)(x-emby-token\s*[:=]\s*)[A-Za-z0-9._\-~+/=]{8,}"),
                format!("${{1}}{JELLYFIN_LOGIN}"),
            ),
            (
                r(r#"(?i)("AccessToken"\s*:\s*")[^"]+"#),
                format!("${{1}}{JELLYFIN_LOGIN}"),
            ),
            // The sealed portable token file. `KRSU1` is its magic (anilist/auth.rs).
            (
                r(r"KRSU1[A-Za-z0-9+/=]*"),
                PORTABLE_KEY.to_string(),
            ),
            // Catch-all. A long unbroken run of base64 alphabet with no
            // separators is not something this app legitimately writes: release
            // names carry dots, dashes, brackets or spaces, and paths carry
            // slashes. Deliberately excludes `.`, `-` and `_` so a filename
            // cannot trip it — the specific rules above already cover the token
            // shapes that contain those.
            (
                r(r"[A-Za-z0-9+/=]{40,}"),
                UNKNOWN_CREDENTIAL.to_string(),
            ),
        ]
    })
}

/// Replaces anything credential-shaped with its labelled placeholder.
///
/// Applied to every message on the way in, so neither the ring nor the file can
/// hold a secret regardless of what a call site passes.
pub fn scrub(input: &str) -> String {
    let mut out = input.to_string();
    for (pattern, replacement) in rules() {
        if pattern.is_match(&out) {
            out = pattern.replace_all(&out, replacement.as_str()).into_owned();
        }
    }
    out
}

// --- Writing ----------------------------------------------------------------

/// Points the file sink at `dir` and flushes whatever was logged before it was
/// known — early startup and any panic that beat `setup` still reach the file.
pub fn init(dir: PathBuf) {
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(LOG_FILE);
    let pending: Vec<LogEntry> = guard(ring()).iter().cloned().collect();
    {
        let mut slot = guard(sink());
        *slot = Some(path.clone());
    }
    write_lines(&path, &[format!("--- karasu started {} ---", format_utc(now_ms()))]);
    write_lines(
        &path,
        &pending.iter().map(render).collect::<Vec<_>>(),
    );
}

/// Where the log lives, once known.
pub fn log_path() -> Option<PathBuf> {
    guard(sink()).clone()
}

pub fn set_debug(on: bool) {
    DEBUG_ON.store(on, Ordering::Relaxed);
}

pub fn debug_enabled() -> bool {
    DEBUG_ON.load(Ordering::Relaxed)
}

fn render(entry: &LogEntry) -> String {
    format!(
        "{} {:<5} {}: {}",
        format_utc(entry.ms),
        entry.level.label(),
        entry.target,
        entry.message
    )
}

fn write_lines(path: &Path, lines: &[String]) {
    if lines.is_empty() {
        return;
    }
    // Rotate before appending rather than after, so the cap is a ceiling.
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > ROTATE_BYTES {
            let _ = std::fs::rename(path, path.with_file_name(ROTATED_FILE));
        }
    }
    // Every failure here is discarded on purpose: this *is* the error path, and
    // a logger that logs its own failures recurses.
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        for line in lines {
            let _ = writeln!(file, "{line}");
        }
    }
}

/// Records one entry. Scrubs, appends to the ring, and appends to the file when
/// there is one.
pub fn log(level: Level, target: &str, message: impl AsRef<str>) {
    if level == Level::Debug && !debug_enabled() {
        return;
    }
    let entry = LogEntry {
        ms: now_ms(),
        level,
        target: target.to_string(),
        message: scrub(message.as_ref()),
    };
    {
        let mut ring = guard(ring());
        if ring.len() == RING_CAPACITY {
            ring.pop_front();
        }
        ring.push_back(entry.clone());
    }
    let path = guard(sink()).clone();
    if let Some(path) = path {
        write_lines(&path, &[render(&entry)]);
    }
}

pub fn error(target: &str, message: impl AsRef<str>) {
    log(Level::Error, target, message);
}

pub fn warn(target: &str, message: impl AsRef<str>) {
    log(Level::Warn, target, message);
}

pub fn info(target: &str, message: impl AsRef<str>) {
    log(Level::Info, target, message);
}

pub fn debug(target: &str, message: impl AsRef<str>) {
    log(Level::Debug, target, message);
}

/// The newest `limit` entries, newest first — the order the viewer shows them,
/// matching `notif_all`.
pub fn entries(limit: usize) -> Vec<LogEntry> {
    let ring = guard(ring());
    ring.iter().rev().take(limit).cloned().collect()
}

/// Installs the panic hook. Call this **first** in `run()`.
///
/// Until this existed, a panic in one of the four background loops killed that
/// loop for the rest of the process and said nothing: the `JoinHandle`s are
/// dropped, so nobody observes the `JoinError`, and the default hook printed to
/// a stderr no packaged build has. "Scrobbling just stopped working" was the
/// only symptom, and it was unreportable.
///
/// Chains to the previous hook rather than replacing it, so a debug run still
/// prints to the terminal it does have.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown location".into());
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".into()
        };
        let thread = std::thread::current()
            .name()
            .unwrap_or("unnamed")
            .to_string();
        error("panic", format!("[{thread}] {payload} ({location})"));
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_order_from_most_to_least_severe() {
        assert!(Level::Error < Level::Warn);
        assert!(Level::Warn < Level::Info);
        assert!(Level::Info < Level::Debug);
    }

    #[test]
    fn timestamps_are_civil_utc() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00Z");
        // A leap day, to exercise the era arithmetic rather than a happy path.
        assert_eq!(format_utc(1_709_164_800_000), "2024-02-29T00:00:00Z");
        // 1_786_000_000_000 ms is 20671 whole days plus 25_600 s = 07:06:40.
        assert_eq!(format_utc(1_786_000_000_000), "2026-08-06T07:06:40Z");
    }

    // --- Scrubbing. The fixtures are the literal shapes the code really
    // produces, so a change to one of those call sites breaks a test here
    // rather than silently starting to leak.

    #[test]
    fn an_anilist_bearer_header_is_labelled() {
        let out = scrub("GET https://graphql.anilist.co Authorization: Bearer eyJhbGciOiJSUzI1NiJ9abcdef");
        assert!(out.contains(ANILIST_LOGIN), "{out}");
        assert!(!out.contains("eyJhbGciOiJSUzI1NiJ9abcdef"), "{out}");
        // The context survives — that a bearer header was sent is the useful half.
        assert!(out.contains("Bearer"), "{out}");
    }

    #[test]
    fn an_oauth_redirect_token_is_labelled() {
        let out = scrub("callback /token?access_token=abcdef0123456789ABCDEF&token_type=Bearer");
        assert!(out.contains(ANILIST_LOGIN), "{out}");
        assert!(!out.contains("abcdef0123456789ABCDEF"), "{out}");
    }

    #[test]
    fn the_jellyfin_password_is_labelled() {
        let out = scrub(r#"POST /Users/AuthenticateByName {"Username":"kyu","Pw":"hunter2"}"#);
        assert!(out.contains(JELLYFIN_PASSWORD), "{out}");
        assert!(!out.contains("hunter2"), "{out}");
        // The username is not a credential and stays — it is diagnostic.
        assert!(out.contains("kyu"), "{out}");
    }

    #[test]
    fn the_jellyfin_auth_header_and_result_are_labelled() {
        let header = scrub(r#"MediaBrowser Client="Karasu", Token="0123456789abcdef0123""#);
        assert!(header.contains(JELLYFIN_LOGIN), "{header}");
        assert!(!header.contains("0123456789abcdef0123"), "{header}");

        let result = scrub(r#"{"AccessToken":"deadbeefdeadbeefdead","User":{"Name":"kyu"}}"#);
        assert!(result.contains(JELLYFIN_LOGIN), "{result}");
        assert!(!result.contains("deadbeefdeadbeefdead"), "{result}");
    }

    #[test]
    fn a_sealed_portable_token_is_labelled() {
        let out = scrub("read token.dat: KRSU1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert!(out.contains(PORTABLE_KEY), "{out}");
        assert!(!out.contains("KRSU1AAAA"), "{out}");
    }

    /// The rule that catches what the others did not think of.
    #[test]
    fn an_unrecognised_secret_shape_still_gets_redacted() {
        let secret = "A".repeat(64);
        let out = scrub(&format!("something unexpected {secret}"));
        assert!(out.contains(UNKNOWN_CREDENTIAL), "{out}");
        assert!(!out.contains(&secret), "{out}");
    }

    /// The catch-all must not eat ordinary diagnostics. Release names and paths
    /// are the two things this log exists to carry.
    #[test]
    fn ordinary_release_names_and_paths_survive() {
        for sample in [
            r"C:\Users\Kyu\Videos\[SubsPlease] Frieren - 05 (1080p) [A1B2C3D4].mkv",
            "/home/kyu/Anime/Frieren.Beyond.Journeys.End.S01E05.1080p.WEB-DL.mkv",
            "org.mpris.MediaPlayer2.mpv.instance1234",
            "no tray icon (the desktop has no AppIndicator library)",
        ] {
            assert_eq!(scrub(sample), sample, "scrub altered an ordinary message");
        }
    }

    #[test]
    fn debug_entries_are_dropped_unless_enabled() {
        set_debug(false);
        assert!(!debug_enabled());
        // `log` returns early; the observable effect is that nothing is added.
        let before = entries(RING_CAPACITY).len();
        debug("test", "should not appear");
        assert_eq!(entries(RING_CAPACITY).len(), before);

        set_debug(true);
        debug("test", "should appear");
        assert!(entries(RING_CAPACITY).len() > before);
        set_debug(false);
    }

    #[test]
    fn the_ring_is_bounded_and_newest_first() {
        for i in 0..(RING_CAPACITY + 50) {
            info("ringtest", format!("entry {i}"));
        }
        let all = entries(RING_CAPACITY * 2);
        assert!(all.len() <= RING_CAPACITY, "ring grew past its cap");
        // Newest first.
        let newest = &all[0];
        assert!(
            newest.message.contains(&format!("entry {}", RING_CAPACITY + 49)),
            "{}",
            newest.message
        );
    }

    /// The end-to-end guarantee, checked against the artefact that actually
    /// leaves the machine. Every unit test above proves `scrub` transforms a
    /// string; this one proves nothing secret reaches the file a user attaches
    /// to a public issue, which is the property that actually matters.
    #[test]
    fn no_secret_survives_to_the_file_on_disk() {
        let dir = std::env::temp_dir().join(format!("karasu-scrub-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        init(dir.clone());

        let secrets = [
            "eyJhbGciOiJSUzI1NiJ9abcdefghijklmnop",
            "hunter2SuperSecretPassword",
            "0123456789abcdef0123456789abcdef",
            "deadbeefdeadbeefdeadbeefdeadbeef",
        ];
        error("test", format!("Authorization: Bearer {}", secrets[0]));
        error("test", format!(r#"{{"Username":"kyu","Pw":"{}"}}"#, secrets[1]));
        error("test", format!(r#"Token="{}""#, secrets[2]));
        error("test", format!(r#"{{"AccessToken":"{}"}}"#, secrets[3]));

        let written = std::fs::read_to_string(dir.join(LOG_FILE)).unwrap();
        for secret in secrets {
            assert!(
                !written.contains(secret),
                "a credential reached the log file: {secret}\n--- file ---\n{written}"
            );
        }
        // And the labels are there, so the line is still diagnostic.
        assert!(written.contains(ANILIST_LOGIN), "{written}");
        assert!(written.contains(JELLYFIN_PASSWORD), "{written}");
        assert!(written.contains(JELLYFIN_LOGIN), "{written}");

        // Put the sink back so a stray path does not outlive the test.
        *guard(sink()) = None;
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotation_caps_what_is_on_disk() {
        let dir = std::env::temp_dir().join(format!("karasu-log-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(LOG_FILE);

        // One oversized file, then a write: the old one must be moved aside.
        std::fs::write(&path, vec![b'x'; (ROTATE_BYTES + 1) as usize]).unwrap();
        write_lines(&path, &["after rotation".to_string()]);

        assert!(dir.join(ROTATED_FILE).exists(), "no rotated file");
        let fresh = std::fs::read_to_string(&path).unwrap();
        assert!(fresh.len() < 100, "the live file was not started fresh");
        assert!(fresh.contains("after rotation"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
