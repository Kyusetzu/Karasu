import type { ReactNode } from "react";
import { usePresence, usePresentValue } from "@/hooks/usePresence";

/**
 * Renders an overlay for as long as it needs to animate out.
 *
 * Replaces `{editing && <EntryEditModal entry={editing}/>}` at the call site.
 * That shape can only ever have an entrance: setting the state to null removes
 * the node in the same commit, and CSS cannot animate what React has already
 * taken away. This keeps the last value alive through the exit and hands the
 * child a `leaving` flag to swap its animation on.
 *
 * A component rather than the hook directly, because the hook cannot be called
 * conditionally and most of these sit inside a page that renders four of them.
 */
export function Presence<T>({
  value,
  exitMs,
  children,
}: {
  /** The state that opens the overlay; null closes it. */
  value: T | null | undefined;
  exitMs?: number;
  children: (value: T, leaving: boolean) => ReactNode;
}) {
  const presence = usePresentValue(value, exitMs);
  if (!presence.value) return null;
  return <>{children(presence.value, presence.leaving)}</>;
}

/** `Presence` for an overlay opened by a plain boolean. */
export function PresenceIf({
  when,
  exitMs,
  children,
}: {
  when: boolean;
  exitMs?: number;
  children: (leaving: boolean) => ReactNode;
}) {
  const presence = usePresence(when, exitMs);
  if (!presence.mounted) return null;
  return <>{children(presence.leaving)}</>;
}
