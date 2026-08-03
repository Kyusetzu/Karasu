import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { deleteListEntry, saveListEntry } from "@/api/anilist";
import type {
  ListResult,
  MediaListEntry,
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

  const patchCache = (input: SaveEntryInput) => {
    qc.setQueryData<ListResult>(key, (old) => {
      if (!old) return old;
      const lists = old.lists.map((group) => ({
        ...group,
        entries: group.entries
          .map((e) =>
            e.mediaId === input.mediaId
              ? {
                  ...e,
                  progress: input.progress ?? e.progress,
                  score: input.score ?? e.score,
                  status: input.status ?? e.status,
                  repeat: input.repeat ?? e.repeat,
                  notes: input.notes ?? e.notes,
                  updatedAt: Math.floor(Date.now() / 1000),
                }
              : e,
          )
          // On a status change, remove from the old status group
          .filter(
            (e) =>
              e.mediaId !== input.mediaId ||
              !input.status ||
              group.isCustomList ||
              group.status === input.status,
          ),
      }));
      // Insert into the target group if it exists
      if (input.status) {
        const entry = old.lists
          .flatMap((g) => g.entries)
          .find((e) => e.mediaId === input.mediaId);
        if (entry) {
          const target = lists.find(
            (g) => !g.isCustomList && g.status === input.status,
          );
          if (target && !target.entries.some((e) => e.mediaId === input.mediaId)) {
            target.entries = [
              { ...entry, ...input, updatedAt: Math.floor(Date.now() / 1000) },
              ...target.entries,
            ];
          }
        }
      }
      return { ...old, lists };
    });
  };

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

  const remove = useMutation({
    mutationFn: deleteListEntry,
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

  return { save, remove };
}
