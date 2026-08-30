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
  { id: "account", icon: User, sections: [AccountSection, DefaultsSection] },
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
      NotificationScheduleSection,
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
  { id: "library", icon: FolderOpen, sections: [LibrarySection, LibrarySplitsSection] },
  // New. Everything about Karasu as a program on this desktop — which the old
  // arrangement scattered between "Advanced" and a one-toggle "Integrations".
  {
    id: "desktop",
    icon: Monitor,
    sections: [SystemSection, UpdatesSection, DiscordSection],
  },
  // New. Moving a list in or out is not an advanced operation, it is the thing
  // people come to a tracker's settings to do.
  // The queue first: it is the live state, the others are file operations.
  {
    id: "data",
    icon: Database,
    sections: [QueueSection, ExportSection, ImportSection, BackupSection],
  },
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

/**
 * What Android hides, by identity rather than by file.
 *
 * Whole panes: the local library scanner cannot exist under scoped storage,
 * and everything in Desktop — autostart, the updater, Discord IPC — is
 * desktop by definition. Sections: SMTC/MPRIS and the mpv pipe are detection
 * sources a phone has not got (Jellyfin is the whole of detection there, per
 * the ROADMAP), and portable mode is an exe-relative idea.
 *
 * Keyed on the *platform*, not `usePhoneShell`: these are capabilities, and
 * they were width-keyed for a while — which hid the Library and Desktop panes
 * from anyone who narrowed a desktop window, and would have handed an Android
 * tablet (≥768px takes the desktop layout) live SMTC/mpv controls. Only the
 * master-detail layout below stays width-keyed.
 *
 * Component identity, not a string list, so a rename breaks the build here
 * instead of silently un-hiding a pane.
 */
const ANDROID_HIDDEN_PANES: ReadonlySet<PaneId> = new Set(["library", "desktop"] as const);
const ANDROID_HIDDEN_SECTIONS: ReadonlySet<unknown> = new Set([PortableSection]);

/**
 * Desktop-only detection machinery, greyed rather than hidden on Android —
 * the user's call: seeing what the desktop can do explains what the phone
 * deliberately does not, where silent absence reads as a missing feature.
 * Jellyfin and the corrections come first there, being the parts that work.
 */
const ANDROID_DESKTOP_ONLY: ReadonlySet<unknown> = new Set([
  ScrobbleSection,
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
  // A deep link can name a pane Android hides; falling back beats rendering
  // a blank one.
  const pane = panes.find((p) => p.id === active) ?? panes[0];
  const sections = android
    ? [...pane.sections]
        .filter((S) => !ANDROID_HIDDEN_SECTIONS.has(S))
        // The working sections above the greyed desktop ones.
        .sort(
          (a, b) => Number(ANDROID_DESKTOP_ONLY.has(a)) - Number(ANDROID_DESKTOP_ONLY.has(b)),
        )
    : pane.sections;
  // The badge follows the platform into *both* layout branches — an Android
  // tablet takes the desktop layout and still has no SMTC to configure.
  const wrap = (Section: (typeof sections)[number], i: number) =>
    android && ANDROID_DESKTOP_ONLY.has(Section) ? (
      <DesktopOnly key={i}>
        <Section />
      </DesktopOnly>
    ) : (
      <Section key={i} />
    );

  /**
   * Master-detail on the phone: the pane *list* first, a chosen pane
   * full-width with a way back — the desktop's permanent sidebar squeezed
   * both halves into columns neither could afford. `?pane=` stays the one
   * source of truth, so deep links land exactly as they do on desktop; the
   * only difference is that no param means "show the list" here where the
   * desktop reads it as Account.
   */
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
                    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-surface",
                    danger
                      ? "text-danger/85 hover:bg-danger/10"
                      : "text-ink-200 hover:bg-surface-850",
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
        <div className="mx-auto max-w-2xl space-y-6 p-8">{sections.map(wrap)}</div>
      </div>
    </div>
  );
}
