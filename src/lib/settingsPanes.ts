/**
 * Which settings pane a `?pane=` value names.
 *
 * The ids are a deep link the rest of the app hands out — an empty local
 * library points at Library, an overridden AniList row points at the Karasu
 * pane that wins — and one a user may well have bookmarked. So they outlive a
 * reshuffle: a pane that survives keeps its id even when its label changes, and
 * a pane that genuinely goes away leaves an alias behind rather than letting the
 * link fall through to Account, which looks like the link was wrong rather than
 * moved.
 *
 * Separate from `pages/Settings.tsx` because that file's pane table holds React
 * components; this is the part worth testing on its own.
 */

/** In nav order. `pages/Settings.tsx` renders one entry per id, in this order. */
export const PANE_IDS = [
  "account",
  "anilist",
  "appearance",
  "detection",
  "library",
  "desktop",
  "data",
  "advanced",
] as const;

export type PaneId = (typeof PANE_IDS)[number];

/**
 * Panes that no longer exist, and where their contents went.
 *
 * `content` was one slider and joined Appearance; `integrations` was one toggle
 * and joined Desktop.
 */
export const PANE_ALIASES: Record<string, PaneId> = {
  content: "appearance",
  integrations: "desktop",
};

/** Account is the default: it is the first pane and needs no parameter. */
export const DEFAULT_PANE: PaneId = "account";

export function resolvePane(requested: string | null): PaneId {
  if (!requested) return DEFAULT_PANE;
  if ((PANE_IDS as readonly string[]).includes(requested)) return requested as PaneId;
  return PANE_ALIASES[requested] ?? DEFAULT_PANE;
}
