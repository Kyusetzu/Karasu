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
  RefreshCw,
  Settings,
  Users,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { loadCollapsed, saveCollapsed } from "@/lib/sidebarWidth";
import { useAuth } from "@/stores/auth";
import { useAniListLogin } from "@/hooks/useAniListLogin";
import { useListSummary } from "@/hooks/useListSummary";
import { useManualSync } from "@/hooks/useManualSync";
import { Avatar, UserLockup } from "@/components/ui/user-lockup";

/** The rail is the state change — one marker slides between items rather than
    each growing its own. See `useRailMarker`. */
const itemClass =
  "relative flex items-center gap-2.75 rounded-lg px-2.5 py-1.75 transition-surface";

/** Icon-only: the gap and the left padding have nothing left to separate. */
const collapsedItemClass = "justify-center gap-0 px-0";

const stateClass = (isActive: boolean) =>
  isActive
    ? "bg-surface-850 text-ink-100"
    : "text-ink-500 hover:bg-surface-850 hover:text-ink-100";

/**
 * Where the accent rail should sit, measured from whichever item is active.
 *
 * Each item used to carry its own `::before` stripe and animate its height, so
 * moving between two of them collapsed one and grew another — the rail
 * blinked out and reappeared elsewhere rather than travelling, which is the one
 * thing a rail is for. `StatusTabs` already slides a measured bar; this is the
 * same trick applied to the nav.
 *
 * Found by `aria-current`, which `NavLink` sets itself, so nothing has to
 * enumerate the items — the set is not fixed (the link-account button only
 * exists in local mode) and a route outside the rail simply yields no marker.
 */
function useRailMarker(deps: unknown[]) {
  const navRef = useRef<HTMLElement>(null);
  const [top, setTop] = useState<number | null>(null);

  const measure = useCallback(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return setTop(null);
    const navBox = nav.getBoundingClientRect();
    const itemBox = active.getBoundingClientRect();
    // The item's centre; the marker is centred on it and sized in rem, so this
    // survives the Windows text-scale setting the app already honours.
    setTop(itemBox.top - navBox.top + itemBox.height / 2);
  }, []);

  useLayoutEffect(measure, [measure, ...deps]);

  // The rail is a fixed width, but its content is not: a wrapped label or a
  // scrollbar appearing changes item heights.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [measure]);

  return { navRef, top };
}

const labelClass = "text-[.8125rem] font-medium tracking-[.005em]";

interface NavItem {
  to: string;
  key: string;
  icon: LucideIcon;
  end?: true;
  /** Which list's entry count to show on the right, if any. */
  count?: "ANIME" | "MANGA";
}

const GROUPS: { label: string; items: NavItem[] }[] = [
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
      // CalendarRange, not CalendarDays (Seasonal's) or CalendarClock (the
      // Bell's) — three calendar surfaces, three distinguishable glyphs.
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
      // The label text *is* the accessible name for all fourteen links, so
      // hiding it would leave a rail of unnamed icons. `title` gives the
      // pointer a tooltip and `aria-label` gives everything else the name.
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

/**
 * "Is my data safe?" answered without a click.
 *
 * A tracker someone opens daily for years accumulates edits made offline, and
 * the only thing worse than losing them is not knowing they are at risk. So the
 * queue length outranks everything: if anything is unsent, that is what the
 * line says, in the accent, regardless of how recently a sync succeeded.
 */
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
  const sync = syncLine(t, mode === "local", pending, syncedAt);

  // Collapsed, the sync line has nowhere to go — but "something is unsent" is
  // the one thing on it that must not disappear with the labels, so it becomes
  // a dot on the avatar. The title carries the sentence the line would have.
  if (collapsed) {
    const body = (
      <span className="relative block" title={`${name} — ${sync.text}`}>
        <Avatar name={name} src={avatar} size="sm" />
        {sync.accent && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-surface-900 bg-accent-500" />
        )}
      </span>
    );
    return (
      <div className="mx-2.5 mb-2 flex justify-center border-b border-surface-800 pb-3 pt-2">
        {viewer ? (
          <NavLink
            to={`/user/${encodeURIComponent(viewer.name)}`}
            aria-label={name}
            className="rounded-lg transition-surface hover:bg-surface-900"
          >
            {body}
          </NavLink>
        ) : (
          body
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
      sub={
        <span
          className={cn(
            "flex items-center gap-1.25 text-2xs leading-snug",
            sync.accent ? "text-accent-400" : "text-ink-600",
          )}
        >
          <span className="size-1.25 shrink-0 rounded-full bg-current" />
          <span className="truncate">{sync.text}</span>
        </span>
      }
    />
  );

  return (
    <div className="mx-2.5 mb-2 border-b border-surface-800 pb-3 pt-2">
      {/* Only a link with an AniList account behind it. The local profile has no
          AniList page to open, so there it stays plain text rather than a link
          that would 404 on a name AniList has never heard of. */}
      {viewer ? (
        <NavLink
          to={`/user/${encodeURIComponent(viewer.name)}`}
          className="-mx-1 block rounded-lg px-1 py-0.5 transition-surface hover:bg-surface-900"
        >
          {lockup}
        </NavLink>
      ) : (
        lockup
      )}
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
  // `?? 0`, matching every list screen. Local mode has no viewer, so `viewer?.id`
  // keyed these queries on `undefined` while `MediaList`, `Dashboard`, `Calendar`
  // and `LocalLibrary` all key theirs on `0` — a different cache entry, never
  // written by anything, so the sidebar's Anime and Manga counts were blank for
  // the whole of account-free mode.
  const { counts, pending, syncedAt } = useListSummary(viewer?.id ?? 0);
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    saveCollapsed(next);
  };
  const { pathname } = useLocation();
  // Re-measured when the route changes and when the item set does — the
  // link-account button exists only in local mode.
  const { navRef, top } = useRailMarker([pathname, mode, collapsed]);

  // If the browser handoff can't start, Settings is where the manual token
  // paste lives — so send the user there rather than failing silently.
  const linkAccount = async () => {
    if (!(await login.start())) navigate("/settings");
  };

  return (
    <nav
      ref={navRef}
      className={cn(
        "rail-wash relative flex shrink-0 flex-col border-r border-hair bg-surface-900 pb-2.5 pt-3",
        // Surface motion, so the plain utility inherits the 140ms
        // `--ease-karasu` default and the reduce-motion rules kill it for
        // free. The shell is flexbox, so `<main>` reflows on its own and this
        // width is the only layout change the collapse makes.
        "transition-[width]",
        collapsed ? "w-14" : "w-52",
      )}
    >
      {/* One rail for the whole nav, travelling between items. Hidden when the
          route is not in it at all — during a page transition, say. */}
      {top !== null && (
        <span
          aria-hidden="true"
          className="absolute left-0 z-10 h-4.5 w-0.75 -translate-y-1/2 rounded-r-[.125rem] bg-accent-500 transition-[top] duration-(--duration-expressive) ease-(--ease-out-expo)"
          style={{ top }}
        />
      )}
      <div className="flex flex-1 flex-col gap-px px-2.5">
        {GROUPS.map((group, i) => (
          <div key={group.label} className="contents">
            {/* Collapsed, the heading is text with no room and no icon to
                stand in for it — a rule keeps the grouping the labels carried,
                and the first group needs neither since nothing precedes it. */}
            {collapsed ? (
              i > 0 && <div className="mx-2 my-2 border-t border-surface-800" />
            ) : (
              <div
                className={cn(
                  "px-2.5 pb-1.75 text-[.5625rem] font-semibold uppercase tracking-[.16em] text-ink-600",
                  // The first label sits under the titlebar's own breathing room;
                  // the later ones have to open the gap themselves.
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
        {/* The chip below *says* when the last sync was; this is the way to
            cause one. Signed-in only — a local list has nothing to sync. */}
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
            <RefreshCw
              className={cn(
                "size-4.25 shrink-0",
                manualSync.syncing && "animate-spin",
              )}
            />
            {!collapsed && <span className={labelClass}>{t("sync.button")}</span>}
          </button>
        )}
        <Account pending={pending} syncedAt={syncedAt} collapsed={collapsed} />
        {/* A local profile is usable on its own, but linking AniList is the
            one action it can't reach from anywhere else in one click. */}
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
        {/* Last, and below the navigation on purpose: it changes the shape of
            the rail rather than going anywhere. */}
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
