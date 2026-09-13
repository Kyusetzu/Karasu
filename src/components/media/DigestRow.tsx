import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Media } from "@/api/types";
import { TitleLockup } from "@/components/media/TitleLockup";
import { cn } from "@/lib/utils";

/** One line of a digest: art, title, and the episode stacked over its countdown in one right-hand column. */
export function DigestRow({
  media,
  note,
  when,
  marker,
  dim = false,
}: {
  media: Pick<Media, "id" | "title" | "coverImage">;
  note: string;
  when: string;
  /** An optional trailing affordance — the calendar's on-list pip. */
  marker?: ReactNode;
  /** Drawn faded: the calendar's already-aired episodes. */
  dim?: boolean;
}) {
  return (
    <Link
      to={`/media/${media.id}`}
      className={cn(
        "flex items-center gap-2.5 rounded-[.625rem] px-2.5 py-2 transition-surface hover:bg-surface-900",
        dim && "opacity-55 hover:opacity-100",
      )}
    >
      <img
        src={media.coverImage.large ?? ""}
        alt=""
        loading="lazy"
        className="dense-row-cover shrink-0 rounded-[.3125rem] object-cover"
      />
      <TitleLockup title={media.title} dense className="flex-1" />
      {/* Keep `min-w-0`, not `shrink-0`: pinned at max-content, one long note hands the whole page a sideways scroll. */}
      <div className="min-w-0 text-right">
        <p className="dense-text truncate text-ink-600">{note}</p>
        <p className="dense-text whitespace-nowrap tabular-nums text-accent-400">{when}</p>
      </div>
      {marker}
    </Link>
  );
}
