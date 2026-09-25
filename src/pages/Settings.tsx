import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { AccountSection, DefaultsSection } from "./settings/AccountPane";
import {
  AniListListOptionsSection,
  AniListNotificationsSection,
  AniListProfileSection,
  AniListSignedOutNote,
  NotificationScheduleSection,
} from "./settings/AniListPane";
import { AppearanceSection } from "./settings/AppearancePane";
import {
  ScrobbleSection,
  MediaSessionSection,
  MpvSection,
  JellyfinSection,
  DetectionCorrectionsSection,
} from "./settings/DetectionPane";
import { LibrarySection, LibrarySplitsSection } from "./settings/LibraryPane";
import { ContentSection } from "./settings/ContentPane";
import { DiscordSection } from "./settings/IntegrationsPane";
import {
  BackupSection,
  ExportSection,
  ImportSection,
  PortableSection,
  LogSection,
  QueueSection,
  RescaleSection,
  SystemSection,
  UpdatesSection,
} from "./settings/AdvancedPane";
import { DangerNote } from "./settings/shared";
import { usePhoneShell } from "@/hooks/usePhoneShell";
import { isAndroid, usePlatform } from "@/stores/platform";
import { Button } from "@/components/ui/button";

/** The panes, keyed by URL parameter so deep links land; keep the ids, since renaming one breaks every deep link. */
const PANES = [
  { id: "account", icon: User, sections: [AccountSection, DefaultsSection] },
  // Right after the account: these are that account's own settings, and some are ones Karasu overrides.
  {
    id: "anilist",
    icon: Globe,
    sections: [
      // The only one that renders signed out; the rest hide themselves, which left this pane blank.
      AniListSignedOutNote,
      AniListProfileSection,
      AniListListOptionsSection,
      AniListNotificationsSection,
      NotificationScheduleSection,
    ],
  },
  // Content joins Appearance instead of its own pane; it answers the same question, what do I see.
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
  { id: "library", icon: FolderOpen, sections: [LibrarySection, LibrarySplitsSection] },
  // Everything about Karasu as a program on this desktop.
  {
    id: "desktop",
    icon: Monitor,
    sections: [SystemSection, UpdatesSection, DiscordSection],
  },
  // Moving a list in or out is not advanced, it is the point; the queue first, being the live state.
  {
    id: "data",
    icon: Database,
    sections: [QueueSection, ExportSection, ImportSection, BackupSection],
  },
  // What is left is what the warning is about: rescoring, the detection log, and moving the database.
  {
    id: "advanced",
    icon: SlidersHorizontal,
    danger: true,
    sections: [AdvancedWarning, RescaleSection, LogSection, PortableSection],
  },
] as const;

/** A pane named in `lib/settingsPanes` with no entry above is a type error here, so the two lists cannot drift. */
type _EveryPaneIsRendered = Exclude<PaneId, (typeof PANES)[number]["id"]> extends never
  ? true
  : never;
const _panesAreComplete: _EveryPaneIsRendered = true;

/** Panes Android hides, keyed on the platform rather than width: these are capabilities, not shell shape. */
const ANDROID_HIDDEN_PANES: ReadonlySet<PaneId> = new Set(["library", "desktop"] as const);
/** Sections Android hides, by component identity so a rename breaks the build instead of un-hiding one. */
const ANDROID_HIDDEN_SECTIONS: ReadonlySet<unknown> = new Set([PortableSection]);
/** Sections Android shows elsewhere: the desktop pane is hidden there, but the updater has its channel and switch. */
const ANDROID_EXTRA_SECTIONS: Partial<Record<PaneId, readonly (() => React.JSX.Element)[]>> = {
  account: [UpdatesSection],
};

/** Greyed on Android, not hidden; keep ScrobbleSection out, since the scrobbler runs there and reads its switches. */
const ANDROID_DESKTOP_ONLY: ReadonlySet<unknown> = new Set([
  MediaSessionSection,
  MpvSection,
]);

function DesktopOnly({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div aria-disabled className="relative">
      <span className="absolute right-0 top-0 z-10 rounded-full bg-surface-800 px-2 py-0.5 text-[.625rem] font-medium text-ink-500">
        {t("settings.desktopOnly")}
      </span>
      <div className="pointer-events-none select-none opacity-45">{children}</div>
    </div>
  );
}

function AdvancedWarning() {
  const { t } = useTranslation();
  return <DangerNote title={t("settings.dangerTitle")}>{t("settings.dangerBody")}</DangerNote>;
}

export default function Settings() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const phone = usePhoneShell();
  const android = isAndroid(usePlatform((s) => s.info));
  const rawPane = params.get("pane");
  const active = resolvePane(rawPane);
  void _panesAreComplete;

  const panes = android ? PANES.filter((p) => !ANDROID_HIDDEN_PANES.has(p.id)) : PANES;
  // A deep link can name a pane Android hides; falling back beats rendering a blank one.
  const pane = panes.find((p) => p.id === active) ?? panes[0];
  const sections = android
    ? [...pane.sections, ...(ANDROID_EXTRA_SECTIONS[pane.id] ?? [])]
        .filter((S) => !ANDROID_HIDDEN_SECTIONS.has(S))
        // The working sections above the greyed desktop ones.
        .sort(
          (a, b) => Number(ANDROID_DESKTOP_ONLY.has(a)) - Number(ANDROID_DESKTOP_ONLY.has(b)),
        )
    : pane.sections;
  // The badge is platform-keyed in both layouts; an Android tablet at desktop width still has no SMTC.
  const wrap = (Section: (typeof sections)[number], i: number) =>
    android && ANDROID_DESKTOP_ONLY.has(Section) ? (
      <DesktopOnly key={i}>
        <Section />
      </DesktopOnly>
    ) : (
      <Section key={i} />
    );

  /** Master-detail on the phone, keyed on width alone; `?pane=` stays the source of truth, and no param means the list. */
  if (phone) {
    const listShown = rawPane === null || !panes.some((p) => p.id === active);
    if (listShown) {
      return (
        <div className="p-4">
          <h1 className="px-1 pb-3 pt-1 text-sm font-semibold text-ink-100">
            {t("settings.title")}
          </h1>
          <div className="space-y-0.5">
            {panes.map((p) => {
              const Icon = p.icon;
              const danger = "danger" in p && p.danger;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setParams({ pane: p.id })}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-panel px-3 py-3 text-left text-sm transition-surface",
                    danger
                      ? "text-danger/85 hover:bg-danger/10"
                      : "text-ink-100 hover:bg-surface-850",
                  )}
                >
                  <Icon className="size-4.5 shrink-0" />
                  <span className="flex-1">{t(`settings.pane_${p.id}`)}</span>
                  {danger && <AlertTriangle aria-hidden className="size-3.5 shrink-0" />}
                  <ChevronRight className="size-4 shrink-0 text-ink-600" />
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    return (
      <div key={active} className="animate-settle">
        <div className="mx-auto max-w-2xl space-y-6 p-4">
          <Button variant="ghost" size="sm" onClick={() => setParams({})}>
            <ChevronLeft className="size-4" />
            {t("settings.title")}
          </Button>
          {sections.map(wrap)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-hair p-3">
        <h1 className="px-2.5 pb-2 pt-1 text-2xs font-semibold uppercase tracking-[.16em] text-ink-600">
          {t("settings.title")}
        </h1>
        {panes.map((p) => {
          const Icon = p.icon;
          const danger = "danger" in p && p.danger;
          return (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === active ? "page" : undefined}
              onClick={() => setParams(p.id === "account" ? {} : { pane: p.id })}
              className={cn(
                "flex items-center gap-2.5 rounded-control px-2.5 py-1.75 text-left text-ui transition-surface",
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
              {/* Only a flag here; explaining is the job of the pane's own note. */}
              {danger && <AlertTriangle aria-hidden className="size-3.25 shrink-0" />}
            </button>
          );
        })}
      </nav>

      {/* Keyed on the pane so switching replays `settle`; a swap in place looks like the page not reacting. */}
      <div key={active} className="min-w-0 flex-1 animate-settle overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-8">{sections.map(wrap)}</div>
      </div>
    </div>
  );
}
