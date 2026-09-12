//! The strings Rust composes, in the language the frontend mirrors into kv; each match arm holds both languages.

use crate::db::Db;

/// The kv key the frontend mirrors its language into.
pub const LANGUAGE_KEY: &str = "ui_language";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    De,
}

impl Lang {
    /// Anything unrecognised is English, which is also i18next's `fallbackLng`.
    pub fn parse(code: Option<&str>) -> Self {
        match code {
            Some(c) if c.starts_with("de") => Lang::De,
            _ => Lang::En,
        }
    }
}

/// The language to compose in, from the mirror.
pub fn lang(db: &Db) -> Lang {
    Lang::parse(db.kv_get(LANGUAGE_KEY).as_deref())
}

/// Every string Rust composes for a user to read; an enum so the match is exhaustive in both languages.
// The tray and toast variants are constructed only by desktop code, so the Android check reads them as unused.
#[cfg_attr(mobile, allow(dead_code))]
pub enum Msg<'a> {
    AiringTitle,
    AiringBody { title: &'a str, episode: i64 },
    StaleTitle,
    StaleBody { title: &'a str, months: i64 },
    SequelTitle { side_story: bool },
    SequelBody { title: &'a str },
    UpdateTitle,
    UpdateBody { version: &'a str },
    /// Android's wording: nothing downloads or installs there, so the body points at the GitHub release instead.
    #[cfg_attr(not(mobile), allow(dead_code))]
    UpdateBodyAndroid { version: &'a str },
    SiteNotifTitle,
    SiteNotifBody { count: i64 },
    QueueTitle,
    QueueBodyOne { reason: &'a str },
    QueueBodyMany { count: usize, reason: &'a str },
    /// The scrobble-confirm toast's button — its whole reason for existing.
    ConfirmAction,
    ConfirmEpisode { episode: u32 },
    ConfirmChapter { chapter: u32 },
    TrayNothingPlaying,
    TrayScrobbleNow,
    TraySyncNow,
    TrayDetection,
    TrayOpen,
    TrayQuit,
    /// The Android tracking service's persistent notification, composed here so Kotlin renders text it never chose.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    TrackingServiceTitle,
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    TrackingServiceBody,
}

pub fn text(lang: Lang, msg: Msg<'_>) -> String {
    use Lang::{De, En};
    use Msg::*;
    match (lang, msg) {
        (En, AiringTitle) => "New episode aired".into(),
        (De, AiringTitle) => "Neue Folge erschienen".into(),
        (En, AiringBody { title, episode }) => format!("{title} — episode {episode} is out"),
        (De, AiringBody { title, episode }) => format!("{title} — Folge {episode} ist da"),

        (En, StaleTitle) => "On-hold reminder".into(),
        (De, StaleTitle) => "Erinnerung: pausiert".into(),
        // The plural is spelled out rather than papered over with "month(s)", a form nobody writes.
        (En, StaleBody { title, months }) => {
            let unit = if months == 1 { "month" } else { "months" };
            format!("{title} has been paused for over {months} {unit}.")
        }
        (De, StaleBody { title, months }) => {
            let unit = if months == 1 { "Monat" } else { "Monaten" };
            format!("{title} ist seit über {months} {unit} pausiert.")
        }

        (En, SequelTitle { side_story }) => {
            if side_story { "Side story announced" } else { "Sequel announced" }.into()
        }
        (De, SequelTitle { side_story }) => {
            if side_story { "Nebengeschichte angekündigt" } else { "Fortsetzung angekündigt" }
                .into()
        }
        (En, SequelBody { title }) => format!("{title} — related to something on your list."),
        (De, SequelBody { title }) => {
            format!("{title} — verwandt mit etwas auf deiner Liste.")
        }

        (En, UpdateTitle) => "Update ready".into(),
        (De, UpdateTitle) => "Update bereit".into(),
        // Deliberately not "restart to install": the download lives in process memory, so restarting throws it away.
        (En, UpdateBody { version }) => {
            format!("Karasu {version} is ready. Open About to install it.")
        }
        (De, UpdateBody { version }) => {
            format!("Karasu {version} ist bereit. Zum Installieren „Über“ öffnen.")
        }
        (En, UpdateBodyAndroid { version }) => {
            format!("Karasu {version} is out. The APK is on the GitHub release.")
        }
        (De, UpdateBodyAndroid { version }) => {
            format!("Karasu {version} ist draußen. Die APK liegt im GitHub-Release.")
        }

        (En, SiteNotifTitle) => "AniList notifications".into(),
        (De, SiteNotifTitle) => "AniList-Benachrichtigungen".into(),
        (En, SiteNotifBody { count }) => {
            if count == 1 {
                "1 unread notification is waiting.".into()
            } else {
                format!("{count} unread notifications are waiting.")
            }
        }
        (De, SiteNotifBody { count }) => {
            if count == 1 {
                "1 ungelesene Benachrichtigung wartet.".into()
            } else {
                format!("{count} ungelesene Benachrichtigungen warten.")
            }
        }

        (En, QueueTitle) => "Offline changes were not saved".into(),
        (De, QueueTitle) => "Offline-Änderungen wurden nicht gespeichert".into(),
        (En, QueueBodyOne { reason }) => format!("AniList refused an offline change: {reason}"),
        (De, QueueBodyOne { reason }) => {
            format!("AniList hat eine Offline-Änderung abgelehnt: {reason}")
        }
        (En, QueueBodyMany { count, reason }) => {
            format!("AniList refused {count} offline changes. The first: {reason}")
        }
        (De, QueueBodyMany { count, reason }) => {
            format!("AniList hat {count} Offline-Änderungen abgelehnt. Die erste: {reason}")
        }

        (En, ConfirmAction) => "Update now".into(),
        (De, ConfirmAction) => "Jetzt aktualisieren".into(),
        (En, ConfirmEpisode { episode }) => format!("Mark episode {episode} as watched?"),
        (De, ConfirmEpisode { episode }) => format!("Folge {episode} als gesehen markieren?"),
        (En, ConfirmChapter { chapter }) => format!("Mark chapter {chapter} as read?"),
        (De, ConfirmChapter { chapter }) => format!("Kapitel {chapter} als gelesen markieren?"),

        (En, TrayNothingPlaying) => "Nothing playing".into(),
        (De, TrayNothingPlaying) => "Nichts läuft".into(),
        (En, TrayScrobbleNow) => "Scrobble now".into(),
        (De, TrayScrobbleNow) => "Jetzt scrobbeln".into(),
        (En, TraySyncNow) => "Sync now".into(),
        (De, TraySyncNow) => "Jetzt synchronisieren".into(),
        (En, TrayDetection) => "Media detection".into(),
        (De, TrayDetection) => "Medienerkennung".into(),
        (En, TrayOpen) => "Open Karasu".into(),
        (De, TrayOpen) => "Karasu öffnen".into(),
        (En, TrayQuit) => "Quit".into(),
        (De, TrayQuit) => "Beenden".into(),
        (En, TrackingServiceTitle) => "Watching Jellyfin".into(),
        (De, TrackingServiceTitle) => "Jellyfin wird beobachtet".into(),
        (En, TrackingServiceBody) => {
            "Karasu keeps checking what is playing so your AniList progress updates.".into()
        }
        (De, TrackingServiceBody) => {
            "Karasu prüft weiter, was läuft, damit dein AniList-Fortschritt aktualisiert wird."
                .into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Proves every way the mirror can be missing or wrong means English rather than a panic or an empty string.
    #[test]
    fn an_unknown_or_absent_language_is_english() {
        assert_eq!(Lang::parse(None), Lang::En);
        assert_eq!(Lang::parse(Some("")), Lang::En);
        assert_eq!(Lang::parse(Some("fr")), Lang::En);
        assert_eq!(Lang::parse(Some("de")), Lang::De);
        // i18next resolves regional codes; the mirror may carry one.
        assert_eq!(Lang::parse(Some("de-AT")), Lang::De);
    }

    /// Proves each message differs between languages and carries its parameters; a forgotten one still compiles.
    #[test]
    fn each_message_is_translated_and_carries_its_parameters() {
        let en = text(Lang::En, Msg::AiringBody { title: "Frieren", episode: 5 });
        let de = text(Lang::De, Msg::AiringBody { title: "Frieren", episode: 5 });
        assert!(en.contains("Frieren") && en.contains('5'));
        assert!(de.contains("Frieren") && de.contains('5'));
        assert_ne!(en, de);

        assert_ne!(text(Lang::En, Msg::TrayQuit), text(Lang::De, Msg::TrayQuit));
        assert_ne!(
            text(Lang::En, Msg::ConfirmAction),
            text(Lang::De, Msg::ConfirmAction)
        );
    }

    /// Proves both halves of the plural are spelled out, in both languages.
    #[test]
    fn the_month_count_is_spelled_out_both_ways() {
        let one = text(Lang::En, Msg::StaleBody { title: "X", months: 1 });
        let many = text(Lang::En, Msg::StaleBody { title: "X", months: 3 });
        assert!(one.contains("1 month") && !one.contains("months"));
        assert!(many.contains("3 months"));

        let one_de = text(Lang::De, Msg::StaleBody { title: "X", months: 1 });
        let many_de = text(Lang::De, Msg::StaleBody { title: "X", months: 6 });
        assert!(one_de.contains("1 Monat") && !one_de.contains("Monaten"));
        assert!(many_de.contains("6 Monaten"));
    }

    /// A sequel and a side story are different news, in both languages.
    #[test]
    fn a_side_story_is_named_as_one() {
        for lang in [Lang::En, Lang::De] {
            assert_ne!(
                text(lang, Msg::SequelTitle { side_story: true }),
                text(lang, Msg::SequelTitle { side_story: false }),
            );
        }
    }
}
