import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/api/anilist";
import { isTyping } from "@/components/shell/KeyboardSheet";
import { useManualSync } from "@/hooks/useManualSync";

/**
 * The global shortcut group.
 *
 * Mounted once in the shell rather than per screen, because these are meant to
 * work from anywhere — a shortcut that only fires on the page it belongs to is
 * a button with extra steps. `Ctrl/Cmd+K` and `?` live with the overlays they
 * open; everything else in the group is here.
 */
export default function GlobalKeys() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Destructured so the effect's deps stay stable across the `syncing` flips
  // the hook's state makes — `sync` is a stable callback.
  const { sync, available } = useManualSync();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // A dialog owns the keyboard while it is open — the `data-overlay`
      // convention, which MediaList already honours and this did not. Without
      // it, pressing `/` with the entry editor open (focus on a status pill, so
      // `isTyping` is false) navigated to Search, remounted the page and threw
      // away every unsaved edit with no prompt. Ctrl+1/2/3 did the same from
      // any open dialog.
      const overlay = document.querySelector("[data-overlay]") !== null;

      // Single-key shortcuts must not fire while the caret is in a field —
      // `/` is a character before it is a command.
      if (!mod && e.key === "/" && !isTyping() && !overlay) {
        e.preventDefault();
        navigate("/search");
        return;
      }

      if (!mod || e.altKey || overlay) return;

      if (e.key === "1" || e.key === "2" || e.key === "3") {
        e.preventDefault();
        navigate(["/", "/list", "/manga"][Number(e.key) - 1]);
        return;
      }

      if (e.key.toLowerCase() === "r") {
        // Reload is not a thing a desktop app should do: the WebView would
        // drop every cache and re-authenticate to show the same screen. Sync
        // is what the user means by refresh here — the same full sync as the
        // sidebar button, which actually *fetches* (an invalidation alone
        // refetches only mounted observers, so from most pages it did
        // nothing visible). Local mode keeps the invalidation: its lists
        // read SQLite and there is no server to ask.
        e.preventDefault();
        if (available) void sync();
        else qc.invalidateQueries({ queryKey: ["mediaList"] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, qc, sync, available]);

  // The tray's "Sync now" — Rust only rings the bell, because the sync has
  // to drive the frontend's query cache. Same StrictMode-safe cleanup as
  // NowPlayingCard: the registration promise is awaited before unlistening.
  useEffect(() => {
    if (!isTauri) return;
    const registered = listen("manual-sync", () => {
      if (available) void sync();
    });
    return () => {
      void registered.then((unlisten) => unlisten());
    };
  }, [sync, available]);

  return null;
}
