import { Bird, Cloud, UserRound } from "lucide-react";
import { FlowDiagram } from "@/components/FlowDiagram";
import { Reveal, Section } from "@/components/Section";
import { LINKS } from "@/site.config";

const STEPS = [
  { icon: Bird, title: "Karasu", text: "On your device. Reads and writes through the public GraphQL API." },
  { icon: Cloud, title: "AniList's API", text: "Signed in with the implicit OAuth grant — a token, never a password, and no client secret in the app." },
  { icon: UserRound, title: "Your account", text: "Your list lives on AniList. Karasu is a way of keeping it, not a copy of it." },
];

const POINTS = [
  ["Not a replacement", "The website stays the place your list lives; Karasu reads the same list and writes to it."],
  ["The token stays in the backend", "It is kept in your OS credential store (or an encrypted file in portable mode, or the Android Keystore) and is never handed back to the app's web view."],
  ["Within the limits", "AniList allows about thirty requests a minute. Karasu batches, caches and never fetches on scroll, so the budget is spent on what you asked for."],
] as const;

export function AniList() {
  return (
    <Section
      id="anilist"
      wash="accent"
      eyebrow="AniList"
      title="Built for AniList, not instead of it."
      lede="Karasu is an independent, open-source project that talks to AniList's public API on your behalf. It is not made by AniList and not endorsed by it."
    >
      <div className="mt-12">
        <FlowDiagram steps={STEPS} className="lg:max-w-4xl" />
      </div>
      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {POINTS.map(([title, text], i) => (
          <Reveal key={title} delay={i * 45}>
            <p className="font-brand text-[.9375rem] font-semibold text-ink-100">{title}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">{text}</p>
          </Reveal>
        ))}
      </div>
      <p className="mt-8 text-sm text-ink-500">
        New to AniList? It is a free anime and manga database and list at{" "}
        <a href={LINKS.anilist} className="text-ink-300 underline decoration-surface-600 underline-offset-2 hover:text-ink-100">
          anilist.co
        </a>
        . Karasu needs an account there to sync; without one it keeps a local list.
      </p>
    </Section>
  );
}
