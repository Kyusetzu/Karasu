//! Parser for anime file names and streaming titles
//! (Karasu's counterpart to Taiga's Anitomy) — extracts series title,
//! episode number, season and release group.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Parsed {
    pub title: String,
    pub episode: Option<u32>,
    pub season: Option<u32>,
    pub release_group: Option<String>,
}

pub(crate) const VIDEO_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "avi", "m4v", "webm", "ts", "m2ts", "ogm", "wmv", "flv",
];

/// Technical keywords that are not part of the title.
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
            // S01E05, s2e12 — combined season/episode markers
            Regex::new(r"(?i)\bs(\d{1,2})\s*[.\-_ ]?\s*e[p]?(\d{1,4})\b").unwrap(),
            // "Episode 28", "Ep 28", "Ep. 28", "E28", "Folge 28"
            Regex::new(r"(?i)\b(?:episode|folge|ep\.?|e)\s*(\d{1,4})(?:\s*v\d)?\b").unwrap(),
            // Classic fansub format: " - 28", " – 28v2"
            Regex::new(r"[\-–—]\s*(\d{1,4})(?:\s*v\d)?\s*$").unwrap(),
            // "#28"
            Regex::new(r"#(\d{1,4})\b").unwrap(),
            // Bare trailing number ("One Piece 1071")
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

    // Strip the file extension
    if let Some((stem, ext)) = work.rsplit_once('.') {
        if VIDEO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()) {
            work = stem.to_string();
        }
    }

    // Leading [release group]
    if work.starts_with('[') {
        if let Some(end) = work.find(']') {
            release_group = Some(work[1..end].to_string());
            work = work[end + 1..].trim().to_string();
        }
    }

    // Remove remaining [tags] and (tags)
    let bracket_re = {
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| Regex::new(r"[\[(][^\])]*[\])]").unwrap())
    };
    work = bracket_re.replace_all(&work, " ").to_string();

    // Underscores are always separators; dots only in dot-names without spaces
    work = work.replace('_', " ");
    if !work.contains(' ') {
        work = work.replace('.', " ");
    }
    work = work.split_whitespace().collect::<Vec<_>>().join(" ");

    // Find the episode number (patterns in priority order)
    let mut episode = None;
    let mut season = None;
    let mut title_end = work.len();

    for (i, re) in regexes().iter().enumerate() {
        if let Some(caps) = re.captures(&work) {
            let m = caps.get(0).unwrap();
            let ep_group = if i == 0 { 2 } else { 1 };
            if let Some(ep) = caps.get(ep_group).and_then(|g| g.as_str().parse().ok()) {
                // Trailing years (1950–2030) are not episodes
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

    // Pull the season out of the title (kept for matching variants)
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

    // Remove technical keywords from the end of the title
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

fn chapter_regexes() -> &'static [Regex; 3] {
    static RE: OnceLock<[Regex; 3]> = OnceLock::new();
    RE.get_or_init(|| {
        [
            // "Ch. 45", "Chapter 45", "Kapitel 45" (decimal part is ignored)
            Regex::new(r"(?i)\b(?:ch(?:apter)?\.?|kapitel)\s*(\d{1,5})(?:\.\d+)?\b").unwrap(),
            // Trailing " - 45"
            Regex::new(r"[\-–—]\s*(\d{1,5})(?:\.\d+)?\s*$").unwrap(),
            // "#45"
            Regex::new(r"#(\d{1,5})\b").unwrap(),
        ]
    })
}

/// Parser for manga titles from browser tabs: extracts series title and
/// chapter number (carried in the `episode` field).
pub fn parse_manga(input: &str) -> Parsed {
    let mut work = input.trim().to_string();

    // Strip the "Read " prefix used by many reading sites
    if let Some(stripped) = work.strip_prefix("Read ") {
        work = stripped.to_string();
    }

    let bracket_re = {
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| Regex::new(r"[\[(][^\])]*[\])]").unwrap())
    };
    work = bracket_re.replace_all(&work, " ").to_string();
    work = work.replace('_', " ");
    work = work.split_whitespace().collect::<Vec<_>>().join(" ");

    let mut chapter = None;
    let mut title_end = work.len();
    for re in chapter_regexes() {
        if let Some(caps) = re.captures(&work) {
            if let Some(n) = caps.get(1).and_then(|g| g.as_str().parse().ok()) {
                chapter = Some(n);
                title_end = caps.get(0).unwrap().start();
                break;
            }
        }
    }

    let title = work[..title_end]
        .trim_matches(|c: char| c == '-' || c == '–' || c == '—' || c == ':' || c.is_whitespace())
        .to_string();

    Parsed {
        title,
        episode: chapter,
        season: None,
        release_group: None,
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
        // The season marker stays in the title — the matcher tries variants
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
        // No separator → the number belongs to the title? With " - " it is the episode.
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

    // --- Manga --------------------------------------------------------------

    #[test]
    fn manga_chapter_abbreviated() {
        let r = parse_manga("Kusuriya no Hitorigoto - Ch. 45");
        assert_eq!(r.title, "Kusuriya no Hitorigoto");
        assert_eq!(r.episode, Some(45));
    }

    #[test]
    fn manga_chapter_full_word_with_read_prefix() {
        let r = parse_manga("Read One Piece Chapter 1100");
        assert_eq!(r.title, "One Piece");
        assert_eq!(r.episode, Some(1100));
    }

    #[test]
    fn manga_chapter_german() {
        let r = parse_manga("Berserk Kapitel 380");
        assert_eq!(r.title, "Berserk");
        assert_eq!(r.episode, Some(380));
    }

    #[test]
    fn manga_decimal_chapter_floored() {
        let r = parse_manga("Some Series - Ch. 45.5");
        assert_eq!(r.title, "Some Series");
        assert_eq!(r.episode, Some(45));
    }

    #[test]
    fn manga_no_chapter() {
        let r = parse_manga("MangaDex Homepage");
        assert_eq!(r.episode, None);
    }
}
