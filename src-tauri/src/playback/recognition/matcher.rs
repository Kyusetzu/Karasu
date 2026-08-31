//! Matching of detected titles against the user's AniList entries.
//! Normalization + trigram Dice similarity, season variants included.

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
    /// `coverImage.large`, for the Discord presence card. Carried from the
    /// cached list the way `duration_min` is, and for the same reason:
    /// re-finding the entry later means deserializing the whole list again.
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

/// Dice coefficient over two ready-made trigram sets (0.0–1.0).
///
/// The empty guard is what keeps a `2.0 * 0.0 / 0.0` NaN out of the scoring
/// loop. NaN would poison it permanently: every `score > best.score` comparison
/// against a NaN best is false, so the first NaN pins the result forever.
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

/// The title with its season marker removed, when it carried one.
///
/// `None` means the season number cannot be spelled out of this title —
/// which is the case for every source that reports the season *beside* the
/// name rather than inside it (the Jellyfin API, above all).
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

/// Whether the season this parse carries could influence matching at all.
///
/// `variants` only ever *re-spells* a marker the title already contains; it
/// never invents one, because "Show" plus season 2 could be "Show 2", "Show
/// II", or a differently-named sequel entirely, and guessing writes to
/// someone's list. So for a title that carries no marker the season is inert,
/// and a caller that cares which entry it landed on needs to know that rather
/// than assume the match considered it. The scrobbler asks this before
/// trusting a season-2 detection.
pub fn season_informed(parsed: &Parsed) -> bool {
    without_season_marker(parsed).is_some()
}

/// One spelling to look for, and whether it may win outright.
///
/// `exact_ok` is false for exactly one needle: the title with its season
/// marker removed, past season 1. That spelling exists to *score* — it is what
/// finds a continuously numbered entry whose title carries no season at all —
/// but as an exact hit it is a claim about the wrong entry. "Show S2" strips
/// to "show", which matches the season-1 entry's title character for
/// character, and the exact-match path returns on the first candidate that
/// hits: with the season-1 entry earlier in the list, a season-2 detection
/// bound to it and wrote season 2's episode numbers onto season 1.
struct Needle {
    text: String,
    exact_ok: bool,
}

/// Title variants of the detected name to cover season spellings:
/// "Title S2" ↔ "Title 2nd Season" ↔ "Title Season 2".
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
            // Season 1 is the case where the stripped title *is* the answer:
            // "Show S1" and "Show" name the same entry.
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

/// A candidate whose titles have been normalized and trigrammed once.
///
/// A library scan matches many distinct titles against the *same* candidate
/// list, and the naive loop redid `normalize` per candidate title per detected
/// title and rebuilt both trigram sets inside every `similarity` call — the
/// haystack's set once per needle variant, so up to five times over. Hoisting
/// that out is the whole point of this type.
pub struct PreparedCandidate {
    media_id: i64,
    /// `(normalized title, its trigrams)`, in the candidate's own title order.
    titles: Vec<(String, HashSet<[u8; 3]>)>,
}

/// Pre-normalizes a candidate list for repeated `best_match_prepared` calls.
///
/// Candidate order and within-candidate title order are preserved, and they
/// matter: the scoring loop keeps the *first* maximum, so reordering here would
/// silently change which entry wins a tie.
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

/// Best candidate from the list for a detected title.
/// Minimum score 0.7; exact matches win immediately.
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
                // Stays a plain string comparison: an exact hit must win
                // outright, before any scoring — but only for a spelling
                // entitled to. Scoring still sees every needle, so a stripped
                // title remains the way a continuously numbered entry is
                // found; it just cannot end the search on the wrong season.
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

    /// A candidate that is nothing but an id and its titles — the only two
    /// fields title matching looks at.
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

    /// The season-1 entry deliberately sorts *first*, which is what made this a
    /// bug rather than a coin toss: "Show S2" strips to "show", the stripped
    /// spelling matched that entry character for character, and the
    /// exact-match path returned on the first candidate that hit. Season 2's
    /// episode numbers then went onto season 1's list entry.
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

    /// The stripped spelling still earns its keep: a continuously numbered
    /// entry carries no season marker at all, and dropping the needle would
    /// lose it. It scores — it just cannot end the search.
    #[test]
    fn a_continuously_numbered_entry_is_still_found() {
        let only_base = vec![titled(7, &["Test Show"])];
        let parsed = parse("[Group] Test Show S2 - 05 [1080p].mkv");
        let m = best_match(&parsed, &only_base).expect("nothing else to match");
        assert_eq!(m.media_id, 7);
    }

    /// Season 1 is the case where the stripped title *is* the answer, so it
    /// keeps its exact match.
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

    /// The algorithm as it stood before `prepare` existed: normalize per
    /// candidate title, rebuild both trigram sets inside every comparison.
    /// Kept here purely so the optimized version has something independent to
    /// be checked against — comparing `best_match` to `best_match_prepared`
    /// would prove nothing, since the former now delegates to the latter.
    /// `similarity` is `#[cfg(test)]` for the same reason: the scoring path
    /// works on prepared trigram sets and no longer goes through it.
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

    /// A NaN score would pin `best` forever: every later `score > best.score`
    /// comparison against NaN is false.
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

    /// An exact hit must return immediately, even when an earlier candidate
    /// already scored well on the fuzzy path.
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
