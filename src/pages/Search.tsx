import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon } from "lucide-react";
import { searchMedia, type MediaWithListStatus } from "@/api/queries";
import type { MediaType } from "@/api/types";
import { searchUsers, USER_SEARCH_MIN } from "@/api/social";
import { Input } from "@/components/ui/input";
import MediaCard from "@/components/media/MediaCard";
import { isTauri } from "@/api/anilist";
import { adultQueryArg, isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { useAuth } from "@/stores/auth";
import { EmptyState, PerchRule, StruckQuery } from "@/components/EmptyState";
import { Pill } from "@/components/ui/pill";
import { UserList } from "@/components/social/UserList";

/**
 * What the search is looking for. The comment on the pills below always said
 * the two mediums were "one choice among several the search will grow" — people
 * are the third.
 */
type Scope = MediaType | "USERS";

export default function Search() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<Scope>("ANIME");
  const type: MediaType = scope === "USERS" ? "ANIME" : scope;

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
    enabled: isTauri && filterReady && term.length >= 2 && scope !== "USERS",
  });

  // Server-side isAdult covers explicit works; the strict level additionally
  // drops Ecchi, which AniList does not flag as adult.
  const results = (data?.media ?? []).filter((m) => !isBlocked(m, level));

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <h1 className="text-2xl font-bold">{t("search.title")}</h1>
        <div className="mt-4 max-w-136">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 size-3.75 -translate-y-1/2 text-ink-600"
            />
            <Input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("search.placeholder")}
              className="h-11 pl-9"
            />
          </div>
          {/* Chips rather than a segmented control: this was written when there
              were two mediums and called them "one choice among several the
              search will grow". People are the third, and the chips took it
              without a layout change — which is what the shape was chosen for. */}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(["ANIME", "MANGA", "USERS"] as const).map((sc) => (
              <Pill key={sc} active={scope === sc} onClick={() => setScope(sc)}>
                {sc === "ANIME"
                  ? t("search.anime")
                  : sc === "MANGA"
                    ? t("search.manga")
                    : t("search.users")}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {scope === "USERS" && <UserSearchResults term={term} />}
        {scope !== "USERS" && (
          <MediaResults
            error={error}
            isFetching={isFetching}
            term={term}
            results={results}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Users need a longer query than media.
 *
 * Two characters make AniList return the exact match followed by a fixed set of
 * unrelated accounts, so the threshold is three — the point at which it starts
 * answering with real prefix matches. Media search is fine at two and keeps it.
 */
function UserSearchResults({ term }: { term: string }) {
  const { t } = useTranslation();
  const mode = useAuth((s) => s.mode);

  if (mode !== "anilist") {
    return (
      <EmptyState
        visual={<PerchRule />}
        title={t("social.needsAccount")}
        hint={t("social.needsAccountHint")}
      />
    );
  }

  if (term.length < USER_SEARCH_MIN) {
    return (
      <EmptyState
        title={t("search.userPrompt")}
        hint={t("search.userPromptHint", { n: USER_SEARCH_MIN })}
      />
    );
  }

  return (
    <UserList
      queryKey={["social", "userSearch", term]}
      fetchPage={(page) => searchUsers(term, page)}
      emptyTitle={t("search.noUsers")}
      emptyHint={t("search.noUsersHint")}
      // AniList's `total` is a capped 5000 here, so a count would be invented.
      countRemaining={false}
      staleTime={5 * 60 * 1000}
    />
  );
}

/** Unchanged behaviour, lifted into its own component so the scope branch above
 *  reads as two alternatives rather than one nested in the other. */
function MediaResults({
  error,
  isFetching,
  term,
  results,
}: {
  error: unknown;
  isFetching: boolean;
  term: string;
  results: MediaWithListStatus[];
}) {
  const { t } = useTranslation();
  return (
    <>
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
    </>
  );
}
