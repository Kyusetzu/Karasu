import { useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { MAX_TAGS, normalizeTags } from "@/lib/tags";

/**
 * Chip-based tag editor. Type a tag and press Enter or comma to add it;
 * click the × on a chip to remove it. `suggestions` feed a native datalist
 * for autocomplete from the user's existing tags.
 *
 * **Never wrap this in a `<label>`.** The remove buttons come before the input
 * and `<button>` is labelable, so the label's control resolves to the first
 * chip's × and every stray click inside it — the caption, the padding, another
 * chip's text — deletes that tag. Call sites give the caption an id and pass it
 * as `labelledBy` instead.
 */
export default function TagEditor({
  tags,
  onChange,
  suggestions = [],
  labelledBy,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  /** Id of the caption naming this editor — see the warning above. */
  labelledBy?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const listId = useId();

  const add = (value: string) => {
    const next = normalizeTags([...tags, value]);
    if (next.length !== tags.length) onChange(next);
    setDraft("");
  };

  const remove = (tag: string) =>
    onChange(tags.filter((x) => x.toLowerCase() !== tag.toLowerCase()));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft.trim()) add(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      remove(tags[tags.length - 1]);
    }
  };

  const remaining = suggestions.filter(
    (s) => !tags.some((x) => x.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-900 px-2 py-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-accent-600/20 px-2 py-0.5 text-xs text-accent-400"
        >
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            className="text-accent-400/70 hover:text-accent-400"
            aria-label={t("tags.remove", { tag })}
          >
            <X className="size-2.75" />
          </button>
        </span>
      ))}
      {tags.length < MAX_TAGS && (
        <>
          <input
            value={draft}
            aria-labelledby={labelledBy}
            list={listId}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => draft.trim() && add(draft)}
            placeholder={t("tags.placeholder")}
            className="min-w-24 flex-1 bg-transparent text-sm text-ink-100 placeholder:text-ink-600 focus:outline-none"
          />
          <datalist id={listId}>
            {remaining.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}
