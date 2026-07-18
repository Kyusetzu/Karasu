import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteListEntry, saveListEntry } from "@/api/anilist";
import type { ListResult, MediaType, SaveEntryInput } from "@/api/types";

/**
 * Mutations auf eine Medienliste (Anime oder Manga) mit optimistischem
 * Cache-Update. Statuswechsel verschieben den Eintrag lokal in die passende
 * Gruppe, damit kein teurer Refetch (Rate-Limit!) nötig ist.
 */
export function useListMutations(userId: number, mediaType: MediaType) {
  const qc = useQueryClient();
  const key = ["mediaList", mediaType, userId];

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
                  updatedAt: Math.floor(Date.now() / 1000),
                }
              : e,
          )
          // Bei Statuswechsel aus der alten Status-Gruppe entfernen
          .filter(
            (e) =>
              e.mediaId !== input.mediaId ||
              !input.status ||
              group.isCustomList ||
              group.status === input.status,
          ),
      }));
      // In die Zielgruppe einsortieren, falls sie existiert
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
    mutationFn: saveListEntry,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ListResult>(key);
      patchCache(input);
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
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
