/** Not-found versus could-not-ask; a null root throws, so check not-found before any generic error branch. */

/** What the query functions throw for a null root. */
export const NOT_FOUND = "NOT_FOUND";

/** Whether a rejection means the thing is not there; also matches AniList's own 404 wording, which arrives as text. */
export function isNotFound(error: unknown): boolean {
  if (!error) return false;
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.trim().toLowerCase().replace(/\.$/, "");
  return normalized === NOT_FOUND.toLowerCase() || normalized.endsWith("not found");
}

/** The stable code `client.rs` returns for a rate-limited request. */
export const RATE_LIMITED = "anilist.rateLimited";

/** Whether AniList is throttling us; `client.rs` already waited out `Retry-After`, so never retry from here. */
export function isRateLimited(error: unknown): boolean {
  if (!error) return false;
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() === RATE_LIMITED;
}

/** Whether a rejection is the connection rather than the answer; only the `Network error:` prefix is the contract. */
export function isOffline(error: unknown): boolean {
  if (!error) return false;
  const text = error instanceof Error ? error.message : String(error);
  return text.trim().startsWith("Network error:");
}
