import { useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Bell as BellIcon, Command, Info, LayoutGrid, RefreshCw, Settings, X } from "lucide-react";
import { GROUPS, visibleGroups, type NavItem } from "@/components/shell/Sidebar";
import { cn } from "@/lib/utils";
import { isAndroid, usePlatform } from "@/stores/platform";
import NotifSheet from "@/components/shell/NotifSheet";
import { afterBackSettles } from "@/hooks/useBackClose";
import { isTauri } from "@/api/anilist";
import { useNotifBadge } from "@/hooks/useNotifBadge";
import { isPaletteSwipe } from "@/lib/navSwipe";
import { Badge } from "@/components/ui/badge";
import { MenuGroupLabel, MenuRow, MenuRowBody, menuRowClass } from "@/components/ui/menu-row";
import { Sheet } from "@/components/ui/sheet";
import { IconButton } from "@/components/ui/icon-button";

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
  const [notifOpen, setNotifOpen] = useState(false);
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
      <Sheet open={moreOpen} label={t("nav.more")} onClose={() => setMoreOpen(false)}>
        <div className="mb-1 flex items-center justify-between">
          <MenuGroupLabel className="pt-0">{t("nav.more")}</MenuGroupLabel>
          <div className="flex items-center gap-1">
            {/* The bell lives in the sheet, since an unlabeled icon in the nav row read as decoration; More carries its count. */}
            {isTauri && (
              <IconButton
                aria-label={t("notif.title")}
                // More steps aside first; the notifications sheet waits for its back entry to unwind before pushing its own.
                onClick={() => {
                  setMoreOpen(false);
                  afterBackSettles(() => setNotifOpen(true));
                }}
              >
                <BellIcon className="size-5" />
                {badge > 0 && <Badge count={badge} max={9} floating className="animate-idle-pulse -right-0.5 -top-0.5" />}
              </IconButton>
            )}
            <IconButton aria-label={t("window.close")} onClick={() => setMoreOpen(false)}>
              <X className="size-4" />
            </IconButton>
          </div>
        </div>
        <MenuRow
          icon={Command}
          onClick={() => {
            setMoreOpen(false);
            openPalette();
          }}
          className="mb-2"
        >
          {t("ctx.palette")}
        </MenuRow>
        {sheetGroups(android).map((g) => (
          <div key={g.label} className="mb-2 last:mb-0">
            <MenuGroupLabel>{t(g.label)}</MenuGroupLabel>
            {/* One destination per row, not a tile grid: labels get their full width and the whole row is the touch target. */}
            <div className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) => menuRowClass({ current: isActive })}
                >
                  {({ isActive }) => (
                    <MenuRowBody icon={item.icon} current={isActive}>
                      {t(item.key)}
                    </MenuRowBody>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </Sheet>
      <NotifSheet open={notifOpen} onClose={() => setNotifOpen(false)} />

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
