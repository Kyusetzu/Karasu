//! Parser für Anime-Dateinamen und Streaming-Titel
//! (Karasus Gegenstück zu Taigas Anitomy) — extrahiert Serientitel,
//! Episodennummer, Staffel und Release-Gruppe.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Parsed {
    pub title: String,
    pub episode: Option<u32>,
    pub season: Option<u32>,
    pub release_group: Option<String>,
}

const VIDEO_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "avi", "m4v", "webm", "ts", "m2ts", "ogm", "wmv", "flv",
];

/// Technik-Schlagwörter, die kein Teil des Titels sind.
const KEYWORDS: &[&str] = &[
    "1080p", "720p", "480p", "2160p", "4k", "bd", "bdrip", "bluray", "blu-ray",
    "web", "webrip", "web-dl", "webdl", "hdtv", "dvdrip", "x264", "x265",
    "h264", "h265", "h.264", "h.265", "hevc", "avc", "aac", "aac2.0", "ac3",
    "eac3", "flac", "opus", "dual", "audio", "multi", "multiple", "subtitle",
    "subs", "dub", "dubbed", "uncensored", "10bit", "8bit", "hi10p", "hdr",
    "60fps", "batch", "remux", "vostfr", "german", "english", "amzn", "cr",
];

fn regexes() -> &'static [Regex; 5] {
    static RE: OnceLock<[Regex; 5]> = OnceLock::new();
    RE.get_or_init(|| {
        [
            // S01E05, s2e12, Staffel/Season-Episode kombiniert
            Regex::new(r"(?i)\bs(\d{1,2})\s*[.\-_ ]?\s*e[p]?(\d{1,4})\b").unwrap(),
            // "Episode 28", "Ep 28", "Ep. 28", "E28", "Folge 28"
            Regex::new(r"(?i)\b(?:episode|folge|ep\.?|e)\s*(\d{1,4})(?:\s*v\d)?\b").unwrap(),
            // Klassisches Fansub-Format: " - 28", " – 28v2"
            Regex::new(r"[\-–—]\s*(\d{1,4})(?:\s*v\d)?\s*$").unwrap(),
            // "#28"
            Regex::new(r"#(\d{1,4})\b").unwrap(),
            // Nackte Zahl am Ende ("One Piece 1071")
            Regex::new(r"\s(\d{1,4})(?:\s*v\d)?\s*$").unwrap(),
        ]
    })
}

fn season_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\b(?:season\s*(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)\s+season|s(\d{1,2})\b)")
            .unwrap()
    })
}

pub fn parse(input: &str) -> Parsed {
    let mut work = input.trim().to_string();
    let mut release_group = None;

    // Dateierweiterung abschneiden
    if let Some((stem, ext)) = work.rsplit_once('.') {
        if VIDEO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) {
            work = stem.to_string();
        }
    }

    // Führende [Release-Gruppe]
    if work.starts_with('[') {
        if let Some(end) = work.find(']') {
            release_group = Some(work[1..end].to_string());
            work = work[end + 1..].trim().to_string();
        }
    }

    // Restliche [Tags] und (Tags) entfernen
    let bracket_re = {
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| Regex::new(r"[\[(][^\])]*[\])]").unwrap())
    };
    work = bracket_re.replace_all(&work, " ").to_string();

    // Unterstriche sind immer Trenner; Punkte nur bei Punkt-Namen ohne Leerzeichen
    work = work.replace('_', " ");
    if !work.contains(' ') {
        work = work.replace('.', " ");
    }
    work = work.split_whitespace().collect::<Vec<_>>().join(" ");

    // Episodennummer suchen (Prioritätsreihenfolge der Muster)
    let mut episode = None;
    let mut season = None;
    let mut title_end = work.len();

    for (i, re) in regexes().iter().enumerate() {
        if let Some(caps) = re.captures(&work) {
            let m = caps.get(0).unwrap();
            let ep_group = if i == 0 { 2 } else { 1 };
            if let Some(ep) = caps.get(ep_group).and_then(|g| g.as_str().parse().ok()) {
                // Jahreszahlen (1950–2030) am Ende sind keine Episoden
                if i == 4 && (1950..=2030).contains(&ep) {
                    continue;
                }
                episode = Some(ep);
                title_end = m.start();
                if i == 0 {
                    season = caps.get(1).and_then(|g| g.as_str().parse().ok());
                }
                break;
            }
        }
    }

    let mut title = work[..title_end].to_string();

    // Staffel aus dem Titel ziehen (bleibt für Matching-Varianten erhalten)
    if season.is_none() {
        if let Some(caps) = season_regex().captures(&title) {
            season = caps
                .iter()
                .skip(1)
                .flatten()
                .next()
                .and_then(|g| g.as_str().parse().ok());
        }
    }

    // Technik-Schlagwörter am Titelende entfernen
    let mut words: Vec<&str> = title.split_whitespace().collect();
    while let Some(last) = words.last() {
        if KEYWORDS.contains(&last.to_ascii_lowercase().as_str()) {
            words.pop();
        } else {
            break;
        }
    }
    title = words.join(" ");
    title = title
        .trim_matches(|c: char| c == '-' || c == '–' || c == '—' || c.is_whitespace())
        .to_string();

    Parsed {
        title,
        episode,
        season,
        release_group,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(input: &str) -> Parsed {
        parse(input)
    }

    #[test]
    fn classic_fansub() {
        let r = p("[SubsPlease] Sousou no Frieren - 28 (1080p) [ABCD1234].mkv");
        assert_eq!(r.title, "Sousou no Frieren");
        assert_eq!(r.episode, Some(28));
        assert_eq!(r.release_group.as_deref(), Some("SubsPlease"));
    }

    #[test]
    fn second_season_release() {
        let r = p("[Erai-raws] Kusuriya no Hitorigoto 2nd Season - 05 [1080p][Multiple Subtitle].mkv");
        assert_eq!(r.title, "Kusuriya no Hitorigoto 2nd Season");
        assert_eq!(r.episode, Some(5));
        assert_eq!(r.season, Some(2));
    }

    #[test]
    fn dot_separated_scene_release() {
        let r = p("Frieren.S01E28.1080p.WEB.x264-GROUP.mkv");
        assert_eq!(r.title, "Frieren");
        assert_eq!(r.episode, Some(28));
        assert_eq!(r.season, Some(1));
    }

    #[test]
    fn long_running_series() {
        let r = p("One Piece - 1071 [720p].mp4");
        assert_eq!(r.title, "One Piece");
        assert_eq!(r.episode, Some(1071));
    }

    #[test]
    fn short_season_marker() {
        let r = p("Oshi no Ko S2 - 03.mkv");
        assert_eq!(r.title, "Oshi no Ko S2");
        assert_eq!(r.episode, Some(3));
        assert_eq!(r.season, Some(2));
    }

    #[test]
    fn episode_keyword() {
        let r = p("Sousou no Frieren Episode 28");
        assert_eq!(r.title, "Sousou no Frieren");
        assert_eq!(r.episode, Some(28));
    }

    #[test]
    fn ep_keyword_streaming() {
        // Season-Marker bleibt im Titel — der Matcher probiert Varianten
        let r = p("Frieren: Beyond Journey's End Season 1 Ep 28");
        assert_eq!(r.title, "Frieren: Beyond Journey's End Season 1");
        assert_eq!(r.episode, Some(28));
        assert_eq!(r.season, Some(1));
    }

    #[test]
    fn underscores_and_version() {
        let r = p("[Group]_Some_Title_-_07v2_[720p].mkv");
        assert_eq!(r.title, "Some Title");
        assert_eq!(r.episode, Some(7));
    }

    #[test]
    fn no_episode_is_none() {
        let r = p("Suzume no Tojimari (2022) [1080p].mkv");
        assert_eq!(r.title, "Suzume no Tojimari");
        assert_eq!(r.episode, None);
    }

    #[test]
    fn number_in_title_not_episode() {
        // Kein Trenner → Zahl gehört zum Titel? Mit " - " ist es die Episode.
        let r = p("Mob Psycho 100 - 05.mkv");
        assert_eq!(r.title, "Mob Psycho 100");
        assert_eq!(r.episode, Some(5));
    }

    #[test]
    fn trailing_number_bare() {
        let r = p("One Piece 1071.mkv");
        assert_eq!(r.title, "One Piece");
        assert_eq!(r.episode, Some(1071));
    }

    #[test]
    fn keywords_stripped() {
        let r = p("Some Title 1080p WEB - 03.mkv");
        assert_eq!(r.title, "Some Title");
        assert_eq!(r.episode, Some(3));
    }
}
