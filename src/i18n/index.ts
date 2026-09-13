import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";

// Not dead: `i18nKeys.test.ts` reaches it as a property of the module object, which a grep for the import misses.
export { en };

/** English is primary; the app follows the system language until the Settings dropdown overrides it in localStorage. */

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

/** Loads German on demand; English stays in the entry chunk, and `de.ts`'s type-only import keeps key parity intact. */
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

/** Awaited by the entry before the first render, so a German start does not paint English for a frame and swap. */
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

/** Mirrors the language into SQLite for Rust's notifications and tray menu; fire-and-forget, it is only a copy. */
function mirrorToBackend(lng: string) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("set_ui_language", { language: lng }))
    .catch(() => {});
}

/** Keeps `<html lang>` on the rendered language, which screen readers and the WebView's spell-check read from. */
i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
  mirrorToBackend(lng);
});
if (typeof document !== "undefined") {
  const lng = resolveLanguage(getLanguageSetting());
  document.documentElement.lang = lng;
  // On start too: `languageChanged` does not fire for the language `init` was given, and "system" can resolve anew.
  mirrorToBackend(lng);
}

export default i18n;
