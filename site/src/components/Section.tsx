import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useReveal } from "@/lib/useReveal";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "font-brand text-2xs font-semibold uppercase tracking-[.18em] text-accent-400",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * One section of the page: the anchor the nav points at, an eyebrow, the
 * heading the section is labelled by, an optional lede, and the content.
 * The heading block reveals on scroll; children decide for themselves.
 */
export function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
  className,
  align = "left",
  width = "6xl",
  wash,
}: {
  id: string;
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
  align?: "left" | "center";
  width?: "6xl" | "5xl" | "4xl";
  /** A faint radial wash behind the heading; see `.wash` in the stylesheet. */
  wash?: "w1" | "w2" | "accent";
}) {
  const head = useReveal<HTMLDivElement>();
  const max = width === "6xl" ? "container-site" : width === "5xl" ? "mx-auto max-w-5xl" : "mx-auto max-w-4xl";
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "scroll-mt-16 px-5 py-20 lg:py-28 2xl:py-32",
        wash && `wash wash-${wash}`,
        wash && align === "center" && "wash-center",
        className,
      )}
    >
      <div className={max}>
        <div
          ref={head}
          data-reveal
          className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}
        >
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h2 id={`${id}-title`} className="mt-3 font-brand text-h2 font-bold text-ink-100">
            {title}
          </h2>
          {lede && <p className="mt-4 text-lede text-ink-300">{lede}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** A block that rises into view; wrap cards, rows and figures in it. */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  /** ms, from `staggerDelay` */
  delay?: number;
  as?: "div" | "li" | "figure" | "article";
}) {
  const ref = useReveal<HTMLElement>();
  return (
    <Tag
      // The ref's element type is decided by `as`; the hook is generic over it.
      ref={ref as never}
      data-reveal
      className={className}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
