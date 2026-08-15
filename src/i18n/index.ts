import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";

export { en };

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

/**
 * Loads a language's bundle if it is not already registered.
 *
 * Only German is ever fetched this way. English is the fallback and by far the
 * common case, so it stays in the entry chunk where `init` can use it
 * synchronously; German is ~30 kB of source that most starts never touch.
 *
 * `de.ts`'s `import { en }` is type-only (`de: typeof en`), so it erases at
 * build time and this split does not weaken the key-parity guarantee.
 */
async function ensureBundle(lng: "en" | "de"): Promise<void> {
  if (lng === "en" || i18n.hasResourceBundle(lng, "translation")) return;
  const { de } = await import("./de");
  i18n.addResourceBundle(lng, "translation", de);
}

export async function setLanguageSetting(setting: LanguageSetting) {
  if (setting === "system") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, setting);
  }
  const lng = resolveLanguage(setting);
  // Before the switch, or the UI would render the keys it has not got yet.
  await ensureBundle(lng);
  await i18n.changeLanguage(lng);
}

/**
 * Awaited by the entry before the first render.
 *
 * Without this a German start would paint English for a frame and then swap,
 * which is a worse trade than the 30 kB it saves. Resolves in a microtask for an
 * English start, so that path pays nothing at all — and over `tauri://` the
 * German chunk is a local read rather than a download.
 */
export async function initLanguage(): Promise<void> {
  await ensureBundle(resolveLanguage(getLanguageSetting()));
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: resolveLanguage(getLanguageSetting()),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

/**
 * Mirrors the language into SQLite, where Rust can read it.
 *
 * Rust composes every desktop notification, every row in the bell and the tray
 * menu, and has no access to this setting — it lives in localStorage, inside
 * the WebView. Without the mirror all of those are English whatever the
 * interface says around them.
 *
 * Fire-and-forget on purpose: it is a copy of something already stored, so a
 * failed write costs one notification in the wrong language, not a lost
 * setting. It is also the reason this is not awaited anywhere — nothing on
 * screen depends on it.
 */
function mirrorToBackend(lng: string) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("set_ui_language", { language: lng }))
    .catch(() => {});
}

/**
 * Keeps `<html lang>` on the language actually being rendered.
 *
 * `index.html` ships `lang="en"` and nothing ever moved it, so a German UI
 * claimed to be English — which is what a screen reader picks its voice and
 * pronunciation rules from, and what the WebView hyphenates and spell-checks
 * by. Registered rather than set once, because the language can change at
 * runtime from the Appearance pane.
 */
i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
  mirrorToBackend(lng);
});
if (typeof document !== "undefined") {
  const lng = resolveLanguage(getLanguageSetting());
  document.documentElement.lang = lng;
  // On start as well as on change: `languageChanged` does not fire for the
  // language `init` was given, and "system" can resolve differently on a
  // machine whose locale changed since the last run.
  mirrorToBackend(lng);
}

export default i18n;
