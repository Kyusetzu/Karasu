import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/modal";
import { usePresence } from "@/hooks/usePresence";
import { KeyCombo } from "@/components/ui/kbd";
import { SHORTCUT_SCOPES, shortcutsIn } from "@/lib/shortcuts";
import { useShortcutLabels } from "@/components/shell/shortcutLabels";

/** The shortcut reference on `?`; it lists what is wired and nothing else, or the reader stops trusting the sheet. */
export default function KeyboardSheet() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sheet = usePresence(open);
  const labels = useShortcutLabels();

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

  // The second `?` press should read as closing, not as a cut.
  if (!sheet.mounted) return null;

  return (
    <Modal
      leaving={sheet.leaving}
      title={t("keys.title")}
      onClose={() => setOpen(false)}
      className="max-w-152"
    >
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {SHORTCUT_SCOPES.map((scope) => (
          <section key={scope}>
            <h3 className="text-2xs uppercase tracking-eyebrow text-ink-600">{labels.scope(scope)}</h3>
            <div className="mt-2 space-y-1.5">
              {shortcutsIn(scope).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-4 text-xs text-ink-300">
                  <span className="min-w-0 truncate">{labels.label(s.id)}</span>
                  <KeyCombo keys={s.keys} />
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

/** True while the caret is in something that takes text; every single-key shortcut must ask, or it eats typed characters. */
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
