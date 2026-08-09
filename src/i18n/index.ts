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

export default i18n;
