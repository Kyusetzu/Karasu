import { Screenshot } from "@/components/Screenshot";
import { Reveal, Section } from "@/components/Section";
import { shot } from "@/content/screenshots";

const POINTS = [
  ["Five tabs", "Overview, ratings, years, genres and tags, people and studios."],
  ["Drawn by hand", "Radar, sunburst, treemap, area, dot plot, gradient bars and heatmaps — SVG the app draws itself, no chart library."],
  ["Your scores against the crowd", "The one figure AniList's own statistics page does not give you, computed from your cached list."],
  ["A year in review", "A poster of your year or season in five crops, exported as PNG or JPEG at up to 3×."],
] as const;

export function Statistics() {
  return (
    <Section
      id="statistics"
      wash="accent"
      eyebrow="Statistics"
      title="Your list, as pictures."
      lede="Half of it is drawn from the list Karasu already holds — the sunburst, your watch time, your scores against the crowd — and the rest is AniList's own statistics, fetched once and kept for half an hour."
    >
      <div className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <ul className="space-y-5 lg:order-1">
          {POINTS.map(([title, text]) => (
            <li key={title}>
              <p className="font-brand text-[.9375rem] font-semibold text-ink-100">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">{text}</p>
            </li>
          ))}
        </ul>
        {/* One wide capture, two beneath it: a composition rather than a pile. */}
        <div className="space-y-5 lg:order-2">
          <Reveal>
            <Screenshot shot={shot("stats-overview")} sizes="(min-width: 1024px) 42rem, 100vw" />
          </Reveal>
          <div className="grid gap-5 sm:grid-cols-2">
            <Reveal delay={90}>
              <Screenshot shot={shot("stats-genres")} sizes="(min-width: 1024px) 21rem, (min-width: 640px) 50vw, 100vw" />
            </Reveal>
            <Reveal delay={180}>
              <Screenshot shot={shot("wrapped")} sizes="(min-width: 1024px) 21rem, (min-width: 640px) 50vw, 100vw" />
            </Reveal>
          </div>
        </div>
      </div>
    </Section>
  );
}
