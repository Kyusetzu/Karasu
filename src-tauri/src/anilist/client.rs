use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;
// Monotonic, so a user moving their clock cannot invent or erase a throttle.
use tokio::time::Instant;

const API_URL: &str = "https://graphql.anilist.co";

/// How many recent requests the sync panel can show; bounded, since this ring sits on the hot path of every call.
const LOG_CAP: usize = 50;

/// The root field a query asks for, from the query text alone; the variables carry secrets and are never read here.
pub fn operation_name(query: &str) -> String {
    // The selection set opens at the first `{` outside the variable list.
    let mut depth = 0usize;
    let mut rest = query;
    loop {
        let Some(i) = rest.find(['(', ')', '{']) else {
            return "query".into();
        };
        let (c, tail) = (&rest[i..i + 1], &rest[i + 1..]);
        rest = tail;
        match c {
            "(" => depth += 1,
            ")" => depth = depth.saturating_sub(1),
            _ if depth == 0 => break,
            _ => {}
        }
    }
    // The first identifier in the selection, or what an alias aliases, since "a" would say nothing.
    fn ident(s: &str) -> Option<(String, &str)> {
        let s = s.trim_start();
        let end = s
            .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
            .unwrap_or(s.len());
        (end > 0).then(|| (s[..end].to_string(), &s[end..]))
    }
    let Some((first, after)) = ident(rest) else {
        return "query".into();
    };
    match after.trim_start().strip_prefix(':') {
        Some(aliased) => ident(aliased).map(|(n, _)| n).unwrap_or(first),
        None => first,
    }
}

/// How a failed request is treated by anything holding an unsent write: the offline queue keeps all but `Api`.
#[derive(Debug)]
pub enum ApiError {
    Network(String),
    /// AniList rejected the token, not the payload; still retryable, since it is the credential that went stale.
    Auth(String),
    Retryable(String),
    Api(String),
}

/// What the frontend gets for an `Auth` failure; `lib/backendError.ts` turns it into a sentence.
pub const TOKEN_REJECTED: &str = "anilist.tokenRejected";

/// Whether the current run of rejections has been logged; cleared by the next success, so a later one is reported.
static AUTH_REPORTED: AtomicBool = AtomicBool::new(false);

impl ApiError {
    /// Whether sending the same request later could plausibly succeed.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            ApiError::Network(_) | ApiError::Retryable(_) | ApiError::Auth(_)
        )
    }
}

impl From<ApiError> for String {
    fn from(e: ApiError) -> Self {
        match e {
            ApiError::Network(m) => format!("Network error: {m}"),
            // A stable code rather than AniList's wording, which is English, unactionable and was rendered raw everywhere.
            ApiError::Auth(_) => TOKEN_REJECTED.into(),
            ApiError::Retryable(m) | ApiError::Api(m) => m,
        }
    }
}

/// HTTP statuses that mean "not now" rather than "not ever"; a 429 here has already outlived the one retry.
fn status_is_retryable(code: u16) -> bool {
    matches!(code, 401 | 403 | 429) || (500..600).contains(&code)
}

/// The stable code for a rate-limited request, so the frontend need not re-implement `verdict` in TypeScript.
pub const RATE_LIMITED: &str = "anilist.rateLimited";

/// What one failed response means before it becomes an `ApiError`; `Ambiguous` is the case the caller must go and settle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verdict {
    RateLimited,
    /// The credential is dead; only a 401 or an explicit "invalid token" says so on its own.
    Auth,
    /// A bare `Unauthorized.` with a token sent: AniList uses the same word for a dead token and a refused payload.
    Ambiguous,
    Retryable,
    Api,
}

/// The truth table in order of precedence; a 403 is not a dead token, and a tokenless auth-shaped failure is weather.
fn verdict(code: u16, msg: &str, sent_token: bool) -> Verdict {
    if code == 429 {
        return Verdict::RateLimited;
    }
    let m = msg.to_ascii_lowercase();
    if code == 401 || m.contains("invalid token") {
        return if sent_token {
            Verdict::Auth
        } else {
            Verdict::Retryable
        };
    }
    // The whole message, not a substring: only the bare word is the form a dead token and a refused payload share.
    let bare = m.trim().trim_end_matches('.').trim();
    if bare == "unauthorized" {
        return if sent_token {
            Verdict::Ambiguous
        } else {
            Verdict::Retryable
        };
    }
    if status_is_retryable(code) || m.contains("too many requests") {
        Verdict::Retryable
    } else {
        Verdict::Api
    }
}

/// `verdict` mapped onto `ApiError` with no probe; `Ambiguous` becomes `Auth`, which the probe's own request relies on.
fn classify(code: u16, msg: String, sent_token: bool) -> ApiError {
    match verdict(code, &msg, sent_token) {
        Verdict::RateLimited => {
            // 429 is the one retryable class worth naming: the frontend must not spend a second round trip on it.
            crate::logging::debug("anilist", format!("rate limited: {msg}"));
            ApiError::Retryable(RATE_LIMITED.into())
        }
        Verdict::Auth | Verdict::Ambiguous => ApiError::Auth(msg),
        Verdict::Retryable => ApiError::Retryable(msg),
        Verdict::Api => ApiError::Api(msg),
    }
}

/// What an `Ambiguous` refusal means once probed; nobody is signed out on an inconclusive probe.
fn resolve_ambiguous(msg: String, alive: Option<bool>) -> ApiError {
    match alive {
        Some(true) => ApiError::Api(msg),
        Some(false) => ApiError::Auth(msg),
        None => ApiError::Retryable(msg),
    }
}

/// Whether a request may probe the token to settle an `Ambiguous` refusal; the probe's own request may not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Probe {
    Allowed,
    Never,
}

/// The cheapest authenticated query there is: `Unauthorized` on a dead token, a viewer id on a live one.
const PROBE_QUERY: &str = "{ Viewer { id } }";

/// How long one probe's answer stands, so a screen's several ambiguous refusals do not each spend a request.
const PROBE_TTL: Duration = Duration::from_secs(60);

/// Whether the current run of non-auth refusals has been logged; cleared by the next success, like `AUTH_REPORTED`.
static REFUSED_REPORTED: AtomicBool = AtomicBool::new(false);

/// The limiter's last measurement on disk, so a process started seconds after another does not assume a full budget.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedRate {
    pub remaining: u32,
    pub limit: Option<u32>,
    /// Wall-clock milliseconds, compared only for age; the live state stays monotonic.
    pub observed_ms: i64,
    pub retry_until_ms: Option<i64>,
}

/// Where the limiter keeps `PersistedRate`; closures, so this module knows nothing about the database or tauri.
pub struct RateStore {
    pub load: Box<dyn Fn() -> Option<PersistedRate> + Send + Sync>,
    pub save: Box<dyn Fn(&PersistedRate) + Send + Sync>,
}

/// AniList GraphQL client with centralized rate limiting, paced by the X-RateLimit headers.
pub struct AniList {
    http: reqwest::Client,
    rate: Mutex<RateState>,
    store: Option<RateStore>,
    /// The recent-traffic ring behind the sync panel; in memory only, never written to `karasu.log`.
    log: Mutex<VecDeque<Recorded>>,
    /// Requests counted per source since start and per five-minute window; a std mutex, since diagnostics reads it sync.
    traffic: std::sync::Mutex<Traffic>,
    /// The last token probe's verdict and when it was reached; `token_alive` reads it, `PROBE_TTL` ages it.
    probe: Mutex<Option<(Instant, bool)>>,
}

/// Who sent a request, as the caller named itself: a background pass, a list command, or a screen through the passthrough.
pub type Source = String;

/// The per-source tallies behind the diagnostics rows, the sync panel's table and the five-minute log line.
#[derive(Default)]
pub struct Traffic {
    since_start: BTreeMap<Source, u32>,
    window: BTreeMap<Source, u32>,
    throttled_total: u32,
    throttled_window: u32,
    min_remaining_window: Option<u32>,
    last_remaining: Option<u32>,
    last_limit: Option<u32>,
}

impl Traffic {
    fn count(&mut self, source: &str, status: Option<u16>, remaining: Option<u32>) {
        *self.since_start.entry(source.to_string()).or_default() += 1;
        *self.window.entry(source.to_string()).or_default() += 1;
        if status == Some(429) {
            self.throttled_total += 1;
            self.throttled_window += 1;
        }
        if let Some(r) = remaining {
            self.last_remaining = Some(r);
            self.min_remaining_window = Some(self.min_remaining_window.map_or(r, |m| m.min(r)));
        }
    }

    /// The five-minute line, and the window it describes is cleared; a zero line is the proof a quiet night was quiet.
    pub fn report_window(&mut self) -> String {
        let total: u32 = self.window.values().sum();
        let by_source = self
            .window
            .iter()
            .map(|(k, v)| format!("{k} {v}"))
            .collect::<Vec<_>>()
            .join(", ");
        let min = self
            .min_remaining_window
            .map_or("-".to_string(), |m| m.to_string());
        let line = format!(
            "{total} requests in the last 5 min: {}; 429s {}, min remaining {min}",
            if by_source.is_empty() { "none".to_string() } else { by_source },
            self.throttled_window,
        );
        self.window.clear();
        self.throttled_window = 0;
        self.min_remaining_window = None;
        line
    }
}

/// What the panel and the diagnostics report see of the tallies.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrafficSnapshot {
    /// Requests per source since the app started, alphabetical.
    pub sources: Vec<TrafficSource>,
    /// HTTP 429 answers since the app started.
    pub throttled: u32,
    pub remaining: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(serde::Serialize, Clone)]
pub struct TrafficSource {
    pub source: String,
    pub total: u32,
}

/// One finished request, stored with a monotonic instant so its age is computed at read time.
struct Recorded {
    seq: u64,
    source: Source,
    operation: String,
    at: Instant,
    duration: Duration,
    paced: Duration,
    status: Option<u16>,
    remaining_after: Option<u32>,
    outcome: &'static str,
}

/// One row of the panel's traffic list.
#[derive(serde::Serialize)]
pub struct RequestLogEntry {
    /// Monotonic within a session, so the panel has a stable React key.
    pub seq: u64,
    /// The caller's name for itself, so the panel can say which screen or pass spent the budget.
    pub source: String,
    /// The root field asked for. Never the variables — see `operation_name`.
    pub operation: String,
    #[serde(rename = "startedAgoMs")]
    pub started_ago_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    /// How long this request waited on the client's own pacing; separate from `durationMs`, since the fixes differ.
    #[serde(rename = "pacedMs")]
    pub paced_ms: u64,
    pub status: Option<u16>,
    #[serde(rename = "remainingAfter")]
    pub remaining_after: Option<u32>,
    /// `"ok" | "throttled" | "error"`.
    pub outcome: &'static str,
}

/// The budget assumed before any header has been seen; a guess, not a measurement, and `observed` separates the two.
const SEED: u32 = 30;

/// Requests held in reserve before pacing starts; a threshold of one engages only on the last request, far too late.
const RESERVE: u32 = 2;

/// AniList's accounting window; without it `remaining` only ever falls, and one 0 pins the limiter for the process.
const WINDOW: Duration = Duration::from_secs(60);

/// One pacing slice, short on purpose: the point is to re-check, since a response landing mid-wait can raise the budget.
const SLICE: Duration = Duration::from_millis(400);

/// The longest one caller paces before sending regardless; a stalled screen costs more than the 429 it avoids.
const MAX_PACE: Duration = Duration::from_secs(5);

struct RateState {
    /// The working count: from `x-ratelimit-remaining`, decremented by `claim`, reset by `headroom` when the window rolled.
    remaining: u32,
    /// `x-ratelimit-limit`, the sync panel's denominator.
    limit: Option<u32>,
    /// When a header last landed; `None` means `remaining` is still the seed, a guess the panel must not render as data.
    observed: Option<Instant>,
    /// The monotonic deadline this client will not send before; nothing ever clears it and it only ever moves forward.
    sleeping_until: Option<Instant>,
    /// `"preflight" | "retryAfter"`, replaced only with the deadline; these exact strings are the contract with `SyncPanel`.
    sleeping_kind: Option<&'static str>,
    /// When the limiter last reset its own count; deliberately not `observed`, or a guess would render as a measurement.
    reset_at: Option<Instant>,
}

/// Why the pre-flight loop is not sending yet.
enum Wait {
    /// Nothing in the way; the request is claimed and goes out.
    Go,
    /// Our own pacing, bounded by `MAX_PACE`.
    Local(Duration),
    /// A deadline AniList set. Not bounded by `MAX_PACE`.
    Server(Duration),
}

impl RateState {
    /// Parks until at least `d` from now; forward only, so a short nap never shortens a long `Retry-After`.
    fn park(&mut self, d: Duration, kind: &'static str) {
        let until = Instant::now() + d;
        if self.sleeping_until.is_none_or(|t| until > t) {
            self.sleeping_until = Some(until);
            self.sleeping_kind = Some(kind);
        }
    }

    /// How much longer this client will not send, or `None`; a deadline in the past is simply not a throttle.
    fn throttled_for(&self, now: Instant) -> Option<Duration> {
        self.sleeping_until
            .filter(|t| *t > now)
            .map(|t| t.duration_since(now))
    }

    /// The last moment `remaining` meant anything: a header landing, or a local reset once the window rolled.
    fn counted_at(&self) -> Option<Instant> {
        match (self.observed, self.reset_at) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        }
    }

    /// What is available now, healing a stale count; the window steps, it does not roll, so do not heal proportionally.
    fn headroom(&mut self, now: Instant) -> u32 {
        if self.counted_at().is_none_or(|t| now.duration_since(t) >= WINDOW) {
            self.remaining = self.limit.unwrap_or(SEED);
            self.reset_at = Some(now);
        }
        self.remaining
    }

    /// Books a request against the budget before it goes out, so a burst can see its own in-flight work.
    fn claim(&mut self) {
        self.remaining = self.remaining.saturating_sub(1);
    }

    /// The state a stored measurement restores, or none when it is older than the window or from a clock that went back.
    fn restored(p: &PersistedRate, now_ms: i64, now: Instant) -> Option<RateState> {
        let age_ms = now_ms - p.observed_ms;
        if age_ms < 0 || age_ms as u128 >= WINDOW.as_millis() {
            return None;
        }
        let observed = now.checked_sub(Duration::from_millis(age_ms as u64))?;
        let mut state = RateState {
            remaining: p.remaining,
            limit: p.limit,
            observed: Some(observed),
            sleeping_until: None,
            sleeping_kind: None,
            reset_at: None,
        };
        if let Some(until) = p.retry_until_ms.filter(|u| *u > now_ms) {
            state.park(Duration::from_millis((until - now_ms) as u64), "retryAfter");
        }
        Some(state)
    }

    /// What to write to disk after a header or a park; wall-clock stamps, so the next process can compute the age.
    fn persisted(&self, now: Instant, now_ms: i64) -> Option<PersistedRate> {
        let observed = self.observed?;
        let age = now.saturating_duration_since(observed).as_millis() as i64;
        Some(PersistedRate {
            remaining: self.remaining,
            limit: self.limit,
            observed_ms: now_ms - age,
            retry_until_ms: self
                .throttled_for(now)
                .map(|d| now_ms + d.as_millis() as i64),
        })
    }
}

fn wall_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// What the sync panel shows about the limiter; local state only, so reading it costs no request.
#[derive(serde::Serialize)]
pub struct RateSnapshot {
    /// `None` until a response header has been seen this session.
    pub remaining: Option<u32>,
    pub limit: Option<u32>,
    #[serde(rename = "observedAgoMs")]
    pub observed_ago_ms: Option<u64>,
    /// Independent of `remaining`, never derived from it: a 429 may omit the header, and this is the signal to branch on.
    #[serde(rename = "throttledForMs")]
    pub throttled_for_ms: Option<u64>,
    #[serde(rename = "throttleKind")]
    pub throttle_kind: Option<&'static str>,
}

impl AniList {
    pub fn new(store: Option<RateStore>) -> Self {
        // A recent measurement from the last process beats the seed; a build swap used to earn a 429 burst here.
        let rate = store
            .as_ref()
            .and_then(|s| (s.load)())
            .and_then(|p| RateState::restored(&p, wall_ms(), Instant::now()))
            .unwrap_or(RateState {
                remaining: SEED,
                limit: None,
                observed: None,
                sleeping_until: None,
                sleeping_kind: None,
                reset_at: None,
            });
        Self {
            http: crate::net::client_builder()
                .user_agent(concat!("Karasu/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
            rate: Mutex::new(rate),
            store,
            log: Mutex::new(VecDeque::with_capacity(LOG_CAP)),
            traffic: std::sync::Mutex::new(Traffic::default()),
            probe: Mutex::new(None),
        }
    }

    /// Whether `token` still works, decided by one probe and remembered for `PROBE_TTL`; `None` must not sign anyone out.
    async fn token_alive(&self, token: &str) -> Option<bool> {
        if let Some((at, alive)) = *self.probe.lock().await {
            if at.elapsed() < PROBE_TTL {
                return Some(alive);
            }
        }
        crate::logging::info("anilist", "probing the token after an ambiguous refusal");
        let res = Box::pin(self.query_with("probe", Some(token), PROBE_QUERY, json!({}), Probe::Never)).await;
        let alive = match res {
            Ok(_) => Some(true),
            Err(ApiError::Auth(_)) => Some(false),
            Err(_) => None,
        };
        crate::logging::info(
            "anilist",
            match alive {
                Some(true) => "token probe: alive — the refusal was about the payload",
                Some(false) => "token probe: dead",
                None => "token probe: inconclusive",
            },
        );
        if let Some(a) = alive {
            *self.probe.lock().await = Some((Instant::now(), a));
        }
        alive
    }

    /// Appends one finished request, evicting the oldest past `LOG_CAP`.
    #[allow(clippy::too_many_arguments)]
    async fn record(
        &self,
        source: &str,
        operation: &str,
        at: Instant,
        paced: Duration,
        status: Option<u16>,
        remaining_after: Option<u32>,
        outcome: &'static str,
    ) {
        if let Ok(mut traffic) = self.traffic.lock() {
            traffic.count(source, status, remaining_after);
        }
        let mut log = self.log.lock().await;
        let seq = log.back().map_or(0, |r: &Recorded| r.seq) + 1;
        if log.len() >= LOG_CAP {
            log.pop_front();
        }
        log.push_back(Recorded {
            seq,
            source: source.to_string(),
            operation: operation.to_string(),
            at,
            duration: at.elapsed(),
            paced,
            status,
            remaining_after,
            outcome,
        });
    }

    /// The recent traffic, newest first.
    pub async fn request_log(&self) -> Vec<RequestLogEntry> {
        let now = Instant::now();
        let log = self.log.lock().await;
        log.iter()
            .rev()
            .map(|r| RequestLogEntry {
                seq: r.seq,
                source: r.source.clone(),
                operation: r.operation.clone(),
                started_ago_ms: now.duration_since(r.at).as_millis() as u64,
                duration_ms: r.duration.as_millis() as u64,
                paced_ms: r.paced.as_millis() as u64,
                status: r.status,
                remaining_after: r.remaining_after,
                outcome: r.outcome,
            })
            .collect()
    }

    /// A snapshot of the limiter for the sync panel; on the hot path of every call, so a short read and nothing more.
    pub async fn rate_snapshot(&self) -> RateSnapshot {
        let now = Instant::now();
        let rate = self.rate.lock().await;
        RateSnapshot {
            // Gated on `observed`: without a header this is the seed, and a guess must not be reported as a measurement.
            remaining: rate.observed.map(|_| rate.remaining),
            limit: rate.limit,
            observed_ago_ms: rate
                .observed
                .map(|t| now.duration_since(t).as_millis() as u64),
            throttled_for_ms: rate.throttled_for(now).map(|d| d.as_millis() as u64),
            throttle_kind: rate.throttled_for(now).and(rate.sleeping_kind),
        }
    }

    /// Writes the limiter's measurement for the next process; called under the rate lock, one small kv write.
    fn persist(&self, rate: &RateState) {
        if let (Some(store), Some(p)) = (&self.store, rate.persisted(Instant::now(), wall_ms())) {
            (store.save)(&p);
        }
    }

    /// The tallies as the panel and the diagnostics report show them; sync, so `diagnostics::collect` can read it.
    pub fn traffic_snapshot(&self) -> TrafficSnapshot {
        let traffic = self.traffic.lock().unwrap_or_else(|e| e.into_inner());
        TrafficSnapshot {
            sources: traffic
                .since_start
                .iter()
                .map(|(source, total)| TrafficSource { source: source.clone(), total: *total })
                .collect(),
            throttled: traffic.throttled_total,
            remaining: traffic.last_remaining,
            limit: traffic.last_limit,
        }
    }

    /// The five-minute line for the log; the caller decides the cadence.
    pub fn report_window(&self) -> String {
        self.traffic
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .report_window()
    }

    /// One request, tagged with who sent it; every caller names itself so the budget can be read per source.
    pub async fn query_from(
        &self,
        source: &str,
        token: Option<&str>,
        query: &str,
        variables: Value,
    ) -> Result<Value, ApiError> {
        self.query_with(source, token, query, variables, Probe::Allowed).await
    }

    async fn query_with(
        &self,
        source: &str,
        token: Option<&str>,
        query: &str,
        variables: Value,
        probe: Probe,
    ) -> Result<Value, ApiError> {
        // Pace into the budget in short re-checking slices; each decision and its `park` are one critical section on purpose.
        let started = Instant::now();
        loop {
            // Two different reasons to wait, and only one of them is ours.
            let wait = {
                let mut rate = self.rate.lock().await;
                let now = Instant::now();
                if let Some(left) = rate.throttled_for(now) {
                    // A deadline the server set: a `Retry-After` outranks the local budget; one retry layer, never two.
                    Wait::Server(left.min(SLICE))
                } else if rate.headroom(now) > RESERVE {
                    rate.claim();
                    Wait::Go
                } else {
                    rate.park(SLICE, "preflight");
                    Wait::Local(SLICE)
                }
            };
            let d = match wait {
                Wait::Go => break,
                // `MAX_PACE` bounds only our own pacing; a server deadline is not ours to shorten.
                Wait::Local(d) => {
                    if started.elapsed() >= MAX_PACE {
                        self.rate.lock().await.claim();
                        break;
                    }
                    d
                }
                Wait::Server(d) => d,
            };
            tokio::time::sleep(d).await;
        }
        // Recorded per request so the panel can separate our own pacing from AniList being slow.
        let paced = started.elapsed();
        let operation = operation_name(query);

        for attempt in 0..2 {
            let sent = Instant::now();
            let mut req = self
                .http
                .post(API_URL)
                .json(&json!({ "query": query, "variables": variables }));
            if let Some(t) = token {
                req = req.bearer_auth(t);
            }

            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    // Never the body and never the headers: the request carries the bearer token this module keeps in Rust.
                    crate::logging::warn("anilist", format!("request failed: {e}"));
                    self.record(source, &operation, sent, paced, None, None, "error").await;
                    return Err(ApiError::Network(e.to_string()));
                }
            };

            // One line when it changes, so a device log can prove which protocol the TLS handshake negotiated.
            crate::logging::debug_changed(
                "anilist",
                "http-version",
                format!("negotiated {:?}", resp.version()),
            );

            let header_u32 = |name: &str| {
                resp.headers()
                    .get(name)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u32>().ok())
            };
            let remaining = header_u32("x-ratelimit-remaining");
            let limit = header_u32("x-ratelimit-limit");
            if remaining.is_some() || limit.is_some() {
                let mut rate = self.rate.lock().await;
                if let Some(rem) = remaining {
                    // Authoritative: it overwrites whatever `claim` guessed and retires the local reset, now older than it.
                    rate.remaining = rem;
                    rate.observed = Some(Instant::now());
                    rate.reset_at = None;
                }
                if let Some(l) = limit {
                    rate.limit = Some(l);
                }
                self.persist(&rate);
            }
            if let (Some(l), Ok(mut traffic)) = (limit, self.traffic.lock()) {
                traffic.last_limit = Some(l);
            }

            if resp.status().as_u16() == 429 && attempt == 0 {
                crate::logging::warn(
                    "anilist",
                    "rate limited (HTTP 429) — waiting before one retry",
                );
                let wait = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(60)
                    .min(120);
                {
                    let mut rate = self.rate.lock().await;
                    rate.park(Duration::from_secs(wait), "retryAfter");
                    self.persist(&rate);
                }
                // The line a budget report needs: who hit the wall, how long the server asked for, what it had left.
                crate::logging::debug(
                    "anilist",
                    format!("429 for {source}: retry-after {wait}s, remaining {remaining:?}"),
                );
                self.record(source, &operation, sent, paced, Some(429), remaining, "throttled")
                    .await;
                tokio::time::sleep(Duration::from_secs(wait)).await;
                continue;
            }

            let status = resp.status().as_u16();
            let body: Value = match resp.json::<Value>().await {
                Ok(b) => b,
                Err(e) => {
                    self.record(source, &operation, sent, paced, Some(status), remaining, "error")
                        .await;
                    return Err(classify(
                        status,
                        format!("Unreadable response (HTTP {status}): {e}"),
                        token.is_some(),
                    ));
                }
            };

            if let Some(errors) = body.get("errors").and_then(|e| e.as_array()) {
                let msg = errors
                    .iter()
                    .filter_map(|e| {
                        let m = e.get("message").and_then(|m| m.as_str())?;
                        // "validation" alone says nothing — append the details
                        match e.get("validation") {
                            Some(v) if m == "validation" => Some(format!("{m}: {v}")),
                            _ => Some(m.to_string()),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("; ");
                self.record(source, &operation, sent, paced, Some(status), remaining, "error")
                    .await;
                let msg = if msg.is_empty() {
                    format!("AniList error (HTTP {status})")
                } else {
                    msg
                };
                // A bare `Unauthorized.` with a token sent is the one answer the response cannot settle; ask once, do not sign out.
                let err = match (verdict(status, &msg, token.is_some()), token, probe) {
                    (Verdict::Ambiguous, Some(t), Probe::Allowed) => {
                        let alive = self.token_alive(t).await;
                        resolve_ambiguous(msg, alive)
                    }
                    _ => classify(status, msg, token.is_some()),
                };
                // Once per transition, never the header or the body; an unguarded warn would rotate the interesting part off disk.
                match &err {
                    ApiError::Auth(reason) => {
                        if !AUTH_REPORTED.swap(true, Ordering::Relaxed) {
                            crate::logging::warn(
                                "anilist",
                                format!("token rejected (HTTP {status}): {reason}"),
                            );
                        }
                    }
                    // A refusal that is not about the credential is the line a bug report needs.
                    ApiError::Retryable(reason) | ApiError::Api(reason)
                        if matches!(status, 401 | 403) =>
                    {
                        if !REFUSED_REPORTED.swap(true, Ordering::Relaxed) {
                            crate::logging::warn(
                                "anilist",
                                format!("refused (HTTP {status}): {reason}"),
                            );
                        }
                    }
                    _ => {}
                }
                return Err(err);
            }

            let data = body.get("data").cloned();
            if data.is_some() {
                // Armed again, so a later rejection is logged rather than swallowed as a repeat of one already fixed.
                AUTH_REPORTED.store(false, Ordering::Relaxed);
                REFUSED_REPORTED.store(false, Ordering::Relaxed);
            }
            self.record(
                source,
                &operation,
                sent,
                paced,
                Some(status),
                remaining,
                if data.is_some() { "ok" } else { "error" },
            )
            .await;
            return data.ok_or_else(|| {
                classify(
                    status,
                    format!("Empty response from AniList (HTTP {status})"),
                    token.is_some(),
                )
            });
        }

        Err(ApiError::Retryable(
            "AniList rate limit reached, please try again later".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tallies count per source and per window, and the report line empties the window but not the totals.
    #[test]
    fn traffic_counts_per_source_and_reports_the_window() {
        let mut t = Traffic::default();
        t.count("list", Some(200), Some(28));
        t.count("list", Some(200), Some(27));
        t.count("airing", Some(429), Some(0));
        assert_eq!(
            t.report_window(),
            "3 requests in the last 5 min: airing 1, list 2; 429s 1, min remaining 0"
        );
        assert_eq!(t.report_window(), "0 requests in the last 5 min: none; 429s 0, min remaining -");
        assert_eq!(t.since_start.get("list"), Some(&2));
        assert_eq!(t.throttled_total, 1);
        assert_eq!(t.last_remaining, Some(0));
    }

    /// A measurement younger than the window seeds the next process; an expired or future-dated one is ignored.
    #[test]
    fn a_recent_measurement_restores_and_an_old_one_does_not() {
        let now = Instant::now();
        let p = PersistedRate { remaining: 4, limit: Some(30), observed_ms: 10_000, retry_until_ms: None };
        let r = RateState::restored(&p, 30_000, now).expect("20 s old restores");
        assert_eq!(r.remaining, 4);
        assert_eq!(r.limit, Some(30));
        assert!(r.observed.is_some_and(|o| now.duration_since(o) >= Duration::from_secs(20)));
        assert!(RateState::restored(&p, 10_000 + WINDOW.as_millis() as i64, now).is_none());
        assert!(RateState::restored(&p, 5_000, now).is_none(), "a clock that went back is not trusted");
    }

    /// A Retry-After that has not passed is parked again, so the retry layer stays one deep across a restart.
    #[test]
    fn a_pending_retry_after_is_parked_again() {
        let now = Instant::now();
        let p = PersistedRate { remaining: 0, limit: Some(30), observed_ms: 1_000, retry_until_ms: Some(41_000) };
        let r = RateState::restored(&p, 2_000, now).expect("1 s old restores");
        let left = r.throttled_for(now).expect("parked");
        assert!(left > Duration::from_millis(38_500) && left <= Duration::from_millis(39_500));
        assert_eq!(r.sleeping_kind, Some("retryAfter"));
        let done = PersistedRate { retry_until_ms: Some(1_500), ..p };
        assert!(RateState::restored(&done, 2_000, now).unwrap().throttled_for(now).is_none());
    }

    /// What goes to disk carries the wall-clock moment of the observation and the deadline, not the durations.
    #[test]
    fn persisted_state_round_trips() {
        let now = Instant::now();
        let mut r = fresh();
        r.remaining = 7;
        r.limit = Some(30);
        r.observed = Some(now - Duration::from_secs(3));
        r.park(Duration::from_secs(20), "retryAfter");
        let p = r.persisted(now, 100_000).expect("observed");
        assert_eq!(p.remaining, 7);
        assert_eq!(p.observed_ms, 97_000);
        assert!(p.retry_until_ms.is_some_and(|u| (119_900..=120_000).contains(&u)));
        assert!(fresh().persisted(now, 100_000).is_none(), "a seed is not a measurement");
    }

    fn fresh() -> RateState {
        RateState {
            remaining: SEED,
            limit: None,
            observed: None,
            sleeping_until: None,
            sleeping_kind: None,
            reset_at: None,
        }
    }

    /// A server deadline is checked before the local budget, or every caller keeps sending into a closed window.
    #[test]
    fn a_server_deadline_outranks_a_healthy_local_budget() {
        let mut rate = fresh();
        let now = Instant::now();
        // Plenty of budget by the local count.
        rate.remaining = SEED;
        rate.observed = Some(now);
        assert!(rate.headroom(now) > RESERVE);
        // But the server said wait.
        rate.park(Duration::from_secs(90), "retryAfter");
        assert!(
            rate.throttled_for(now).is_some(),
            "the pre-flight loop checks this before the budget"
        );
    }

    /// 429 answers with a stable code, so the frontend can recognise the class without re-implementing `verdict`.
    #[test]
    fn a_rate_limit_is_named_not_described() {
        let e = classify(429, "Too Many Requests".into(), true);
        assert!(matches!(e, ApiError::Retryable(ref m) if m == RATE_LIMITED));
        assert!(e.is_retryable(), "and it still keeps a queued edit");
    }

    /// A tokenless 429 is the same class; `sent_token` only ever decides auth-shaped failures.
    #[test]
    fn a_rate_limit_is_named_with_or_without_a_token() {
        assert!(
            matches!(classify(429, "x".into(), false), ApiError::Retryable(ref m) if m == RATE_LIMITED)
        );
    }

    #[test]
    fn an_expired_deadline_is_not_a_throttle() {
        let now = Instant::now();
        let mut r = fresh();
        assert!(r.throttled_for(now).is_none(), "nothing parked");

        r.park(Duration::from_secs(5), "preflight");
        assert!(r.throttled_for(now).is_some());
        // Ten seconds later the same deadline has simply passed.
        assert!(r.throttled_for(now + Duration::from_secs(10)).is_none());
    }

    /// A short pre-flight nap beginning during another task's long `Retry-After` must not shorten the reported wait.
    #[test]
    fn a_short_park_never_shortens_a_long_one() {
        let now = Instant::now();
        let mut r = fresh();

        r.park(Duration::from_secs(120), "retryAfter");
        r.park(Duration::from_secs(5), "preflight");

        let left = r.throttled_for(now).expect("still parked");
        assert!(left > Duration::from_secs(60), "got {left:?}");
        assert_eq!(r.sleeping_kind, Some("retryAfter"), "and the reason with it");

        // Forward is allowed, which is the other half of the rule.
        r.park(Duration::from_secs(300), "retryAfter");
        assert!(r.throttled_for(now).unwrap() > Duration::from_secs(200));
    }

    /// The seed is a guess; reporting it as a measurement would draw a full headroom bar before any request.
    #[tokio::test]
    async fn headroom_is_unknown_until_a_header_lands() {
        let api = AniList::new(None);
        let snap = api.rate_snapshot().await;
        assert_eq!(snap.remaining, None);
        assert_eq!(snap.limit, None);
        assert_eq!(snap.observed_ago_ms, None);
        assert_eq!(snap.throttled_for_ms, None);
    }

    /// The stepped reading: a count holds for a full `WINDOW` and then jumps to the limit, all at once.
    #[test]
    fn a_count_from_a_rolled_window_stops_counting() {
        let now = Instant::now();
        let mut r = fresh();
        r.remaining = 0;
        r.observed = Some(now);
        r.limit = Some(30);

        // Inside the window the reading stands, and pacing is correct.
        assert_eq!(r.headroom(now + Duration::from_secs(5)), 0);
        // Past it the window has rolled and the budget is back.
        assert_eq!(r.headroom(now + WINDOW + Duration::from_secs(1)), 30);
    }

    /// A limiter blind to its own in-flight work lets a burst through while the panel shows comfortable headroom.
    #[test]
    fn a_claim_is_visible_to_the_next_caller() {
        let now = Instant::now();
        let mut r = fresh();
        let before = r.headroom(now);
        r.claim();
        assert_eq!(r.headroom(now), before - 1, "the next caller sees it");
    }

    /// Saturating: a burst can outrun the budget, and an underflow would wrap and disable pacing entirely.
    #[test]
    fn claiming_past_empty_stops_at_zero() {
        let mut r = fresh();
        r.remaining = 1;
        r.claim();
        r.claim();
        r.claim();
        assert_eq!(r.remaining, 0);
    }

    /// A local repair is not a measurement, so healing a stale count must not make the seed look like a header.
    #[tokio::test]
    async fn healing_the_count_does_not_fake_an_observation() {
        let now = Instant::now();
        let mut r = fresh();
        r.headroom(now);
        assert!(r.reset_at.is_some(), "it did repair");
        assert!(r.observed.is_none(), "but nothing was measured");
    }

    /// The exact strings `SyncPanel` branches on; a mismatch renders every genuine 429 as the app pacing itself.
    #[test]
    fn the_throttle_kinds_are_the_strings_the_panel_compares() {
        let now = Instant::now();
        let mut r = fresh();
        r.park(SLICE, "preflight");
        assert_eq!(r.throttled_for(now).and(r.sleeping_kind), Some("preflight"));

        let mut r = fresh();
        r.park(Duration::from_secs(60), "retryAfter");
        assert_eq!(r.throttled_for(now).and(r.sleeping_kind), Some("retryAfter"));
    }

    /// The reserve has to leave room to act on; at a threshold of one the guard engages too late.
    #[test]
    fn the_reserve_is_more_than_the_last_request() {
        assert!(RESERVE > 1, "a threshold of 1 is too late to be a guard");
        assert!(MAX_PACE < WINDOW, "a caller must not wait out a whole window");
        assert!(SLICE < MAX_PACE, "the point of a slice is to re-check");
    }

    /// The name is the root field the request is for, read past the variable list.
    #[test]
    fn a_request_is_named_by_what_it_asks_for() {
        for (query, want) in [
            ("query ($id: Int!) { Media(id: $id) { id } }", "Media"),
            ("\nquery ($p: Int) {\n  Page(page: $p) {\n    media { id }\n", "Page"),
            ("mutation ($id: Int) { SaveMediaListEntry(mediaId: $id) { id } }", "SaveMediaListEntry"),
            ("{ Viewer { id } }", "Viewer"),
        ] {
            assert_eq!(operation_name(query), want, "for {query:?}");
        }
    }

    /// An aliased root is reported as what it aliases, or a row would read "a" and say nothing.
    #[test]
    fn an_alias_is_reported_as_what_it_aliases() {
        assert_eq!(
            operation_name("query { followers: Page(page: 1) { pageInfo { total } } }"),
            "Page"
        );
    }

    /// Anything unrecognisable degrades to a generic label, never a panic and never a variable.
    #[test]
    fn an_unreadable_query_is_named_generically() {
        for query in ["", "query", "query (", "{", "{ }", "((("] {
            let name = operation_name(query);
            assert!(!name.is_empty(), "{query:?} produced an empty name");
        }
    }

    /// Bounded, because this is an in-memory ring on the hot path of every call.
    #[tokio::test]
    async fn the_log_keeps_the_newest_and_reports_newest_first() {
        let api = AniList::new(None);
        let now = Instant::now();
        for _ in 0..(LOG_CAP + 10) {
            api.record("test", "Media", now, Duration::ZERO, Some(200), Some(28), "ok")
                .await;
        }
        let rows = api.request_log().await;
        assert_eq!(rows.len(), LOG_CAP, "capped");
        assert!(rows[0].seq > rows[1].seq, "newest first");
        // The eviction is from the front, so the oldest sequence numbers went.
        assert_eq!(rows[0].seq, (LOG_CAP + 10) as u64);
    }

    /// Every one of these must be retryable, because the offline queue deletes `Api` failures.
    #[test]
    fn recoverable_failures_survive() {
        for code in [401, 403, 429, 500, 502, 503, 504] {
            assert!(
                classify(code, "whatever".into(), true).is_retryable(),
                "HTTP {code} must be retryable"
            );
        }
    }

    /// A payload AniList will refuse forever must be droppable, or one bad row wedges every edit behind it.
    #[test]
    fn payload_failures_are_permanent() {
        for code in [200, 400, 404, 422] {
            assert!(
                !classify(code, "validation: {\"progress\":[\"invalid\"]}".into(), true)
                    .is_retryable(),
                "HTTP {code} with a validation message must be permanent"
            );
        }
    }

    /// An expired token arrives as HTTP 400 with the reason in the message, so the message has to decide.
    #[test]
    fn an_expired_token_is_read_out_of_the_message() {
        assert!(classify(400, "Invalid token".into(), true).is_retryable());
        assert!(matches!(
            classify(400, "Invalid token".into(), true),
            ApiError::Auth(_)
        ));
        // A request that carried no bearer cannot have had its token rejected; a tokenless 403 is weather.
        assert!(matches!(
            classify(403, "Forbidden".into(), false),
            ApiError::Retryable(_)
        ));
        assert!(matches!(
            classify(401, "Unauthorized".into(), true),
            ApiError::Auth(_)
        ));
        assert!(classify(400, "Too Many Requests".into(), true).is_retryable());
    }

    /// Both keep a queued edit, but only a rejected token means "nothing will change until you sign in again".
    #[test]
    fn a_rejected_token_is_not_the_same_as_a_busy_server() {
        for (code, msg) in [(400, "Invalid token"), (401, "nope"), (403, "invalid token")] {
            assert!(
                matches!(classify(code, msg.into(), true), ApiError::Auth(_)),
                "HTTP {code} / {msg:?} is an auth failure"
            );
        }
        // A 429 is about how fast we asked; calling it an auth failure would sign the user out for being busy.
        for (code, msg) in [(429, "Too Many Requests."), (400, "Too Many Requests")] {
            assert!(
                matches!(classify(code, msg.into(), true), ApiError::Retryable(_)),
                "HTTP {code} / {msg:?} is pace, not auth"
            );
        }
        // A refused payload stays permanent, or one bad row wedges every edit behind it.
        assert!(matches!(
            classify(400, "validation: {\"progress\":[\"invalid\"]}".into(), true),
            ApiError::Api(_)
        ));
    }

    /// A donator 403 is about the payload: the sentence reaches the toast and nothing raises the banner.
    #[test]
    fn a_donator_refusal_is_not_an_auth_failure() {
        let msg = "Sorry, you must be at least a tier 2 donator to pin activities";
        let err = classify(403, msg.into(), true);
        assert!(matches!(err, ApiError::Retryable(_)), "{err:?}");
        assert_eq!(String::from(err), msg);
        assert_ne!(String::from(classify(403, msg.into(), true)), TOKEN_REJECTED);
    }

    /// An outage 403 is not an expired session, and a queued edit must survive it.
    #[test]
    fn an_api_outage_403_keeps_a_queued_edit() {
        let msg = "The AniList API has been temporarily disabled due to severe stability issues.";
        let err = classify(403, msg.into(), true);
        assert!(err.is_retryable());
        assert!(!matches!(err, ApiError::Auth(_)));
        assert_eq!(String::from(err), msg);
    }

    /// A bare `Unauthorized.` is a question to go and ask with a token, and weather without one.
    #[test]
    fn a_bare_unauthorized_is_ambiguous_with_a_token_and_weather_without() {
        assert_eq!(verdict(403, "Unauthorized.", true), Verdict::Ambiguous);
        assert_eq!(verdict(400, "Unauthorized", true), Verdict::Ambiguous);
        assert_eq!(verdict(400, "  unauthorized. ", true), Verdict::Ambiguous);
        assert_eq!(verdict(403, "Unauthorized.", false), Verdict::Retryable);
        // Without a probe the old answer stands, which the probe's own request relies on.
        assert!(matches!(
            classify(403, "Unauthorized.".into(), true),
            ApiError::Auth(_)
        ));
    }

    /// A resolver explaining itself is a refusal of the payload, with the explanation kept.
    #[test]
    fn unauthorized_inside_a_sentence_is_a_permission_error() {
        let v = verdict(403, "Unauthorized: cannot edit this review", true);
        assert_eq!(v, Verdict::Retryable);
        assert_eq!(verdict(400, "Unauthorized: cannot edit this review", true), Verdict::Api);
    }

    /// The probe's three answers; nobody is signed out on an inconclusive one.
    #[test]
    fn an_inconclusive_probe_does_not_sign_out() {
        assert!(matches!(
            resolve_ambiguous("Unauthorized.".into(), Some(true)),
            ApiError::Api(_)
        ));
        assert!(matches!(
            resolve_ambiguous("Unauthorized.".into(), Some(false)),
            ApiError::Auth(_)
        ));
        let unknown = resolve_ambiguous("Unauthorized.".into(), None);
        assert!(matches!(unknown, ApiError::Retryable(_)));
        assert_ne!(String::from(unknown), TOKEN_REJECTED);
    }

    /// The probe's own request must never become another probe.
    #[test]
    fn a_probe_never_probes_itself() {
        // With `Probe::Never` an ambiguous answer takes `classify`'s direct mapping.
        assert_ne!(Probe::Never, Probe::Allowed);
        assert!(matches!(
            classify(400, "Unauthorized".into(), true),
            ApiError::Auth(_)
        ));
    }

    /// Every auth failure has to keep its queued write. The queue drops `Api`.
    #[test]
    fn a_rejected_token_never_drops_an_edit() {
        assert!(classify(401, "Invalid token".into(), true).is_retryable());
    }

    /// The frontend branches on this exact code; AniList's own wording is English and unactionable.
    #[test]
    fn an_auth_failure_reaches_the_frontend_as_a_stable_code() {
        assert_eq!(
            String::from(classify(400, "Invalid token".into(), true)),
            TOKEN_REJECTED
        );
    }

    #[test]
    fn message_matching_ignores_case() {
        assert_eq!(verdict(400, "INVALID TOKEN", true), Verdict::Auth);
        assert_eq!(verdict(400, "the server said: invalid token", true), Verdict::Auth);
        assert_eq!(verdict(400, "UNAUTHORIZED.", true), Verdict::Ambiguous);
        assert_eq!(verdict(400, "token is fine, mediaId is not", true), Verdict::Api);
    }

    /// The ends of a range are where an off-by-one lives: 600 is not a status, 499 is a client error.
    #[test]
    fn only_real_server_errors_count_as_server_errors() {
        assert!(status_is_retryable(500));
        assert!(status_is_retryable(599));
        assert!(!status_is_retryable(499));
        assert!(!status_is_retryable(600));
    }

    /// A transport failure never reached AniList, so it is the most retryable case there is.
    #[test]
    fn a_network_error_is_retryable() {
        assert!(ApiError::Network("dns".into()).is_retryable());
    }

    /// The message reaches the UI verbatim for the server-side cases; only reqwest's own Display needs a prefix.
    #[test]
    fn only_transport_errors_are_prefixed() {
        assert_eq!(
            String::from(ApiError::Network("timed out".into())),
            "Network error: timed out"
        );
        assert_eq!(String::from(ApiError::Retryable("slow down".into())), "slow down");
        assert_eq!(String::from(ApiError::Api("validation".into())), "validation");
    }
}
