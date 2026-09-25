import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Command, Info, LayoutGrid, RefreshCw, Settings, X } from "lucide-react";
import { GROUPS, visibleGroups, type NavItem } from "@/components/shell/Sidebar";
import { usePresence } from "@/hooks/usePresence";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useBackClose } from "@/hooks/useBackClose";
import { cn } from "@/lib/utils";
import { isAndroid, usePlatform } from "@/stores/platform";
import Bell from "@/components/shell/Bell";
import { useNotifBadge } from "@/hooks/useNotifBadge";
import { isPaletteSwipe } from "@/lib/navSwipe";
import { Badge } from "@/components/ui/badge";

/** The phone shell's four bar slots; everything else is behind a More sheet built from the sidebar's `GROUPS`. */
const SLOTS = ["/", "/list", "/manga", "/search"];

function slotItems(): NavItem[] {
  const all = GROUPS.flatMap((g) => g.items);
  return SLOTS.map((to) => all.find((i) => i.to === to)).filter(
    (i): i is NavItem => i !== undefined,
  );
}

function sheetGroups(android: boolean): { label: string; items: NavItem[] }[] {
  // Platform filtering stays in `visibleGroups` so the three ways to navigate agree; this only removes the slots.
  const groups = visibleGroups(android)
    .map((g) => ({
      label: g.label,
      items: g.items.filter((i) => !SLOTS.includes(i.to)),
    }))
    .filter((g) => g.items.length > 0);
  // Settings and About sit outside `GROUPS` in the sidebar's footer; without this the phone cannot reach either.
  const app: NavItem[] = [
    { to: "/settings", key: "nav.settings", icon: Settings },
    { to: "/about", key: "nav.about", icon: Info },
  ];
  // Android pulls a screen down to sync, so the row would be a second door to one place; elsewhere it is the only one.
  if (!android) app.unshift({ to: "/settings?pane=data", key: "nav.sync", icon: RefreshCw });
  groups.push({ label: "nav.groupApp", items: app });
  return groups;
}

const slotClass =
  "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-control py-1.5 text-2xs font-medium transition-surface";

export default function BottomBar() {
  const { t } = useTranslation();
  const android = isAndroid(usePlatform((s) => s.info));
  const [moreOpen, setMoreOpen] = useState(false);
  useBackClose(moreOpen, () => setMoreOpen(false));
  const sheet = usePresence(moreOpen);
  const sheetRef = useRef<HTMLDivElement>(null);
  // `data-overlay` silences every screen-level key handler, so the sheet must supply Escape and the focus trap itself.
  useDialogFocus(sheetRef, moreOpen && !sheet.leaving);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);
  const { pathname } = useLocation();
  const badge = useNotifBadge();
  // The bar is the gesture surface, so the swipe is recognised here rather than over a reserved strip of the page.
  const swipe = useRef<{ x: number; y: number; at: number } | null>(null);
  const swallowTap = useRef(false);

  const openPalette = () => window.dispatchEvent(new Event("open-command-palette"));
  // "More" reads active when the page is none of the four slots; the bar must always show where you are.
  const inSheet = !SLOTS.some((s) =>
    s === "/" ? pathname === "/" : pathname.startsWith(s),
  );

  return (
    <>
      {sheet.mounted && (
        <div
          data-overlay
          className={cn(
            "fixed inset-0 z-40",
            sheet.leaving ? "animate-fade-out" : "animate-fade-in",
          )}
        >
          <button
            type="button"
            aria-label={t("window.close")}
            className="absolute inset-0 bg-scrim"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-label={t("nav.more")}
            className={cn(
              // max-h plus scroll: a short phone must never push the top rows under the status bar.
              "absolute inset-x-2 bottom-16 max-h-[70vh] overflow-y-auto rounded-sheet border border-surface-700 bg-surface-900 p-3 shadow-sheet",
              sheet.leaving ? "animate-rise-out" : "animate-rise-in",
            )}
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-2xs font-semibold uppercase tracking-wide text-ink-600">
                {t("nav.more")}
              </span>
              <div className="flex items-center gap-1">
                {/* The bell lives in the sheet, since an unlabeled icon in the nav row read as decoration; More carries its count. */}
                <Bell barSlot />
                <button
                  type="button"
                  aria-label={t("window.close")}
                  onClick={() => setMoreOpen(false)}
                  className="rounded-inner p-1 text-ink-500 transition-surface hover:text-ink-100"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                openPalette();
              }}
              className="mb-2 flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-sm text-ink-300 transition-surface hover:bg-surface-850 hover:text-ink-100"
            >
              <Command className="size-4.5 shrink-0" />
              <span>{t("ctx.palette")}</span>
            </button>
            {sheetGroups(android).map((g) => (
              <div key={g.label} className="mb-2 last:mb-0">
                <p className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-ink-600">
                  {t(g.label)}
                </p>
                {/* One destination per row, not a tile grid: labels get their full width and the whole row is the touch target. */}
                <div className="flex flex-col gap-0.5">
                  {g.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-control px-2 py-2 text-sm transition-surface",
                          isActive
                            ? "bg-surface-800 text-accent-400"
                            : "text-ink-300 hover:bg-surface-850 hover:text-ink-100",
                        )
                      }
                    >
                      <item.icon className="size-4.5 shrink-0" />
                      <span>{t(item.key)}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The primary navigation landmark, named as such and like no other landmark, since screen readers list them by label. */}
      <nav
        aria-label={t("nav.primary")}
        // `touch-none`: the bar scrolls nothing, and without it Chromium claims the upward flick before it is recognised.
        className="flex shrink-0 touch-none items-stretch gap-1 border-t border-hair bg-surface-900 px-2 pb-[max(env(safe-area-inset-bottom),0.375rem)] pt-1.5"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          swipe.current = { x: e.clientX, y: e.clientY, at: Date.now() };
        }}
        onPointerUp={(e) => {
          const from = swipe.current;
          swipe.current = null;
          if (!from || document.querySelector("[data-overlay]")) return;
          const sample = {
            dx: e.clientX - from.x,
            dy: e.clientY - from.y,
            ms: Date.now() - from.at,
          };
          if (!isPaletteSwipe(sample)) return;
          // The slot under the finger would otherwise navigate on the click that follows the flick.
          swallowTap.current = true;
          openPalette();
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onClickCapture={(e) => {
          if (!swallowTap.current) return;
          swallowTap.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {slotItems().map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                slotClass,
                // No `useRailMarker` on purpose: it means nothing on a horizontal bar; active state is the accent ink.
                isActive ? "text-accent-400" : "text-ink-500 hover:text-ink-100",
              )
            }
          >
            <item.icon className="size-5" />
            <span className="truncate">{t(item.key)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          // Keep the one exclusive ternary; `cn` runs tailwind-merge, which keeps only the last text-colour class.
          className={cn(
            slotClass,
            moreOpen
              ? "text-ink-100"
              : inSheet
                ? "text-accent-400"
                : "text-ink-500 hover:text-ink-100",
          )}
        >
          <span className="relative">
            <LayoutGrid className="size-5" />
            {badge > 0 && (
              <Badge count={badge} max={9} floating className="-right-2.5 -top-1.5" />
            )}
          </span>
          <span className="truncate">{t("nav.more")}</span>
        </button>
      </nav>
    </>
  );
}
