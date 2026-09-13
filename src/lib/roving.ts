/** Arrow-key movement over a grid that is laid out as one flat array. */
export type Move = "left" | "right" | "up" | "down";

/** Next focus index over the whole virtualized array; clamps rather than wraps so the user keeps their place. */
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

/** Whether a screen shortcut may act: only when no control is focused, or a row's button hits the wrong entry. */
export function ownsKeyboard(
  active: unknown,
  body: unknown,
  container: unknown,
): boolean {
  return !active || active === body || active === container;
}
