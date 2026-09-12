//! Asks AniList about the titles a scan could not place, scored by the same matcher the local path uses.

use crate::anilist::client::AniList;
use crate::playback::recognition::{matcher, parser::Parsed};
use serde_json::Value;

/// Titles per request; leaves headroom for long titles and their synonyms without adding many requests.
const PER_REQUEST: usize = 25;

/// Requests one scan may spend identifying, so an off-list folder cannot eat the shared rate budget.
const MAX_BATCHES: usize = 8;

/// Titles one scan may ask about; the caller rotates through them so the cap is a window, not a prefix.
pub const MAX_TITLES: usize = PER_REQUEST * MAX_BATCHES;

/// One title a scan could not place.
pub struct Unidentified {
    pub title: String,
    pub season: i32,
}

/// AniList's answer, above the matcher's own threshold.
pub struct Suggestion {
    pub title: String,
    pub season: i32,
    pub media_id: i64,
    pub score: f64,
}

/// Aliased `Page` searches, one per title: a bare `Media` miss is an error that would take the whole batch down.
fn batch_query(batch: &[&Unidentified]) -> String {
    let mut q = String::from("query {\n");
    for (i, item) in batch.iter().enumerate() {
        // The normalized title is the only interpolation, and no quote survives `normalize` to break the literal.
        let safe = matcher::normalize(&item.title);
        q.push_str(&format!(
            "  m{i}: Page(perPage: 1) {{ media(search: \"{safe}\", type: ANIME) \
             {{ id title {{ romaji english native }} synonyms episodes }} }}\n"
        ));
    }
    q.push('}');
    q
}

/// Reads one alias's media into a matcher candidate.
fn candidate_from(node: &Value) -> Option<matcher::Candidate> {
    let media_id = node.get("id")?.as_i64()?;
    let mut titles = Vec::new();
    for key in ["romaji", "english", "native"] {
        if let Some(t) = node.pointer(&format!("/title/{key}")).and_then(|v| v.as_str()) {
            titles.push(t.to_string());
        }
    }
    for syn in node.get("synonyms").and_then(|v| v.as_array()).into_iter().flatten() {
        if let Some(s) = syn.as_str() {
            titles.push(s.to_string());
        }
    }
    if titles.is_empty() {
        return None;
    }
    Some(matcher::Candidate {
        media_id,
        titles,
        episodes: node.get("episodes").and_then(|v| v.as_u64()).map(|n| n as u32),
        duration_min: None,
        // Nothing downstream of the identify pass renders a presence card, so there is no cover to carry.
        cover_url: None,
        progress: 0,
        status: String::new(),
    })
}

/// Scores one hit with `best_match` instead of trusting AniList's ranking, which may put a spin-off first.
fn score(item: &Unidentified, node: &Value) -> Option<Suggestion> {
    let candidate = candidate_from(node)?;
    let parsed = Parsed {
        title: item.title.clone(),
        episode: None,
        episode_marked: false,
        season: if item.season < 0 { None } else { Some(item.season as u32) },
        release_group: None,
    };
    let m = matcher::best_match(&parsed, &[candidate])?;
    Some(Suggestion {
        title: item.title.clone(),
        season: item.season,
        media_id: m.media_id,
        score: m.score,
    })
}

/// Asks AniList in bounded batches; a failed batch ends the pass, not the scan, since the rest would fail alike.
pub async fn identify(
    api: &AniList,
    token: Option<&str>,
    items: &[Unidentified],
) -> Vec<Suggestion> {
    let mut out = Vec::new();
    for batch in items.chunks(PER_REQUEST).take(MAX_BATCHES) {
        let refs: Vec<&Unidentified> = batch.iter().collect();
        let Ok(data) = api
            .query(token, &batch_query(&refs), serde_json::json!({}))
            .await
        else {
            break;
        };
        for (i, item) in refs.iter().enumerate() {
            let Some(node) = data
                .pointer(&format!("/m{i}/media/0"))
            else {
                continue;
            };
            if let Some(s) = score(item, node) {
                out.push(s);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(title: &str, season: i32) -> Unidentified {
        Unidentified { title: title.into(), season }
    }

    /// Proves successive rotate-then-cap scans reach every title, so junk at the front cannot starve the rest.
    #[test]
    fn successive_scans_ask_about_every_unplaced_title() {
        let total = MAX_TITLES + MAX_TITLES / 2;
        let mut seen = std::collections::HashSet::new();
        let mut cursor = 0usize;
        for _ in 0..3 {
            let mut queue: Vec<usize> = (0..total).collect();
            queue.rotate_left(cursor % total);
            let asked = MAX_TITLES.min(total);
            seen.extend(queue.iter().take(asked).copied());
            cursor = (cursor + asked) % total;
        }
        assert_eq!(seen.len(), total, "a title must not be starved by the cap");
    }

    /// Proves every alias is a `Page`, since a bare `Media` miss would take the whole batch down with it.
    #[test]
    fn the_query_uses_page_so_one_miss_cannot_fail_the_batch() {
        let items = [item("Hunter x Hunter", -1), item("Digimon", 1)];
        let refs: Vec<&Unidentified> = items.iter().collect();
        let q = batch_query(&refs);
        assert_eq!(q.matches("Page(perPage: 1)").count(), 2);
        assert!(!q.contains("Media(search"));
        assert!(q.contains("m0:") && q.contains("m1:"));
    }

    /// Proves titles reach the query normalized, so nothing in a release name can terminate the literal.
    #[test]
    fn a_quote_in_a_title_cannot_escape_the_query() {
        let items = [item("Kimi \" no \" Na wa", -1)];
        let refs: Vec<&Unidentified> = items.iter().collect();
        let q = batch_query(&refs);
        assert!(q.contains("kimi no na wa"), "{q}");
        // Exactly the two quotes this alias's own literal needs.
        assert_eq!(q.matches('"').count(), 2);
    }

    #[test]
    fn a_confident_hit_becomes_a_suggestion() {
        let node = json!({
            "id": 136,
            "title": { "romaji": "HUNTER×HUNTER", "english": "Hunter x Hunter", "native": null },
            "synonyms": [],
            "episodes": 62
        });
        let s = score(&item("Hunter x Hunter", -1), &node).expect("should suggest");
        assert_eq!(s.media_id, 136);
        assert_eq!(s.score, 1.0, "an exact title is the short circuit, not a score");
    }

    /// Proves an unrelated search result produces no suggestion rather than a confident wrong answer.
    #[test]
    fn an_unrelated_result_is_not_a_suggestion() {
        let node = json!({
            "id": 999,
            "title": { "romaji": "Completely Different Show", "english": null, "native": null },
            "synonyms": [],
            "episodes": 12
        });
        assert!(score(&item("Hunter x Hunter", -1), &node).is_none());
    }

    /// Proves a plausible wrong hit clears the bar, which is why no suggestion is applied until the user confirms.
    #[test]
    fn a_plausible_but_wrong_hit_is_still_only_a_suggestion() {
        let node = json!({
            "id": 2123,
            "title": {
                "romaji": "DIGITAL MONSTER X-evolution",
                "english": "Digmon X-Evolution",
                "native": "デジタルモンスター ゼヴォリューション"
            },
            "synonyms": ["Digimon X", "Digital Monster X-Evolution: 13 Royal Knights"],
            "episodes": 1
        });
        let s = score(&item("Digimon", 1), &node).expect("the matcher does accept this");
        assert_eq!(s.media_id, 2123);
        // It clears the bar without being exact, and the screen shows that distinction rather than settling it.
        assert!(s.score >= 0.7 && s.score < 1.0, "score was {}", s.score);
    }

    /// Proves a real series hit survives the same threshold, so rejecting the bad one is not a bar nothing clears.
    #[test]
    fn a_real_series_hit_survives_the_same_threshold() {
        let node = json!({
            "id": 552,
            "title": { "romaji": "Digimon Adventure", "english": "Digimon Adventure", "native": "デジモンアドベンチャー" },
            "synonyms": [],
            "episodes": 54
        });
        let s = score(&item("Digimon Adventure", 1), &node).expect("should suggest");
        assert_eq!(s.media_id, 552);
    }

    #[test]
    fn media_without_any_title_is_skipped() {
        let node = json!({ "id": 5, "title": {}, "synonyms": [], "episodes": null });
        assert!(candidate_from(&node).is_none());
    }
}
