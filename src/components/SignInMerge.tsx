import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  anilistFetchList,
  anilistSaveEntry,
  localAllEntries,
  localClearEntry,
  type LocalEntryRow,
} from "@/api/anilist";
import { displayTitle, type MediaListGroup } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type Strategy = "newest" | "local" | "anilist";

interface OnlineEntry {
  status: string;
  progress: number;
  score: number;
  updatedAt: number;
}

/**
 * When a local-only user connects AniList, offer to merge the local list into
 * their account. Local rows are cleared only after each push is confirmed, so
 * an interrupted merge never loses data. Shown once per session.
 */
export default function SignInMerge() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const qc = useQueryClient();

  const [rows, setRows] = useState<LocalEntryRow[] | null>(null);
  const [online, setOnline] = useState<Map<number, OnlineEntry>>(new Map());
  const [strategy, setStrategy] = useState<Strategy>("newest");
  const [phase, setPhase] = useState<"review" | "running" | "done">("review");
  const [progress, setProgress] = useState(0);
  const checked = useRef(false);

  useEffect(() => {
    if (!viewer || checked.current) return;
    checked.current = true;
    (async () => {
      const local = await localAllEntries().catch(() => []);
      if (local.length === 0) return;
      const map = new Map<number, OnlineEntry>();
      for (const type of ["ANIME", "MANGA"] as const) {
        const res = await anilistFetchList(viewer.id, type).catch(() => null);
        for (const g of (res?.lists ?? []) as MediaListGroup[]) {
          if (g.isCustomList) continue;
          for (const e of g.entries) {
            map.set(e.mediaId, {
              status: e.status,
              progress: e.progress,
              score: e.score,
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

  const isConflict = (r: LocalEntryRow) => {
    const o = online.get(r.mediaId);
    return (
      !!o &&
      (o.status !== r.status ||
        o.progress !== r.progress ||
        o.score !== r.score)
    );
  };
  const conflicts = rows.filter(isConflict);
  const additions = rows.filter((r) => !online.has(r.mediaId));

  /** Whether the local version should overwrite the AniList one. */
  const localWins = (r: LocalEntryRow) => {
    const o = online.get(r.mediaId);
    if (!o) return true; // brand new → always push
    if (!isConflict(r)) return false; // identical → nothing to do
    if (strategy === "local") return true;
    if (strategy === "anilist") return false;
    return r.updatedAt >= o.updatedAt; // newest
  };

  const run = async () => {
    setPhase("running");
    let done = 0;
    for (const r of rows) {
      try {
        if (localWins(r)) {
          await anilistSaveEntry({
            mediaId: r.mediaId,
            status: r.status,
            progress: r.progress,
            score: r.score,
            repeat: r.repeat,
            notes: r.notes,
          });
        }
        // Resolved (pushed or intentionally kept AniList's) → drop local row.
        await localClearEntry(r.mediaId);
      } catch {
        // Leave this row in place; the user can retry the merge later.
      }
      done += 1;
      setProgress(done);
    }
    qc.invalidateQueries({ queryKey: ["mediaList"] });
    setPhase("done");
  };

  const close = () => setRows(null);

  return (
    <Modal title={t("merge.title")} onClose={phase === "running" ? () => {} : close}>
      {phase === "done" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-300">
            {t("merge.done", { count: progress })}
          </p>
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
              {(["newest", "local", "anilist"] as Strategy[]).map((s) => (
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
