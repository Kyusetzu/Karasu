import { useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { MAX_TAGS, normalizeTags } from "@/lib/tags";
import { RemovableChip } from "@/components/ui/chip";

/** Chip-based tag editor; never wrap it in a `<label>`, or a stray click deletes the first chip (use `labelledBy`). */
export default function TagEditor({
  tags,
  onChange,
  suggestions = [],
  labelledBy,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  /** Id of the caption naming this editor, in place of a `<label>` wrapper `TagEditor` forbids. */
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
    <div className="field-shell flex flex-wrap items-center gap-1.5 rounded-control border border-surface-700 bg-surface-900 px-2 py-1.5 transition-surface focus-within:border-accent-500">
      {tags.map((tag) => (
        <RemovableChip key={tag} size="sm" removeLabel={t("tags.remove", { tag })} onRemove={() => remove(tag)}>
          {tag}
        </RemovableChip>
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
