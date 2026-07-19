import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Download, Sparkles } from "lucide-react";
import { wrappedEntries, type WrappedEntry } from "@/api/queries";
import { isTauri, savePng } from "@/api/anilist";
import { displayTitle } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";

const SIZE = 1080;

interface YearStats {
  animeCount: number;
  episodes: number;
  minutes: number;
  meanScore: number;
  topGenres: { name: string; count: number }[];
  topTitles: string[];
  mangaCount: number;
  chapters: number;
}

function aggregate(
  anime: WrappedEntry[],
  manga: WrappedEntry[],
  year: number,
): YearStats {
  const a = anime.filter((e) => e.year === year);
  const m = manga.filter((e) => e.year === year);

  const genres = new Map<string, number>();
  for (const e of a) for (const g of e.genres) genres.set(g, (genres.get(g) ?? 0) + 1);

  const scored = a.filter((e) => e.score > 0);
  return {
    animeCount: a.length,
    episodes: a.reduce((s, e) => s + e.progress, 0),
    minutes: a.reduce((s, e) => s + e.progress * (e.duration ?? 24), 0),
    meanScore: scored.length
      ? scored.reduce((s, e) => s + e.score, 0) / scored.length
      : 0,
    topGenres: [...genres.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
    topTitles: [...a]
      .filter((e) => e.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 3)
      .map((e) => displayTitle(e.title)),
    mangaCount: m.length,
    chapters: m.reduce((s, e) => s + e.progress, 0),
  };
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v.trim() || fallback;
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  s: YearStats,
  year: number,
  name: string,
  t: (k: string, o?: Record<string, unknown>) => string,
) {
  const accent = cssVar("--color-accent-500", "#6366f1");
  const pad = 84;

  const bg = ctx.createLinearGradient(0, 0, 0, SIZE);
  bg.addColorStop(0, "#0b0d12");
  bg.addColorStop(1, "#151b26");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Accent side bar
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 12, SIZE);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 34px system-ui, sans-serif";
  ctx.fillText(name.toUpperCase(), pad, 150);

  ctx.fillStyle = accent;
  ctx.font = "800 150px system-ui, sans-serif";
  ctx.fillText(String(year), pad, 300);

  ctx.fillStyle = "#eef1f6";
  ctx.font = "600 44px system-ui, sans-serif";
  ctx.fillText(t("wrapped.inAnime"), pad, 360);

  // Metrics row
  const metrics: [string, string][] = [
    [s.animeCount.toLocaleString(), t("wrapped.completed")],
    [s.episodes.toLocaleString(), t("common.episodes")],
    [Math.round(s.minutes / 60).toLocaleString(), t("wrapped.hours")],
    [s.meanScore ? s.meanScore.toFixed(1) : "–", t("wrapped.meanScore")],
  ];
  const colW = (SIZE - pad * 2) / metrics.length;
  metrics.forEach(([value, label], i) => {
    const x = pad + i * colW;
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 66px system-ui, sans-serif";
    ctx.fillText(value, x, 500);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 26px system-ui, sans-serif";
    ctx.fillText(label, x, 540);
  });

  ctx.strokeStyle = "#26303f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, 600);
  ctx.lineTo(SIZE - pad, 600);
  ctx.stroke();

  // Top genres
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 30px system-ui, sans-serif";
  ctx.fillText(t("wrapped.topGenres").toUpperCase(), pad, 665);
  ctx.fillStyle = "#eef1f6";
  ctx.font = "600 40px system-ui, sans-serif";
  s.topGenres.forEach((g, i) => {
    ctx.fillText(`${i + 1}. ${g.name}`, pad, 730 + i * 58);
  });

  // Top titles
  const rx = SIZE / 2 + 30;
  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 30px system-ui, sans-serif";
  ctx.fillText(t("wrapped.topRated").toUpperCase(), rx, 665);
  ctx.fillStyle = "#eef1f6";
  ctx.font = "600 34px system-ui, sans-serif";
  s.topTitles.forEach((title, i) => {
    const clipped = title.length > 26 ? `${title.slice(0, 25)}…` : title;
    ctx.fillText(`${i + 1}. ${clipped}`, rx, 730 + i * 58);
  });

  // Manga line + footer
  ctx.fillStyle = accent;
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.fillText(
    t("wrapped.plusManga", { count: s.mangaCount, chapters: s.chapters }),
    pad,
    980,
  );

  ctx.fillStyle = "#64748b";
  ctx.font = "500 28px system-ui, sans-serif";
  ctx.fillText("Karasu · github.com/Kyusetzu/Karasu", pad, SIZE - 60);
}

export default function Wrapped() {
  const { t } = useTranslation();
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

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const e of [...anime, ...manga]) if (e.year) set.add(e.year);
    return [...set].sort((a, b) => b - a);
  }, [anime, manga]);

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
    const ctx = canvas.getContext("2d");
    if (ctx) drawCard(ctx, stats, year, viewer?.name ?? "", t);
  }, [stats, year, viewer, t]);

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
          width={SIZE}
          height={SIZE}
          className="w-full max-w-md rounded-2xl border border-surface-800 shadow-xl"
        />
      )}
    </div>
  );
}
