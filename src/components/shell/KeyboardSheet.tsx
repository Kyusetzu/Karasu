import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/modal";

/**
 * The shortcut reference, on `?`.
 *
 * It lists what is wired and nothing else. A reference that names keys the app
 * does not answer to is worse than no reference — the reader tries one, gets
 * nothing, and stops trusting the rest of the sheet.
 */
export default function KeyboardSheet() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping()) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  const groups: { title: string; rows: { label: string; keys: string[] }[] }[] = [
    {
      title: t("keys.global"),
      rows: [
        { label: t("keys.palette"), keys: ["Ctrl", "K"] },
        { label: t("keys.reference"), keys: ["?"] },
        { label: t("keys.search"), keys: ["/"] },
        { label: t("keys.close"), keys: ["Esc"] },
        { label: t("keys.overview"), keys: ["Ctrl", "1"] },
        { label: t("keys.anime"), keys: ["Ctrl", "2"] },
        { label: t("keys.manga"), keys: ["Ctrl", "3"] },
        { label: t("keys.sync"), keys: ["Ctrl", "R"] },
      ],
    },
    {
      title: t("keys.inList"),
      rows: [
        { label: t("keys.move"), keys: ["←", "↑", "↓", "→"] },
        { label: t("keys.open"), keys: ["↵"] },
        { label: t("keys.plusOne"), keys: ["Space"] },
        { label: t("keys.edit"), keys: ["E"] },
        { label: t("keys.complete"), keys: ["C"] },
        { label: t("keys.remove"), keys: ["Del"] },
        { label: t("keys.selectMode"), keys: ["S"] },
        { label: t("keys.selectAll"), keys: ["Ctrl", "A"] },
        { label: t("keys.extend"), keys: ["Shift", "↑↓"] },
      ],
    },
  ];

  return (
    <Modal
      title={t("keys.title")}
      onClose={() => setOpen(false)}
      className="max-w-152"
    >
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="text-2xs uppercase tracking-[.12em] text-ink-600">
              {group.title}
            </h3>
            <div className="mt-2 space-y-1.5">
              {group.rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 text-xs text-ink-300"
                >
                  <span className="min-w-0 truncate">{row.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {row.keys.map((key) => (
                      <Cap key={key}>{key}</Cap>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-4 text-2xs leading-relaxed text-ink-600">
        {t("keys.footnote")}
      </p>
    </Modal>
  );
}

function Cap({ children }: { children: string }) {
  return (
    <kbd className="grid h-5.5 min-w-5.5 place-items-center rounded-md border border-surface-700 bg-surface-850 px-1.5 font-brand text-2xs font-semibold text-ink-300">
      {children}
    </kbd>
  );
}

/**
 * True while the caret is in something that takes text.
 *
 * Every single-key shortcut has to ask: `?` and `/` are characters people type
 * into the search field, and a global handler that fires anyway makes the
 * field unusable for exactly the words it is there to receive.
 */
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}
