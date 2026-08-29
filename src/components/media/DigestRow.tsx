import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Media } from "@/api/types";
import { TitleLockup } from "@/components/media/TitleLockup";

/**
 * One line of a digest: art, what it is, when it lands.
 *
 * Extracted from the Dashboard when the calendar arrived — the house rule in
 * `relTime.ts` applies: the second copy is where two versions start
 * disagreeing.
 *
 * The episode number sits in the *right* block rather than under the title,
 * because the two things a glance wants — which episode and how long — then
 * sit on top of each other in one column instead of straddling the row. The
 * title column is left to say what the show is, in both scripts.
 */
export function DigestRow({
  media,
  note,
  when,
  marker,
}: {
  media: Pick<Media, "id" | "title" | "coverImage">;
  note: string;
  when: string;
  /** An optional trailing affordance — the calendar's on-list pip. */
  marker?: ReactNode;
}) {
  return (
    <Link
      to={`/media/${media.id}`}
      className="flex items-center gap-2.5 rounded-[.625rem] px-2.5 py-2 transition-surface hover:bg-surface-900"
    >
      <img
        src={media.coverImage.large ?? ""}
        alt=""
        loading="lazy"
        className="h-11.5 w-8.5 shrink-0 rounded-[.3125rem] object-cover"
      />
      <TitleLockup title={media.title} className="flex-1" />
      {/* `min-w-0`, not `shrink-0`: pinned at max-content this block could
          never give width back, and one long German note was enough to hand
          the whole page a sideways scroll. The note truncates; the countdown
          is short and keeps its line. */}
      <div className="min-w-0 text-right">
        <p className="truncate text-2xs text-ink-600">{note}</p>
        <p className="whitespace-nowrap text-xs tabular-nums text-accent-400">{when}</p>
      </div>
      {marker}
    </Link>
  );
}
