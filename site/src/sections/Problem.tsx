import { Check, X } from "lucide-react";
import { Reveal, Section } from "@/components/Section";
import { staggerDelay } from "@/lib/motion";

const CHORES = [
  "Watch an episode.",
  "Remember to open AniList.",
  "Find the title in your list.",
  "Fix the number, save, close the tab.",
  "Do it again for the manga tab.",
];

const ANSWERS = [
  {
    title: "It sees what you play.",
    text: "Your system's media sessions, your player or browser window, an mpv pipe, or your own Jellyfin server — Karasu reads whichever is there.",
  },
  {
    title: "It only ever moves forward.",
    text: "A scrobble can raise your progress, never lower it, and it re-checks your list a moment before it writes.",
  },
  {
    title: "It asks if you want it to.",
    text: "Turn on the confirmation toast and every update waits for one click on the desktop.",
  },
];

export function Problem() {
  return (
    <Section
      id="features"
      eyebrow="The problem"
      title="Keeping a list current is a chore. Karasu does the chore."
      lede="Tracking is five small steps you repeat for every episode and every chapter. Karasu turns them into none."
    >
      <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:gap-12">
        <Reveal className="inset-well rounded-[.875rem] p-6">
          <p className="text-2xs font-semibold uppercase tracking-[.16em] text-ink-600">By hand</p>
          <ol className="mt-4 space-y-3">
            {CHORES.map((c, i) => (
              <li key={c} className="flex items-center gap-3 text-[.9375rem] text-ink-500">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-surface-700 text-2xs tabular-nums text-ink-600">
                  {i + 1}
                </span>
                <span className="line-through decoration-surface-600">{c}</span>
                <X className="ml-auto size-3.5 shrink-0 text-ink-600" aria-hidden="true" />
              </li>
            ))}
          </ol>
        </Reveal>
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[.16em] text-accent-400">With Karasu</p>
          <ul className="mt-4 space-y-5">
            {ANSWERS.map((a, i) => (
              <Reveal as="li" key={a.title} delay={staggerDelay(i)} className="flex gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                  <Check className="size-3.5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-brand text-[.9375rem] font-semibold text-ink-100">{a.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">{a.text}</p>
                </div>
              </Reveal>
            ))}
          </ul>
          <p className="mt-6 text-xs leading-relaxed text-ink-600">
            Which sources exist on which platform is listed under{" "}
            <a href="#platforms" className="text-ink-500 underline decoration-surface-600 underline-offset-2 hover:text-ink-300">
              Platforms
            </a>
            .
          </p>
        </div>
      </div>
    </Section>
  );
}
