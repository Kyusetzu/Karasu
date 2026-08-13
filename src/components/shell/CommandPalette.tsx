import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { displayTitle, type ListResult, type MediaType } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { cn } from "@/lib/utils";
import { usePresence } from "@/hooks/usePresence";

interface Item {
  id: string;
  label: string;
  sub?: string;
  path: string;
  cover?: string | null;
  native?: string | null;
}

interface Group {
  key: string;
  items: Item[];
}

const NAV: { path: string; key: string }[] = [
  { path: "/", key: "nav.dashboard" },
  { path: "/list", key: "nav.list" },
  { path: "/manga", key: "nav.manga" },
  { path: "/search", key: "nav.search" },
  { path: "/seasonal", key: "nav.seasonal" },
  { path: "/social", key: "nav.social" },
  { path: "/forum", key: "nav.forum" },
  { path: "/stats", key: "nav.stats" },
  { path: "/library", key: "nav.library" },
  { path: "/about", key: "nav.about" },
  { path: "/settings", key: "nav.settings" },
];

const MAX_RESULTS = 30;

/** Global Ctrl/Cmd+K palette: fuzzy jump to a page or a list entry. */
export default function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const viewer = useAuth((s) => s.viewer);
  const level = useContentFilter((s) => s.level);
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    // Also openable from the in-app context menu.
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Entries from the cached lists (searchable across all title variants).
  // This reads the query cache directly rather than going through MediaList,
  // so it needs its own content-filter check — MediaList's does not apply.
  const entries = useMemo(() => {
    if (!open || !viewer) return [];
    const out: { item: Item; haystack: string }[] = [];
    const seen = new Set<number>();
    for (const type of ["ANIME", "MANGA"] as MediaType[]) {
      const data = qc.getQueryData<ListResult>(["mediaList", type, viewer.id]);
      for (const group of data?.lists ?? []) {
        if (group.isCustomList) continue;
        for (const e of group.entries) {
          if (seen.has(e.mediaId)) continue;
          if (isBlocked(e.media, level)) continue;
          seen.add(e.mediaId);
          const ti = e.media.title;
          out.push({
            item: {
              id: `m-${e.mediaId}`,
              label: displayTitle(ti),
              sub: type === "ANIME" ? t("nav.list") : t("nav.manga"),
              path: `/media/${e.media.id}`,
              cover: e.media.coverImage.large,
              native: ti.native && ti.native !== displayTitle(ti) ? ti.native : null,
            },
            haystack: [ti.romaji, ti.english, ti.native, ...e.media.synonyms]
              .filter(Boolean)
              .join(" ")
              .toLowerCase(),
          });
        }
      }
    }
    return out;
  }, [open, viewer, qc, t, level]);

  // Grouped, because the two kinds of hit are not interchangeable: one moves
  // you to a screen, the other to a title. A single ranked list makes the user
  // read every row to work out which kind they are looking at.
  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const navItems: Item[] = NAV.map((n) => ({
      id: n.path,
      label: t(n.key),
      path: n.path,
    }));
    if (!q) return [{ key: "palette.groupGoTo", items: navItems }];
    const nav = navItems.filter((i) => i.label.toLowerCase().includes(q));
    const media = entries
      .filter((e) => e.haystack.includes(q))
      .map((e) => e.item)
      .slice(0, MAX_RESULTS);
    return [
      { key: "palette.groupList", items: media },
      { key: "palette.groupGoTo", items: nav },
    ].filter((g) => g.items.length > 0);
  }, [query, entries, t]);

  // One flat order for the keyboard, so ↑↓ crosses group boundaries the way
  // the eye does.
  const results = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setSel(0), [query]);

  // Escape should feel deliberate rather than abrupt: the panel leaves the
  // way it came. `data-overlay` stays on it while it does, so the list
  // behind cannot act on a keypress meant for a palette still on screen.
  if (!presence.mounted) return null;

  const go = (item: Item | undefined) => {
    if (!item) return;
    navigate(item.path);
    setOpen(false);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[sel]);
    }
  };

  return (
    <div
      data-overlay
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-[rgba(4,5,8,.55)] px-4 pb-4 pt-22",
        presence.leaving ? "animate-fade-out" : "animate-fade-in",
      )}
      onMouseDown={() => setOpen(false)}
    >
      <div
        className={cn(
          "w-full max-w-136 overflow-hidden rounded-xl border border-hair bg-surface-900 shadow-2xl panel-wash",
          presence.leaving ? "animate-settle-out" : "animate-spring-in",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hair px-3.5">
          <Search className="size-4 shrink-0 text-ink-600" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t("palette.placeholder")}
            className="h-12 flex-1 bg-transparent text-sm text-ink-100 placeholder:text-ink-600 focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-surface-700 bg-surface-850 px-1.5 py-0.5 font-brand text-2xs font-semibold text-ink-600">
            ESC
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto py-1">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-600">{t("palette.empty")}</p>
          ) : (
            groups.map((group) => (
              <section key={group.key}>
                <h3 className="px-3.5 pb-1 pt-2 text-[.5625rem] font-semibold uppercase tracking-[.14em] text-ink-600">
                  {t(group.key)}
                </h3>
                <ul>
                  {group.items.map((item) => {
                    const i = results.indexOf(item);
                    return (
                      <li key={item.id}>
                        <button
                          onMouseEnter={() => setSel(i)}
                          onClick={() => go(item)}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-sm transition-surface",
                            i === sel
                              ? "bg-surface-850 text-ink-100"
                              : "text-ink-300",
                          )}
                        >
                          {item.cover !== undefined && (
                            <span className="h-8 w-5.5 shrink-0 overflow-hidden rounded-[.1875rem] bg-surface-800">
                              {item.cover && (
                                <img
                                  src={item.cover}
                                  alt=""
                                  className="size-full object-cover"
                                />
                              )}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{item.label}</span>
                            {item.native && (
                              <span className="block truncate font-brand-jp text-2xs text-ink-600">
                                {item.native}
                              </span>
                            )}
                          </span>
                          {item.sub && (
                            <span className="shrink-0 text-2xs text-ink-600">
                              {item.sub}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        {/* The strip is the whole tutorial: nobody reads documentation for a
            palette, they read the bottom of it. */}
        <div className="flex items-center gap-3 border-t border-hair px-3.5 py-1.5 text-2xs text-ink-600">
          <span>{t("palette.hintMove")}</span>
          <span>{t("palette.hintRun")}</span>
          <span className="ml-auto">{t("palette.hintClose")}</span>
        </div>
      </div>
    </div>
  );
}
