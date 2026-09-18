import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/ui/presence";
import ActionSheet from "@/components/shell/ActionSheet";
import ConfirmDialog from "@/components/overlays/ConfirmDialog";
import EntryEditModal, { type EntrySaveInput } from "@/components/media/EntryEditModal";
import { findCachedMedia } from "@/hooks/useCachedMedia";
import { useActionRunner, type ActionOverlay } from "@/hooks/useActionRunner";
import { useListMutations } from "@/hooks/useListMutations";
import { resolveActions, type Action, type ActionTarget, type EntryFacts } from "@/lib/actions";
import { useAuth, useScoreFormat } from "@/stores/auth";
import { useNowPlaying } from "@/stores/nowPlaying";
import { isTauri } from "@/api/anilist";
import { collectTags } from "@/lib/tags";
import { displayTitle, maxProgress, type ListResult, type MediaListEntry, type MediaType } from "@/api/types";

/** Android's own long-press timeout; anything shorter turns a slow tap into a menu. */
const LONG_PRESS_MS = 500;
/** Androids's touch slop: past this the finger is scrolling, and the press is not a press any more. */
const MOVE_TOLERANCE_PX = 10;
/** How long a touch keeps the native menu suppressed; Chromium raises it during the press, not after it. */
const SWALLOW_MS = 800;
/** How long the swallow waits for the tap that ends a press, before assuming the browser sent none. */
const CLICK_SWALLOW_MS = 400;

/** Controls that own their own press; a link is deliberately not among them, since a menu on a link is the gesture. */
const INTERACTIVE = "button, input, textarea, select, [role='slider'], [contenteditable='true']";

interface Opened {
  target: ActionTarget;
  actions: Action[];
  entry: MediaListEntry | null;
  title: string | null;
  selection: string;
  mediaType: MediaType;
}

const factsOf = (entry: MediaListEntry): EntryFacts => ({
  status: entry.status,
  progress: entry.progress,
  progressVolumes: entry.progressVolumes,
  score: entry.score,
  max: maxProgress(entry.media),
  maxVolumes: entry.media.volumes ?? null,
});

/** Whether any list cache could answer at all; without one, "not on your list" would be a guess rather than a fact. */
function anyListCached(lists: [unknown, ListResult | undefined][]): boolean {
  return lists.some(([, data]) => data !== undefined);
}

/** Owns the long press, resolves what was pressed, and renders the sheet plus whatever dialog an action asks for. */
export default function ActionHost() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const run = useActionRunner();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const scoreFormat = useScoreFormat();
  const scrobble = useNowPlaying((s) => s.scrobble);
  const current = useNowPlaying((s) => s.current);
  const [open, setOpen] = useState<Opened | null>(null);
  const [overlay, setOverlay] = useState<ActionOverlay | null>(null);

  const signedIn = viewer !== null || mode === "local";
  const editing = open?.entry ?? null;
  const list = useListMutations(viewer?.id ?? 0, open?.mediaType ?? "ANIME");

  const openFor = useCallback(
    (el: HTMLElement) => {
      const mediaId = Number(el.dataset.mediaId);
      if (!Number.isFinite(mediaId) || mediaId <= 0) return;
      const found = findCachedMedia(qc, mediaId);
      const mediaType = found?.mediaType ?? ((el.dataset.mediaType as MediaType) || "ANIME");
      const target: ActionTarget = found
        ? { kind: "entry", mediaId, mediaType, entry: factsOf(found.entry) }
        : {
            kind: "media",
            mediaId,
            mediaType,
            listed: anyListCached(qc.getQueriesData<ListResult>({ queryKey: ["mediaList"] }))
              ? "no"
              : "unknown",
            // Local mode's first add needs the media object, which the DOM's id cannot supply.
            canAdd: mode === "anilist",
          };
      const actions = resolveActions(target, {
        signedIn,
        scoreFormat,
        scrobble: {
          phase: scrobble.phase,
          forceable: scrobble.forceable,
          hasCurrent: current !== null,
          overridden: current?.overridden ?? false,
        },
        tauri: isTauri,
        hasSelection: false,
        // The sheet never draws the command group, so a sync it cannot show costs nothing to leave out.
        canSync: false,
      });
      setOpen({
        target,
        actions,
        entry: found?.entry ?? null,
        title: found ? displayTitle(found.entry.media.title) : (el.dataset.mediaTitle ?? null),
        selection: "",
        mediaType,
      });
    },
    [qc, mode, signedIn, scoreFormat, scrobble, current],
  );

  // One listener set for the whole shell; a per-screen version would register once per mounted list.
  useEffect(() => {
    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    let pendingClick = false;
    let clickTimer: number | null = null;
    const touchedAt = { at: 0 };

    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      touchedAt.at = Date.now();
      cancel();
      if (document.querySelector("[data-overlay]")) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el || el.closest(INTERACTIVE)) return;
      const media = el.closest<HTMLElement>("[data-media-id]");
      if (!media) return;
      startX = e.clientX;
      startY = e.clientY;
      timer = window.setTimeout(() => {
        timer = null;
        // One tap, not a window: a row tapped soon after the sheet opens is the user acting, not the press ending.
        pendingClick = true;
        if (clickTimer !== null) window.clearTimeout(clickTimer);
        clickTimer = window.setTimeout(() => {
          pendingClick = false;
        }, CLICK_SWALLOW_MS);
        openFor(media);
      }, LONG_PRESS_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (timer === null) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE_PX) cancel();
    };

    // The tap that ends a fired press must not also open the card behind the sheet.
    const swallow = (e: Event) => {
      if (!pendingClick) return;
      // A click inside the sheet is the user choosing an action, never the press ending; only the page behind is eaten.
      if (e.target instanceof HTMLElement && e.target.closest("[data-overlay]")) return;
      pendingClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    // Chromium raises its own menu on an Android long press; without this the sheet and that menu would both appear.
    const onContext = (e: Event) => {
      if (Date.now() - touchedAt.at > SWALLOW_MS) return;
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("click", swallow, true);
    window.addEventListener("contextmenu", onContext, true);
    return () => {
      cancel();
      if (clickTimer !== null) window.clearTimeout(clickTimer);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("scroll", cancel, true);
      window.removeEventListener("click", swallow, true);
      window.removeEventListener("contextmenu", onContext, true);
    };
  }, [openFor]);

  const onRun = (action: Action) => {
    if (!open) return;
    const effect = run({
      action,
      target: open.target,
      selection: open.selection,
      entry: open.entry,
    });
    if (effect.kind === "overlay") setOverlay(effect.overlay);
    else setOpen(null);
  };

  const closeAll = () => {
    setOverlay(null);
    setOpen(null);
  };

  const save = (input: EntrySaveInput) => {
    list.save.mutate(input);
    closeAll();
  };

  const remove = () => {
    if (editing) list.remove.mutate(editing.id);
    closeAll();
  };

  // The same suggestion set the list screen builds, read from the cache rather than recomputed from a second source.
  const cached = qc.getQueryData<ListResult>([
    "mediaList",
    open?.mediaType ?? "ANIME",
    viewer?.id ?? 0,
  ]);
  const suggestions = collectTags(
    cached?.lists.flatMap((g) => g.entries).map((e) => e.notes) ?? [],
  );

  return (
    <>
      <Presence value={overlay === null ? open : null}>
        {(shown, leaving) => (
          <ActionSheet
            leaving={leaving}
            title={shown.title}
            actions={shown.actions}
            mediaType={shown.mediaType}
            onRun={onRun}
            onClose={() => setOpen(null)}
          />
        )}
      </Presence>

      {open && editing && overlay === "edit" && (
        <EntryEditModal
          media={{ ...editing.media, type: open.mediaType }}
          entry={{ ...editing, notes: editing.notes }}
          tagSuggestions={suggestions}
          onSave={save}
          onDelete={remove}
          onClose={closeAll}
        />
      )}

      {open && editing && overlay === "confirmRemove" && (
        <ConfirmDialog
          title={t("common.confirmRemove")}
          names={[displayTitle(editing.media.title)]}
          confirmLabel={t("common.remove")}
          onConfirm={remove}
          onCancel={closeAll}
        />
      )}
    </>
  );
}
