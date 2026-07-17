import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

// Im reinen Browser (vite dev ohne Tauri-Shell) gibt es keine Fenster-API
const appWindow =
  "__TAURI_INTERNALS__" in window ? getCurrentWindow() : null;

export default function Titlebar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center justify-between bg-surface-950"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-4">
        <span className="text-sm font-semibold tracking-wide text-ink-300">
          Karasu
        </span>
      </div>
      <div className="flex h-full">
        <button
          onClick={() => appWindow?.minimize()}
          className="grid h-full w-12 place-items-center text-ink-500 hover:bg-surface-800 hover:text-ink-100"
          aria-label="Minimieren"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => appWindow?.toggleMaximize()}
          className="grid h-full w-12 place-items-center text-ink-500 hover:bg-surface-800 hover:text-ink-100"
          aria-label="Maximieren"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => appWindow?.hide()}
          className="grid h-full w-12 place-items-center text-ink-500 hover:bg-red-600 hover:text-white"
          aria-label="Schließen (in den Tray)"
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
