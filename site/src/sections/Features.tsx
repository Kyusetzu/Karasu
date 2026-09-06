import type { ReactNode } from "react";
import { Bell, MessageCircle, Package, Tv } from "lucide-react";
import { Screenshot } from "@/components/Screenshot";
import { Eyebrow, Reveal, Section } from "@/components/Section";
import { Card } from "@/components/ui/card";
import { shot } from "@/content/screenshots";
import { cn } from "@/lib/cn";

interface Row {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  bullets?: string[];
  media: ReactNode;
}

/** Two phone screens side by side. */
function PhonePair({ a, b }: { a: string; b: string }) {
  return (
    // `items-start`: the grid would otherwise stretch the first frame to the
    // row's height, which the second frame's top margin makes 2rem taller —
    // an empty band under the first screenshot.
    <div className="mx-auto grid max-w-md grid-cols-2 items-start gap-4">
      <Screenshot shot={shot(a)} sizes="(min-width: 1024px) 14rem, 45vw" />
      <Screenshot shot={shot(b)} sizes="(min-width: 1024px) 14rem, 45vw" className="mt-8" />
    </div>
  );
}

/** A mock of the Discord presence card, in the app's card style. */
function PresenceMock() {
  return (
    <Card className="mx-auto max-w-sm">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-600/25 text-accent-400">
          <Tv className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[.12em] text-ink-600">Playing Karasu</p>
          <p className="truncate text-sm font-semibold text-ink-100">Anime Title</p>
          <p className="text-xs text-ink-500">Episode 4 / 12 · Watching</p>
          <p className="mt-0.5 text-2xs tabular-nums text-ink-600">18:32 left</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <span className="flex-1 rounded-lg border border-surface-700 px-3 py-1.5 text-center text-xs text-ink-300">Get Karasu here</span>
        <span className="flex-1 rounded-lg border border-surface-700 px-3 py-1.5 text-center text-xs text-ink-300">View on AniList</span>
      </div>
    </Card>
  );
}

/** A text panel for a feature with no honest screenshot yet. */
function Panel({ icon: Icon, lines }: { icon: typeof Bell; lines: string[] }) {
  return (
    <Card className="mx-auto max-w-md">
      <span className="grid size-10 place-items-center rounded-full bg-accent-600/25 text-accent-400">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <ul className="mt-4 space-y-2.5">
        {lines.map((l) => (
          <li key={l} className="flex gap-2.5 text-sm text-ink-300">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
            {l}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const ROWS: Row[] = [
  {
    id: "list",
    eyebrow: "The list",
    title: "Your list, in your format.",
    text: "Karasu reads and writes scores in the format your AniList account uses — 100-point, 10-point with or without decimals, five stars or three smileys — in every control, badge and chart.",
    bullets: [
      "Custom lists, advanced scores, tags, notes, dates, rewatches and volumes",
      "Bulk edit across a selection; undo for ten fields of a save",
      "Saved presets, tri-state filters and a typo-tolerant search",
      "Covers or rows, 1 to 40 covers per row, lists that stay quick at any size",
    ],
    media: <Screenshot shot={shot("anime-rows")} />,
  },
  {
    id: "manga",
    eyebrow: "Manga",
    title: "Manga, counted the way AniList counts it.",
    text: "Chapters and volumes both, with a continue-reading row on the overview. On Windows, a chapter open in your browser on MangaDex, MANGA Plus, Comick, Bato.to, MangaFire or Asura Scans is recognised like an episode.",
    media: <Screenshot shot={shot("manga-grid")} />,
  },
  {
    id: "notifications",
    eyebrow: "Notifications",
    title: "Told when it matters, quiet otherwise.",
    text: "New episodes of what you are watching land as desktop notifications. Sequel announcements and on-hold reminders are there to switch on. Your AniList notifications share the same bell, grouped when they arrive in bursts.",
    bullets: [
      "A tray icon with Scrobble now, Sync now and the detection switch",
      "An optional background check, every 15, 30 or 60 minutes",
    ],
    media: <Screenshot shot={shot("bell")} />,
  },
  {
    id: "android",
    eyebrow: "Android",
    title: "On your phone, with the app closed.",
    text: "The Android build is a sideloaded APK with the same list, the same statistics and Jellyfin detection. Four home-screen widgets draw straight from the cached list with no network, and a background job checks AniList's notifications even while Karasu is closed.",
    bullets: ["Share an anilist.co link into Karasu to open it there", "Widgets: Airing Today, Continue Watching, Continue Reading, This Week"],
    media: <PhonePair a="phone-list" b="phone-detail" />,
  },
  {
    id: "discovery",
    eyebrow: "Discovery",
    title: "The season, the calendar, the franchise.",
    text: "A seasonal page with a picker that reaches four years back, a Monday-first calendar with iCal export, a franchise graph you can pan and zoom, recommendations weighted by your own scores, and search across anime, manga, users, characters, staff and studios.",
    media: <Screenshot shot={shot("seasonal")} />,
  },
  {
    id: "social",
    eyebrow: "Activities",
    title: "AniList's social side, read live and stored nowhere.",
    text: "The activity feed, profiles with follow and affinity, forum threads and comments, text posts, likes and replies — AniList's own data, rendered by an AniList client. Nothing social is kept on your machine, and every further page is a button rather than a scroll, so the request budget stays yours.",
    media: <Panel icon={MessageCircle} lines={["Activity feed with likes, replies and a composer", "Profiles, followers, affinity", "Forum threads and comments, with permalinks", "Character, staff and studio pages"]} />,
  },
  {
    id: "discord",
    eyebrow: "Discord",
    title: "Rich Presence, if you want it.",
    text: "Off until you switch it on. When it is on, Discord shows the title, the episode or chapter and a timer, with a button to the project — never your AniList name, and never a title your content filter hides.",
    media: <PresenceMock />,
  },
  {
    id: "yours",
    eyebrow: "Yours to keep",
    title: "No account required, nothing you cannot take with you.",
    text: "Start without an account and keep a local list; connect AniList later and Karasu merges the two. Export to MyAnimeList XML or a JSON backup in either mode; import into a local list. A daily local backup of the database is on by default, and a portable mode keeps everything beside the executable.",
    media: <Panel icon={Package} lines={["Start with a local list, no account", "Connect AniList later; the two lists merge", "Export: MyAnimeList XML or a JSON backup", "Daily local backups; a portable mode beside the exe"]} />,
  },
];

function FeatureRow({ row, flip }: { row: Row; flip: boolean }) {
  return (
    <Reveal as="article" className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={cn(flip && "lg:order-2")}>{row.media}</div>
      <div className={cn(flip && "lg:order-1")}>
        <Eyebrow>{row.eyebrow}</Eyebrow>
        <h3 className="mt-3 font-brand text-2xl font-bold leading-[1.15] tracking-[-.02em] text-ink-100">
          {row.title}
        </h3>
        <p className="mt-4 text-[.9375rem] leading-relaxed text-ink-300">{row.text}</p>
        {row.bullets && (
          <ul className="mt-5 space-y-2">
            {row.bullets.map((b) => (
              <li key={b} className="flex gap-2.5 text-sm text-ink-500">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
                {b}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Reveal>
  );
}

export function Features() {
  return (
    <Section
      id="showcase"
      eyebrow="Features"
      title="Everything else the tracker does."
      lede="Each of these is in the current release, and each has a row in the site's content audit naming the code that makes it true."
    >
      <div className="mt-14 space-y-20 lg:space-y-28">
        {ROWS.map((row, i) => (
          <FeatureRow key={row.id} row={row} flip={i % 2 === 1} />
        ))}
      </div>
    </Section>
  );
}
