//! The on-disk cache behind the passthrough: an allowlist of sources with a longest life each, and the row key.

use sha2::{Digest, Sha256};

/// One allowlisted source and the longest TTL it may ask for, in seconds; a source not here is never stored.
pub const CACHEABLE: &[(&str, u32)] = &[
    ("mediaDetail", 30 * 60),
    ("seasonal", 6 * 3600),
    ("seasonHero", 6 * 3600),
    ("calendar", 24 * 3600),
    ("recommendations", 6 * 3600),
    ("franchise", 24 * 3600),
    ("person", 24 * 3600),
    ("cast", 7 * 24 * 3600),
    ("episodes", 7 * 24 * 3600),
    ("genreTags", 7 * 24 * 3600),
    ("userStats", 3600),
    ("trends", 3600),
    ("birthdays", 24 * 3600),
    ("mediaByIds", 24 * 3600),
    ("profile", 10 * 60),
];

/// Rows older than this go at startup whatever their TTL was, so an abandoned screen cannot keep a row forever.
pub const PRUNE_AFTER_SECS: i64 = 7 * 24 * 3600;

/// The TTL a request may use: the asked-for one, capped by the allowlist, or none for a source the list does not name.
pub fn allowed_ttl(source: &str, asked_secs: u32) -> Option<u32> {
    CACHEABLE
        .iter()
        .find(|(s, _)| *s == source)
        .map(|(_, cap)| asked_secs.min(*cap))
        .filter(|ttl| *ttl > 0)
}

/// The row key: source, query text, canonical variables and the viewer, so no account ever reads another's answer.
pub fn cache_key(source: &str, query: &str, variables: &serde_json::Value, viewer_id: i64) -> String {
    let mut h = Sha256::new();
    for part in [source, "\0", query, "\0", &variables.to_string(), "\0", &viewer_id.to_string()] {
        h.update(part.as_bytes());
    }
    format!("{:x}", h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The allowlist fails closed: an unlisted source gets no TTL, a listed one never more than its cap.
    #[test]
    fn an_unlisted_source_is_never_cached_and_a_listed_one_is_capped() {
        assert_eq!(allowed_ttl("feed", 60), None);
        assert_eq!(allowed_ttl("mediaDetail", 60), Some(60));
        assert_eq!(allowed_ttl("mediaDetail", 24 * 3600), Some(30 * 60));
        assert_eq!(allowed_ttl("genreTags", 0), None);
    }

    /// The key is stable for the same request and differs by viewer, so a shared machine cannot cross accounts.
    #[test]
    fn the_key_is_stable_and_viewer_scoped() {
        let vars = serde_json::json!({ "id": 1, "page": 2 });
        let a = cache_key("mediaDetail", "{ Media }", &vars, 7);
        assert_eq!(a, cache_key("mediaDetail", "{ Media }", &vars, 7));
        assert_ne!(a, cache_key("mediaDetail", "{ Media }", &vars, 8));
        assert_ne!(a, cache_key("seasonal", "{ Media }", &vars, 7));
        assert_ne!(a, cache_key("mediaDetail", "{ Media }", &serde_json::json!({ "id": 2, "page": 2 }), 7));
        assert_eq!(a.len(), 64);
    }
}
