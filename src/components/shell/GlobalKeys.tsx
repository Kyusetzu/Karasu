import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { getUiZoom, isTauri, setUiZoom } from "@/api/anilist";
import { isTyping } from "@/components/shell/KeyboardSheet";
import { useManualSync } from "@/hooks/useManualSync";
import { stepZoom, UI_ZOOM_DEFAULT, zoomShortcut } from "@/lib/uiZoom";
import { isAndroid, usePlatform } from "@/stores/platform";

/** The global shortcut group, mounted once in the shell so it works from anywhere. */
export default function GlobalKeys() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Destructured so the effect's deps survive the hook's `syncing` flips; `sync` is a stable callback.
  const { sync, available } = useManualSync();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Keep the `data-overlay` check; without it `/` and Ctrl+1/2/3 fire behind an open dialog and discard its edits.
      const overlay = document.querySelector("[data-overlay]") !== null;

      // Not while the caret is in a field, since `/` is a character before it is a command.
      if (!mod && e.key === "/" && !isTyping() && !overlay) {
        e.preventDefault();
        navigate("/search");
        return;
      }

      // Zoom keys; Tauri's own stay off because they do not store, and these alone pass through an open dialog.
      const zoom = zoomShortcut(e);
      if (zoom !== null && isTauri && !isAndroid(usePlatform.getState().info)) {
        e.preventDefault();
        void (async () => {
          const current = await getUiZoom();
          await setUiZoom(
            zoom === "reset" ? UI_ZOOM_DEFAULT : stepZoom(current, zoom === "in" ? 1 : -1),
          );
        })().catch(() => {});
        return;
      }

      if (!mod || e.altKey || overlay) return;

      if (e.key === "1" || e.key === "2" || e.key === "3") {
        e.preventDefault();
        navigate(["/", "/list", "/manga"][Number(e.key) - 1]);
        return;
      }

      if (e.key.toLowerCase() === "r") {
        // Refresh means the sidebar's full sync, which fetches; an invalidation alone refetches only mounted observers.
        e.preventDefault();
        if (available) void sync();
        else qc.invalidateQueries({ queryKey: ["mediaList"] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, qc, sync, available]);

  // Rust only rings the bell for the tray's Sync now; the cleanup awaits the registration so StrictMode cannot leak it.
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
