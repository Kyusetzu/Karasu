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
