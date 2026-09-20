import { useCallback } from "react";
import { useNavigate } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "@/stores/auth";
import { useListMutations } from "@/hooks/useListMutations";
import { useManualSync } from "@/hooks/useManualSync";
import { clearDetectionOverride, scrobbleCancel, scrobbleNow, useNowPlaying } from "@/stores/nowPlaying";
import { loadDefaultAddStatus } from "@/lib/defaultAddStatus";
import { copyText } from "@/lib/clipboard";
import { completePatch, type Action, type ActionTarget } from "@/lib/actions";
import type { MediaListEntry, MediaType } from "@/api/types";

/** An action the runner cannot finish alone; the host renders the dialog, so nothing here has to hold overlay state. */
export type ActionOverlay = "edit" | "confirmRemove" | "matchPicker";

export type ActionEffect = { kind: "done" } | { kind: "overlay"; overlay: ActionOverlay };

export interface ActionRunInput {
  action: Action;
  target: ActionTarget;
  /** Captured when the menu opened; reading the live selection at click time would find it already collapsed. */
  selection: string;
  /** The cached entry the target came from — the editor needs its media, and a delete needs its entry id. */
  entry: MediaListEntry | null;
}

const anilistUrl = (mediaType: MediaType, mediaId: number) =>
  `https://anilist.co/${mediaType === "MANGA" ? "manga" : "anime"}/${mediaId}`;

/** Turns an `Action` into the effect it names, reusing the paths that already carry receipts, Undo and the queue. */
export function useActionRunner(): (input: ActionRunInput) => ActionEffect {
  const navigate = useNavigate();
  const userId = useAuth((s) => s.viewer?.id) ?? 0;
  // Both, unconditionally: the hook rules forbid choosing one by the target's media type at call time.
  const anime = useListMutations(userId, "ANIME");
  const manga = useListMutations(userId, "MANGA");
  const { sync: onSync } = useManualSync();

  return useCallback(
    ({ action, target, selection, entry }: ActionRunInput): ActionEffect => {
      const save = (mediaType: MediaType) => (mediaType === "ANIME" ? anime : manga).save;
      const done: ActionEffect = { kind: "done" };

      switch (action.id) {
        case "open": {
          const id =
            target.kind === "detection" ? target.mediaId : "mediaId" in target ? target.mediaId : null;
          if (id !== null) navigate(`/media/${id}`);
          return done;
        }
        case "openAniList":
          if (target.kind === "entry" || target.kind === "media") {
            void openUrl(anilistUrl(target.mediaType, target.mediaId)).catch(() => {});
          }
          return done;
        case "copySelection":
          void copyText(selection);
          return done;
        case "addToList":
          if (target.kind === "media") {
            save(target.mediaType).mutate({
              mediaId: target.mediaId,
              status: loadDefaultAddStatus(),
            });
          }
          return done;
        case "edit":
          return { kind: "overlay", overlay: "edit" };
        case "plusOne":
          if (target.kind === "entry") {
            save(target.mediaType).mutate({
              mediaId: target.mediaId,
              progress: target.entry.progress + 1,
            });
          }
          return done;
        case "plusVolume":
          if (target.kind === "entry") {
            save(target.mediaType).mutate({
              mediaId: target.mediaId,
              progressVolumes: target.entry.progressVolumes + 1,
            });
          }
          return done;
        case "complete":
          if (target.kind === "entry") {
            save(target.mediaType).mutate({
              mediaId: target.mediaId,
              ...completePatch(target.entry.max),
            });
          }
          return done;
        case "setStatus":
          if (target.kind === "entry" && action.arg?.kind === "status") {
            save(target.mediaType).mutate({
              mediaId: target.mediaId,
              status: action.arg.status,
            });
          }
          return done;
        case "setScore":
          if (target.kind === "entry" && action.arg?.kind === "score") {
            // The display value; `withRawScore` in the API layer is the one converter, so pre-converting would double it.
            save(target.mediaType).mutate({ mediaId: target.mediaId, score: action.arg.score });
          }
          return done;
        case "removeFromList":
          return entry ? { kind: "overlay", overlay: "confirmRemove" } : done;
        case "scrobbleNow":
          void scrobbleNow().catch(() => {});
          return done;
        case "scrobbleCancel":
          void scrobbleCancel().catch(() => {});
          return done;
        case "fixMatch":
          return { kind: "overlay", overlay: "matchPicker" };
        case "clearOverride": {
          const playing = useNowPlaying.getState().current;
          if (playing) {
            void clearDetectionOverride({
              title: playing.parsedTitle,
              season: playing.season,
              mediaType: playing.mediaType,
            }).catch(() => {});
          }
          return done;
        }
        case "back":
          navigate(-1);
          return done;
        case "forward":
          navigate(1);
          return done;
        case "reload":
          window.location.reload();
          return done;
        case "palette":
          window.dispatchEvent(new Event("open-command-palette"));
          return done;
        case "settings":
          navigate("/settings");
          return done;
        case "search":
          navigate("/search");
          return done;
        case "sync":
          // The lock is shared, so a sync already running from the tray or the pull gesture is not started twice.
          void onSync();
          return done;
      }
    },
    [anime, manga, navigate, onSync],
  );
}
