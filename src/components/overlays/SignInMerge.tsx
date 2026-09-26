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
  hasResidual,
  localWins,
  residual,
  type MergeExtras,
  type MergeSide,
  type MergeStrategy,
} from "@/lib/mergeDecision";
import { displayTitle, type MediaListGroup } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { usePresentValue } from "@/hooks/usePresence";

/** Merges the local list into the account, only after reading both live lists: an unread one looks like an empty account. */
export default function SignInMerge() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const qc = useQueryClient();

  const [rows, setRows] = useState<LocalEntryRow[] | null>(null);
  // The extras ride along because the merge deletes the local row, and what only it holds must be checked first.
  const [online, setOnline] = useState<Map<number, MergeSide & MergeExtras>>(
    new Map(),
  );
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
      const map = new Map<number, MergeSide & MergeExtras>();
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
              // Onto the raw hundred-point scale at the boundary, so the decision never has to know which format either side is in.
              scoreRaw: toRaw(currentScoreFormat(), e.score),
              updatedAt: e.updatedAt,
              progressVolumes: e.progressVolumes,
              repeat: e.repeat,
              notes: e.notes,
              private: e.private,
              startedAt: e.startedAt,
              completedAt: e.completedAt,
            });
          }
        }
      }
      setOnline(map);
      setRows(local);
    })();
  }, [viewer]);

  // Held through the exit, or `setRows(null)` unmounts the Modal in the same commit and the dialog cuts out.
  const held = usePresentValue(rows);
  if (!held.value) return null;
  const shown = held.value;

  const asSide = (r: LocalEntryRow): MergeSide => ({
    status: r.status,
    progress: r.progress,
    scoreRaw: toRaw("POINT_10", r.score),
    updatedAt: r.updatedAt,
  });
  const conflicts = shown.filter((r) => {
    const o = online.get(r.mediaId);
    return !!o && sidesDiffer(asSide(r), o);
  });
  const additions = shown.filter((r) => !online.has(r.mediaId));

  const run = async () => {
    setPhase("running");
    let done = 0;
    const tally = { merged: 0, queued: 0, failed: 0 };
    for (const r of shown) {
      try {
        const o = online.get(r.mediaId) ?? null;
        if (localWins(asSide(r), o, strategy)) {
          // Every field the local row holds: the merge deletes it once the push lands, so anything left out is gone for good.
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
          // A queued write has not landed; clearing the local row on it leaves the only copy in a queue the user cannot see.
          if (res.queued) {
            tally.queued += 1;
            done += 1;
            setProgress(done);
            continue;
          }
        } else if (o) {
          // AniList won status/progress/score, but the local row is about to go, so push what only it holds first as a patch.
          const extra = residual(r, o);
          if (hasResidual(extra)) {
            const res = await anilistSaveEntry({ mediaId: r.mediaId, ...extra });
            // A queued write has not landed, so clearing on it would leave the only copy in a queue the user cannot see.
            if (res.queued) {
              tally.queued += 1;
              done += 1;
              setProgress(done);
              continue;
            }
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
    <Modal
      title={t("merge.title")}
      leaving={held.leaving}
      onClose={close}
      // A half-done merge left behind would be worse than either answer, so nothing closes it while it runs.
      dismissable={phase !== "running"}
    >
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
            <p className="text-sm text-danger">
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
              total: shown.length,
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
              <ul className="max-h-32 overflow-y-auto rounded-control bg-surface-850 p-2 text-xs text-ink-500">
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
              {t("merge.progress", { done: progress, total: shown.length })}
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
