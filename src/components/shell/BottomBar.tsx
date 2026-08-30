import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Info, LayoutGrid, Settings, X } from "lucide-react";
import { GROUPS, visibleGroups, type NavItem } from "@/components/shell/Sidebar";
import { usePresence } from "@/hooks/usePresence";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useBackClose } from "@/hooks/useBackClose";
import { cn } from "@/lib/utils";
import { isAndroid, usePlatform } from "@/stores/platform";
import Bell from "@/components/shell/Bell";
import { useNotifBadge } from "@/hooks/useNotifBadge";

/**
 * The phone shell's navigation: a five-slot bottom bar.
 *
 * The sidebar's eleven destinations do not fit a thumb row, so the four the
 * ROADMAP calls the app's identity — Overview, the two lists, Search — are
 * the slots, and everything else lives behind "More", a sheet that rises over
 * the bar. That is the standard mobile answer, and the sheet reuses the
 * sidebar's own `GROUPS` so a destination added there appears here without
 * anyone remembering to mirror it.
 *
 * The accent rail marker (`useRailMarker`) has no meaning on a horizontal
 * bar and is deliberately absent — active state is the accent ink instead.
 */
const SLOTS = ["/", "/list", "/manga", "/search"];

function slotItems(): NavItem[] {
  const all = GROUPS.flatMap((g) => g.items);
  return SLOTS.map((to) => all.find((i) => i.to === to)).filter(
    (i): i is NavItem => i !== undefined,
  );
}

function sheetGroups(android: boolean): { label: string; items: NavItem[] }[] {
  // Platform filtering lives in `visibleGroups` beside GROUPS itself, shared
  // with the sidebar and the palette so the three ways to navigate cannot
  // disagree; this sheet only subtracts what the bar already shows.
  const groups = visibleGroups(android)
    .map((g) => ({
      label: g.label,
      items: g.items.filter((i) => !SLOTS.includes(i.to)),
    }))
    .filter((g) => g.items.length > 0);
  // Settings and About sit *outside* `GROUPS` in the sidebar (its footer), so
  // without this the phone shell simply has no way to reach either — found by
  // opening the sheet and counting.
  groups.push({
    label: "nav.groupApp",
    items: [
      { to: "/settings", key: "nav.settings", icon: Settings },
      { to: "/about", key: "nav.about", icon: Info },
    ],
  });
  return groups;
}

const slotClass =
  "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[.625rem] font-medium transition-surface";

export default function BottomBar() {
  const { t } = useTranslation();
  const android = isAndroid(usePlatform((s) => s.info));
  const [moreOpen, setMoreOpen] = useState(false);
  useBackClose(moreOpen, () => setMoreOpen(false));
  const sheet = usePresence(moreOpen);
  const sheetRef = useRef<HTMLDivElement>(null);
  // The sheet claims `data-overlay`, which silences every screen-level key
  // handler — so it must supply what it silenced: Escape closes it, and Tab
  // stays inside while it is up, like every other overlay in the app.
  useDialogFocus(sheetRef, moreOpen && !sheet.leaving);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoreOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);
  const { pathname } = useLocation();
  const badge = useNotifBadge();
  // "More" reads active when the current page is none of the four slots —
  // the bar must always show where you are, even off its slots.
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
            className="absolute inset-0 bg-[rgba(4,5,8,.55)]"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-label={t("nav.more")}
            className={cn(
              "absolute inset-x-2 bottom-16 rounded-2xl border border-surface-700 bg-surface-900 p-3 shadow-[0_1rem_3rem_rgba(0,0,0,.6)]",
              sheet.leaving ? "animate-rise-out" : "animate-rise-in",
            )}
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-2xs font-semibold uppercase tracking-wide text-ink-600">
                {t("nav.more")}
              </span>
              <div className="flex items-center gap-1">
                {/* The bell lives here on the phone — an unlabeled icon in
                    the nav row read as decoration; inside the sheet it sits
                    with the other destinations, and the More button outside
                    carries its count. */}
                <Bell barSlot />
                <button
                  type="button"
                  aria-label={t("window.close")}
                  onClick={() => setMoreOpen(false)}
                  className="rounded p-1 text-ink-500 transition-surface hover:text-ink-200"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            {sheetGroups(android).map((g) => (
              <div key={g.label} className="mb-2 last:mb-0">
                <p className="px-1 pb-1 text-[.625rem] font-medium uppercase tracking-wide text-ink-700">
                  {t(g.label)}
                </p>
                <div className="grid grid-cols-3 gap-1">
                  {g.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          "flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[.6875rem] transition-surface",
                          isActive
                            ? "bg-surface-800 text-accent-400"
                            : "text-ink-400 hover:bg-surface-850 hover:text-ink-200",
                        )
                      }
                    >
                      <item.icon className="size-4.5" />
                      <span className="truncate">{t(item.key)}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The primary navigation landmark — named as such, not "More": a
          screen reader lists landmarks by these labels, and the app's whole
          navigation announcing as the overflow button's name is wrong on its
          face. Matches no other landmark, which is the one rule that matters. */}
      <nav
        aria-label={t("nav.primary")}
        className="flex shrink-0 items-stretch gap-1 border-t border-hair bg-surface-900 px-2 pb-[max(env(safe-area-inset-bottom),0.375rem)] pt-1.5"
      >
        {slotItems().map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                slotClass,
                isActive ? "text-accent-400" : "text-ink-500 hover:text-ink-200",
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
          // One exclusive ternary, not stacked conditions: `cn` runs
          // tailwind-merge, and two text-colour classes in one call keep only
          // the *last* — the stacked version deleted the accent every time,
          // so the bar showed nothing as current on any off-slot route.
          className={cn(
            slotClass,
            moreOpen
              ? "text-ink-100"
              : inSheet
                ? "text-accent-400"
                : "text-ink-500 hover:text-ink-200",
          )}
        >
          <span className="relative">
            <LayoutGrid className="size-5" />
            {badge > 0 && (
              <span className="absolute -right-2.5 -top-1.5 grid h-3.5 min-w-3.5 place-items-center rounded-[.4375rem] border border-surface-950 bg-accent-500 px-1 text-[.5625rem] font-semibold tabular-nums text-accent-ink">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </span>
          <span className="truncate">{t("nav.more")}</span>
        </button>
      </nav>
    </>
  );
}
