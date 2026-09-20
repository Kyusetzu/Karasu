import { resolveActions, type ActionContext, type ActionId, type ActionTarget, type EntryFacts } from "@/lib/actions";

/** The fixtures `lib/actions`'s tests resolve against: one entry a third of the way in, one signed-in desktop context. */

export const FACTS: EntryFacts = {
  status: "CURRENT",
  progress: 3,
  progressVolumes: 1,
  score: 8,
  max: 12,
  maxVolumes: 5,
};

export const CTX: ActionContext = {
  signedIn: true,
  scoreFormat: "POINT_10",
  scrobble: { phase: "idle", forceable: false, hasCurrent: false, overridden: false },
  tauri: true,
  share: false,
  hasSelection: false,
  canSync: false,
};

export const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({ ...CTX, ...over });

export const entryTarget = (
  over: Partial<EntryFacts> = {},
  mediaType: "ANIME" | "MANGA" = "ANIME",
): ActionTarget => ({
  kind: "entry",
  mediaId: 1,
  mediaType,
  entry: { ...FACTS, ...over },
});

export const ids = (target: ActionTarget, c: ActionContext = CTX): ActionId[] =>
  resolveActions(target, c).map((a) => a.id);
