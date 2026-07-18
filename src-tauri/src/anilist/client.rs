use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::Mutex;

const API_URL: &str = "https://graphql.anilist.co";

/// Network errors (offline, timeout) are queueable, API errors are not.
#[derive(Debug)]
pub enum ApiError {
    Network(String),
    Api(String),
}

impl From<ApiError> for String {
    fn from(e: ApiError) -> Self {
        match e {
            ApiError::Network(m) => format!("Network error: {m}"),
            ApiError::Api(m) => m,
        }
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

            let resp = req
                .send()
                .await
                .map_err(|e| ApiError::Network(e.to_string()))?;

            if let Some(rem) = resp
                .headers()
                .get("x-ratelimit-remaining")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u32>().ok())
            {
                self.rate.lock().await.remaining = rem;
            }

            if resp.status().as_u16() == 429 && attempt == 0 {
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

            let status = resp.status();
            let body: Value = resp
                .json()
                .await
                .map_err(|e| ApiError::Api(format!("Unreadable response (HTTP {status}): {e}")))?;

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
                return Err(ApiError::Api(if msg.is_empty() {
                    format!("AniList error (HTTP {status})")
                } else {
                    msg
                }));
            }

            return body
                .get("data")
                .cloned()
                .ok_or_else(|| ApiError::Api(format!("Empty response from AniList (HTTP {status})")));
        }

        Err(ApiError::Api(
            "AniList rate limit reached, please try again later".into(),
        ))
    }
}
