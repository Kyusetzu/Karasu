import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Download, Sparkles } from "lucide-react";
import { wrappedEntries, type Season, type WrappedEntry } from "@/api/queries";
import {
  currentScoreFormat,
  isTauri,
  saveImage,
  type ImageFormat,
} from "@/api/anilist";
import { formatMeanScore } from "@/lib/scoreFormat";
import {
  aggregate,
  availableSeasons,
  availableYears,
  type MediaYearStats,
  type WrappedPeriod,
  type WrappedStats,
} from "@/lib/wrapped";
import SeasonPicker, { SEASON_KANJI } from "@/components/ui/season-picker";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked, isBlockedGenre } from "@/lib/contentFilter";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Pill } from "@/components/ui/pill";
import { EmptyState, OutlineYear } from "@/components/EmptyState";
import markUrl from "@/assets/karasu-mark.svg";
import { toBase64 } from "@/lib/base64";

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
 * Loads the mark once, for the canvas.
 *
 * An `<img>` mounts and paints itself; a canvas has to be handed something
 * already decoded, and `drawImage` with a half-loaded image silently draws
 * nothing. One module-level promise, so five presets and an export share the
 * single decode.
 */
let markPromise: Promise<HTMLImageElement | null> | null = null;
function loadMark(): Promise<HTMLImageElement | null> {
  markPromise ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = markUrl;
  });
  return markPromise;
}

/** How tall the mark is for a given width, from its own aspect. */
const markHeight = (mark: HTMLImageElement, size: number) =>
  size * (mark.naturalHeight / mark.naturalWidth || 978.44 / 890.73);

/**
 * The corvid, in full colour — the same art the app shows, not a silhouette of
 * it. Drawn from the SVG so the poster's bird and the titlebar's are one file.
 *
 * Placed by its **centre**, not its top-left corner. Corner placement is what
 * put the watermark off the poster: the call site asked for a 42em bird 20em
 * from the right edge, which left 48% of it — the head, and only the head — on
 * the canvas, cropped at both edges. Rotating about a corner then walks the art
 * sideways as a side effect of the angle, which is the same bug in miniature.
 */
function drawMark(
  ctx: CanvasRenderingContext2D,
  mark: HTMLImageElement | null,
  cx: number,
  cy: number,
  size: number,
  alpha: number,
  rotateDeg = 0,
) {
  if (!mark) return;
  const h = markHeight(mark, size);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.drawImage(mark, -size / 2, -h / 2, size, h);
  ctx.restore();
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
 * Draws the review card. Sections are laid out with a running cursor
 * (each contributes a fixed height), so nothing can overlap, and the canvas
 * height is computed to fit the content exactly — no clipping, no dead space.
 */

/** What the headline says — the one place the card knows year from season. */
interface CardHeading {
  /** The big numeral (the year, in both modes). */
  numeral: string;
  /** The accent flourish beside it — 一年のまとめ, or the season's twin. */
  caption: string;
  /** The line an empty medium block shows. */
  emptyLine: string;
}

function drawCard(
  canvas: HTMLCanvasElement,
  stats: WrappedStats,
  heading: CardHeading,
  name: string,
  t: TFunction,
  lang: string,
  preset: Preset,
  mark: HTMLImageElement | null,
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
        ctx.fillText(heading.numeral, P, y + u(11.4));
        const yearW = ctx.measureText(heading.numeral).width;
        track("0px");

        ctx.fillStyle = a4;
        face(400, u(2), true);
        ctx.fillText(heading.caption, P + yearW + u(1.4), y + u(11.4));

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
            ctx.fillText(heading.emptyLine, P, y + u(2));
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

              // The count sits *after* the bar, not on it: a number inside a
              // filled track has to change colour to stay legible, and it did
              // — which meant the same column read in two different inks
              // depending on how long its bar happened to be.
              const countW = u(3.2);
              const barX = CW / 2;
              const barW = CW / 2 - P - countW;
              const fillW = Math.max(u(2), (barW * gv.count) / max);
              ctx.fillStyle = "rgba(238,241,246,.1)";
              roundRect(ctx, barX, y + u(0.6), barW, u(1.5), u(0.75));
              const bar = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
              bar.addColorStop(0, a6);
              bar.addColorStop(1, a4);
              ctx.fillStyle = bar;
              roundRect(ctx, barX, y + u(0.6), fillW, u(1.5), u(0.75));

              face(600, u(1.2));
              ctx.fillStyle = INK_FAINT;
              ctx.textAlign = "right";
              ctx.fillText(String(gv.count), CW - P, y + u(1.75));
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
        value: stats.anime.meanScore
          ? formatMeanScore(currentScoreFormat(), stats.anime.meanScore)
          : "–",
        label: t("wrapped.meanScore"),
      },
    ]);

    addBlock(t("common.manga"), stats.manga, [
      { value: stats.manga.count.toLocaleString(lang), label: t("wrapped.completed") },
      { value: stats.manga.units.toLocaleString(lang), label: t("common.chapters") },
      {
        value: stats.manga.meanScore
          ? formatMeanScore(currentScoreFormat(), stats.manga.meanScore)
          : "–",
        label: t("wrapped.meanScore"),
      },
    ]);

    // --- Footer -------------------------------------------------------------
    sections = footer;
    sections.push({
      height: u(6),
      paint: (y) => {
        const size = u(1.6);
        // Centre-placed like the watermark, so the two calls mean the same
        // thing: the row's own middle, half a mark in from the margin.
        drawMark(ctx, mark, P + size / 2, y + u(1.5), size, 1);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = INK_DIM;
        face(700, u(1.1));
        track(`${u(0.2)}px`);
        ctx.fillText("KARASU", P + size * 1.25, y + u(2.05));
        const brandW = ctx.measureText("KARASU").width;
        track("0px");

        const divX = P + size * 1.25 + brandW + u(1);
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

  // The mark bleeds off the bottom-right corner, painted before the content so
  // the text sits over it. Its centre sits 0.4 of the art in from each edge, so
  // nine tenths of the bird is on the poster and only the corner it is meant to
  // run off actually runs off. The alpha is higher than a watermark usually
  // wants because the art is mostly near-black — at .16 it was arithmetically
  // invisible on this ground.
  const markW = em * 42;
  const markH = mark ? markHeight(mark, markW) : 0;
  drawMark(ctx, mark, W - markW * 0.4, H - markH * 0.4, markW, 0.34, -7);

  // Centred, so a card that cannot quite fill its crop is framed by the ground
  // rather than hanging from the top edge.
  card.paint(Math.max(0, (H - card.totalH) / 2));

  canvas.width = W * scale;
  canvas.height = H * scale;
  canvas.getContext("2d")?.drawImage(work, 0, 0);
}

/** Stable identity, so the memos below don't re-run while the query loads. */
const EMPTY_ENTRIES: WrappedEntry[] = [];

export default function Wrapped() {
  const { t, i18n } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const level = useContentFilter((s) => s.level);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [year, setYear] = useState<number | null>(null);
  // Which cut the card covers. Year is completion-bucketed, season is
  // broadcast-bucketed - see WrappedPeriod's comment for why the words differ.
  const [mode, setMode] = useState<"year" | "season">("year");
  const [seasonPick, setSeasonPick] = useState<{ season: Season; year: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [presetKey, setPresetKey] = useState<PresetKey>("page");
  const [format, setFormat] = useState<ImageFormat>("png");
  const [scale, setScale] = useState(2);
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[2];

  // Through the query cache, not a bare effect into `useState`. `<main
  // key={pathname}>` remounts this page on every navigation, so the old effect
  // refetched *both* completed collections every single time /wrapped was
  // opened — two large responses out of a ~30/min budget for data that changes
  // when you finish something, not when you change tabs. Half an hour matches
  // what Statistics does for the same reason.
  //
  // `error` is destructured for the same reason the Dashboard destructures it:
  // a failed query has `isLoading === false` and no data, so without it an
  // offline year fell through to the empty state and told the user they had
  // finished nothing all year. The one screen built to be exported and shared
  // is the last place to state that on a dropped request.
  const { data, isLoading: loading, error, refetch } = useQuery({
    queryKey: ["wrapped", viewer?.id],
    queryFn: async () => {
      const [anime, manga] = await Promise.all([
        wrappedEntries(viewer!.id, "ANIME"),
        wrappedEntries(viewer!.id, "MANGA"),
      ]);
      return { anime, manga };
    },
    enabled: isTauri && !!viewer,
    staleTime: 30 * 60 * 1000,
  });
  const anime = data?.anime ?? EMPTY_ENTRIES;
  const manga = data?.manga ?? EMPTY_ENTRIES;

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

  const seasons = useMemo(
    () => availableSeasons(visibleAnime, visibleManga),
    [visibleAnime, visibleManga],
  );
  useEffect(() => {
    if (seasonPick === null && seasons.length) setSeasonPick(seasons[0]);
  }, [seasons, seasonPick]);

  const period: WrappedPeriod | null =
    mode === "year"
      ? year !== null
        ? { kind: "year", year }
        : null
      : seasonPick !== null
        ? { kind: "season", ...seasonPick }
        : null;

  /** The headline in the chosen mode - the poster's one period-aware input.
   *  The caption keeps the JP flourish; the season one leads with the
   *  translated season name so the poster is legible without the kanji. */
  const heading: CardHeading | null =
    period === null
      ? null
      : period.kind === "year"
        ? {
            numeral: String(period.year),
            caption: "一年のまとめ",
            emptyLine: t("wrapped.noneThisYear"),
          }
        : {
            numeral: String(period.year),
            caption:
              t(`season.${period.season}`) +
              " · " +
              SEASON_KANJI[period.season] +
              "のまとめ",
            emptyLine: t("wrapped.noneThisSeason"),
          };

  const stats = useMemo(
    () =>
      period !== null
        ? aggregate(visibleAnime, visibleManga, period, (g) =>
            isBlockedGenre(g, level),
          )
        : null,
    // `period` is derived fresh each render from mode/year/seasonPick, so its
    // pieces are listed rather than the object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleAnime, visibleManga, mode, year, seasonPick, level],
  );

  // The mark is decoded once and then held: the poster redraws on every
  // preset change, and a fresh decode per draw would flash an empty corner.
  const [mark, setMark] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    loadMark().then(setMark);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stats || !heading) return;
    drawCard(canvas, stats, heading, viewer?.name ?? "", t, i18n.language, preset, mark);
    // `heading` derives from the same inputs as `stats`; its pieces are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, mode, year, seasonPick, viewer, t, i18n.language, preset, mark]);

  if (!viewer) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="text-center">
          <p className="text-ink-500">{t("wrapped.connectPrompt")}</p>
          <Link to="/settings?pane=account">
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
    if (!stats || !heading || period === null) return;
    const out = document.createElement("canvas");
    // Awaited rather than read from state: an export fired before the decode
    // landed would write a poster with no bird on it.
    const art = mark ?? (await loadMark());
    drawCard(out, stats, heading, viewer?.name ?? "", t, i18n.language, preset, art, scale);

    const blob = await new Promise<Blob | null>((resolve) =>
      // Quality only applies to JPEG; PNG ignores it. 0.92 is the browser
      // default and is visually lossless on flat poster art.
      out.toBlob(resolve, format === "png" ? "image/png" : "image/jpeg", 0.92),
    );
    if (!blob) return;

    const suffix = scale === 1 ? "" : `@${scale}x`;
    const slug =
      period.kind === "year"
        ? String(period.year)
        : `${period.year}-${period.season.toLowerCase()}`;
    const ok = await saveImage(
      toBase64(new Uint8Array(await blob.arrayBuffer())),
      `karasu-wrapped-${slug}-${presetKey}${suffix}.${format === "png" ? "png" : "jpg"}`,
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
          <>
            <div className="flex items-center gap-1.5">
              <Pill active={mode === "year"} onClick={() => setMode("year")}>
                {t("wrapped.modeYear")}
              </Pill>
              {/* A completion list can be all movies and specials - no
                  broadcast seasons at all - in which case the mode has
                  nothing to offer and the pill would be a dead end. */}
              {seasons.length > 0 && (
                <Pill active={mode === "season"} onClick={() => setMode("season")}>
                  {t("wrapped.modeSeason")}
                </Pill>
              )}
            </div>
            {mode === "year" ? (
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
            ) : (
              seasonPick && (
                <SeasonPicker
                  season={seasonPick.season}
                  year={seasonPick.year}
                  years={[...new Set(seasons.map((sn) => sn.year))]}
                  onPick={setSeasonPick}
                />
              )
            )}
          </>
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
        <Loader label={t("common.loading")} />
      ) : error ? (
        <div>
          <p className="text-danger">
            {t("list.loadError", { message: String(error) })}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => refetch()}>
            {t("common.retry")}
          </Button>
        </div>
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
