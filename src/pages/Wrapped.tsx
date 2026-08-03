import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Download, Sparkles } from "lucide-react";
import { wrappedEntries, type WrappedEntry } from "@/api/queries";
import { isTauri, saveImage, type ImageFormat } from "@/api/anilist";
import { readableInk } from "@/lib/contrast";
import {
  aggregate,
  availableYears,
  type MediaYearStats,
  type WrappedStats,
} from "@/lib/wrapped";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked, isBlockedGenre } from "@/lib/contentFilter";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { EmptyState, OutlineYear } from "@/components/EmptyState";

const P = 72;

type PresetKey = "banner" | "square" | "page" | "compressed" | "detailed";

interface Preset {
  key: PresetKey;
  labelKey: string;
  W: number;
  includeGenres: boolean;
  maxGenres: number;
  includeTitles: boolean;
  maxTitles: number;
  /** Force the exported image to an exact 1:1 square, scaling the naturally
   *  taller content to fit rather than letting height drift with content. */
  square?: boolean;
}

/** Shape + content-density presets, in the order shown to the user. */
const PRESETS: Preset[] = [
  { key: "banner", labelKey: "wrapped.presetBanner", W: 1600, includeGenres: false, maxGenres: 0, includeTitles: false, maxTitles: 0 },
  { key: "square", labelKey: "wrapped.presetSquare", W: 1080, includeGenres: true, maxGenres: 3, includeTitles: false, maxTitles: 0, square: true },
  { key: "page", labelKey: "wrapped.presetPage", W: 1080, includeGenres: true, maxGenres: 5, includeTitles: true, maxTitles: 3 },
  { key: "compressed", labelKey: "wrapped.presetCompressed", W: 780, includeGenres: false, maxGenres: 0, includeTitles: false, maxTitles: 0 },
  { key: "detailed", labelKey: "wrapped.presetDetailed", W: 1200, includeGenres: true, maxGenres: 5, includeTitles: true, maxTitles: 5 },
];

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Shrinks `weight size`px system-ui text down toward `minSize` until it fits
 * `maxWidth`. If it still doesn't fit at the floor size, `allowTruncate`
 * clips it with an ellipsis (never used for numeric values). Leaves
 * `ctx.font` set to the resolved size as a side effect.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: number,
  startSize: number,
  minSize: number,
  allowTruncate: boolean,
): { text: string; size: number } {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return { text, size };
    size -= 2;
  }
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  if (!allowTruncate || ctx.measureText(text).width <= maxWidth) {
    return { text, size };
  }
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return { text: `${clipped}…`, size };
}

interface Tile {
  value: string;
  label: string;
}
interface Section {
  height: number;
  paint: (y: number) => void;
}

/**
 * Draws the year-in-review card. Sections are laid out with a running cursor
 * (each contributes a fixed height), so nothing can overlap, and the canvas
 * height is computed to fit the content exactly — no clipping, no dead space.
 */
function drawCard(
  canvas: HTMLCanvasElement,
  stats: WrappedStats,
  year: number,
  name: string,
  t: TFunction,
  lang: string,
  preset: Preset,
  /**
   * Output multiplier. Every coordinate and font size in this function is a
   * hardcoded design-unit number, so the *only* way to render larger without
   * blurring is a context transform — upscaling the finished bitmap would
   * resample text that was already rasterized at 1x. With the transform, the
   * glyphs are rasterized at the final size.
   */
  scale = 1,
) {
  // Sections are painted onto an offscreen buffer sized to their natural
  // content height first; the visible canvas is only assigned at the end,
  // so square-preset scaling (below) can compose the finished buffer rather
  // than needing to know the final size up front.
  const work = document.createElement("canvas");
  const ctx = work.getContext("2d");
  if (!ctx) return;

  const W = preset.W;
  const accent = cssVar("--color-accent-500", "#6c7fff");
  const accent600 = cssVar("--color-accent-600", accent);
  const headerInk = readableInk(accent600);

  const sections: Section[] = [];

  const subhead = (text: string, y: number) => {
    ctx.textAlign = "left";
    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 28px system-ui, sans-serif";
    ctx.fillText(text.toUpperCase(), P, y + 36);
  };

  // --- Header band --------------------------------------------------------
  sections.push({
    height: 268,
    paint: (y) => {
      const g = ctx.createLinearGradient(0, y, W, y + 268);
      g.addColorStop(0, accent600);
      g.addColorStop(1, accent);
      ctx.fillStyle = g;
      ctx.fillRect(0, y, W, 268);

      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = headerInk;
      ctx.globalAlpha = 0.85;
      ctx.font = "600 30px system-ui, sans-serif";
      ctx.fillText(name.toUpperCase(), P, y + 88);
      ctx.globalAlpha = 1;
      ctx.font = "800 132px system-ui, sans-serif";
      ctx.fillText(String(year), P, y + 202);
      const yearW = ctx.measureText(String(year)).width;
      ctx.font = "600 40px system-ui, sans-serif";
      ctx.fillText(t("wrapped.inReview"), P + yearW + 24, y + 202);
    },
  });
  sections.push({ height: 28, paint: () => {} });

  // --- One medium block ---------------------------------------------------
  const addBlock = (label: string, s: MediaYearStats, tiles: Tile[]) => {
    sections.push({
      height: 66,
      paint: (y) => {
        ctx.textAlign = "left";
        ctx.fillStyle = accent;
        ctx.font = "800 50px system-ui, sans-serif";
        ctx.fillText(label, P, y + 52);
      },
    });

    if (s.count === 0) {
      sections.push({
        height: 64,
        paint: (y) => {
          ctx.textAlign = "left";
          ctx.fillStyle = "#64748b";
          ctx.font = "500 30px system-ui, sans-serif";
          ctx.fillText(t("wrapped.noneThisYear"), P, y + 40);
        },
      });
      sections.push({ height: 28, paint: () => {} });
      return;
    }

    // Stat tiles — the numbers are the main "at a glance" content, so these
    // get the biggest type on the card after the year itself.
    sections.push({
      height: 174,
      paint: (y) => {
        const gap = 20;
        const tw = (W - P * 2 - gap * (tiles.length - 1)) / tiles.length;
        const maxTextW = tw - 48;
        tiles.forEach((tile, i) => {
          const x = P + i * (tw + gap);
          ctx.fillStyle = "#171e2a";
          roundRect(ctx, x, y, tw, 150, 18);
          ctx.textAlign = "left";
          ctx.fillStyle = "#f1f5f9";
          const value = fitText(ctx, tile.value, maxTextW, 800, 64, 36, false);
          ctx.fillText(value.text, x + 24, y + 80);
          ctx.fillStyle = "#94a3b8";
          const label = fitText(ctx, tile.label, maxTextW, 500, 28, 16, true);
          ctx.fillText(label.text, x + 24, y + 124);
        });
      },
    });

    // Top genres (mini-bars)
    const genres = preset.includeGenres ? s.topGenres.slice(0, preset.maxGenres) : [];
    if (genres.length) {
      sections.push({
        height: 48,
        paint: (y) => subhead(t("wrapped.topGenres"), y),
      });
      const max = genres[0].count || 1;
      for (const gv of genres) {
        sections.push({
          height: 48,
          paint: (y) => {
            ctx.textAlign = "left";
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "600 30px system-ui, sans-serif";
            ctx.fillText(gv.name, P, y + 32);
            const barX = W / 2;
            const barW = W / 2 - P;
            const fillW = Math.max(24, (barW * gv.count) / max);
            ctx.fillStyle = "#232c3a";
            roundRect(ctx, barX, y + 8, barW, 24, 12);
            ctx.fillStyle = accent;
            roundRect(ctx, barX, y + 8, fillW, 24, 12);

            // The count sits at the bar's right edge, which is fully covered
            // by the accent fill whenever this genre is the max (always true
            // for the top genre) — use a contrasting ink there instead of
            // the fixed gray, which can wash out against a light accent.
            const countText = String(gv.count);
            ctx.font = "600 24px system-ui, sans-serif";
            const countW = ctx.measureText(countText).width;
            const overlapsFill = barX + fillW > W - P - countW;
            ctx.fillStyle = overlapsFill ? readableInk(accent) : "#94a3b8";
            ctx.textAlign = "right";
            ctx.fillText(countText, W - P, y + 27);
          },
        });
      }
    }

    // Top rated titles
    const titles = preset.includeTitles ? s.topTitles.slice(0, preset.maxTitles) : [];
    if (titles.length) {
      sections.push({
        height: 48,
        paint: (y) => subhead(t("wrapped.topRated"), y),
      });
      titles.forEach((title, i) => {
        sections.push({
          height: 46,
          paint: (y) => {
            ctx.textAlign = "left";
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "600 30px system-ui, sans-serif";
            const clipped = title.length > 38 ? `${title.slice(0, 37)}…` : title;
            ctx.fillText(`${i + 1}.  ${clipped}`, P, y + 34);
          },
        });
      });
    }

    sections.push({ height: 44, paint: () => {} });
  };

  addBlock(t("common.anime"), stats.anime, [
    { value: stats.anime.count.toLocaleString(lang), label: t("wrapped.completed") },
    { value: stats.anime.units.toLocaleString(lang), label: t("common.episodes") },
    {
      value: Math.round(stats.anime.minutes / 60).toLocaleString(lang),
      label: t("wrapped.hours"),
    },
    {
      value: stats.anime.meanScore ? round1(stats.anime.meanScore) : "–",
      label: t("wrapped.meanScore"),
    },
  ]);

  addBlock(t("common.manga"), stats.manga, [
    { value: stats.manga.count.toLocaleString(lang), label: t("wrapped.completed") },
    { value: stats.manga.units.toLocaleString(lang), label: t("common.chapters") },
    {
      value: stats.manga.meanScore ? round1(stats.manga.meanScore) : "–",
      label: t("wrapped.meanScore"),
    },
  ]);

  // Footer
  sections.push({
    height: 96,
    paint: (y) => {
      ctx.textAlign = "left";
      ctx.fillStyle = "#64748b";
      ctx.font = "500 26px system-ui, sans-serif";
      ctx.fillText("Karasu · github.com/Kyusetzu/Karasu", P, y + 52);
    },
  });

  const totalH = sections.reduce((sum, s) => sum + s.height, 0);
  work.width = W * scale;
  work.height = totalH * scale;
  // Applied after sizing, because setting width/height resets the context.
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const bg = ctx.createLinearGradient(0, 0, 0, totalH);
  bg.addColorStop(0, "#0b0d12");
  bg.addColorStop(1, "#141b26");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, totalH);

  let y = 0;
  for (const s of sections) {
    s.paint(y);
    y += s.height;
  }

  if (!preset.square) {
    canvas.width = W * scale;
    canvas.height = totalH * scale;
    const outCtx = canvas.getContext("2d");
    outCtx?.drawImage(work, 0, 0);
    return;
  }

  // Square preset: content is naturally taller than it is wide, so scale it
  // down (never up — canvas text would blur) to fit an exact W×W frame,
  // centered, with the same background filling any letterboxed edge.
  canvas.width = W * scale;
  canvas.height = W * scale;
  const outCtx = canvas.getContext("2d");
  if (!outCtx) return;
  outCtx.setTransform(scale, 0, 0, scale, 0, 0);
  const outBg = outCtx.createLinearGradient(0, 0, 0, W);
  outBg.addColorStop(0, "#0b0d12");
  outBg.addColorStop(1, "#141b26");
  outCtx.fillStyle = outBg;
  outCtx.fillRect(0, 0, W, W);
  const fit = Math.min(1, W / totalH);
  const drawW = W * fit;
  const drawH = totalH * fit;
  outCtx.drawImage(work, (W - drawW) / 2, (W - drawH) / 2, drawW, drawH);
}

export default function Wrapped() {
  const { t, i18n } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const level = useContentFilter((s) => s.level);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [anime, setAnime] = useState<WrappedEntry[]>([]);
  const [manga, setManga] = useState<WrappedEntry[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [presetKey, setPresetKey] = useState<PresetKey>("page");
  const [format, setFormat] = useState<ImageFormat>("png");
  const [scale, setScale] = useState(2);
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[2];

  useEffect(() => {
    if (!isTauri || !viewer) return;
    setLoading(true);
    Promise.all([
      wrappedEntries(viewer.id, "ANIME"),
      wrappedEntries(viewer.id, "MANGA"),
    ])
      .then(([a, m]) => {
        setAnime(a);
        setManga(m);
      })
      .finally(() => setLoading(false));
  }, [viewer]);

  // This card gets exported as a PNG and shared, so filtered entries must not
  // reach it — and neither must a filtered genre *name*, which would otherwise
  // survive in the top-genres bars even with the entries removed.
  const visibleAnime = useMemo(
    () => anime.filter((e) => !isBlocked(e, level)),
    [anime, level],
  );
  const visibleManga = useMemo(
    () => manga.filter((e) => !isBlocked(e, level)),
    [manga, level],
  );

  const years = useMemo(
    () => availableYears(visibleAnime, visibleManga),
    [visibleAnime, visibleManga],
  );

  useEffect(() => {
    if (year === null && years.length) setYear(years[0]);
  }, [years, year]);

  const stats = useMemo(
    () =>
      year !== null
        ? aggregate(visibleAnime, visibleManga, year, (g) =>
            isBlockedGenre(g, level),
          )
        : null,
    [visibleAnime, visibleManga, year, level],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stats || year === null) return;
    drawCard(canvas, stats, year, viewer?.name ?? "", t, i18n.language, preset);
  }, [stats, year, viewer, t, i18n.language, preset]);

  if (!viewer) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="text-center">
          <p className="text-ink-500">{t("wrapped.connectPrompt")}</p>
          <Link to="/settings">
            <Button className="mt-4">{t("list.toSettings")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  /**
   * Renders at the chosen scale and hands the bytes to the save dialog.
   *
   * Drawn into a throwaway canvas rather than the one on screen: the preview
   * is sized for the page, and re-rendering it at 3x to export would leave a
   * 4800px canvas mounted until the next preset change.
   */
  const save = async () => {
    if (!stats || year === null) return;
    const out = document.createElement("canvas");
    drawCard(out, stats, year, viewer?.name ?? "", t, i18n.language, preset, scale);

    const blob = await new Promise<Blob | null>((resolve) =>
      // Quality only applies to JPEG; PNG ignores it. 0.92 is the browser
      // default and is visually lossless on flat poster art.
      out.toBlob(resolve, format === "png" ? "image/png" : "image/jpeg", 0.92),
    );
    if (!blob) return;

    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const suffix = scale === 1 ? "" : `@${scale}x`;
    const ok = await saveImage(
      bytes,
      `karasu-wrapped-${year}-${presetKey}${suffix}.${format === "png" ? "png" : "jpg"}`,
      format,
    ).catch(() => false);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-8 3xl:max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="size-5 text-accent-400" /> {t("wrapped.title")}
        </h1>
        {years.length > 0 && (
          <select
            value={year ?? ""}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}
        <Button className="ml-auto" onClick={save} disabled={!stats}>
          <Download className="size-4" /> {saved ? t("common.saved") : t("wrapped.save")}
        </Button>
      </div>

      {years.length > 0 && (
        <div className="mb-4 space-y-2.5">
          <ExportRow label={t("wrapped.shape")}>
            {PRESETS.map((p) => (
              <Pill
                key={p.key}
                active={presetKey === p.key}
                onClick={() => setPresetKey(p.key)}
              >
                {t(p.labelKey)}
              </Pill>
            ))}
          </ExportRow>
          <ExportRow label={t("wrapped.format")}>
            {(["png", "jpeg"] as const).map((f) => (
              <Pill key={f} active={format === f} onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </Pill>
            ))}
          </ExportRow>
          {/* Not a preview control — the poster on screen is always drawn at
              1x. Scale is what gets written to disk, so the pixel size is
              shown rather than left to be inferred from "2x". */}
          <ExportRow label={t("wrapped.size")}>
            {[1, 2, 3].map((n) => (
              <Pill key={n} active={scale === n} onClick={() => setScale(n)}>
                {n}× · {preset.W * n}px
              </Pill>
            ))}
          </ExportRow>
        </div>
      )}

      {loading ? (
        <p className="text-ink-500">{t("common.loading")}</p>
      ) : years.length === 0 ? (
        <EmptyState visual={<OutlineYear year={new Date().getFullYear()} />} title={t("wrapped.empty")} />
      ) : (
        <canvas
          ref={canvasRef}
          className="w-full max-w-2xl rounded-2xl border border-surface-800 shadow-xl"
        />
      )}
    </div>
  );
}

/** One labelled row of the export controls. */
function ExportRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-2xs uppercase tracking-[.13em] text-ink-600">
        {label}
      </span>
      {children}
    </div>
  );
}
