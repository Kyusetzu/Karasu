import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/** Guards a destructive action by naming what will be destroyed, which is what makes the extra click worth asking for. */
export default function ConfirmDialog({
  title,
  names = [],
  extra,
  note,
  confirmLabel,
  onConfirm,
  onCancel,
  leaving = false,
}: {
  title: string;
  /** The first few things this will destroy, spelled out. */
  names?: string[];
  /** How many more there are beyond `names`. */
  extra?: number;
  note?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** On its way out — see `usePresence`. */
  leaving?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      alert
      size="sm"
      title={title}
      onClose={onCancel}
      leaving={leaving}
      icon={
        <span className="grid size-7 shrink-0 place-items-center rounded-inner bg-danger/16 text-danger">
          <AlertTriangle aria-hidden className="size-4" />
        </span>
      }
      // Cancel comes first and takes the focus, so a stray Enter keeps what is there.
      footer={
        <>
          <Button variant="outline" size="control" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" size="control" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {(names.length > 0 || note) && (
        <div className="pl-10">
          {names.length > 0 && (
            <ul className="space-y-0.5 text-xs text-ink-500">
              {names.map((name) => (
                <li key={name} className="truncate">
                  {name}
                </li>
              ))}
              {!!extra && extra > 0 && <li className="text-ink-600">{t("confirm.andMore", { n: extra })}</li>}
            </ul>
          )}
          {note && <p className="mt-2 text-2xs leading-relaxed text-ink-600">{note}</p>}
        </div>
      )}
    </Modal>
  );
}
