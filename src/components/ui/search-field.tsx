import { useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** `sm` inside a panel, `md` in a toolbar beside the other controls, `lg` where the search is the page. */
export type SearchFieldSize = "sm" | "md" | "lg";

const SIZES: Record<SearchFieldSize, { shell: string; glyph: string }> = {
  sm: { shell: "h-8 gap-1.5 px-2 text-xs", glyph: "size-3.5" },
  md: { shell: "h-8.5 gap-2 px-2.5 text-ui", glyph: "size-4" },
  lg: { shell: "h-11 gap-2.5 px-3 text-sm", glyph: "size-4" },
};

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size" | "type" | "className"> & {
  value: string;
  onChange: (value: string) => void;
  /** The field's accessible name; the placeholder is a hint, not a name. */
  label: string;
  /** The clear button's accessible name. */
  clearLabel: string;
  size?: SearchFieldSize;
  /** No frame, for a field that is a panel's own top edge. */
  inset?: boolean;
  /** Draws a filled field's frame in the accent, where a query is a filter in force. */
  markFilled?: boolean;
  /** A request is out for this query. */
  busy?: boolean;
  /** After the query, before the clear button: a match count, a shortcut hint. */
  trailing?: ReactNode;
  /** A second Escape on an empty field lets go of it, the way a browser's find bar does. */
  blurOnEscape?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
};

/** The one search field: a glass, the query, whatever trails it, and a clear button that keeps the caret. */
export function SearchField({
  value,
  onChange,
  label,
  clearLabel,
  size = "md",
  inset = false,
  markFilled = false,
  busy = false,
  trailing,
  blurOnEscape = false,
  inputRef,
  className,
  onKeyDown,
  ...rest
}: Props) {
  const s = SIZES[size];
  const own = useRef<HTMLInputElement>(null);
  const field = inputRef ?? own;
  // Escape empties a filled field and stops there, so a dialog or panel around it stays open until the next press.
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== "Escape") return;
    if (value) {
      e.preventDefault();
      e.stopPropagation();
      onChange("");
    } else if (blurOnEscape) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };
  return (
    <div
      className={cn(
        "relative flex items-center transition-surface",
        s.shell,
        inset
          ? "bg-transparent focus-within:bg-surface-850"
          : "field-shell rounded-control border border-surface-700 bg-surface-900 focus-within:border-accent-500",
        !inset && markFilled && value && "border-accent-500/60",
        className,
      )}
    >
      <Search aria-hidden className={cn(s.glyph, "shrink-0 text-ink-600")} />
      <input
        {...rest}
        ref={field}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        aria-label={label}
        className="h-full min-w-0 flex-1 bg-transparent text-ink-100 placeholder:text-ink-600 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {busy && <Spinner icon={Loader2} className={cn(s.glyph, "shrink-0 text-ink-600")} />}
      {trailing}
      {value && (
        <button
          type="button"
          // The field keeps the caret; taking focus on mousedown would blur it and fire the blur handlers first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            // Back to the field, since the button that held focus goes with the query.
            field.current?.focus();
          }}
          aria-label={clearLabel}
          className="-mr-1 grid size-6 shrink-0 place-items-center rounded-inner text-ink-500 transition-surface hover:bg-surface-800 hover:text-ink-100"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );
}
