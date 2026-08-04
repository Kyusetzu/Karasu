import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { de } from "./de";

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

export function setLanguageSetting(setting: LanguageSetting) {
  if (setting === "system") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, setting);
  }
  i18n.changeLanguage(resolveLanguage(setting));
}

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
