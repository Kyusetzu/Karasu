//! Parser for anime file names and streaming titles: series title, episode, season and release group.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Parsed {
    pub title: String,
    pub episode: Option<u32>,
    /// Whether the episode was spelled out rather than inferred; only a spelled-out one may overrule a "music" label.
    pub episode_marked: bool,
    pub season: Option<u32>,
    pub release_group: Option<String>,
    /// The episode's own name when the source spells one after the number; a file rarely does, Jellyfin always.
    pub episode_title: Option<String>,
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

fn regexes() -> &'static [Regex; 6] {
    static RE: OnceLock<[Regex; 6]> = OnceLock::new();
    RE.get_or_init(|| {
        [
            // S01E05, s2e12 — combined season/episode markers
            Regex::new(r"(?i)\bs(\d{1,2})\s*[.\-_ ]?\s*e[p]?(\d{1,4})\b").unwrap(),
            // "Episode 28", "Ep 28", "Ep. 28", "E28", "Folge 28"
            Regex::new(r"(?i)\b(?:episode|folge|ep\.?|e)\s*(\d{1,4})(?:\s*v\d)?\b").unwrap(),
            // Classic fansub format: " - 28", " – 28v2"
            Regex::new(r"[\-–—]\s*(\d{1,4})(?:\s*v\d)?\s*$").unwrap(),
            // The fansub format with the episode's name after it: " - 05 - The Mage's Journey"
            Regex::new(r"[\-–—]\s*(\d{1,4})(?:\s*v\d)?\s*([\-–—]\s*\S.*)$").unwrap(),
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
    let mut episode_marked = false;
    let mut season = None;
    let mut episode_title = None;
    let mut title_end = work.len();

    for (i, re) in regexes().iter().enumerate() {
        if let Some(caps) = re.captures(&work) {
            let m = caps.get(0).unwrap();
            let ep_group = if i == 0 { 2 } else { 1 };
            if let Some(ep) = caps.get(ep_group).and_then(|g| g.as_str().parse().ok()) {
                // Trailing years (1950–2030) are not episodes
                if i == 5 && (1950..=2030).contains(&ep) {
                    continue;
                }
                episode = Some(ep);
                // Patterns 0, 1 and 4 spell the episode out; the dash and bare-trailing forms only infer it.
                episode_marked = matches!(i, 0 | 1 | 4);
                title_end = m.start();
                if i == 0 {
                    season = caps.get(1).and_then(|g| g.as_str().parse().ok());
                }
                // Only the marker forms leave a tail that can be a name; the anchored forms end the string.
                episode_title = match i {
                    0 => episode_title_from(&work[m.end()..], false),
                    1 => episode_title_from(&work[m.end()..], true),
                    3 => caps.get(2).and_then(|g| episode_title_from(g.as_str(), true)),
                    _ => None,
                };
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
        episode_marked,
        season,
        release_group,
        episode_title,
    }
}

/// A name ends at the next dash, so a site or player suffix never becomes the episode's name; `dashed` demands one first.
fn episode_title_from(tail: &str, dashed: bool) -> Option<String> {
    let rest = tail.trim_start();
    let rest = match rest.strip_prefix(['-', '–', '—']) {
        Some(named) => named,
        None if dashed => return None,
        None => rest,
    };
    let end = [" - ", " – ", " — "]
        .iter()
        .filter_map(|sep| rest.find(sep))
        .min()
        .unwrap_or(rest.len());
    let first = rest[..end].trim_matches(|c: char| c == ':' || c.is_whitespace());
    let mut words: Vec<&str> = first.split_whitespace().collect();
    // A scene name glues the group to the last keyword ("x264-GROUP"), so the word is judged by its keyword prefix.
    while let Some(last) = words.last() {
        let lower = last.to_ascii_lowercase();
        let head = lower.split('-').next().unwrap_or("");
        if KEYWORDS.contains(&lower.as_str()) || (lower.contains('-') && KEYWORDS.contains(&head)) {
            words.pop();
        } else {
            break;
        }
    }
    let name = words.join(" ");
    let numeric = name.chars().all(|c| c.is_ascii_digit() || c == 'v');
    if name.chars().count() < 2 || numeric {
        return None;
    }
    Some(name)
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

/// Parses a manga title from a browser tab; the chapter number is carried in the `episode` field.
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
    let mut chapter_marked = false;
    let mut title_end = work.len();
    for (i, re) in chapter_regexes().iter().enumerate() {
        if let Some(caps) = re.captures(&work) {
            if let Some(n) = caps.get(1).and_then(|g| g.as_str().parse().ok()) {
                chapter = Some(n);
                // Same split as the episode set: the keyword and "#45" are spelled out, the dash form is inference.
                chapter_marked = matches!(i, 0 | 2);
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
        episode_marked: chapter_marked,
        season: None,
        release_group: None,
        episode_title: None,
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
        assert!(r.episode_marked, "the keyword spells the episode out");
    }

    /// Pins the explicit/inferred split across all five patterns, which the media-session pass relies on.
    #[test]
    fn only_spelled_out_episodes_count_as_marked() {
        assert!(p("Frieren S01E28").episode_marked);
        assert!(p("Show Episode 3").episode_marked);
        assert!(p("Show #3").episode_marked);
        assert!(!p("Sousou no Frieren - 28").episode_marked);
        assert!(!p("One Piece 1071").episode_marked);
        assert!(!p("No Episode At All").episode_marked);
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
    fn episode_name_after_the_number() {
        let r = p("[Grp] Show - 05 - The Mage's Journey [1080p].mkv");
        assert_eq!(r.title, "Show");
        assert_eq!(r.episode, Some(5));
        assert_eq!(r.release_group.as_deref(), Some("Grp"));
        assert_eq!(r.episode_title.as_deref(), Some("The Mage's Journey"));
    }

    #[test]
    fn episode_name_after_a_season_marker() {
        let r = p("Show S02E05 - Title.mkv");
        assert_eq!(r.season, Some(2));
        assert_eq!(r.episode, Some(5));
        assert_eq!(r.episode_title.as_deref(), Some("Title"));
    }

    #[test]
    fn no_episode_name_without_a_tail() {
        assert_eq!(p("[SubsPlease] Frieren - 05 (1080p) [ABCD1234].mkv").episode_title, None);
        let r = p("Show - 05v2 [720p].mkv");
        assert_eq!(r.episode, Some(5));
        assert_eq!(r.episode_title, None);
    }

    #[test]
    fn episode_name_in_a_scene_name_loses_the_keywords() {
        let r = p("Show.S01E05.The.Mages.Journey.1080p.WEB.x264-GROUP.mkv");
        assert_eq!(r.episode, Some(5));
        assert_eq!(r.episode_title.as_deref(), Some("The Mages Journey"));
    }

    #[test]
    fn a_numeric_tail_is_not_a_name() {
        let r = p("Show - 05 - 06.mkv");
        assert_eq!(r.episode, Some(6));
        assert_eq!(r.episode_title, None);
        let r = p("Show S01E05 - 06.mkv");
        assert_eq!(r.episode, Some(5));
        assert_eq!(r.episode_title, None);
    }

    #[test]
    fn manga_never_carries_an_episode_name() {
        assert_eq!(parse_manga("Berserk Kapitel 380").episode_title, None);
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

    /// Thousands of inputs a run: nothing panics, the numbers stay inside their digit counts, and a plain name survives.
    mod props {
        use super::*;
        use proptest::prelude::*;

        proptest! {
            #[test]
            fn parse_never_panics(input in "\\PC{0,80}") {
                let r = parse(&input);
                prop_assert!(r.episode.is_none_or(|e| e <= 9999));
                prop_assert!(r.season.is_none_or(|s| s <= 99));
                prop_assert!(r.title.len() <= input.len());
            }

            #[test]
            fn parse_manga_never_panics(input in "\\PC{0,80}") {
                let r = parse_manga(&input);
                prop_assert!(r.episode.is_none_or(|c| c <= 99999));
                prop_assert!(r.title.len() <= input.len());
            }

            #[test]
            fn a_plain_fansub_name_round_trips(
                name in "[A-Za-z]{1,8}( [A-Za-z]{1,8}){0,3}",
                ep in 1u32..=1899,
            ) {
                let r = parse(&format!("{name} - {ep:02}.mkv"));
                prop_assert_eq!(r.title, name);
                prop_assert_eq!(r.episode, Some(ep));
                prop_assert!(r.episode_title.is_none());
            }

            #[test]
            fn a_plain_chapter_name_round_trips(
                name in "[A-Za-z]{1,8}( [A-Za-z]{1,8}){0,3}",
                ch in 1u32..=99999,
            ) {
                let r = parse_manga(&format!("{name} - Chapter {ch}"));
                prop_assert_eq!(r.title, name);
                prop_assert_eq!(r.episode, Some(ch));
                prop_assert!(r.episode_marked);
            }
        }
    }
}
