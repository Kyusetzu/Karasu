import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Language handling: English is the primary language. On first start the
 * app follows the system language (WebView2 reports it via
 * navigator.language); the dropdown in Settings acts as an override and
 * is persisted in localStorage.
 */

export type LanguageSetting = "system" | "en" | "de";
const STORAGE_KEY = "karasu-lang";

export const SUPPORTED_LANGUAGES: { value: LanguageSetting; label: string }[] = [
  { value: "system", label: "System" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
];

export function getLanguageSetting(): LanguageSetting {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "en" || stored === "de" ? stored : "system";
}

function systemLanguage(): "en" | "de" {
  return navigator.language?.toLowerCase().startsWith("de") ? "de" : "en";
}

export function resolveLanguage(setting: LanguageSetting): "en" | "de" {
  return setting === "system" ? systemLanguage() : setting;
}

export function setLanguageSetting(setting: LanguageSetting) {
  if (setting === "system") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, setting);
  }
  i18n.changeLanguage(resolveLanguage(setting));
}

const en = {
  nav: {
    dashboard: "Overview",
    list: "My List",
    search: "Search",
    seasonal: "Seasonal",
    settings: "Settings",
  },
  window: {
    minimize: "Minimize",
    maximize: "Maximize",
    closeToTray: "Close (to tray)",
    close: "Close",
  },
  common: {
    save: "Save",
    saved: "Saved ✓",
    cancel: "Cancel",
    add: "Add",
    remove: "Remove",
    confirmRemove: "Really remove?",
    retry: "Try again",
    loading: "Loading …",
    error: "Error: {{message}}",
    episodes: "Episodes",
    episode: "Episode {{n}}",
    status: "Status",
    progress: "Progress",
    score: "Score",
    reload: "Reload",
    edit: "Edit",
    plusOne: "Episode +1",
  },
  status: {
    CURRENT: "Watching",
    REPEATING: "Rewatching",
    COMPLETED: "Completed",
    PAUSED: "Paused",
    DROPPED: "Dropped",
    PLANNING: "Planning",
  },
  season: {
    WINTER: "Winter",
    SPRING: "Spring",
    SUMMER: "Summer",
    FALL: "Fall",
  },
  sort: {
    updated: "Last updated",
    title: "Title",
    score: "Score",
    progress: "Progress",
  },
  relation: {
    PREQUEL: "Prequel",
    SEQUEL: "Sequel",
    SIDE_STORY: "Side story",
    SPIN_OFF: "Spin-off",
    PARENT: "Parent story",
    ALTERNATIVE: "Alternative",
    SUMMARY: "Summary",
    CHARACTER: "Characters",
    OTHER: "Other",
    ADAPTATION: "Adaptation",
    SOURCE: "Source",
  },
  dashboard: {
    welcomeTitle: "Welcome to Karasu 🐦‍⬛",
    welcomeText:
      "Your anime tracker for AniList. Connect your account to manage your list and track your progress automatically.",
    connect: "Connect with AniList",
    continueWatching: "Continue watching",
    nothingWatching: "You are not watching anything — browse the",
    currentSeason: "current season",
    upcoming: "Airing soon",
    noUpcoming: "No upcoming episodes on your list.",
    stats: "Statistics",
    statAnime: "Anime",
    statEpisodes: "Episodes",
    statDays: "Days watched",
    statMeanScore: "Mean score",
    youAreAt: "you are at {{n}}",
    airingNow: "now",
    airingInDays: "in {{d}}d {{h}}h",
    airingInHours: "in {{h}}h {{m}}m",
    markWatched: "Mark episode {{n}} as watched",
  },
  list: {
    connectPrompt: "Connect with AniList to see your list.",
    toSettings: "Go to Settings",
    loading: "Loading your list …",
    loadError: "Failed to load: {{message}}",
    title: "My List",
    offline: "Offline — showing local data.",
    pending: "{{count}} change(s) waiting to sync.",
    syncNow: "Sync now",
    filterPlaceholder: "Search your list …",
    gridView: "Grid view",
    listView: "List view",
    empty: "No entries.",
    progressMax: "Progress (max. {{max}})",
    scoreRange: "Score (0–10)",
  },
  search: {
    title: "Search",
    placeholder: "Search anime on AniList …",
    searching: "Searching …",
    noResults: "No results for “{{term}}”.",
  },
  seasonal: {
    title: "Seasonal",
    prev: "Previous season",
    next: "Next season",
    loading: "Loading season …",
  },
  detail: {
    back: "Back",
    minutes: "{{n}} min",
    openOnAniList: "Open on AniList",
    nextEpisode: "Episode {{n}} on {{date}}",
    myEntry: "My entry",
    addToList: "Add to list",
    description: "Description",
    related: "Related anime",
  },
  media: {
    addPlanning: "Add to Planning",
    onList: "On your list",
  },
  nowPlaying: {
    heading: "Now playing · {{process}}",
    updateIn: "Progress will update in {{time}}",
    watching: "Watching …",
    confirmPrompt: "Mark episode {{n}} as watched?",
    updating: "Updating …",
    updated: "Progress updated (episode {{n}})",
    blocked: "Auto-update not possible",
    skipped: "Update skipped.",
    yourProgress: "Your progress: {{progress}}",
    noMatch: "No entry from your list recognized.",
    updateNow: "Now",
    updateNowTitle: "Update progress now",
    skipTitle: "Don't update this episode",
    soon: "soon",
  },
  settings: {
    title: "Settings",
    account: "AniList account",
    profileLink: "Profile on AniList",
    logout: "Log out",
    connectTitle: "Connect with AniList",
    stepLogin:
      "Log in on the AniList page that opens and copy the token shown there.",
    openLogin: "Open login page",
    tokenPlaceholder: "Paste access token",
    connect: "Connect",
    checking: "Checking …",
    stepClientId:
      "No built-in client ID found. Create an API client in your AniList developer settings (redirect URL {{url}}) and enter its ID here.",
    openDeveloper: "Open developer settings",
    clientIdPlaceholder: "e.g. 12345",
    tracking: "Automatic tracking",
    trackingEnable: "Update progress automatically",
    trackingEnableHint:
      "Mark detected episodes as watched on AniList after the threshold.",
    trackingConfirm: "Ask before updating",
    trackingConfirmHint: "Show a confirmation in the app before every update.",
    threshold: "Threshold (minutes)",
    thresholdHint: "0 = automatic (two thirds of the episode length)",
    discord: "Discord Rich Presence",
    discordEnable: "Show what you are watching on Discord",
    discordEnableHint: "Uses the built-in Karasu Discord application.",
    discordCustomId:
      "Optional: use your own Discord application ID instead of the built-in one.",
    discordAppIdPlaceholder: "Application ID (optional)",
    app: "App",
    autostart: "Start with Windows",
    autostartHint: "Launch Karasu in the background when you sign in.",
    language: "Language",
    languageHint: "“System” follows your Windows display language.",
  },
};

const de: typeof en = {
  nav: {
    dashboard: "Übersicht",
    list: "Meine Liste",
    search: "Suche",
    seasonal: "Saison",
    settings: "Einstellungen",
  },
  window: {
    minimize: "Minimieren",
    maximize: "Maximieren",
    closeToTray: "Schließen (in den Tray)",
    close: "Schließen",
  },
  common: {
    save: "Speichern",
    saved: "Gespeichert ✓",
    cancel: "Abbrechen",
    add: "Hinzufügen",
    remove: "Entfernen",
    confirmRemove: "Wirklich entfernen?",
    retry: "Erneut versuchen",
    loading: "Lade …",
    error: "Fehler: {{message}}",
    episodes: "Episoden",
    episode: "Episode {{n}}",
    status: "Status",
    progress: "Fortschritt",
    score: "Bewertung",
    reload: "Neu laden",
    edit: "Bearbeiten",
    plusOne: "Episode +1",
  },
  status: {
    CURRENT: "Schaue",
    REPEATING: "Rewatch",
    COMPLETED: "Abgeschlossen",
    PAUSED: "Pausiert",
    DROPPED: "Abgebrochen",
    PLANNING: "Geplant",
  },
  season: {
    WINTER: "Winter",
    SPRING: "Frühling",
    SUMMER: "Sommer",
    FALL: "Herbst",
  },
  sort: {
    updated: "Zuletzt aktualisiert",
    title: "Titel",
    score: "Bewertung",
    progress: "Fortschritt",
  },
  relation: {
    PREQUEL: "Vorgänger",
    SEQUEL: "Fortsetzung",
    SIDE_STORY: "Side Story",
    SPIN_OFF: "Spin-off",
    PARENT: "Hauptserie",
    ALTERNATIVE: "Alternative",
    SUMMARY: "Zusammenfassung",
    CHARACTER: "Charaktere",
    OTHER: "Sonstiges",
    ADAPTATION: "Adaption",
    SOURCE: "Vorlage",
  },
  dashboard: {
    welcomeTitle: "Willkommen bei Karasu 🐦‍⬛",
    welcomeText:
      "Dein Anime-Tracker für AniList. Verbinde deinen Account, um deine Liste zu verwalten und deinen Fortschritt automatisch zu tracken.",
    connect: "Mit AniList verbinden",
    continueWatching: "Weiterschauen",
    nothingWatching: "Du schaust gerade nichts — stöbere in der",
    currentSeason: "aktuellen Saison",
    upcoming: "Demnächst",
    noUpcoming: "Keine anstehenden Episoden in deiner Liste.",
    stats: "Statistik",
    statAnime: "Anime",
    statEpisodes: "Episoden",
    statDays: "Tage geschaut",
    statMeanScore: "Ø Bewertung",
    youAreAt: "du bist bei {{n}}",
    airingNow: "jetzt",
    airingInDays: "in {{d}} T {{h}} Std",
    airingInHours: "in {{h}} Std {{m}} min",
    markWatched: "Episode {{n}} gesehen",
  },
  list: {
    connectPrompt: "Verbinde dich mit AniList, um deine Liste zu sehen.",
    toSettings: "Zu den Einstellungen",
    loading: "Lade deine Liste …",
    loadError: "Fehler beim Laden: {{message}}",
    title: "Meine Liste",
    offline: "Offline — zeige lokalen Stand.",
    pending: "{{count}} Änderung(en) warten auf Synchronisation.",
    syncNow: "Jetzt synchronisieren",
    filterPlaceholder: "In der Liste suchen …",
    gridView: "Rasteransicht",
    listView: "Listenansicht",
    empty: "Keine Einträge.",
    progressMax: "Fortschritt (max. {{max}})",
    scoreRange: "Bewertung (0–10)",
  },
  search: {
    title: "Suche",
    placeholder: "Anime auf AniList suchen …",
    searching: "Suche …",
    noResults: "Keine Treffer für „{{term}}“.",
  },
  seasonal: {
    title: "Saison",
    prev: "Vorherige Saison",
    next: "Nächste Saison",
    loading: "Lade Saison …",
  },
  detail: {
    back: "Zurück",
    minutes: "{{n}} min",
    openOnAniList: "Auf AniList öffnen",
    nextEpisode: "Episode {{n}} am {{date}}",
    myEntry: "Mein Eintrag",
    addToList: "Zur Liste hinzufügen",
    description: "Beschreibung",
    related: "Verwandte Anime",
  },
  media: {
    addPlanning: "Zu Geplant hinzufügen",
    onList: "Auf deiner Liste",
  },
  nowPlaying: {
    heading: "Läuft gerade · {{process}}",
    updateIn: "Fortschritt wird in {{time}} aktualisiert",
    watching: "Wird geschaut …",
    confirmPrompt: "Episode {{n}} als gesehen markieren?",
    updating: "Aktualisiere …",
    updated: "Fortschritt aktualisiert (Episode {{n}})",
    blocked: "Auto-Update nicht möglich",
    skipped: "Update übersprungen.",
    yourProgress: "Dein Fortschritt: {{progress}}",
    noMatch: "Kein Eintrag deiner Liste erkannt.",
    updateNow: "Jetzt",
    updateNowTitle: "Fortschritt jetzt aktualisieren",
    skipTitle: "Diese Episode nicht aktualisieren",
    soon: "gleich",
  },
  settings: {
    title: "Einstellungen",
    account: "AniList-Account",
    profileLink: "Profil auf AniList",
    logout: "Abmelden",
    connectTitle: "Mit AniList verbinden",
    stepLogin:
      "Melde dich auf der AniList-Seite an, die sich öffnet, und kopiere den angezeigten Token hierher.",
    openLogin: "Login-Seite öffnen",
    tokenPlaceholder: "Access-Token einfügen",
    connect: "Verbinden",
    checking: "Prüfe …",
    stepClientId:
      "Keine eingebaute Client-ID gefunden. Erstelle einen API-Client in deinen AniList-Developer-Einstellungen (Redirect-URL {{url}}) und trage die ID hier ein.",
    openDeveloper: "Developer-Einstellungen öffnen",
    clientIdPlaceholder: "z. B. 12345",
    tracking: "Automatisches Tracking",
    trackingEnable: "Fortschritt automatisch aktualisieren",
    trackingEnableHint:
      "Erkannte Episoden nach Ablauf der Schwelle auf AniList als gesehen markieren.",
    trackingConfirm: "Vorher nachfragen",
    trackingConfirmHint:
      "Vor jedem Update eine Bestätigung in der App anzeigen.",
    threshold: "Schwelle (Minuten)",
    thresholdHint: "0 = automatisch (zwei Drittel der Episodenlänge)",
    discord: "Discord Rich Presence",
    discordEnable: "In Discord anzeigen, was du schaust",
    discordEnableHint: "Nutzt die eingebaute Karasu-Discord-Application.",
    discordCustomId:
      "Optional: eigene Discord-Application-ID statt der eingebauten verwenden.",
    discordAppIdPlaceholder: "Application-ID (optional)",
    app: "App",
    autostart: "Mit Windows starten",
    autostartHint: "Karasu beim Anmelden automatisch im Hintergrund starten.",
    language: "Sprache",
    languageHint: "„System“ folgt deiner Windows-Anzeigesprache.",
  },
};

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: resolveLanguage(getLanguageSetting()),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
