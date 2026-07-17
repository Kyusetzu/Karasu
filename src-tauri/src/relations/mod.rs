//! Episoden-Redirects aus erengy/anime-relations (gleiche Datenquelle wie
//! Taiga): mappt z. B. "Episode 25" eines Combined-Releases auf S2E1 des
//! richtigen AniList-Eintrags.
//!
//! Zeilenformat:
//! `- MAL|Kitsu|AniList:26-51 -> MAL|Kitsu|AniList:1-26[!]`
//! IDs können `?` (unbekannt) oder `~` (wie links) sein; `!` bedeutet,
//! dass die Regel auch für die Ziel-ID selbst gilt.

use std::sync::RwLock;

const SOURCE_URL: &str =
    "https://raw.githubusercontent.com/erengy/anime-relations/master/anime-relations.txt";
/// Cache-Lebensdauer: 7 Tage
const MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, PartialEq)]
pub struct Rule {
    pub src_id: i64,
    pub src_start: u32,
    /// None = offenes Ende ("26-?")
    pub src_end: Option<u32>,
    pub dst_id: i64,
    pub dst_start: u32,
}

pub struct Relations(pub RwLock<Vec<Rule>>);

fn parse_id(field: &str, fallback: Option<i64>) -> Option<i64> {
    match field {
        "~" => fallback,
        "?" => None,
        _ => field.parse().ok(),
    }
}

fn parse_range(field: &str) -> Option<(u32, Option<u32>)> {
    match field.split_once('-') {
        None => {
            let n = field.parse().ok()?;
            Some((n, Some(n)))
        }
        Some((a, "?")) => Some((a.parse().ok()?, None)),
        Some((a, b)) => Some((a.parse().ok()?, Some(b.parse().ok()?))),
    }
}

/// Parst eine Regelzeile; `0` als Episodenangabe (ganze Serie) wird als 1 behandelt.
fn parse_line(line: &str) -> Option<Vec<Rule>> {
    let line = line.trim().strip_prefix("- ")?;
    let (src, dst) = line.split_once("->")?;
    let (src, dst) = (src.trim(), dst.trim());

    let self_redirect = dst.ends_with('!');
    let dst = dst.trim_end_matches('!');

    let (src_ids, src_range) = src.split_once(':')?;
    let (dst_ids, dst_range) = dst.split_once(':')?;

    let src_anilist = parse_id(src_ids.split('|').nth(2)?, None)?;
    let dst_anilist = parse_id(dst_ids.split('|').nth(2)?, Some(src_anilist))?;

    let (src_start, src_end) = parse_range(src_range)?;
    let (dst_start, _) = parse_range(dst_range)?;

    let mut rules = vec![Rule {
        src_id: src_anilist,
        src_start: src_start.max(1),
        src_end,
        dst_id: dst_anilist,
        dst_start: dst_start.max(1),
    }];
    if self_redirect && dst_anilist != src_anilist {
        rules.push(Rule {
            src_id: dst_anilist,
            src_start: src_start.max(1),
            src_end,
            dst_id: dst_anilist,
            dst_start: dst_start.max(1),
        });
    }
    Some(rules)
}

pub fn parse_rules(text: &str) -> Vec<Rule> {
    let mut in_rules = false;
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("::rules") {
            in_rules = true;
            continue;
        }
        if !in_rules || !trimmed.starts_with("- ") {
            continue;
        }
        if let Some(rules) = parse_line(trimmed) {
            out.extend(rules);
        }
    }
    out
}

/// Wendet den ersten passenden Redirect an.
pub fn redirect(rules: &[Rule], media_id: i64, episode: u32) -> Option<(i64, u32)> {
    rules.iter().find_map(|r| {
        let in_range = media_id == r.src_id
            && episode >= r.src_start
            && r.src_end.is_none_or(|end| episode <= end);
        in_range.then(|| (r.dst_id, r.dst_start + (episode - r.src_start)))
    })
}

/// Lädt Regeln aus dem Datei-Cache und aktualisiert sie bei Bedarf im
/// Hintergrund aus dem GitHub-Repo.
pub fn spawn_loader(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let Ok(dir) = app.path().app_data_dir() else {
            return;
        };
        let path = dir.join("anime-relations.txt");

        // 1) Vorhandenen Cache sofort laden
        if let Ok(text) = std::fs::read_to_string(&path) {
            let rules = parse_rules(&text);
            *app.state::<Relations>().0.write().unwrap() = rules;
        }

        // 2) Bei veraltetem/fehlendem Cache neu laden
        let stale = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_none_or(|age| age.as_secs() > MAX_AGE_SECS);
        if !stale {
            return;
        }
        let Ok(resp) = reqwest::get(SOURCE_URL).await else {
            return;
        };
        let Ok(text) = resp.text().await else {
            return;
        };
        let rules = parse_rules(&text);
        if rules.is_empty() {
            return;
        }
        let _ = std::fs::write(&path, &text);
        *app.state::<Relations>().0.write().unwrap() = rules;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "
::meta
- version: 1.3.0

::rules

# Fullmetal Alchemist: Brotherhood
- 1575|1575|1575:26-51 -> 2759|2759|2759:1-26
# Open end
- 100|100|500:13-? -> 101|101|501:1-?
# Self redirect
- 200|200|600:25-48 -> 201|201|601:1-24!
# Same id (~)
- 300|300|700:14 -> ~|~|~:1
# Unknown AniList id wird ignoriert
- 400|400|?:1-12 -> 401|401|?:1-12
";

    #[test]
    fn parses_basic_rule() {
        let rules = parse_rules(SAMPLE);
        assert!(rules.contains(&Rule {
            src_id: 1575,
            src_start: 26,
            src_end: Some(51),
            dst_id: 2759,
            dst_start: 1,
        }));
    }

    #[test]
    fn redirect_maps_episode() {
        let rules = parse_rules(SAMPLE);
        assert_eq!(redirect(&rules, 1575, 26), Some((2759, 1)));
        assert_eq!(redirect(&rules, 1575, 40), Some((2759, 15)));
        assert_eq!(redirect(&rules, 1575, 25), None);
        assert_eq!(redirect(&rules, 1575, 52), None);
    }

    #[test]
    fn open_ended_range() {
        let rules = parse_rules(SAMPLE);
        assert_eq!(redirect(&rules, 500, 13), Some((501, 1)));
        assert_eq!(redirect(&rules, 500, 999), Some((501, 987)));
    }

    #[test]
    fn self_redirect_flag() {
        let rules = parse_rules(SAMPLE);
        // Regel gilt auch für die Ziel-ID selbst
        assert_eq!(redirect(&rules, 601, 25), Some((601, 1)));
    }

    #[test]
    fn tilde_uses_source_id() {
        let rules = parse_rules(SAMPLE);
        assert_eq!(redirect(&rules, 700, 14), Some((700, 1)));
    }

    #[test]
    fn unknown_ids_skipped() {
        let rules = parse_rules(SAMPLE);
        assert!(redirect(&rules, 400, 5).is_none());
    }
}
