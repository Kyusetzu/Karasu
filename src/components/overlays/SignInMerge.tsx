import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  anilistFetchList,
  anilistSaveEntry,
  currentScoreFormat,
  localAllEntries,
  localClearEntry,
  type LocalEntryRow,
} from "@/api/anilist";
import { toRaw } from "@/lib/scoreFormat";
import {
  conflicts as sidesDiffer,
  localWins,
  type MergeSide,
  type MergeStrategy,
} from "@/lib/mergeDecision";
import { displayTitle, type MediaListGroup } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * When a local-only user connects AniList, offer to merge the local list into
 * their account. Local rows are cleared only after each push is confirmed, so
 * an interrupted merge never loses data. Shown once per session.
 *
 * The merge refuses to run at all unless it has read *both* live AniList lists
 * first. It is a one-way push with no undo, and every comparison it makes is
 * against what it read: an unread list looks exactly like an empty account, at
 * which point every local row is an "addition" and the whole local list lands
 * on top of real progress. Serving that comparison from the offline cache is
 * the same hazard one step removed — the cache is by definition the last state
 * Karasu could reach, not the current one.
 */
export default function SignInMerge() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const qc = useQueryClient();

  const [rows, setRows] = useState<LocalEntryRow[] | null>(null);
  const [online, setOnline] = useState<Map<number, MergeSide>>(new Map());
  const [strategy, setStrategy] = useState<MergeStrategy>("newest");
  const [phase, setPhase] = useState<"review" | "blocked" | "running" | "done">(
    "review",
  );
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState({ merged: 0, queued: 0, failed: 0 });
  const checked = useRef(false);

  useEffect(() => {
    if (!viewer || checked.current) return;
    checked.current = true;
    (async () => {
      const local = await localAllEntries().catch(() => []);
      if (local.length === 0) return;
      const map = new Map<number, MergeSide>();
      for (const type of ["ANIME", "MANGA"] as const) {
        const res = await anilistFetchList(viewer.id, type).catch(() => null);
        if (!res || res.fromCache) {
          setPhase("blocked");
          setRows(local);
          return;
        }
        for (const g of res.lists as MediaListGroup[]) {
          if (g.isCustomList) continue;
          for (const e of g.entries) {
            map.set(e.mediaId, {
              status: e.status,
              progress: e.progress,
              // Onto the raw hundred-point scale here, at the boundary, so the
              // decision below never has to know which format either side is
              // in. (The connect flow seeds the format cache before this
              // dialog mounts.)
              scoreRaw: toRaw(currentScoreFormat(), e.score),
              updatedAt: e.updatedAt,
            });
          }
        }
      }
      setOnline(map);
      setRows(local);
    })();
  }, [viewer]);

  if (!rows) return null;

  const asSide = (r: LocalEntryRow): MergeSide => ({
    status: r.status,
    progress: r.progress,
    scoreRaw: toRaw("POINT_10", r.score),
    updatedAt: r.updatedAt,
  });
  const conflicts = rows.filter((r) => {
    const o = online.get(r.mediaId);
    return !!o && sidesDiffer(asSide(r), o);
  });
  const additions = rows.filter((r) => !online.has(r.mediaId));

  const run = async () => {
    setPhase("running");
    let done = 0;
    const tally = { merged: 0, queued: 0, failed: 0 };
    for (const r of rows) {
      try {
        if (localWins(asSide(r), online.get(r.mediaId) ?? null, strategy)) {
          // Everything the local row holds. The merge deletes that row once
          // the push lands, so anything left out here is gone for good —
          // which is what happened to manga volumes, privacy and both dates
          // until this list caught up with what the local schema stores.
          const res = await anilistSaveEntry({
            mediaId: r.mediaId,
            status: r.status,
            progress: r.progress,
            progressVolumes: r.progressVolumes,
            score: r.score,
            repeat: r.repeat,
            notes: r.notes,
            private: r.private,
            ...(r.startedAt ? { startedAt: r.startedAt } : {}),
            ...(r.completedAt ? { completedAt: r.completedAt } : {}),
          });
          // A queued write has not reached AniList yet. Clearing the local row
          // on the strength of it would leave the entry in the offline queue
          // and nowhere else — and the queue is the one copy the user cannot
          // see, edit or export.
          if (res.queued) {
            tally.queued += 1;
            done += 1;
            setProgress(done);
            continue;
          }
        }
        // Resolved (pushed or intentionally kept AniList's) → drop local row.
        await localClearEntry(r.mediaId);
        tally.merged += 1;
      } catch {
        // Leave this row in place; the user can retry the merge later.
        tally.failed += 1;
      }
      done += 1;
      setProgress(done);
    }
    setResult(tally);
    qc.invalidateQueries({ queryKey: ["mediaList"] });
    setPhase("done");
  };

  const close = () => setRows(null);

  return (
    <Modal title={t("merge.title")} onClose={phase === "running" ? () => {} : close}>
      {phase === "blocked" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-300">{t("merge.blocked")}</p>
          <div className="flex justify-end">
            <Button onClick={close}>{t("merge.later")}</Button>
          </div>
        </div>
      ) : phase === "done" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-300">
            {t("merge.done", { count: result.merged })}
          </p>
          {result.queued > 0 && (
            <p className="text-sm text-gold">
              {t("merge.doneQueued", { count: result.queued })}
            </p>
          )}
          {result.failed > 0 && (
            <p className="text-sm text-rose-400">
              {t("merge.doneFailed", { count: result.failed })}
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={close}>{t("common.done")}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-300">
            {t("merge.summary", {
              total: rows.length,
              add: additions.length,
              conflicts: conflicts.length,
            })}
          </p>

          {conflicts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-ink-500">{t("merge.conflictPrompt")}</p>
              {(["newest", "local", "anilist"] as MergeStrategy[]).map((s) => (
                <label
                  key={s}
                  className="flex items-center gap-2 text-sm text-ink-300"
                >
                  <input
                    type="radio"
                    name="merge-strategy"
                    checked={strategy === s}
                    onChange={() => setStrategy(s)}
                    disabled={phase === "running"}
                  />
                  {t(`merge.strategy.${s}`)}
                </label>
              ))}
              <ul className="max-h-32 overflow-y-auto rounded-lg bg-surface-850 p-2 text-xs text-ink-500">
                {conflicts.map((r) => (
                  <li key={r.mediaId} className="truncate">
                    {displayTitle(r.media.title)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase === "running" && (
            <p className="text-xs text-accent-400">
              {t("merge.progress", { done: progress, total: rows.length })}
            </p>
          )}

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={close} disabled={phase === "running"}>
              {t("merge.later")}
            </Button>
            <Button onClick={run} disabled={phase === "running"}>
              {t("merge.run")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
