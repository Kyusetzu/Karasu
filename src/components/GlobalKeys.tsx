import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { isTyping } from "@/components/KeyboardSheet";

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Single-key shortcuts must not fire while the caret is in a field —
      // `/` is a character before it is a command.
      if (!mod && e.key === "/" && !isTyping()) {
        e.preventDefault();
        navigate("/search");
        return;
      }

      if (!mod || e.altKey) return;

      if (e.key === "1" || e.key === "2" || e.key === "3") {
        e.preventDefault();
        navigate(["/", "/list", "/manga"][Number(e.key) - 1]);
        return;
      }

      if (e.key.toLowerCase() === "r") {
        // Reload is not a thing a desktop app should do: the WebView would
        // drop every cache and re-authenticate to show the same screen. Sync
        // is what the user means by refresh here.
        e.preventDefault();
        qc.invalidateQueries({ queryKey: ["mediaList"] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, qc]);

  return null;
}
