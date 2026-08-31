/**
 * Telling "this does not exist" apart from "we could not ask".
 *
 * The profile, thread and person queries throw `Error("NOT_FOUND")` when
 * AniList returns a null root, and their pages rendered *any* rejection as the
 * not-found state. So an expired token, a rate limit or a dropped connection
 * all reported, in the app's own voice and with no retry offered, that the user
 * or thread does not exist — a definite claim about someone else's account,
 * made because the network was down.
 *
 * The obvious fix — `if (error) return <error/>` before the not-found branch —
 * is wrong here and was rejected: those queries *only* signal not-found through
 * `error`, since a null root throws rather than resolving. Splitting on `error`
 * first would delete the genuine not-found state entirely and show a raw
 * `Error: NOT_FOUND` for a deleted account.
 */

/** What the query functions throw for a null root. */
export const NOT_FOUND = "NOT_FOUND";

/**
 * Whether a rejection means the thing genuinely is not there.
 *
 * Also matches AniList's own wording, because a 404 from the API surfaces as
 * its message rather than as our sentinel — the backend passes GraphQL errors
 * through as text. Matched case-insensitively and without the trailing period,
 * which AniList includes and is not worth depending on.
 */
export function isNotFound(error: unknown): boolean {
  if (!error) return false;
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.trim().toLowerCase().replace(/\.$/, "");
  return normalized === NOT_FOUND.toLowerCase() || normalized.endsWith("not found");
}

/** The stable code `client.rs` returns for a rate-limited request. */
export const RATE_LIMITED = "anilist.rateLimited";

/**
 * Whether a rejection is AniList throttling us.
 *
 * Retrying it is guaranteed to fail until the window rolls, and the Rust
 * client has already waited out the server's `Retry-After` before giving up —
 * so a second attempt from here spends another request out of a ~30/min budget
 * to reach the identical answer, and does it for every query on the screen at
 * once.
 */
export function isRateLimited(error: unknown): boolean {
  if (!error) return false;
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() === RATE_LIMITED;
}
