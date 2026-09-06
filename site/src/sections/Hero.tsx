import { ScrollText, MonitorSmartphone, UserRoundX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { LINKS } from "@/site.config";
import { HeroScene } from "./hero/HeroScene";

const FACTS = [
  { icon: MonitorSmartphone, text: "Windows · Linux · Android" },
  { icon: ScrollText, text: "MIT licensed" },
  { icon: UserRoundX, text: "No account needed to start" },
] as const;

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="hero relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10 lg:pb-28 lg:pt-24">
        <div className="relative">
          <p className="font-brand text-2xs font-semibold uppercase tracking-[.18em] text-accent-400">
            Free · open source · built for AniList
          </p>
          <h1
            id="hero-title"
            className="mt-4 font-brand text-[2.375rem] font-bold leading-[1.06] tracking-[-.03em] text-ink-100 md:text-[3.25rem]"
          >
            A modern anime &amp; manga tracker, built exclusively for AniList.
          </h1>
          <p className="mt-5 max-w-lg text-[1.0625rem] leading-relaxed text-ink-300">
            Karasu watches what you play and read and keeps your AniList progress in sync —
            no buttons to press.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={LINKS.latest} size="lg">
              Download Karasu
            </ButtonLink>
            <ButtonLink href={LINKS.repo} variant="outline" size="lg">
              View on GitHub
            </ButtonLink>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-500">
            {FACTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2">
                <Icon className="size-4 text-ink-600" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <HeroScene />
      </div>
    </section>
  );
}
