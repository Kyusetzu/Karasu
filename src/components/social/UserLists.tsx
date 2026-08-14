import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { userList, type ForeignListEntry, type UserProfile } from "@/api/social";
import { isTauri } from "@/api/anilist";
import {
  STATUS_ORDER,
  displayTitle,
  type ListResult,
  type MediaListStatus,
  type MediaType,
} from "@/api/types";
import { asScoreFormat, formatScore, toRaw } from "@/lib/scoreFormat";
import { affinity } from "@/lib/affinity";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { useAuth, useScoreFormat } from "@/stores/auth";
import { CoverCell, CoverMeta } from "@/components/media/CoverCell";
import { TitleLockup } from "@/components/media/TitleLockup";
import { Pill } from "@/components/ui/pill";
import { Shimmer } from "@/components/Skeleton";
import { EmptyState, PerchRule } from "@/components/EmptyState";

/**
 * Another user's list, read-only — rendered with the mutation-free cover
 * pieces (`CoverCell`), never the viewer's own list machinery: `GridCard`
 * wants five mutation callbacks and the *viewer's* score format, both wrong
 * here. Scores render in the owner's format, because their ★4 on a
 * five-star account is what they actually said.
 *
 * One request per medium, spent when the tab (a user-initiated moment)
 * mounts this component. The affinity strip costs nothing extra: the
 * viewer's own list is read from the cache it already lives in, compared on
 * the raw scale where the two formats meet.
 */
export function UserLists({ user }: { user: UserProfile }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const viewer = useAuth((s) => s.viewer);
  const viewerFormat = useScoreFormat();
  const level = useContentFilter((s) => s.level);
  const [type, setType] = useState<MediaType>("ANIME");
  const [status, setStatus] = useState<MediaListStatus>("CURRENT");

  const q = useQuery({
    queryKey: ["social", "userList", user.id, type],
    queryFn: () => userList(user.id, type),
    enabled: isTauri,
    staleTime: 10 * 60 * 1000,
  });

  const theirFormat = asScoreFormat(user.mediaListOptions?.scoreFormat);

  // De-duped by media id: a custom list echoes entries the status lists
  // already carry (the Wrapped query documents the same trap).
  const entries = useMemo(() => {
    const seen = new Set<number>();
    const out: ForeignListEntry[] = [];
    for (const group of q.data ?? []) {
      if (group.isCustomList) continue;
      for (const e of group.entries) {
        if (seen.has(e.mediaId) || isBlocked(e.media, level)) continue;
        seen.add(e.mediaId);
        out.push(e);
      }
    }
    return out;
  }, [q.data, level]);

  const byStatus = useMemo(() => {
    const map = new Map<MediaListStatus, ForeignListEntry[]>();
    for (const s of STATUS_ORDER) map.set(s, []);
    for (const e of entries) map.get(e.status as MediaListStatus)?.push(e);
    return map;
  }, [entries]);

  const match = useMemo(() => {
    if (!viewer || viewer.id === user.id) return null;
    const mineData = qc.getQueryData<ListResult>(["mediaList", type, viewer.id]);
    if (!mineData) return null;
    const mine = mineData.lists
      .filter((g) => !g.isCustomList)
      .flatMap((g) => g.entries)
      .map((e) => ({ mediaId: e.mediaId, raw: toRaw(viewerFormat, e.score) }));
    const theirs = entries.map((e) => ({
      mediaId: e.mediaId,
      raw: toRaw(theirFormat, e.score),
    }));
    return affinity(mine, theirs);
  }, [qc, viewer, user.id, type, entries, viewerFormat, theirFormat]);

  const titleOf = useMemo(
    () => new Map(entries.map((e) => [e.mediaId, displayTitle(e.media.title)])),
    [entries],
  );

  const shown = byStatus.get(status) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["ANIME", "MANGA"] as const).map((tp) => (
          <Pill key={tp} active={type === tp} onClick={() => setType(tp)}>
            {tp === "ANIME" ? t("common.anime") : t("common.manga")}
          </Pill>
        ))}
        <span className="mx-1 h-4 w-px bg-surface-700" />
        {STATUS_ORDER.map((s) => (
          <Pill key={s} active={status === s} onClick={() => setStatus(s)}>
            {t(`status.${type}.${s}`)}
            <span className="ml-1 tabular-nums text-ink-600">
              {byStatus.get(s)?.length ?? 0}
            </span>
          </Pill>
        ))}
      </div>

      {match && match.shared > 0 && (
        <div className="rounded-lg border border-surface-800 bg-surface-900 px-3 py-2 text-xs text-ink-300">
          <span className="font-medium text-ink-100">
            {match.pearson !== null
              ? t("social.affinity", { pct: Math.round(match.pearson * 100) })
              : t("social.affinityNone")}
          </span>
          {" · "}
          {t("social.affinityShared", { n: match.shared })}
          {match.disagreements.length > 0 && (
            <span className="mt-1 block text-2xs text-ink-600">
              {t("social.affinityDisagree")}{" "}
              {match.disagreements
                .map((d) => titleOf.get(d.mediaId))
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
      )}

      {q.isLoading && <Shimmer className="h-40 w-full rounded-xl" />}
      {q.error != null && (
        <p className="text-sm text-danger">
          {t("common.error", { message: String(q.error) })}
        </p>
      )}
      {q.data && shown.length === 0 && (
        <EmptyState visual={<PerchRule />} title={t("social.listsEmpty")} />
      )}
      {shown.length > 0 && (
        <div className="media-grid gap-x-4 gap-y-6">
          {shown.map((e) => {
            const total = type === "ANIME" ? e.media.episodes : e.media.chapters;
            return (
              <CoverCell
                key={e.mediaId}
                to={`/media/${e.mediaId}`}
                cover={e.media.coverImage.large}
                score={e.score > 0 ? formatScore(theirFormat, e.score) : undefined}
                progress={total ? { current: e.progress, total } : null}
              >
                <Link to={`/media/${e.mediaId}`}>
                  <TitleLockup title={e.media.title} clamp={2} tone="muted" className="mt-2" />
                </Link>
                <CoverMeta>
                  {e.progress}
                  {total ? ` / ${total}` : ""}
                </CoverMeta>
              </CoverCell>
            );
          })}
        </div>
      )}
    </div>
  );
}
