/** Arrow-key movement over a grid that is laid out as one flat array. */
export type Move = "left" | "right" | "up" | "down";

/**
 * Where the keyboard focus lands next.
 *
 * Pure, because the list it runs over is virtualized: the DOM holds only the
 * rows near the viewport, so movement cannot be derived from what is mounted
 * and has to be arithmetic over the whole array instead.
 *
 * The first press lands on the first item whichever direction it was — nothing
 * is focused yet, so there is no direction to move in, and refusing the press
 * would just look broken.
 *
 * Movement clamps rather than wraps. Wrapping at the end of a row puts the
 * focus on the far side of the screen, and at the end of the list it puts it
 * back at the top, both of which lose the user's place.
 */
export function nextFocus(
  current: number | null,
  move: Move,
  columns: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  if (current === null) return 0;
  const step = Math.max(1, Math.floor(columns));
  const delta =
    move === "right" ? 1 : move === "left" ? -1 : move === "down" ? step : -step;
  return Math.min(Math.max(current + delta, 0), count - 1);
}

/**
 * Whether a screen-level key handler may act on the press.
 *
 * A roving index is not real DOM focus — the grid is virtualized, so the
 * focused row often is not mounted — which means the handler is a bare `window`
 * listener and has no idea what the user is actually pointing at. `isTyping()`
 * covers a text field and `[data-overlay]` covers a dialog, but an ordinary
 * focused control is neither, and once the roving index is set (one arrow
 * press; cleared only by Escape or a filter change) every shortcut fired
 * against it regardless.
 *
 * Two things went wrong at once. `preventDefault` cancelled the focused
 * control's own activation, so the button the user pressed did nothing — and
 * the shortcut ran against a *different* entry, so Space wrote `progress + 1`
 * to the real AniList list for a title they were not looking at.
 *
 * So: act only when nothing else owns the keyboard. `body` is the resting
 * state, and the scroll container itself counts because it is focusable and is
 * where a click on empty space lands.
 *
 * Deliberately **not** "is the focused element outside the grid": the rows'
 * own links and their `+1`/complete/edit buttons live *inside* the scroll
 * container, and they hit exactly the same bug against a different row than
 * the one they belong to.
 */
export function ownsKeyboard(
  active: unknown,
  body: unknown,
  container: unknown,
): boolean {
  return !active || active === body || active === container;
}
