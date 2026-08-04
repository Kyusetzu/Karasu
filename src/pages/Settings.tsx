import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  EyeOff,
  FolderOpen,
  Palette,
  Plug,
  Radar,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountSection } from "./settings/AccountPane";
import { AppearanceSection } from "./settings/AppearancePane";
import { ScrobbleSection, JellyfinSection } from "./settings/DetectionPane";
import { LibrarySection } from "./settings/LibraryPane";
import { ContentSection } from "./settings/ContentPane";
import { DiscordSection } from "./settings/IntegrationsPane";
import { AdvancedSection, PortableSection } from "./settings/AdvancedPane";
/**
 * The seven panes, in the order they are worth reading.
 *
 * They are keyed by a URL parameter rather than component state because the
 * screen re-mounts on every navigation (the router keys the pane on the path),
 * so state would drop the user back on Account each time — and because a
 * dead-end elsewhere in the app can then point at the exact pane that fixes
 * it, the way the empty local library points at Library.
 */
const PANES = [
  { id: "account", icon: User, sections: [AccountSection] },
  { id: "appearance", icon: Palette, sections: [AppearanceSection] },
  {
    id: "detection",
    icon: Radar,
    sections: [ScrobbleSection, JellyfinSection],
  },
  { id: "library", icon: FolderOpen, sections: [LibrarySection] },
  { id: "content", icon: EyeOff, sections: [ContentSection] },
  { id: "integrations", icon: Plug, sections: [DiscordSection] },
  {
    id: "advanced",
    icon: SlidersHorizontal,
    sections: [AdvancedSection, PortableSection],
  },
] as const;

type PaneId = (typeof PANES)[number]["id"];

export default function Settings() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get("pane");
  const active =
    (PANES.find((p) => p.id === requested)?.id as PaneId | undefined) ??
    "account";
  const pane = PANES.find((p) => p.id === active)!;

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-hair p-3">
        <h1 className="px-2.5 pb-2 pt-1 text-2xs font-semibold uppercase tracking-[.16em] text-ink-600">
          {t("settings.title")}
        </h1>
        {PANES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={id === active ? "page" : undefined}
            onClick={() => setParams(id === "account" ? {} : { pane: id })}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-1.75 text-left text-[.8125rem] transition-surface",
              id === active
                ? "bg-surface-850 text-ink-100"
                : "text-ink-500 hover:bg-surface-850 hover:text-ink-100",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {t(`settings.pane_${id}`)}
          </button>
        ))}
      </nav>

      {/* Keyed on the pane so switching replays `settle` — otherwise a pane
          swap in place is indistinguishable from the page not reacting. */}
      <div key={active} className="min-w-0 flex-1 animate-settle overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-8">
          {pane.sections.map((Section, i) => (
            <Section key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
