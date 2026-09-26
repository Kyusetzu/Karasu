import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  /** Only needed when `label` is not plain text. */
  title?: string;
}

/** Two or three exclusive views of one thing in a single bordered track; {@link Pill}s choose a value, this chooses a lens. */
export function Segmented<T extends string>({
  segments,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const el = refs.current.get(value);
    setThumb(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [value]);
  useLayoutEffect(measure, [measure]);

  // A font arriving or a label changing moves the segments without a new value, so the track is watched too.
  useLayoutEffect(() => {
    const ro = new ResizeObserver(measure);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // Radio semantics: an arrow moves the choice and the focus together, wrapping at the ends.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const last = segments.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    onChange(segments[next].value);
    refs.current.get(segments[next].value)?.focus();
  };

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("relative inline-flex shrink-0 rounded-control border border-hair p-0.5", className)}
    >
      {thumb && (
        <span
          aria-hidden
          className="hc-edge pointer-events-none absolute inset-y-0.5 rounded-inner border border-transparent bg-surface-800 transition-[left,width]"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {segments.map((segment, i) => {
        const active = segment.value === value;
        return (
          <button
            key={segment.value}
            ref={(el) => {
              if (el) refs.current.set(segment.value, el);
              else refs.current.delete(segment.value);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={segment.title}
            aria-label={segment.title}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => onChange(segment.value)}
            className={cn(
              "relative press coarse:hit-area grid h-7.5 min-w-7.5 place-items-center rounded-inner px-2.5 text-xs font-medium transition-surface",
              "focus-visible:outline-2 focus-visible:outline-accent-500",
              active ? "text-ink-100" : "text-ink-500 hover:text-ink-300",
              // Until the thumb is measured the chosen segment paints its own ground, so the first frame is not blank.
              active && !thumb && "bg-surface-800",
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
