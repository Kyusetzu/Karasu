import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon } from "lucide-react";
import { searchMedia } from "@/api/queries";
import type { MediaType } from "@/api/types";
import { Input } from "@/components/ui/input";
import MediaCard from "@/components/MediaCard";
import { isTauri } from "@/api/anilist";
import { adultQueryArg, isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { EmptyState, StruckQuery } from "@/components/EmptyState";
import { cn } from "@/lib/utils";

export default function Search() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [type, setType] = useState<MediaType>("ANIME");

  // Debounce: search only after 500 ms of typing pause (spare the rate limit)
  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), 500);
    return () => clearTimeout(timer);
  }, [input]);

  const level = useContentFilter((s) => s.level);
  const filterReady = useContentFilter((s) => s.ready);

  const { data, isFetching, error } = useQuery({
    // The level is part of the key: changing it must refetch, since the
    // filtering happens server-side.
    queryKey: ["search", type, term, level],
    queryFn: () => searchMedia(term, type, 1, adultQueryArg(level)),
    enabled: isTauri && filterReady && term.length >= 2,
  });

  // Server-side isAdult covers explicit works; the strict level additionally
  // drops Ecchi, which AniList does not flag as adult.
  const results = (data?.media ?? []).filter((m) => !isBlocked(m, level));

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <h1 className="text-2xl font-bold">{t("search.title")}</h1>
        <div className="mt-4 flex items-center gap-2">
          <div className="relative max-w-md flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 size-3.75 -translate-y-1/2 text-ink-600"
            />
            <Input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("search.placeholder")}
              className="h-10 pl-9"
            />
          </div>
          <div className="flex rounded-lg border border-surface-700">
            {(["ANIME", "MANGA"] as const).map((tp) => (
              <button
                key={tp}
                onClick={() => setType(tp)}
                className={cn(
                  "h-10 px-4 text-sm font-medium first:rounded-l-lg last:rounded-r-lg",
                  type === tp
                    ? "bg-accent-600 text-accent-ink"
                    : "text-ink-500 hover:bg-surface-800 hover:text-ink-100",
                )}
              >
                {tp === "ANIME" ? t("search.anime") : t("search.manga")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <p className="text-sm text-danger">
            {t("common.error", { message: String(error) })}
          </p>
        )}
        {isFetching && (
          <p className="text-sm text-ink-600">{t("search.searching")}</p>
        )}
        {!isFetching && term.length < 2 && (
          // No mark here, deliberately: on every other empty screen the visual
          // is the subject, and on this one the field above it is.
          <EmptyState title={t("search.prompt")} hint={t("search.promptHint")} />
        )}
        {!isFetching && term.length >= 2 && results.length === 0 && (
          <EmptyState
            visual={<StruckQuery query={term} />}
            // The query is already on screen at 2.5rem — repeating it in the
            // sentence underneath just says the same thing twice.
            title={t("search.noResults")}
            hint={t("search.noResultsHint")}
          />
        )}
        {results.length > 0 && (
          <div className="media-grid gap-x-4 gap-y-6">
            {results.map((m) => (
              <MediaCard key={m.id} media={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
