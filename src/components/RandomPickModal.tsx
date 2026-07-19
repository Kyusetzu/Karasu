import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Dices, ExternalLink } from "lucide-react";
import { displayTitle, type MediaListEntry } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

/**
 * Picks a random entry from the Plan-to-Watch/Read pool, with an optional
 * episode-count cap. Reroll to draw again.
 */
export default function RandomPickModal({
  pool,
  onClose,
}: {
  pool: MediaListEntry[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [cap, setCap] = useState<number | "">("");
  const [picked, setPicked] = useState<MediaListEntry | null>(null);
  const [nonce, setNonce] = useState(0);

  const filtered = useMemo(() => {
    if (cap === "") return pool;
    return pool.filter(
      (e) => e.media.episodes !== null && e.media.episodes <= cap,
    );
  }, [pool, cap]);

  // Draw whenever the pool/cap changes or the user rerolls.
  useEffect(() => {
    setPicked(
      filtered.length
        ? filtered[Math.floor(Math.random() * filtered.length)]
        : null,
    );
  }, [filtered, nonce]);

  return (
    <Modal title={t("random.title")} onClose={onClose}>
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-500">{t("random.capLabel")}</span>
          <Input
            type="number"
            min={1}
            value={cap}
            placeholder={t("random.capAny")}
            onChange={(e) =>
              setCap(e.target.value === "" ? "" : Math.max(1, Number(e.target.value)))
            }
            className="w-28"
          />
        </label>

        {picked ? (
          <div className="flex gap-4">
            <Link to={`/media/${picked.media.id}`} onClick={onClose}>
              <img
                src={picked.media.coverImage.large ?? ""}
                alt=""
                className="h-40 w-28 shrink-0 rounded-lg object-cover"
              />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="font-semibold">{displayTitle(picked.media.title)}</p>
              <p className="text-xs text-ink-600">
                {picked.media.format ?? ""}
                {picked.media.episodes
                  ? ` · ${picked.media.episodes} ${t("common.episodes")}`
                  : ""}
              </p>
              <div className="mt-auto flex gap-2 pt-3">
                <Link to={`/media/${picked.media.id}`} onClick={onClose}>
                  <Button>
                    {t("random.open")} <ExternalLink size={14} />
                  </Button>
                </Link>
                <Button variant="secondary" onClick={() => setNonce((n) => n + 1)}>
                  <Dices size={15} /> {t("random.reroll")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-ink-600">
            {t("random.empty")}
          </p>
        )}
      </div>
    </Modal>
  );
}
