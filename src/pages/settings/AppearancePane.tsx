import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Palette, TriangleAlert } from "lucide-react";
import * as api from "@/api/anilist";
import { UI_ZOOM_STEPS } from "@/lib/uiZoom";
import { isAndroid, usePlatform } from "@/stores/platform";
import { Card, CardTitle } from "@/components/ui/card";
import { DisclosurePanel } from "@/components/ui/disclosure";
import { usePresentValue } from "@/hooks/usePresence";
import { cn } from "@/lib/utils";
import { ACCENT_PRESETS } from "@/lib/designTokens";
import { CONTRAST_MODES } from "@/lib/contrast";
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
import { ColorPicker, Row, Toggle } from "./shared";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { STATUS_COLOR_ORDER, STATUS_CONTRAST_MIN, isDefaultPalette, weakestContrast } from "@/lib/statusColors";
import type { MediaListStatus } from "@/api/types";
const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

const shownTheme = () => `${document.documentElement.dataset.theme ?? ""} ${document.documentElement.dataset.contrast ?? ""}`;
const watchShownTheme = (onChange: () => void) => {
  const watch = new MutationObserver(onChange);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });
  return () => watch.disconnect();
};

export function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const [lang, setLang] = useState<LanguageSetting>(getLanguageSetting());
  const [showCustomAccent, setShowCustomAccent] = useState(false);
  // One picker at a time; the swatch itself is the affordance, as with the accent's Palette toggle.
  const [editingStatus, setEditingStatus] = useState<MediaListStatus | null>(null);
  // The picker keeps its last status through the fold's exit, so it closes showing what it showed.
  const pickerStatus = usePresentValue(editingStatus).value;
  const pickerId = useId();
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
  const contrast = useTheme((s) => s.contrast);
  const setContrast = useTheme((s) => s.setContrast);
  const setAccent = useTheme((s) => s.setAccent);
  const accentSource = useTheme((s) => s.accentSource);
  const systemAccent = useTheme((s) => s.systemAccent);
  const setAccentSource = useTheme((s) => s.setAccentSource);
  const followSystem = accentSource === "system";
  // Subscribed to the document, because an OS theme or contrast change repaints it without a store change to render on.
  useSyncExternalStore(watchShownTheme, shownTheme);
  const surfaces = getComputedStyle(document.documentElement);
  const grounds = ["--color-surface-950", "--color-surface-900"].map((v) => surfaces.getPropertyValue(v).trim());
  // Rounded down, so a colour just short of the line never reads as reaching it.
  const ratioText = (r: number) =>
    new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.floor(r * 10) / 10);
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

  // Three cards by what a setting changes: the colours, the size of things, and the language and motion.
  return (
    <>
      <Card>
        <CardTitle>{t("settings.groupColour")}</CardTitle>
        <div className="mt-3 space-y-3">
          <ThemeChoice value={themeMode} onChange={setThemeMode} />

          <div className="space-y-2 py-1">
            <span className="block text-sm text-ink-100">{t("settings.contrast")}</span>
            <span className="block text-xs text-ink-600">{t("settings.contrastHint")}</span>
            <Segmented
              aria-label={t("settings.contrast")}
              value={contrast}
              onChange={(v) => setContrast(v)}
              segments={CONTRAST_MODES.map((m) => ({ value: m, label: t(`settings.contrast_${m}`) }))}
            />
          </div>

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
                  className="size-6 rounded-full transition-surface"
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
                aria-controls={`${pickerId}-accent`}
                className={cn(
                  "grid size-6 place-items-center rounded-full border border-surface-600 transition-surface",
                  showCustomAccent && "border-accent-500 text-accent-400",
                )}
                title={t("settings.accentCustom")}
                aria-label={t("settings.accentCustom")}
              >
                <Palette className="size-3.5 text-current" />
              </button>
            </div>
          </div>
          <DisclosurePanel open={showCustomAccent} id={`${pickerId}-accent`}>
            <ColorPicker value={accent} onChange={setAccent} />
          </DisclosurePanel>
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
            {STATUS_COLOR_ORDER.map((status) => {
              const weak = weakestContrast(statusColors[status], grounds);
              const low = weak != null && weak < STATUS_CONTRAST_MIN;
              return (
              <div key={status} className="flex items-center justify-between gap-4 py-0.5">
                <button
                  type="button"
                  onClick={() => setEditingStatus(editingStatus === status ? null : status)}
                  aria-expanded={editingStatus === status}
                  aria-controls={`${pickerId}-status`}
                  aria-describedby={low ? `${pickerId}-low-${status}` : undefined}
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
                {/* A warning, never a refusal: the colour is saved, and the row says what it costs in this theme. */}
                {low && (
                  <span
                    id={`${pickerId}-low-${status}`}
                    title={t("settings.statusColorLowHint")}
                    className="flex shrink-0 items-center gap-1 text-xs text-gold"
                  >
                    <TriangleAlert aria-hidden className="size-3.5" />
                    {t("settings.statusColorLow", { ratio: ratioText(weak) })}
                  </span>
                )}
              </div>
              );
            })}
          </div>
          <DisclosurePanel open={editingStatus != null} id={`${pickerId}-status`}>
            {pickerStatus && (
              <ColorPicker
                value={statusColors[pickerStatus]}
                onChange={(hex) => setStatusColor(pickerStatus, hex)}
              />
            )}
          </DisclosurePanel>
        </div>
        </div>
      </Card>

      <Card>
        <CardTitle>{t("settings.groupSize")}</CardTitle>
        <div className="mt-3 space-y-3">
        {!android && zoom !== null && (
          <Row label={t("settings.uiZoom")} hint={t("settings.uiZoomHint")}>
            <Select
              value={zoom}
              onChange={(e) => changeZoom(Number(e.target.value))}
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
            </Select>
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
          <Select
            value={density}
            onChange={(e) => setDensity(e.target.value as Density)}
            aria-label={t("settings.density")}
          >
            {DENSITIES.map((d) => (
              <option key={d} value={d}>
                {t(`settings.density_${d}`)}
              </option>
            ))}
          </Select>
        </Row>
        </div>
      </Card>

      <Card>
        <CardTitle>{t("settings.groupLanguage")}</CardTitle>
        <div className="mt-3 space-y-3">
        <Row label={t("settings.language")} hint={t("settings.languageHint")}>
          <Select
            value={lang}
            onChange={(e) => changeLanguage(e.target.value as LanguageSetting)}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Row>

        <Toggle
          checked={reduceMotion}
          onChange={setReduceMotion}
          label={t("settings.reduceMotion")}
          hint={t("settings.reduceMotionHint")}
        />
        </div>
      </Card>
    </>
  );
}

/** The theme as three miniatures of the app, native radios underneath so arrow keys and a screen reader work as usual. */
function ThemeChoice({ value, onChange }: { value: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <fieldset className="space-y-2 py-1">
      <legend className="mb-2 block text-sm text-ink-100">{t("settings.theme")}</legend>
      <div className="grid grid-cols-3 gap-3">
        {THEME_MODES.map((m) => (
          <label key={m} className="group flex cursor-pointer flex-col gap-1.5">
            <input
              type="radio"
              name={name}
              value={m}
              checked={value === m}
              onChange={() => onChange(m)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "relative block aspect-4/3 overflow-hidden rounded-control border-2 transition-surface",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-500",
                "forced-colors:peer-focus-visible:outline-[Highlight]",
                value === m ? "border-accent-500 forced-colors:border-[Highlight]" : "border-hair group-hover:border-surface-600",
              )}
            >
              {m === "system" ? (
                <>
                  <Miniature theme="dark" />
                  {/* The system choice is both, split corner to corner. */}
                  <span className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                    <Miniature theme="light" />
                  </span>
                </>
              ) : (
                <Miniature theme={m} />
              )}
            </span>
            <span className={cn("text-xs", value === m ? "font-semibold text-ink-100" : "text-ink-500")}>
              {t(`settings.theme_${m}`)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A window in miniature: a rail, a panel, two lines of text and the accent, in the given theme's own colours. */
function Miniature({ theme }: { theme: "dark" | "light" }) {
  const dark = theme === "dark";
  return (
    <span
      aria-hidden
      data-keep-colors
      className={cn("absolute inset-0 flex gap-1 p-1.5", dark ? "bg-preview-dark-page" : "bg-preview-light-page")}
    >
      <span className={cn("w-1/5 rounded-inner", dark ? "bg-preview-dark-panel" : "bg-preview-light-panel")} />
      <span className={cn("flex flex-1 flex-col gap-1 rounded-inner p-1.5", dark ? "bg-preview-dark-panel" : "bg-preview-light-panel")}>
        <span className={cn("h-1.5 w-2/3 rounded-full", dark ? "bg-preview-dark-ink/85" : "bg-preview-light-ink/85")} />
        <span className={cn("h-1.5 w-1/2 rounded-full", dark ? "bg-preview-dark-ink/40" : "bg-preview-light-ink/40")} />
        <span className="mt-auto h-2 w-1/3 rounded-full bg-accent-500" />
      </span>
    </span>
  );
}
