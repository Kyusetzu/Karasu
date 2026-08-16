import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Minus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  cycle,
  isEmpty,
  summarize,
  triOf,
  type MultiValue,
} from "@/lib/multiFilter";
import { usePresence } from "@/hooks/usePresence";

/**
 * `FilterSelect`'s bigger sibling: many answers, and each one can be a "not".
 *
 * The single-answer control wraps a native `<select>`, which is the right call
 * there — it inherits the OS dropdown, type-ahead and screen-reader behaviour
 * for free. None of that survives a tri-state, so this one is built out of
 * buttons and has to earn each of those back: Escape closes it, the trigger
 * says what it is set to without being opened, and the option list is
 * filterable because AniList ships roughly six hundred tags.
 *
 * The tri-state itself is `lib/multiFilter`, which is tested. This file is the
 * part that has to be looked at.
 */
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

  // Escape and click-outside, the two ways a popover closes. Registered only
  // while it is open, so nothing listens for a control nobody is using.
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

  // The chosen options first, so a filter set from a six-hundred-item list can
  // still be read and undone without scrolling for it.
  const shown = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const matches = needle
      ? options.filter((o) => o.toLowerCase().includes(needle))
      : options;
    const rank = (o: string) => (triOf(value, o) === "off" ? 1 : 0);
    return [...matches].sort((a, b) => rank(a) - rank(b) || 0).slice(0, 300);
  }, [options, term, value]);

  const summary = summarize(value);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "flex h-8.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg",
          "border border-surface-800 bg-surface-900 px-2.5 transition-surface",
          "hover:bg-surface-850 focus-visible:border-accent-500",
          !isEmpty(value) && "border-accent-500/60",
        )}
      >
        <span className="text-[.6875rem] uppercase tracking-[.08em] text-ink-600">
          {label}
        </span>
        <span className="max-w-32 truncate text-xs text-ink-300">
          {summary ? summary.first : placeholder}
        </span>
        {summary && summary.extra > 0 && (
          <span className="rounded bg-surface-800 px-1 text-2xs tabular-nums text-ink-400">
            +{summary.extra}
          </span>
        )}
        <ChevronDown className="size-3 shrink-0 text-ink-600" />
      </button>

      {panel.mounted && (
        <div
          // Over the page and holding the keyboard while it is — the same
          // convention every dialog and the bell follow.
          data-overlay
          className={cn(
            "absolute left-0 top-full z-50 mt-1 w-64 origin-top-left overflow-hidden",
            "rounded-xl border border-hair bg-surface-900 shadow-2xl panel-wash",
            panel.leaving ? "animate-pop-out" : "animate-pop-in",
          )}
        >
          {searchable && (
            <div className="relative border-b border-hair">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.25 -translate-y-1/2 text-ink-600" />
              <input
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={t("search.filterOptions")}
                aria-label={t("search.filterOptions")}
                className="h-9 w-full bg-transparent pl-8 pr-8 text-xs text-ink-100 placeholder:text-ink-600 focus:outline-none"
              />
              {/* Clears the *search term*, not the selection — the footer's
                  "Clear" already owns that, and conflating the two would make
                  one of them a trap. */}
              {term && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setTerm("")}
                  className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-ink-600 transition-surface hover:bg-surface-800 hover:text-ink-100"
                >
                  <X className="size-3" />
                  <span className="sr-only">{t("common.clear")}</span>
                </button>
              )}
            </div>
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
                    // The state is on the button, not only in its colour —
                    // a forced palette or a colour-blind reader gets the same
                    // three answers everyone else does.
                    aria-pressed={state !== "off"}
                    onClick={() => onChange(cycle(value, option))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-surface",
                      state === "off" && "text-ink-400 hover:bg-surface-850",
                      state === "include" && "bg-accent-500/12 text-accent-300",
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
