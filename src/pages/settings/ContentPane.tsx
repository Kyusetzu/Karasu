import { useTranslation } from "react-i18next";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useContentFilter } from "@/stores/contentFilter";
import { CONTENT_FILTER_LEVELS } from "@/lib/contentFilter";
/**
 * Content filter. A three-stop slider rather than a toggle: "hide everything
 * 18+" and "hide suggestive material too" are genuinely different asks, and
 * AniList only flags the former (`isAdult`) — Ecchi is an ordinary genre.
 */
export function ContentSection() {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const ready = useContentFilter((s) => s.ready);
  const setLevel = useContentFilter((s) => s.setLevel);
  const index = CONTENT_FILTER_LEVELS.indexOf(level);

  return (
    <Card>
      <CardTitle>{t("settings.content")}</CardTitle>
      {ready && (
        <div className="mt-4 space-y-3">
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={index < 0 ? 2 : index}
            onChange={(e) =>
              setLevel(CONTENT_FILTER_LEVELS[Number(e.target.value)])
            }
            aria-label={t("settings.contentFilter")}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-700 accent-accent-500"
          />
          <div className="flex justify-between text-xs">
            {CONTENT_FILTER_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={cn(
                  "transition-colors",
                  l === level
                    ? "font-semibold text-accent-400"
                    : "text-ink-600 hover:text-ink-300",
                )}
              >
                {t(`settings.contentLevel_${l}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-500">
            {t(`settings.contentHint_${level}`)}
          </p>
          <p className="text-xs text-ink-600">{t("settings.contentNote")}</p>
        </div>
      )}
    </Card>
  );
}
