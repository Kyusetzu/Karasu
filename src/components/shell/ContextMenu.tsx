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
import { cn } from "@/lib/utils";
import { usePresentValue } from "@/hooks/usePresence";

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
  // Retained through the exit: the menu needs its position and its item
  // list to keep drawing while it scales away.
  const menu = usePresentValue(ctx);
  const ref = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Focus lands in the menu once it is on screen, so it is operable from the
  // keyboard immediately. Only on open — re-running while it is up would drag
  // focus back off whichever item the user has arrowed to.
  useEffect(() => {
    if (ctx) firstItemRef.current?.focus();
  }, [ctx]);

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

  if (!menu.value) return null;
  const shown = menu.value;

  const run = (fn: () => void) => () => {
    fn();
    setCtx(null);
  };

  const items: MenuItem[] = [];

  if (shown.mediaId) {
    items.push({
      label: t("ctx.open"),
      icon: <SquareArrowOutUpRight className="size-3.5" />,
      onClick: run(() => navigate(`/media/${shown.mediaId}`)),
    });
    items.push({
      label: t("ctx.openAniList"),
      icon: <ExternalLink className="size-3.5" />,
      onClick: run(() =>
        openUrl(
          `https://anilist.co/${shown.mediaType === "MANGA" ? "manga" : "anime"}/${shown.mediaId}`,
        ),
      ),
    });
  }

  if (shown.selection) {
    items.push({
      label: t("ctx.copy"),
      icon: <Copy className="size-3.5" />,
      onClick: run(() => {
        navigator.clipboard?.writeText(shown.selection ?? "").catch(() => {});
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
  const x = Math.min(shown.x, window.innerWidth - MENU_W_REM * rem - gap);
  const y = Math.min(
    shown.y,
    window.innerHeight - items.length * MENU_ROW_H_REM * rem - gap,
  );
  // Which corner it actually ended up hinged on, once clamped — one class,
  // since they all set the same property.
  const origin =
    y < shown.y
      ? x < shown.x
        ? "origin-bottom-right"
        : "origin-bottom-left"
      : x < shown.x
        ? "origin-top-right"
        : "origin-top-left";

  return (
    <div
      ref={ref}
      // Same convention as every dialog: while this is up it owns the
      // keyboard, so a list shortcut cannot fire behind it.
      data-overlay
      // A menu, and announced as one. Without these it was a `div` of buttons:
      // a screen reader had no way to say how many items there were or that
      // they belonged together, and nothing moved focus into it, so a menu
      // opened from the keyboard left focus behind on the element that opened
      // it — the first Tab then walked the page rather than the menu.
      role="menu"
      aria-label={t("ctx.menuLabel")}
      className={cn(
        "fixed z-[100] w-55 overflow-hidden rounded-lg border border-hair bg-surface-850 p-1.25 shadow-2xl panel-wash",
        // Scales from the corner it was opened at rather than always the
        // top-left: the menu flips when clamped near an edge, and growing
        // out of the wrong corner is the tell that it is a fixed guess.
        origin,
        menu.leaving ? "animate-pop-out" : "animate-pop-in",
      )}
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          role="menuitem"
          // The first item takes focus so the menu is operable from the
          // keyboard the moment it appears, and Escape/outside-click return it.
          ref={i === 0 ? firstItemRef : undefined}
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
