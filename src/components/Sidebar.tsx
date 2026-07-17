import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Library,
  Search,
  CalendarDays,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Übersicht", icon: LayoutDashboard, end: true },
  { to: "/list", label: "Meine Liste", icon: Library },
  { to: "/search", label: "Suche", icon: Search },
  { to: "/seasonal", label: "Saison", icon: CalendarDays },
] as const;

export default function Sidebar() {
  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-surface-800 bg-surface-900 py-3">
      <div className="flex flex-1 flex-col gap-1 px-3">
        {items.map(({ to, label, icon: Icon, ...rest }) => (
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
            {label}
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
          Einstellungen
        </NavLink>
      </div>
    </nav>
  );
}
