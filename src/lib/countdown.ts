/**
 * The scrobble countdown, as a number the ring can draw.
 *
 * The backend sends only the moment the update is due, not how long the wait
 * was — the threshold depends on episode length, media type and a user setting,
 * and none of that is on the wire. So the span is inferred from the largest
 * remaining time the card has seen for this target, which is exact in the
 * ordinary case (the card appears when detection starts, so the first tick *is*
 * the full span) and degrades gracefully when it is not: joining late simply
 * means the ring starts partway round rather than lying about it.
 */

/** How far through the wait we are, 0 at the start and 1 when it is due. */
export function countdownFraction(remainingMs: number, spanMs: number): number {
  if (spanMs <= 0) return 1;
  const done = 1 - remainingMs / spanMs;
  return Math.min(1, Math.max(0, done));
}

/**
 * `stroke-dashoffset` for a ring of circumference `c` at `fraction` complete.
 *
 * Full circumference is an empty ring, zero is a closed one.
 */
export function ringOffset(fraction: number, circumference: number): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return circumference * (1 - clamped);
}

/** Minutes and seconds, or just seconds under a minute. */
export function splitRemaining(remainingMs: number): {
  minutes: number;
  seconds: number;
} {
  const clamped = Math.max(0, remainingMs);
  return {
    minutes: Math.floor(clamped / 60_000),
    seconds: Math.floor((clamped % 60_000) / 1000),
  };
}
