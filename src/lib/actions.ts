import type { MediaListStatus, MediaType } from "@/api/types";
import { scoreOptions, type ScoreFormat } from "@/lib/scoreFormat";
import type { ScrobblePhase } from "@/stores/nowPlaying";

/** What can be done to a thing, resolved once so the context menu, the long-press sheet and the palette cannot drift. */

export type ActionId =
  | "open"
  | "openAniList"
  | "copySelection"
  | "addToList"
  | "edit"
  | "plusOne"
  | "plusVolume"
  | "complete"
  | "setStatus"
  | "setScore"
  | "removeFromList"
  | "scrobbleNow"
  | "scrobbleCancel"
  | "fixMatch"
  | "clearOverride"
  | "back"
  | "forward"
  | "reload"
  | "palette"
  | "settings"
  | "sync"
  | "search";

/** Renderers draw a separator where this changes, and each picks the groups it is willing to show. */
export type ActionGroup = "item" | "edit" | "detect" | "link" | "command" | "app";

/** Fixed order; groups never interleave, which is what lets a renderer count its own separators in one pass. */
export const ACTION_GROUP_ORDER: readonly ActionGroup[] = [
  "item",
  "edit",
  "detect",
  "link",
  "command",
  "app",
];

/** A key, never a sentence, because a pure module that returned copy would be invisible to `i18nKeys.test.ts`. */
export const ACTION_LABEL_KEY: Record<ActionId, string> = {
  open: "ctx.open",
  openAniList: "ctx.openAniList",
  copySelection: "ctx.copy",
  addToList: "actions.addToList",
  edit: "common.edit",
  plusOne: "common.plusOne",
  plusVolume: "actions.plusVolume",
  complete: "common.complete",
  setStatus: "actions.changeStatus",
  setScore: "actions.changeScore",
  removeFromList: "actions.remove",
  scrobbleNow: "actions.scrobbleNow",
  scrobbleCancel: "actions.scrobbleCancel",
  fixMatch: "actions.fixMatch",
  clearOverride: "actions.clearOverride",
  back: "ctx.back",
  forward: "ctx.forward",
  reload: "ctx.reload",
  palette: "ctx.palette",
  settings: "ctx.settings",
  sync: "sync.button",
  search: "nav.search",
};

/** A submenu leaf carries the value it would write; its label is that value, not a phrase. */
export type ActionArg =
  | { kind: "status"; status: MediaListStatus }
  | { kind: "score"; score: number };

export interface Action {
  id: ActionId;
  group: ActionGroup;
  arg?: ActionArg;
  danger?: boolean;
  /** Exactly one level deep; a leaf never carries `items`, and a parent is opened rather than run. */
  items?: Action[];
}

/** What the entry-shaped actions need, projected off `MediaListEntry` so this module never learns the API's shape. */
export interface EntryFacts {
  status: MediaListStatus;
  progress: number;
  progressVolumes: number;
  score: number;
  /** `maxProgress(media)`; null when the run length is unknown or unbounded, where +1 is always allowed. */
  max: number | null;
  maxVolumes: number | null;
}

export type ActionTarget =
  /** A title the list holds, so every write is available. */
  | { kind: "entry"; mediaId: number; mediaType: MediaType; entry: EntryFacts }
  /** A title the caches know by id but not as an entry — `unknown` means no list cache could answer at all. */
  | {
      kind: "media";
      mediaId: number;
      mediaType: MediaType;
      listed: "no" | "unknown";
      /** A first add needs the media blob in local mode, which a menu has no way to supply. */
      canAdd: boolean;
    }
  | { kind: "detection"; mediaId: number | null }
  /** The background: nothing was under the pointer. */
  | { kind: "page" };

export interface ScrobbleFacts {
  phase: ScrobblePhase;
  forceable: boolean;
  hasCurrent: boolean;
  overridden: boolean;
}

export interface ActionContext {
  /** `viewer !== null || mode === "local"` — the predicate every screen already spells out by hand. */
  signedIn: boolean;
  scoreFormat: ScoreFormat;
  scrobble: ScrobbleFacts;
  /** Opening a browser and reloading the shell are Tauri facts, so they are platform-keyed rather than width-keyed. */
  tauri: boolean;
  hasSelection: boolean;
  /** `useManualSync().available` — local mode has nothing to sync and signed out has nobody to sync for. */
  canSync: boolean;
}

export const STATUSES: readonly MediaListStatus[] = [
  "CURRENT",
  "PLANNING",
  "COMPLETED",
  "DROPPED",
  "PAUSED",
  "REPEATING",
];

/** The current status is left out: the row already shows it, so offering it would be a write that changes nothing. */
export function statusLeaves(current: MediaListStatus | null): MediaListStatus[] {
  return STATUSES.filter((s) => s !== current);
}

/** Every rung stays, unlike the status list: a scale with one value missing is a scale nobody can read. */
export function scoreLeaves(format: ScoreFormat): number[] | null {
  return scoreOptions(format);
}

/** Lifted out of `NowPlayingCard` so the phases that offer a write are a table rather than an expression in a view. */
export function canScrobbleNow(phase: ScrobblePhase, forceable: boolean): boolean {
  const offered =
    phase === "pending" ||
    phase === "watching" ||
    phase === "yielding" ||
    phase === "cancelled" ||
    phase === "blocked";
  // A block Rust would refuse anyway must not be offered; forcing over a gap and retrying a failure still are.
  return offered && (phase !== "blocked" || forceable);
}

/** Skipping only means something while a write is still coming; a cancelled or blocked session has nothing to skip. */
export function canScrobbleCancel(phase: ScrobblePhase, forceable: boolean): boolean {
  return canScrobbleNow(phase, forceable) && phase !== "cancelled" && phase !== "blocked";
}

/** True while another episode or chapter can be added; an unknown run length never blocks the increment. */
export function canIncrementFacts(entry: EntryFacts): boolean {
  return entry.max === null || entry.progress < entry.max;
}

/** The manga-only volume axis, gated the same way and on its own maximum. */
export function canIncrementVolumes(entry: EntryFacts): boolean {
  return entry.maxVolumes === null || entry.progressVolumes < entry.maxVolumes;
}

const act = (id: ActionId, group: ActionGroup, extra: Partial<Action> = {}): Action => ({
  id,
  group,
  ...extra,
});

/** The chrome every target carries, so a right-click on a card still reaches Back, the palette and Settings. */
function chrome(ctx: ActionContext): Action[] {
  const out: Action[] = [act("search", "command")];
  if (ctx.canSync) out.push(act("sync", "command"));
  out.push(act("back", "app"), act("forward", "app"));
  if (ctx.tauri) out.push(act("reload", "app"));
  out.push(act("palette", "app"), act("settings", "app"));
  return out;
}

function entryActions(
  target: Extract<ActionTarget, { kind: "entry" }>,
  ctx: ActionContext,
): Action[] {
  const out: Action[] = [act("open", "item")];
  if (canIncrementFacts(target.entry)) out.push(act("plusOne", "item"));
  if (target.mediaType === "MANGA" && canIncrementVolumes(target.entry)) {
    out.push(act("plusVolume", "item"));
  }
  if (target.entry.status !== "COMPLETED") out.push(act("complete", "item"));

  out.push(act("edit", "edit"));
  out.push(
    act("setStatus", "edit", {
      items: statusLeaves(target.entry.status).map((status) =>
        act("setStatus", "edit", { arg: { kind: "status", status } }),
      ),
    }),
  );
  // Absent for the continuous formats on purpose: a hundred-rung flyout is not a menu, and the editor covers it.
  const scores = scoreLeaves(ctx.scoreFormat);
  if (scores) {
    out.push(
      act("setScore", "edit", {
        items: scores.map((score) => act("setScore", "edit", { arg: { kind: "score", score } })),
      }),
    );
  }
  out.push(act("removeFromList", "edit", { danger: true }));
  return out;
}

function mediaActions(target: Extract<ActionTarget, { kind: "media" }>): Action[] {
  const out: Action[] = [act("open", "item")];
  // Only where a list cache actually answered: "unknown" would offer to add a title that is already tracked.
  if (target.listed === "no" && target.canAdd) out.push(act("addToList", "edit"));
  return out;
}

function detectionActions(
  target: Extract<ActionTarget, { kind: "detection" }>,
  ctx: ActionContext,
): Action[] {
  const out: Action[] = [];
  if (target.mediaId !== null) out.push(act("open", "item"));
  const { phase, forceable, overridden } = ctx.scrobble;
  if (canScrobbleNow(phase, forceable)) out.push(act("scrobbleNow", "detect"));
  if (canScrobbleCancel(phase, forceable)) out.push(act("scrobbleCancel", "detect"));
  out.push(act("fixMatch", "detect"));
  if (overridden) out.push(act("clearOverride", "detect"));
  return out;
}

/** Everything that would change something, in group order; nothing is ever returned only to be drawn disabled. */
export function resolveActions(target: ActionTarget, ctx: ActionContext): Action[] {
  const out: Action[] = [];

  if (target.kind === "entry") {
    out.push(...(ctx.signedIn ? entryActions(target, ctx) : [act("open", "item")]));
  }
  if (target.kind === "media") {
    out.push(...(ctx.signedIn ? mediaActions(target) : [act("open", "item")]));
  }
  if (target.kind === "detection" && ctx.scrobble.hasCurrent) {
    out.push(...detectionActions(target, ctx));
  }

  if ((target.kind === "entry" || target.kind === "media") && ctx.tauri) {
    out.push(act("openAniList", "link"));
  }
  if (ctx.hasSelection) out.push(act("copySelection", "link"));
  out.push(...chrome(ctx));

  // A stable sort, so the order inside a group stays the order each builder chose.
  return out.sort(
    (a, b) => ACTION_GROUP_ORDER.indexOf(a.group) - ACTION_GROUP_ORDER.indexOf(b.group),
  );
}
