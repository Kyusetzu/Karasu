import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "@/api/anilist";

/**
 * The one-click AniList login handoff: start the local callback server, then
 * hand off to the system browser. The backend finishes the login and pushes
 * the fresh viewer through the "anilist-auth" event, which the auth store
 * already listens for — so nothing here awaits a result.
 *
 * Shared by the Settings account card and the sidebar's link-account button,
 * which would otherwise each carry their own copy of the handoff.
 */
export function useAniListLogin() {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    let unlisten: (() => void) | undefined;
    // Failures arrive asynchronously from the callback server (denied consent,
    // invalid token) long after `start()` has resolved, so they need an event
    // rather than a rejected promise.
    listen<string>("anilist-auth-error", (e) => {
      setWaiting(false);
      setError(e.payload);
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  /**
   * Returns false if the handoff itself failed (no client id, port in use,
   * no browser). Callers use that to fall back to the manual token paste.
   */
  const start = async (): Promise<boolean> => {
    setError(null);
    try {
      const url = await api.startLogin();
      await openUrl(url);
      setWaiting(true);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  return { start, waiting, error };
}
