import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ACCENT_PRESETS,
  COVER_COLS_MAX,
  COVER_COLS_MIN,
  useTheme,
  type ThemeMode,
} from "@/stores/theme";
import {
  getLanguageSetting,
  setLanguageSetting,
  SUPPORTED_LANGUAGES,
  type LanguageSetting,
} from "@/i18n";
import { ColorPicker, Row, SELECT, Toggle } from "./shared";
import { STATUS_COLOR_ORDER, isDefaultPalette } from "@/lib/statusColors";
import type { MediaListStatus } from "@/api/types";
const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export function AppearanceSection() {
  const { t } = useTranslation();
  const [lang, setLang] = useState<LanguageSetting>(getLanguageSetting());
  const [showCustomAccent, setShowCustomAccent] = useState(false);
  // One picker at a time. Six open pickers would be a wall, and the swatch
  // itself is the affordance — same shape as the accent's Palette toggle.
  const [editingStatus, setEditingStatus] = useState<MediaListStatus | null>(null);
  const themeMode = useTheme((s) => s.mode);
  const accent = useTheme((s) => s.accent);
  const coverCols = useTheme((s) => s.coverCols);
  const setCoverCols = useTheme((s) => s.setCoverCols);
  const reduceMotion = useTheme((s) => s.reduceMotion);
  const setReduceMotion = useTheme((s) => s.setReduceMotion);
  const setThemeMode = useTheme((s) => s.setMode);
  const setAccent = useTheme((s) => s.setAccent);
  const statusColors = useTheme((s) => s.statusColors);
  const setStatusColor = useTheme((s) => s.setStatusColor);
  const resetStatusColors = useTheme((s) => s.resetStatusColors);

  const changeLanguage = (setting: LanguageSetting) => {
    setLang(setting);
    setLanguageSetting(setting);
  };

  return (
    <Card>
      <CardTitle>{t("settings.pane_appearance")}</CardTitle>
      <div className="mt-3 space-y-3">
        <Row label={t("settings.language")} hint={t("settings.languageHint")}>
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
        </Row>

        <Row label={t("settings.theme")}>
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
        </Row>

        <Row label={t("settings.coverCols")} hint={t("settings.coverColsHint")}>
          {/* The content filter's slider idiom, with the number shown beside
              it — a count is exact, so the value is the label. */}
          <span className="flex w-44 items-center gap-2.5">
            <input
              type="range"
              min={COVER_COLS_MIN}
              max={COVER_COLS_MAX}
              step={1}
              value={coverCols}
              onChange={(e) => setCoverCols(Number(e.target.value))}
              aria-label={t("settings.coverCols")}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-700 accent-accent-500"
            />
            <span className="w-5 text-right text-xs tabular-nums text-ink-300">
              {coverCols}
            </span>
          </span>
        </Row>

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

        {/* Six colours that have to be told apart at ring width, so this is a
            list of labelled swatches rather than the accent's unlabelled row:
            picking one means nothing without knowing which status it is. */}
        <div className="space-y-2 border-t border-surface-800 pt-3">
          <div className="flex items-center justify-between gap-4">
            <span className="block text-sm text-ink-100">
              {t("settings.statusColors")}
            </span>
            {!isDefaultPalette(statusColors) && (
              <button
                type="button"
                onClick={resetStatusColors}
                className="text-xs text-accent-400 hover:underline"
              >
                {t("settings.statusColorsReset")}
              </button>
            )}
          </div>
          <p className="text-xs text-ink-600">{t("settings.statusColorsHint")}</p>
          <div className="space-y-1">
            {STATUS_COLOR_ORDER.map((status) => (
              <div key={status} className="flex items-center justify-between gap-4 py-0.5">
                <button
                  type="button"
                  onClick={() => setEditingStatus(editingStatus === status ? null : status)}
                  aria-expanded={editingStatus === status}
                  className="flex flex-1 items-center gap-2.5 rounded-md py-0.5 text-left text-sm text-ink-300 transition-surface hover:text-ink-100"
                >
                  <span
                    className="size-4 shrink-0 rounded-full"
                    style={{
                      backgroundColor: statusColors[status],
                      boxShadow:
                        editingStatus === status
                          ? "0 0 0 2px var(--color-surface-900), 0 0 0 3.5px var(--color-accent-500)"
                          : undefined,
                    }}
                  />
                  {/* Anime wording: the two lists share a palette, and
                      "Watching"/"Reading" is the same status either way. */}
                  {t(`status.ANIME.${status}`)}
                </button>
              </div>
            ))}
          </div>
          {editingStatus && (
            <ColorPicker
              value={statusColors[editingStatus]}
              onChange={(hex) => setStatusColor(editingStatus, hex)}
            />
          )}
        </div>
      </div>
    </Card>
  );
}
