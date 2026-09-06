import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Reveal, Section } from "@/components/Section";
import { FAQ } from "@/content/faq";
import { cn } from "@/lib/cn";

function Item({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="border-t border-hair">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-a`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-4 py-4 text-left transition-surface hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
        >
          <span className="font-brand text-[.9375rem] font-semibold text-ink-100">
            <span className="mr-2 text-2xs tabular-nums text-ink-600">{String(index + 1).padStart(2, "0")}</span>
            {q}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-ink-600 transition-transform duration-(--duration-expressive) ease-(--ease-out-expo)", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div
        id={`${id}-a`}
        hidden={!open}
        className={cn("pb-5 pr-8 text-sm leading-relaxed text-ink-300", open && "animate-settle")}
      >
        {a}
      </div>
    </li>
  );
}

export function Faq() {
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions, answered from the code." width="4xl">
      <Reveal>
        <ul className="mt-10 border-b border-hair">
          {FAQ.map((f, i) => (
            <Item key={f.q} q={f.q} a={f.a} index={i} />
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}
