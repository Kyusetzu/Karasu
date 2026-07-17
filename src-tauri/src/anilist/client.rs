use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::Mutex;

const API_URL: &str = "https://graphql.anilist.co";

/// GraphQL-Client für AniList mit zentralem Rate-Limiting.
///
/// AniList erlaubt nominell 90 Requests/Minute (derzeit serverseitig auf 30
/// gedrosselt). Wir werten die X-RateLimit-Header aus und pausieren, bevor
/// wir ins Limit laufen; auf 429 wird einmal mit Retry-After gewartet.
pub struct AniList {
    http: reqwest::Client,
    rate: Mutex<RateState>,
}

struct RateState {
    /// Verbleibende Requests laut letztem X-RateLimit-Remaining-Header.
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
    ) -> Result<Value, String> {
        // Puffer lassen: Wenn fast nichts mehr übrig ist, kurz durchatmen,
        // statt in den 429 zu laufen.
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
                .map_err(|e| format!("Netzwerkfehler: {e}"))?;

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
                .map_err(|e| format!("Antwort nicht lesbar (HTTP {status}): {e}"))?;

            if let Some(errors) = body.get("errors").and_then(|e| e.as_array()) {
                let msg = errors
                    .iter()
                    .filter_map(|e| e.get("message").and_then(|m| m.as_str()))
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(if msg.is_empty() {
                    format!("AniList-Fehler (HTTP {status})")
                } else {
                    msg
                });
            }

            return body
                .get("data")
                .cloned()
                .ok_or_else(|| format!("Leere Antwort von AniList (HTTP {status})"));
        }

        Err("AniList-Rate-Limit erreicht, bitte später erneut versuchen".into())
    }
}
