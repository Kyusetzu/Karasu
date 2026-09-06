import { Check, Download, Minus } from "lucide-react";
import { Reveal, Section } from "@/components/Section";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PLATFORMS, TIERS } from "@/content/platforms";
import release from "@/generated/release.json";
import { staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { LINKS } from "@/site.config";

export function Platforms() {
  return (
    <Section
      id="platforms"
      wash="w1"
      eyebrow="Platforms"
      title="Windows, Linux and Android. No macOS."
      lede={
        <>
          Version {release.version}, released {release.publishedAt}.{" "}
          <strong className="font-semibold text-ink-100">Stable</strong> means in the current release and used
          every day by the maintainer; <strong className="font-semibold text-ink-100">Experimental</strong> means
          in the release and built by CI, but not used every day.
        </>
      }
    >
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {PLATFORMS.map((p, i) => (
          <Reveal key={p.id} delay={staggerDelay(i)}>
            <Card className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-brand text-xl font-bold tracking-[-.01em] text-ink-100">{p.name}</h3>
                <span
                  className={cn(
                    "rounded-[.625rem] border px-2 py-0.5 font-brand text-2xs font-semibold uppercase tracking-[.14em]",
                    p.tier === "stable"
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-gold/40 bg-gold/10 text-gold",
                  )}
                >
                  {TIERS[p.tier].label}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">{p.install}</p>
              <ul className="mt-5 space-y-2">
                {p.works.map((w) => (
                  <li key={w} className="flex gap-2.5 text-sm text-ink-300">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {w}
                  </li>
                ))}
                {p.limits.map((l) => (
                  <li key={l} className="flex gap-2.5 text-sm text-ink-500">
                    <Minus className="mt-0.5 size-4 shrink-0 text-ink-600" aria-hidden="true" />
                    {l}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-2 pt-6">
                <ButtonLink href={p.download.href}>
                  <Download className="size-4" aria-hidden="true" />
                  {p.download.label}
                </ButtonLink>
                {p.secondary && (
                  <a
                    href={p.secondary.href}
                    className="text-center text-xs text-ink-500 underline decoration-surface-600 underline-offset-2 transition-surface hover:text-ink-300"
                  >
                    {p.secondary.label}
                  </a>
                )}
              </div>
            </Card>
          </Reveal>
        ))}
      </div>
      <p className="mt-8 text-xs leading-relaxed text-ink-600">
        Updates: the desktop app follows the Stable channel by default and checks once a day; a Nightly channel with
        a build per commit is one switch away in Settings → Desktop → Updates. Every download is on the{" "}
        <a href={LINKS.releases} className="text-ink-500 underline decoration-surface-600 underline-offset-2 hover:text-ink-300">
          releases page
        </a>
        .
      </p>
    </Section>
  );
}
