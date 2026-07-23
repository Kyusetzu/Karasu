import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { Minus, Square, X } from "lucide-react";
import Bell from "@/components/Bell";
import { appVersion, isTauri } from "@/api/anilist";

// In a plain browser (vite dev without the Tauri shell) there is no window API
const appWindow =
  "__TAURI_INTERNALS__" in window ? getCurrentWindow() : null;

export default function Titlebar() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri) appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center justify-between bg-surface-950"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-4">
        <span className="text-sm font-semibold tracking-wide text-ink-300">
          Karasu
        </span>
        {version && (
          <span className="text-xs text-ink-600">v{version}</span>
        )}
      </div>
      <div className="flex h-full items-center">
        <Bell />
        <button
          onClick={() => appWindow?.minimize()}
          className="grid h-full w-12 place-items-center text-ink-500 hover:bg-surface-800 hover:text-ink-100"
          aria-label={t("window.minimize")}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => appWindow?.toggleMaximize()}
          className="grid h-full w-12 place-items-center text-ink-500 hover:bg-surface-800 hover:text-ink-100"
          aria-label={t("window.maximize")}
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => appWindow?.hide()}
          className="grid h-full w-12 place-items-center text-ink-500 hover:bg-red-600 hover:text-white"
          aria-label={t("window.closeToTray")}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
