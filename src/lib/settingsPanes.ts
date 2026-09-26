/** Which settings pane a `?pane=` value names; ids are deep links, so a removed pane leaves an alias behind. */

/** In nav order. `pages/Settings.tsx` renders one entry per id, in this order. */
export const PANE_IDS = [
  "account",
  "appearance",
  "detection",
  "library",
  "desktop",
  "data",
  "advanced",
] as const;

export type PaneId = (typeof PANE_IDS)[number];

/** Panes that no longer exist, and where their contents went. */
export const PANE_ALIASES: Record<string, PaneId> = {
  content: "appearance",
  integrations: "desktop",
  anilist: "account",
};

/** Account is the default: it is the first pane and needs no parameter. */
export const DEFAULT_PANE: PaneId = "account";

export function resolvePane(requested: string | null): PaneId {
  if (!requested) return DEFAULT_PANE;
  if ((PANE_IDS as readonly string[]).includes(requested)) return requested as PaneId;
  return PANE_ALIASES[requested] ?? DEFAULT_PANE;
}
