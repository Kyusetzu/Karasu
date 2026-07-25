import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Library,
  BookOpen,
  Search,
  CalendarDays,
  BarChart3,
  HardDrive,
  Info,
  LogIn,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useAniListLogin } from "@/hooks/useAniListLogin";

const bottomClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-300 transition-colors",
    "hover:bg-surface-800 hover:text-ink-100",
    isActive && "bg-surface-800 text-accent-400",
  );

const items = [
  { to: "/", key: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/list", key: "nav.list", icon: Library },
  { to: "/manga", key: "nav.manga", icon: BookOpen },
  { to: "/search", key: "nav.search", icon: Search },
  { to: "/seasonal", key: "nav.seasonal", icon: CalendarDays },
  { to: "/stats", key: "nav.stats", icon: BarChart3 },
  { to: "/library", key: "nav.library", icon: HardDrive },
] as const;

export default function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mode = useAuth((s) => s.mode);
  const login = useAniListLogin();

  // If the browser handoff can't start, Settings is where the manual token
  // paste lives — so send the user there rather than failing silently.
  const linkAccount = async () => {
    if (!(await login.start())) navigate("/settings");
  };

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-surface-800 bg-surface-900 py-3">
      <div className="flex flex-1 flex-col gap-1 px-3">
        {items.map(({ to, key, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={"end" in rest}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-300 transition-colors",
                "hover:bg-surface-800 hover:text-ink-100",
                isActive && "bg-surface-800 text-accent-400",
              )
            }
          >
            <Icon className="size-4.5" />
            {t(key)}
          </NavLink>
        ))}
      </div>
      <div className="flex flex-col gap-1 px-3">
        {/* A local profile is usable on its own, but linking AniList is the
            one action it can't reach from anywhere else in one click. */}
        {mode === "local" && (
          <button
            type="button"
            onClick={linkAccount}
            className={cn(bottomClass({ isActive: false }), "text-accent-400")}
          >
            <LogIn className="size-4.5" />
            {t("nav.linkAccount")}
          </button>
        )}
        <NavLink to="/about" className={bottomClass}>
          <Info className="size-4.5" />
          {t("nav.about")}
        </NavLink>
        <NavLink to="/settings" className={bottomClass}>
          <Settings className="size-4.5" />
          {t("nav.settings")}
        </NavLink>
      </div>
    </nav>
  );
}
