// Copied from src/components/KarasuMark.tsx; the site keeps its own copy on
// purpose — CLAUDE.md, "The website".
import markUrl from "@/assets/karasu-mark.svg";
import { cn } from "@/lib/cn";

/**
 * The corvid mark.
 *
 * Brand art, so it does **not** re-tint with the accent — it is the one thing
 * on screen that stays put while everything around it follows the colour.
 *
 * `object-contain` is load-bearing, not tidying. The art is 890.73 × 978.44 —
 * a disc with the tail hanging below it, so **not square** — and an `<img>`
 * defaults to `object-fit: fill`. Every `size-*` utility sets width *and*
 * height, which would stretch the mark 9.5% horizontally and draw the disc as
 * an ellipse. Contain letterboxes instead, which is the one behaviour that is
 * right whether a caller constrains one dimension or both.
 */
export default function KarasuMark({
  className,
  title,
}: {
  className?: string;
  /** Only pass this where the mark is the sole label; it is decorative
      everywhere it sits beside the wordmark. */
  title?: string;
}) {
  return (
    <img
      src={markUrl}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      draggable={false}
      width={891}
      height={978}
      className={cn("select-none object-contain", className)}
    />
  );
}
