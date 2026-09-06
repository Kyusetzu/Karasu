import { useMemo, useState } from "react";
import { Lightbox } from "@/components/Lightbox";
import { Screenshot } from "@/components/Screenshot";
import { Reveal, Section } from "@/components/Section";
import { Pill } from "@/components/ui/pill";
import { SHOTS, type Shot } from "@/content/screenshots";
import { staggerDelay } from "@/lib/motion";

type Kind = Shot["kind"];
const LABEL: Record<Kind, string> = { desktop: "Desktop", phone: "Phone" };

export function Gallery() {
  const kinds = useMemo(() => Array.from(new Set(SHOTS.map((s) => s.kind))), []);
  const [kind, setKind] = useState<Kind>(kinds[0] ?? "desktop");
  const [open, setOpen] = useState<number | null>(null);
  const shots = useMemo(() => SHOTS.filter((s) => s.kind === kind), [kind]);

  return (
    <Section
      id="screenshots"
      eyebrow="Screenshots"
      title="The app, as it is."
      lede="Every image here is a capture of the current release — nothing mocked, nothing planned. Click one to see it at full size."
    >
      {kinds.length > 1 && (
        <div className="mt-8 flex gap-2" role="group" aria-label="Filter screenshots">
          {kinds.map((k) => (
            <Pill key={k} active={kind === k} onClick={() => setKind(k)}>
              {LABEL[k]}
            </Pill>
          ))}
        </div>
      )}
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {shots.map((s, i) => (
          <Reveal as="li" key={s.id} delay={staggerDelay(i)}>
            <Screenshot shot={s} onClick={() => setOpen(i)} sizes="(min-width: 1024px) 24rem, (min-width: 640px) 50vw, 100vw" />
            <p className="mt-2 text-xs text-ink-500">{s.caption}</p>
          </Reveal>
        ))}
      </ul>
      <Lightbox shots={shots} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />
    </Section>
  );
}
