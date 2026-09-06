import KarasuMark from "@/components/KarasuMark";
import { ButtonLink } from "@/components/ui/button";
import { LINKS, NAV } from "@/site.config";
import { Hero } from "@/sections/Hero";

/**
 * The landing page. Sections arrive one by one; until then each id below is
 * a heading and a sentence, so the nav, the anchors and the pre-rendering can
 * be checked against the real structure.
 */
export function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-hair bg-surface-950/95">
        <nav
          aria-label="Primary"
          className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5"
        >
          <a href="#top" className="flex items-center gap-2.5">
            <KarasuMark className="size-6" />
            <span className="font-brand text-xs font-semibold tracking-[.2em] text-ink-300">
              KARASU
            </span>
          </a>
          <ul className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="rounded-lg px-3 py-1.5 text-[.8125rem] font-medium text-ink-500 transition-surface hover:bg-surface-850 hover:text-ink-100"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <ButtonLink href={LINKS.repo} variant="ghost" size="sm">
              GitHub
            </ButtonLink>
            <ButtonLink href={LINKS.latest} size="sm">
              Download
            </ButtonLink>
          </div>
        </nav>
      </header>

      <main id="main">
        <Hero />

        {NAV.map((item) => (
          <section
            key={item.id}
            id={item.id}
            aria-labelledby={`${item.id}-title`}
            className="mx-auto max-w-6xl px-5 py-20"
          >
            <h2
              id={`${item.id}-title`}
              className="font-brand text-2xl font-bold tracking-[-.02em] text-ink-100"
            >
              {item.label}
            </h2>
            <p className="mt-3 max-w-xl text-sm text-ink-500">This section is being built.</p>
          </section>
        ))}
      </main>

      <footer className="border-t border-hair">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-ink-600">
          <span className="flex items-center gap-2">
            <KarasuMark className="size-5" />
            <span className="font-brand tracking-[.2em] text-ink-500">KARASU</span>
          </span>
          <span>MIT licensed · © 2026 Kyu and Karasu contributors · Not affiliated with AniList.</span>
        </div>
      </footer>
    </>
  );
}
