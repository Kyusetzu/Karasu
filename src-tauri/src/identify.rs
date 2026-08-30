//! Asking AniList what a title is, when the user's own list cannot say.
//!
//! `candidates_from_cache` builds the matcher's candidates from the cached
//! list and nothing else, so a show that was never added is outside the search
//! space entirely — no filename is clean enough to be found. This module is the
//! way out: it takes the titles a scan could not place and asks AniList about
//! them directly.
//!
//! What comes back is scored by the *same* matcher the local path uses, so
//! "exact" and "close" keep meaning exactly what they already meant, and a
//! search hit that does not clear the bar produces no suggestion at all.

use crate::anilist::client::AniList;
use crate::playback::recognition::{matcher, parser::Parsed};
use serde_json::Value;

/// Titles per request.
///
/// Measured against the live API: 40 aliases returned HTTP 200 with all 40
/// resolved for a single rate-limit unit. 25 keeps headroom for long titles and
/// their synonyms without changing the request count meaningfully — 130 groups
/// cost six requests instead of four, out of ~30 a minute.
const PER_REQUEST: usize = 25;

/// Requests one scan may spend on identification.
///
/// The rate limit is ~30 a minute and it is shared with list fetches and
/// scrobble saves, so a folder of mostly off-list series — the group key is
/// (title, season), and `MAX_FILES` is 20_000 — must not be allowed to eat all
/// of it. 8 batches is 200 titles, which covers a real library in one pass and
/// bounds a pathological one. `alerts::sequel` bounds itself the same way.
const MAX_BATCHES: usize = 8;

/// Titles one scan may ask about, which is what the caller rotates through.
///
/// The cap alone would be a *prefix*, not a window: the unplaced groups are
/// sorted deterministically, and a title that gets no answer leaves no record,
/// so the same 200 junk folders would block the queue on every rescan and
/// groups past them would never be asked at all. `alerts::sequel` had the
/// identical shape.
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

/// Aliased `Page` searches, one alias per title.
///
/// `Page(perPage: 1) { media(search:) }` rather than `Media(search:)`, and the
/// difference is load-bearing. A bare `Media` search that finds nothing makes
/// AniList answer **HTTP 404 with a `Not Found.` error**, and `client::query`
/// discards `data` whenever `errors` is present — so a single missing title
/// would throw away every other result in the batch. A `Page` that finds
/// nothing returns an empty array and HTTP 200, leaving the rest intact.
fn batch_query(batch: &[&Unidentified]) -> String {
    let mut q = String::from("query {\n");
    for (i, item) in batch.iter().enumerate() {
        // The parsed title is the only interpolation, and `normalize` has
        // already reduced it to alphanumerics and spaces — no quote can survive
        // to break out of the string literal.
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
        // The identify pass scores titles; nothing downstream of it renders
        // a presence card, so there is no cover to carry.
        cover_url: None,
        progress: 0,
        status: String::new(),
    })
}

/// Scores one alias's results against the title that produced them.
///
/// Reusing `best_match` rather than trusting AniList's ranking is the whole
/// safeguard: search returns *something* for almost any input, and its first
/// result for "Pokemon" is as likely to be a spin-off as the series. The
/// matcher's 0.7 floor and its exact-title short circuit apply here unchanged.
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

/// Asks AniList about up to `MAX_BATCHES` batches of titles and keeps what
/// scores well.
///
/// A failed batch ends the pass rather than failing the scan. Identification is
/// an improvement on top of a scan that has already succeeded locally; losing
/// it to a flaky connection should cost the suggestions, not the index. It
/// stops rather than skipping on because the batches are identical in shape —
/// whatever rejected one (a rate limit, most likely, after `client` has already
/// slept out its retry) will reject the remaining ones just as fast.
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

    /// The cap has to be a window, not a prefix.
    ///
    /// A title that gets no answer is stored nowhere, so it is asked again on
    /// every scan; take the first `MAX_TITLES` of a deterministically sorted
    /// list and a block of unanswerable junk at the front starves everything
    /// behind it forever. This walks the caller's rotate-then-cap arithmetic
    /// over a set half again as large as one scan's budget and asserts that
    /// three scans reach every title.
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

    /// Every alias is a `Page`, because a bare `Media` miss would take the
    /// whole batch down with it.
    #[test]
    fn the_query_uses_page_so_one_miss_cannot_fail_the_batch() {
        let items = [item("Hunter x Hunter", -1), item("Digimon", 1)];
        let refs: Vec<&Unidentified> = items.iter().collect();
        let q = batch_query(&refs);
        assert_eq!(q.matches("Page(perPage: 1)").count(), 2);
        assert!(!q.contains("Media(search"));
        assert!(q.contains("m0:") && q.contains("m1:"));
    }

    /// Titles reach the query normalized, so nothing in a release name can
    /// terminate the string literal it is interpolated into.
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

    /// The safeguard. AniList answers almost any search with something; a
    /// result that does not resemble what was asked for must produce nothing
    /// rather than a confident wrong answer.
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

    /// Why a suggestion is never applied on its own, in one real example.
    ///
    /// Taken verbatim from the API: searching AniList for "digimon" returns not
    /// the series but a 2005 film, whose synonyms include "Digimon X". That
    /// scores about 0.9 against the parsed title, so **the matcher accepts it**
    /// — and 104 files in the test library parse to exactly that title.
    ///
    /// No threshold fixes this. Raising the bar to 0.85 still admits it, and
    /// exact-only would still admit Sailor Moon seasons 2-5, which all match
    /// AniList's English title for season 1 outright. Open search offers one
    /// arbitrary result with no field of competitors to rank it against, which
    /// is weaker evidence than the same score earned against a curated list.
    ///
    /// So the guard is not arithmetic, it is the human: the suggestion is shown
    /// with the title it resolved to, where "Digimon → DIGITAL MONSTER
    /// X-evolution" is wrong at a glance, and nothing moves until it is
    /// confirmed.
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
        // It clears the bar without being exact, and the screen shows both the
        // resolved title and that distinction rather than presenting it as
        // settled.
        assert!(s.score >= 0.7 && s.score < 1.0, "score was {}", s.score);
    }

    /// The other half of the same story: the same batch resolves Hunter x
    /// Hunter and Digimon Adventure correctly, so rejecting the bad one must
    /// not come from a threshold so high that nothing survives it.
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
