import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
/** Sticky action bar for bulk edits over the current selection. */

/** Selection checkbox shared by the grid and list rows. */
export function SelectBox({
  checked,
  onToggle,
  className,
}: {
  checked: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onToggle}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-[.3125rem] border transition-surface",
        // Near-opaque unchecked, because it sits on arbitrary cover art and a
        // translucent box has no contrast floor there.
        checked
          ? "border-accent-500 bg-accent-500 text-accent-ink"
          : "border-[rgba(255,255,255,.35)] bg-[rgba(4,5,8,.7)] text-transparent hover:border-accent-500",
        className,
      )}
      role="checkbox"
      aria-checked={checked}
      aria-label={t("bulk.select")}
    >
      <Check className="size-3.25" strokeWidth={3} />
    </button>
  );
}
