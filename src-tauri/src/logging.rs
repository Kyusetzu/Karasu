//! The background log: a bounded ring for the viewer and a rotating file beside the database, scrubbed on write.

use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// How many entries the viewer can see; bounded so a long uptime cannot grow the process.
pub const RING_CAPACITY: usize = 1000;
/// Roll over past this size, keeping one previous file, so the worst case on disk is bounded.
const ROTATE_BYTES: u64 = 1024 * 1024;
const LOG_FILE: &str = "karasu.log";
const ROTATED_FILE: &str = "karasu.log.1";

// Named placeholders rather than a blanket `***`: the log still records which credential was about to be written.
pub const ANILIST_LOGIN: &str = "<CREDENTIAL_anilist-login>";
pub const JELLYFIN_LOGIN: &str = "<CREDENTIAL_jellyfin-login>";
pub const JELLYFIN_PASSWORD: &str = "<CREDENTIAL_jellyfin-password>";
pub const PORTABLE_KEY: &str = "<CREDENTIAL_portable-key>";
pub const MOBILE_SEALED: &str = "<CREDENTIAL_mobile-sealed-token>";
/// Anything secret-shaped that matched no specific rule, so an unforeseen leak fails safe.
pub const UNKNOWN_CREDENTIAL: &str = "<CREDENTIAL_unknown>";

/// Severity, ordered `Error < Warn < Info < Debug`, so a threshold check is a plain comparison.
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

/// One line; `target` is the subsystem, so the viewer can group without parsing the message.
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

/// Takes a lock whether or not it is poisoned; panicking while logging a panic would abort the process.
fn guard<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    crate::sync::LockExt::guard(m)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|t| t.as_millis() as i64)
        .unwrap_or(0)
}

/// `YYYY-MM-DDTHH:MM:SSZ` from epoch milliseconds, hand-rolled because a log header is not worth a date crate.
pub fn format_utc(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (h, min, s) = (rem / 3_600_000, (rem / 60_000) % 60, (rem / 1000) % 60);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{min:02}:{s:02}Z")
}

/// The civil UTC date for an epoch-seconds instant; the backup file namer is the other caller.
pub(crate) fn civil_date(epoch_secs: i64) -> (i64, u32, u32) {
    civil_from_days(epoch_secs.div_euclid(86_400))
}

/// Howard Hinnant's `civil_from_days`, exact for every day this will ever see and pure arithmetic.
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

/// The scrub rules, most specific first; a replacement may use `$1` to keep the context around the credential.
fn rules() -> &'static [(regex::Regex, String)] {
    static RULES: OnceLock<Vec<(regex::Regex, String)>> = OnceLock::new();
    RULES.get_or_init(|| {
        let r = |p: &str| regex::Regex::new(p).expect("scrub pattern");
        vec![
            // `Authorization: Bearer <token>`, from `bearer_auth` in anilist/client.rs.
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
            // `MediaBrowser … Token="…"`, from `auth_header` in jellyfin.rs.
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
            // The Keystore-sealed mobile token file. `KRSA1` is its magic (keystore.rs).
            (
                r(r"KRSA1[A-Za-z0-9+/=]*"),
                MOBILE_SEALED.to_string(),
            ),
            // Catch-all: a long unbroken base64 run; `.`, `-` and `_` are excluded so a filename cannot trip it.
            (
                r(r"[A-Za-z0-9+/=]{40,}"),
                UNKNOWN_CREDENTIAL.to_string(),
            ),
        ]
    })
}

/// Replaces anything credential-shaped with its labelled placeholder, on every message on the way in.
pub fn scrub(input: &str) -> String {
    let mut out = input.to_string();
    for (pattern, replacement) in rules() {
        if pattern.is_match(&out) {
            out = pattern.replace_all(&out, replacement.as_str()).into_owned();
        }
    }
    out
}

/// Points the file sink at `dir` and flushes whatever was logged before it was known.
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
    // Every failure here is discarded on purpose: a logger that logs its own failures recurses.
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

/// Records one entry: scrubs, appends to the ring, and appends to the file when there is one.
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

fn last_seen() -> &'static Mutex<std::collections::HashMap<&'static str, String>> {
    static LAST: OnceLock<Mutex<std::collections::HashMap<&'static str, String>>> =
        OnceLock::new();
    LAST.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

/// debug_changed, never debug, on the 5 s poll: a line per tick rotates the interesting part off disk.
pub fn debug_changed(target: &str, key: &'static str, message: impl AsRef<str>) {
    // Before the map and before the message is borrowed: with the toggle off this must be as close to free as it gets.
    if !debug_enabled() {
        return;
    }
    let message = message.as_ref();
    if !differs_from_last(key, message) {
        return;
    }
    log(Level::Debug, target, message);
}

/// Whether `message` differs from the last one under `key`; keyed on the fact, so the map stays bounded.
fn differs_from_last(key: &'static str, message: &str) -> bool {
    let mut seen = guard(last_seen());
    if seen.get(key).is_some_and(|previous| previous == message) {
        return false;
    }
    seen.insert(key, message.to_string());
    true
}

/// The newest `limit` entries, newest first, the order the viewer shows them.
pub fn entries(limit: usize) -> Vec<LogEntry> {
    let ring = guard(ring());
    ring.iter().rev().take(limit).cloned().collect()
}

/// How many restarts a background loop gets; bounded, since a poisoned mutex does not heal.
const MAX_RESTARTS: u32 = 5;
const FIRST_BACKOFF_SECS: u64 = 5;

/// How long to wait before restart number `restarts`, or `None` to give up; pure, so the schedule is testable.
fn restart_plan(restarts: u32) -> Option<u64> {
    (restarts <= MAX_RESTARTS).then(|| FIRST_BACKOFF_SECS << (restarts - 1))
}

/// Runs a background loop and puts it back if it panics; restarting is not a fix, the log line is the point.
pub fn supervise<F, Fut>(name: &'static str, make: F)
where
    F: Fn() -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut restarts = 0u32;
        loop {
            match tauri::async_runtime::spawn(make()).await {
                // These loops never return, so this is only reachable if one is ever rewritten to finish.
                Ok(()) => {
                    info(name, "background loop ended");
                    return;
                }
                Err(e) => {
                    restarts += 1;
                    let Some(wait) = restart_plan(restarts) else {
                        error(
                            name,
                            format!(
                                "background loop panicked again ({e}) — giving up after \
                                 {MAX_RESTARTS} restarts. Restart Karasu to bring it back."
                            ),
                        );
                        return;
                    };
                    error(
                        name,
                        format!(
                            "background loop panicked ({e}) — restart {restarts}/{MAX_RESTARTS} \
                             in {wait}s"
                        ),
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                }
            }
        }
    });
}

/// Installs the panic hook, first thing in `run()`; it chains to the previous hook so a debug run still prints.
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

    /// The ring, the sink and the debug flag are process-global, so every test that touches them takes this lock.
    static GLOBAL_LOG_STATE: Mutex<()> = Mutex::new(());

    /// An assertion failure in one locked test must not poison the rest.
    fn serialize() -> std::sync::MutexGuard<'static, ()> {
        GLOBAL_LOG_STATE.lock().unwrap_or_else(|e| e.into_inner())
    }

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
        // Whole days plus a remainder, so the time-of-day arithmetic is exercised too.
        assert_eq!(format_utc(1_786_000_000_000), "2026-08-06T07:06:40Z");
    }

    // The scrub fixtures are the literal shapes the code produces, so a changed call site breaks a test here.

    #[test]
    fn an_anilist_bearer_header_is_labelled() {
        let out = scrub("GET https://graphql.anilist.co Authorization: Bearer eyJhbGciOiJSUzI1NiJ9abcdef");
        assert!(out.contains(ANILIST_LOGIN), "{out}");
        assert!(!out.contains("eyJhbGciOiJSUzI1NiJ9abcdef"), "{out}");
        // The context survives: that a bearer header was sent is the useful half.
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
        // The username is not a credential and stays; it is diagnostic.
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
        let out = scrub("read anilist_token.dat: KRSA1AAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert!(out.contains(MOBILE_SEALED), "{out}");
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

    /// The catch-all must not eat release names and paths, the two things this log exists to carry.
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
        let _serial = serialize();
        set_debug(false);
        assert!(!debug_enabled());
        // Presence of the message, not ring length: a full ring evicts on push, so the length holds.
        debug("test", "a debug line that must be dropped");
        assert!(
            !entries(RING_CAPACITY)
                .iter()
                .any(|e| e.message.contains("a debug line that must be dropped")),
            "a disabled debug line reached the ring"
        );

        set_debug(true);
        debug("test", "a debug line that must be kept");
        assert!(entries(RING_CAPACITY)
            .iter()
            .any(|e| e.message.contains("a debug line that must be kept")));
        set_debug(false);
    }

    /// The dedupe that keeps the poll loop from rotating the interesting lines off disk.
    #[test]
    fn a_repeated_line_is_recorded_once() {
        // A key unique to this test, since the map is process-global.
        const KEY: &str = "dedupe-repeat";

        assert!(differs_from_last(KEY, "the same thing"), "first is new");
        for _ in 0..50 {
            assert!(
                !differs_from_last(KEY, "the same thing"),
                "a repeat was treated as a change"
            );
        }
    }

    /// "Differs from last", not "never seen": a flapping value has to stay visible.
    #[test]
    fn a_value_returning_to_a_previous_one_is_still_a_change() {
        const KEY: &str = "dedupe-flap";
        assert!(differs_from_last(KEY, "a"));
        assert!(differs_from_last(KEY, "b"));
        assert!(differs_from_last(KEY, "a"));
        assert!(!differs_from_last(KEY, "a"));
    }

    /// Keyed on the fact, not the message, so a changing value replaces its predecessor.
    #[test]
    fn each_key_holds_one_entry_however_many_values_it_sees() {
        const KEY: &str = "dedupe-bound";
        for i in 0..200 {
            differs_from_last(KEY, &format!("value {i}"));
        }
        let seen = guard(last_seen());
        assert_eq!(seen.keys().filter(|k| **k == KEY).count(), 1);
    }

    /// Costs nothing with the toggle off, not even the map lookup.
    #[test]
    fn debug_changed_records_nothing_while_disabled() {
        const KEY: &str = "dedupe-off";
        let _serial = serialize();
        set_debug(false);
        debug_changed("dedupetest", KEY, "anything");
        // The map was never touched, so the value is still "new".
        assert!(differs_from_last(KEY, "anything"));
    }

    #[test]
    fn the_ring_is_bounded_and_newest_first() {
        // The lock is also what makes "newest first" checkable: a concurrent writer's entry would land on top of ours.
        let _serial = serialize();
        for i in 0..(RING_CAPACITY + 50) {
            info("ringtest", format!("entry {i}"));
        }
        let all = entries(RING_CAPACITY * 2);
        assert!(all.len() <= RING_CAPACITY, "ring grew past its cap");
        // Newest of our entries: the panic hook writes to the ring from any thread, so `all[0]` need not be ours.
        let newest = all
            .iter()
            .find(|e| e.target == "ringtest")
            .expect("no entry with the ringtest target");
        assert!(
            newest.message.contains(&format!("entry {}", RING_CAPACITY + 49)),
            "{}",
            newest.message
        );
    }

    /// Nothing secret reaches the file a user attaches to a public issue.
    #[test]
    fn no_secret_survives_to_the_file_on_disk() {
        // Locked for the sink: `init` points the process-global sink at this directory, and a concurrent writer would land in it.
        let _serial = serialize();
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

    /// The hook captures a panic, rather than trusting that `set_hook` was called.
    #[test]
    fn the_panic_hook_records_the_panic() {
        const PANIC_MARKER: &str = "a deliberate test panic";
        // Locked so the ring-flood test cannot evict this entry between the panic and the read.
        let _serial = serialize();
        install_panic_hook();

        // Caught so the test itself survives; the hook still runs first.
        let _ = std::panic::catch_unwind(|| panic!("{PANIC_MARKER}"));

        let recorded = entries(RING_CAPACITY);
        // Matched on our own message, not the target alone: another module's test panics deliberately too.
        let entry = recorded
            .iter()
            .find(|e| e.target == "panic" && e.message.contains(PANIC_MARKER))
            .expect("the hook recorded no entry for our panic");
        assert_eq!(entry.level, Level::Error);
        // The location is what makes it actionable, since `strip = true` leaves backtraces near-symbol-free.
        assert!(entry.message.contains("logging.rs"), "{}", entry.message);
    }

    /// Backoff doubles and then stops; without the cap a poisoned mutex would have the supervisor respawning forever.
    #[test]
    fn restarts_back_off_and_then_give_up() {
        assert_eq!(restart_plan(1), Some(5));
        assert_eq!(restart_plan(2), Some(10));
        assert_eq!(restart_plan(3), Some(20));
        assert_eq!(restart_plan(MAX_RESTARTS), Some(80));
        assert_eq!(restart_plan(MAX_RESTARTS + 1), None);
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
