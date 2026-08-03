import { NavLink, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  LayoutDashboard,
  Library,
  BookOpen,
  Search,
  CalendarDays,
  BarChart3,
  Sparkles,
  HardDrive,
  Info,
  LogIn,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useAniListLogin } from "@/hooks/useAniListLogin";
import { useListSummary } from "@/hooks/useListSummary";

/** The rail is the state change — an active item grows one, rather than
    swapping colour. Collapsed to zero height it costs nothing to leave on
    every item, which is what lets it animate. */
const itemClass =
  "relative flex items-center gap-2.75 rounded-lg px-2.5 py-1.75 transition-surface " +
  "before:absolute before:left-0 before:top-1/2 before:w-0.75 before:-translate-y-1/2 " +
  "before:rounded-r-[.125rem] before:bg-accent-500 before:transition-[height] before:content-['']";

const stateClass = (isActive: boolean) =>
  isActive
    ? "bg-surface-850 text-ink-100 before:h-4.5"
    : "text-ink-500 before:h-0 hover:bg-surface-850 hover:text-ink-100";

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

function Item({ item, count }: { item: NavItem; count?: number | null }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => cn(itemClass, stateClass(isActive))}
    >
      <Icon className="size-4.25 shrink-0" />
      <span className={labelClass}>{t(item.key)}</span>
      {count != null && (
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

function Account({ pending, syncedAt }: { pending: number; syncedAt: number | null }) {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);

  if (mode === "none") return null;

  const name = viewer?.name ?? t("sync.localProfile");
  const avatar = viewer?.avatar?.large ?? null;
  const sync = syncLine(t, mode === "local", pending, syncedAt);

  return (
    <div className="mx-2.5 mb-2 flex items-center gap-2.5 border-b border-surface-800 pb-3 pt-2">
      {avatar ? (
        <img
          src={avatar}
          alt=""
          className="size-7 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="avatar-wash grid size-7 shrink-0 place-items-center rounded-full bg-surface-800 text-[.6875rem] font-semibold text-ink-300">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium leading-snug text-ink-300">
          {name}
        </span>
        <span
          className={cn(
            "flex items-center gap-1.25 text-2xs leading-snug",
            sync.accent ? "text-accent-400" : "text-ink-600",
          )}
        >
          <span className="size-1.25 shrink-0 rounded-full bg-current" />
          <span className="truncate">{sync.text}</span>
        </span>
      </span>
    </div>
  );
}

export default function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const login = useAniListLogin();
  const { counts, pending, syncedAt } = useListSummary(viewer?.id);

  // If the browser handoff can't start, Settings is where the manual token
  // paste lives — so send the user there rather than failing silently.
  const linkAccount = async () => {
    if (!(await login.start())) navigate("/settings");
  };

  return (
    <nav className="rail-wash flex w-52 shrink-0 flex-col border-r border-hair bg-surface-900 pb-2.5 pt-3">
      <div className="flex flex-1 flex-col gap-px px-2.5">
        {GROUPS.map((group, i) => (
          <div key={group.label} className="contents">
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
            {group.items.map((item) => (
              <Item
                key={item.to}
                item={item}
                count={item.count ? counts[item.count] : undefined}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-px px-2.5">
        <Account pending={pending} syncedAt={syncedAt} />
        {/* A local profile is usable on its own, but linking AniList is the
            one action it can't reach from anywhere else in one click. */}
        {mode === "local" && (
          <button
            type="button"
            onClick={linkAccount}
            className={cn(itemClass, stateClass(false), "text-accent-400")}
          >
            <LogIn className="size-4.25 shrink-0" />
            <span className={labelClass}>{t("nav.linkAccount")}</span>
          </button>
        )}
        <NavLink
          to="/about"
          className={({ isActive }) => cn(itemClass, stateClass(isActive))}
        >
          <Info className="size-4.25 shrink-0" />
          <span className={labelClass}>{t("nav.about")}</span>
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) => cn(itemClass, stateClass(isActive))}
        >
          <Settings className="size-4.25 shrink-0" />
          <span className={labelClass}>{t("nav.settings")}</span>
        </NavLink>
      </div>
    </nav>
  );
}
