import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { type Preset } from "@/lib/presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

/** Save the current filter/sort as a named preset and manage existing ones. */
export default function PresetModal({
  presets,
  onSave,
  onDelete,
  onClose,
}: {
  presets: Preset[];
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  };

  return (
    <Modal title={t("presets.title")} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder={t("presets.namePlaceholder")}
          />
          <Button onClick={save} disabled={!name.trim()}>
            {t("common.save")}
          </Button>
        </div>

        {presets.length > 0 && (
          <ul className="divide-y divide-surface-800 rounded-lg border border-surface-800">
            {presets.map((p) => (
              <li
                key={p.name}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span className="truncate text-ink-100">{p.name}</span>
                <button
                  onClick={() => onDelete(p.name)}
                  className="text-ink-600 hover:text-red-400"
                  aria-label={t("common.remove")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
