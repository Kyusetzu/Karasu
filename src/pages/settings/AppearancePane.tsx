import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ACCENT_PRESETS,
  DENSITY_STEPS,
  useTheme,
  type Density,
  type ThemeMode,
} from "@/stores/theme";
import {
  getLanguageSetting,
  setLanguageSetting,
  SUPPORTED_LANGUAGES,
  type LanguageSetting,
} from "@/i18n";
import { ColorPicker, SELECT, Toggle } from "./shared";
const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export function AppearanceSection() {
  const { t } = useTranslation();
  const [lang, setLang] = useState<LanguageSetting>(getLanguageSetting());
  const [showCustomAccent, setShowCustomAccent] = useState(false);
  const themeMode = useTheme((s) => s.mode);
  const accent = useTheme((s) => s.accent);
  const density = useTheme((s) => s.density);
  const setDensity = useTheme((s) => s.setDensity);
  const reduceMotion = useTheme((s) => s.reduceMotion);
  const setReduceMotion = useTheme((s) => s.setReduceMotion);
  const setThemeMode = useTheme((s) => s.setMode);
  const setAccent = useTheme((s) => s.setAccent);

  const changeLanguage = (setting: LanguageSetting) => {
    setLang(setting);
    setLanguageSetting(setting);
  };

  return (
    <Card>
      <CardTitle>{t("settings.pane_appearance")}</CardTitle>
      <div className="mt-3 space-y-3">
        <label className="flex items-center justify-between gap-4 py-1 text-sm">
          <span>
            <span className="block text-ink-100">{t("settings.language")}</span>
            <span className="block text-xs text-ink-600">
              {t("settings.languageHint")}
            </span>
          </span>
          <select
            value={lang}
            onChange={(e) => changeLanguage(e.target.value as LanguageSetting)}
            className={SELECT}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-4 py-1 text-sm">
          <span className="block text-ink-100">{t("settings.theme")}</span>
          <select
            value={themeMode}
            onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
            className={SELECT}
          >
            {THEME_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`settings.theme_${m}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-4 py-1 text-sm">
          <span className="block">
            <span className="block text-ink-100">{t("settings.coverSize")}</span>
            <span className="block text-xs text-ink-600">
              {t("settings.coverSizeHint")}
            </span>
          </span>
          <select
            value={density}
            onChange={(e) => setDensity(e.target.value as Density)}
            className={SELECT}
          >
            {DENSITY_STEPS.map((d) => (
              <option key={d} value={d}>
                {t(`settings.coverSize_${d}`)}
              </option>
            ))}
          </select>
        </label>

        <Toggle
          checked={reduceMotion}
          onChange={setReduceMotion}
          label={t("settings.reduceMotion")}
          hint={t("settings.reduceMotionHint")}
        />

        <div className="space-y-3 py-1">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="block text-ink-100">{t("settings.accent")}</span>
            <div className="flex items-center gap-2">
              {ACCENT_PRESETS.map((hex) => (
                <button
                  key={hex}
                  onClick={() => setAccent(hex)}
                  className="size-6 rounded-full transition"
                  style={{
                    backgroundColor: hex,
                    // A double ring rather than a border: its gap is drawn in
                    // the panel colour, so the mark holds on a swatch of any
                    // hue instead of sinking into the darker ones.
                    boxShadow:
                      accent.toLowerCase() === hex.toLowerCase()
                        ? "0 0 0 2px var(--color-surface-900), 0 0 0 3.5px var(--color-accent-500)"
                        : undefined,
                  }}
                  aria-label={hex}
                  title={hex}
                />
              ))}
              <button
                type="button"
                onClick={() => setShowCustomAccent((v) => !v)}
                aria-expanded={showCustomAccent}
                className={cn(
                  "grid size-6 place-items-center rounded-full border border-surface-600 transition",
                  showCustomAccent && "border-accent-500 text-accent-400",
                )}
                title={t("settings.accentCustom")}
                aria-label={t("settings.accentCustom")}
              >
                <Palette className="size-3.25 text-current" />
              </button>
            </div>
          </div>
          {showCustomAccent && (
            <ColorPicker value={accent} onChange={setAccent} />
          )}
        </div>
      </div>
    </Card>
  );
}
