/** Every keyboard shortcut the app wires, as data, so the reference sheet and the palette cannot show different keys. */

export type ShortcutId =
  | "palette"
  | "reference"
  | "search"
  | "close"
  | "overview"
  | "anime"
  | "manga"
  | "sync"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "findInList"
  | "move"
  | "open"
  | "plusOne"
  | "edit"
  | "complete"
  | "remove"
  | "selectMode"
  | "selectAll"
  | "extend"
  | "bold"
  | "italic"
  | "strike"
  | "spoiler"
  | "send";

/** Where a shortcut answers: anywhere, on a list screen, or inside a markdown composer. */
export type ShortcutScope = "global" | "inList" | "inComposer";

export interface Shortcut {
  id: ShortcutId;
  scope: ShortcutScope;
  /** One cap per entry, in the order they are pressed. */
  keys: readonly string[];
}

export const SHORTCUT_SCOPES: readonly ShortcutScope[] = ["global", "inList", "inComposer"];

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "palette", scope: "global", keys: ["Ctrl", "K"] },
  { id: "reference", scope: "global", keys: ["?"] },
  { id: "search", scope: "global", keys: ["/"] },
  { id: "close", scope: "global", keys: ["Esc"] },
  { id: "overview", scope: "global", keys: ["Ctrl", "1"] },
  { id: "anime", scope: "global", keys: ["Ctrl", "2"] },
  { id: "manga", scope: "global", keys: ["Ctrl", "3"] },
  { id: "sync", scope: "global", keys: ["Ctrl", "R"] },
  { id: "zoomIn", scope: "global", keys: ["Ctrl", "+"] },
  { id: "zoomOut", scope: "global", keys: ["Ctrl", "−"] },
  { id: "zoomReset", scope: "global", keys: ["Ctrl", "0"] },
  { id: "findInList", scope: "inList", keys: ["Ctrl", "F"] },
  { id: "move", scope: "inList", keys: ["←", "↑", "↓", "→"] },
  { id: "open", scope: "inList", keys: ["↵"] },
  { id: "plusOne", scope: "inList", keys: ["Space"] },
  { id: "edit", scope: "inList", keys: ["E"] },
  { id: "complete", scope: "inList", keys: ["C"] },
  { id: "remove", scope: "inList", keys: ["Del"] },
  { id: "selectMode", scope: "inList", keys: ["S"] },
  { id: "selectAll", scope: "inList", keys: ["Ctrl", "A"] },
  { id: "extend", scope: "inList", keys: ["Shift", "↑↓"] },
  // The markdown composers' own bindings, wired by `MarkdownTextarea`.
  { id: "bold", scope: "inComposer", keys: ["Ctrl", "B"] },
  { id: "italic", scope: "inComposer", keys: ["Ctrl", "I"] },
  { id: "strike", scope: "inComposer", keys: ["Ctrl", "Shift", "X"] },
  { id: "spoiler", scope: "inComposer", keys: ["Ctrl", "Shift", "S"] },
  { id: "send", scope: "inComposer", keys: ["Ctrl", "↵"] },
];

/** The few the empty palette shows beside its recent list; the rest are one `?` away. */
export type PaletteShortcutId = Extract<ShortcutId, "findInList" | "sync" | "reference" | "palette">;

export const PALETTE_SHORTCUTS: readonly PaletteShortcutId[] = ["findInList", "sync", "reference", "palette"];

export function shortcutsIn(scope: ShortcutScope): Shortcut[] {
  return SHORTCUTS.filter((s) => s.scope === scope);
}

export function shortcutKeys(id: ShortcutId): readonly string[] {
  return SHORTCUTS.find((s) => s.id === id)?.keys ?? [];
}
