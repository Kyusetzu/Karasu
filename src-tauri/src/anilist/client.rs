use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::Mutex;
// Monotonic, so a user moving their clock cannot invent or erase a throttle.
use tokio::time::Instant;

const API_URL: &str = "https://graphql.anilist.co";

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
    Retryable(String),
    Api(String),
}

impl ApiError {
    /// Whether sending the same request later could plausibly succeed.
    pub fn is_retryable(&self) -> bool {
        matches!(self, ApiError::Network(_) | ApiError::Retryable(_))
    }
}

impl From<ApiError> for String {
    fn from(e: ApiError) -> Self {
        match e {
            ApiError::Network(m) => format!("Network error: {m}"),
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

fn classify(code: u16, msg: String) -> ApiError {
    if status_is_retryable(code) || message_is_retryable(&msg) {
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
            http: reqwest::Client::builder()
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
        }
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
            let nap = {
                let mut rate = self.rate.lock().await;
                let now = Instant::now();
                if rate.headroom(now) > RESERVE {
                    rate.claim();
                    None
                } else {
                    rate.park(SLICE, "preflight");
                    Some(SLICE)
                }
            };
            let Some(d) = nap else { break };
            if started.elapsed() >= MAX_PACE {
                // Bounded, and the request goes out anyway. See `MAX_PACE`.
                self.rate.lock().await.claim();
                break;
            }
            tokio::time::sleep(d).await;
        }

        for attempt in 0..2 {
            let mut req = self
                .http
                .post(API_URL)
                .json(&json!({ "query": query, "variables": variables }));
            if let Some(t) = token {
                req = req.bearer_auth(t);
            }

            let resp = req.send().await.map_err(|e| {
                // The status class only. Never the body and never the headers:
                // the request carries `Authorization: Bearer <token>` and the
                // response to a Jellyfin sign-in carries an access token, so a
                // logger that reached for either would be the leak this whole
                // module exists to prevent.
                crate::logging::warn("anilist", format!("request failed: {e}"));
                ApiError::Network(e.to_string())
            })?;

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
                tokio::time::sleep(Duration::from_secs(wait)).await;
                continue;
            }

            let status = resp.status().as_u16();
            let body: Value = resp
                .json()
                .await
                .map_err(|e| classify(status, format!("Unreadable response (HTTP {status}): {e}")))?;

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
                return Err(classify(
                    status,
                    if msg.is_empty() {
                        format!("AniList error (HTTP {status})")
                    } else {
                        msg
                    },
                ));
            }

            return body.get("data").cloned().ok_or_else(|| {
                classify(status, format!("Empty response from AniList (HTTP {status})"))
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

    /// The bug this file's classification was written for: every one of these
    /// used to be an `ApiError::Api`, and the offline queue deletes those.
    #[test]
    fn recoverable_failures_survive() {
        for code in [401, 403, 429, 500, 502, 503, 504] {
            assert!(
                classify(code, "whatever".into()).is_retryable(),
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
                !classify(code, "validation: {\"progress\":[\"invalid\"]}".into()).is_retryable(),
                "HTTP {code} with a validation message must be permanent"
            );
        }
    }

    /// AniList reports an expired token as HTTP 400 with the reason in the
    /// errors array, so the status alone would call it permanent and throw the
    /// write away. This is the one case the message has to decide.
    #[test]
    fn an_expired_token_is_read_out_of_the_message() {
        assert!(classify(400, "Invalid token".into()).is_retryable());
        assert!(classify(400, "Unauthorized".into()).is_retryable());
        assert!(classify(400, "Too Many Requests".into()).is_retryable());
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
        assert_eq!(String::from(ApiError::Retryable("Invalid token".into())), "Invalid token");
        assert_eq!(String::from(ApiError::Api("validation".into())), "validation");
    }
}
