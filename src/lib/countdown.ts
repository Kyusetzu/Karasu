/** Ring numbers for the scrobble countdown; the backend sends both ends of the wait. */

/** How far through the wait we are at `nowMs`: 0 when armed, 1 when due; a mid-wait mount lands right at first render. */
export function countdownFraction(
  armedAtMs: number,
  updateAtMs: number,
  nowMs: number,
): number {
  const span = updateAtMs - armedAtMs;
  if (span <= 0) return 1;
  const done = (nowMs - armedAtMs) / span;
  return Math.min(1, Math.max(0, done));
}

/** `stroke-dashoffset` for a ring at `fraction` complete: full circumference is empty, zero is closed. */
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
