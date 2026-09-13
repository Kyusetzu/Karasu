import { useSyncExternalStore } from "react";

/** The phone shell is keyed on width, never user-agent, so a narrowed desktop window can exercise it. */
const QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

export function usePhoneShell(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
