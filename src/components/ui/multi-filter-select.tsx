import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Minus } from "lucide-react";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import { fuzzyScore, prepareDoc, prepareQuery } from "@/lib/fuzzy";
import {
  cycle,
  isEmpty,
  summarize,
  triOf,
  type MultiValue,
} from "@/lib/multiFilter";
import { usePresence } from "@/hooks/usePresence";
import { useBackClose } from "@/hooks/useBackClose";
import { Badge } from "./badge";

/** `FilterSelect`'s tri-state sibling, built from buttons because a native `<select>` cannot express a "not". */
export function MultiFilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  searchable = false,
}: {
  label: string;
  value: MultiValue;
  onChange: (next: MultiValue) => void;
  options: string[];
  /** Shown as the value when nothing is chosen. */
  placeholder: string;
  /** Adds a filter field above the list — for the long vocabularies. */
  searchable?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const panel = usePresence(open);
  useBackClose(open, () => setOpen(false));

  // Escape and click-outside, registered only while open, so nothing listens for a control nobody is using.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Prepared once per vocabulary rather than per keystroke; the tag vocabulary is long.
  const docs = useMemo(
    () => new Map(options.map((o) => [o, prepareDoc([o])] as const)),
    [options],
  );

  // Chosen options first, so a filter is undone without scrolling; the stable sort keeps fuzzy order in each half.
  const shown = useMemo(() => {
    const needle = term.trim();
    let matches: string[];
    if (needle) {
      const pq = prepareQuery(needle);
      matches = options
        .map((o) => ({ o, score: fuzzyScore(docs.get(o)!, pq) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.o);
    } else {
      matches = options;
    }
    const rank = (o: string) => (triOf(value, o) === "off" ? 1 : 0);
    return [...matches].sort((a, b) => rank(a) - rank(b) || 0).slice(0, 300);
  }, [options, docs, term, value]);

  const summary = summarize(value);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "flex h-8.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control",
          "border border-hair bg-surface-900 px-2.5 transition-surface",
          "hover:bg-surface-850 focus-visible:border-accent-500",
          !isEmpty(value) && "border-accent-500/60",
        )}
      >
        <span className="text-xs uppercase tracking-[.08em] text-ink-600">
          {label}
        </span>
        <span className="max-w-32 truncate text-xs text-ink-300">
          {summary ? summary.first : placeholder}
        </span>
        {summary && summary.extra > 0 && (
          <Badge tone="neutral">+{summary.extra}</Badge>
        )}
        <ChevronDown className="size-3 shrink-0 text-ink-600" />
      </button>

      {panel.mounted && (
        <div
          // Holds the keyboard while up, the convention every dialog and the bell follow.
          data-overlay
          className={cn(
            "absolute left-0 top-full z-50 mt-1 w-64 origin-top-left overflow-hidden",
            "rounded-panel border border-hair bg-surface-900 shadow-float panel-wash",
            panel.leaving ? "animate-pop-out" : "animate-pop-in",
          )}
        >
          {searchable && (
            <SearchField
              size="sm"
              inset
              autoFocus
              value={term}
              onChange={setTerm}
              label={t("search.filterOptions")}
              clearLabel={t("common.clear")}
              placeholder={t("search.filterOptions")}
              // Clears the search term only; the footer's Clear owns the selection, and conflating the two makes one a trap.
              className="h-9 border-b border-hair px-2.5"
            />
          )}
          <ul className="max-h-72 overflow-y-auto p-1">
            {shown.length === 0 && (
              <li className="px-2 py-3 text-center text-2xs text-ink-600">
                {t("search.noOptions")}
              </li>
            )}
            {shown.map((option) => {
              const state = triOf(value, option);
              return (
                <li key={option}>
                  <button
                    type="button"
                    // The state is on the button, not only its colour, so a forced palette or colour-blind reader reads it too.
                    aria-pressed={state !== "off"}
                    onClick={() => onChange(cycle(value, option))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-xs transition-surface",
                      state === "off" && "text-ink-300 hover:bg-surface-850",
                      state === "include" && "bg-accent-500/12 text-accent-400",
                      state === "exclude" && "bg-danger/12 text-danger",
                    )}
                  >
                    <span className="grid size-3.5 shrink-0 place-items-center">
                      {state === "include" && <Check className="size-3.25" />}
                      {state === "exclude" && <Minus className="size-3.25" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option}</span>
                    {state === "exclude" && (
                      <span className="shrink-0 text-2xs uppercase tracking-[.08em]">
                        {t("search.excluded")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-hair px-2.5 py-1.5">
            <span className="text-2xs text-ink-600">{t("search.cycleHint")}</span>
            {!isEmpty(value) && (
              <button
                type="button"
                onClick={() => onChange({ include: [], exclude: [] })}
                className="text-2xs text-accent-400 hover:underline"
              >
                {t("search.clearFilter")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
