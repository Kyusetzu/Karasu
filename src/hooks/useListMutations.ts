import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  bulkSaveEntries,
  BulkSaveError,
  currentScoreFormat,
  deleteListEntry,
  saveListEntry,
  type BulkPatch,
} from "@/api/anilist";
import { formatScore } from "@/lib/scoreFormat";
import type {
  ListResult,
  MediaListEntry,
  MediaType,
  SaveEntryInput,
} from "@/api/types";
import { displayTitle } from "@/api/types";
import { headline, inverse, type EntrySnapshot } from "@/lib/receipt";
import { splitBulkPatch, withCompletion } from "@/lib/completion";
import { showToast } from "@/stores/toast";

/** Mutations on one media list with optimistic cache updates; a status change moves the entry locally, no refetch. */
export function useListMutations(userId: number, mediaType: MediaType) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const key = ["mediaList", mediaType, userId];

  const findEntry = (data: ListResult | undefined, mediaId: number) =>
    data?.lists.flatMap((g) => g.entries).find((e) => e.mediaId === mediaId);

  const snapshot = (entry: MediaListEntry): EntrySnapshot => ({
    status: entry.status,
    progress: entry.progress,
    // Entries cached before schema v7 have no volume count at all.
    progressVolumes: entry.progressVolumes ?? 0,
    score: entry.score,
    repeat: entry.repeat,
    notes: entry.notes,
    private: entry.private,
    hiddenFromStatusLists: entry.hiddenFromStatusLists ?? null,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
  });

  /** The one line the receipt leads with. */
  const receiptText = (
    input: SaveEntryInput,
    before: EntrySnapshot,
    title: string,
  ): string => {
    const head = headline(input, before);
    if (!head) return t("receipt.saved", { title });
    switch (head.field) {
      case "progress":
        return t("receipt.progress", { title, n: head.value as number });
      case "progressVolumes":
        return t("receipt.volumes", { title, n: head.value as number });
      case "status":
        return t("receipt.status", {
          title,
          status: t(`status.${mediaType}.${head.value as string}`),
        });
      case "score":
        // Rendered, not raw: a smiley account should read "scored 🙂", not "scored 2"; local mode's cache holds POINT_10.
        return t("receipt.score", {
          title,
          n: formatScore(currentScoreFormat(), head.value as number),
        });
      default:
        return t("receipt.saved", { title });
    }
  };

  /** `??` throughout, so an absent key means leave alone; both patch paths share this so no field goes missing. */
  const applyInput = (
    e: MediaListEntry,
    input: Omit<SaveEntryInput, "mediaId">,
    now: number,
  ): MediaListEntry => ({
    ...e,
    progress: input.progress ?? e.progress,
    progressVolumes: input.progressVolumes ?? e.progressVolumes,
    score: input.score ?? e.score,
    status: input.status ?? e.status,
    repeat: input.repeat ?? e.repeat,
    notes: input.notes ?? e.notes,
    private: input.private ?? e.private,
    hiddenFromStatusLists: input.hiddenFromStatusLists ?? e.hiddenFromStatusLists,
    customLists:
      input.customLists !== undefined
        ? Object.fromEntries(input.customLists.map((n) => [n, true]))
        : e.customLists,
    startedAt: input.startedAt ?? e.startedAt,
    completedAt: input.completedAt ?? e.completedAt,
    updatedAt: now,
    // `advancedScores` is not patched here: the input is positional, the entry a map; `onSuccess` takes the server's.
  });

  /** Applies one patch to every listed media id in one cache write, so a bulk edit is one mutation with one rollback. */
  const patchCacheMany = (
    mediaIds: Set<number>,
    input: Omit<SaveEntryInput, "mediaId">,
  ) => {
    qc.setQueryData<ListResult>(key, (old) => {
      if (!old) return old;
      const now = Math.floor(Date.now() / 1000);
      const lists = old.lists.map((group) => ({
        ...group,
        entries: group.entries
          .map((e) => (mediaIds.has(e.mediaId) ? applyInput(e, input, now) : e))
          // On a status change, remove from the old status group
          .filter(
            (e) =>
              !mediaIds.has(e.mediaId) ||
              !input.status ||
              group.isCustomList ||
              group.status === input.status,
          ),
      }));
      // Insert into the target group, minting it when the account has none yet so the entry cannot vanish.
      if (input.status) {
        let target = lists.find(
          (g) => !g.isCustomList && g.status === input.status,
        );
        if (!target) {
          target = { name: input.status, status: input.status, isCustomList: false, entries: [] };
          lists.push(target);
        }
        // By media id: an entry also in a custom list appears more than once in this flat pass and would be inserted twice.
        const moved = new Map<number, MediaListEntry>();
        for (const e of old.lists.flatMap((g) => g.entries)) {
          if (!mediaIds.has(e.mediaId) || moved.has(e.mediaId)) continue;
          if (target.entries.some((t) => t.mediaId === e.mediaId)) continue;
          moved.set(e.mediaId, applyInput(e, input, now));
        }
        if (moved.size) target.entries = [...moved.values(), ...target.entries];
      }
      return { ...old, lists };
    });
  };

  const patchCache = (input: SaveEntryInput) =>
    patchCacheMany(new Set([input.mediaId]), input);

  const saveMutation = useMutation({
    mutationFn: (input: SaveEntryInput) => saveListEntry(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ListResult>(key);
      const entry = findEntry(previous, input.mediaId);
      patchCache(input);
      // Captured before the patch and per entry; `lib/receipt.ts` is why undo is a new write rather than a restore.
      return {
        previous,
        before: entry ? snapshot(entry) : undefined,
        title: entry ? displayTitle(entry.media.title) : undefined,
      };
    },
    onSuccess: (res, input, ctx) => {
      // AniList derives the overall score from the categories, so reconcile from the mutation's result, not the guess.
      if (res?.entry?.advancedScores) {
        const { score, advancedScores } = res.entry;
        qc.setQueryData<ListResult>(key, (old) =>
          old
            ? {
                ...old,
                lists: old.lists.map((group) => ({
                  ...group,
                  entries: group.entries.map((e) =>
                    e.mediaId === input.mediaId ? { ...e, score, advancedScores } : e,
                  ),
                })),
              }
            : old,
        );
      }
      if (!ctx?.before || !ctx.title) return;
      const undo = inverse(input, ctx.before);
      // A save that changed nothing gets no receipt; undoing a no-op is noise, and so is announcing one.
      if (!undo) return;
      // `queued` is not success: the edit still sits in SQLite, so it must not wear the green receipt of a landed write.
      showToast({
        kind: res?.queued ? "info" : "success",
        text: res?.queued
          ? t("receipt.queued", { title: ctx.title })
          : receiptText(input, ctx.before, ctx.title),
        action: {
          label: t("receipt.undo"),
          // Raw, not through the fill: the undo restores a recorded state, and refilling would overwrite it with totals.
          run: () => saveMutation.mutate(undo),
        },
      });
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      // An optimistic write that failed has already shown as succeeding, so the rollback is invisible without this.
      showToast({
        kind: "error",
        text: t("receipt.failed", { title: ctx?.title ?? "" }).trim(),
        detail: t("receipt.failedDetail"),
        action: { label: t("common.retry"), run: () => saveMutation.mutate(input) },
      });
    },
  });

  // Filled at the door, before the optimistic patch moves the entry whose media and status the fill reads.
  const fill = useCallback(
    (input: SaveEntryInput): SaveEntryInput => {
      const cached = findEntry(qc.getQueryData<ListResult>(["mediaList", mediaType, userId]), input.mediaId);
      return withCompletion(input, cached?.media, mediaType, cached?.status);
    },
    [qc, mediaType, userId],
  );
  const { mutate: sendSave, mutateAsync: sendSaveAsync } = saveMutation;
  const mutateSave = useCallback((input: SaveEntryInput) => sendSave(fill(input)), [sendSave, fill]);
  const mutateSaveAsync = useCallback(
    (input: SaveEntryInput) => sendSaveAsync(fill(input)),
    [sendSaveAsync, fill],
  );
  /** The mutation with a move into COMPLETED carrying the cached totals, so the patch, receipt and Undo all see them. */
  const save = { ...saveMutation, mutate: mutateSave, mutateAsync: mutateSaveAsync };

  /** One patch across a selection as a single mutation; per-entry mutations fanned out and their rollbacks fought. */
  const bulkSave = useMutation({
    mutationFn: async ({
      entries,
      patch,
    }: {
      entries: MediaListEntry[];
      /** What `UpdateMediaListEntries` takes across a selection; `notes` is left out because tags are serialized into it. */
      patch: BulkPatch;
    }) => {
      let done = 0;
      // One request per distinct total when completing; a later group failing still reports the landed ones.
      for (const group of splitBulkPatch(entries, patch, mediaType)) {
        try {
          done += await bulkSaveEntries(group.entries, group.patch);
        } catch (err) {
          if (done === 0) throw err;
          const landed = err instanceof BulkSaveError ? err.updated : 0;
          throw new BulkSaveError(err instanceof Error ? err.message : String(err), done + landed);
        }
      }
      return done;
    },
    onMutate: async ({ entries, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ListResult>(key);
      for (const group of splitBulkPatch(entries, patch, mediaType)) {
        patchCacheMany(new Set(group.entries.map((e) => e.mediaId)), group.patch);
      }
      return { previous, count: entries.length };
    },
    onSuccess: (_res, _vars, ctx) => {
      showToast({
        kind: "success",
        text: t("receipt.bulkSaved", { count: ctx?.count ?? 0 }),
      });
    },
    onError: (err, vars, ctx) => {
      // The chunks stop at the first failure, so part may be written; refetch rather than restore a snapshot that lies.
      const partial = err instanceof BulkSaveError && err.updated > 0;
      if (partial) void qc.invalidateQueries({ queryKey: key });
      else if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      showToast({
        kind: "error",
        text: partial
          ? t("receipt.bulkPartial", {
              done: (err as BulkSaveError).updated,
              count: ctx?.count ?? 0,
            })
          : t("receipt.bulkFailed", { count: ctx?.count ?? 0 }),
        detail: t("receipt.failedDetail"),
        // No retry offer on a partial run: the same selection would be sent again, including the part that landed.
        action: partial
          ? undefined
          : { label: t("common.retry"), run: () => bulkSave.mutate(vars) },
      });
    },
  });

  const remove = useMutation({
    mutationFn: deleteListEntry,
    onError: () => {
      // Without this a failed removal is silent: the row stays on screen and the confirm dialog has already closed.
      showToast({
        kind: "error",
        text: t("receipt.removeFailed"),
        detail: t("receipt.failedDetail"),
      });
    },
    onSuccess: (_res, id) => {
      qc.setQueryData<ListResult>(key, (old) =>
        old
          ? {
              ...old,
              lists: old.lists.map((g) => ({
                ...g,
                entries: g.entries.filter((e) => e.id !== id),
              })),
            }
          : old,
      );
    },
  });

  /** Removes a selection sequentially, since `DeleteMediaListEntry` takes one id and a burst of them earns 429s. */
  const bulkRemove = useMutation({
    mutationFn: async (entries: MediaListEntry[]) => {
      const removed: number[] = [];
      const failed: string[] = [];
      for (const entry of entries) {
        try {
          await deleteListEntry(entry.id);
          removed.push(entry.id);
        } catch {
          // Carry on: a selection half-removed and reported beats one that stops and leaves the user guessing.
          failed.push(displayTitle(entry.media.title));
        }
      }
      return { removed, failed };
    },
    onSuccess: ({ removed, failed }) => {
      if (removed.length) {
        const gone = new Set(removed);
        qc.setQueryData<ListResult>(key, (old) =>
          old
            ? {
                ...old,
                lists: old.lists.map((g) => ({
                  ...g,
                  entries: g.entries.filter((e) => !gone.has(e.id)),
                })),
              }
            : old,
        );
      }
      if (failed.length) {
        showToast({
          kind: "error",
          text: t("receipt.removedPartial", {
            count: removed.length,
            failed: failed.length,
          }),
          detail: failed.slice(0, 3).join(", "),
        });
      } else {
        showToast({
          kind: "success",
          text: t("receipt.removedMany", { count: removed.length }),
        });
      }
    },
    onError: () => {
      showToast({
        kind: "error",
        text: t("receipt.removeFailed"),
        detail: t("receipt.failedDetail"),
      });
    },
  });

  return { save, bulkSave, remove, bulkRemove };
}
