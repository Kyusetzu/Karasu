import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "@/api/anilist";

/** The one-click login handoff shared by every sign-in surface; the backend finishes it and pushes "anilist-auth". */
export function useAniListLogin() {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: a double-tap lands both presses within one event loop turn and each would open a browser tab.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!api.isTauri) return;
    // Outcomes arrive as events long after `start()` resolved; cleanup awaits the registrations so an early unmount unlistens.
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

  /** Returns false when the handoff itself failed, which callers use to fall back to the manual token paste. */
  const start = async (): Promise<boolean> => {
    if (inFlight.current) return true;
    inFlight.current = true;
    setError(null);
    // Before the awaits, so the press shows feedback immediately rather than after two IPC round trips.
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
