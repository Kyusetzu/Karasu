import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  allFavourites,
  toggleFavourite,
  updateFavouriteOrder,
  type AllFavourites,
  type FavouriteKind,
} from "@/api/social";
import { isTauri } from "@/api/anilist";
import { moveItem, toOrderVars } from "@/lib/favouritesOrder";
import { displayTitle } from "@/api/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Tabs, type TabOption } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/user-lockup";
import { Shimmer } from "@/components/Skeleton";
import { showToast } from "@/stores/toast";
import { cn } from "@/lib/utils";

/**
 * Reorder and remove favourites, one kind at a time.
 *
 * `UpdateFavouriteOrder` replaces a kind's entire set, so this modal follows
 * the notification grid's discipline: a **fresh, complete** read on every
 * open (`staleTime: 0`, `gcTime: 0`), and a save that always sends every id.
 * A set too large for the bounded read (`truncated`) refuses the save rather
 * than quietly writing back a prefix — a reorder must never double as a mass
 * unfavourite.
 *
 * Arrows, not drag-and-drop: keyboard-reachable, no dependency, and a
 * favourites list is short enough that two clicks beat a grab.
 */

const KINDS: FavouriteKind[] = ["anime", "manga", "character", "staff", "studio"];

interface Row {
  id: number;
  label: string;
  image: string | null;
  /** Cover-shaped art (media) versus a round disc (people). */
  cover: boolean;
}

function toRows(data: AllFavourites, kind: FavouriteKind): Row[] {
  switch (kind) {
    case "anime":
    case "manga":
      return data[kind].map((m) => ({
        id: m.id,
        label: displayTitle(m.title),
        image: m.coverImage?.large ?? null,
        cover: true,
      }));
    case "character":
    case "staff":
      return data[kind === "character" ? "characters" : "staff"].map((p) => ({
        id: p.id,
        label: p.name.full ?? "—",
        image: p.image?.medium ?? null,
        cover: false,
      }));
    case "studio":
      return data.studios.map((s) => ({
        id: s.id,
        label: s.name ?? "—",
        image: null,
        cover: false,
      }));
  }
}

export function FavouritesModal({
  userId,
  onClose,
  leaving,
}: {
  userId: number;
  onClose: () => void;
  leaving?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [kind, setKind] = useState<FavouriteKind>("anime");
  const [drafts, setDrafts] = useState<Record<FavouriteKind, Row[]> | null>(null);
  // What the server currently holds, per kind — the dirty comparison's other
  // half. Updated on a successful save so the button disarms again.
  const [baseline, setBaseline] = useState<Record<FavouriteKind, number[]> | null>(null);

  const q = useQuery({
    queryKey: ["social", "favouritesAll", userId],
    queryFn: () => allFavourites(userId),
    enabled: isTauri,
    // Fresh on every open, cached never: a reorder built on a stale set is a
    // silent unfavourite of whatever changed since.
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  // Seed the editable copy once the complete set is here.
  useEffect(() => {
    if (!q.data) return;
    const seeded = {
      anime: toRows(q.data, "anime"),
      manga: toRows(q.data, "manga"),
      character: toRows(q.data, "character"),
      staff: toRows(q.data, "staff"),
      studio: toRows(q.data, "studio"),
    };
    setDrafts(seeded);
    setBaseline(
      Object.fromEntries(
        KINDS.map((k) => [k, seeded[k].map((r) => r.id)]),
      ) as Record<FavouriteKind, number[]>,
    );
  }, [q.data]);

  const rows = useMemo(() => drafts?.[kind] ?? [], [drafts, kind]);
  const dirty =
    baseline !== null &&
    drafts !== null &&
    rows.map((r) => r.id).join(",") !== baseline[kind].join(",");

  const save = useMutation({
    mutationFn: () => updateFavouriteOrder(toOrderVars(kind, rows.map((r) => r.id))),
    onSuccess: () => {
      showToast({ kind: "success", text: t("social.favOrderSaved") });
      // The saved order is the server's order now; disarm the button.
      setBaseline((b) => (b ? { ...b, [kind]: rows.map((r) => r.id) } : b));
      // The profile strips read a different query; they are stale now.
      void qc.invalidateQueries({ queryKey: ["social", "user"] });
    },
    onError: () =>
      showToast({
        kind: "error",
        text: t("social.favOrderFailed"),
        detail: t("social.favOrderFailedDetail"),
      }),
  });

  const remove = useMutation({
    mutationFn: (vars: { kind: FavouriteKind; id: number }) =>
      toggleFavourite(vars.kind, vars.id),
    onMutate: ({ kind: k, id }) => {
      const prev = drafts;
      setDrafts((d) => (d ? { ...d, [k]: d[k].filter((r) => r.id !== id) } : d));
      return { prev };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["social", "user"] });
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) setDrafts(ctx.prev);
      showToast({ kind: "error", text: t("detail.favouriteFailed") });
    },
  });

  const move = (from: number, to: number) =>
    setDrafts((d) => (d ? { ...d, [kind]: moveItem(d[kind], from, to) } : d));

  const options: TabOption<FavouriteKind>[] = KINDS.map((k) => ({
    value: k,
    label:
      k === "anime"
        ? t("social.favAnime")
        : k === "manga"
          ? t("social.favManga")
          : k === "character"
            ? t("social.favCharacters")
            : k === "staff"
              ? t("social.favStaff")
              : t("social.favStudios"),
    count: drafts?.[k].length,
  }));

  return (
    <Modal
      title={t("social.editFavourites")}
      onClose={onClose}
      leaving={leaving}
      className="max-w-xl"
    >
      <div className="space-y-3">
        <Tabs options={options} value={kind} onChange={setKind} />

        {q.data?.truncated && (
          <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
            {t("social.favTooMany")}
          </p>
        )}

        {q.isLoading || !drafts ? (
          <div className="space-y-1.5" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <Shimmer key={i} className="h-10 w-full rounded-lg" index={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-600">{t("social.favNone")}</p>
        ) : (
          <ul className="max-h-96 space-y-0.5 overflow-y-auto pr-1">
            {rows.map((row, i) => (
              <li
                key={row.id}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-900"
              >
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-600">
                  {i + 1}
                </span>
                {row.cover ? (
                  <div className="h-10 w-7 shrink-0 overflow-hidden rounded bg-surface-850">
                    {row.image && (
                      <img src={row.image} alt="" loading="lazy" className="size-full object-cover" />
                    )}
                  </div>
                ) : (
                  <Avatar src={row.image} name={row.label} size="sm" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-ink-100">{row.label}</span>
                <IconButton
                  variant="ghost"
                  size="xs"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                  aria-label={t("social.favMoveUp")}
                >
                  <ArrowUp className="size-3.5" />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="xs"
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, i + 1)}
                  aria-label={t("social.favMoveDown")}
                >
                  <ArrowDown className="size-3.5" />
                </IconButton>
                <IconButton
                  variant="danger"
                  size="xs"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ kind, id: row.id })}
                  aria-label={t("social.favRemove")}
                >
                  <X className="size-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-surface-800 pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.done")}
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending || q.data?.truncated === true}
            className={cn(save.isPending && "opacity-70")}
          >
            {save.isPending ? t("social.saving") : t("social.favSaveOrder")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
