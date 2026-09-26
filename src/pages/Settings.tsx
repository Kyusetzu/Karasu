import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Database,
  FolderOpen,
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
import { DangerNote, GroupLabel } from "./settings/shared";
import { useAuth } from "@/stores/auth";
import { usePhoneShell } from "@/hooks/usePhoneShell";
import { isAndroid, usePlatform } from "@/stores/platform";
import { Button } from "@/components/ui/button";
import { CardHeadingLevel } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";

/** The panes, keyed by URL parameter so deep links land; keep the ids, since renaming one breaks every deep link. */
const PANES = [
  // The sign-in, then what Karasu keeps and what lives on the AniList account, so it is clear what another client sees.
  {
    id: "account",
    icon: User,
    sections: [
      AccountSection,
      KarasuGroup,
      DefaultsSection,
      NotificationScheduleSection,
      AniListGroup,
      AniListProfileSection,
      AniListListOptionsSection,
      AniListNotificationsSection,
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
/** Sections Android shows elsewhere, after an anchor: the desktop pane is hidden there, but the updater is Karasu's. */
const ANDROID_EXTRA_SECTIONS: Partial<Record<PaneId, { after: unknown; sections: readonly (() => React.JSX.Element)[] }>> = {
  account: { after: NotificationScheduleSection, sections: [UpdatesSection] },
};

/** Greyed on Android, not hidden; keep ScrobbleSection out, since the scrobbler runs there and reads its switches. */
const ANDROID_DESKTOP_ONLY: ReadonlySet<unknown> = new Set([
  MediaSessionSection,
  MpvSection,
]);

function DesktopOnly({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    // The card title keeps the chip's width free, so a long title wraps beneath it instead of running under it.
    <div aria-disabled className="relative [&_:is(h2,h3)]:pr-24">
      {/* Inside the card's padding, centred on its title line, so it reads as the title's caveat rather than a tab. */}
      <Chip tone="muted" size="xs" className="absolute right-5 top-6 z-10">
        {t("settings.desktopOnly")}
      </Chip>
      <div className="pointer-events-none select-none opacity-45">{children}</div>
    </div>
  );
}

function KarasuGroup() {
  const { t } = useTranslation();
  return <GroupLabel>{t("settings.groupKarasu")}</GroupLabel>;
}

/** Signed out, the AniList cards hide themselves, so their heading goes with them. */
function AniListGroup() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  if (!viewer) return null;
  return <GroupLabel>{t("settings.groupAniList")}</GroupLabel>;
}

/** The section components that head a group rather than hold settings. */
const GROUP_LABELS: ReadonlySet<unknown> = new Set([KarasuGroup, AniListGroup]);

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
  const extra = android ? ANDROID_EXTRA_SECTIONS[pane.id] : undefined;
  const withExtra: readonly (typeof pane.sections)[number][] = extra
    ? pane.sections.flatMap((S) => (S === extra.after ? [S, ...extra.sections] : [S]))
    : pane.sections;
  const sections = android
    ? withExtra
        .filter((S) => !ANDROID_HIDDEN_SECTIONS.has(S))
        // The working sections above the greyed desktop ones.
        .sort(
          (a, b) => Number(ANDROID_DESKTOP_ONLY.has(a)) - Number(ANDROID_DESKTOP_ONLY.has(b)),
        )
    : withExtra;
  // The badge is platform-keyed in both layouts; an Android tablet at desktop width still has no SMTC.
  const wrap = (Section: (typeof sections)[number], i: number) =>
    android && ANDROID_DESKTOP_ONLY.has(Section) ? (
      <DesktopOnly key={i}>
        <Section />
      </DesktopOnly>
    ) : (
      <Section key={i} />
    );
  // Cards after a group heading sit one level below it, so a screen reader hears the groups as groups.
  const groupAt = sections.findIndex((S) => GROUP_LABELS.has(S));
  const rendered = sections.map((S, i) =>
    groupAt !== -1 && i > groupAt && !GROUP_LABELS.has(S) ? (
      <CardHeadingLevel.Provider key={i} value={3}>
        {wrap(S, i)}
      </CardHeadingLevel.Provider>
    ) : (
      wrap(S, i)
    ),
  );
  // Android moves the updater into the account pane and drops the data location, and the list says so.
  const paneHint = (id: PaneId) =>
    android && id === "account"
      ? t("settings.paneHintAndroid_account")
      : android && id === "advanced"
        ? t("settings.paneHintAndroid_advanced")
        : t(`settings.paneHint_${id}`);

  /** Master-detail on the phone, keyed on width alone; `?pane=` stays the source of truth, and no param means the list. */
  if (phone) {
    const listShown = rawPane === null || !panes.some((p) => p.id === active);
    if (listShown) {
      return (
        <div className="space-y-4 p-4">
          <h1 className="px-1 pt-2 text-title font-bold">{t("settings.title")}</h1>
          {/* One line of what each pane holds, so the list answers where a setting is before a pane is opened. */}
          <div className="overflow-hidden rounded-panel border border-hair bg-surface-900 [&>*+*]:border-t [&>*+*]:border-hair">
            {panes.map((p) => {
              const Icon = p.icon;
              const danger = "danger" in p && p.danger;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setParams({ pane: p.id })}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-surface hover:bg-surface-850 focus-inset"
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full border tint-fill",
                      danger ? "tint-danger text-danger" : "tint-accent text-accent-400",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm font-medium", danger ? "text-danger" : "text-ink-100")}>
                      {t(`settings.pane_${p.id}`)}
                    </span>
                    <span className="block truncate text-xs text-ink-600">{paneHint(p.id)}</span>
                  </span>
                  {danger && <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-danger" />}
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
        <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setParams({})}>
            <ChevronLeft className="size-4" />
            {t("settings.title")}
          </Button>
          {rendered}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-hair p-3">
        <h1 className="px-2.5 pb-2 pt-1 text-2xs font-semibold uppercase tracking-eyebrow text-ink-600">
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
              {danger && <AlertTriangle aria-hidden className="size-3.5 shrink-0" />}
            </button>
          );
        })}
      </nav>

      {/* Keyed on the pane so switching replays `settle`; a swap in place looks like the page not reacting. */}
      <div key={active} className="min-w-0 flex-1 animate-settle overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">{rendered}</div>
      </div>
    </div>
  );
}
