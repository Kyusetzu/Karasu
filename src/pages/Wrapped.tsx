import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Download, Sparkles } from "lucide-react";
import { wrappedEntries, type WrappedEntry } from "@/api/queries";
import { isTauri, savePng } from "@/api/anilist";
import { readableInk } from "@/lib/contrast";
import {
  aggregate,
  availableYears,
  type MediaYearStats,
  type WrappedStats,
} from "@/lib/wrapped";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";

const W = 1080;
const P = 72;

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
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const accent = cssVar("--color-accent-500", "#6c7fff");
  const accent600 = cssVar("--color-accent-600", accent);
  const headerInk = readableInk(accent600);

  const sections: Section[] = [];

  const subhead = (text: string, y: number) => {
    ctx.textAlign = "left";
    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 26px system-ui, sans-serif";
    ctx.fillText(text.toUpperCase(), P, y + 34);
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
        ctx.font = "800 46px system-ui, sans-serif";
        ctx.fillText(label, P, y + 50);
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

    // Stat tiles
    sections.push({
      height: 140,
      paint: (y) => {
        const gap = 20;
        const tw = (W - P * 2 - gap * (tiles.length - 1)) / tiles.length;
        tiles.forEach((tile, i) => {
          const x = P + i * (tw + gap);
          ctx.fillStyle = "#171e2a";
          roundRect(ctx, x, y, tw, 116, 16);
          ctx.textAlign = "left";
          ctx.fillStyle = "#f1f5f9";
          ctx.font = "800 46px system-ui, sans-serif";
          ctx.fillText(tile.value, x + 22, y + 62);
          ctx.fillStyle = "#94a3b8";
          ctx.font = "500 23px system-ui, sans-serif";
          ctx.fillText(tile.label, x + 22, y + 96);
        });
      },
    });

    // Top genres (mini-bars)
    if (s.topGenres.length) {
      sections.push({
        height: 48,
        paint: (y) => subhead(t("wrapped.topGenres"), y),
      });
      const max = s.topGenres[0].count || 1;
      for (const gv of s.topGenres) {
        sections.push({
          height: 48,
          paint: (y) => {
            ctx.textAlign = "left";
            ctx.fillStyle = "#e2e8f0";
            ctx.font = "600 28px system-ui, sans-serif";
            ctx.fillText(gv.name, P, y + 30);
            const barX = W / 2;
            const barW = W / 2 - P;
            ctx.fillStyle = "#232c3a";
            roundRect(ctx, barX, y + 8, barW, 24, 12);
            ctx.fillStyle = accent;
            roundRect(ctx, barX, y + 8, Math.max(24, (barW * gv.count) / max), 24, 12);
            ctx.fillStyle = "#94a3b8";
            ctx.textAlign = "right";
            ctx.font = "600 22px system-ui, sans-serif";
            ctx.fillText(String(gv.count), W - P, y + 27);
          },
        });
      }
    }

    // Top rated titles
    if (s.topTitles.length) {
      sections.push({
        height: 48,
        paint: (y) => subhead(t("wrapped.topRated"), y),
      });
      s.topTitles.forEach((title, i) => {
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
  canvas.width = W;
  canvas.height = totalH;

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
}

export default function Wrapped() {
  const { t, i18n } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [anime, setAnime] = useState<WrappedEntry[]>([]);
  const [manga, setManga] = useState<WrappedEntry[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

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

  const years = useMemo(() => availableYears(anime, manga), [anime, manga]);

  useEffect(() => {
    if (year === null && years.length) setYear(years[0]);
  }, [years, year]);

  const stats = useMemo(
    () => (year !== null ? aggregate(anime, manga, year) : null),
    [anime, manga, year],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stats || year === null) return;
    drawCard(canvas, stats, year, viewer?.name ?? "", t, i18n.language);
  }, [stats, year, viewer, t, i18n.language]);

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

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const ok = await savePng(bytes, `karasu-wrapped-${year}.png`).catch(
        () => false,
      );
      if (ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    }, "image/png");
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles size={20} className="text-accent-400" /> {t("wrapped.title")}
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
          <Download size={16} /> {saved ? t("common.saved") : t("wrapped.save")}
        </Button>
      </div>

      {loading ? (
        <p className="text-ink-500">{t("common.loading")}</p>
      ) : years.length === 0 ? (
        <p className="text-sm text-ink-600">{t("wrapped.empty")}</p>
      ) : (
        <canvas
          ref={canvasRef}
          className="w-full max-w-sm rounded-2xl border border-surface-800 shadow-xl"
        />
      )}
    </div>
  );
}
