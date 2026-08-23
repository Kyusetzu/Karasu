import { useSyncExternalStore } from "react";

/**
 * Whether the shell should wear its phone shape — bottom bar instead of the
 * sidebar, no window controls.
 *
 * **Width, deliberately, not user-agent.** The phone shell exists for a
 * ~360–430dp viewport, and keying it on measured width means it can be
 * exercised on a desktop by narrowing the window — which is the only way any
 * of it gets seen before an APK is on a device. A user-agent check would make
 * the phone layout unreachable everywhere it could be developed.
 *
 * The breakpoint is the viewport, not a measured container, and that is not a
 * violation of the `useRowTier` philosophy: the shell *is* the viewport —
 * there is no enclosing element whose width could differ from it.
 *
 * 768 splits the smallest real desktop window this app allows (`minWidth:
 * 940`) from every phone, with room for Android's odd densities. Tablets in
 * portrait land on the phone shell, which is the better wrong answer: a
 * sidebar needs a pointer more than a bottom bar needs width.
 */
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
