//! Matching erkannter Titel gegen die AniList-Einträge des Users.
//! Normalisierung + Trigramm-Dice-Ähnlichkeit, Season-Varianten inklusive.

use super::parser::Parsed;
use std::collections::HashSet;

/// Ein Anime aus der User-Liste mit allen bekannten Titeln.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub media_id: i64,
    pub titles: Vec<String>,
    pub episodes: Option<u32>,
    /// Episodenlänge in Minuten (für die Scrobble-Schwelle)
    pub duration_min: Option<u32>,
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

/// Dice-Koeffizient über Trigramme (0.0–1.0).
pub fn similarity(a: &str, b: &str) -> f64 {
    if a == b {
        return 1.0;
    }
    let (ta, tb) = (trigrams(a), trigrams(b));
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let common = ta.intersection(&tb).count();
    (2.0 * common as f64) / (ta.len() + tb.len()) as f64
}

/// Titelvarianten des erkannten Namens, um Season-Schreibweisen abzudecken:
/// "Title S2" ↔ "Title 2nd Season" ↔ "Title Season 2".
fn variants(parsed: &Parsed) -> Vec<String> {
    let base = normalize(&parsed.title);
    let mut out = vec![base.clone()];

    if let Some(season) = parsed.season {
        // Season-Marker aus dem normalisierten Titel entfernen
        let stripped = base
            .replace(&format!("season {season}"), "")
            .replace(&format!("{season}nd season"), "")
            .replace(&format!("{season}rd season"), "")
            .replace(&format!("{season}th season"), "")
            .replace(&format!("{season}st season"), "")
            .replace(&format!(" s{season}"), " ");
        let stripped = stripped.split_whitespace().collect::<Vec<_>>().join(" ");
        if !stripped.is_empty() && stripped != base {
            out.push(format!("{stripped} season {season}"));
            let suffix = match season {
                1 => "st",
                2 => "nd",
                3 => "rd",
                _ => "th",
            };
            out.push(format!("{stripped} {season}{suffix} season"));
            if season > 1 {
                out.push(format!("{stripped} {season}"));
            }
            out.push(stripped);
        }
    }
    out.dedup();
    out
}

pub struct Match {
    pub media_id: i64,
    pub score: f64,
}

/// Bester Kandidat aus der Liste für einen erkannten Titel.
/// Mindest-Score 0.7; exakte Treffer gewinnen sofort.
pub fn best_match(parsed: &Parsed, candidates: &[Candidate]) -> Option<Match> {
    let needles = variants(parsed);
    let mut best: Option<Match> = None;

    for candidate in candidates {
        for title in &candidate.titles {
            let hay = normalize(title);
            for needle in &needles {
                if hay == *needle {
                    return Some(Match {
                        media_id: candidate.media_id,
                        score: 1.0,
                    });
                }
                let score = similarity(needle, &hay);
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
    use crate::recognition::parser::parse;

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
                progress: 27,
                status: "CURRENT".into(),
            },
            Candidate {
                media_id: 21,
                titles: vec!["One Piece".into()],
                episodes: None,
                duration_min: Some(24),
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
}
