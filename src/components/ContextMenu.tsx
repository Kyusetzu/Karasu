import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
}

const MENU_W = 220;

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
      icon: <SquareArrowOutUpRight size={14} />,
      onClick: run(() => navigate(`/media/${ctx.mediaId}`)),
    });
    items.push({
      label: t("ctx.openAniList"),
      icon: <ExternalLink size={14} />,
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
      icon: <Copy size={14} />,
      onClick: run(() => {
        navigator.clipboard?.writeText(ctx.selection ?? "").catch(() => {});
      }),
    });
  }

  items.push(
    {
      label: t("ctx.back"),
      icon: <ArrowLeft size={14} />,
      onClick: run(() => navigate(-1)),
    },
    {
      label: t("ctx.forward"),
      icon: <ArrowRight size={14} />,
      onClick: run(() => navigate(1)),
    },
    {
      label: t("ctx.reload"),
      icon: <RefreshCw size={14} />,
      onClick: run(() => window.location.reload()),
    },
    {
      label: t("ctx.palette"),
      icon: <Command size={14} />,
      onClick: run(() =>
        window.dispatchEvent(new Event("open-command-palette")),
      ),
    },
    {
      label: t("ctx.settings"),
      icon: <Settings size={14} />,
      onClick: run(() => navigate("/settings")),
    },
  );

  // Keep the menu inside the viewport.
  const x = Math.min(ctx.x, window.innerWidth - MENU_W - 8);
  const rowH = 34;
  const y = Math.min(ctx.y, window.innerHeight - items.length * rowH - 8);

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-[220px] overflow-hidden rounded-lg border border-surface-700 bg-surface-900 py-1 shadow-2xl"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.onClick}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-ink-300 hover:bg-surface-800 hover:text-ink-100"
        >
          <span className="text-ink-500">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
