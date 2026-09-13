import { useSyncExternalStore } from "react";

/** Below this height the expanded sidebar no longer fits its items, which happens on a TV at a large interface size. */
const QUERY = "(max-height: 620px)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** Whether the viewport is too short for the expanded sidebar; keyed on height, so a zoomed window counts. */
export function useShortViewport(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
