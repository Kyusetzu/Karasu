import { BadgeCheck, EyeOff, KeyRound, ScrollText } from "lucide-react";
import { Reveal } from "@/components/Section";
import { staggerDelay } from "@/lib/motion";

const FACTS = [
  { icon: ScrollText, title: "Free", text: "MIT licensed, no paid tier." },
  { icon: BadgeCheck, title: "Open source", text: "Every commit is public." },
  { icon: KeyRound, title: "Built for AniList", text: "Implicit OAuth, no client secret." },
  { icon: EyeOff, title: "No telemetry", text: "No analytics, no backend, no account of ours." },
] as const;

/** Four facts under the hero, each one the repository can show. */
export function TrustStrip() {
  return (
    <div className="border-y border-hair bg-surface-900/40">
      <ul className="container-site grid grid-cols-2 gap-px px-5 py-6 md:grid-cols-4 md:py-7">
        {FACTS.map(({ icon: Icon, title, text }, i) => (
          <Reveal as="li" key={title} delay={staggerDelay(i)} className="flex items-start gap-3 px-1 py-2 md:px-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-surface-700 bg-surface-900 text-accent-400">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-brand text-sm font-semibold text-ink-100">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{text}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </div>
  );
}
