//! Matches detected titles against the user's list by normalization and trigram Dice similarity.

use super::parser::Parsed;
use std::collections::HashSet;

/// One entry from the user's list with all known titles.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub media_id: i64,
    pub titles: Vec<String>,
    pub episodes: Option<u32>,
    /// Episode length in minutes (for the scrobble threshold)
    pub duration_min: Option<u32>,
    /// `coverImage.large` for the Discord card, carried here so the entry need not be re-found in the cached list.
    pub cover_url: Option<String>,
    pub progress: u32,
    pub status: String,
}

pub fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn trigrams(s: &str) -> HashSet<[u8; 3]> {
    let padded = format!("  {s} ");
    let bytes = padded.as_bytes();
    bytes
        .windows(3)
        .map(|w| [w[0], w[1], w[2]])
        .collect()
}

/// Dice coefficient over two trigram sets; keep the empty guard, since a NaN score pins `best` forever.
fn dice(ta: &HashSet<[u8; 3]>, tb: &HashSet<[u8; 3]>) -> f64 {
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let common = ta.intersection(tb).count();
    (2.0 * common as f64) / (ta.len() + tb.len()) as f64
}

/// Dice coefficient over two strings (0.0–1.0).
#[cfg(test)]
fn similarity(a: &str, b: &str) -> f64 {
    if a == b {
        return 1.0;
    }
    dice(&trigrams(a), &trigrams(b))
}

/// The title with its season marker removed, or `None` when the title carried no marker to remove.
fn without_season_marker(parsed: &Parsed) -> Option<String> {
    let season = parsed.season?;
    let base = normalize(&parsed.title);
    let stripped = base
        .replace(&format!("season {season}"), "")
        .replace(&format!("{season}nd season"), "")
        .replace(&format!("{season}rd season"), "")
        .replace(&format!("{season}th season"), "")
        .replace(&format!("{season}st season"), "")
        .replace(&format!(" s{season}"), " ");
    let stripped = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
    (!stripped.is_empty() && stripped != base).then_some(stripped)
}

/// Whether the season could influence matching at all; `variants` never invents a marker the title lacks.
pub fn season_informed(parsed: &Parsed) -> bool {
    without_season_marker(parsed).is_some()
}

/// One spelling to look for; `exact_ok` is false only for the season-stripped title past season 1.
struct Needle {
    text: String,
    exact_ok: bool,
}

/// Title variants of the detected name covering the season spellings "S2", "2nd Season" and "Season 2".
fn variants(parsed: &Parsed) -> Vec<Needle> {
    let base = normalize(&parsed.title);
    let mut out = vec![Needle { text: base.clone(), exact_ok: true }];

    if let Some(season) = parsed.season {
        if let Some(stripped) = without_season_marker(parsed) {
            let suffix = match season {
                1 => "st",
                2 => "nd",
                3 => "rd",
                _ => "th",
            };
            for text in [
                format!("{stripped} season {season}"),
                format!("{stripped} {season}{suffix} season"),
            ] {
                out.push(Needle { text, exact_ok: true });
            }
            if season > 1 {
                out.push(Needle { text: format!("{stripped} {season}"), exact_ok: true });
            }
            // Season 1 is the case where the stripped title is the answer: "Show S1" and "Show" name the same entry.
            out.push(Needle { text: stripped, exact_ok: season <= 1 });
        }
    }
    out.dedup_by(|a, b| a.text == b.text);
    out
}

pub struct Match {
    pub media_id: i64,
    pub score: f64,
}

/// A candidate normalized and trigrammed once, so a library scan does not redo that per detected title.
pub struct PreparedCandidate {
    media_id: i64,
    /// `(normalized title, its trigrams)`, in the candidate's own title order.
    titles: Vec<(String, HashSet<[u8; 3]>)>,
}

/// Pre-normalizes candidates for `best_match_prepared`; order is preserved because the first maximum wins a tie.
pub fn prepare(candidates: &[Candidate]) -> Vec<PreparedCandidate> {
    candidates
        .iter()
        .map(|candidate| PreparedCandidate {
            media_id: candidate.media_id,
            titles: candidate
                .titles
                .iter()
                .map(|title| {
                    let hay = normalize(title);
                    let grams = trigrams(&hay);
                    (hay, grams)
                })
                .collect(),
        })
        .collect()
}

/// Best candidate for a detected title above the minimum score; an exact match wins immediately.
pub fn best_match(parsed: &Parsed, candidates: &[Candidate]) -> Option<Match> {
    best_match_prepared(parsed, &prepare(candidates))
}

/// [`best_match`] against a candidate list prepared once by [`prepare`].
pub fn best_match_prepared(
    parsed: &Parsed,
    candidates: &[PreparedCandidate],
) -> Option<Match> {
    let needles: Vec<(Needle, HashSet<[u8; 3]>)> = variants(parsed)
        .into_iter()
        .map(|needle| {
            let grams = trigrams(&needle.text);
            (needle, grams)
        })
        .collect();
    let mut best: Option<Match> = None;

    for candidate in candidates {
        for (hay, hay_grams) in &candidate.titles {
            for (needle, needle_grams) in &needles {
                // Keep the exact-match short circuit, gated on `exact_ok` so it cannot end the search on the wrong season.
                if needle.exact_ok && *hay == needle.text {
                    return Some(Match {
                        media_id: candidate.media_id,
                        score: 1.0,
                    });
                }
                let score = dice(needle_grams, hay_grams);
                if best.as_ref().is_none_or(|b| score > b.score) {
                    best = Some(Match {
                        media_id: candidate.media_id,
                        score,
                    });
                }
            }
        }
    }
    best.filter(|m| m.score >= 0.7)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::playback::recognition::parser::parse;

    /// A candidate that is nothing but an id and its titles, the only two fields title matching looks at.
    fn titled(media_id: i64, titles: &[&str]) -> Candidate {
        Candidate {
            media_id,
            titles: titles.iter().map(|t| (*t).into()).collect(),
            episodes: None,
            duration_min: None,
            cover_url: None,
            progress: 0,
            status: "CURRENT".into(),
        }
    }

    fn candidates() -> Vec<Candidate> {
        vec![
            Candidate {
                media_id: 154587,
                titles: vec![
                    "Sousou no Frieren".into(),
                    "Frieren: Beyond Journey's End".into(),
                ],
                episodes: Some(28),
                duration_min: Some(24),
                cover_url: None,
                progress: 27,
                status: "CURRENT".into(),
            },
            Candidate {
                media_id: 21,
                titles: vec!["One Piece".into()],
                episodes: None,
                duration_min: Some(24),
                cover_url: None,
                progress: 1070,
                status: "CURRENT".into(),
            },
            Candidate {
                media_id: 166531,
                titles: vec![
                    "Kusuriya no Hitorigoto 2nd Season".into(),
                    "The Apothecary Diaries Season 2".into(),
                ],
                episodes: Some(24),
                duration_min: Some(24),
                cover_url: None,
                progress: 4,
                status: "CURRENT".into(),
            },
        ]
    }

    #[test]
    fn exact_romaji_match() {
        let parsed = parse("[SubsPlease] Sousou no Frieren - 28 (1080p).mkv");
        let m = best_match(&parsed, &candidates()).unwrap();
        assert_eq!(m.media_id, 154587);
        assert_eq!(m.score, 1.0);
    }

    #[test]
    fn english_title_with_season_variant() {
        let parsed = parse("Frieren: Beyond Journey's End Season 1 Ep 28");
        let m = best_match(&parsed, &candidates()).unwrap();
        assert_eq!(m.media_id, 154587);
    }

    #[test]
    fn second_season_matches_correct_entry() {
        let parsed =
            parse("[Erai-raws] Kusuriya no Hitorigoto 2nd Season - 05 [1080p].mkv");
        let m = best_match(&parsed, &candidates()).unwrap();
        assert_eq!(m.media_id, 166531);
    }

    /// Proves a season-2 title cannot exact-match a season-1 entry that sorts first via its stripped spelling.
    #[test]
    fn a_second_season_does_not_bind_to_season_one_that_sorts_first() {
        let ordered = vec![
            titled(1, &["Test Show"]),
            titled(2, &["Test Show Season 2"]),
        ];
        let parsed = parse("[Group] Test Show S2 - 05 [1080p].mkv");
        let m = best_match(&parsed, &ordered).expect("season 2 is on the list");
        assert_eq!(m.media_id, 2, "the season the title actually names");
    }

    /// Proves the stripped spelling still scores, so a continuously numbered entry without a marker is found.
    #[test]
    fn a_continuously_numbered_entry_is_still_found() {
        let only_base = vec![titled(7, &["Test Show"])];
        let parsed = parse("[Group] Test Show S2 - 05 [1080p].mkv");
        let m = best_match(&parsed, &only_base).expect("nothing else to match");
        assert_eq!(m.media_id, 7);
    }

    /// Proves season 1 keeps its exact match, since there the stripped title is the answer.
    #[test]
    fn season_one_still_matches_the_bare_title_exactly() {
        let base = vec![titled(3, &["Test Show"])];
        let parsed = parse("[Group] Test Show S1 - 05 [1080p].mkv");
        let m = best_match(&parsed, &base).unwrap();
        assert_eq!(m.media_id, 3);
        assert_eq!(m.score, 1.0, "an exact hit, not a fuzzy one");
    }

    #[test]
    fn fuzzy_tolerates_small_differences() {
        let parsed = parse("Sousou no Frieren (2023) - 28.mkv");
        let m = best_match(&parsed, &candidates()).unwrap();
        assert_eq!(m.media_id, 154587);
    }

    #[test]
    fn unrelated_title_no_match() {
        let parsed = parse("Totally Different Show - 05.mkv");
        assert!(best_match(&parsed, &candidates()).is_none());
    }

    /// The original algorithm before `prepare` existed; keep this copy honest, it is what the fast path is checked against.
    fn best_match_reference(parsed: &Parsed, candidates: &[Candidate]) -> Option<Match> {
        let needles = variants(parsed);
        let mut best: Option<Match> = None;

        for candidate in candidates {
            for title in &candidate.titles {
                let hay = normalize(title);
                for needle in &needles {
                    if needle.exact_ok && hay == needle.text {
                        return Some(Match {
                            media_id: candidate.media_id,
                            score: 1.0,
                        });
                    }
                    let score = similarity(&needle.text, &hay);
                    if best.as_ref().is_none_or(|b| score > b.score) {
                        best = Some(Match {
                            media_id: candidate.media_id,
                            score,
                        });
                    }
                }
            }
        }
        best.filter(|m| m.score >= 0.7)
    }

    /// The whole point of `prepare` is that it changes nothing but the cost.
    #[test]
    fn prepared_agrees_with_the_original_algorithm() {
        let candidates = candidates();
        let prepared = prepare(&candidates);
        for name in [
            "[SubsPlease] Sousou no Frieren - 28 (1080p).mkv",
            "Frieren: Beyond Journey's End Season 1 Ep 28",
            "[Erai-raws] Kusuriya no Hitorigoto 2nd Season - 05 [1080p].mkv",
            "Sousou no Frieren (2023) - 28.mkv",
            "Totally Different Show - 05.mkv",
            "One Piece - 1071.mkv",
            "One Piece Season 3 - 12.mkv",
            "NCOP01.mkv",
            "",
        ] {
            let parsed = parse(name);
            let reference = best_match_reference(&parsed, &candidates);
            let fast = best_match_prepared(&parsed, &prepared);
            assert_eq!(
                reference.as_ref().map(|m| (m.media_id, m.score)),
                fast.as_ref().map(|m| (m.media_id, m.score)),
                "disagreement on {name:?}"
            );
        }
    }

    /// Proves `dice` never returns NaN, since a NaN score would pin `best` forever.
    #[test]
    fn dice_returns_zero_rather_than_nan_for_empty_sets() {
        let empty: HashSet<[u8; 3]> = HashSet::new();
        let full = trigrams("frieren");
        assert_eq!(dice(&empty, &empty), 0.0);
        assert_eq!(dice(&empty, &full), 0.0);
        assert_eq!(dice(&full, &empty), 0.0);
    }

    /// Scoring keeps the *first* maximum, so `prepare` must not reorder.
    #[test]
    fn first_candidate_wins_a_tie() {
        let tied = vec![
            Candidate {
                media_id: 111,
                titles: vec!["Sousou no Frieren Extra".into()],
                episodes: None,
                duration_min: None,
                cover_url: None,
                progress: 0,
                status: "CURRENT".into(),
            },
            Candidate {
                media_id: 222,
                titles: vec!["Sousou no Frieren Extra".into()],
                episodes: None,
                duration_min: None,
                cover_url: None,
                progress: 0,
                status: "CURRENT".into(),
            },
        ];
        let parsed = parse("Sousou no Frieren - 28.mkv");
        assert_eq!(best_match(&parsed, &tied).unwrap().media_id, 111);
        assert_eq!(
            best_match_prepared(&parsed, &prepare(&tied))
                .unwrap()
                .media_id,
            111,
        );
    }

    /// Proves an exact hit returns immediately even after an earlier candidate scored well on the fuzzy path.
    #[test]
    fn exact_match_short_circuits_past_a_close_fuzzy_one() {
        let list = vec![
            Candidate {
                media_id: 111,
                titles: vec!["Sousou no Frieren Extra".into()],
                episodes: None,
                duration_min: None,
                cover_url: None,
                progress: 0,
                status: "CURRENT".into(),
            },
            Candidate {
                media_id: 222,
                titles: vec!["Sousou no Frieren".into()],
                episodes: None,
                duration_min: None,
                cover_url: None,
                progress: 0,
                status: "CURRENT".into(),
            },
        ];
        let parsed = parse("Sousou no Frieren - 28.mkv");
        let m = best_match_prepared(&parsed, &prepare(&list)).unwrap();
        assert_eq!(m.media_id, 222);
        assert_eq!(m.score, 1.0);
    }
}
