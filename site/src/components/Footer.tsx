import KarasuMark from "@/components/KarasuMark";
import { LINKS } from "@/site.config";

const COLUMNS = [
  {
    title: "Project",
    links: [
      { label: "GitHub", href: LINKS.repo },
      { label: "Download", href: LINKS.latest },
      { label: "Changelog", href: LINKS.changelog },
      { label: "Nightly builds", href: LINKS.nightly },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Documentation", href: LINKS.readme },
      { label: "Report an issue", href: LINKS.bugReport },
      { label: "Request a feature", href: LINKS.featureRequest },
      { label: "Discord", href: LINKS.discord },
    ],
  },
  {
    title: "Elsewhere",
    links: [
      { label: "AniList", href: LINKS.anilist },
      { label: "Security policy", href: LINKS.security },
      { label: "Contributing", href: LINKS.contributing },
      { label: "MIT licence", href: LINKS.license },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-hair">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <a href="#top" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-accent-500">
              <KarasuMark className="size-7" />
              <span className="font-brand text-xs font-semibold tracking-[.2em] text-ink-300">KARASU</span>
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-500">
              A modern anime &amp; manga tracker — built exclusively for AniList.
            </p>
            <p className="mt-4 text-2xs uppercase tracking-[.12em] text-ink-600">
              Open source · free of cost
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-2xs font-semibold uppercase tracking-[.16em] text-ink-600">{col.title}</p>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      className="rounded text-sm text-ink-300 transition-surface hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hair pt-6 text-xs text-ink-600">
          <span>MIT licensed · © 2026 Kyu and Karasu contributors</span>
          <span>
            Karasu is an independent project and is not affiliated with or endorsed by AniList. SN Pro is
            used under the SIL Open Font License 1.1.
          </span>
        </div>
      </div>
    </footer>
  );
}
