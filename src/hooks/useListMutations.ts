import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { bulkSaveEntries, deleteListEntry, saveListEntry } from "@/api/anilist";
import type {
  ListResult,
  MediaListEntry,
  MediaListStatus,
  MediaType,
  SaveEntryInput,
} from "@/api/types";
import { displayTitle } from "@/api/types";
import { headline, inverse, type EntrySnapshot } from "@/lib/receipt";
import { showToast } from "@/stores/toast";

/**
 * Mutations on a media list (anime or manga) with optimistic cache
 * updates. Status changes move the entry locally into the matching group
 * so no expensive refetch (rate limit!) is needed.
 */
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
        return t("receipt.score", { title, n: head.value as number });
      default:
        return t("receipt.saved", { title });
    }
  };

  /**
   * Applies one patch to every listed media id, in a single cache write.
   *
   * Taking a set rather than one id is what lets a bulk edit be one mutation:
   * patching per entry meant N passes over the whole collection, and N
   * optimistic mutations whose rollbacks then fought each other.
   */
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
          .map((e) =>
            mediaIds.has(e.mediaId)
              ? {
                  ...e,
                  progress: input.progress ?? e.progress,
                  progressVolumes: input.progressVolumes ?? e.progressVolumes,
                  score: input.score ?? e.score,
                  status: input.status ?? e.status,
                  repeat: input.repeat ?? e.repeat,
                  notes: input.notes ?? e.notes,
                  updatedAt: now,
                }
              : e,
          )
          // On a status change, remove from the old status group
          .filter(
            (e) =>
              !mediaIds.has(e.mediaId) ||
              !input.status ||
              group.isCustomList ||
              group.status === input.status,
          ),
      }));
      // Insert into the target group if it exists
      if (input.status) {
        const target = lists.find(
          (g) => !g.isCustomList && g.status === input.status,
        );
        if (target) {
          // By media id: an entry also present in a custom list appears more
          // than once in this flat pass, and inserting it twice would render
          // it twice.
          const moved = new Map<number, MediaListEntry>();
          for (const e of old.lists.flatMap((g) => g.entries)) {
            if (!mediaIds.has(e.mediaId) || moved.has(e.mediaId)) continue;
            if (target.entries.some((t) => t.mediaId === e.mediaId)) continue;
            moved.set(e.mediaId, { ...e, ...input, updatedAt: now });
          }
          if (moved.size)
            target.entries = [...moved.values(), ...target.entries];
        }
      }
      return { ...old, lists };
    });
  };

  const patchCache = (input: SaveEntryInput) =>
    patchCacheMany(new Set([input.mediaId]), input);

  const save = useMutation({
    mutationFn: (input: SaveEntryInput) => saveListEntry(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ListResult>(key);
      const entry = findEntry(previous, input.mediaId);
      patchCache(input);
      // Captured *before* the patch, and captured per-entry rather than as a
      // whole-cache snapshot — see `lib/receipt.ts` for why undo has to be a
      // new write instead of a restore.
      return {
        previous,
        before: entry ? snapshot(entry) : undefined,
        title: entry ? displayTitle(entry.media.title) : undefined,
      };
    },
    onSuccess: (_res, input, ctx) => {
      if (!ctx?.before || !ctx.title) return;
      const undo = inverse(input, ctx.before);
      // A save that changed nothing gets no receipt. Undoing a no-op is noise,
      // and so is announcing one.
      if (!undo) return;
      showToast({
        kind: "success",
        text: receiptText(input, ctx.before, ctx.title),
        action: {
          label: t("receipt.undo"),
          run: () => save.mutate(undo),
        },
      });
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      // An optimistic write that failed has already been shown as succeeding,
      // so the rollback above is invisible without this.
      showToast({
        kind: "error",
        text: t("receipt.failed", { title: ctx?.title ?? "" }).trim(),
        detail: t("receipt.failedDetail"),
        action: { label: t("common.retry"), run: () => save.mutate(input) },
      });
    },
  });

  /**
   * One status or score across a selection, as a single mutation.
   *
   * Deliberately not `selection.forEach(save.mutate)`, which is what this
   * replaces. That fired one request per entry — hundreds at once against a
   * ~30/min budget — and, because each `onMutate` snapshotted a cache the
   * earlier siblings had already patched, a single failure restored a snapshot
   * that erased the siblings which had succeeded. One mutation has no siblings
   * to erase, and its rollback covers exactly what it changed.
   */
  const bulkSave = useMutation({
    mutationFn: ({
      entries,
      patch,
    }: {
      entries: MediaListEntry[];
      patch: { status?: MediaListStatus; score?: number };
    }) => bulkSaveEntries(entries, patch),
    onMutate: async ({ entries, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ListResult>(key);
      patchCacheMany(new Set(entries.map((e) => e.mediaId)), patch);
      return { previous, count: entries.length };
    },
    onSuccess: (_res, _vars, ctx) => {
      showToast({
        kind: "success",
        text: t("receipt.bulkSaved", { count: ctx?.count ?? 0 }),
      });
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      showToast({
        kind: "error",
        text: t("receipt.bulkFailed", { count: ctx?.count ?? 0 }),
        detail: t("receipt.failedDetail"),
        action: { label: t("common.retry"), run: () => bulkSave.mutate(vars) },
      });
    },
  });

  const remove = useMutation({
    mutationFn: deleteListEntry,
    onError: () => {
      // Without this a failed removal is completely silent: `onSuccess` never
      // runs so the row stays on screen, and the confirm dialog has already
      // closed as though it worked.
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

  return { save, bulkSave, remove };
}
