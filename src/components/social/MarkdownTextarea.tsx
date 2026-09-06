import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlignCenterHorizontal,
  Bold,
  Clapperboard,
  Code,
  Eye,
  EyeClosed,
  EyeOff,
  Heading,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Strikethrough,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";
import {
  cycleHeading,
  editSpan,
  fenceCode,
  INLINE_MARKS,
  insertImage,
  insertLink,
  insertVideo,
  prefixLines,
  wrapCenter,
  wrapSelection,
  type TextEdit,
} from "@/lib/composer";

/**
 * The one textarea every AniList markdown composer uses — status updates,
 * replies, threads, comments, reviews, the bio — with the formatting toolbar
 * above it and, where the caller asks, a preview and a footer row.
 *
 * It existed six times before, each hand-rolled and drifting from the others,
 * and none with a way to format short of knowing the syntax. The toolbar's
 * arithmetic lives in `lib/composer` as pure functions; this file only reads
 * the selection and writes the result back.
 *
 * Writing back goes through `execCommand("insertText")` where the engine has
 * it (WebView2 and WebKitGTK both do), as the smallest span that changes —
 * that is what makes an edit one native undo step with the caret where the
 * user expects. jsdom has no `execCommand`, so the tests exercise the plain
 * `onChange` fallback, which is also what runs if the command ever refuses.
 *
 * Keyboard: Ctrl/Cmd+B, +I, +Shift+X (strike), +Shift+S (spoiler), +Enter
 * (send). Never Ctrl+K — the command palette owns it, and the palette must
 * open from inside a composer too. Every button is `aria-label`led and
 * `preventDefault`s its mousedown, so the textarea keeps focus and, more to
 * the point, its selection.
 */

type Edit = (text: string, start: number, end: number) => TextEdit;

export interface MarkdownTextareaProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Ctrl/Cmd+Enter. Plain Enter is a newline: AniList renders single newlines as breaks. */
  onSubmit?: () => void;
  /** `compact` is the reply box: the toolbar shows while focused or non-empty,
   *  no preview, and `actions` sit beside the field rather than under it. */
  variant?: "full" | "compact";
  /** `toggle` swaps the field for the rendered markdown; `side` shows both. */
  preview?: "none" | "toggle" | "side";
  /** What the preview renders — the validated text, usually. Defaults to `value`. */
  previewSource?: string;
  /** Shown in an empty preview. Defaults to the shared sentence. */
  previewEmpty?: string;
  /** The row under the field: a counter, a hint. */
  footer?: ReactNode;
  /** The send button(s). */
  actions?: ReactNode;
  className?: string;
  textareaClassName?: string;
}

export function MarkdownTextarea({
  id,
  value,
  onChange,
  placeholder,
  rows = 3,
  autoFocus,
  disabled,
  onSubmit,
  variant = "full",
  preview = "none",
  previewSource,
  previewEmpty,
  footer,
  actions,
  className,
  textareaClassName,
}: MarkdownTextareaProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [active, setActive] = useState(false);

  // The selection an edit asked for, applied once the new value has landed.
  useLayoutEffect(() => {
    const sel = pending.current;
    const el = ref.current;
    if (!sel || !el) return;
    pending.current = null;
    el.setSelectionRange(sel.start, sel.end);
  }, [value]);

  const apply = useCallback(
    (edit: Edit) => {
      const el = ref.current;
      if (!el || disabled) return;
      const a = el.selectionStart ?? value.length;
      const b = el.selectionEnd ?? a;
      const next = edit(value, Math.min(a, b), Math.max(a, b));
      el.focus();
      if (next.text === value) {
        el.setSelectionRange(next.start, next.end);
        return;
      }
      pending.current = { start: next.start, end: next.end };
      const span = editSpan(value, next.text);
      let done = false;
      if (typeof document.execCommand === "function") {
        el.setSelectionRange(span.start, span.end);
        try {
          done = document.execCommand("insertText", false, span.insert);
        } catch {
          done = false;
        }
      }
      if (!done) onChange(next.text);
    },
    [value, onChange, disabled],
  );

  const mark = (name: keyof typeof INLINE_MARKS): Edit => {
    const [before, after] = INLINE_MARKS[name];
    return (text, s, e) => wrapSelection(text, s, e, before, after);
  };

  // Literal `t("…")` per button, where `i18nKeys.test.ts` can see them.
  const tools: { key: string; label: string; shortcut?: string; icon: LucideIcon; edit: Edit; compact: boolean }[] = [
    { key: "bold", label: t("composer.bold"), shortcut: "Ctrl+B", icon: Bold, edit: mark("bold"), compact: true },
    { key: "italic", label: t("composer.italic"), shortcut: "Ctrl+I", icon: Italic, edit: mark("italic"), compact: true },
    { key: "strike", label: t("composer.strike"), shortcut: "Ctrl+Shift+X", icon: Strikethrough, edit: mark("strike"), compact: true },
    { key: "spoiler", label: t("composer.spoiler"), shortcut: "Ctrl+Shift+S", icon: EyeClosed, edit: mark("spoiler"), compact: true },
    { key: "heading", label: t("composer.heading"), icon: Heading, edit: cycleHeading, compact: false },
    { key: "quote", label: t("composer.quote"), icon: TextQuote, edit: (x, s, e) => prefixLines(x, s, e, "quote"), compact: false },
    { key: "bullets", label: t("composer.bullets"), icon: List, edit: (x, s, e) => prefixLines(x, s, e, "bullet"), compact: false },
    { key: "numbered", label: t("composer.numbered"), icon: ListOrdered, edit: (x, s, e) => prefixLines(x, s, e, "numbered"), compact: false },
    { key: "code", label: t("composer.code"), icon: Code, edit: fenceCode, compact: false },
    { key: "link", label: t("composer.link"), icon: Link, edit: insertLink, compact: true },
    { key: "image", label: t("composer.image"), icon: Image, edit: insertImage, compact: true },
    { key: "video", label: t("composer.video"), icon: Clapperboard, edit: insertVideo, compact: false },
    { key: "center", label: t("composer.center"), icon: AlignCenterHorizontal, edit: wrapCenter, compact: false },
  ];

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "enter") {
      if (onSubmit) {
        e.preventDefault();
        onSubmit();
      }
      return;
    }
    let edit: Edit | null = null;
    if (!e.shiftKey && k === "b") edit = mark("bold");
    else if (!e.shiftKey && k === "i") edit = mark("italic");
    else if (e.shiftKey && k === "x") edit = mark("strike");
    else if (e.shiftKey && k === "s") edit = mark("spoiler");
    if (edit) {
      e.preventDefault();
      e.stopPropagation();
      apply(edit);
    }
  };

  const compact = variant === "compact";
  const previewing = preview === "toggle" && showPreview;
  const source = previewSource ?? value;
  const toolbarShown = !compact || active || value.length > 0;

  const previewPanel = (
    <div
      className={cn(
        "overflow-y-auto rounded-lg border border-surface-800 bg-surface-950 p-3",
        preview === "side" ? "min-h-44" : "min-h-20",
      )}
    >
      {source.trim() ? (
        <Markdown source={source} />
      ) : (
        <p className="text-xs text-ink-600">{previewEmpty ?? t("social.previewEmpty")}</p>
      )}
    </div>
  );

  const field = (
    <textarea
      ref={ref}
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      placeholder={placeholder}
      rows={rows}
      autoFocus={autoFocus}
      disabled={disabled}
      // Kept mounted under the preview rather than replaced: a label's
      // `htmlFor` keeps resolving, and the draft keeps its undo history.
      hidden={previewing}
      className={cn(
        "w-full resize-y rounded-lg border border-surface-700 bg-surface-950 text-ink-100 placeholder:text-ink-600 focus:border-accent-500 focus:outline-none",
        compact ? "min-h-8 flex-1 px-2 py-1.5 text-xs" : "px-3 py-2 text-sm",
        textareaClassName,
      )}
    />
  );

  return (
    <div className={cn(compact ? "space-y-1" : "space-y-1.5", className)}>
      {toolbarShown && (
        <div
          role="toolbar"
          aria-label={t("composer.toolbar")}
          className="flex flex-wrap items-center gap-0.5"
        >
          {tools
            .filter((tool) => !compact || tool.compact)
            .map((tool) => (
              <IconButton
                key={tool.key}
                size="xs"
                variant="ghost"
                aria-label={tool.label}
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                disabled={disabled || previewing}
                // Keep the focus — and the selection — in the textarea.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(tool.edit)}
              >
                <tool.icon className="size-3.5" />
              </IconButton>
            ))}
          {preview === "toggle" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setShowPreview((v) => !v)}
              disabled={!value.trim()}
            >
              {showPreview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {showPreview ? t("social.previewOff") : t("social.previewOn")}
            </Button>
          )}
        </div>
      )}

      {compact ? (
        <div className="flex items-start gap-2">
          {field}
          {actions}
        </div>
      ) : preview === "side" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {field}
          {previewPanel}
        </div>
      ) : (
        <>
          {field}
          {previewing && previewPanel}
        </>
      )}

      {!compact && (footer || actions) && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-1 items-center gap-2">{footer}</div>
          {actions}
        </div>
      )}
    </div>
  );
}
