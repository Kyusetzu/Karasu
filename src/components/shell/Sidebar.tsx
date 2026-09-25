import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  LayoutDashboard,
  Library,
  BookOpen,
  CloudUpload,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  CalendarDays,
  CalendarRange,
  BarChart3,
  Sparkles,
  HardDrive,
  Info,
  LogIn,
  Settings,
  Users,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { loadCollapsed, saveCollapsed } from "@/lib/sidebarWidth";
import { isAndroid, usePlatform } from "@/stores/platform";
import { useAuth } from "@/stores/auth";
import { useAniListLogin } from "@/hooks/useAniListLogin";
import { useListSummary } from "@/hooks/useListSummary";
import { useManualSync } from "@/hooks/useManualSync";
import { useShortViewport } from "@/hooks/useShortViewport";
import { Avatar, UserLockup } from "@/components/ui/user-lockup";
import SyncPanel from "./SyncPanel";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";

/** The rail is the state change: `useRailMarker` slides one marker between items rather than each growing its own. */
const itemClass =
  "relative flex items-center gap-2.75 rounded-control px-2.5 py-1.75 transition-surface";

/** Icon-only: the gap and the left padding have nothing left to separate. */
const collapsedItemClass = "justify-center gap-0 px-0";

const stateClass = (isActive: boolean) =>
  isActive
    ? "bg-surface-850 text-ink-100"
    : "text-ink-500 hover:bg-surface-850 hover:text-ink-100";

/** Where the accent rail should sit, found by `aria-current` so nothing has to enumerate a set that is not fixed. */
function useRailMarker(deps: unknown[]) {
  const navRef = useRef<HTMLElement>(null);
  const [top, setTop] = useState<number | null>(null);

  const measure = useCallback(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return setTop(null);
    const navBox = nav.getBoundingClientRect();
    const itemBox = active.getBoundingClientRect();
    // The item's centre; the marker is centred on it and sized in rem, so it survives the Windows text-scale setting.
    setTop(itemBox.top - navBox.top + itemBox.height / 2);
  }, []);

  useLayoutEffect(measure, [measure, ...deps]);

  // The rail is a fixed width but its content is not: a wrapped label or a scrollbar changes item heights.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [measure]);

  return { navRef, top };
}

const labelClass = "text-ui font-medium tracking-[.005em]";

export interface NavItem {
  to: string;
  key: string;
  icon: LucideIcon;
  end?: true;
  /** Which list's entry count to show on the right, if any. */
  count?: "ANIME" | "MANGA";
}

export const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "nav.groupLibrary",
    items: [
      { to: "/", key: "nav.dashboard", icon: LayoutDashboard, end: true },
      { to: "/list", key: "nav.list", icon: Library, count: "ANIME" },
      { to: "/manga", key: "nav.manga", icon: BookOpen, count: "MANGA" },
    ],
  },
  {
    label: "nav.groupDiscover",
    items: [
      { to: "/search", key: "nav.search", icon: Search },
      { to: "/seasonal", key: "nav.seasonal", icon: CalendarDays },
      // CalendarRange, not CalendarDays (Seasonal's) or CalendarClock (the Bell's): three calendar surfaces, three glyphs.
      { to: "/calendar", key: "nav.calendar", icon: CalendarRange },
      { to: "/social", key: "nav.social", icon: Users },
      { to: "/forum", key: "nav.forum", icon: MessagesSquare },
    ],
  },
  {
    label: "nav.groupInsight",
    items: [
      { to: "/stats", key: "nav.stats", icon: BarChart3 },
      { to: "/wrapped", key: "nav.wrapped", icon: Sparkles },
      { to: "/library", key: "nav.library", icon: HardDrive },
    ],
  },
];

/** What Android cannot do, keyed on the platform rather than the shell width, and shared by every way to navigate. */
export const ANDROID_HIDDEN_ROUTES = new Set(["/library"]);

/** `GROUPS` minus what this platform cannot do. */
export function visibleGroups(android: boolean): { label: string; items: NavItem[] }[] {
  if (!android) return GROUPS;
  return GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => !ANDROID_HIDDEN_ROUTES.has(i.to)),
  })).filter((g) => g.items.length > 0);
}

function Item({
  item,
  count,
  collapsed,
}: {
  item: NavItem;
  count?: number | null;
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(item.key);
  return (
    <NavLink
      to={item.to}
      end={item.end}
      // The label is the accessible name, so collapsed it moves to `aria-label` and `title` rather than vanishing.
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(itemClass, stateClass(isActive), collapsed && collapsedItemClass)
      }
    >
      <Icon className="size-4.25 shrink-0" />
      {!collapsed && <span className={labelClass}>{label}</span>}
      {!collapsed && count != null && (
        <span className="ml-auto text-2xs font-medium tracking-[.02em] tabular-nums text-ink-600">
          {count}
        </span>
      )}
    </NavLink>
  );
}

/** "Is my data safe?" without a click: anything unsent outranks everything else, whatever the last sync said. */
function syncLine(
  t: TFunction,
  local: boolean,
  pending: number,
  syncedAt: number | null,
): { text: string; accent: boolean } {
  if (local) return { text: t("sync.local"), accent: false };
  if (pending > 0)
    return {
      text: pending === 1 ? t("sync.queuedOne") : t("sync.queuedMany", { n: pending }),
      accent: true,
    };
  if (syncedAt == null) return { text: t("sync.never"), accent: false };
  const min = Math.floor((Date.now() - syncedAt) / 60_000);
  if (min < 1) return { text: t("sync.now"), accent: false };
  if (min < 60) return { text: t("sync.minutes", { n: min }), accent: false };
  const h = Math.floor(min / 60);
  if (h < 24) return { text: t("sync.hours", { n: h }), accent: false };
  return { text: t("sync.days", { n: Math.floor(h / 24) }), accent: false };
}

function Account({
  pending,
  syncedAt,
  collapsed,
}: {
  pending: number;
  syncedAt: number | null;
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);

  if (mode === "none") return null;

  const name = viewer?.name ?? t("sync.localProfile");
  const avatar = viewer?.avatar?.large ?? null;
  const local = mode === "local";
  const sync = syncLine(t, local, pending, syncedAt);

  const line = (
    <span
      className={cn(
        "flex items-center gap-1.25 text-2xs leading-snug",
        sync.accent ? "text-accent-400" : "text-ink-600",
      )}
    >
      <span className="size-1.25 shrink-0 rounded-full bg-current" />
      <span className="truncate">{sync.text}</span>
    </span>
  );

  /** The line with the panel behind it, except in local mode, where a list that never syncs has nothing to explain. */
  const syncNode = local ? (
    <span className="mt-1 block px-1">{line}</span>
  ) : (
    <SyncPanel label={t("syncPanel.open")} className="mt-1">
      <span className="block px-1 py-0.5">{line}</span>
    </SyncPanel>
  );

  // Collapsed, the sync line becomes a dot on the avatar, since "something is unsent" must not vanish with the labels.
  if (collapsed) {
    const body = (
      <span className="relative block" title={`${name} — ${sync.text}`}>
        <Avatar name={name} src={avatar} size="sm" />
        {sync.accent && (
          <Badge floating className="-right-0.5 -top-0.5 border-surface-900" />
        )}
      </span>
    );
    return (
      <div className="mx-2.5 mb-2 flex flex-col items-center gap-1.5 border-b border-hair pb-3 pt-2">
        {viewer ? (
          <NavLink
            to={`/user/${encodeURIComponent(viewer.name)}`}
            aria-label={name}
            className="rounded-control transition-surface hover:bg-surface-900"
          >
            {body}
          </NavLink>
        ) : (
          body
        )}
        {/* The panel survives the collapse; it is the only way to read what the dot above is warning about. */}
        {!local && (
          <SyncPanel label={t("syncPanel.open")} className="w-auto">
            <span
              title={sync.text}
              className={cn(
                "grid size-6 place-items-center rounded-inner",
                sync.accent ? "text-accent-400" : "text-ink-600",
              )}
            >
              {pending > 0 ? (
                <span className="text-2xs font-semibold tabular-nums">
                  {pending > 9 ? "9+" : pending}
                </span>
              ) : (
                <CloudUpload className="size-3.25" />
              )}
            </span>
          </SyncPanel>
        )}
      </div>
    );
  }

  const lockup = (
    <UserLockup
      name={name}
      src={avatar}
      size="sm"
      nameClassName="text-xs font-medium leading-snug text-ink-300"
    />
  );

  return (
    <div className="mx-2.5 mb-2 border-b border-hair pb-3 pt-2">
      {/* Only a link with an AniList account behind it; the local profile has no AniList page and would 404. */}
      {viewer ? (
        <NavLink
          to={`/user/${encodeURIComponent(viewer.name)}`}
          className="-mx-1 block rounded-control px-1 py-0.5 transition-surface hover:bg-surface-900"
        >
          {lockup}
        </NavLink>
      ) : (
        lockup
      )}
      {/* A sibling of the lockup rather than its `sub`: a button inside the profile link is invalid markup. */}
      {syncNode}
    </div>
  );
}

export default function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const login = useAniListLogin();
  const manualSync = useManualSync();
  // `?? 0`, matching every list screen; keying on `undefined` in local mode reads a cache entry nothing writes.
  const { counts, pending, syncedAt } = useListSummary(viewer?.id ?? 0);
  const android = isAndroid(usePlatform((s) => s.info));
  const [stored, setStored] = useState(loadCollapsed);
  // A short viewport collapses the rail by itself; a toggle while short is an override that lasts until the height changes.
  const short = useShortViewport();
  const [override, setOverride] = useState<boolean | null>(null);
  useEffect(() => setOverride(null), [short]);
  const collapsed = override ?? (stored || short);

  const toggleCollapsed = () => {
    const next = !collapsed;
    if (short) {
      setOverride(next);
      return;
    }
    setStored(next);
    saveCollapsed(next);
  };
  const { pathname } = useLocation();
  // Re-measured when the route changes and when the item set does; local mode and Android each change the set.
  const { navRef, top } = useRailMarker([pathname, mode, collapsed, android]);

  // If the browser handoff cannot start, Settings holds the manual token paste, so send the user there.
  const linkAccount = async () => {
    if (!(await login.start())) navigate("/settings?pane=account");
  };

  return (
    <nav
      ref={navRef}
      className={cn(
        "relative flex shrink-0 flex-col border-r border-hair bg-surface-900 pb-2.5 pt-3",
        // Surface motion: the plain utility inherits `--ease-karasu` and the reduce-motion rules kill it for free.
        "transition-[width]",
        collapsed ? "w-14" : "w-52",
      )}
    >
      {/* One rail for the whole nav, travelling between items; hidden when the route is not in it at all. */}
      {top !== null && (
        <span
          aria-hidden="true"
          className="absolute left-0 z-10 h-4.5 w-0.75 -translate-y-1/2 rounded-r-[.125rem] bg-accent-500 transition-[top] duration-(--duration-expressive) ease-(--ease-out-expo)"
          style={{ top }}
        />
      )}
      {/* Scrolls as the last resort, so no item is ever unreachable on a viewport shorter than the rail. */}
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5">
        {visibleGroups(android).map((group, i) => (
          <div key={group.label} className="contents">
            {/* Collapsed, a rule keeps the grouping the headings carried; the first group needs none since nothing precedes it. */}
            {collapsed ? (
              i > 0 && <div className="mx-2 my-2 border-t border-hair" />
            ) : (
              <div
                className={cn(
                  "px-2.5 pb-1.75 text-2xs font-semibold uppercase tracking-[.16em] text-ink-600",
                  // The first label sits under the titlebar's own breathing room; the later ones open the gap themselves.
                  i === 0 ? "pt-1.5" : "pt-3.75",
                )}
              >
                {t(group.label)}
              </div>
            )}
            {group.items.map((item) => (
              <Item
                key={item.to}
                item={item}
                collapsed={collapsed}
                count={item.count ? counts[item.count] : undefined}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-px px-2.5">
        {/* Causes a sync where the chip below only reports one; signed-in only, since a local list has nothing to sync. */}
        {manualSync.available && (
          <button
            type="button"
            onClick={() => void manualSync.sync()}
            disabled={manualSync.syncing}
            aria-label={collapsed ? t("sync.button") : undefined}
            title={collapsed ? t("sync.button") : undefined}
            className={cn(
              itemClass,
              stateClass(false),
              collapsed && collapsedItemClass,
              "disabled:opacity-60",
            )}
          >
            <Spinner spinning={manualSync.syncing} className="size-4.25 shrink-0" />
            {!collapsed && <span className={labelClass}>{t("sync.button")}</span>}
          </button>
        )}
        <Account pending={pending} syncedAt={syncedAt} collapsed={collapsed} />
        {/* Linking AniList is the one action a local profile cannot reach elsewhere in one click. */}
        {mode === "local" && (
          <button
            type="button"
            onClick={linkAccount}
            aria-label={collapsed ? t("nav.linkAccount") : undefined}
            title={collapsed ? t("nav.linkAccount") : undefined}
            className={cn(
              itemClass,
              stateClass(false),
              collapsed && collapsedItemClass,
              "text-accent-400",
            )}
          >
            <LogIn className="size-4.25 shrink-0" />
            {!collapsed && <span className={labelClass}>{t("nav.linkAccount")}</span>}
          </button>
        )}
        <NavLink
          to="/about"
          aria-label={collapsed ? t("nav.about") : undefined}
          title={collapsed ? t("nav.about") : undefined}
          className={({ isActive }) =>
            cn(itemClass, stateClass(isActive), collapsed && collapsedItemClass)
          }
        >
          <Info className="size-4.25 shrink-0" />
          {!collapsed && <span className={labelClass}>{t("nav.about")}</span>}
        </NavLink>
        <NavLink
          to="/settings"
          aria-label={collapsed ? t("nav.settings") : undefined}
          title={collapsed ? t("nav.settings") : undefined}
          className={({ isActive }) =>
            cn(itemClass, stateClass(isActive), collapsed && collapsedItemClass)
          }
        >
          <Settings className="size-4.25 shrink-0" />
          {!collapsed && <span className={labelClass}>{t("nav.settings")}</span>}
        </NavLink>
        {/* Last, and below the navigation on purpose: it changes the shape of the rail rather than going anywhere. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
          title={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
          className={cn(itemClass, stateClass(false), collapsed && collapsedItemClass)}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4.25 shrink-0" />
          ) : (
            <PanelLeftClose className="size-4.25 shrink-0" />
          )}
          {!collapsed && (
            <span className={labelClass}>{t("nav.collapseSidebar")}</span>
          )}
        </button>
      </div>
    </nav>
  );
}
