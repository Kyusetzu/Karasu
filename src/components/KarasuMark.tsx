import markUrl from "@/assets/karasu-mark.svg";
import { cn } from "@/lib/utils";

/** The corvid mark, brand art that never re-tints; keep `object-contain`, or `size-*` stretches the disc into an ellipse. */
export default function KarasuMark({
  className,
  title,
}: {
  className?: string;
  /** Only pass this where the mark is the sole label; it is decorative wherever it sits beside the wordmark. */
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
