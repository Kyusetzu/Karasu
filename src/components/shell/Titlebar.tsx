import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { Minus, Square, X } from "lucide-react";
import Bell from "@/components/shell/Bell";
import DetectionPill from "@/components/shell/DetectionPill";
import KarasuMark from "@/components/KarasuMark";
import { appVersion, isTauri } from "@/api/anilist";

// In a plain browser (vite dev without the Tauri shell) there is no window API
const appWindow =
  "__TAURI_INTERNALS__" in window ? getCurrentWindow() : null;

const controlClass =
  "grid h-full w-12 place-items-center text-ink-500 transition-surface hover:bg-surface-850 hover:text-ink-100";

export default function Titlebar() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri) appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="relative z-5 flex h-9 shrink-0 items-center justify-between border-b border-hair bg-surface-950"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.25 pl-3.25">
        <KarasuMark className="size-5" />
        <span className="font-brand text-xs font-semibold tracking-[.2em] text-ink-300">
          KARASU
        </span>
        {version && (
          <>
            {/* The divider is what makes the version read as metadata rather
                than as part of the wordmark. */}
            <span className="h-3 w-px bg-surface-800" />
            <span className="font-brand text-2xs tabular-nums text-ink-600">
              {version}
            </span>
          </>
        )}
      </div>

      <DetectionPill />

      <div className="flex h-full items-center">
        <Bell />
        <button
          onClick={() => appWindow?.minimize()}
          className={controlClass}
          aria-label={t("window.minimize")}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          onClick={() => appWindow?.toggleMaximize()}
          className={controlClass}
          aria-label={t("window.maximize")}
        >
          <Square className="size-3" />
        </button>
        {/* Closing hides to the tray — the app keeps detecting. Don't turn
            this back into a real close. */}
        <button
          onClick={() => appWindow?.hide()}
          className="grid h-full w-12 place-items-center text-ink-500 transition-surface hover:bg-[#b3232c] hover:text-white"
          aria-label={t("window.closeToTray")}
        >
          <X className="size-4" />
        </button>
      </div>
    </header>
  );
}
