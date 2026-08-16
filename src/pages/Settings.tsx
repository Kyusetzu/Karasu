import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Database,
  FolderOpen,
  Globe,
  Monitor,
  Palette,
  Radar,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolvePane, type PaneId } from "@/lib/settingsPanes";
import { AccountSection } from "./settings/AccountPane";
import {
  AniListListOptionsSection,
  AniListNotificationsSection,
  AniListProfileSection,
  AniListSignedOutNote,
} from "./settings/AniListPane";
import { AppearanceSection } from "./settings/AppearancePane";
import {
  ScrobbleSection,
  MediaSessionSection,
  MpvSection,
  JellyfinSection,
  DetectionCorrectionsSection,
} from "./settings/DetectionPane";
import { LibrarySection } from "./settings/LibraryPane";
import { ContentSection } from "./settings/ContentPane";
import { DiscordSection } from "./settings/IntegrationsPane";
import {
  BackupSection,
  ExportSection,
  ImportSection,
  PortableSection,
  LogSection,
  RescaleSection,
  SystemSection,
  UpdatesSection,
} from "./settings/AdvancedPane";
import { DangerNote } from "./settings/shared";

/**
 * The eight panes, in the order they are worth reading.
 *
 * They are keyed by a URL parameter rather than component state because the
 * screen re-mounts on every navigation (the router keys the pane on the path),
 * so state would drop the user back on Account each time — and because a
 * dead-end elsewhere in the app can then point at the exact pane that fixes
 * it, the way the empty local library points at Library.
 *
 * Ids are kept wherever a pane survived a reshuffle. Renaming `detection` for
 * cosmetics would break every deep link at no gain; `ALIASES` below covers the
 * two that genuinely went away.
 */
const PANES = [
  { id: "account", icon: User, sections: [AccountSection] },
  // Second, right after the account it belongs to: these are that account's own
  // settings rather than Karasu's, and four of them are ones Karasu overrides —
  // which is a thing to find while thinking about the account, not later.
  {
    id: "anilist",
    icon: Globe,
    sections: [
      // First, and the only one that renders without an account — the three
      // below hide themselves, which left this pane blank.
      AniListSignedOutNote,
      AniListProfileSection,
      AniListListOptionsSection,
      AniListNotificationsSection,
    ],
  },
  // Content joins Appearance rather than holding a pane of its own. It was one
  // slider, and it belongs to the same question the rest of this pane answers:
  // what do I see.
  { id: "appearance", icon: Palette, sections: [AppearanceSection, ContentSection] },
  {
    id: "detection",
    icon: Radar,
    sections: [
      ScrobbleSection,
      MediaSessionSection,
      MpvSection,
      JellyfinSection,
      DetectionCorrectionsSection,
    ],
  },
  { id: "library", icon: FolderOpen, sections: [LibrarySection] },
  // New. Everything about Karasu as a program on this desktop — which the old
  // arrangement scattered between "Advanced" and a one-toggle "Integrations".
  {
    id: "desktop",
    icon: Monitor,
    sections: [SystemSection, UpdatesSection, DiscordSection],
  },
  // New. Moving a list in or out is not an advanced operation, it is the thing
  // people come to a tracker's settings to do.
  { id: "data", icon: Database, sections: [ExportSection, ImportSection, BackupSection] },
  // What is left is what the warning is actually about: rewriting every score,
  // reading a log that records what detection saw, and moving the database.
  {
    id: "advanced",
    icon: SlidersHorizontal,
    danger: true,
    sections: [AdvancedWarning, RescaleSection, LogSection, PortableSection],
  },
] as const;

/**
 * A pane named in `lib/settingsPanes` with no entry above is a type error here.
 *
 * The ids live there because `resolvePane` and its aliases are worth testing on
 * their own, which splits the list from the components it selects. This is the
 * seam that keeps the two halves honest: adding an id without a pane, or
 * renaming one on one side only, fails the build rather than rendering nothing.
 */
type _EveryPaneIsRendered = Exclude<PaneId, (typeof PANES)[number]["id"]> extends never
  ? true
  : never;
const _panesAreComplete: _EveryPaneIsRendered = true;

function AdvancedWarning() {
  const { t } = useTranslation();
  return <DangerNote title={t("settings.dangerTitle")}>{t("settings.dangerBody")}</DangerNote>;
}

export default function Settings() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const active = resolvePane(params.get("pane"));
  const pane = PANES.find((p) => p.id === active)!;
  void _panesAreComplete;

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-hair p-3">
        <h1 className="px-2.5 pb-2 pt-1 text-2xs font-semibold uppercase tracking-[.16em] text-ink-600">
          {t("settings.title")}
        </h1>
        {PANES.map((p) => {
          const Icon = p.icon;
          const danger = "danger" in p && p.danger;
          return (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === active ? "page" : undefined}
              onClick={() => setParams(p.id === "account" ? {} : { pane: p.id })}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.75 text-left text-[.8125rem] transition-surface",
                p.id === active
                  ? danger
                    ? "bg-danger/12 text-danger"
                    : "bg-surface-850 text-ink-100"
                  : danger
                    ? "text-danger/75 hover:bg-danger/10 hover:text-danger"
                    : "text-ink-500 hover:bg-surface-850 hover:text-ink-100",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{t(`settings.pane_${p.id}`)}</span>
              {/* The marking the pane itself repeats in full. On the button it
                  is only a flag — enough to make someone pause before clicking,
                  not enough to explain, which is the note's job. */}
              {danger && <AlertTriangle aria-hidden className="size-3.25 shrink-0" />}
            </button>
          );
        })}
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
