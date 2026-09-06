import KarasuMark from "@/components/KarasuMark";
import { Reveal } from "@/components/Section";
import { ButtonLink } from "@/components/ui/button";
import release from "@/generated/release.json";
import { LINKS } from "@/site.config";

export function FinalCta() {
  return (
    <section id="download" aria-labelledby="download-title" className="cta relative overflow-hidden px-5 py-24 lg:py-32">
      <Reveal className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <KarasuMark className="size-16 animate-idle-float" />
        <h2 id="download-title" className="mt-6 font-brand text-cta font-bold text-ink-100">
          Ready to track smarter?
        </h2>
        <p className="mt-4 max-w-md text-lede text-ink-300">
          Install Karasu, sign in on AniList once, and let the bird keep the list.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href={LINKS.latest} size="lg">
            Download Karasu
          </ButtonLink>
          <ButtonLink href={LINKS.repo} variant="outline" size="lg">
            View on GitHub
          </ButtonLink>
        </div>
        <p className="mt-6 text-xs tabular-nums text-ink-600">
          Current release {release.version} · {release.publishedAt} ·{" "}
          <a href={release.assets.sums} className="underline decoration-surface-600 underline-offset-2 hover:text-ink-300">
            checksums
          </a>
        </p>
      </Reveal>
    </section>
  );
}
