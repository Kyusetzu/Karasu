import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  Command,
  Copy,
  ExternalLink,
  RefreshCw,
  Settings,
  SquareArrowOutUpRight,
} from "lucide-react";

interface Ctx {
  x: number;
  y: number;
  mediaId?: number;
  mediaType?: string;
  selection?: string;
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** Only ever set for a key that is actually wired — see `KeyboardSheet`. */
  hint?: string;
}

/**
 * Menu geometry in rem, so it rides the fluid root scale like everything else.
 * The clamping below has to agree with the rendered width, so both the class
 * and the maths read these — a literal `w-[220px]` plus a JS `220` would drift
 * apart the moment the root font size moves, and the menu would open partly
 * off-screen.
 */
const MENU_W_REM = 13.75;
const MENU_ROW_H_REM = 1.875;

const rootFontSize = () =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * Replaces the browser's default right-click menu with app-appropriate
 * actions. On editable fields the native menu is left intact (cut/copy/paste);
 * elsewhere we show navigation + context actions, plus item actions when the
 * click lands on a media card/row (tagged with `data-media-id`).
 */
export default function ContextMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Keep the native menu for editable content.
      if (target.closest("input, textarea, [contenteditable='true']")) return;

      e.preventDefault();
      const mediaEl = target.closest<HTMLElement>("[data-media-id]");
      setCtx({
        x: e.clientX,
        y: e.clientY,
        mediaId: mediaEl ? Number(mediaEl.dataset.mediaId) : undefined,
        mediaType: mediaEl?.dataset.mediaType,
        selection: window.getSelection()?.toString().trim() || undefined,
      });
    };
    window.addEventListener("contextmenu", onContext);
    return () => window.removeEventListener("contextmenu", onContext);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctx]);

  if (!ctx) return null;

  const run = (fn: () => void) => () => {
    fn();
    setCtx(null);
  };

  const items: MenuItem[] = [];

  if (ctx.mediaId) {
    items.push({
      label: t("ctx.open"),
      icon: <SquareArrowOutUpRight className="size-3.5" />,
      onClick: run(() => navigate(`/media/${ctx.mediaId}`)),
    });
    items.push({
      label: t("ctx.openAniList"),
      icon: <ExternalLink className="size-3.5" />,
      onClick: run(() =>
        openUrl(
          `https://anilist.co/${ctx.mediaType === "MANGA" ? "manga" : "anime"}/${ctx.mediaId}`,
        ),
      ),
    });
  }

  if (ctx.selection) {
    items.push({
      label: t("ctx.copy"),
      icon: <Copy className="size-3.5" />,
      onClick: run(() => {
        navigator.clipboard?.writeText(ctx.selection ?? "").catch(() => {});
      }),
    });
  }

  items.push(
    {
      label: t("ctx.back"),
      icon: <ArrowLeft className="size-3.5" />,
      onClick: run(() => navigate(-1)),
    },
    {
      label: t("ctx.forward"),
      icon: <ArrowRight className="size-3.5" />,
      onClick: run(() => navigate(1)),
    },
    {
      label: t("ctx.reload"),
      icon: <RefreshCw className="size-3.5" />,
      onClick: run(() => window.location.reload()),
    },
    {
      label: t("ctx.palette"),
      icon: <Command className="size-3.5" />,
      hint: "Ctrl K",
      onClick: run(() =>
        window.dispatchEvent(new Event("open-command-palette")),
      ),
    },
    {
      label: t("ctx.settings"),
      icon: <Settings className="size-3.5" />,
      onClick: run(() => navigate("/settings")),
    },
  );

  // Keep the menu inside the viewport.
  const rem = rootFontSize();
  const gap = 0.5 * rem;
  const x = Math.min(ctx.x, window.innerWidth - MENU_W_REM * rem - gap);
  const y = Math.min(
    ctx.y,
    window.innerHeight - items.length * MENU_ROW_H_REM * rem - gap,
  );

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-55 origin-top-left animate-pop-in overflow-hidden rounded-lg border border-hair bg-surface-850 p-1.25 shadow-2xl panel-wash"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.onClick}
          className="flex h-7.5 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[.78125rem] text-ink-300 transition-surface hover:bg-surface-800 hover:text-ink-100"
        >
          <span className="grid size-4 shrink-0 place-items-center text-ink-500">
            {item.icon}
          </span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint && (
            <span className="shrink-0 text-2xs tabular-nums text-ink-600">
              {item.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
