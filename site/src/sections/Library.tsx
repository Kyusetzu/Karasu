import { CirclePlay, FolderOpen, Link2, ListChecks, ScanSearch } from "lucide-react";
import { FlowDiagram } from "@/components/FlowDiagram";
import { Screenshot } from "@/components/Screenshot";
import { Reveal, Section } from "@/components/Section";
import { shot } from "@/content/screenshots";

const STEPS = [
  { icon: FolderOpen, title: "Your folder", text: "The one you already have. Up to 20,000 files, six levels deep." },
  { icon: ScanSearch, title: "Karasu scans", text: "Release names are parsed the same way detection parses them." },
  { icon: Link2, title: "Matches your list", text: "Each title reads exact, close, or yours once you have corrected it." },
  { icon: ListChecks, title: "Knows what is next", text: "The first episode past your progress, per title." },
  { icon: CirclePlay, title: "Plays it", text: "In your default player, or in mpv if you point Karasu at it." },
];

const NOTES = [
  ["Corrections stick.", "Re-point a title once; a rescan never undoes it."],
  ["Seasons can be split.", "A folder numbered straight through is split into the AniList entries it spans — Karasu proposes the split, you confirm it."],
  ["Unplaced titles get a suggestion.", "Karasu asks AniList for its best guess, and applies it only when you confirm."],
] as const;

export function Library() {
  return (
    <Section
      id="library"
      eyebrow="Local library"
      title="Your files, matched to your list."
      lede="Point Karasu at the anime you keep on disk and it tells you which episode is next — one click opens it."
    >
      <div className="mt-12">
        <FlowDiagram steps={STEPS} />
      </div>
      <div className="mt-14 grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
        <Reveal>
          <Screenshot shot={shot("library")} />
        </Reveal>
        <div>
          <ul className="space-y-5">
            {NOTES.map(([title, text]) => (
              <li key={title}>
                <p className="font-brand text-[.9375rem] font-semibold text-ink-100">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-500">{text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 rounded-lg border border-hair bg-surface-900 px-4 py-3 text-sm leading-relaxed text-ink-300">
            Karasu never downloads anything. The library is the folder you already have; how the files got there
            is not the app's business.
          </p>
        </div>
      </div>
    </Section>
  );
}
