/** Ring numbers for the scrobble countdown; the span is inferred from the largest remaining time seen, not sent. */

/** How far through the wait we are, 0 at the start and 1 when it is due. */
export function countdownFraction(remainingMs: number, spanMs: number): number {
  if (spanMs <= 0) return 1;
  const done = 1 - remainingMs / spanMs;
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
