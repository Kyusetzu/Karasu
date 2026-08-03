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
import {
  MARK_BODY,
  MARK_EYE,
  MARK_HEAD,
  MARK_VIEWBOX,
} from "@/components/KarasuMark";

/**
 * Poster type and geometry are expressed in `em`, like the design, and one
 * layout serves all five crops. Canvas has no `em`, so each preset carries the
 * pixel value of one — the design's root font size for that crop.
 */
const FONT = '"SN Pro", system-ui, sans-serif';
const FONT_JP = '"Kosugi Maru", "SN Pro", sans-serif';

/**
 * The poster keeps the dark palette in both themes. It is an image that leaves
 * the app — it should look like Karasu wherever it is posted, not like the
 * theme of whoever exported it. Only the accent follows the user.
 */
const POSTER_BG = "#07090d";
const INK = "#f1f5f9";
const INK_DIM = "rgba(238,241,246,.62)";
const INK_FAINT = "rgba(238,241,246,.5)";

type PresetKey = "banner" | "square" | "page" | "compressed" | "detailed";

interface Preset {
  key: PresetKey;
  labelKey: string;
  W: number;
  /** Exact output height. The crop is the whole point of a preset. */
  H: number;
  includeGenres: boolean;
  maxGenres: number;
  includeTitles: boolean;
  maxTitles: number;
}

/** Shape + content-density presets, in the order shown to the user. */
const PRESETS: Preset[] = [
  { key: "banner", labelKey: "wrapped.presetBanner", W: 1600, H: 620, includeGenres: false, maxGenres: 0, includeTitles: false, maxTitles: 0 },
  { key: "square", labelKey: "wrapped.presetSquare", W: 1080, H: 1080, includeGenres: true, maxGenres: 3, includeTitles: false, maxTitles: 0 },
  { key: "page", labelKey: "wrapped.presetPage", W: 1080, H: 1720, includeGenres: true, maxGenres: 5, includeTitles: true, maxTitles: 3 },
  { key: "compressed", labelKey: "wrapped.presetCompressed", W: 780, H: 980, includeGenres: false, maxGenres: 0, includeTitles: false, maxTitles: 0 },
  { key: "detailed", labelKey: "wrapped.presetDetailed", W: 1200, H: 1900, includeGenres: true, maxGenres: 5, includeTitles: true, maxTitles: 5 },
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

/**
 * The corvid mark, painted straight onto the canvas from the same path data
 * the component renders — so the poster's bird can never drift from the app's.
 *
 * The eye is punched out on a scratch buffer rather than in place: cutting it
 * directly would take the poster's background with it and leave a hole.
 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
  rotateDeg = 0,
) {
  const buffer = document.createElement("canvas");
  const scale = size / MARK_VIEWBOX.w;
  buffer.width = Math.ceil(MARK_VIEWBOX.w * scale);
  buffer.height = Math.ceil(MARK_VIEWBOX.h * scale);
  const b = buffer.getContext("2d");
  if (!b) return;
  b.setTransform(scale, 0, 0, scale, 0, 0);

  b.fillStyle = color;
  b.beginPath();
  b.arc(MARK_HEAD.cx, MARK_HEAD.cy, MARK_HEAD.r, 0, Math.PI * 2);
  b.fill();
  for (const d of MARK_BODY) b.fill(new Path2D(d));

  b.globalCompositeOperation = "destination-out";
  b.fill(new Path2D(MARK_EYE));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.drawImage(buffer, 0, 0, buffer.width, buffer.height);
  ctx.restore();
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
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, size };
    size -= 2;
  }
  ctx.font = `${weight} ${size}px ${FONT}`;
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
  const H = preset.H;
  /**
   * A 2.58:1 crop has no room for a stacked column — the two medium blocks
   * would each get a couple of centimetres of height and the right third of
   * the poster would stay empty. At that aspect they sit side by side.
   */
  const row = preset.W / preset.H > 2;

  const a4 = cssVar("--color-accent-400", "#8b9dff");
  const a5 = cssVar("--color-accent-500", "#6c7fff");
  const a6 = cssVar("--color-accent-600", a5);
  const accentRgb = cssVar("--accent-rgb", "108, 127, 255");
  const w1 = cssVar("--w1", accentRgb);
  const w2 = cssVar("--w2", accentRgb);

  const face = (weight: number, size: number, jp = false) => {
    ctx.font = `${weight} ${size}px ${jp ? FONT_JP : FONT}`;
  };
  /** `letterSpacing` is Chromium-only and silently ignored elsewhere, which
      is the right failure: tracking is a refinement, not the layout. */
  const track = (value: string) => {
    ctx.letterSpacing = value;
  };

  /**
   * Lays the card out at a given `em`, in pixels.
   *
   * Run twice: once at `em = 1`, which measures the card's natural height in
   * ems, and then at the size that makes that height fill the preset's crop.
   * A poster is a fixed frame, so the type scales to the frame rather than the
   * frame drifting with however much the year happened to contain.
   */
  const build = (em: number) => {
    /** One `em`, in pixels — the unit every size below is written in. */
    const u = (n: number) => n * em;
    const P = u(9);

    // Block painters run from `P` to `CW - P`, so a column's frame is its
    // content plus a padding on each side — and the two frames overlap by one
    // padding where they meet, which is what keeps the outer margins equal to
    // the inner gap's half and the poster symmetrical.
    const gutter = u(4);
    const colContent = (W - P * 2 - gutter) / 2;
    const CW = row ? colContent + P * 2 : W;
    const header: Section[] = [];
    const blocks: Section[][] = [];
    const footer: Section[] = [];
    let sections = header;

    const subhead = (text: string, y: number) => {
      ctx.textAlign = "left";
      ctx.fillStyle = INK_FAINT;
      face(600, u(1.05));
      track(`${u(0.16)}px`);
      ctx.fillText(text.toUpperCase(), P, y + u(2.4));
      track("0px");
    };

    // --- Header -------------------------------------------------------------
    // No coloured band: at poster scale a filled header reads as a UI chrome
    // bar. The year carries the page on its own, with the accent spent on the
    // rule beneath it and on the wash behind.
    sections.push({
      height: u(15.5),
      paint: (y) => {
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";

        ctx.fillStyle = INK_DIM;
        face(600, u(1.5));
        track(`${u(0.34)}px`);
        ctx.fillText(name.toUpperCase(), P, y + u(2.6));
        track("0px");

        ctx.fillStyle = INK;
        face(800, u(8.4));
        track(`${u(-0.045)}px`);
        ctx.fillText(String(year), P, y + u(11.4));
        const yearW = ctx.measureText(String(year)).width;
        track("0px");

        ctx.fillStyle = a4;
        face(400, u(2), true);
        ctx.fillText("一年のまとめ", P + yearW + u(1.4), y + u(11.4));

        const rule = ctx.createLinearGradient(P, 0, W - P, 0);
        rule.addColorStop(0, a5);
        rule.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rule;
        ctx.fillRect(P, y + u(13.4), W - P * 2, 3);
      },
    });

    // --- One medium block ---------------------------------------------------
    const addBlock = (label: string, s: MediaYearStats, tiles: Tile[]) => {
      sections = [];
      blocks.push(sections);
      sections.push({
        height: u(4.6),
        paint: (y) => {
          ctx.textAlign = "left";
          ctx.fillStyle = a4;
          face(800, u(2.6));
          ctx.fillText(label, P, y + u(2.8));
        },
      });

      if (s.count === 0) {
        sections.push({
          height: u(4),
          paint: (y) => {
            ctx.textAlign = "left";
            ctx.fillStyle = INK_FAINT;
            face(500, u(1.4));
            ctx.fillText(t("wrapped.noneThisYear"), P, y + u(2));
          },
        });
        sections.push({ height: u(2), paint: () => {} });
        return;
      }

      // Stat tiles: a top rule and text, no fill. A bordered box at this scale
      // reads as a UI card that wandered into a poster.
      sections.push({
        height: u(7.4),
        paint: (y) => {
          const gap = u(2);
          const tw = (CW - P * 2 - gap * (tiles.length - 1)) / tiles.length;
          tiles.forEach((tile, i) => {
            const x = P + i * (tw + gap);
            ctx.fillStyle = "rgba(238,241,246,.14)";
            ctx.fillRect(x, y, tw, 2);

            ctx.textAlign = "left";
            ctx.fillStyle = INK;
            const value = fitText(ctx, tile.value, tw, 800, u(3.1), u(1.8), false);
            ctx.fillText(value.text, x, y + u(4.4));

            ctx.fillStyle = INK_FAINT;
            face(600, u(1.05));
            track(`${u(0.16)}px`);
            const label = fitText(
              ctx,
              tile.label.toUpperCase(),
              tw,
              600,
              u(1.05),
              u(0.8),
              true,
            );
            ctx.fillText(label.text, x, y + u(6.4));
            track("0px");
          });
        },
      });

      // Top genres (mini-bars)
      const genres = preset.includeGenres ? s.topGenres.slice(0, preset.maxGenres) : [];
      if (genres.length) {
        sections.push({
          height: u(3.4),
          paint: (y) => subhead(t("wrapped.topGenres"), y),
        });
        const max = genres[0].count || 1;
        for (const gv of genres) {
          sections.push({
            height: u(3.4),
            paint: (y) => {
              ctx.textAlign = "left";
              ctx.fillStyle = INK_DIM;
              face(600, u(1.5));
              ctx.fillText(gv.name, P, y + u(1.9));

              const barX = CW / 2;
              const barW = CW / 2 - P;
              const fillW = Math.max(u(2), (barW * gv.count) / max);
              ctx.fillStyle = "rgba(238,241,246,.1)";
              roundRect(ctx, barX, y + u(0.6), barW, u(1.5), u(0.75));
              const bar = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
              bar.addColorStop(0, a6);
              bar.addColorStop(1, a4);
              ctx.fillStyle = bar;
              roundRect(ctx, barX, y + u(0.6), fillW, u(1.5), u(0.75));

              // The count sits at the bar's right edge, which the fill covers
              // whenever this genre is the max — use an ink that reads on the
              // accent there rather than the fixed dim grey.
              const countText = String(gv.count);
              face(600, u(1.2));
              const countW = ctx.measureText(countText).width;
              const overlapsFill = barX + fillW > CW - P - countW;
              ctx.fillStyle = overlapsFill ? readableInk(a4) : INK_FAINT;
              ctx.textAlign = "right";
              ctx.fillText(countText, CW - P, y + u(1.75));
            },
          });
        }
      }

      // Top rated titles
      const titles = preset.includeTitles ? s.topTitles.slice(0, preset.maxTitles) : [];
      if (titles.length) {
        sections.push({
          height: u(3.4),
          paint: (y) => subhead(t("wrapped.topRated"), y),
        });
        titles.forEach((title, i) => {
          sections.push({
            height: u(3),
            paint: (y) => {
              ctx.textAlign = "left";
              ctx.fillStyle = a5;
              face(800, u(1.3));
              ctx.fillText(String(i + 1), P, y + u(2));
              ctx.fillStyle = INK_DIM;
              const room = CW - P * 2 - u(2.6);
              const line = fitText(ctx, title, room, 600, u(1.5), u(1.1), true);
              ctx.fillText(line.text, P + u(2.6), y + u(2));
            },
          });
        });
      }

      sections.push({ height: u(3), paint: () => {} });
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

    // --- Footer -------------------------------------------------------------
    sections = footer;
    sections.push({
      height: u(6),
      paint: (y) => {
        const size = u(1.15);
        drawMark(ctx, P, y + u(1.2), size, INK_FAINT, 1);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = INK_DIM;
        face(700, u(1.1));
        track(`${u(0.2)}px`);
        ctx.fillText("KARASU", P + size * 1.5, y + u(2.05));
        const brandW = ctx.measureText("KARASU").width;
        track("0px");

        const divX = P + size * 1.5 + brandW + u(1);
        ctx.fillStyle = "rgba(238,241,246,.18)";
        ctx.fillRect(divX, y + u(1.1), 1, u(1.2));

        ctx.fillStyle = INK_FAINT;
        face(500, u(1.05));
        ctx.fillText("github.com/Kyusetzu/Karasu", divX + u(1), y + u(2.05));
      },
    });


    const tall = (list: Section[]) =>
      list.reduce((sum, sec) => sum + sec.height, 0);
    const bodyH = row
      ? Math.max(...blocks.map(tall))
      : blocks.reduce((sum, b) => sum + tall(b), 0);
    const totalH = tall(header) + bodyH + tall(footer);

    const paint = (top: number) => {
      let y = top;
      const run = (list: Section[]) => {
        for (const sec of list) {
          sec.paint(y);
          y += sec.height;
        }
      };
      run(header);
      if (row) {
        const bodyTop = y;
        blocks.forEach((block, i) => {
          ctx.save();
          ctx.translate(i * (colContent + gutter), 0);
          y = bodyTop;
          run(block);
          ctx.restore();
        });
        y = bodyTop + bodyH;
      } else {
        blocks.forEach(run);
      }
      run(footer);
    };

    return { paint, totalH };
  };

  // Bounded above by the width: a sparse year would otherwise stretch a
  // handful of lines into letters the height of a fist.
  const natural = build(1).totalH;
  const em = Math.min(W / 62, H / natural);
  const card = build(em);

  work.width = W * scale;
  work.height = H * scale;
  // Applied after sizing, because setting width/height resets the context.
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = POSTER_BG;
  ctx.fillRect(0, 0, W, H);

  // Three washes off the derived hues, the same pair the panels use. They are
  // what keeps a near-black poster from reading as a screenshot of a terminal.
  const wash = (
    cx: number,
    cy: number,
    r: number,
    rgb: string,
    alpha: number,
  ) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  wash(0, 0, W * 0.9, w1, 0.16);
  wash(W, H, W * 0.9, accentRgb, 0.13);
  wash(W * 0.5, H * 0.45, W * 0.7, w2, 0.07);

  // A 1px highlight along the top edge — the same catch-light every panel in
  // the app carries, which is what makes the surface read as lit from above.
  ctx.fillStyle = "rgba(255,255,255,.06)";
  ctx.fillRect(0, 0, W, 1);

  // The mark bleeds off the bottom-right corner, flat rather than full-colour:
  // a colour disc at 42em would read as a second surface instead of a mark in
  // the material.
  drawMark(ctx, W - em * 20, H - em * 20, em * 42, a5, 0.16, -7);

  // Centred, so a card that cannot quite fill its crop is framed by the ground
  // rather than hanging from the top edge.
  card.paint(Math.max(0, (H - card.totalH) / 2));

  canvas.width = W * scale;
  canvas.height = H * scale;
  canvas.getContext("2d")?.drawImage(work, 0, 0);
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
