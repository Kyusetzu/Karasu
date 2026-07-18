import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Library,
  BookOpen,
  Search,
  CalendarDays,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", key: "nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/list", key: "nav.list", icon: Library },
  { to: "/manga", key: "nav.manga", icon: BookOpen },
  { to: "/search", key: "nav.search", icon: Search },
  { to: "/seasonal", key: "nav.seasonal", icon: CalendarDays },
] as const;

export default function Sidebar() {
  const { t } = useTranslation();
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
            <Icon size={18} />
            {t(key)}
          </NavLink>
        ))}
      </div>
      <div className="px-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-300 transition-colors",
              "hover:bg-surface-800 hover:text-ink-100",
              isActive && "bg-surface-800 text-accent-400",
            )
          }
        >
          <Settings size={18} />
          {t("nav.settings")}
        </NavLink>
      </div>
    </nav>
  );
}
