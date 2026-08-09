import markUrl from "@/assets/karasu-mark.svg";
import { cn } from "@/lib/utils";

/**
 * The corvid mark.
 *
 * Brand art, so it does **not** re-tint with the accent — it is the one thing
 * on screen that stays put while everything around it follows the user's
 * colour. Used sparingly and deliberately: the titlebar, About, first run, the
 * Wrapped footer, and the handful of empty states where the raven belongs.
 *
 * Source of truth is `design/Logo - Karasu Icon no BG.svg`, copied to
 * `src/assets/` so the bundle is self-contained. It carries its own `<style>`
 * block with both gradients, so it renders as full-colour art through a plain
 * `<img>` and needs no SVG-to-component plugin.
 *
 * `object-contain` is load-bearing, not tidying. The art is 890.73 × 978.44 —
 * a disc with the tail hanging below it, so **not square** — and an `<img>`
 * defaults to `object-fit: fill`. Every `size-*` utility sets width *and*
 * height, so the titlebar's `size-5` and About's `size-28` were stretching the
 * mark 9.5% horizontally and drawing the disc as an ellipse. Contain letterboxes
 * instead, which is the one behaviour that is right whether a caller constrains
 * one dimension or both.
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
      className={cn("select-none object-contain", className)}
    />
  );
}
