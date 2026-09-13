import type { ReactNode } from "react";
import { usePresence, usePresentValue } from "@/hooks/usePresence";

/** Keeps an overlay's last value alive through its exit, since React unmounts before CSS can animate `{x && <Modal/>}`. */
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
