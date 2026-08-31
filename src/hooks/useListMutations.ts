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
        // Rendered, not interpolated raw: a smiley account should read
        // "scored 🙂", not "scored 2", and a decimal one keeps its ".0".
        // Local mode's cache holds POINT_10, matching its controls.
        return t("receipt.score", {
          title,
          n: formatScore(currentScoreFormat(), head.value as number),
        });
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
  /**
   * One entry with `input` applied — `??` throughout, so an absent key means
   * "leave it alone" rather than "clear it" (`private: false` is a real
   * value, which is why `||` would be wrong). One function on purpose: the
   * status-move insert below used to spread the raw input instead, which
   * behaved differently from the in-place map (it copied `mediaId` along and
   * wrote explicitly-undefined keys), and any field added to one path was
   * silently missing from the other.
   */
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
    // Deliberately not patched from `input.advancedScores`: it is a positional
    // array and the entry holds a name-keyed map, so rebuilding one from the
    // other here would mean this function knowing the account's category
    // order. `onSuccess` takes the server's map instead, which is authoritative
    // anyway because AniList recomputes the overall score from it.
  });

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
            moved.set(e.mediaId, applyInput(e, input, now));
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
    onSuccess: (res, input, ctx) => {
      // AniList *derives* the overall score from the categories, so an
      // advanced-scoring save is the one case where the optimistic patch
      // cannot know the answer — it wrote whatever the score slider said,
      // which the server has just overruled. Reconcile from the mutation's own
      // result instead of leaving a number that will change on the next fetch.
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
      // A save that changed nothing gets no receipt. Undoing a no-op is noise,
      // and so is announcing one.
      if (!undo) return;
      // `queued` means the write never reached AniList — it is sitting in
      // SQLite waiting for a drain. It came back as a success because the edit
      // is not lost, but saying so in the same green receipt as a landed write
      // is the one assurance a tracker must not get wrong. The undo still
      // works: it queues too.
      showToast({
        kind: res?.queued ? "info" : "success",
        text: res?.queued
          ? t("receipt.queued", { title: ctx.title })
          : receiptText(input, ctx.before, ctx.title),
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
      /**
       * What `UpdateMediaListEntries` accepts and is sensible to set across a
       * whole selection. Confirmed by schema introspection rather than by
       * running the mutation, which would have meant editing real entries to
       * find out.
       *
       * `notes` is left out on purpose: tags are serialized into it, so a bulk
       * set would wipe every selected entry's tags.
       */
      patch: BulkPatch;
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
    onError: (err, vars, ctx) => {
      // A selection is sent in chunks and stops on the first failure, so some
      // of it may well be written. Restoring the snapshot then would show the
      // old values for entries AniList has already changed — worse than the
      // failure itself, because it looks settled. Refetch instead and let the
      // server say what is true.
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
        // No retry offer on a partial run: the same selection would be sent
        // again, including the part that landed.
        action: partial
          ? undefined
          : { label: t("common.retry"), run: () => bulkSave.mutate(vars) },
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

  /**
   * Removes a whole selection, one request at a time.
   *
   * `selection.forEach(remove.mutate)` is what this replaces — the same
   * fan-out `bulkSave` exists to prevent, still live on the delete path. It
   * fired one concurrent request per entry against a ~30/min budget, so a
   * fifty-entry removal was a burst of fifty mutations, a wall of 429s and a row
   * of error toasts.
   *
   * There is no batch delete to switch to: `DeleteMediaListEntry` takes a single
   * id and nothing else, confirmed against the schema. So the fix is not one
   * request, it is *sequential* requests — awaited in turn so the client's rate
   * limiter can pace them — with the cache patched once at the end rather than
   * once per entry.
   */
  const bulkRemove = useMutation({
    mutationFn: async (entries: MediaListEntry[]) => {
      const removed: number[] = [];
      const failed: string[] = [];
      for (const entry of entries) {
        try {
          await deleteListEntry(entry.id);
          removed.push(entry.id);
        } catch {
          // Carry on rather than abandoning the rest: a selection half-removed
          // and reported is better than one that stops at the first failure and
          // leaves the user guessing where it got to.
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
