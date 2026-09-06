import { Bug, GitBranch, MessageCircle, ShieldCheck } from "lucide-react";
import { Reveal, Section } from "@/components/Section";
import { ButtonLink } from "@/components/ui/button";
import { LINKS } from "@/site.config";

const STACK = [
  ["Tauri 2", "The shell: a Rust backend with the system's own web view"],
  ["Rust", "Detection, matching, scrobbling, storage, everything that must not be in the page"],
  ["React 19 + TypeScript", "The interface"],
  ["Vite", "Build and dev server"],
  ["Tailwind CSS v4", "One design-token file, the same one this site uses"],
  ["SQLite", "The list cache, the queue, the library — a file you can copy"],
  ["TanStack Query", "Server state, with the AniList budget in mind"],
  ["AniList GraphQL", "The one API"],
] as const;

export function OpenSource() {
  return (
    <Section
      id="open-source"
      eyebrow="Open source"
      title="Built in the open."
      lede="The whole of Karasu is on GitHub under the MIT licence — every commit, every decision, every measurement that shaped it. Developed with heavy AI assistance, and every change reviewed by a human maintainer before it lands."
    >
      <Reveal className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href={LINKS.repo} size="lg">
          <GitBranch className="size-4" aria-hidden="true" />
          View on GitHub
        </ButtonLink>
        <ButtonLink href={LINKS.contributing} variant="outline" size="lg">
          Contribute
        </ButtonLink>
        <ButtonLink href={LINKS.bugReport} variant="outline" size="lg">
          <Bug className="size-4" aria-hidden="true" />
          Report an issue
        </ButtonLink>
        <ButtonLink href={LINKS.discord} variant="ghost" size="lg">
          <MessageCircle className="size-4" aria-hidden="true" />
          Discord
        </ButtonLink>
        <ButtonLink href={LINKS.security} variant="ghost" size="lg">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Security policy
        </ButtonLink>
      </Reveal>

      <div id="technology" className="mt-16 scroll-mt-16">
        <p className="text-2xs font-semibold uppercase tracking-[.16em] text-ink-600">Made with</p>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          {STACK.map(([name, what]) => (
            <div key={name} className="border-t border-hair pt-3">
              <dt className="font-brand text-sm font-semibold text-ink-100">{name}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-ink-500">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
