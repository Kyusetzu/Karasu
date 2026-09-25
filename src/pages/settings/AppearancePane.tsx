import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette } from "lucide-react";
import * as api from "@/api/anilist";
import { UI_ZOOM_STEPS } from "@/lib/uiZoom";
import { isAndroid, usePlatform } from "@/stores/platform";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ACCENT_PRESETS } from "@/lib/designTokens";
import {
  COVER_COLS_MAX,
  COVER_COLS_MIN,
  DENSITIES,
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
import { ColorPicker, Row, SELECT, Toggle } from "./shared";
import { STATUS_COLOR_ORDER, isDefaultPalette } from "@/lib/statusColors";
import type { MediaListStatus } from "@/api/types";
const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export function AppearanceSection() {
  const { t } = useTranslation();
  const [lang, setLang] = useState<LanguageSetting>(getLanguageSetting());
  const [showCustomAccent, setShowCustomAccent] = useState(false);
  // One picker at a time; the swatch itself is the affordance, as with the accent's Palette toggle.
  const [editingStatus, setEditingStatus] = useState<MediaListStatus | null>(null);
  // The covers field's text while editing: keep the draft, a bound number was uneditable on Android.
  const [colsDraft, setColsDraft] = useState<string | null>(null);
  const themeMode = useTheme((s) => s.mode);
  const accent = useTheme((s) => s.accent);
  const coverCols = useTheme((s) => s.coverCols);
  const setCoverCols = useTheme((s) => s.setCoverCols);
  const reduceMotion = useTheme((s) => s.reduceMotion);
  const density = useTheme((s) => s.density);
  const setDensity = useTheme((s) => s.setDensity);
  const setReduceMotion = useTheme((s) => s.setReduceMotion);
  const setThemeMode = useTheme((s) => s.setMode);
  const setAccent = useTheme((s) => s.setAccent);
  const accentSource = useTheme((s) => s.accentSource);
  const systemAccent = useTheme((s) => s.systemAccent);
  const setAccentSource = useTheme((s) => s.setAccentSource);
  const followSystem = accentSource === "system";
  const statusColors = useTheme((s) => s.statusColors);
  const setStatusColor = useTheme((s) => s.setStatusColor);
  const resetStatusColors = useTheme((s) => s.resetStatusColors);

  const changeLanguage = (setting: LanguageSetting) => {
    setLang(setting);
    setLanguageSetting(setting);
  };

  // The window zoom lives in Rust because it applies before first paint; Android has none, so no row.
  const android = isAndroid(usePlatform((s) => s.info));
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    if (!api.isTauri || android) return;
    api.getUiZoom().then(setZoom).catch(() => {});
    // Ctrl+plus while this pane is open changes the same setting, so the select follows it.
    const onZoom = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    window.addEventListener(api.UI_ZOOM_EVENT, onZoom);
    return () => window.removeEventListener(api.UI_ZOOM_EVENT, onZoom);
  }, [android]);
  const changeZoom = async (percent: number) => {
    setZoom(percent);
    try {
      setZoom(await api.setUiZoom(percent));
    } catch {
      // The row keeps the chosen number; the next launch reads what stuck.
    }
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

        {!android && zoom !== null && (
          <Row label={t("settings.uiZoom")} hint={t("settings.uiZoomHint")}>
            <select
              value={zoom}
              onChange={(e) => changeZoom(Number(e.target.value))}
              className={SELECT}
              aria-label={t("settings.uiZoom")}
            >
              {/* A stored value off the list is still shown, as its own option. */}
              {(UI_ZOOM_STEPS as readonly number[]).includes(zoom) ? null : (
                <option value={zoom}>{zoom} %</option>
              )}
              {UI_ZOOM_STEPS.map((p) => (
                <option key={p} value={p}>
                  {p} %
                </option>
              ))}
            </select>
          </Row>
        )}

        <Row label={t("settings.coverCols")} hint={t("settings.coverColsHint")}>
          {/* A typed number, not a slider, because the wanted range outgrows a slider's track; the store clamps. */}
          <input
            type="number"
            min={COVER_COLS_MIN}
            max={COVER_COLS_MAX}
            step={1}
            value={colsDraft ?? coverCols}
            onChange={(e) => {
              const raw = e.target.value;
              setColsDraft(raw);
              const n = Number(raw);
              // The store clamps the range; this guard only keeps transient states like "" from committing.
              if (raw !== "" && Number.isFinite(n) && n >= COVER_COLS_MIN) {
                setCoverCols(n);
              }
            }}
            onBlur={() => setColsDraft(null)}
            aria-label={t("settings.coverCols")}
            className="h-8 w-16 rounded-control border border-surface-700 bg-surface-900 px-2 text-right text-sm tabular-nums text-ink-100 focus:border-accent-500 focus:outline-none"
          />
        </Row>
        {/* One example row at the chosen count, so the number becomes a picture before the pane closes. */}
        <div
          aria-hidden
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${coverCols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: coverCols }, (_, i) => (
            <div key={i} className="aspect-[2/3] rounded-inner bg-surface-800" />
          ))}
        </div>

        <Row label={t("settings.density")} hint={t("settings.densityHint")}>
          <select
            value={density}
            onChange={(e) => setDensity(e.target.value as Density)}
            className={SELECT}
            aria-label={t("settings.density")}
          >
            {DENSITIES.map((d) => (
              <option key={d} value={d}>
                {t(`settings.density_${d}`)}
              </option>
            ))}
          </select>
        </Row>

        <Toggle
          checked={reduceMotion}
          onChange={setReduceMotion}
          label={t("settings.reduceMotion")}
          hint={t("settings.reduceMotionHint")}
        />

        {/* Disabled where the platform publishes no accent, with the hint saying so; the swatch stays as the fallback. */}
        <Toggle
          checked={followSystem && systemAccent !== null}
          onChange={(v) => setAccentSource(v ? "system" : "custom")}
          label={t("settings.accentSystem")}
          hint={systemAccent === null ? t("settings.accentSystemUnavailable") : t("settings.accentSystemHint")}
          disabled={systemAccent === null}
        />

        <div className={cn("space-y-3 py-1", followSystem && systemAccent !== null && "pointer-events-none opacity-55")}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
            <span className="block text-ink-100">{t("settings.accent")}</span>
            {/* Wraps: the swatches plus the custom button outgrow a phone card. */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {ACCENT_PRESETS.map((hex) => (
                <button
                  key={hex}
                  onClick={() => setAccent(hex)}
                  className="size-6 rounded-full transition"
                  style={{
                    backgroundColor: hex,
                    // A double ring rather than a border, so the mark holds on a swatch of any hue.
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

        {/* Labelled swatches, unlike the accent row: picking one means nothing without knowing the status. */}
        <div className="space-y-2 border-t border-hair pt-3">
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
                  className="flex flex-1 items-center gap-2.5 rounded-inner py-0.5 text-left text-sm text-ink-300 transition-surface hover:text-ink-100"
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
                  {/* Anime wording: the two lists share a palette, and it is the same status either way. */}
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
