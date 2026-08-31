use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;
// Monotonic, so a user moving their clock cannot invent or erase a throttle.
use tokio::time::Instant;

const API_URL: &str = "https://graphql.anilist.co";

/// How many recent requests the sync panel can show.
///
/// Bounded because this is an in-memory ring on the hot path of every AniList
/// call, and because a panel is for glancing at. Fifty covers a page load and
/// its retries several times over.
const LOG_CAP: usize = 50;

/// The root field a query asks for — `Media`, `Page`, `SaveMediaListEntry`.
///
/// **The query text and nothing else.** Every query in this tree is a compile
/// -time constant, so naming one leaks nothing; the *variables* carry notes, a
/// score and sometimes a Jellyfin password, and they are never touched here.
/// That is the same rule `logging::scrub` exists to enforce elsewhere.
///
/// AniList's operations are anonymous (`query ($id: Int!) { … }`), so there is
/// no operation name to read — the first root selection is the informative part
/// anyway, since it is what the request is *for*.
fn operation_name(query: &str) -> String {
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
    // First identifier in the selection, and if it is an alias (`a: Thread`)
    // take what it aliases — `FOLLOW_COUNTS_QUERY` aliases two `Page` roots and
    // "a" would say nothing.
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

/// How a failed request should be treated by anything holding an unsent write.
///
/// `Network` is a transport failure — offline, DNS, timeout — where the request
/// never reached AniList at all. `Retryable` did reach it and came back with an
/// answer about the *connection*: rate limiting, a server fault, a token that
/// has expired. `Api` is AniList rejecting **this payload**, which no amount of
/// waiting will fix.
///
/// The split exists because the offline queue acts on it: a queued edit is kept
/// for the first two and dropped for the third. Until the classification below
/// was written this enum had no middle case, so an expired token and a 429 that
/// outlived the single retry both arrived as `Api` — and `process_queue`
/// deleted the user's edits on the strength of it.
#[derive(Debug)]
pub enum ApiError {
    Network(String),
    /// AniList rejected the *token*, not the payload.
    ///
    /// Split out of `Retryable` because the two need opposite handling on
    /// screen while needing the same handling in the queue. A 429 is "wait";
    /// this is "nothing will change until you sign in again", and rendering it
    /// as one more load failure is what made a dead token look like the app
    /// randomly breaking. The queued write is still perfectly good — it is the
    /// credential that went stale — so `is_retryable` still holds.
    Auth(String),
    Retryable(String),
    Api(String),
}

/// What the frontend gets for an `Auth` failure. `lib/backendError.ts` turns it
/// into a sentence; `stores/auth` turns it into one banner for the whole app.
pub const TOKEN_REJECTED: &str = "anilist.tokenRejected";

/// Whether the current run of rejections has already been logged.
///
/// Cleared by the next success, so a *later* rejection is reported rather than
/// swallowed as a repeat of one the user has already dealt with.
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
            // A stable code rather than AniList's wording. "Invalid token" is
            // English, is not actionable, and was rendered raw into
            // "Failed to load: Invalid token" on every screen at once.
            ApiError::Auth(_) => TOKEN_REJECTED.into(),
            ApiError::Retryable(m) | ApiError::Api(m) => m,
        }
    }
}

/// HTTP statuses that mean "not now" rather than "not ever".
///
/// A 429 reaching this point has already outlived the one retry below. 401 and
/// 403 are about the token rather than the payload, so a re-sign-in fixes them
/// and the write is still good. 5xx is AniList being down.
fn status_is_retryable(code: u16) -> bool {
    matches!(code, 401 | 403 | 429) || (500..600).contains(&code)
}

/// AniList answers a bad token with HTTP 400 and the reason in the `errors`
/// array, so the status alone cannot classify every recoverable failure.
///
/// The set is deliberately tiny. Everything else the server says about a
/// payload is permanent, and guessing the other way is not free: a row wrongly
/// called retryable stays in the queue forever and blocks every edit behind it.
fn message_is_retryable(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    m.contains("invalid token") || m.contains("unauthorized") || m.contains("too many requests")
}

/// The token rather than the payload or the pace.
///
/// Checked *before* the retryable set, which also claims 401 and 403 — order is
/// the whole distinction. "too many requests" is deliberately absent: a 429 is
/// about how fast we asked, and calling it an auth failure would sign the user
/// out for being busy.
fn is_auth_failure(code: u16, msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    matches!(code, 401 | 403) || m.contains("invalid token") || m.contains("unauthorized")
}

/// `sent_token` is what keeps "your session expired" honest. A request that
/// carried no bearer cannot have had its token rejected — yet a Cloudflare or
/// captive-portal 403 in front of graphql.anilist.co matches the same status
/// check, and used to sign the message "token rejected" to a user who never
/// had a token. Tokenless auth-shaped failures are retryable network weather
/// instead.
/// The stable code a rate-limited request answers with.
///
/// A code rather than the server's sentence, for the reason `TOKEN_REJECTED`
/// is one: the frontend has to *recognise* this class to stop retrying it, and
/// matching on prose would mean re-implementing `message_is_retryable` in
/// TypeScript — the same rule in two languages, free to drift.
/// `lib/backendError.ts` turns it into a sentence.
pub const RATE_LIMITED: &str = "anilist.rateLimited";

fn classify(code: u16, msg: String, sent_token: bool) -> ApiError {
    // 429 is the one retryable class worth naming: it is the only one the
    // frontend must not spend a second round trip on, because the answer is
    // guaranteed to be the same until the window rolls.
    if code == 429 {
        crate::logging::debug("anilist", format!("rate limited: {msg}"));
        return ApiError::Retryable(RATE_LIMITED.into());
    }
    if is_auth_failure(code, &msg) {
        if sent_token {
            ApiError::Auth(msg)
        } else {
            ApiError::Retryable(msg)
        }
    } else if status_is_retryable(code) || message_is_retryable(&msg) {
        ApiError::Retryable(msg)
    } else {
        ApiError::Api(msg)
    }
}

/// GraphQL client for AniList with centralized rate limiting.
///
/// AniList nominally allows 90 requests/minute (currently throttled to 30
/// server-side). We track the X-RateLimit headers and pause before running
/// into the limit; on a 429 we wait once for Retry-After.
pub struct AniList {
    http: reqwest::Client,
    rate: Mutex<RateState>,
    /// The recent-traffic ring behind the sync panel. See `LOG_CAP`.
    ///
    /// In memory only — it is never written to `karasu.log` and never leaves the
    /// process except through `rate_snapshot`'s sibling command. A panel that
    /// said "28 of 30" with nothing to attribute it to was the complaint this
    /// answers: the number moved and there was no way to see what moved it.
    log: Mutex<VecDeque<Recorded>>,
}

/// One finished request, stored with a monotonic instant so its age is computed
/// at read time rather than frozen at write time.
struct Recorded {
    seq: u64,
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
    /// The root field asked for. Never the variables — see `operation_name`.
    pub operation: String,
    #[serde(rename = "startedAgoMs")]
    pub started_ago_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    /// How long this request waited on the client's own pacing before going
    /// out. Separate from `durationMs` on purpose: self-inflicted delay and
    /// AniList being slow are different problems with different fixes.
    #[serde(rename = "pacedMs")]
    pub paced_ms: u64,
    pub status: Option<u16>,
    #[serde(rename = "remainingAfter")]
    pub remaining_after: Option<u32>,
    /// `"ok" | "throttled" | "error"`.
    pub outcome: &'static str,
}

/// The budget assumed before any header has been seen.
///
/// A guess, not a measurement — `observed` is what separates the two. Worth
/// knowing when reading the panel: a cold client's *first* response reports
/// `x-ratelimit-remaining: 28` of a limit of 30, measured twice against the live
/// API 70 s apart. AniList never reports 29 or 30, so "28 while idle" is its
/// accounting rather than two requests Karasu spent.
const SEED: u32 = 30;

/// Requests held in reserve before the client starts pacing itself.
///
/// Not 1. At a threshold of one the guard engages only when the next request is
/// already the last one available, which is far too late to avoid the 429 it
/// exists to avoid.
const RESERVE: u32 = 2;

/// AniList's accounting window.
///
/// Load-bearing, because `remaining` is otherwise a number that only ever falls:
/// it is assigned from a response header and from nothing else. One response
/// reporting 0 used to pin the limiter at 0 for the life of the process, and
/// every later request then paid the pre-flight nap for nothing — while the only
/// way to learn a better number was to send a request, which napped first. That
/// was the whole of the "everything is slow" bug.
const WINDOW: Duration = Duration::from_secs(60);

/// One pacing slice. Short on purpose: the point is to re-check, not to sleep.
/// The window rolls continuously, so the budget can return at any moment.
const SLICE: Duration = Duration::from_millis(400);

/// The longest one caller paces before sending regardless.
///
/// Sending into a 429 costs a `Retry-After`; stalling costs the whole screen,
/// with nothing on it to explain why. The 429 path is a backstop and a better
/// one than an app that never answers, so the self-imposed wait is bounded and
/// the server's own instruction is not.
const MAX_PACE: Duration = Duration::from_secs(5);

struct RateState {
    /// The working count: assigned from `x-ratelimit-remaining`, decremented by
    /// `claim` for requests in flight, and reset by `headroom` when the window
    /// has rolled.
    remaining: u32,
    /// `x-ratelimit-limit`. AniList sends it — verified against the live API —
    /// and it was read by nothing until the sync panel needed a denominator.
    limit: Option<u32>,
    /// When a header last landed. `None` means `remaining` is still the *seed*
    /// below, which is a guess rather than a measurement — a panel rendering
    /// "30 left" off it would be inventing data.
    observed: Option<Instant>,
    /// The monotonic deadline this client is deliberately not sending until.
    ///
    /// **Nothing ever clears it, and it only ever moves forward.** Both rules
    /// are load-bearing:
    ///
    /// - Clearing would need task identity. One client is shared by the
    ///   scrobbler, three alert passes, `identify.rs` and every passthrough, so
    ///   a 5s pre-flight nap waking up and clearing the flag while another task
    ///   is 90s into a `Retry-After` would report the client as free while it is
    ///   parked. And a future dropped mid-sleep would leave it stuck for the
    ///   life of the process. An expiring deadline needs no cleanup path at all.
    /// - Without the forward-only rule, a 5s nap beginning during a 120s
    ///   `Retry-After` would shorten the reported wait to 5s.
    sleeping_until: Option<Instant>,
    /// `"preflight" | "retryAfter"`, replaced only together with the deadline.
    ///
    /// **These exact strings are the contract with the panel.** `SyncPanel`
    /// branches on them to tell "the app is pacing itself" from "AniList refused
    /// us", which is the whole reason the field exists — and it compared against
    /// `"retry-after"` for a release, so every real 429 rendered as self-pacing.
    sleeping_kind: Option<&'static str>,
    /// When the limiter last reset its own count because `WINDOW` had elapsed.
    ///
    /// Deliberately *not* `observed`. That one means a header landed and is what
    /// the panel reports the age of; folding a local reset into it would render
    /// a guess as a fresh measurement, which is the one thing the headroom
    /// display must not do.
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
    /// Parks until at least `d` from now. See the field docs for the two rules.
    fn park(&mut self, d: Duration, kind: &'static str) {
        let until = Instant::now() + d;
        if self.sleeping_until.is_none_or(|t| until > t) {
            self.sleeping_until = Some(until);
            self.sleeping_kind = Some(kind);
        }
    }

    /// How much longer this client will not send, or `None`. A deadline in the
    /// past is simply not a throttle, which is what makes never clearing safe.
    fn throttled_for(&self, now: Instant) -> Option<Duration> {
        self.sleeping_until
            .filter(|t| *t > now)
            .map(|t| t.duration_since(now))
    }

    /// The last moment `remaining` meant anything — a header landing, or a local
    /// reset once the window rolled.
    fn counted_at(&self) -> Option<Instant> {
        match (self.observed, self.reset_at) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        }
    }

    /// What is available *now*, healing a count that belongs to a window which
    /// has since rolled.
    ///
    /// `&mut` because it repairs rather than merely reports: a stale count is
    /// not evidence of a low budget, it is the absence of evidence, and the old
    /// code treated the two as the same thing.
    fn headroom(&mut self, now: Instant) -> u32 {
        if self.counted_at().is_none_or(|t| now.duration_since(t) >= WINDOW) {
            self.remaining = self.limit.unwrap_or(SEED);
            self.reset_at = Some(now);
        }
        self.remaining
    }

    /// Books a request against the budget before it goes out.
    ///
    /// Without this the limiter is blind to its own in-flight work: `remaining`
    /// was only ever assigned from a response header, so a burst of concurrent
    /// callers all read the same pre-burst value, all cleared the guard, and all
    /// arrived together — which is how a 429 was earned while the panel showed
    /// comfortable headroom. The header stays authoritative when it lands; this
    /// only covers the gap between sending and hearing back.
    fn claim(&mut self) {
        self.remaining = self.remaining.saturating_sub(1);
    }
}

/// What the sync panel shows about the limiter. Local state only — reading it
/// costs no AniList request.
#[derive(serde::Serialize)]
pub struct RateSnapshot {
    /// `None` until a response header has been seen this session.
    pub remaining: Option<u32>,
    pub limit: Option<u32>,
    #[serde(rename = "observedAgoMs")]
    pub observed_ago_ms: Option<u64>,
    /// **Independent of `remaining`, never derived from it.** If AniList omits
    /// `x-ratelimit-remaining` on a 429, `remaining` keeps its stale pre-429
    /// value — a panel branching on that would show comfortable headroom while
    /// the client is parked for two minutes. This is the signal to branch on.
    #[serde(rename = "throttledForMs")]
    pub throttled_for_ms: Option<u64>,
    #[serde(rename = "throttleKind")]
    pub throttle_kind: Option<&'static str>,
}

impl AniList {
    pub fn new() -> Self {
        Self {
            http: crate::net::client_builder()
                .user_agent(concat!("Karasu/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
            // 30 is the documented limit and matches what the live API
            // reports, but it is a seed rather than an observation — see
            // `observed`.
            rate: Mutex::new(RateState {
                remaining: SEED,
                limit: None,
                observed: None,
                sleeping_until: None,
                sleeping_kind: None,
                reset_at: None,
            }),
            log: Mutex::new(VecDeque::with_capacity(LOG_CAP)),
        }
    }

    /// Appends one finished request, evicting the oldest past `LOG_CAP`.
    #[allow(clippy::too_many_arguments)]
    async fn record(
        &self,
        operation: &str,
        at: Instant,
        paced: Duration,
        status: Option<u16>,
        remaining_after: Option<u32>,
        outcome: &'static str,
    ) {
        let mut log = self.log.lock().await;
        let seq = log.back().map_or(0, |r: &Recorded| r.seq) + 1;
        if log.len() >= LOG_CAP {
            log.pop_front();
        }
        log.push_back(Recorded {
            seq,
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

    /// A snapshot of the limiter for the sync panel.
    ///
    /// `rate` is a `tokio::sync::Mutex`, so this is async by construction. The
    /// lock is never held across a network await, so a poller cannot delay a
    /// request — but it is on the hot path of every AniList call in the app, so
    /// this stays a short read and nothing more.
    pub async fn rate_snapshot(&self) -> RateSnapshot {
        let now = Instant::now();
        let rate = self.rate.lock().await;
        RateSnapshot {
            // Gated on `observed`: without a header this is the seed, and
            // reporting a guess as a measurement is the one thing a headroom
            // display must not do.
            remaining: rate.observed.map(|_| rate.remaining),
            limit: rate.limit,
            observed_ago_ms: rate
                .observed
                .map(|t| now.duration_since(t).as_millis() as u64),
            throttled_for_ms: rate.throttled_for(now).map(|d| d.as_millis() as u64),
            throttle_kind: rate.throttled_for(now).and(rate.sleeping_kind),
        }
    }

    pub async fn query(
        &self,
        token: Option<&str>,
        query: &str,
        variables: Value,
    ) -> Result<Value, ApiError> {
        // Pace into the budget rather than run into the 429, then book the
        // request before sending it.
        //
        // Each decision and its `park` are one critical section on purpose: the
        // original dropped the lock and *then* slept, leaving a window in which
        // the client was about to nap and every reader saw it as clear.
        //
        // The loop is the fix for the bug this used to have. It slept a flat 5 s
        // and then sent unconditionally, decrementing nothing and re-checking
        // nothing — so once any response reported a low count, every request for
        // the rest of the session paid 5 s up front, and the only way to learn a
        // better number was to send a request, which napped first. Re-checking in
        // short slices means the wait ends the moment the budget returns; the
        // `claim` means a burst can see itself; and `headroom` heals a count left
        // over from a window that has since rolled.
        let started = Instant::now();
        loop {
            // Two different reasons to wait, and only one of them is ours.
            let wait = {
                let mut rate = self.rate.lock().await;
                let now = Instant::now();
                if let Some(left) = rate.throttled_for(now) {
                    // A deadline the *server* set, from a `Retry-After` we were
                    // given. It used to be recorded and never read here, so
                    // every other caller on this shared client kept sending
                    // into a window AniList had already closed — earning more
                    // 429s, each with a longer deadline than the last.
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
                // `MAX_PACE` bounds our *own* pacing: stalling a screen for
                // longer than that costs more than the 429 it avoids. It does
                // not apply to a server deadline, which is not ours to shorten
                // and where sending early is a guaranteed rejection.
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
        // Recorded per request so the panel can separate our own pacing from
        // AniList being slow. They look identical from the outside and have
        // completely different fixes.
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
                    // The status class only. Never the body and never the
                    // headers: the request carries `Authorization: Bearer
                    // <token>` and the response to a Jellyfin sign-in carries an
                    // access token, so a logger that reached for either would be
                    // the leak this whole module exists to prevent.
                    crate::logging::warn("anilist", format!("request failed: {e}"));
                    self.record(&operation, sent, paced, None, None, "error").await;
                    return Err(ApiError::Network(e.to_string()));
                }
            };

            // One line when it changes, so a device log can prove which
            // protocol the TLS handshake actually negotiated — the Android
            // ALPN regression (net.rs) was invisible without it.
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
                    // Authoritative: it overwrites whatever `claim` guessed, and
                    // it retires the local reset — otherwise `counted_at` would
                    // keep answering with a stale repair that is now older than
                    // the measurement standing beside it.
                    rate.remaining = rem;
                    rate.observed = Some(Instant::now());
                    rate.reset_at = None;
                }
                if let Some(l) = limit {
                    rate.limit = Some(l);
                }
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
                self.rate
                    .lock()
                    .await
                    .park(Duration::from_secs(wait), "retryAfter");
                self.record(&operation, sent, paced, Some(429), remaining, "throttled")
                    .await;
                tokio::time::sleep(Duration::from_secs(wait)).await;
                continue;
            }

            let status = resp.status().as_u16();
            let body: Value = match resp.json::<Value>().await {
                Ok(b) => b,
                Err(e) => {
                    self.record(&operation, sent, paced, Some(status), remaining, "error")
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
                self.record(&operation, sent, paced, Some(status), remaining, "error")
                    .await;
                let err = classify(
                    status,
                    if msg.is_empty() {
                        format!("AniList error (HTTP {status})")
                    } else {
                        msg
                    },
                    token.is_some(),
                );
                // The status and AniList's own wording, once per transition.
                // A screen fires several queries, so an unguarded warn would
                // write the same line a dozen times and rotate the interesting
                // part of a 1 MB log off disk — the `debug_changed` lesson.
                // Never the header and never the body: the request carries the
                // bearer token this whole module exists to keep in Rust.
                if let ApiError::Auth(ref reason) = err {
                    if !AUTH_REPORTED.swap(true, Ordering::Relaxed) {
                        crate::logging::warn(
                            "anilist",
                            format!("token rejected (HTTP {status}): {reason}"),
                        );
                    }
                }
                return Err(err);
            }

            let data = body.get("data").cloned();
            if data.is_some() {
                // Armed again, so a *later* rejection is logged rather than
                // swallowed as a repeat of one the user has already fixed.
                AUTH_REPORTED.store(false, Ordering::Relaxed);
            }
            self.record(
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

    /// A deadline in the past is not a throttle. This is what makes "nothing
    /// ever clears it" safe — there is no cleanup path to get wrong.
    /// The deadline was recorded and never consulted, so every other caller on
    /// this shared client kept sending into a window AniList had closed —
    /// earning further 429s, each with a longer deadline than the last.
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

    /// 429 answers with a stable code rather than the server's prose, so the
    /// frontend can recognise the class without re-implementing
    /// `message_is_retryable` in TypeScript.
    #[test]
    fn a_rate_limit_is_named_not_described() {
        let e = classify(429, "Too Many Requests".into(), true);
        assert!(matches!(e, ApiError::Retryable(ref m) if m == RATE_LIMITED));
        assert!(e.is_retryable(), "and it still keeps a queued edit");
    }

    /// A tokenless 429 is the same class: the code says what happened, and
    /// `sent_token` only ever decides auth-shaped failures.
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

    /// The concurrency bug the forward-only rule exists for.
    ///
    /// One client is shared by the scrobbler, three alert passes, `identify.rs`
    /// and every passthrough. A 5s pre-flight nap beginning while another task
    /// is most of the way through a 120s `Retry-After` must not shorten the
    /// reported wait to 5s.
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

    /// The seeded 30 is a guess. Reporting it as a measurement would draw a
    /// full headroom bar for a session that has not sent a single request.
    #[tokio::test]
    async fn headroom_is_unknown_until_a_header_lands() {
        let api = AniList::new();
        let snap = api.rate_snapshot().await;
        assert_eq!(snap.remaining, None);
        assert_eq!(snap.limit, None);
        assert_eq!(snap.observed_ago_ms, None);
        assert_eq!(snap.throttled_for_ms, None);
    }

    /// **The sticky-nap bug.** `remaining` is only ever assigned from a response
    /// header, so one response reporting 0 used to pin the limiter at 0 for the
    /// life of the process — every later request paying a flat 5 s for nothing,
    /// while the only way to learn a better number was to send a request, which
    /// napped first. A count belonging to a window that has since rolled is the
    /// absence of evidence, not evidence of a low budget.
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

    /// A limiter that never sees its own in-flight work lets a burst through:
    /// every caller reads the same pre-burst value, every one clears the guard,
    /// and they all arrive together — earning a 429 while the panel showed
    /// comfortable headroom.
    #[test]
    fn a_claim_is_visible_to_the_next_caller() {
        let now = Instant::now();
        let mut r = fresh();
        let before = r.headroom(now);
        r.claim();
        assert_eq!(r.headroom(now), before - 1, "the next caller sees it");
    }

    /// Saturating, because the count is `u32` and a burst can outrun the budget.
    /// An underflow here would wrap to ~4 billion and disable pacing entirely.
    #[test]
    fn claiming_past_empty_stops_at_zero() {
        let mut r = fresh();
        r.remaining = 1;
        r.claim();
        r.claim();
        r.claim();
        assert_eq!(r.remaining, 0);
    }

    /// A local repair is not a measurement. The panel gates its headroom display
    /// on `observed` precisely to keep the two apart, so `headroom` healing a
    /// stale count must not make the seed look like something AniList said.
    #[tokio::test]
    async fn healing_the_count_does_not_fake_an_observation() {
        let now = Instant::now();
        let mut r = fresh();
        r.headroom(now);
        assert!(r.reset_at.is_some(), "it did repair");
        assert!(r.observed.is_none(), "but nothing was measured");
    }

    /// The exact strings `SyncPanel` branches on. It compared against
    /// `"retry-after"` for a release while this side emitted `"retryAfter"`, so
    /// every genuine 429 rendered as the app pacing itself — the one distinction
    /// the field exists to draw.
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

    /// The reserve has to leave room to act on. At a threshold of one the guard
    /// engages only when the next request is already the last one available.
    #[test]
    fn the_reserve_is_more_than_the_last_request() {
        assert!(RESERVE > 1, "a threshold of 1 is too late to be a guard");
        assert!(MAX_PACE < WINDOW, "a caller must not wait out a whole window");
        assert!(SLICE < MAX_PACE, "the point of a slice is to re-check");
    }

    /// The panel's whole point is attribution: "28 of 30" with nothing to
    /// attribute it to was the complaint. So the name has to be the root field
    /// the request is *for*, read past the variable list — the `(` and `)` of
    /// `query ($id: Int!)` contain no selection set.
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

    /// `FOLLOW_COUNTS_QUERY` aliases two `Page` roots, and a row reading "a"
    /// would say nothing at all.
    #[test]
    fn an_alias_is_reported_as_what_it_aliases() {
        assert_eq!(
            operation_name("query { followers: Page(page: 1) { pageInfo { total } } }"),
            "Page"
        );
    }

    /// Never a panic and never a variable. Anything unrecognisable degrades to
    /// a generic label rather than reaching for the payload for a better one.
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
        let api = AniList::new();
        let now = Instant::now();
        for _ in 0..(LOG_CAP + 10) {
            api.record("Media", now, Duration::ZERO, Some(200), Some(28), "ok")
                .await;
        }
        let rows = api.request_log().await;
        assert_eq!(rows.len(), LOG_CAP, "capped");
        assert!(rows[0].seq > rows[1].seq, "newest first");
        // The eviction is from the front, so the oldest sequence numbers went.
        assert_eq!(rows[0].seq, (LOG_CAP + 10) as u64);
    }

    /// The bug this file's classification was written for: every one of these
    /// used to be an `ApiError::Api`, and the offline queue deletes those.
    #[test]
    fn recoverable_failures_survive() {
        for code in [401, 403, 429, 500, 502, 503, 504] {
            assert!(
                classify(code, "whatever".into(), true).is_retryable(),
                "HTTP {code} must be retryable"
            );
        }
    }

    /// The other half: a payload AniList will refuse for as long as it exists
    /// has to be droppable, or one bad row wedges every edit queued behind it.
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

    /// AniList reports an expired token as HTTP 400 with the reason in the
    /// errors array, so the status alone would call it permanent and throw the
    /// write away. This is the one case the message has to decide.
    #[test]
    fn an_expired_token_is_read_out_of_the_message() {
        assert!(classify(400, "Invalid token".into(), true).is_retryable());
        assert!(classify(400, "Unauthorized".into(), true).is_retryable());
        // A request that carried no bearer cannot have had its token
        // rejected: a proxy or Cloudflare 403 on a tokenless request is
        // weather, not a sign-out.
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

    /// The split this commit exists for. Both keep a queued edit — the write is
    /// good either way, it is the credential that went stale — but only one of
    /// them means "nothing will change until you sign in again".
    #[test]
    fn a_rejected_token_is_not_the_same_as_a_busy_server() {
        for (code, msg) in [(400, "Invalid token"), (401, "nope"), (403, "nope")] {
            assert!(
                matches!(classify(code, msg.into(), true), ApiError::Auth(_)),
                "HTTP {code} / {msg:?} is an auth failure"
            );
        }
        // A 429 is about how fast we asked. Calling it an auth failure would
        // sign the user out for being busy.
        for (code, msg) in [(429, "Too Many Requests."), (400, "Too Many Requests")] {
            assert!(
                matches!(classify(code, msg.into(), true), ApiError::Retryable(_)),
                "HTTP {code} / {msg:?} is pace, not auth"
            );
        }
        // And a payload AniList refuses stays permanent, or one bad row wedges
        // every edit behind it.
        assert!(matches!(
            classify(400, "validation: {\"progress\":[\"invalid\"]}".into(), true),
            ApiError::Api(_)
        ));
    }

    /// Every auth failure has to keep its queued write. The queue drops `Api`.
    #[test]
    fn a_rejected_token_never_drops_an_edit() {
        assert!(classify(401, "Invalid token".into(), true).is_retryable());
    }

    /// The frontend branches on this exact code, and AniList's own wording is
    /// English, unactionable, and was rendered raw on every screen at once.
    #[test]
    fn an_auth_failure_reaches_the_frontend_as_a_stable_code() {
        assert_eq!(
            String::from(classify(400, "Invalid token".into(), true)),
            TOKEN_REJECTED
        );
    }

    #[test]
    fn message_matching_ignores_case() {
        assert!(message_is_retryable("INVALID TOKEN"));
        assert!(message_is_retryable("the server said: invalid token"));
        assert!(!message_is_retryable("token is fine, mediaId is not"));
    }

    /// `status_is_retryable` is a range check, and the ends of a range are
    /// where an off-by-one lives. 600 is not a status; 499 is a client error.
    #[test]
    fn only_real_server_errors_count_as_server_errors() {
        assert!(status_is_retryable(500));
        assert!(status_is_retryable(599));
        assert!(!status_is_retryable(499));
        assert!(!status_is_retryable(600));
    }

    /// A transport failure never reached AniList, so nothing about the payload
    /// has been judged yet — it is the most retryable case there is.
    #[test]
    fn a_network_error_is_retryable() {
        assert!(ApiError::Network("dns".into()).is_retryable());
    }

    /// The message reaches the UI verbatim for the two server-side cases; only
    /// reqwest's own Display is technical enough to need a prefix.
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
