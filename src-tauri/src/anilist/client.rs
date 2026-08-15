use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::Mutex;

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

struct RateState {
    /// Remaining requests according to the last X-RateLimit-Remaining header.
    remaining: u32,
}

impl AniList {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent(concat!("Karasu/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
            rate: Mutex::new(RateState { remaining: 30 }),
        }
    }

    pub async fn query(
        &self,
        token: Option<&str>,
        query: &str,
        variables: Value,
    ) -> Result<Value, ApiError> {
        // Keep a buffer: when almost nothing is left, take a short breather
        // instead of running into the 429.
        {
            let rate = self.rate.lock().await;
            if rate.remaining <= 1 {
                drop(rate);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
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

            if let Some(rem) = resp
                .headers()
                .get("x-ratelimit-remaining")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u32>().ok())
            {
                self.rate.lock().await.remaining = rem;
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
