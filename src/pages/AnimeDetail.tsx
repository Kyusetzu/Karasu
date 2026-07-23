import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Clock, ExternalLink, Star } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { animeDetail, type MediaDetail } from "@/api/queries";
import { formatLabel } from "@/lib/format";
import { formatMinutes, remainingMinutes } from "@/lib/estimate";
import { isTauri, saveListEntry } from "@/api/anilist";
import {
  displayTitle,
  maxProgress,
  STATUS_ORDER,
  type MediaListStatus,
  type MediaType,
} from "@/api/types";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import TagEditor from "@/components/TagEditor";
import { parseNotes, serializeNotes } from "@/lib/tags";

/** AniList descriptions: strip spoilers, allow only harmless tags. */
function sanitizeDescription(html: string): string {
  return html
    .replace(/~!([\s\S]*?)!~/g, "")
    .replace(/<(?!\/?(b|i|em|strong|br)\b)[^>]*>/gi, "");
}

export default function AnimeDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const mediaId = Number(id);

  const { data, isLoading, error } = useQuery({
    queryKey: ["mediaDetail", mediaId],
    queryFn: () => animeDetail(mediaId),
    enabled: isTauri && Number.isFinite(mediaId),
  });

  if (isLoading) return <p className="p-8 text-ink-500">{t("common.loading")}</p>;
  if (error)
    return (
      <p className="p-8 text-red-300">
        {t("common.error", { message: String(error) })}
      </p>
    );
  if (!data) return null;

  const title = displayTitle(data.title);

  const coverSrc = data.coverImage.extraLarge ?? data.coverImage.large ?? "";

  return (
    <div>
      {/* Fixed-height banner slot regardless of whether AniList has a real
          bannerImage (common for manga) — the back button and cover below
          overlap into its bottom edge by a fixed amount, so a shorter slot
          here would push them off the top of the page. */}
      <div className="relative h-64">
        {data.bannerImage ? (
          <img
            src={data.bannerImage}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          coverSrc && (
            <img
              src={coverSrc}
              alt=""
              className="h-full w-full scale-110 object-cover opacity-40 blur-2xl"
            />
          )
        )}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface-950 to-transparent" />
      </div>

      <div className="relative mx-auto max-w-4xl px-8 pb-10">
        <Button
          variant="secondary"
          size="icon"
          aria-label={t("detail.back")}
          className="absolute -top-56 left-4 z-10"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} />
        </Button>

        <div className="-mt-16 flex gap-6">
          <img
            src={coverSrc}
            alt=""
            className="h-56 w-40 shrink-0 rounded-xl border border-surface-700 object-cover shadow-xl"
          />
          <div className="min-w-0 flex-1 pt-16">
            <h1 className="text-2xl font-bold">{title}</h1>
            {data.title.romaji && data.title.romaji !== title && (
              <p className="text-sm text-ink-500">{data.title.romaji}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-300">
              {data.averageScore !== null && (
                <span className="flex items-center gap-1 text-amber-300">
                  <Star size={14} fill="currentColor" /> {data.averageScore}%
                </span>
              )}
              {data.format && <span>{formatLabel(data.format, t)}</span>}
              {data.episodes && (
                <span>
                  {data.episodes} {t("common.episodes")}
                </span>
              )}
              {data.chapters && (
                <span>
                  {data.chapters} {t("common.chapters")}
                </span>
              )}
              {data.volumes && (
                <span>
                  {data.volumes} {t("common.volumes")}
                </span>
              )}
              {data.duration && (
                <span>{t("detail.minutes", { n: data.duration })}</span>
              )}
              {data.seasonYear && (
                <span>
                  {data.season ? `${t(`season.${data.season}`)} ` : ""}
                  {data.seasonYear}
                </span>
              )}
              {data.studios.nodes[0] && (
                <span className="text-ink-500">
                  {data.studios.nodes.map((s) => s.name).join(", ")}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-surface-800 px-2.5 py-0.5 text-xs text-ink-300"
                >
                  {g}
                </span>
              ))}
            </div>
            {data.type === "ANIME" &&
              (() => {
                const remaining = remainingMinutes(
                  data,
                  data.mediaListEntry?.progress ?? 0,
                );
                return remaining !== null && remaining > 0 ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-300">
                    <Clock size={14} className="text-ink-500" />
                    {t("detail.timeLeft", {
                      time: formatMinutes(remaining, t),
                    })}
                  </p>
                ) : null;
              })()}
            {data.nextAiringEpisode && (
              <p className="mt-2 text-sm text-accent-400">
                {t("detail.nextEpisode", {
                  n: data.nextAiringEpisode.episode,
                  date: new Date(
                    data.nextAiringEpisode.airingAt * 1000,
                  ).toLocaleString(i18n.language, {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </p>
            )}
            <button
              onClick={() =>
                openUrl(
                  `https://anilist.co/${data.type === "MANGA" ? "manga" : "anime"}/${data.id}`,
                )
              }
              className="mt-2 flex items-center gap-1 text-xs text-ink-500 hover:text-accent-400"
            >
              {t("detail.openOnAniList")} <ExternalLink size={11} />
            </button>
          </div>
        </div>

        <ListEditor
          media={data}
          mediaType={data.type}
          max={maxProgress(data)}
          entry={data.mediaListEntry}
        />

        {data.description && (
          <Card className="mt-6">
            <CardTitle>{t("detail.description")}</CardTitle>
            <p
              className="mt-3 select-text text-sm leading-relaxed text-ink-300"
              dangerouslySetInnerHTML={{
                __html: sanitizeDescription(data.description),
              }}
            />
          </Card>
        )}

        {data.relations.edges.filter(
          (e) => e.node.type === "ANIME" || e.node.type === "MANGA",
        ).length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <CardTitle>{t("detail.related")}</CardTitle>
              <Link
                to={`/franchise/${data.id}`}
                className="text-xs text-accent-400 hover:underline"
              >
                {t("franchise.view")}
              </Link>
            </div>
            <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
              {data.relations.edges
                .filter((e) => e.node.type === "ANIME" || e.node.type === "MANGA")
                .map((e) => (
                  <Link
                    key={`${e.relationType}-${e.node.id}`}
                    to={`/media/${e.node.id}`}
                    className="w-28 shrink-0"
                  >
                    <img
                      src={e.node.coverImage.large ?? ""}
                      alt=""
                      loading="lazy"
                      className="aspect-[2/3] w-full rounded-lg object-cover"
                    />
                    <p className="mt-1 text-xs text-accent-400">
                      {t(`relation.${e.relationType}`, {
                        defaultValue: e.relationType,
                      })}
                    </p>
                    <p className="line-clamp-2 text-xs text-ink-300">
                      {displayTitle(e.node.title)}
                    </p>
                  </Link>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ListEditor({
  media,
  mediaType,
  max: maxTotal,
  entry,
}: {
  media: MediaDetail;
  mediaType: MediaType;
  max: number | null;
  entry: {
    id: number;
    status: MediaListStatus;
    progress: number;
    score: number;
    repeat: number;
    notes: string | null;
  } | null;
}) {
  const { t } = useTranslation();
  const mediaId = media.id;
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const qc = useQueryClient();
  const [status, setStatus] = useState<MediaListStatus>(
    entry?.status ?? "PLANNING",
  );
  const [progress, setProgress] = useState(entry?.progress ?? 0);
  const [score, setScore] = useState(entry?.score ?? 0);
  const [repeat, setRepeat] = useState(entry?.repeat ?? 0);
  const parsed = parseNotes(entry?.notes);
  const [notes, setNotes] = useState(parsed.notes);
  const [tags, setTags] = useState(parsed.tags);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setStatus(entry?.status ?? "PLANNING");
    setProgress(entry?.progress ?? 0);
    setScore(entry?.score ?? 0);
    setRepeat(entry?.repeat ?? 0);
    const p = parseNotes(entry?.notes);
    setNotes(p.notes);
    setTags(p.tags);
  }, [entry]);

  const save = useMutation({
    mutationFn: () =>
      saveListEntry(
        {
          mediaId,
          status,
          progress,
          score,
          repeat,
          notes: serializeNotes(notes, tags),
        },
        media,
      ),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["mediaList"] });
      qc.invalidateQueries({ queryKey: ["mediaDetail", mediaId] });
    },
  });

  if (!viewer && mode !== "local") return null;
  const max = maxTotal ?? 99999;

  return (
    <Card className="mt-6">
      <CardTitle>
        {entry ? t("detail.myEntry") : t("detail.addToList")}
      </CardTitle>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-ink-500">{t("common.status")}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MediaListStatus)}
            className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t(`status.${mediaType}.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-500">
            {t("common.progress")}
          </span>
          <Input
            type="number"
            min={0}
            max={max}
            value={progress}
            onChange={(e) =>
              setProgress(Math.max(0, Math.min(max, Number(e.target.value))))
            }
            className="w-24"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-500">{t("common.score")}</span>
          <Input
            type="number"
            min={0}
            max={10}
            value={score}
            onChange={(e) =>
              setScore(Math.max(0, Math.min(10, Number(e.target.value))))
            }
            className="w-20"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-500">
            {mediaType === "MANGA" ? t("entry.rereads") : t("entry.rewatches")}
          </span>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              value={repeat}
              onChange={(e) => setRepeat(Math.max(0, Number(e.target.value)))}
              className="w-20"
            />
            <Button
              variant="secondary"
              size="icon"
              aria-label={t("entry.addRepeat")}
              title={t("entry.addRepeat")}
              onClick={() => setRepeat((r) => r + 1)}
            >
              +1
            </Button>
          </div>
        </label>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {saved
            ? t("common.saved")
            : entry
              ? t("common.save")
              : t("common.add")}
        </Button>
        {save.error && (
          <p className="text-sm text-red-300">{String(save.error)}</p>
        )}
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-sm text-ink-500">
          {t("tags.label")}
        </span>
        <TagEditor tags={tags} onChange={setTags} />
      </div>
      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-ink-500">{t("entry.notes")}</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={t("entry.notesPlaceholder")}
          className="w-full resize-y rounded-lg border border-surface-700 bg-surface-900 px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
        />
      </label>
    </Card>
  );
}
