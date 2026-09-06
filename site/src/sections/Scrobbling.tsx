import { CloudUpload, Hash, Play, Radar, ScanSearch, SlidersHorizontal } from "lucide-react";
import { FlowDiagram } from "@/components/FlowDiagram";
import { Reveal, Section } from "@/components/Section";
import { Card, CardTitle } from "@/components/ui/card";
import { staggerDelay } from "@/lib/motion";

const STEPS = [
  { icon: Play, title: "You press play", text: "In a player, a browser tab, or on your Jellyfin server." },
  { icon: Radar, title: "Karasu notices", text: "Media sessions, window titles, an mpv pipe, or Jellyfin's session list." },
  { icon: ScanSearch, title: "It reads the title", text: "A release-name parser and a fuzzy matcher against your list." },
  { icon: Hash, title: "And the episode", text: "Season splits and redirects included, from the community's relations data." },
  { icon: SlidersHorizontal, title: "Your settings apply", text: "Threshold, confirmation, corrections and offsets." },
  { icon: CloudUpload, title: "AniList is updated", text: "Progress moves forward; a receipt with an undo lands in the app." },
];

const RULES = [
  {
    title: "After two thirds of the runtime",
    text: "That is the default. Set a number of minutes instead, or ask for the confirmation toast and decide per episode.",
  },
  {
    title: "A pause defers, it does not cancel",
    text: "Nothing is written while the player is paused; resume, and the next check is due.",
  },
  {
    title: "Forward only, and re-checked",
    text: "Progress can only go up, and your list is read again right before the write so an edit you made meanwhile wins.",
  },
  {
    title: "An unclear season is yours to settle",
    text: "When a source reports a season Karasu cannot match, it stops and offers the sequels — it does not guess.",
  },
];

const SOURCES = {
  Players: ["mpv", "VLC", "MPC-HC", "MPC-BE", "PotPlayer", "SMPlayer"],
  Browsers: ["Chrome", "Firefox", "Edge", "Brave", "Opera", "Vivaldi", "Zen", "LibreWolf", "Waterfox", "Helium"],
  "Streaming sites": ["Crunchyroll", "ADN", "Netflix"],
  "Manga sites": ["MangaDex", "MANGA Plus", "Comick", "Bato.to", "MangaFire", "Asura Scans"],
  Servers: ["Jellyfin"],
} as const;

export function Scrobbling() {
  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title="From play to updated, without you."
      lede="Six steps, all of them Karasu's. The only one you take is the first."
    >
      <div className="mt-12">
        <FlowDiagram steps={STEPS} />
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {RULES.map((r, i) => (
          <Reveal key={r.title} delay={staggerDelay(i)}>
            <Card className="h-full">
              <CardTitle className="text-[.9375rem]">{r.title}</CardTitle>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{r.text}</p>
            </Card>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-14">
        <p className="text-2xs font-semibold uppercase tracking-[.16em] text-ink-600">What it recognises</p>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,auto)]">
          {Object.entries(SOURCES).map(([group, items]) => (
            <div key={group}>
              <dt className="text-xs font-medium text-ink-500">{group}</dt>
              <dd className="mt-2 flex flex-wrap gap-1.5">
                {items.map((s) => (
                  <span
                    key={s}
                    className="rounded-[.625rem] border border-surface-800 bg-surface-850 px-2 py-0.5 text-2xs text-ink-300"
                  >
                    {s}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 max-w-2xl text-xs leading-relaxed text-ink-600">
          Windows has all of these. Linux reads media sessions, mpv and Jellyfin, and no window titles; Android
          reads Jellyfin. The{" "}
          <a href="#platforms" className="text-ink-500 underline decoration-surface-600 underline-offset-2 hover:text-ink-300">
            Platforms
          </a>{" "}
          section has the whole table.
        </p>
      </Reveal>
    </Section>
  );
}
