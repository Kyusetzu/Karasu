import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Search as SearchIcon } from "lucide-react";
import { forumThreads, THREAD_CATEGORIES } from "@/api/social";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { ThreadList } from "@/components/social/ThreadList";
import { useAuth } from "@/stores/auth";
import { cn } from "@/lib/utils";

/**
 * The forum index.
 *
 * Deferred during the social work as "a second feature with its own rate-limit
 * story" — which it is, so it keeps every rule that story implies: paging is a
 * button, only the active lens is mounted, and nothing fetches on a keystroke.
 *
 * Three lenses, and they are lenses rather than tabs because AniList models them
 * as different arguments to one field: browse (optionally one category), search,
 * and your subscriptions. Category and lens live in the URL, so a category is a
 * link someone can keep.
 */
type Lens = "browse" | "search" | "subscribed";

const LENSES: Lens[] = ["browse", "search", "subscribed"];

function isLens(v: string | null): v is Lens {
  return LENSES.includes((v ?? "") as Lens);
}

export default function Forum() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const mode = useAuth((s) => s.mode);

  const lens: Lens = isLens(params.get("lens")) ? (params.get("lens") as Lens) : "browse";
  const categoryId = Number(params.get("cat")) || undefined;

  const [input, setInput] = useState(params.get("q") ?? "");
  const [term, setTerm] = useState(params.get("q") ?? "");

  // The same 500 ms debounce the media search uses. A forum search on every
  // keystroke would spend the shared rate limit faster than anything else here.
  // The settled term is also written back to `?q=` — it was only ever *read*
  // before, so a search did not survive Back from a thread.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = input.trim();
      setTerm(next);
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next) p.set("q", next);
          else p.delete("q");
          return p;
        },
        { replace: true },
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [input, setParams]);

  const setLens = (next: Lens) => {
    const p = new URLSearchParams(params);
    if (next === "browse") p.delete("lens");
    else p.set("lens", next);
    // A category filter means nothing to a search or a subscription list.
    if (next !== "browse") p.delete("cat");
    setParams(p, { replace: true });
  };

  const setCategory = (id: number | undefined) => {
    const p = new URLSearchParams(params);
    if (id === undefined) p.delete("cat");
    else p.set("cat", String(id));
    setParams(p, { replace: true });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-2xl font-bold">{t("forum.title")}</h1>
          <span className="font-brand-jp text-[.8125rem] tracking-[.04em] text-ink-600">
            掲示板
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {LENSES.map((l) => (
            <Pill key={l} active={lens === l} onClick={() => setLens(l)}>
              {l === "browse"
                ? t("forum.lensBrowse")
                : l === "search"
                  ? t("forum.lensSearch")
                  : t("forum.lensSubscribed")}
            </Pill>
          ))}
        </div>

        {lens === "search" && (
          <div className="relative mt-3 max-w-136">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.75 -translate-y-1/2 text-ink-600" />
            <Input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("forum.searchPlaceholder")}
              className="h-10 pl-9"
            />
          </div>
        )}

        {lens === "browse" && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill active={categoryId === undefined} onClick={() => setCategory(undefined)}>
              {t("forum.allCategories")}
            </Pill>
            {THREAD_CATEGORIES.map((c) => (
              <Pill
                key={c.id}
                active={categoryId === c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </Pill>
            ))}
          </div>
        )}
      </div>

      {/* Keyed so switching lens replays the settle, and — more to the point —
          so the previous lens unmounts. An unmounted infinite query has no
          observer and cannot join a refetch. */}
      <div
        key={`${lens}:${categoryId ?? "all"}:${lens === "search" ? term : ""}`}
        className={cn("min-h-0 flex-1 animate-settle overflow-y-auto px-8 py-6")}
      >
        {lens === "search" && term.length < 2 ? (
          <p className="text-sm text-ink-600">{t("forum.searchPrompt")}</p>
        ) : lens === "subscribed" && mode !== "anilist" ? (
          <p className="text-sm text-ink-600">{t("forum.subscribedNeedsAccount")}</p>
        ) : (
          <ThreadList
            queryKey={["social", "forum", lens, categoryId ?? null, lens === "search" ? term : null]}
            fetchPage={(page) =>
              forumThreads(
                lens === "search"
                  ? { search: term }
                  : lens === "subscribed"
                    ? { subscribed: true }
                    : { categoryId },
                page,
              )
            }
            emptyTitle={
              lens === "search"
                ? t("forum.noSearchResults")
                : lens === "subscribed"
                  ? t("forum.noSubscriptions")
                  : t("forum.noThreads")
            }
            emptyHint={lens === "subscribed" ? t("forum.noSubscriptionsHint") : undefined}
            // A search goes stale sooner than a category listing, but neither is
            // volatile enough to justify a short window.
            staleTime={lens === "search" ? 5 * 60 * 1000 : 10 * 60 * 1000}
          />
        )}
      </div>
    </div>
  );
}
