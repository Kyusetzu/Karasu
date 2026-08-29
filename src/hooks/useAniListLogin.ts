import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "@/api/anilist";

/**
 * The one-click AniList login handoff: start the local callback server, then
 * hand off to the system browser. The backend finishes the login and pushes
 * the fresh viewer through the "anilist-auth" event, which the auth store
 * already listens for — so nothing here awaits a result.
 *
 * Shared by the first-run screen, the Settings account card, the sidebar's
 * link-account button and the expired-session banner, which would otherwise
 * each carry their own copy of the handoff.
 */
export function useAniListLogin() {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: the guard has to hold *within* one event loop turn.
  // A double-tap lands both presses before `startLogin`'s IPC resolves, and
  // each would open its own browser tab. A deliberate re-press later — after
  // the user closed the tab — goes through on purpose: the backend hands the
  // same pending login back, so retrying costs nothing and rescues the flow.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!api.isTauri) return;
    // Outcomes arrive asynchronously from the callback server (denied consent,
    // invalid token, or the finished sign-in) long after `start()` has
    // resolved, so they need events rather than a rejected promise. Success
    // clears `waiting` too: most callers unmount on sign-in, but the account
    // pane stays and would otherwise show "waiting" under a signed-in card.
    //
    // Cleanup awaits the registration promises: an unmount that beats the IPC
    // round trip — which StrictMode guarantees in dev — would otherwise leave
    // the handlers registered forever, calling setState on a dead component.
    const onError = listen<string>("anilist-auth-error", (e) => {
      setWaiting(false);
      setError(e.payload);
    });
    const onAuth = listen("anilist-auth", () => {
      setWaiting(false);
      setError(null);
    });
    return () => {
      onError.then((un) => un());
      onAuth.then((un) => un());
    };
  }, []);

  /**
   * Returns false if the handoff itself failed (no client id, port in use,
   * no browser). Callers use that to fall back to the manual token paste.
   */
  const start = async (): Promise<boolean> => {
    if (inFlight.current) return true;
    inFlight.current = true;
    setError(null);
    // Before the awaits, so the press shows feedback immediately rather than
    // after two IPC round trips.
    setWaiting(true);
    try {
      const url = await api.startLogin();
      await openUrl(url);
      return true;
    } catch (e) {
      setError(String(e));
      setWaiting(false);
      return false;
    } finally {
      inFlight.current = false;
    }
  };

  return { start, waiting, error };
}
